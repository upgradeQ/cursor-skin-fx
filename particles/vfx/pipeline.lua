-- GPU resources every effect shares: the fixed-point accumulation buffer the
-- kernels splat into, a quarter-resolution glow chain, the RGBA16F output
-- texture and the Frame constant buffer (layout mirrors common.hlsl).

local ffi = require("ffi")
local d3d = require("vfx.d3d11")

local P = {}
P.__index = P

-- float offsets of the Frame cbuffer fields
local RES, TIME, CURSOR, MOTION = 0, 4, 8, 12
local EMIT, RANGE, OUTPUT, BLOOM = 16, 20, 24, 28
local COLOR0, PARAMS = 32, 44
local FLOATS = 68

P.EMIT, P.RANGE = EMIT, RANGE

function P.new(gpu, w, h)
	local self = setmetatable({ gpu = gpu }, P)
	self.cb = gpu:constants(FLOATS * 4)
	self.f = ffi.new("float[?]", FLOATS)
	self.u = ffi.cast("uint32_t*", self.f)
	self.uavs = ffi.new("void*[6]")
	self:resize(w, h)
	return self
end

function P:free_targets()
	local gpu = self.gpu
	gpu:free(self.accum)
	gpu:free(self.bloom_a)
	gpu:free(self.bloom_b)
	gpu:free(self.out)
	self.accum, self.bloom_a, self.bloom_b, self.out = nil, nil, nil, nil
end

function P:resize(w, h)
	self:free_targets()
	local gpu = self.gpu
	self.w, self.h = w, h
	self.bw, self.bh = math.ceil(w / 4), math.ceil(h / 4)
	self.accum = gpu:structured(w * h * 4, 4)
	self.bloom_a = gpu:structured(self.bw * self.bh, 16)
	self.bloom_b = gpu:structured(self.bw * self.bh, 16)
	self.out = gpu:texture(w, h, d3d.FORMAT_RGBA16F)
	gpu:clear(self.accum.uav, 0)
	self.uavs[1] = self.accum.uav
	self.uavs[2] = self.bloom_a.uav
	self.uavs[3] = self.bloom_b.uav
	self.uavs[4] = self.out.uav
end

-- Effect-owned UAVs for slots u0 and u5.
function P:set_state(u0, u5)
	self.uavs[0] = u0
	self.uavs[5] = u5
end

function P:destroy()
	self:free_targets()
	d3d.release(self.cb.res)
	self.cb.res = nil
end

function P:vec(off, x, y, z, w)
	local f = self.f
	f[off], f[off + 1], f[off + 2], f[off + 3] = x or 0, y or 0, z or 0, w or 0
end

function P:uvec(off, x, y, z, w)
	local u = self.u
	u[off], u[off + 1], u[off + 2], u[off + 3] = x or 0, y or 0, z or 0, w or 0
end

function P:param(i, x, y, z, w)
	self:vec(PARAMS + 4 * i, x, y, z, w)
end

-- c is a linear { r, g, b, a } table from params.lua
function P:color(slot, c)
	self:vec(COLOR0 + 4 * slot, c[1], c[2], c[3], c[4])
end

-- Common per-frame fields. `cfg` carries the shared output settings.
function P:begin(inp, cfg)
	self:vec(RES, self.w, self.h, 1 / self.w, 1 / self.h)
	-- wrapped so float32 noise and twinkle phases stay smooth for long sessions
	self:vec(TIME, inp.time % 3600, inp.dt, inp.frame % 16777216, math.random())
	self:vec(CURSOR, inp.x, inp.y, inp.px, inp.py)
	self:vec(MOTION, inp.vx, inp.vy, inp.speed, inp.inside and 1 or 0)
	self:vec(OUTPUT, cfg.opacity, cfg.exposure, 0, cfg.bloom)
	-- glow radius (full-res px) -> gaussian sigma in quarter-res texels
	self:vec(BLOOM, math.max(cfg.bloom_radius, 1) / 8, 0, self.bw, self.bh)
	self:uvec(RANGE, 0, 0, 0, 0)
end

-- Upload constants and bind every slot for this frame's dispatches.
function P:bind(extra_cb)
	self.gpu:update(self.cb.res, self.f)
	self.gpu:bind(self.uavs, 6, self.cb.res, extra_cb)
end

-- Glow + composite into self.out, then unbind the compute stage.
function P:finish(k)
	local gpu = self.gpu
	if self.f[OUTPUT + 3] > 0 then
		local gx, gy = math.ceil(self.bw / 8), math.ceil(self.bh / 8)
		gpu:dispatch(k.CSBloomDown, gx, gy)
		gpu:dispatch(k.CSBloomBlurH, gx, gy)
		gpu:dispatch(k.CSBloomBlurV, gx, gy)
	end
	gpu:dispatch(k.CSComposite, math.ceil(self.w / 8), math.ceil(self.h / 8))
	gpu:unbind()
end

return P
