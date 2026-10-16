-- Ribbon: a twisting two-sided strip of light trailing the cursor.
--
-- The CPU lays control points every few px along a smoothed cursor path and
-- keeps them in a GPU ring buffer; ribbon.hlsl moves, rasterises and shades
-- them entirely in compute.

local ffi = require("ffi")
local d3d = require("vfx.d3d11")
local Pipeline = require("vfx.pipeline")
local cursor = require("vfx.cursor")

local CAPACITY = 4096 -- control point ring
local MAX_SPAWN = 64  -- points per frame, matches RibbonSpawn in ribbon.hlsl
local BREAK = 1

local E = {
	id = "cursor_vfx_ribbon",
	name = "Cursor VFX: Ribbon",
	description = "A twisting ribbon of light that trails the mouse cursor.",
	shader_files = { "common.hlsl", "ribbon.hlsl" },
	kernels = {
		"CSRibbonSim", "CSRibbonRaster", "CSRibbonResolve",
		"CSBloomDown", "CSBloomBlurH", "CSBloomBlurV", "CSComposite",
	},
	output_defaults = { bloom = 0.7, bloom_radius = 22 },
	params = {
		{ "width", "Width (px)", "float", 42, 2, 200, 0.5 },
		{ "life", "Trail length (seconds)", "float", 1.0, 0.1, 5, 0.05 },
		{ "spacing", "Point spacing (px, lower is smoother)", "float", 4, 1, 24, 0.5 },
		{ "taper", "Tail taper", "float", 0.7, 0, 4, 0.05 },
		{ "head", "Head taper (px)", "float", 60, 0, 400, 1 },
		{ "fade", "Tail fade", "float", 0.45, 0, 1, 0.01 },
		{ "twist", "Twist amount", "float", 0.9, 0, 1, 0.01 },
		{ "twist_len", "Twist length (px)", "float", 340, 20, 2000, 10 },
		{ "twist_speed", "Twist spin (turns/s)", "float", 0.3, -4, 4, 0.05 },
		{ "softness", "Edge softness", "float", 0.3, 0, 1, 0.01 },
		{ "flutter", "Flutter", "float", 160, 0, 2000, 10 },
		{ "flutter_size", "Flutter size (px)", "float", 260, 20, 2000, 10 },
		{ "drag", "Drag", "float", 1.8, 0, 10, 0.05 },
		{ "inherit", "Throw with the cursor", "float", 0.1, 0, 1, 0.01 },
		{ "gravity", "Gravity (px/s²)", "float", 0, -1000, 1000, 10 },
		{ "color_head", "Head color", "color", 0xFFFFFFFF },
		{ "color_tail", "Tail color", "color", 0xFFFFC98A },
		{ "color_back", "Back side color", "color", 0xFFE6A8FF },
		{ "brightness", "Ribbon brightness", "float", 0.85, 0, 4, 0.05 },
		{ "sheen", "Sheen", "float", 0.8, 0, 4, 0.05 },
		{ "shine", "Sheen sharpness", "float", 24, 1, 200, 1 },
		{ "edge_glow", "Edge-on glow", "float", 1.0, 0, 6, 0.05 },
		{ "core", "Core line", "float", 0.3, 0, 4, 0.05 },
		{ "solidity", "Solidity", "float", 0.45, 0, 1, 0.01 },
	},
}

local Ribbon = {}
Ribbon.__index = Ribbon

function E.new(gpu, kernels, w, h)
	local self = setmetatable({ gpu = gpu, k = kernels }, Ribbon)
	self.pipe = Pipeline.new(gpu, w, h)
	self.points = gpu:structured(CAPACITY, 32)
	gpu:clear(self.points.uav, 0)
	self.spawn_cb = gpu:constants(MAX_SPAWN * 32)
	self.spawn = ffi.new("float[?]", MAX_SPAWN * 8)
	self.spawn_u = ffi.cast("uint32_t*", self.spawn)
	self.born = ffi.new("double[?]", CAPACITY)
	self:alloc_owner(w, h)
	self:reset()
	return self
end

function Ribbon:alloc_owner(w, h)
	self.gpu:free(self.owner)
	self.owner = self.gpu:structured(w * h, 4)
	self.gpu:clear(self.owner.uav, 0)
	self.pipe:set_state(self.points.uav, self.owner.uav)
end

function Ribbon:reset()
	self.newest = -1    -- sequence number of the newest fixed point
	self.oldest = 0     -- sequence number of the oldest live point
	self.arc = 0        -- arc length at the newest fixed point
	self.base = 0       -- the GPU stores arc - base, keeping float32 precise
	self.carry = 0      -- path walked since the newest fixed point
	self.hist = nil     -- { x0, y0, x1, y1 }: the two previous path samples
	self.filter = cursor.one_euro(1.0, 0.02, 1.0)
	self.vx, self.vy = 0, 0 -- throw velocity given to the last fixed point
	self.restart = true -- the next fixed point starts a new strand
end

function Ribbon:configure(cfg)
	self.cfg = cfg
end

function Ribbon:resize(w, h)
	self.pipe:resize(w, h)
	self:alloc_owner(w, h)
	self:reset()
end

function Ribbon:output()
	return self.pipe.out.res
end

function Ribbon:destroy()
	self.pipe:destroy()
	self.gpu:free(self.points)
	self.gpu:free(self.owner)
	d3d.release(self.spawn_cb.res)
	self.spawn_cb.res = nil
end

-- Append a point to this frame's spawn list.
function Ribbon:put(x, y, vx, vy, arc, age, flags)
	local n = self.count
	local f, u = self.spawn, self.spawn_u
	local a, b = n * 4, (MAX_SPAWN + n) * 4
	f[a], f[a + 1], f[a + 2], f[a + 3] = x, y, vx, vy
	f[b], f[b + 1] = arc - self.base, age
	u[b + 2] = math.random(0, 0x7FFFFFFF)
	u[b + 3] = flags
	self.count = n + 1
end

-- Spawn a fixed point (one that stays behind and drifts).
function Ribbon:fix(x, y, vx, vy, age, flags, now)
	local seq = self.newest + 1
	self.born[seq % CAPACITY] = now - age
	self:put(x, y, vx, vy, self.arc, age, flags)
	self.newest = seq
end

-- Lay fixed points every `spacing` px along a Hermite curve from the last
-- path sample to (x2, y2) (tangents from the neighbouring samples).
function Ribbon:trace(inp, x2, y2, now)
	local c = self.cfg
	local h = self.hist
	local x0, y0, x1, y1 = h[1], h[2], h[3], h[4]
	h[1], h[2], h[3], h[4] = x1, y1, x2, y2
	-- The throw velocity is heavily smoothed (whole-pixel cursor positions
	-- make per-frame velocity jittery, and drift amplifies that into a
	-- wobbly tail) and blended across the frame so batches drift as one.
	local ux, uy = self.vx, self.vy
	local k = 1 - math.exp(-inp.dt / 0.12)
	local vx = ux + (inp.vx * c.inherit - ux) * k
	local vy = uy + (inp.vy * c.inherit - uy) * k
	self.vx, self.vy = vx, vy
	local chord = math.sqrt((x2 - x1) ^ 2 + (y2 - y1) ^ 2)
	if chord < 1e-3 then
		return
	end
	local spacing = math.max(c.spacing, chord / (MAX_SPAWN - 2))
	local m0x, m0y = (x2 - x0) * 0.5, (y2 - y0) * 0.5
	local m1x, m1y = x2 - x1, y2 - y1
	local steps = math.min(math.max(math.ceil(chord / 2), 1), 128)
	local lx, ly = x1, y1
	for s = 1, steps do
		local t = s / steps
		local t2, t3 = t * t, t * t * t
		local h00, h10 = 2 * t3 - 3 * t2 + 1, t3 - 2 * t2 + t
		local h01, h11 = 3 * t2 - 2 * t3, t3 - t2
		local qx = h00 * x1 + h10 * m0x + h01 * x2 + h11 * m1x
		local qy = h00 * y1 + h10 * m0y + h01 * y2 + h11 * m1y
		local seg = math.sqrt((qx - lx) ^ 2 + (qy - ly) ^ 2)
		local used = 0
		while self.carry + seg - used >= spacing and self.count < MAX_SPAWN - 1 do
			used = used + spacing - self.carry
			self.carry = 0
			local f = used / seg
			local tf = (s - 1 + f) / steps
			self.arc = self.arc + spacing
			self:fix(lx + (qx - lx) * f, ly + (qy - ly) * f,
				ux + (vx - ux) * tf, uy + (vy - uy) * tf, (1 - tf) * inp.dt, 0, now)
		end
		self.carry = self.carry + seg - used
		lx, ly = qx, qy
	end
end

function Ribbon:frame(inp)
	local c, pipe, gpu, k = self.cfg, self.pipe, self.gpu, self.k
	local now = inp.time
	local first = self.newest + 1
	local live = false
	self.count = 0

	local rebase = 0
	if self.arc - self.base > 65536 then
		rebase = 32768
		self.base = self.base + rebase
	end

	if inp.inside then
		if self.restart or inp.teleport or not self.hist then
			self.carry = 0
			self:fix(inp.x, inp.y, 0, 0, 0, BREAK, now)
			self.hist = { inp.x, inp.y, inp.x, inp.y }
			self.filter:reset(inp.x, inp.y)
			self.vx, self.vy = 0, 0
			self.restart = false
		else
			-- fixed points follow the filtered path; the head stays on the
			-- real cursor and bridges the few px of filter lag
			local fx, fy = self.filter:step(inp.x, inp.y, inp.dt)
			self:trace(inp, fx, fy, now)
		end
		-- the head rides on the cursor and is rewritten every frame
		self:put(inp.x, inp.y, 0, 0, self.arc + self.carry, 0, 0)
		live = true
	else
		self.restart = true
	end

	while self.oldest <= self.newest and now - self.born[self.oldest % CAPACITY] >= c.life do
		self.oldest = self.oldest + 1
	end
	local last = live and self.newest + 1 or self.newest
	if last - self.oldest + 1 > CAPACITY - MAX_SPAWN then
		self.oldest = last - (CAPACITY - MAX_SPAWN) + 1
	end
	local alive = math.max(last - self.oldest + 1, 0)
	local head_arc = (live and self.arc + self.carry or self.arc) - self.base
	local freq = math.pi / c.twist_len
	local phase = (self.base * freq + now * c.twist_speed * 2 * math.pi) % (2 * math.pi)

	pipe:begin(inp, c)
	pipe:uvec(Pipeline.EMIT, first % CAPACITY, self.count, CAPACITY, 0)
	pipe:uvec(Pipeline.RANGE, self.oldest % CAPACITY, alive, 0, 0)
	pipe:param(0, c.width, c.life, c.taper, c.head)
	pipe:param(1, freq, phase, c.twist, c.softness)
	pipe:param(2, c.flutter, 1 / c.flutter_size, c.drag, c.gravity)
	pipe:param(3, -0.45, -0.65, 0.62, c.shine)
	pipe:param(4, c.sheen, c.edge_glow, c.solidity, c.core)
	pipe:param(5, c.brightness, c.fade, head_arc, rebase)
	pipe:color(0, c.color_head)
	pipe:color(1, c.color_tail)
	pipe:color(2, c.color_back)
	gpu:update(self.spawn_cb.res, self.spawn)
	pipe:bind(self.spawn_cb.res)

	gpu:dispatch(k.CSRibbonSim, math.ceil(CAPACITY / 256))
	if alive > 1 then
		gpu:dispatch(k.CSRibbonRaster, alive - 1)
		gpu:dispatch(k.CSRibbonResolve, math.ceil(pipe.w / 8), math.ceil(pipe.h / 8))
	end
	pipe:finish(k)
end

return E
