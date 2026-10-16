--[[
  Exercises premium_click_fx.lua outside OBS: real LuaJIT + FFI, a scripted
  user32 (mouse, monitors) and a recording obslua stub that mimics libobs'
  effect parameter lifetime. Run with:  python tools/run_lua.py tools/test_script.lua
]]

local here = debug.getinfo(1, "S").source:sub(2):gsub("\\", "/")
local REPO = here:match("(.*/)tools/") or "./"
local real_ffi = require("ffi")

---------------------------------------------------------------------------
-- Scripted Win32
---------------------------------------------------------------------------

local mouse = { x = 0, y = 0, down = {}, taps = {}, swap = false }
local monitors = {
	{ left = 0, top = 0, right = 2560, bottom = 1440, primary = true },
	{ left = -1280, top = -720, right = 0, bottom = 0, primary = false },
}

local user32 = {}
function user32.GetCursorPos(pt) pt.x, pt.y = mouse.x, mouse.y return 1 end
function user32.GetAsyncKeyState(vk)
	local s = mouse.down[vk] and -32767 or 0
	if mouse.taps[vk] then s = bit.bor(s, 1) mouse.taps[vk] = nil end
	return s
end
function user32.GetSystemMetrics(i)
	if i == 0 then return monitors[1].right - monitors[1].left end
	if i == 1 then return monitors[1].bottom - monitors[1].top end
	if i == 23 then return mouse.swap and 1 or 0 end
	return 0
end
function user32.EnumDisplayMonitors(_, _, cb, _)
	for i = 1, #monitors do cb(real_ffi.cast("void *", i), nil, nil, 0) end
	return 1
end
function user32.GetMonitorInfoW(h, mi)
	local m = monitors[tonumber(real_ffi.cast("intptr_t", h))]
	if not m then return 0 end
	mi.rcMonitor.left, mi.rcMonitor.top, mi.rcMonitor.right, mi.rcMonitor.bottom = m.left, m.top, m.right, m.bottom
	mi.dwFlags = m.primary and 1 or 0
	return 1
end
function user32.MonitorFromRect(r, flags)
	local best, area = nil, 0
	for i, m in ipairs(monitors) do
		local w = math.min(r.right, m.right) - math.max(r.left, m.left)
		local h = math.min(r.bottom, m.bottom) - math.max(r.top, m.top)
		if w > 0 and h > 0 and w * h > area then best, area = i, w * h end
	end
	if not best and flags == 1 then
		for i, m in ipairs(monitors) do if m.primary then best = i end end
	end
	return best and real_ffi.cast("void *", best) or nil
end

package.loaded.ffi = setmetatable({
	load = function(name) assert(name == "user32", name) return user32 end,
}, { __index = real_ffi })

---------------------------------------------------------------------------
-- Recording obslua
---------------------------------------------------------------------------

local obs = {}
local registered, logs, draws, destroyed = nil, {}, {}, {}
local gfx, cur, loop_tech, tx, ty, blend = 0, {}, nil, 0, 0, nil
local mstack = {}

obs.LOG_ERROR, obs.LOG_WARNING, obs.LOG_INFO = 100, 200, 300
obs.OBS_SOURCE_TYPE_INPUT, obs.OBS_SOURCE_VIDEO, obs.OBS_SOURCE_CUSTOM_DRAW = 0, 1, 8
obs.OBS_COMBO_TYPE_LIST, obs.OBS_COMBO_FORMAT_INT, obs.OBS_GROUP_NORMAL = 2, 1, 1
obs.GS_BLEND_ONE, obs.GS_BLEND_INVSRCALPHA = 1, 5

function obs.script_log(_, msg) logs[#logs + 1] = msg print("    [script_log] " .. msg) end
function obs.obs_register_source(def) registered = def end

local function dget(s, k) local v = s.values[k] if v == nil then v = s.defaults[k] end return v end
function obs.obs_data_get_int(s, k) return dget(s, k) or 0 end
function obs.obs_data_get_double(s, k) return dget(s, k) or 0 end
function obs.obs_data_get_bool(s, k) return dget(s, k) == true end
function obs.obs_data_set_default_int(s, k, v) s.defaults[k] = v end
function obs.obs_data_set_default_double(s, k, v) s.defaults[k] = v end
function obs.obs_data_set_default_bool(s, k, v) s.defaults[k] = v end

function obs.obs_enter_graphics() gfx = gfx + 1 end
function obs.obs_leave_graphics() gfx = gfx - 1 end
function obs.gs_effect_create(text, path)
	assert(gfx > 0, "gs_effect_create outside graphics")
	return { text = text, path = path }
end
function obs.gs_effect_create_from_file(path)
	local f = assert(io.open(path, "rb")) local t = f:read("*a") f:close()
	return obs.gs_effect_create(t, path)
end
function obs.gs_effect_destroy() end
function obs.gs_effect_get_param_by_name(e, name)
	assert(e.text:find("uniform%s+[%w_]+%s+" .. name .. "%s*;"), "effect has no uniform " .. name)
	return { name = name }
end
function obs.gs_texture_create_from_file(path)
	assert(gfx > 0, "texture created outside graphics")
	local f = io.open(path, "rb")
	if not f then return nil end
	f:close()
	return { path = path }
end
function obs.gs_texture_destroy(t) assert(gfx > 0) destroyed[#destroyed + 1] = t end
function obs.vec4() return { x = 0, y = 0, z = 0, w = 0 } end
function obs.gs_effect_set_vec4(p, v) cur[p.name] = { v.x, v.y, v.z, v.w } end
function obs.gs_effect_set_texture(p, t) cur[p.name] = t end
function obs.gs_blend_state_push() blend = "pushed" end
function obs.gs_blend_state_pop() blend = nil end
function obs.gs_blend_function(s, d) blend = { s, d } end
function obs.gs_matrix_push() mstack[#mstack + 1] = { tx, ty } end
function obs.gs_matrix_pop() local m = table.remove(mstack) tx, ty = m[1], m[2] end
function obs.gs_matrix_translate3f(x, y) tx, ty = tx + x, ty + y end
-- Like libobs: the loop runs one pass; gs_technique_end then clears every
-- parameter's current value.
function obs.gs_effect_loop(e, tech)
	if loop_tech == nil then
		assert(e.text:find("technique%s+" .. tech .. "%s"), "no technique " .. tech)
		loop_tech = tech
		return true
	end
	loop_tech, cur = nil, {}
	return false
end
function obs.gs_draw_sprite(tex, flip, w, h)
	assert(tex == nil and w >= 1 and h >= 1 and w == math.floor(w) and h == math.floor(h), "bad sprite size")
	local p = {}
	for k, v in pairs(cur) do p[k] = v end
	draws[#draws + 1] = { tech = loop_tech, x = tx, y = ty, w = w, h = h, p = p, blend = blend }
end

local function new_props() return { items = {} } end
local function add(props, prop) props.items[#props.items + 1] = prop return prop end
function obs.obs_properties_create() return new_props() end
function obs.obs_properties_add_list(props, name) return add(props, { name = name, list = {} }) end
function obs.obs_property_list_add_int(p, label, v) p.list[#p.list + 1] = { label, v } end
function obs.obs_properties_add_int_slider(props, name) return add(props, { name = name }) end
function obs.obs_properties_add_int(props, name) return add(props, { name = name }) end
function obs.obs_properties_add_bool(props, name) return add(props, { name = name }) end
function obs.obs_properties_add_color(props, name) return add(props, { name = name }) end
function obs.obs_properties_add_button(props, name, _, cb) return add(props, { name = name, button = cb }) end
function obs.obs_properties_add_group(props, name, _, _, group) return add(props, { name = name, group = group }) end
function obs.obs_property_set_long_description(p, text) p.long = text end
function obs.obs_property_set_modified_callback(p, cb) p.modified = cb end
function obs.obs_property_set_visible(p, v) p.visible = v end
function obs.obs_properties_get(props, key)
	for _, p in ipairs(props.items) do
		if p.name == key then return p end
		if p.group then local q = obs.obs_properties_get(p.group, key) if q then return q end end
	end
end

obslua = obs
function script_path() return REPO end

---------------------------------------------------------------------------
-- Test helpers
---------------------------------------------------------------------------

local failures, checks = 0, 0
local function check(cond, what)
	checks = checks + 1
	if not cond then failures = failures + 1 print("  FAIL: " .. what) end
end
local function near(a, b, eps) return math.abs(a - b) <= (eps or 1e-3) end

dofile(REPO .. "premium_click_fx.lua")
script_load()
check(registered and registered.id == "premium_click_fx", "source registered")

local settings = { values = {}, defaults = {} }
registered.get_defaults(settings)
local d = registered.create(settings, {})
check(gfx == 0, "graphics context balanced after create")
check(#logs == 0, "no errors while loading assets")

local function frames(n)
	for _ = 1, n do
		registered.video_tick(d, 1 / 60)
		draws = {}
		registered.video_render(d, nil)
	end
	return draws
end
local function find(tech)
	for _, dr in ipairs(draws) do if dr.tech == tech then return dr end end
end
local function hex_rgb(c) return bit.band(bit.rshift(c, 16), 255) / 255, bit.band(bit.rshift(c, 8), 255) / 255, bit.band(c, 255) / 255 end

print("size and idle")
check(registered.get_width(d) == 2560 and registered.get_height(d) == 1440, "primary monitor size")
mouse.x, mouse.y = 1000, 600
check(#frames(3) == 0, "nothing drawn while idle")

print("press, hold, drag, release")
mouse.down[0x01] = true
frames(1)
local ink = find("Ink")
local R = 1440 * 0.065
check(ink ~= nil, "Ink effect on press")
if ink then
	check(near(ink.p.fx_shape[1], R), "radius from area height")
	check(near(ink.x, 1000 - 1.5 * R) and near(ink.y, 600 - 1.5 * R), "quad placed around the click")
	check(ink.w == math.ceil(3 * R) and ink.h == math.ceil(3 * R), "quad size")
	check(near(ink.p.fx_clip[1], 1000) and near(ink.p.fx_clip[3], 2560) and near(ink.p.fx_clip[4], 1440), "clip uniform")
	check(near(ink.p.fx_anim[2], 1.25), "duration uniform")
	check(type(ink.blend) == "table" and ink.blend[1] == 1 and ink.blend[2] == 5, "premultiplied blend while drawing")
	local r, g, b = hex_rgb(0xFF4136)
	check(near(ink.p.fx_col_a[1], r) and near(ink.p.fx_col_a[2], g) and near(ink.p.fx_col_a[3], b) and ink.p.fx_col_a[4] == 0,
		"style colours")
end
check(find("Hold") == nil, "no hold indicator right away")
frames(9)
local hold = find("Hold")
check(hold ~= nil, "hold indicator after 0.12 s")
mouse.x = 1200
frames(1)
hold = find("Hold")
check(hold and near(hold.x, 1200 - 0.8 * R), "hold follows the cursor")
for _, dr in ipairs(draws) do
	for _, t in ipairs({ "noise_tex", "brush_tex", "ramp_tex", "hud_tex", "matcap_tex" }) do
		check(dr.p[t] ~= nil, dr.tech .. " draw has " .. t)
	end
end
mouse.down[0x01] = false
frames(1)
check(find("Hold") ~= nil, "hold fades out after release")
frames(12)
check(find("Hold") == nil, "hold gone after the fade")
frames(70)
check(#draws == 0, "effects expire")

print("quick tap between polls")
mouse.x, mouse.y = 300, 300
mouse.taps[0x01] = true
frames(1)
check(find("Ink") ~= nil, "tap spawns an effect")
frames(20)
check(find("Hold") == nil, "a tap shows no hold indicator")
frames(80)

print("buttons")
mouse.down[0x02] = true
frames(1)
check(#draws == 0, "right button off by default")
mouse.down[0x02] = false
frames(1)
settings.values.btn_right = true
registered.update(d, settings)
mouse.down[0x02] = true
frames(1)
local rc = find("Ink")
local r2, g2 = hex_rgb(0xFFB3A7)
check(rc and near(rc.p.fx_col_a[1], r2) and near(rc.p.fx_col_a[2], g2), "right click swaps colours")
mouse.down[0x02] = false
frames(90)
mouse.swap = true
settings.values.btn_right = false
registered.update(d, settings)
mouse.down[0x02] = true
frames(1)
check(find("Ink") ~= nil, "swapped buttons: physical right is logical left")
mouse.down[0x02] = false
mouse.swap = false
frames(90)

print("outside the area")
mouse.x, mouse.y = -500, -300
mouse.down[0x01] = true
frames(1)
check(#draws == 0, "click on another monitor ignored")
mouse.down[0x01] = false
frames(1)

print("styles")
settings.values.style = -2
registered.update(d, settings)
local seen = {}
for i = 1, 6 do
	mouse.x, mouse.y = 400 + i * 200, 700
	mouse.down[0x01] = true frames(1)
	mouse.down[0x01] = false frames(1)
	for _, dr in ipairs(draws) do seen[dr.tech] = true end
end
for _, t in ipairs({ "Ink", "SciFi", "Fire", "Pop", "Liquid", "Halftone" }) do
	check(seen[t], "cycle reaches " .. t)
end
frames(120)
settings.values.style = 3
settings.values.custom_colors = true
settings.values.fire_palette = 2
settings.values.color_1 = 0xFF0000FF   -- red in OBS 0xAABBGGRR
registered.update(d, settings)
mouse.down[0x01] = true frames(1) mouse.down[0x01] = false
local fire = find("Fire")
check(fire and fire.p.fx_col_a[4] == 1 and near(fire.p.fx_col_a[1], 1) and near(fire.p.fx_col_a[3], 0), "custom colour flag and value")
check(fire and fire.p.fx_shape[3] == 2, "fire palette row")
check(fire and near(fire.h, math.ceil(3.5 * R * 0.95)), "fire quad is taller (rises)")
frames(120)
settings.values.custom_colors = false
settings.values.style = 1

print("effect cap")
settings.values.style = 4
registered.update(d, settings)
for i = 1, 40 do
	mouse.x, mouse.y = 50 + i * 40, 500
	mouse.taps[0x01] = true
	frames(1)
end
check(#draws <= 24, "at most 24 effects drawn")
frames(120)

print("size, speed and opacity")
settings.values.size, settings.values.speed, settings.values.opacity = 200, 50, 40
registered.update(d, settings)
mouse.x, mouse.y = 1280, 720
mouse.down[0x01] = true frames(1) mouse.down[0x01] = false
local pop = find("Pop")
check(pop and near(pop.p.fx_shape[1], R * 2 * 0.9) and near(pop.p.fx_shape[2], 0.4), "size and opacity")
frames(60)
pop = find("Pop")
check(pop and near(pop.p.fx_anim[1], 0.5 * 61 / 60, 0.02), "half speed ages at half rate")
frames(120)
settings.values.size, settings.values.speed, settings.values.opacity = 100, 100, 100

print("properties")
local props = registered.get_properties(d)
local style_list = obs.obs_properties_get(props, "style")
check(style_list and #style_list.list == 8, "6 styles + random + cycle")
local mon_list = obs.obs_properties_get(props, "monitor")
check(mon_list and #mon_list.list == 4, "primary, 2 monitors, custom")
settings.values.monitor = -1
mon_list.modified(props, mon_list, settings)
check(obs.obs_properties_get(props, "custom_w").visible == true, "custom region fields shown")
local test = obs.obs_properties_get(props, "test")
settings.values.monitor = nil
registered.update(d, settings)
test.button(props, test)
frames(1)
local centre = draws[1]
check(centre and near(centre.p.fx_clip[1], 1280) and near(centre.p.fx_clip[2], 720), "preview button clicks the centre")
frames(120)
check(registered.get_properties(nil) ~= nil, "properties without an instance")

print("monitor choice and resolution change")
settings.values.monitor = 1
registered.update(d, settings)
check(registered.get_width(d) == 1280 and registered.get_height(d) == 720, "second monitor size")
mouse.x, mouse.y = -640, -360
mouse.down[0x01] = true frames(1) mouse.down[0x01] = false
local m2 = draws[1]
check(m2 and near(m2.p.fx_clip[1], 640) and near(m2.p.fx_clip[2], 360), "coordinates relative to the monitor")
frames(120)
settings.values.monitor = nil
registered.update(d, settings)
monitors[1].right, monitors[1].bottom = 3840, 2160
frames(150)
check(registered.get_width(d) == 3840 and registered.get_height(d) == 2160, "follows a resolution change")

print("teardown")
registered.destroy(d)
script_unload()
check(#destroyed == 5, "all five textures destroyed")
check(gfx == 0, "graphics context balanced")

print(string.format("%d checks, %d failures", checks, failures))
io.stdout:flush()
if failures > 0 then error("tests failed") end
