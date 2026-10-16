-- Reads an RGBA16F texture back and writes it as a PNG, composited
-- (premultiplied, in linear light) over a test backdrop: a dark desktop with
-- a light window on the right.

local ffi = require("ffi")
local bit = require("bit")
local png = require("png")

local M = {}

local half = ffi.new("float[65536]")
for i = 0, 65535 do
	local e = bit.band(bit.rshift(i, 10), 0x1F)
	local m = bit.band(i, 0x3FF)
	local v
	if e == 0 then
		v = m * 2 ^ -24
	elseif e == 31 then
		v = 0
	else
		v = (1 + m / 1024) * 2 ^ (e - 15)
	end
	half[i] = bit.band(i, 0x8000) ~= 0 and -v or v
end

local srgb = ffi.new("uint8_t[4097]")
for i = 0, 4096 do
	local l = i / 4096
	local s = l <= 0.0031308 and l * 12.92 or 1.055 * l ^ (1 / 2.4) - 0.055
	srgb[i] = math.floor(math.min(math.max(s, 0), 1) * 255 + 0.5)
end

local function encode(v)
	return srgb[math.min(math.max(math.floor(v * 4096), 0), 4096)]
end

-- Returns the number of lit pixels and the brightest channel. With black
-- set, the backdrop is plain black instead.
function M.write(gpu, tex, path, black)
	local w, h = tex.w, tex.h
	local bytes, pitch = gpu:read_texture(tex)
	local rgb = ffi.new("uint8_t[?]", w * h * 3)
	local lit, peak = 0, 0
	for y = 0, h - 1 do
		local row = ffi.cast("uint16_t*", bytes + y * pitch)
		local g0 = 0.012 + 0.02 * (y / h)
		for x = 0, w - 1 do
			local r, g, b, a = half[row[x * 4]], half[row[x * 4 + 1]], half[row[x * 4 + 2]], half[row[x * 4 + 3]]
			if a > 0.004 then
				lit = lit + 1
			end
			peak = math.max(peak, r, g, b)
			local br, bg, bb = g0, g0 * 1.05, g0 * 1.35
			if black then
				br, bg, bb = 0, 0, 0
			elseif x > w * 0.62 and x < w * 0.97 and y > h * 0.12 and y < h * 0.62 then
				br, bg, bb = 0.78, 0.79, 0.8
			end
			local o = (y * w + x) * 3
			rgb[o] = encode(r + br * (1 - a))
			rgb[o + 1] = encode(g + bg * (1 - a))
			rgb[o + 2] = encode(b + bb * (1 - a))
		end
	end
	png.write(path, w, h, rgb)
	return lit, peak
end

return M
