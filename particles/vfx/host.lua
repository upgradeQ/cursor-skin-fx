-- OBS glue shared by the cursor VFX scripts: source registration, settings
-- UI, cursor mapping, GPU lifetime and drawing the compute output.

local obs = obslua
local ffi = require("ffi")
local bit = require("bit")
local d3d = require("vfx.d3d11")
local shaders = require("vfx.shaders")
local params = require("vfx.params")
local cursor = require("vfx.cursor")
local win32 = require("vfx.win32")
local libobs = require("vfx.libobs")

local GS_DEVICE_DIRECT3D_11 = obs.GS_DEVICE_DIRECT3D_11 or 2
local GS_RGBA16F = obs.GS_RGBA16F or 9
local GS_RENDER_TARGET = obs.GS_RENDER_TARGET or 4
local GS_BLEND_ONE = obs.GS_BLEND_ONE or 1
local GS_BLEND_INVSRCALPHA = obs.GS_BLEND_INVSRCALPHA or 5
local GS_CS_709_SCRGB = obs.GS_CS_709_SCRGB or 3
local OBS_EFFECT_DEFAULT = obs.OBS_EFFECT_DEFAULT or 0
local OBS_SOURCE_SRGB = obs.OBS_SOURCE_SRGB or bit.lshift(1, 15)

-- Settings that belong to the host rather than to an effect. They share one
-- obs_data with the effect's settings, hence the "src_" prefix.
local HOST_PARAMS = {
	{ "src_area", "Cursor area", "list", "primary" },
	{ "src_area_x", "Area left (px)", "intbox", 0, -100000, 100000, 1 },
	{ "src_area_y", "Area top (px)", "intbox", 0, -100000, 100000, 1 },
	{ "src_area_w", "Area width (px)", "intbox", 1920, 1, 100000, 1 },
	{ "src_area_h", "Area height (px)", "intbox", 1080, 1, 100000, 1 },
	{ "src_match_canvas", "Match the canvas size", "bool", true },
	{ "src_width", "Width", "intbox", 1920, 16, 16384, 1 },
	{ "src_height", "Height", "intbox", 1080, 16, 16384, 1 },
	{ "src_render_scale", "Render resolution (%)", "int", 100, 25, 100, 5 },
}

local H = {}

local state = {
	effect = nil,
	root = nil,
	bytecode = nil,     -- { [entry] = cs_5_0 bytecode }
	build_error = nil,
	gpu = nil,          -- wrapper around OBS's ID3D11Device
	kernels = nil,      -- { [entry] = ID3D11ComputeShader* }
	sources = {},       -- live source data tables
	dead_textures = {}, -- OBS textures to free on the graphics thread
}

local function log(level, msg)
	msg = "[" .. (state.effect and state.effect.name or "cursor vfx") .. "] " .. msg
	if obs.script_log then
		obs.script_log(level, msg)
	else
		print(msg)
	end
end

---------------------------------------------------------------- settings

local function read_setting(settings, spec)
	local key, kind = spec[1], spec[3]
	if kind == "float" then
		return obs.obs_data_get_double(settings, key)
	elseif kind == "int" or kind == "intbox" or kind == "color" then
		return obs.obs_data_get_int(settings, key)
	elseif kind == "bool" then
		return obs.obs_data_get_bool(settings, key)
	end
	return obs.obs_data_get_string(settings, key)
end

local function set_default(settings, spec, value)
	local key, kind = spec[1], spec[3]
	if kind == "float" then
		obs.obs_data_set_default_double(settings, key, value)
	elseif kind == "int" or kind == "intbox" or kind == "color" then
		obs.obs_data_set_default_int(settings, key, value)
	elseif kind == "bool" then
		obs.obs_data_set_default_bool(settings, key, value)
	else
		obs.obs_data_set_default_string(settings, key, value)
	end
end

local function add_property(props, spec)
	local key, label, kind = spec[1], spec[2], spec[3]
	if kind == "float" then
		return obs.obs_properties_add_float_slider(props, key, label, spec[5], spec[6], spec[7])
	elseif kind == "int" then
		return obs.obs_properties_add_int_slider(props, key, label, spec[5], spec[6], spec[7])
	elseif kind == "intbox" then
		return obs.obs_properties_add_int(props, key, label, spec[5], spec[6], spec[7])
	elseif kind == "bool" then
		return obs.obs_properties_add_bool(props, key, label)
	elseif kind == "color" then
		return obs.obs_properties_add_color(props, key, label)
	end
	local list = obs.obs_properties_add_list(props, key, label, obs.OBS_COMBO_TYPE_LIST, obs.OBS_COMBO_FORMAT_STRING)
	for _, item in ipairs(spec.items or {}) do
		obs.obs_property_list_add_string(list, item[2], item[1])
	end
	return list
end

local function canvas_size()
	local ovi = obs.obs_video_info()
	if obs.obs_get_video_info(ovi) then
		return ovi.base_width, ovi.base_height
	end
	return 1920, 1080
end

-- Screen rectangle the source maps onto, in virtual-desktop pixels.
local function resolve_region(raw)
	local mode = raw.src_area or "primary"
	if mode == "custom" then
		return {
			x = raw.src_area_x,
			y = raw.src_area_y,
			w = math.max(raw.src_area_w, 1),
			h = math.max(raw.src_area_h, 1),
		}
	elseif mode == "virtual" then
		return win32.virtual_desktop()
	end
	local monitors = win32.monitors()
	if mode:sub(1, 4) == "mon:" then
		for _, m in ipairs(monitors) do
			if m.device == mode:sub(5) then
				return m
			end
		end
	end
	for _, m in ipairs(monitors) do
		if m.primary then
			return m
		end
	end
	return win32.primary()
end

local function render_size(data)
	return math.max(math.floor(data.width * data.scale + 0.5), 8),
		math.max(math.floor(data.height * data.scale + 0.5), 8)
end

---------------------------------------------------------------- GPU lifetime

-- Raw D3D11 objects may be released from any thread; OBS textures must be
-- destroyed inside the graphics context, so destroy() parks them here.
local function free_dead_textures()
	for i = #state.dead_textures, 1, -1 do
		libobs.gs_texture_destroy(state.dead_textures[i])
		state.dead_textures[i] = nil
	end
end

local function release_instance(data, in_graphics)
	if data.inst then
		data.inst:destroy()
		data.inst = nil
	end
	if data.tex ~= nil then
		if in_graphics then
			libobs.gs_texture_destroy(data.tex)
		else
			state.dead_textures[#state.dead_textures + 1] = data.tex
		end
		data.tex = nil
	end
end

local function release_gpu()
	for data in pairs(state.sources) do
		release_instance(data, true)
	end
	if state.kernels then
		for _, cs in pairs(state.kernels) do
			d3d.release(cs)
		end
		state.kernels = nil
	end
	if state.gpu then
		state.gpu:destroy()
		state.gpu = nil
	end
end

-- Inside the graphics context only.
local function acquire_gpu()
	if libobs.gs_get_device_type() ~= GS_DEVICE_DIRECT3D_11 then
		return nil, "needs the Direct3D 11 renderer (Settings > Advanced > Video > Renderer)"
	end
	local device = libobs.gs_get_device_obj()
	if device == nil then
		return nil, "OBS has no graphics device"
	end
	local id = tonumber(ffi.cast("uintptr_t", device))
	if state.gpu and state.gpu.id == id then
		return state.gpu
	end
	-- first use, or OBS rebuilt its device after a GPU reset
	release_gpu()
	if not state.bytecode then
		return nil, "shaders failed to compile: " .. tostring(state.build_error)
	end
	local gpu, err = d3d.wrap(device)
	if not gpu then
		return nil, err
	end
	local kernels = {}
	local ok, failure = pcall(function()
		for name, code in pairs(state.bytecode) do
			kernels[name] = gpu:shader(code)
		end
	end)
	if not ok then
		for _, cs in pairs(kernels) do
			d3d.release(cs)
		end
		gpu:destroy()
		state.bytecode = nil
		state.build_error = failure
		return nil, "could not create compute shaders: " .. tostring(failure)
	end
	state.gpu, state.kernels = gpu, kernels
	return gpu
end

local function build_instance(data, gpu)
	release_instance(data, true)
	local w, h = render_size(data)
	data.inst = state.effect.new(gpu, state.kernels, w, h)
	data.inst:configure(data.cfg)
	data.tex = libobs.gs_texture_create(w, h, GS_RGBA16F, 1, nil, GS_RENDER_TARGET)
	if data.tex == nil then
		error("could not create the output texture", 0)
	end
	data.rw, data.rh = w, h
	data.gpu_id = gpu.id
	data.tracker = cursor.new()
end

---------------------------------------------------------------- per frame

local function sample_cursor(data, dt, gap)
	local sx, sy = win32.cursor()
	local x, y, inside
	if sx then
		local r = data.region
		x = (sx + 0.5 - r.x) / r.w * data.rw
		y = (sy + 0.5 - r.y) / r.h * data.rh
		inside = sx >= r.x and sy >= r.y and sx < r.x + r.w and sy < r.y + r.h
	end
	return data.tracker:sample(x, y, inside, win32.left_button(), dt, data.rw, data.rh, gap)
end

local function draw(data)
	local effect = libobs.obs_get_base_effect(OBS_EFFECT_DEFAULT)
	local tech = "Draw"
	if libobs.gs_get_color_space() == GS_CS_709_SCRGB then
		tech = "DrawMultiply"
		local mul = libobs.gs_effect_get_param_by_name(effect, "multiplier")
		libobs.gs_effect_set_float(mul, libobs.obs_get_video_sdr_white_level() / 80)
	end

	local srgb = libobs.gs_framebuffer_srgb_enabled()
	libobs.gs_enable_framebuffer_srgb(true)
	libobs.gs_blend_state_push()
	libobs.gs_enable_blending(true)
	if data.additive then
		libobs.gs_blend_function_separate(GS_BLEND_ONE, GS_BLEND_ONE, GS_BLEND_ONE, GS_BLEND_INVSRCALPHA)
	else
		-- premultiplied "over"; the output's alpha makes this act like screen
		libobs.gs_blend_function_separate(GS_BLEND_ONE, GS_BLEND_INVSRCALPHA, GS_BLEND_ONE, GS_BLEND_INVSRCALPHA)
	end
	libobs.gs_effect_set_texture(libobs.gs_effect_get_param_by_name(effect, "image"), data.tex)
	while libobs.gs_effect_loop(effect, tech) do
		libobs.gs_draw_sprite(data.tex, 0, data.width, data.height)
	end
	libobs.gs_blend_state_pop()
	libobs.gs_enable_framebuffer_srgb(srgb)
end

local function render(data)
	free_dead_textures()
	local gpu, err = acquire_gpu()
	if not gpu then
		if data.last_error ~= err then
			data.last_error = err
			log(obs.LOG_WARNING, err)
		end
		return
	end

	local w, h = render_size(data)
	if not data.inst or data.gpu_id ~= gpu.id or data.rw ~= w or data.rh ~= h then
		build_instance(data, gpu)
	end

	-- simulate once per output frame, however often OBS draws the source
	-- (studio mode, projectors, nested scenes)
	local now = obs.obs_get_video_frame_time()
	if now ~= data.last_frame then
		local dt = data.last_frame and (now - data.last_frame) / 1e9 or 1 / 60
		data.last_frame = now
		local gap = dt <= 0 or dt > 0.25
		dt = gap and 1 / 60 or math.min(dt, 0.1)
		local inp = sample_cursor(data, dt, gap)
		data.time = data.time + dt
		data.frame = data.frame + 1
		inp.time, inp.frame = data.time, data.frame
		data.inst:frame(inp)
		gpu:copy(libobs.gs_texture_get_obj(data.tex), data.inst:output())
	end
	draw(data)
end

---------------------------------------------------------------- source callbacks

local function update(data, settings)
	local raw = {}
	for _, spec in ipairs(HOST_PARAMS) do
		raw[spec[1]] = read_setting(settings, spec)
	end
	for _, spec in ipairs(params.all(state.effect)) do
		raw[spec[1]] = read_setting(settings, spec)
	end
	data.raw = raw
	data.cfg = params.to_cfg(state.effect, raw)
	data.additive = raw.blend == "add"
	if raw.src_match_canvas then
		data.width, data.height = canvas_size()
	else
		data.width, data.height = math.max(raw.src_width, 16), math.max(raw.src_height, 16)
	end
	data.scale = math.min(math.max(raw.src_render_scale, 25), 100) / 100
	data.region = resolve_region(raw)
	data.broken = false
	data.last_error = nil
	if data.inst then
		data.inst:configure(data.cfg)
	end
end

local function create(settings, source)
	local data = { source = source, tracker = cursor.new(), time = 0, frame = 0, since_check = 0 }
	update(data, settings)
	state.sources[data] = true
	return data
end

local function destroy(data)
	state.sources[data] = nil
	-- No obs_enter_graphics here: OBS may call this while the graphics thread
	-- waits on this script's lock to render another instance.
	pcall(release_instance, data, false)
end

local function video_tick(data, seconds)
	data.since_check = data.since_check + seconds
	if data.since_check > 3 then
		-- monitors and the canvas can change while OBS runs
		data.since_check = 0
		data.region = resolve_region(data.raw)
		if data.raw.src_match_canvas then
			data.width, data.height = canvas_size()
		end
	end
end

local function video_render(data)
	if data.broken then
		return
	end
	local ok, err = pcall(render, data)
	if not ok then
		data.broken = true
		log(obs.LOG_ERROR, "stopped: " .. tostring(err) .. " (change any setting to retry)")
		pcall(release_instance, data, true)
	end
end

local function get_defaults(settings)
	local cw, ch = canvas_size()
	local primary = win32.primary()
	local host = { src_width = cw, src_height = ch, src_area_w = primary.w, src_area_h = primary.h }
	for _, spec in ipairs(HOST_PARAMS) do
		local v = host[spec[1]]
		if v == nil then
			v = spec[4]
		end
		set_default(settings, spec, v)
	end
	for _, spec in ipairs(params.all(state.effect)) do
		set_default(settings, spec, params.default_of(state.effect, spec))
	end
end

local function toggle_visibility(props, settings)
	local custom = obs.obs_data_get_string(settings, "src_area") == "custom"
	for _, key in ipairs({ "src_area_x", "src_area_y", "src_area_w", "src_area_h" }) do
		obs.obs_property_set_visible(obs.obs_properties_get(props, key), custom)
	end
	local manual = not obs.obs_data_get_bool(settings, "src_match_canvas")
	obs.obs_property_set_visible(obs.obs_properties_get(props, "src_width"), manual)
	obs.obs_property_set_visible(obs.obs_properties_get(props, "src_height"), manual)
	return true
end

local function get_properties()
	local effect = state.effect
	local props = obs.obs_properties_create()

	local fx = obs.obs_properties_create()
	for _, spec in ipairs(effect.params) do
		add_property(fx, spec)
	end
	obs.obs_properties_add_group(props, "group_effect", (effect.name:gsub("^Cursor VFX: ", "")), obs.OBS_GROUP_NORMAL, fx)

	local look = obs.obs_properties_create()
	for _, spec in ipairs(params.output) do
		add_property(look, spec)
	end
	obs.obs_properties_add_group(props, "group_look", "Look", obs.OBS_GROUP_NORMAL, look)

	local area = obs.obs_properties_create()
	local list = obs.obs_properties_add_list(area, "src_area", "Cursor area", obs.OBS_COMBO_TYPE_LIST, obs.OBS_COMBO_FORMAT_STRING)
	obs.obs_property_list_add_string(list, "Primary monitor", "primary")
	for i, m in ipairs(win32.monitors()) do
		local label = string.format("Monitor %d: %dx%d at %d, %d%s", i, m.w, m.h, m.x, m.y, m.primary and " (primary)" or "")
		obs.obs_property_list_add_string(list, label, "mon:" .. m.device)
	end
	obs.obs_property_list_add_string(list, "All monitors", "virtual")
	obs.obs_property_list_add_string(list, "Custom rectangle", "custom")
	for i = 2, #HOST_PARAMS do
		add_property(area, HOST_PARAMS[i])
	end
	obs.obs_property_set_modified_callback(list, function(p, _, settings)
		return toggle_visibility(p, settings)
	end)
	obs.obs_property_set_modified_callback(obs.obs_properties_get(area, "src_match_canvas"), function(p, _, settings)
		return toggle_visibility(p, settings)
	end)
	obs.obs_properties_add_group(props, "group_area", "Cursor area and size", obs.OBS_GROUP_NORMAL, area)
	return props
end

---------------------------------------------------------------- script API

function H.description(effect)
	return string.format([[<h3>%s</h3><p>%s</p>
<p>Adds the source <b>%s</b>. Put it above your display capture, sized like it.
Simulation and drawing run in Direct3D 11 compute shaders on OBS's own GPU device,
so OBS must use the Direct3D 11 renderer.</p>]], effect.name, effect.description, effect.name)
end

-- root: the script's directory (script_path()), with a trailing slash.
function H.register(effect, root)
	state.effect, state.root = effect, root
	local seen = {}
	for _, spec in ipairs(HOST_PARAMS) do
		seen[spec[1]] = true
	end
	for _, spec in ipairs(params.all(effect)) do
		assert(not seen[spec[1]], "setting key used twice: " .. spec[1])
		seen[spec[1]] = true
	end

	local t0 = os.clock()
	state.bytecode, state.build_error = shaders.build(root .. "vfx/shaders/", root .. "vfx/cache/",
		effect.shader_files, effect.kernels)
	if state.bytecode then
		log(obs.LOG_INFO, string.format("compute shaders ready in %.0f ms", (os.clock() - t0) * 1000))
	else
		log(obs.LOG_ERROR, "shader compile failed: " .. tostring(state.build_error))
	end

	obs.obs_register_source({
		id = effect.id,
		type = obs.OBS_SOURCE_TYPE_INPUT,
		output_flags = bit.bor(obs.OBS_SOURCE_VIDEO, obs.OBS_SOURCE_CUSTOM_DRAW, OBS_SOURCE_SRGB),
		get_name = function()
			return effect.name
		end,
		create = create,
		destroy = destroy,
		update = update,
		get_defaults = get_defaults,
		get_properties = get_properties,
		get_width = function(data)
			return data.width
		end,
		get_height = function(data)
			return data.height
		end,
		video_tick = video_tick,
		video_render = video_render,
	})
end

function H.unload()
	obs.obs_enter_graphics()
	pcall(free_dead_textures)
	pcall(release_gpu)
	obs.obs_leave_graphics()
end

return H
