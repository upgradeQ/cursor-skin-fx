-- Parameter specs shared by the OBS host and the offline preview tool.
-- A spec is { key, label, kind, default, min, max, step } where kind is
-- "float", "int", "bool", "color" (OBS 0xAABBGGRR int) or "list" (spec.items
-- holds { value, label } pairs).

local bit = require("bit")

local M = {}

-- Output settings every effect has; effects override defaults through
-- effect.output_defaults.
M.output = {
	{ "opacity", "Opacity", "float", 1.0, 0, 1, 0.01 },
	{ "exposure", "Brightness", "float", 1.0, 0, 4, 0.05 },
	{ "bloom", "Glow strength", "float", 0.8, 0, 4, 0.05 },
	{ "bloom_radius", "Glow radius (px)", "float", 16, 2, 160, 1 },
	{ "blend", "Blending", "list", "screen", items = {
		{ "screen", "Light over the scene (works with filters)" },
		{ "add", "Additive (brightest)" },
	} },
}

local function default_of(effect, spec)
	local over = effect.output_defaults
	if over and over[spec[1]] ~= nil then
		return over[spec[1]]
	end
	return spec[4]
end
M.default_of = default_of

function M.all(effect)
	local list = {}
	for _, s in ipairs(effect.params) do
		list[#list + 1] = s
	end
	for _, s in ipairs(M.output) do
		list[#list + 1] = s
	end
	return list
end

function M.defaults(effect)
	local raw = {}
	for _, s in ipairs(M.all(effect)) do
		raw[s[1]] = default_of(effect, s)
	end
	return raw
end

local function srgb_to_linear(c)
	if c <= 0.04045 then
		return c / 12.92
	end
	return ((c + 0.055) / 1.055) ^ 2.4
end

-- OBS colour int (0xAABBGGRR) -> linear { r, g, b, a }
function M.color(v)
	v = v or 0xFFFFFFFF
	return {
		srgb_to_linear(bit.band(v, 0xFF) / 255),
		srgb_to_linear(bit.band(bit.rshift(v, 8), 0xFF) / 255),
		srgb_to_linear(bit.band(bit.rshift(v, 16), 0xFF) / 255),
		bit.band(bit.rshift(v, 24), 0xFF) / 255,
	}
end

-- Raw setting values -> config the effects read (colours converted).
function M.to_cfg(effect, raw)
	local cfg = {}
	for _, s in ipairs(M.all(effect)) do
		local v = raw[s[1]]
		if v == nil then
			v = default_of(effect, s)
		end
		if s[3] == "color" then
			v = M.color(v)
		end
		cfg[s[1]] = v
	end
	return cfg
end

return M
