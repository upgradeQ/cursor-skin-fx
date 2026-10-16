-- Cursor position, mouse buttons and monitor layout through user32.

local ffi = require("ffi")
local bit = require("bit")

ffi.cdef[[
typedef struct VfxPoint { int32_t x, y; } VfxPoint;
typedef struct VfxRect { int32_t left, top, right, bottom; } VfxRect;
typedef struct VfxMonitorInfo {
	uint32_t cbSize;
	VfxRect rcMonitor;
	VfxRect rcWork;
	uint32_t dwFlags;
	char szDevice[32];
} VfxMonitorInfo;
typedef int (__stdcall *VfxMonitorEnumProc)(void *monitor, void *dc, VfxRect *rect, intptr_t data);

int GetCursorPos(VfxPoint *point);
int16_t GetAsyncKeyState(int key);
int GetSystemMetrics(int index);
int EnumDisplayMonitors(void *dc, const VfxRect *clip, VfxMonitorEnumProc proc, intptr_t data);
int GetMonitorInfoA(void *monitor, VfxMonitorInfo *info);
]]

local C = ffi.C
local M = {}

local point = ffi.new("VfxPoint")

-- Cursor in virtual-desktop pixels, or nil when Windows will not say
-- (secure desktop, UAC prompt).
function M.cursor()
	if C.GetCursorPos(point) == 0 then
		return nil
	end
	return point.x, point.y
end

function M.left_button()
	return bit.band(C.GetAsyncKeyState(0x01), 0x8000) ~= 0
end

function M.primary()
	return { x = 0, y = 0, w = C.GetSystemMetrics(0), h = C.GetSystemMetrics(1) }
end

function M.virtual_desktop()
	return {
		x = C.GetSystemMetrics(76),
		y = C.GetSystemMetrics(77),
		w = C.GetSystemMetrics(78),
		h = C.GetSystemMetrics(79),
	}
end

-- { device = "\\.\DISPLAY1", x, y, w, h, primary }, sorted left to right.
function M.monitors()
	local list = {}
	local proc = ffi.cast("VfxMonitorEnumProc", function(monitor)
		local info = ffi.new("VfxMonitorInfo")
		info.cbSize = ffi.sizeof(info)
		if C.GetMonitorInfoA(monitor, info) ~= 0 then
			local r = info.rcMonitor
			list[#list + 1] = {
				device = ffi.string(info.szDevice),
				x = r.left,
				y = r.top,
				w = r.right - r.left,
				h = r.bottom - r.top,
				primary = bit.band(info.dwFlags, 1) ~= 0,
			}
		end
		return 1
	end)
	C.EnumDisplayMonitors(nil, nil, proc, 0)
	proc:free()
	table.sort(list, function(a, b)
		if a.x ~= b.x then
			return a.x < b.x
		end
		return a.y < b.y
	end)
	return list
end

return M
