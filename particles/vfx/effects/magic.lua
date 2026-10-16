-- Magic particles: white sparkles and glowing motes spilling from the cursor.

local particles = require("vfx.particles")

local E = {
	id = "cursor_vfx_magic_particles",
	name = "Cursor VFX: Magic Particles",
	description = "White magic sparkles and glowing motes that spill from the mouse cursor.",
	shader_files = { "common.hlsl", "magic.hlsl" },
	kernels = {
		"CSMagicSim", "CSMagicSplat",
		"CSBloomDown", "CSBloomBlurH", "CSBloomBlurV", "CSComposite",
	},
	sim = "CSMagicSim",
	splat = "CSMagicSplat",
	capacity = 32768,
	output_defaults = { bloom = 1.1, bloom_radius = 20 },
	params = {
		{ "density", "Particles per 100 px moved", "float", 28, 0, 300, 1 },
		{ "idle", "Idle sparkles per second", "float", 18, 0, 500, 1 },
		{ "burst", "Click burst (particles)", "int", 140, 0, 3000, 10 },
		{ "burst_speed", "Burst speed (px/s)", "float", 320, 0, 3000, 10 },
		{ "life", "Lifetime (seconds)", "float", 1.5, 0.2, 8, 0.05 },
		{ "size", "Particle size (px)", "float", 2.4, 0.5, 12, 0.1 },
		{ "spread", "Spawn spread (px)", "float", 7, 0, 150, 1 },
		{ "speed", "Scatter speed (px/s)", "float", 55, 0, 1000, 5 },
		{ "inherit", "Follow cursor motion", "float", 0.22, 0, 1, 0.01 },
		{ "rise", "Float upward (px/s²)", "float", 45, -600, 600, 5 },
		{ "swirl", "Swirl", "float", 90, 0, 1000, 5 },
		{ "swirl_size", "Swirl size (px)", "float", 150, 20, 1000, 10 },
		{ "drag", "Air drag", "float", 1.3, 0, 10, 0.05 },
		{ "glints", "Star glints (%)", "float", 14, 0, 100, 1 },
		{ "rays", "Glint ray length", "float", 4.5, 0, 16, 0.1 },
		{ "twinkle", "Twinkle", "float", 0.7, 0, 1, 0.01 },
		{ "brightness", "Particle brightness", "float", 1.2, 0, 6, 0.05 },
		{ "tint", "Tint", "color", 0xFFFFE6D2 },
		{ "tint_mix", "Tint amount", "float", 0.4, 0, 1, 0.01 },
	},
}

function E.pack(pipe, c)
	pipe:param(0, c.life * 0.45, c.life * 1.3, c.size * 0.35, c.size)
	pipe:param(1, c.spread, c.speed, c.inherit, c.drag)
	pipe:param(2, c.rise, c.swirl, 1 / c.swirl_size, c.glints / 100)
	pipe:param(3, c.twinkle, c.rays, c.brightness, c.brightness * 1.5)
	pipe:param(4, c.tint_mix, c.burst_speed, 0, 0)
	pipe:color(0, c.tint)
end

function E.new(gpu, kernels, w, h)
	return particles.new(E, gpu, kernels, w, h)
end

return E
