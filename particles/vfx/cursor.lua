-- Turns raw cursor samples into the per-frame input every effect reads.

local M = {}

local Tracker = {}
Tracker.__index = Tracker

function M.new()
	return setmetatable({ vx = 0, vy = 0, inside = false, button = false }, Tracker)
end

-- x, y: cursor in render pixels (nil when unknown); inside: within the
-- mapped area; button: left button held; gap: frames were skipped.
function Tracker:sample(x, y, inside, button, dt, w, h, gap)
	if x == nil then
		x, y, inside = self.x or 0, self.y or 0, false
	end
	local teleport = gap or self.x == nil or not self.inside
	local dx, dy = 0, 0
	if not teleport then
		dx, dy = x - self.x, y - self.y
		local far = 0.5 * (w + h)
		if dx * dx + dy * dy > far * far then
			teleport, dx, dy = true, 0, 0
		end
	end

	if teleport then
		self.vx, self.vy = 0, 0
	else
		local k = 1 - math.exp(-dt * 30)
		self.vx = self.vx + (dx / dt - self.vx) * k
		self.vy = self.vy + (dy / dt - self.vy) * k
	end

	local inp = {
		dt = dt,
		x = x,
		y = y,
		px = teleport and x or self.x,
		py = teleport and y or self.y,
		vx = self.vx,
		vy = self.vy,
		speed = math.sqrt(self.vx * self.vx + self.vy * self.vy),
		moved = inside and math.sqrt(dx * dx + dy * dy) or 0,
		inside = inside,
		teleport = teleport,
		clicked = inside and button and not self.button,
	}
	self.x, self.y, self.inside, self.button = x, y, inside, button
	return inp
end

-- One Euro filter (Casiez et al.): heavy smoothing while the cursor creeps,
-- where whole-pixel steps show, and little lag once it moves fast.
local OneEuro = {}
OneEuro.__index = OneEuro

function M.one_euro(min_cutoff, beta, d_cutoff)
	return setmetatable({ min_cutoff = min_cutoff, beta = beta, d_cutoff = d_cutoff }, OneEuro)
end

local function alpha(cutoff, dt)
	return 1 / (1 + 1 / (2 * math.pi * cutoff * dt))
end

function OneEuro:reset(x, y)
	self.x, self.y, self.rx, self.ry, self.dx, self.dy = x, y, x, y, 0, 0
end

function OneEuro:step(x, y, dt)
	if not self.x then
		self:reset(x, y)
		return x, y
	end
	local ad = alpha(self.d_cutoff, dt)
	self.dx = self.dx + ((x - self.rx) / dt - self.dx) * ad
	self.dy = self.dy + ((y - self.ry) / dt - self.dy) * ad
	self.rx, self.ry = x, y
	local a = alpha(self.min_cutoff + self.beta * math.sqrt(self.dx * self.dx + self.dy * self.dy), dt)
	self.x = self.x + (x - self.x) * a
	self.y = self.y + (y - self.y) * a
	return self.x, self.y
end

return M
