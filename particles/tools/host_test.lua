-- Integration test for the OBS side: loads a real entry script (e.g.
-- cursor_ribbon.lua) against stand-ins for obslua and libobs whose graphics
-- calls are backed by a real D3D11 device, then walks the source through
-- register -> defaults -> properties -> create -> frames -> update ->
-- destroy -> unload, checking state and D3D11 debug-layer output.
-- Run via: pwsh -File tools/preview.ps1 -Script host_test.lua -Effect ribbon

local root = VFX_ROOT
package.path = root .. "?.lua;" .. root .. "tools/?.lua;" .. package.path

local ffi = require("ffi")
local d3d = require("vfx.d3d11")
local snap = require("snapshot")

local NAME = VFX_EFFECT
local W, H = tonumber(VFX_W), tonumber(VFX_H)
local OUT = VFX_OUT
local ENTRY = ({
	ribbon = "cursor_ribbon.lua",
	magic = "cursor_magic_particles.lua",
	glass_dust = "cursor_glass_dust.lua",
})[NAME]

local logf = assert(io.open(OUT .. "/host_" .. NAME .. ".log", "w"))
local function log(fmt, ...)
	local s = string.format(fmt, ...)
	logf:write(s, "\n")
	logf:flush()
	io.stdout:write(s, "\n")
	io.stdout:flush()
end

local failures = 0
local function check(cond, what)
	if not cond then
		failures = failures + 1
		log("FAIL: %s", what)
	end
	return cond
end

local gpu = assert(d3d.create_device(true))
local function drain(tag)
	for _, m in ipairs(gpu:messages()) do
		failures = failures + 1
		log("FAIL d3d11 [%s] %s", tag, m)
	end
end

---------------------------------------------------------------- libobs stand-in

local textures, live_textures = {}, 0
local draws, blend_depth, loops = 0, 0, 0
local bound_texture
local libobs = {
	gs_get_device_type = function()
		return 2
	end,
	gs_get_device_obj = function()
		return ffi.cast("void*", gpu.dev)
	end,
	gs_texture_create = function(w, h, format, levels, data, flags)
		check(format == 9 and levels == 1 and flags == 4, "texture created as GS_RGBA16F render target")
		local t = gpu:texture(w, h, d3d.FORMAT_RGBA16F)
		textures[t] = true
		live_textures = live_textures + 1
		return t
	end,
	gs_texture_destroy = function(t)
		check(textures[t], "destroying a texture we created")
		textures[t] = nil
		live_textures = live_textures - 1
		gpu:free(t)
	end,
	gs_texture_get_obj = function(t)
		return t.res
	end,
	obs_get_base_effect = function()
		return { name = "default" }
	end,
	gs_effect_get_param_by_name = function(_, name)
		return { name = name }
	end,
	gs_effect_set_texture = function(p, t)
		check(p.name == "image", "texture bound to the image param")
		bound_texture = t
	end,
	gs_effect_set_float = function() end,
	gs_effect_loop = function(_, tech)
		check(tech == "Draw", "default technique")
		loops = loops + 1
		return loops % 2 == 1
	end,
	gs_draw_sprite = function(t, flip, w, h)
		check(t == bound_texture and flip == 0 and w == W and h == H, "sprite drawn at source size")
		draws = draws + 1
	end,
	gs_blend_state_push = function()
		blend_depth = blend_depth + 1
	end,
	gs_blend_state_pop = function()
		blend_depth = blend_depth - 1
	end,
	gs_enable_blending = function() end,
	gs_blend_function_separate = function() end,
	gs_framebuffer_srgb_enabled = function()
		return false
	end,
	gs_enable_framebuffer_srgb = function() end,
	gs_get_color_space = function()
		return 0
	end,
	obs_get_video_sdr_white_level = function()
		return 300
	end,
}
package.loaded["vfx.libobs"] = libobs

---------------------------------------------------------------- win32 stand-in

local mouse = { x = 0, y = 0, down = false }
package.loaded["vfx.win32"] = {
	cursor = function()
		return math.floor(mouse.x), math.floor(mouse.y)
	end,
	left_button = function()
		return mouse.down
	end,
	primary = function()
		return { x = 0, y = 0, w = W, h = H }
	end,
	virtual_desktop = function()
		return { x = 0, y = 0, w = W, h = H }
	end,
	monitors = function()
		return { { device = "\\\\.\\DISPLAY1", x = 0, y = 0, w = W, h = H, primary = true } }
	end,
}

---------------------------------------------------------------- obslua stand-in

local registered
local frame_ns = 0

local function data_get(d, k, zero)
	local v = d.v[k]
	if v == nil then
		v = d.d[k]
	end
	if v == nil then
		v = zero
	end
	return v
end

local function prop_adder(kind)
	return function(props, name, label)
		check(type(name) == "string" and type(label) == "string", "property " .. tostring(name) .. " has a label")
		local p = { name = name, kind = kind, parent = props, visible = true }
		props.list[#props.list + 1] = p
		return p
	end
end

local function find_prop(props, name)
	for _, p in ipairs(props.list) do
		if p.name == name then
			return p
		end
		if p.sub then
			local hit = find_prop(p.sub, name)
			if hit then
				return hit
			end
		end
	end
end

obslua = {
	OBS_SOURCE_TYPE_INPUT = 0,
	OBS_SOURCE_VIDEO = 1,
	OBS_SOURCE_CUSTOM_DRAW = 8,
	LOG_ERROR = 100,
	LOG_WARNING = 200,
	LOG_INFO = 300,
	OBS_COMBO_TYPE_LIST = 2,
	OBS_COMBO_FORMAT_STRING = 3,
	OBS_GROUP_NORMAL = 1,
	script_log = function(level, msg)
		log("  [script log %d] %s", level, msg)
		if level <= 200 then
			failures = failures + 1
		end
	end,
	obs_data_create = function()
		return { v = {}, d = {} }
	end,
	obs_data_get_double = function(d, k)
		return data_get(d, k, 0)
	end,
	obs_data_get_int = function(d, k)
		return data_get(d, k, 0)
	end,
	obs_data_get_bool = function(d, k)
		return data_get(d, k, false)
	end,
	obs_data_get_string = function(d, k)
		return data_get(d, k, "")
	end,
	obs_data_set_default_double = function(d, k, v)
		check(type(v) == "number", "default for " .. k)
		d.d[k] = v
	end,
	obs_data_set_default_int = function(d, k, v)
		check(type(v) == "number", "default for " .. k)
		d.d[k] = v
	end,
	obs_data_set_default_bool = function(d, k, v)
		check(type(v) == "boolean", "default for " .. k)
		d.d[k] = v
	end,
	obs_data_set_default_string = function(d, k, v)
		check(type(v) == "string", "default for " .. k)
		d.d[k] = v
	end,
	obs_properties_create = function()
		return { list = {} }
	end,
	obs_properties_add_float_slider = prop_adder("float"),
	obs_properties_add_int_slider = prop_adder("int"),
	obs_properties_add_int = prop_adder("intbox"),
	obs_properties_add_bool = prop_adder("bool"),
	obs_properties_add_color = prop_adder("color"),
	obs_properties_add_list = prop_adder("list"),
	obs_properties_add_group = function(props, name, label, kind, sub)
		local p = prop_adder("group")(props, name, label)
		p.sub = sub
		return p
	end,
	obs_property_list_add_string = function(p, label, value)
		p.items = p.items or {}
		p.items[#p.items + 1] = { label, value }
	end,
	obs_properties_get = find_prop,
	obs_property_set_visible = function(p, v)
		if check(p ~= nil, "set_visible on an existing property") then
			p.visible = v
		end
	end,
	obs_property_set_modified_callback = function(p, cb)
		if check(p ~= nil, "modified callback on an existing property") then
			p.modified = cb
		end
	end,
	obs_register_source = function(info)
		registered = info
	end,
	obs_video_info = function()
		return {}
	end,
	obs_get_video_info = function(ovi)
		ovi.base_width, ovi.base_height = W, H
		return true
	end,
	obs_get_video_frame_time = function()
		return frame_ns
	end,
	obs_enter_graphics = function() end,
	obs_leave_graphics = function() end,
}

function script_path()
	return root
end

---------------------------------------------------------------- run

log("== %s via %s", NAME, ENTRY)
dofile(root .. ENTRY)
script_load()
check(registered ~= nil, "script registered a source")
check(type(script_description()) == "string", "script description")
log("registered %s (%s)", registered.id, registered.get_name())

local settings = obslua.obs_data_create()
registered.get_defaults(settings)

local props = registered.get_properties(nil)
local area = find_prop(props, "src_area")
check(area and area.items and #area.items >= 4, "cursor area list is populated")
settings.v.src_area = "custom"
check(area.modified(area.parent, area, settings), "area callback returns true")
check(find_prop(props, "src_area_x").visible == true, "custom area fields shown")
settings.v.src_area = nil
area.modified(area.parent, area, settings)
check(find_prop(props, "src_area_x").visible == false, "custom area fields hidden")
check(find_prop(props, "src_width").visible == false, "manual size hidden while matching canvas")

local data = registered.create(settings, {})
check(registered.get_width(data) == W and registered.get_height(data) == H, "source size matches the canvas")

local function run(first, last)
	for f = first, last do
		local t = f / 60
		mouse.x = W * (0.5 + 0.3 * math.sin(t * 2.1))
		mouse.y = H * (0.5 + 0.25 * math.sin(t * 4.2))
		mouse.down = f % 90 == 45
		frame_ns = f * 16666667
		registered.video_tick(data, 1 / 60)
		registered.video_render(data, nil)
		if f % 7 == 0 then
			-- a second render in the same frame must not step the simulation
			registered.video_render(data, nil)
		end
		check(not data.broken, "frame " .. f .. " rendered")
		check(blend_depth == 0, "blend state balanced")
		drain("frame " .. f)
		if data.broken then
			break
		end
	end
end

run(1, 120)
check(draws == 120 + math.floor(120 / 7), "one draw per render call")
check(data.frame == 120, "simulated once per frame")
if data.tex then
	local lit, peak = snap.write(gpu, data.tex, string.format("%s/host_%s_a.png", OUT, NAME))
	log("after 120 frames: lit px %d, peak %.2f", lit, peak)
	check(lit > 500, "the effect drew something")
end

-- half resolution: must rebuild at the new size and keep going
settings.v.src_render_scale = 50
registered.update(data, settings)
run(121, 200)
check(data.rw == W / 2 and data.rh == H / 2, "rebuilt at 50% resolution")
if data.tex then
	local lit, peak = snap.write(gpu, data.tex, string.format("%s/host_%s_b.png", OUT, NAME))
	log("at 50%%: lit px %d, peak %.2f", lit, peak)
	check(lit > 100, "the effect drew something at 50%")
end

-- source hidden for two seconds (frame numbers jump), then shown again
run(321, 340)

registered.destroy(data)
script_unload()
check(live_textures == 0, "no OBS textures leaked")
drain("teardown")

-- Ask the debug layer what is still alive: only the device, its context and
-- the info queue should remain once the host has let go.
ffi.cdef[[
typedef struct VfxDebugVtbl {
	void *QueryInterface;
	void *AddRef;
	uint32_t (__stdcall *Release)(void *self);
	void *SetFeatureMask;
	void *GetFeatureMask;
	void *SetPresentPerRenderOpDelay;
	void *GetPresentPerRenderOpDelay;
	void *SetSwapChain;
	void *GetSwapChain;
	void *ValidateContext;
	HRESULT (__stdcall *ReportLiveDeviceObjects)(void *self, int flags);
} VfxDebugVtbl;
typedef struct VfxDebug { const VfxDebugVtbl *vt; } VfxDebug;
]]
local iid = ffi.new("VfxGuid", 0x79cf2233, 0x7536, 0x4948, { 0x9d, 0x36, 0x1e, 0x46, 0x92, 0xdc, 0x57, 0x60 })
local out = ffi.new("void*[1]")
local unk = ffi.cast("VfxUnknown*", gpu.dev)
if gpu.debug and unk.vt.QueryInterface(unk, iid, out) >= 0 then
	local dbg = ffi.cast("VfxDebug*", out[0])
	dbg.vt.ReportLiveDeviceObjects(dbg, 2 + 4) -- detail, ignore internal
	dbg.vt.Release(dbg)
	local held = 0
	for _, m in ipairs(gpu:messages()) do
		local kind, refs = m:match("Live (ID3D11%w+) at 0x%x+, Refcount: (%d+)")
		if kind and kind ~= "ID3D11Device" and kind ~= "ID3D11Context" and tonumber(refs) > 0 then
			held = held + 1
			log("  still referenced: %s", m)
		end
	end
	check(held == 0, "every D3D11 object the host made was released")
end
gpu:destroy()

log(failures == 0 and "PASS" or string.format("FAILED (%d)", failures))
logf:close()
if failures > 0 then
	error("host test failed", 0)
end
