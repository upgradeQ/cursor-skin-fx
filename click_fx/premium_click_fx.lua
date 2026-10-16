--[[
  Premium Click FX - OBS Studio Lua script (Windows)

  Registers a "Premium Click FX" source that visualises mouse clicks with
  shader-driven motion graphics:

    Ink Spiral      a hand-drawn brush spiral with a pencil guide line
    Sci-Fi Pulse    a fast blue HUD lock-on with Blender-built rings
    Inferno Burst   a turbulent fireball with embers and smoke
    MoGraph Pop     a flat ring, trim-path burst lines and confetti
    Liquid Splash   glossy goo droplets that stretch and snap
    Halftone Shock  a comic burst with halftone dots and action lines

  plus a matching indicator while a button is held down.

  The shader lives in premium_click_fx/click_fx.effect and samples textures
  generated in Blender by tools/blender/generate_textures.py.
]]

local obs = obslua
local ffi = require("ffi")
local bit = require("bit")

pcall(ffi.cdef, [[
typedef struct { int32_t x; int32_t y; } PCFX_POINT;
typedef struct { int32_t left; int32_t top; int32_t right; int32_t bottom; } PCFX_RECT;
typedef struct { uint32_t cbSize; PCFX_RECT rcMonitor; PCFX_RECT rcWork; uint32_t dwFlags; } PCFX_MONITORINFO;
typedef int (__stdcall *PCFX_MONITORENUMPROC)(void *, void *, PCFX_RECT *, intptr_t);
int   __stdcall GetCursorPos(PCFX_POINT *lpPoint);
short __stdcall GetAsyncKeyState(int vKey);
int   __stdcall GetSystemMetrics(int nIndex);
int   __stdcall EnumDisplayMonitors(void *hdc, const PCFX_RECT *lprcClip, PCFX_MONITORENUMPROC lpfnEnum, intptr_t dwData);
int   __stdcall GetMonitorInfoW(void *hMonitor, PCFX_MONITORINFO *lpmi);
void *__stdcall MonitorFromRect(const PCFX_RECT *lprc, uint32_t dwFlags);
]])

local user32 = ffi.load("user32")

local SOURCE_ID = "premium_click_fx"

local MONITOR_CUSTOM, MONITOR_PRIMARY = -1, -2
local STYLE_RANDOM, STYLE_CYCLE = -1, -2

local SM_SWAPBUTTON = 23
local MONITOR_DEFAULTTONULL, MONITOR_DEFAULTTOPRIMARY = 0, 1
local VK_LBUTTON, VK_RBUTTON, VK_MBUTTON = 0x01, 0x02, 0x04

local BASE_RADIUS = 0.065     -- effect radius at Size 100 %, as a fraction of the area height
local MAX_EFFECTS = 24
local HOLD_DELAY = 0.12       -- s a button must stay down before the hold indicator shows
local HOLD_FADE_IN = 0.08
local HOLD_FADE_OUT = 0.15
local HOLD_EXT = { -0.8, -1.05, 0.8, 0.8 }
local REGION_REFRESH = 2.0    -- s between checks for monitor resolution changes

-- tech: technique in click_fx.effect. dur: seconds at 100 % speed. rmul: radius
-- multiplier. ext: quad around the click in units of the radius (x0, y0, x1, y1).
-- colors: default palette as 0xRRGGBB; the shader reads them as fx_col_a..d.
local STYLES = {
	{ name = "Ink Spiral (hand-drawn)", tech = "Ink", dur = 1.25, rmul = 1.0,
	  ext = { -1.5, -1.5, 1.5, 1.5 }, colors = { 0xFF4136, 0xFFB3A7, 0x000000, 0x000000 } },
	{ name = "Sci-Fi Pulse (blue)", tech = "SciFi", dur = 0.78, rmul = 1.0,
	  ext = { -1.8, -1.8, 1.8, 1.8 }, colors = { 0x1E8BFF, 0x6FF4FF, 0xE8FBFF, 0x000000 } },
	{ name = "Inferno Burst (fire)", tech = "Fire", dur = 1.3, rmul = 0.95,
	  ext = { -1.6, -2.3, 1.6, 1.2 }, colors = { 0xFF7A1A, 0x7A0A00, 0x000000, 0x000000 } },
	{ name = "MoGraph Pop", tech = "Pop", dur = 0.85, rmul = 0.9,
	  ext = { -1.5, -1.5, 1.5, 1.65 }, colors = { 0xFF4F81, 0xFFC93C, 0x2EC4B6, 0x7B5CFF } },
	{ name = "Liquid Splash", tech = "Liquid", dur = 1.1, rmul = 0.85,
	  ext = { -1.4, -1.4, 1.4, 1.45 }, colors = { 0x8B5CF6, 0xF0ABFC, 0x1E1035, 0x000000 } },
	{ name = "Halftone Shock (comic)", tech = "Halftone", dur = 0.7, rmul = 0.9,
	  ext = { -1.65, -1.65, 1.65, 1.65 }, colors = { 0xFFE14D, 0xFF3B30, 0x141414, 0xFF8A00 } },
}

-- Rows of ramps.png (Blender Color Ramp nodes) offered for the fire.
local FIRE_PALETTES = {
	{ "Classic fire", 0 }, { "Blue flame", 2 }, { "Violet flame", 3 }, { "Plasma", 1 },
}

local TEXTURES = {
	noise_tex = "noise.png", brush_tex = "brush.png", ramp_tex = "ramps.png",
	hud_tex = "hud.png", matcap_tex = "matcap.png",
}

local PARAM_NAMES = {
	"fx_quad", "fx_anim", "fx_shape", "fx_clip", "fx_col_a", "fx_col_b", "fx_col_c", "fx_col_d",
	"noise_tex", "brush_tex", "ramp_tex", "hud_tex", "matcap_tex",
}

local asset_dir = ""

---------------------------------------------------------------------------
-- Colours
---------------------------------------------------------------------------

-- 0xRRGGBB -> OBS colour (0xAABBGGRR), kept positive for obs_data.
local function obs_color(rgb)
	local r = bit.band(bit.rshift(rgb, 16), 0xff)
	local g = bit.band(bit.rshift(rgb, 8), 0xff)
	local b = bit.band(rgb, 0xff)
	return 0xFF000000 + b * 0x10000 + g * 0x100 + r
end

-- OBS colour -> r, g, b in 0..1 (straight).
local function from_obs_color(c)
	return bit.band(c, 0xff) / 255, bit.band(bit.rshift(c, 8), 0xff) / 255, bit.band(bit.rshift(c, 16), 0xff) / 255
end

local function from_rgb(rgb)
	return bit.band(bit.rshift(rgb, 16), 0xff) / 255, bit.band(bit.rshift(rgb, 8), 0xff) / 255, bit.band(rgb, 0xff) / 255
end

-- Style palettes as 0..1 triples, converted once.
for _, st in ipairs(STYLES) do
	st.rgb = {}
	for i, c in ipairs(st.colors) do st.rgb[i] = { from_rgb(c) } end
end

---------------------------------------------------------------------------
-- Win32: monitors and mouse
---------------------------------------------------------------------------

local function monitor_rect(hmon)
	if hmon == nil then return nil end
	local mi = ffi.new("PCFX_MONITORINFO")
	mi.cbSize = ffi.sizeof("PCFX_MONITORINFO")
	if user32.GetMonitorInfoW(hmon, mi) == 0 then return nil end
	local r = mi.rcMonitor
	return {
		x = r.left, y = r.top, w = r.right - r.left, h = r.bottom - r.top,
		primary = bit.band(mi.dwFlags, 1) ~= 0,
	}
end

local function enum_monitors()
	local list = {}
	local cb = ffi.cast("PCFX_MONITORENUMPROC", function(hmon)
		local m = monitor_rect(hmon)
		if m then list[#list + 1] = m end
		return 1
	end)
	user32.EnumDisplayMonitors(nil, nil, cb, 0)
	cb:free()
	if #list == 0 then
		list[1] = { x = 0, y = 0, w = user32.GetSystemMetrics(0), h = user32.GetSystemMetrics(1), primary = true }
	end
	return list
end
-- A C function that calls back into Lua must not be entered from a compiled trace.
jit.off(enum_monitors)

-- The monitor that now covers most of the given rectangle (survives resolution
-- changes and needs no callback, so it is safe to call every few seconds).
local function monitor_under(rect, fallback_primary)
	local r = ffi.new("PCFX_RECT", rect.x, rect.y, rect.x + math.max(rect.w, 1), rect.y + math.max(rect.h, 1))
	return monitor_rect(user32.MonitorFromRect(r, fallback_primary and MONITOR_DEFAULTTOPRIMARY or MONITOR_DEFAULTTONULL))
end

local function resolve_region(settings)
	local mode = obs.obs_data_get_int(settings, "monitor")
	if mode == MONITOR_CUSTOM then
		return {
			x = obs.obs_data_get_int(settings, "custom_x"),
			y = obs.obs_data_get_int(settings, "custom_y"),
			w = math.max(1, obs.obs_data_get_int(settings, "custom_w")),
			h = math.max(1, obs.obs_data_get_int(settings, "custom_h")),
			mode = mode,
		}
	end
	local mons = enum_monitors()
	local pick = mode >= 0 and mons[mode + 1] or nil
	if not pick then
		mode = MONITOR_PRIMARY
		for _, m in ipairs(mons) do
			if m.primary then pick = m end
		end
		pick = pick or mons[1]
	end
	pick.mode = mode
	return pick
end

-- Re-reads the monitor behind a region; nil when nothing changed.
local function refresh_region(region)
	local m
	if region.mode == MONITOR_PRIMARY then
		m = monitor_under({ x = 0, y = 0, w = 1, h = 1 }, true)   -- the primary monitor holds (0, 0)
	elseif region.mode >= 0 then
		m = monitor_under(region, false)
	end
	if m and (m.w ~= region.w or m.h ~= region.h or m.x ~= region.x or m.y ~= region.y) then
		m.mode = region.mode
		return m
	end
	return nil
end

-- Physical button for logical left / right / middle, honouring swapped buttons.
local function button_vk(index)
	local swapped = user32.GetSystemMetrics(SM_SWAPBUTTON) ~= 0
	if index == 1 then return swapped and VK_RBUTTON or VK_LBUTTON end
	if index == 2 then return swapped and VK_LBUTTON or VK_RBUTTON end
	return VK_MBUTTON
end

---------------------------------------------------------------------------
-- GPU resources, shared by every instance of the source
---------------------------------------------------------------------------

local gpu = { refs = 0, effect = nil, params = {}, textures = {}, images = {}, failed = false }

local function read_file(path)
	local f = io.open(path, "rb")
	if not f then return nil end
	local text = f:read("*a")
	f:close()
	return text
end

-- Call inside obs_enter_graphics(). Returns the texture, keeping the image
-- object alive when the gs_image_file path had to be used.
local function load_texture(name, path)
	if obs.gs_texture_create_from_file then
		return obs.gs_texture_create_from_file(path)
	end
	local img = obs.gs_image_file()
	obs.gs_image_file_init(img, path)
	if not img.loaded then return nil end
	obs.gs_image_file_init_texture(img)
	gpu.images[name] = img
	return img.texture
end

-- Call inside obs_enter_graphics().
local function gpu_acquire()
	gpu.refs = gpu.refs + 1
	if gpu.effect ~= nil or gpu.failed then return end

	local path = asset_dir .. "click_fx.effect"
	local text = read_file(path)
	if text then
		-- Compiled from text so editing the file and reloading the script picks it up.
		gpu.effect = obs.gs_effect_create(text, path, nil)
	else
		-- io.open cannot open some non-ASCII paths; libobs can.
		gpu.effect = obs.gs_effect_create_from_file(path, nil)
	end
	if gpu.effect == nil then
		gpu.failed = true
		obs.script_log(obs.LOG_ERROR, "Premium Click FX: could not compile " .. path .. " (details in the OBS log)")
		return
	end
	for _, name in ipairs(PARAM_NAMES) do
		gpu.params[name] = obs.gs_effect_get_param_by_name(gpu.effect, name)
	end
	for name, file in pairs(TEXTURES) do
		local tex = load_texture(name, asset_dir .. "textures/" .. file)
		if tex == nil then
			obs.script_log(obs.LOG_ERROR, "Premium Click FX: missing texture " .. file
				.. " - run tools/blender/generate_textures.py in Blender to rebuild it")
		end
		gpu.textures[name] = tex
	end
end

-- Call inside obs_enter_graphics().
local function gpu_free()
	for name, tex in pairs(gpu.textures) do
		if gpu.images[name] then
			obs.gs_image_file_free(gpu.images[name])
			gpu.images[name] = nil
		elseif tex ~= nil then
			obs.gs_texture_destroy(tex)
		end
		gpu.textures[name] = nil
	end
	if gpu.effect ~= nil then
		obs.gs_effect_destroy(gpu.effect)
		gpu.effect = nil
	end
	gpu.params = {}
	gpu.failed = false
end

local function gpu_release()
	gpu.refs = gpu.refs - 1
	if gpu.refs <= 0 then
		gpu.refs = 0
		gpu_free()
	end
end

---------------------------------------------------------------------------
-- Clicks
---------------------------------------------------------------------------

local function pick_style(d)
	if d.style == STYLE_RANDOM then
		local s = math.random(#STYLES)
		if s == d.last_style and #STYLES > 1 then s = s % #STYLES + 1 end
		d.last_style = s
		return s
	end
	if d.style == STYLE_CYCLE then
		d.cycle = d.cycle % #STYLES + 1
		return d.cycle
	end
	return math.max(1, math.min(#STYLES, d.style))
end

local function spawn(d, button, x, y, held)
	if x < 0 or y < 0 or x >= d.region.w or y >= d.region.h then return end
	local style = pick_style(d)
	local list = d.effects
	if #list >= MAX_EFFECTS then table.remove(list, 1) end
	list[#list + 1] = { style = style, x = x, y = y, t0 = d.time, seed = math.random(), button = button }
	if held and d.show_hold then
		d.hold = { style = style, x = x, y = y, t0 = d.time, seed = math.random(), button = button }
	end
end

local function poll_mouse(d)
	local pt = d.pt
	local have_pos = user32.GetCursorPos(pt) ~= 0
	local x, y = pt.x - d.region.x, pt.y - d.region.y
	for b = 1, 3 do
		local state = user32.GetAsyncKeyState(button_vk(b))
		local down = bit.band(state, 0x8000) ~= 0
		-- Bit 0: pressed since the last query. Catches taps shorter than a frame
		-- (best effort: another program polling the key can consume it).
		local tapped = bit.band(state, 0x0001) ~= 0
		local was = d.down[b]
		if have_pos and d.buttons[b] then
			if down and not was then
				spawn(d, b, x, y, true)
			elseif tapped and not down and not was then
				spawn(d, b, x, y, false)
			end
		end
		if was and not down and d.hold and d.hold.button == b and not d.hold.released then
			d.hold.released = d.time
		end
		d.down[b] = down
	end
	if have_pos and d.hold and not d.hold.released then
		d.hold.x, d.hold.y = x, y
	end
end

---------------------------------------------------------------------------
-- Source callbacks
---------------------------------------------------------------------------

local function radius(d, style)
	return d.region.h * BASE_RADIUS * d.size * STYLES[style].rmul
end

local function update(d, settings)
	d.region = resolve_region(settings)
	d.region_check = 0

	d.style = obs.obs_data_get_int(settings, "style")
	d.size = obs.obs_data_get_int(settings, "size") / 100
	d.speed = math.max(0.05, obs.obs_data_get_int(settings, "speed") / 100)
	d.opacity = obs.obs_data_get_int(settings, "opacity") / 100
	d.fire_row = obs.obs_data_get_int(settings, "fire_palette")
	d.custom_colors = obs.obs_data_get_bool(settings, "custom_colors")
	d.user_rgb = {
		{ from_obs_color(obs.obs_data_get_int(settings, "color_1")) },
		{ from_obs_color(obs.obs_data_get_int(settings, "color_2")) },
	}
	d.buttons = {
		obs.obs_data_get_bool(settings, "btn_left"),
		obs.obs_data_get_bool(settings, "btn_right"),
		obs.obs_data_get_bool(settings, "btn_middle"),
	}
	d.show_hold = obs.obs_data_get_bool(settings, "hold")
	if not d.show_hold then d.hold = nil end
end

local function create(settings, source)
	local d = {
		source = source,
		pt = ffi.new("PCFX_POINT"),
		v4 = obs.vec4(),
		effects = {},
		hold = nil,
		down = { false, false, false },
		time = 0,
		cycle = 0,
		last_style = 0,
	}
	obs.obs_enter_graphics()
	gpu_acquire()
	obs.obs_leave_graphics()
	update(d, settings)
	-- Prime the "pressed since last query" bits so a stale press is not replayed.
	for b = 1, 3 do user32.GetAsyncKeyState(button_vk(b)) end
	return d
end

local function destroy(d)
	obs.obs_enter_graphics()
	gpu_release()
	obs.obs_leave_graphics()
end

local function tick(d, seconds)
	local dt = math.min(math.max(seconds, 0), 0.25)
	d.time = d.time + dt

	-- Follow resolution changes of the chosen monitor.
	d.region_check = d.region_check + dt
	if d.region_check > REGION_REFRESH then
		d.region_check = 0
		d.region = refresh_region(d.region) or d.region
	end

	poll_mouse(d)

	local list, n = d.effects, 0
	for i = 1, #list do
		local fx = list[i]
		if (d.time - fx.t0) * d.speed < STYLES[fx.style].dur then
			n = n + 1
			list[n] = fx
		end
	end
	for i = #list, n + 1, -1 do list[i] = nil end

	local h = d.hold
	if h and h.released and d.time - h.released > HOLD_FADE_OUT then d.hold = nil end
end

local function set_vec4(d, name, x, y, z, w)
	local v = d.v4
	v.x, v.y, v.z, v.w = x, y, z, w
	obs.gs_effect_set_vec4(gpu.params[name], v)
end

-- Colour of one palette slot: the style default, or the user's colour for the
-- first two slots. A right click swaps primary and secondary.
local function slot_color(d, style, slot, button)
	if button == 2 and slot <= 2 then slot = 3 - slot end
	if d.custom_colors and slot <= 2 then
		return d.user_rgb[slot]
	end
	return STYLES[style].rgb[slot]
end

local COLOR_PARAMS = { "fx_col_a", "fx_col_b", "fx_col_c", "fx_col_d" }

local function set_colors(d, style, button)
	for slot = 1, 4 do
		local c = slot_color(d, style, slot, button)
		local flag = (slot == 1 and d.custom_colors) and 1 or 0
		set_vec4(d, COLOR_PARAMS[slot], c[1], c[2], c[3], flag)
	end
end

-- Every parameter is set before every gs_effect_loop: gs_technique_end clears
-- the current value of all effect parameters, textures included.
local function draw_quad(d, tech, style, x, y, ext, R, age, seed, opacity, button)
	local x0, y0 = ext[1] * R, ext[2] * R
	local w, h = math.ceil((ext[3] - ext[1]) * R), math.ceil((ext[4] - ext[2]) * R)
	if w < 1 or h < 1 then return end
	for name in pairs(TEXTURES) do
		local tex = gpu.textures[name]
		if tex ~= nil then obs.gs_effect_set_texture(gpu.params[name], tex) end
	end
	set_vec4(d, "fx_quad", x0, y0, w, h)
	set_vec4(d, "fx_anim", age, STYLES[style].dur, seed, 0)
	set_vec4(d, "fx_shape", R, opacity, d.fire_row, style - 1)
	set_vec4(d, "fx_clip", x, y, d.region.w, d.region.h)
	set_colors(d, style, button)
	obs.gs_matrix_push()
	obs.gs_matrix_translate3f(x + x0, y + y0, 0)
	while obs.gs_effect_loop(gpu.effect, tech) do
		obs.gs_draw_sprite(nil, 0, w, h)
	end
	obs.gs_matrix_pop()
end

local function render(d)
	if gpu.effect == nil or d.opacity <= 0 then return end
	if #d.effects == 0 and d.hold == nil then return end

	-- The shader outputs premultiplied alpha; rgb above alpha is emitted light.
	obs.gs_blend_state_push()
	obs.gs_blend_function(obs.GS_BLEND_ONE, obs.GS_BLEND_INVSRCALPHA)

	local h = d.hold
	if h then
		local held = (h.released or d.time) - h.t0
		local a = math.min(1, math.max(0, (held - HOLD_DELAY) / HOLD_FADE_IN))
		if h.released then a = a * math.max(0, 1 - (d.time - h.released) / HOLD_FADE_OUT) end
		if a > 0.001 then
			draw_quad(d, "Hold", h.style, h.x, h.y, HOLD_EXT, radius(d, h.style),
				math.max(0, held - HOLD_DELAY) * d.speed, h.seed, a * d.opacity, h.button)
		end
	end

	for _, fx in ipairs(d.effects) do
		local st = STYLES[fx.style]
		draw_quad(d, st.tech, fx.style, fx.x, fx.y, st.ext, radius(d, fx.style),
			(d.time - fx.t0) * d.speed, fx.seed, d.opacity, fx.button)
	end

	obs.gs_blend_state_pop()
end

local function get_defaults(settings)
	obs.obs_data_set_default_int(settings, "monitor", MONITOR_PRIMARY)
	obs.obs_data_set_default_int(settings, "custom_x", 0)
	obs.obs_data_set_default_int(settings, "custom_y", 0)
	obs.obs_data_set_default_int(settings, "custom_w", 1920)
	obs.obs_data_set_default_int(settings, "custom_h", 1080)

	obs.obs_data_set_default_int(settings, "style", 1)
	obs.obs_data_set_default_int(settings, "size", 100)
	obs.obs_data_set_default_int(settings, "speed", 100)
	obs.obs_data_set_default_int(settings, "opacity", 100)
	obs.obs_data_set_default_int(settings, "fire_palette", 0)
	obs.obs_data_set_default_bool(settings, "custom_colors", false)
	obs.obs_data_set_default_int(settings, "color_1", obs_color(0x00E5FF))
	obs.obs_data_set_default_int(settings, "color_2", obs_color(0xFF2D95))

	obs.obs_data_set_default_bool(settings, "btn_left", true)
	obs.obs_data_set_default_bool(settings, "btn_right", false)
	obs.obs_data_set_default_bool(settings, "btn_middle", false)
	obs.obs_data_set_default_bool(settings, "hold", true)
end

local CUSTOM_KEYS = { "custom_x", "custom_y", "custom_w", "custom_h" }

local function on_monitor_changed(props, _, settings)
	local custom = obs.obs_data_get_int(settings, "monitor") == MONITOR_CUSTOM
	for _, key in ipairs(CUSTOM_KEYS) do
		obs.obs_property_set_visible(obs.obs_properties_get(props, key), custom)
	end
	return true
end

local function on_custom_colors_changed(props, _, settings)
	local on = obs.obs_data_get_bool(settings, "custom_colors")
	obs.obs_property_set_visible(obs.obs_properties_get(props, "color_1"), on)
	obs.obs_property_set_visible(obs.obs_properties_get(props, "color_2"), on)
	return true
end

local function get_properties(d)
	local props = obs.obs_properties_create()

	-- Effect
	local look = obs.obs_properties_create()
	local style = obs.obs_properties_add_list(look, "style", "Style",
		obs.OBS_COMBO_TYPE_LIST, obs.OBS_COMBO_FORMAT_INT)
	for i, st in ipairs(STYLES) do
		obs.obs_property_list_add_int(style, st.name, i)
	end
	obs.obs_property_list_add_int(style, "Random (per click)", STYLE_RANDOM)
	obs.obs_property_list_add_int(style, "Cycle through all", STYLE_CYCLE)
	local size = obs.obs_properties_add_int_slider(look, "size", "Size (%)", 25, 300, 5)
	obs.obs_property_set_long_description(size,
		"100 % gives an effect radius of 6.5 % of the capture height (94 px at 1440p).")
	obs.obs_properties_add_int_slider(look, "speed", "Speed (%)", 25, 300, 5)
	obs.obs_properties_add_int_slider(look, "opacity", "Opacity (%)", 0, 100, 1)
	local fire = obs.obs_properties_add_list(look, "fire_palette", "Fire palette",
		obs.OBS_COMBO_TYPE_LIST, obs.OBS_COMBO_FORMAT_INT)
	for _, p in ipairs(FIRE_PALETTES) do
		obs.obs_property_list_add_int(fire, p[1], p[2])
	end
	local custom = obs.obs_properties_add_bool(look, "custom_colors", "Use custom colours")
	obs.obs_property_set_long_description(custom,
		"Replaces the style's primary and secondary colours. For the fire they become the flame and ember colours.")
	obs.obs_property_set_modified_callback(custom, on_custom_colors_changed)
	obs.obs_properties_add_color(look, "color_1", "Primary colour")
	obs.obs_properties_add_color(look, "color_2", "Secondary colour")
	obs.obs_properties_add_group(props, "grp_look", "Effect", obs.OBS_GROUP_NORMAL, look)

	-- Mouse buttons
	local mouse = obs.obs_properties_create()
	obs.obs_properties_add_bool(mouse, "btn_left", "Left button")
	local right = obs.obs_properties_add_bool(mouse, "btn_right", "Right button (swaps primary and secondary colours)")
	obs.obs_property_set_long_description(right, "Right clicks use the same style with the two main colours swapped.")
	obs.obs_properties_add_bool(mouse, "btn_middle", "Middle button")
	obs.obs_properties_add_bool(mouse, "hold", "Show an indicator while a button is held")
	obs.obs_properties_add_group(props, "grp_mouse", "Mouse buttons", obs.OBS_GROUP_NORMAL, mouse)

	-- Capture area
	local area = obs.obs_properties_create()
	local mon = obs.obs_properties_add_list(area, "monitor", "Monitor",
		obs.OBS_COMBO_TYPE_LIST, obs.OBS_COMBO_FORMAT_INT)
	obs.obs_property_list_add_int(mon, "Primary monitor", MONITOR_PRIMARY)
	for i, m in ipairs(enum_monitors()) do
		local label = string.format("Monitor %d: %dx%d at (%d, %d)%s",
			i, m.w, m.h, m.x, m.y, m.primary and " [primary]" or "")
		obs.obs_property_list_add_int(mon, label, i - 1)
	end
	obs.obs_property_list_add_int(mon, "Custom region", MONITOR_CUSTOM)
	obs.obs_property_set_modified_callback(mon, on_monitor_changed)
	obs.obs_properties_add_int(area, "custom_x", "Region X", -32768, 32768, 1)
	obs.obs_properties_add_int(area, "custom_y", "Region Y", -32768, 32768, 1)
	obs.obs_properties_add_int(area, "custom_w", "Region width", 1, 32768, 1)
	obs.obs_properties_add_int(area, "custom_h", "Region height", 1, 32768, 1)
	obs.obs_properties_add_group(props, "grp_area", "Capture area", obs.OBS_GROUP_NORMAL, area)

	if d then
		obs.obs_properties_add_button(props, "test", "Preview a click in the centre", function()
			spawn(d, 1, d.region.w / 2, d.region.h / 2, false)
			return false
		end)
	end
	return props
end

local source_def = {
	id = SOURCE_ID,
	type = obs.OBS_SOURCE_TYPE_INPUT,
	output_flags = bit.bor(obs.OBS_SOURCE_VIDEO, obs.OBS_SOURCE_CUSTOM_DRAW),
	get_name = function() return "Premium Click FX" end,
	create = create,
	destroy = destroy,
	update = update,
	get_defaults = get_defaults,
	get_properties = get_properties,
	get_width = function(d) return d.region.w end,
	get_height = function(d) return d.region.h end,
	video_tick = tick,
	video_render = render,
}

function script_description()
	return [[<h3>Premium Click FX</h3>
<p>Adds a <b>Premium Click FX</b> source that turns mouse clicks into shader
motion graphics: Ink Spiral, Sci-Fi Pulse, Inferno Burst, MoGraph Pop,
Liquid Splash and Halftone Shock, with a matching hold indicator.</p>
<p>Put it above your Display Capture, then right-click the Display Capture,
<i>Transform &rarr; Copy Transform</i>, and paste it onto this source. Pick the
same monitor in both.</p>]]
end

function script_load()
	asset_dir = script_path() .. "premium_click_fx/"
	math.randomseed(os.time())
	obs.obs_register_source(source_def)
end

function script_unload()
	obs.obs_enter_graphics()
	gpu_free()
	obs.obs_leave_graphics()
end
