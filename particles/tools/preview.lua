-- Offline preview: runs one effect on its own D3D11 device (no OBS) with a
-- scripted cursor and writes PNG snapshots composited over a test backdrop.
-- tools/preview.ps1 sets the VFX_* globals and runs this with OBS's LuaJIT.

local root = VFX_ROOT
package.path = root .. "?.lua;" .. root .. "tools/?.lua;" .. package.path

local d3d = require("vfx.d3d11")
local shaders = require("vfx.shaders")
local params = require("vfx.params")
local cursor = require("vfx.cursor")
local snap = require("snapshot")

local NAME = VFX_EFFECT
local W, H = tonumber(VFX_W), tonumber(VFX_H)
local FRAMES = tonumber(VFX_FRAMES)
local OUT = VFX_OUT
local FPS = 60

local logf = assert(io.open(OUT .. "/" .. NAME .. ".log", "w"))
local function log(fmt, ...)
	local s = string.format(fmt, ...)
	logf:write(s, "\n")
	logf:flush()
	io.stdout:write(s, "\n")
	io.stdout:flush()
end

local snaps = {}
for v in tostring(VFX_SNAPS):gmatch("%d+") do
	snaps[tonumber(v)] = true
end

---------------------------------------------------------------- setup

local E = require("vfx.effects." .. NAME)
local t0 = os.clock()
local bytecode, err = shaders.build(root .. "vfx/shaders/", nil, E.shader_files, E.kernels)
if not bytecode then
	log("shader build failed:\n%s", err)
	error("shader build failed", 0)
end
log("%s: compiled %d kernels in %.0f ms", NAME, #E.kernels, (os.clock() - t0) * 1000)

local gpu = assert(d3d.create_device(VFX_DEBUG == "1"))
log("device created (debug layer: %s)", tostring(gpu.debug))
local kernels = {}
for name, code in pairs(bytecode) do
	kernels[name] = gpu:shader(code)
end

local raw = params.defaults(E)
for k, v in tostring(VFX_SET or ""):gmatch("([%w_]+)=([^,]+)") do
	raw[k] = tonumber(v) or v
end
local cfg = params.to_cfg(E, raw)

local inst = E.new(gpu, kernels, W, H)
inst:configure(cfg)

local function drain(tag)
	for _, m in ipairs(gpu:messages()) do
		log("[d3d11 %s] %s", tag, m)
	end
end
drain("setup")

---------------------------------------------------------------- cursor path

-- 0-0.4 s still in the centre, figure eight speeding up until 3 s with a
-- click at 2.2 s, a fast swoosh to the lower right, then still again.
local function cursor_at(f)
	local t = f / FPS
	local cx, cy = W * 0.5, H * 0.5
	local rx, ry = W * 0.3, H * 0.28
	local function eight(u)
		local a = 1.2 * u + 0.6 * u * u
		return cx + rx * math.sin(a), cy + ry * math.sin(2 * a)
	end
	if t < 0.4 then
		return cx, cy, false
	elseif t < 3.0 then
		local x, y = eight(t - 0.4)
		return x, y, t >= 2.2 and t < 2.27
	elseif t < 3.35 then
		local x0, y0 = eight(2.6)
		local s = (t - 3.0) / 0.35
		s = s * s * (3 - 2 * s)
		return x0 + (W * 0.88 - x0) * s, y0 + (H * 0.8 - y0) * s, false
	end
	return W * 0.88, H * 0.8, false
end

---------------------------------------------------------------- snapshots

local function snapshot(frame)
	local path = string.format("%s/%s_%03d.png", OUT, NAME, frame)
	local lit, peak = snap.write(gpu, inst.pipe.out, path, VFX_BG == "black")
	log("frame %3d: wrote %s (lit px %d, peak %.2f)", frame, path, lit, peak)
end

---------------------------------------------------------------- run

local tracker = cursor.new()
local dt = 1 / FPS
local total, worst, timed = 0, 0, 0
for f = 1, FRAMES do
	local x, y, down = cursor_at(f)
	local inp = tracker:sample(x, y, true, down, dt, W, H, false)
	inp.time, inp.frame = f * dt, f
	local ms = gpu:time(function()
		inst:frame(inp)
	end)
	if ms and f > 5 then
		total, timed = total + ms, timed + 1
		worst = math.max(worst, ms)
	end
	drain("frame " .. f)
	if snaps[f] then
		snapshot(f)
	end
end
log("GPU time per frame at %dx%d: avg %.3f ms, worst %.3f ms", W, H, total / math.max(timed, 1), worst)

inst:destroy()
for _, cs in pairs(kernels) do
	d3d.release(cs)
end
drain("teardown")
gpu:destroy()
log("done")
logf:close()
