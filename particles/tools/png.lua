-- Minimal PNG writer (RGB8, stored deflate blocks) for the preview tool.

local ffi = require("ffi")
local bit = require("bit")

local M = {}

local crc_table = ffi.new("uint32_t[256]")
for i = 0, 255 do
	local c = i
	for _ = 1, 8 do
		if bit.band(c, 1) ~= 0 then
			c = bit.bxor(0xEDB88320, bit.rshift(c, 1))
		else
			c = bit.rshift(c, 1)
		end
	end
	crc_table[i] = c
end

local function crc_update(crc, buf, len)
	for i = 0, len - 1 do
		crc = bit.bxor(crc_table[bit.band(bit.bxor(crc, buf[i]), 0xFF)], bit.rshift(crc, 8))
	end
	return crc
end

local function be32(v)
	return string.char(bit.band(bit.rshift(v, 24), 255), bit.band(bit.rshift(v, 16), 255),
		bit.band(bit.rshift(v, 8), 255), bit.band(v, 255))
end

local function chunk(f, kind, data, len)
	f:write(be32(len), kind)
	local crc = crc_update(-1, ffi.cast("const uint8_t*", kind), 4)
	if len > 0 then
		f:write(ffi.string(data, len))
		crc = crc_update(crc, data, len)
	end
	f:write(be32(bit.bnot(crc)))
end

-- rgb: uint8_t[w * h * 3]
function M.write(path, w, h, rgb)
	local row = w * 3 + 1
	local raw_len = row * h
	local raw = ffi.new("uint8_t[?]", raw_len)
	for y = 0, h - 1 do
		raw[y * row] = 0
		ffi.copy(raw + y * row + 1, rgb + y * w * 3, w * 3)
	end

	local blocks = math.ceil(raw_len / 65535)
	local z_len = 2 + raw_len + blocks * 5 + 4
	local z = ffi.new("uint8_t[?]", z_len)
	z[0], z[1] = 0x78, 0x01
	local o, pos = 2, 0
	while pos < raw_len do
		local n = math.min(65535, raw_len - pos)
		local nn = bit.band(bit.bnot(n), 0xFFFF)
		z[o] = (pos + n >= raw_len) and 1 or 0
		z[o + 1], z[o + 2] = bit.band(n, 255), bit.rshift(n, 8)
		z[o + 3], z[o + 4] = bit.band(nn, 255), bit.rshift(nn, 8)
		ffi.copy(z + o + 5, raw + pos, n)
		o, pos = o + 5 + n, pos + n
	end
	local a, b = 1, 0
	for i = 0, raw_len - 1 do
		a = (a + raw[i]) % 65521
		b = (b + a) % 65521
	end
	local adler = b * 65536 + a
	z[o], z[o + 1] = bit.band(bit.rshift(adler, 24), 255), bit.band(bit.rshift(adler, 16), 255)
	z[o + 2], z[o + 3] = bit.band(bit.rshift(adler, 8), 255), bit.band(adler, 255)

	local f = assert(io.open(path, "wb"))
	f:write("\137PNG\r\n\26\n")
	local ihdr = ffi.new("uint8_t[13]")
	local hdr = be32(w) .. be32(h) .. "\8\2\0\0\0"
	ffi.copy(ihdr, hdr, 13)
	chunk(f, "IHDR", ihdr, 13)
	chunk(f, "IDAT", z, z_len)
	chunk(f, "IEND", nil, 0)
	f:close()
end

return M
