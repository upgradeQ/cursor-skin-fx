--[[
  Browser Cursor — OBS Studio Lua script (Windows)

  Reads the system mouse every frame and dispatches it into a chosen Browser
  source as an "obs-cursor" CustomEvent on window, so a transparent web page
  can draw cursor effects that line up with a Display Capture of the same
  monitor.

  Event detail (JSON):
    x, y      position in source pixels (the source's width/height mapped onto the monitor)
    nx, ny    position normalised to the captured monitor, 0..1
    buttons   bitmask as in MouseEvent.buttons: 1 left, 2 right, 4 middle, 8 back, 16 forward
    cursor    CSS keyword of the system cursor shape: default, pointer, text, wait, progress,
              crosshair, move, help, not-allowed, ew-resize, ns-resize, nwse-resize, nesw-resize
    visible   false while the cursor is hidden (for over 150 ms) or off the captured monitor
    t         OBS clock in milliseconds

  An event is sent whenever any of these change, and at least every 0.5 s.
]]

local obs = obslua
local ffi = require("ffi")
local bit = require("bit")

pcall(ffi.cdef, [[
typedef struct { int32_t x; int32_t y; } BC_POINT;
typedef struct { int32_t left; int32_t top; int32_t right; int32_t bottom; } BC_RECT;
typedef struct { uint32_t cbSize; uint32_t flags; void *hCursor; BC_POINT ptScreenPos; } BC_CURSORINFO;
typedef struct { uint32_t cbSize; BC_RECT rcMonitor; BC_RECT rcWork; uint32_t dwFlags; uint16_t szDevice[32]; } BC_MONITORINFOEXW;
typedef int (__stdcall *BC_MONITORENUMPROC)(void *, void *, BC_RECT *, intptr_t);
int   __stdcall GetCursorInfo(BC_CURSORINFO *pci);
void *__stdcall LoadCursorW(void *hInstance, const void *lpCursorName);
short __stdcall GetAsyncKeyState(int vKey);
int   __stdcall EnumDisplayMonitors(void *hdc, const BC_RECT *lprcClip, BC_MONITORENUMPROC lpfnEnum, intptr_t dwData);
int   __stdcall GetMonitorInfoW(void *hMonitor, BC_MONITORINFOEXW *lpmi);
int   __stdcall GetSystemMetrics(int nIndex);
]])

local user32 = ffi.load("user32")

local EVENT_NAME = "obs-cursor"
local KEEPALIVE_NS = 500000000
local RETRY_NS = 1000000000
local DISPLAY_CHECK_NS = 1000000000
-- Some apps clear the cursor and set it again every frame, so a hidden cursor
-- only counts once it has stayed hidden this long.
local HIDE_GRACE_NS = 150000000

local MONITOR_PRIMARY, MONITOR_CUSTOM = "primary", "custom"

local SM_SWAPBUTTON = 23
local CURSOR_SHOWING = 1
-- Monitor count and virtual screen bounds: any display change alters one of them.
local DISPLAY_METRICS = { 80, 76, 77, 78, 79 }

-- System cursor resource ids and the CSS keyword reported for each.
local CURSOR_IDS = {
	{ 32512, "default" },     -- IDC_ARROW
	{ 32513, "text" },        -- IDC_IBEAM
	{ 32514, "wait" },        -- IDC_WAIT
	{ 32515, "crosshair" },   -- IDC_CROSS
	{ 32516, "default" },     -- IDC_UPARROW
	{ 32642, "nwse-resize" }, -- IDC_SIZENWSE
	{ 32643, "nesw-resize" }, -- IDC_SIZENESW
	{ 32644, "ew-resize" },   -- IDC_SIZEWE
	{ 32645, "ns-resize" },   -- IDC_SIZENS
	{ 32646, "move" },        -- IDC_SIZEALL
	{ 32648, "not-allowed" }, -- IDC_NO
	{ 32649, "pointer" },     -- IDC_HAND
	{ 32650, "progress" },    -- IDC_APPSTARTING
	{ 32651, "help" },        -- IDC_HELP
}

local state = {
	settings = nil,
	source_uuid = "",
	weak = nil,             -- weak reference to the target browser source
	retry_at = 0,
	logged_uuid = nil,
	region = { x = 0, y = 0, w = 1920, h = 1080 },
	display_key = nil,      -- DISPLAY_METRICS snapshot the region was resolved with
	display_checked = 0,
	ci = ffi.new("BC_CURSORINFO"),
	cursor_names = {},      -- cursor handle (as a number) -> CSS keyword
	last = nil,             -- last dispatched state
	last_sent = 0,
	hidden_since = nil,     -- when the system cursor was last seen hidden, while still reported shown
}

---------------------------------------------------------------------------
-- Win32 helpers
---------------------------------------------------------------------------

local function handle_key(h)
	return tonumber(ffi.cast("intptr_t", h))
end

local function load_cursor_names()
	local names = {}
	for _, entry in ipairs(CURSOR_IDS) do
		local h = user32.LoadCursorW(nil, ffi.cast("const void *", entry[1]))
		if h ~= nil then names[handle_key(h)] = entry[2] end
	end
	return names
end

-- Device names (\\.\DISPLAY1, ...) are ASCII.
local function device_name(wide)
	local chars = {}
	for i = 0, 31 do
		if wide[i] == 0 then break end
		chars[#chars + 1] = string.char(bit.band(wide[i], 0x7f))
	end
	return table.concat(chars)
end

local function enum_monitors()
	local list = {}
	local cb = ffi.cast("BC_MONITORENUMPROC", function(hmon)
		local mi = ffi.new("BC_MONITORINFOEXW")
		mi.cbSize = ffi.sizeof("BC_MONITORINFOEXW")
		if user32.GetMonitorInfoW(hmon, mi) ~= 0 then
			local r = mi.rcMonitor
			list[#list + 1] = {
				x = r.left, y = r.top,
				w = r.right - r.left, h = r.bottom - r.top,
				primary = bit.band(mi.dwFlags, 1) ~= 0,
				device = device_name(mi.szDevice),
			}
		end
		return 1
	end)
	user32.EnumDisplayMonitors(nil, nil, cb, 0)
	cb:free()
	if #list == 0 then
		list[1] = { x = 0, y = 0, w = user32.GetSystemMetrics(0), h = user32.GetSystemMetrics(1), primary = true, device = "" }
	end
	return list
end
-- A C function that calls back into Lua must not be called from JIT-compiled code.
jit.off(enum_monitors, true)

local function resolve_region(settings)
	local mode = obs.obs_data_get_string(settings, "monitor")
	if mode == MONITOR_CUSTOM then
		return {
			x = obs.obs_data_get_int(settings, "custom_x"),
			y = obs.obs_data_get_int(settings, "custom_y"),
			w = math.max(1, obs.obs_data_get_int(settings, "custom_w")),
			h = math.max(1, obs.obs_data_get_int(settings, "custom_h")),
		}
	end
	local mons = enum_monitors()
	for _, m in ipairs(mons) do
		if m.device == mode then return m end
	end
	for _, m in ipairs(mons) do
		if m.primary then return m end
	end
	return mons[1]
end

local function display_key()
	local parts = {}
	for i, metric in ipairs(DISPLAY_METRICS) do
		parts[i] = user32.GetSystemMetrics(metric)
	end
	return table.concat(parts, ",")
end

local function update_region()
	state.region = resolve_region(state.settings)
	state.display_key = display_key()
	state.last = nil
end

-- Follows resolution changes, monitor rearrangement and hotplug, as Display Capture does.
local function check_display(now)
	if now - state.display_checked < DISPLAY_CHECK_NS then return end
	state.display_checked = now
	if display_key() ~= state.display_key then update_region() end
end

-- Also counts a press and release that both happened since the previous
-- frame (touchpad taps), via the "pressed since last call" bit.
local function key_down(vk)
	return bit.band(user32.GetAsyncKeyState(vk), 0x8001) ~= 0
end

-- GetAsyncKeyState reports physical buttons; swap them back for left-handed setups.
local function read_buttons()
	local left, right = key_down(0x01), key_down(0x02)
	if user32.GetSystemMetrics(SM_SWAPBUTTON) ~= 0 then
		left, right = right, left
	end
	local b = 0
	if left then b = b + 1 end
	if right then b = b + 2 end
	if key_down(0x04) then b = b + 4 end
	if key_down(0x05) then b = b + 8 end
	if key_down(0x06) then b = b + 16 end
	return b
end

---------------------------------------------------------------------------
-- Target source
---------------------------------------------------------------------------

local function drop_target()
	if state.weak ~= nil then
		obs.obs_weak_source_release(state.weak)
		state.weak = nil
	end
	state.retry_at = 0
	state.last = nil
end

-- Returns a strong reference to the target source (caller releases it) or nil.
-- The source may not exist yet when the script loads before the scene
-- collection, so lookups are retried once per second.
local function target_source()
	if state.weak ~= nil then
		local src = obs.obs_weak_source_get_source(state.weak)
		if src ~= nil then
			if not obs.obs_source_removed(src) then return src end
			obs.obs_source_release(src)
		end
		drop_target()
	end

	local now = obs.os_gettime_ns()
	if state.source_uuid == "" or now < state.retry_at then return nil end
	state.retry_at = now + RETRY_NS

	local src = obs.obs_get_source_by_uuid(state.source_uuid)
	if src == nil then return nil end
	state.weak = obs.obs_source_get_weak_source(src)
	if state.logged_uuid ~= state.source_uuid then
		state.logged_uuid = state.source_uuid
		obs.script_log(obs.LOG_INFO, string.format("dispatching mouse to '%s'", obs.obs_source_get_name(src)))
	end
	return src
end

local function dispatch(src, json)
	local cd = obs.calldata_create()
	obs.calldata_set_string(cd, "eventName", EVENT_NAME)
	obs.calldata_set_string(cd, "jsonString", json)
	obs.proc_handler_call(obs.obs_source_get_proc_handler(src), "javascript_event", cd)
	obs.calldata_destroy(cd)
end

---------------------------------------------------------------------------
-- Polling
---------------------------------------------------------------------------


local function poll(buttons, now)
	local ci = state.ci
	ci.cbSize = ffi.sizeof("BC_CURSORINFO")
	local r = state.region
	local last = state.last
	if user32.GetCursorInfo(ci) == 0 then
		-- Secure desktop (UAC prompt, lock screen): no cursor to follow.
		return { rx = last and last.rx or 0, ry = last and last.ry or 0, buttons = 0, cursor = "default", visible = false, shown = false }
	end
	local rx = ci.ptScreenPos.x - r.x
	local ry = ci.ptScreenPos.y - r.y
	local inside = rx >= 0 and ry >= 0 and rx < r.w and ry < r.h
	-- Apps hide the cursor either with ShowCursor (clears CURSOR_SHOWING) or
	-- with SetCursor(NULL) (games, video players, CSS cursor:none).
	local shown = bit.band(ci.flags, CURSOR_SHOWING) ~= 0 and ci.hCursor ~= nil
	if shown then
		state.hidden_since = nil
	elseif last == nil or not last.shown then
		state.hidden_since = nil
	else
		state.hidden_since = state.hidden_since or now
		if now - state.hidden_since < HIDE_GRACE_NS then
			return { rx = rx, ry = ry, buttons = buttons, cursor = last.cursor, visible = inside, shown = true }
		end
	end
	return {
		rx = rx,
		ry = ry,
		buttons = buttons,
		cursor = shown and (state.cursor_names[handle_key(ci.hCursor)] or "default") or (last and last.cursor or "default"),
		visible = shown and inside,
		shown = shown,
	}
end

local function same(a, b)
	return b ~= nil and a.rx == b.rx and a.ry == b.ry and a.buttons == b.buttons
		and a.cursor == b.cursor and a.visible == b.visible
end

local function to_json(s, src, now)
	local r = state.region
	local nx, ny = s.rx / r.w, s.ry / r.h
	return string.format(
		'{"x":%.2f,"y":%.2f,"nx":%.6f,"ny":%.6f,"buttons":%d,"cursor":"%s","visible":%s,"t":%.3f}',
		nx * obs.obs_source_get_width(src), ny * obs.obs_source_get_height(src), nx, ny,
		s.buttons, s.cursor, s.visible and "true" or "false", now / 1e6)
end

function script_tick(_)
	if state.settings == nil then return end
	local now = obs.os_gettime_ns()
	check_display(now)
	-- Read every frame so the "pressed since last call" bits never go stale.
	local buttons = read_buttons()
	local src = target_source()
	if src == nil then return end
	if obs.obs_source_showing(src) then
		local s = poll(buttons, now)
		if not same(s, state.last) or now - state.last_sent >= KEEPALIVE_NS then
			dispatch(src, to_json(s, src, now))
			state.last = s
			state.last_sent = now
		end
	end
	obs.obs_source_release(src)
end

---------------------------------------------------------------------------
-- Pages
---------------------------------------------------------------------------

local function pages_dir()
	return script_path() .. "pages/"
end

-- Best effort: io.open takes the path in the ANSI code page, so it fails for
-- UTF-8 paths with non-ASCII characters; the caller falls back to the folder name.
local function read_title(file)
	local f = io.open(file, "rb")
	if f == nil then return nil end
	local html = f:read(4096) or ""
	f:close()
	local title = html:match("<title>%s*(.-)%s*</title>")
	return title ~= "" and title or nil
end

-- Folders under pages/ that contain an index.html, as { id, label } sorted by id.
local function list_pages()
	local pages = {}
	local dir = obs.os_opendir(pages_dir())
	if dir == nil then return pages end
	while true do
		local entry = obs.os_readdir(dir)
		if entry == nil then break end
		local name = entry.d_name
		local index = pages_dir() .. name .. "/index.html"
		if entry.directory and name:sub(1, 1) ~= "." and name:sub(1, 1) ~= "_" and obs.os_file_exists(index) then
			pages[#pages + 1] = { id = name, label = read_title(index) or name }
		end
	end
	obs.os_closedir(dir)
	table.sort(pages, function(a, b) return a.id < b.id end)
	return pages
end

-- Points the selected browser source at a page, sized to the captured monitor
-- so it lines up 1:1 with a Display Capture of that monitor.
local function load_page()
	local page = obs.obs_data_get_string(state.settings, "page")
	if page == "" or state.source_uuid == "" then return false end
	local src = obs.obs_get_source_by_uuid(state.source_uuid)
	if src == nil then return false end
	local s = obs.obs_source_get_settings(src)
	obs.obs_data_set_bool(s, "is_local_file", true)
	obs.obs_data_set_string(s, "local_file", pages_dir() .. page .. "/index.html")
	obs.obs_data_set_int(s, "width", state.region.w)
	obs.obs_data_set_int(s, "height", state.region.h)
	obs.obs_source_update(src, s)
	obs.obs_data_release(s)
	obs.obs_source_release(src)
	state.last = nil
	return false
end

---------------------------------------------------------------------------
-- Script interface
---------------------------------------------------------------------------

local function fill_sources(list)
	obs.obs_property_list_clear(list)
	obs.obs_property_list_add_string(list, "(none)", "")
	local items = {}
	local sources = obs.obs_enum_sources()
	if sources ~= nil then
		for _, src in ipairs(sources) do
			if obs.obs_source_get_unversioned_id(src) == "browser_source" then
				items[#items + 1] = { name = obs.obs_source_get_name(src), uuid = obs.obs_source_get_uuid(src) }
			end
		end
		obs.source_list_release(sources)
	end
	table.sort(items, function(a, b) return a.name:lower() < b.name:lower() end)
	for _, item in ipairs(items) do
		obs.obs_property_list_add_string(list, item.name, item.uuid)
	end
end

local CUSTOM_KEYS = { "custom_x", "custom_y", "custom_w", "custom_h" }

local function on_monitor_changed(props, _, settings)
	local custom = obs.obs_data_get_string(settings, "monitor") == MONITOR_CUSTOM
	for _, key in ipairs(CUSTOM_KEYS) do
		obs.obs_property_set_visible(obs.obs_properties_get(props, key), custom)
	end
	return true
end

function script_description()
	return [[<h3>Browser Cursor</h3>
<p>Sends the mouse position, buttons and cursor shape into a <b>Browser</b> source
every frame as an <code>obs-cursor</code> event, for transparent cursor-effect pages.</p>
<p>Put the browser source above your Display Capture with the same transform,
turn off <i>Capture Cursor</i> on the Display Capture, and pick the same monitor here.</p>]]
end

function script_properties()
	local props = obs.obs_properties_create()

	local list = obs.obs_properties_add_list(props, "source", "Browser source",
		obs.OBS_COMBO_TYPE_LIST, obs.OBS_COMBO_FORMAT_STRING)
	fill_sources(list)
	obs.obs_properties_add_button(props, "refresh", "Refresh source list", function(p)
		fill_sources(obs.obs_properties_get(p, "source"))
		return true
	end)

	local mon = obs.obs_properties_add_list(props, "monitor", "Captured monitor",
		obs.OBS_COMBO_TYPE_LIST, obs.OBS_COMBO_FORMAT_STRING)
	obs.obs_property_list_add_string(mon, "Primary monitor", MONITOR_PRIMARY)
	for i, m in ipairs(enum_monitors()) do
		local label = string.format("Monitor %d: %dx%d at (%d, %d)%s",
			i, m.w, m.h, m.x, m.y, m.primary and " [primary]" or "")
		obs.obs_property_list_add_string(mon, label, m.device)
	end
	obs.obs_property_list_add_string(mon, "Custom region", MONITOR_CUSTOM)
	obs.obs_property_set_modified_callback(mon, on_monitor_changed)
	obs.obs_properties_add_int(props, "custom_x", "Region X", -32768, 32768, 1)
	obs.obs_properties_add_int(props, "custom_y", "Region Y", -32768, 32768, 1)
	obs.obs_properties_add_int(props, "custom_w", "Region width", 1, 32768, 1)
	obs.obs_properties_add_int(props, "custom_h", "Region height", 1, 32768, 1)

	local pages = obs.obs_properties_add_list(props, "page", "Page",
		obs.OBS_COMBO_TYPE_LIST, obs.OBS_COMBO_FORMAT_STRING)
	for _, page in ipairs(list_pages()) do
		obs.obs_property_list_add_string(pages, page.label, page.id)
	end
	obs.obs_properties_add_button(props, "load_page", "Load page into browser source", load_page)

	return props
end

function script_defaults(settings)
	obs.obs_data_set_default_string(settings, "source", "")
	obs.obs_data_set_default_string(settings, "monitor", MONITOR_PRIMARY)
	obs.obs_data_set_default_int(settings, "custom_x", 0)
	obs.obs_data_set_default_int(settings, "custom_y", 0)
	obs.obs_data_set_default_int(settings, "custom_w", 1920)
	obs.obs_data_set_default_int(settings, "custom_h", 1080)
	obs.obs_data_set_default_string(settings, "page", "frost")
end

function script_update(settings)
	state.settings = settings
	update_region()
	local uuid = obs.obs_data_get_string(settings, "source")
	if uuid ~= state.source_uuid then
		state.source_uuid = uuid
		drop_target()
	end
end

function script_load(settings)
	state.cursor_names = load_cursor_names()
	read_buttons() -- clears "pressed since last call" bits from before the script ran
	script_update(settings)
end

function script_unload()
	drop_target()
end
