-- Shattered glass: mini cubic glass chunks with glowing edges and fake
-- reflections, in a haze of fine glass dust. (The source id and file name
-- still say "glass dust" so existing scenes keep working.)

local particles = require("vfx.particles")

local E = {
	id = "cursor_vfx_glass_dust",
	name = "Cursor VFX: Shattered Glass",
	description = "Mini cubic shards of shattered glass with glowing edges and fake reflections, stirred up by the mouse cursor.",
	shader_files = { "common.hlsl", "glass_dust.hlsl" },
	kernels = {
		"CSGlassSim", "CSGlassSplat", "CSGlassBig",
		"CSBloomDown", "CSBloomBlurH", "CSBloomBlurV", "CSComposite",
	},
	sim = "CSGlassSim",
	splat = "CSGlassSplat",
	capacity = 32768,
	-- queue of big chunks, drawn by a whole thread group each
	-- (kBigMax + 1 entries and kBigGroups groups in glass_dust.hlsl)
	extra = { count = 4096, stride = 4 },
	after_splat = { { "CSGlassBig", 64 } },
	output_defaults = { bloom = 0.12, bloom_radius = 5 },
	params = {
		{ "shards", "Shards per 100 px moved", "float", 12, 0, 400, 1 },
		{ "dust", "Fine dust per 100 px moved", "float", 160, 0, 1000, 1 },
		{ "idle", "Idle trickle per second", "float", 30, 0, 1000, 1 },
		{ "burst", "Click shatter (pieces)", "int", 400, 0, 5000, 10 },
		{ "burst_speed", "Shatter speed (px/s)", "float", 480, 0, 3000, 10 },
		{ "life", "Lifetime (seconds)", "float", 3.2, 0.5, 15, 0.1 },
		{ "size", "Largest shard (px)", "float", 20, 3, 60, 0.5 },
		{ "cubic", "Shape (flat to cubic)", "float", 0.7, 0, 1, 0.01 },
		{ "irregular", "Irregularity", "float", 0.8, 0, 1, 0.01 },
		{ "spread", "Spawn spread (px)", "float", 30, 0, 200, 1 },
		{ "speed", "Scatter speed (px/s)", "float", 70, 0, 600, 5 },
		{ "inherit", "Follow cursor motion", "float", 0.3, 0, 1, 0.01 },
		{ "wind", "Cursor wind", "float", 4, 0, 30, 0.1 },
		{ "wind_radius", "Wind radius (px)", "float", 70, 5, 600, 5 },
		{ "drift", "Air drift", "float", 20, 0, 600, 5 },
		{ "drift_size", "Drift size (px)", "float", 260, 20, 2000, 10 },
		{ "drag", "Air drag", "float", 1.5, 0, 10, 0.05 },
		{ "gravity", "Fall (px/s²)", "float", 35, -400, 800, 5 },
		{ "spin", "Tumble speed", "float", 2.6, 0, 20, 0.1 },
		{ "reflections", "Reflections", "float", 1.0, 0, 4, 0.05 },
		{ "curvature", "Reflection sweep", "float", 0.55, 0, 2, 0.05 },
		{ "edges", "Edge glow", "float", 0.9, 0, 4, 0.05 },
		{ "body", "Glass tint", "float", 0.03, 0, 1, 0.01 },
		{ "dispersion", "Rainbow fire", "float", 0.25, 0, 1, 0.01 },
		{ "flare", "Glint flare length (px)", "float", 7, 0, 40, 0.5 },
		{ "color_glass", "Glass tint color", "color", 0xFFEEF0DD },
		{ "color_light", "Reflection color", "color", 0xFFFFFFFF },
	},
}

-- shards and dust share one particle stream; the GPU picks each particle's
-- kind from the dust share
local function dust_share(c)
	local total = c.shards + c.dust
	return total > 0 and c.dust / total or 0
end

function E.rates(c)
	return c.shards + c.dust, c.idle
end

function E.pack(pipe, c)
	pipe:param(0, c.life * 0.6, c.life * 1.4, 1.6, math.max(c.size * 0.5, 1.7))
	pipe:param(1, c.spread, c.speed, c.inherit, c.drag)
	pipe:param(2, c.gravity, c.drift, 1 / c.drift_size, c.wind)
	pipe:param(3, c.wind_radius, dust_share(c), c.cubic, c.irregular)
	pipe:param(4, c.spin, c.reflections, c.edges, c.curvature)
	pipe:param(5, c.body, c.dispersion, c.flare, c.burst_speed)
	pipe:color(0, c.color_glass)
	pipe:color(1, c.color_light)
end

function E.new(gpu, kernels, w, h)
	return particles.new(E, gpu, kernels, w, h)
end

return E
