-- Ring-buffer particle system shared by the magic and glass dust effects.
--
-- The CPU only decides how many particles to spawn each frame and where the
-- ring head is; the effect's sim kernel spawns into those slots and moves
-- every live particle, its splat kernel draws them into the accumulator.

local Pipeline = require("vfx.pipeline")

local STRIDE = 32 -- sizeof(Particle) in the HLSL

local M = {}

local Inst = {}
Inst.__index = Inst

-- def: effect table with capacity, sim, splat and pack(pipe, cfg, inp).
-- Optional:
--   rates(cfg)  -> spawns per 100 px moved, spawns per second idle
--                  (default cfg.density, cfg.idle)
--   extra       = { count, stride }: a structured buffer bound at u5
--   after_splat = { { kernel, groups }, ... } dispatched after the splat
function M.new(def, gpu, kernels, w, h)
	local self = setmetatable({ def = def, gpu = gpu, k = kernels }, Inst)
	self.cap = def.capacity
	self.pipe = Pipeline.new(gpu, w, h)
	self.parts = gpu:structured(self.cap, STRIDE)
	gpu:clear(self.parts.uav, 0)
	if def.extra then
		self.extra = gpu:structured(def.extra.count, def.extra.stride)
		gpu:clear(self.extra.uav, 0)
	end
	self.pipe:set_state(self.parts.uav, self.extra and self.extra.uav)
	self.head, self.carry = 0, 0
	return self
end

function Inst:configure(cfg)
	self.cfg = cfg
end

function Inst:resize(w, h)
	self.pipe:resize(w, h)
	self.gpu:clear(self.parts.uav, 0)
	self.head, self.carry = 0, 0
end

function Inst:output()
	return self.pipe.out.res
end

function Inst:destroy()
	self.pipe:destroy()
	self.gpu:free(self.parts)
	self.gpu:free(self.extra)
end

function Inst:frame(inp)
	local cfg, pipe, gpu, k = self.cfg, self.pipe, self.gpu, self.k

	-- spawn count: per px travelled, a trickle while idle, a burst per click
	local n, burst = 0, 0
	local per_100px, idle = cfg.density, cfg.idle
	if self.def.rates then
		per_100px, idle = self.def.rates(cfg)
	end
	if inp.inside then
		self.carry = self.carry + inp.moved * per_100px / 100 + inp.dt * idle
		n = math.floor(self.carry)
		self.carry = self.carry - n
		if inp.clicked then
			burst = cfg.burst or 0
		end
	else
		self.carry = 0
	end
	local limit = math.floor(self.cap / 3)
	n = math.min(n, limit)
	burst = math.min(burst, limit - n)
	n = n + burst

	pipe:begin(inp, cfg)
	pipe:uvec(Pipeline.EMIT, self.head, n, self.cap, burst)
	self.def.pack(pipe, cfg, inp)
	self.head = (self.head + n) % self.cap
	pipe:bind(nil)

	gpu:dispatch(k[self.def.sim], math.ceil(self.cap / 256))
	gpu:dispatch(k[self.def.splat], math.ceil(self.cap / 64))
	for _, pass in ipairs(self.def.after_splat or {}) do
		gpu:dispatch(k[pass[1]], pass[2])
	end
	pipe:finish(k)
end

return M
