// GLSL optics shared by the bubble, droplet and cursor shaders: hash and
// noise, thin-film interference, and the procedural summer sky every soap
// film reflects (gradient sky, sun, clouds, a green hill on the horizon).
// Directions here are y up, z towards the viewer.

export const OPTICS_GLSL = /* glsl */ `
const float PI = 3.14159265;
const float TAU = 6.2831853;

float hash11(float n) {
	return fract(sin(n * 127.1) * 43758.5453);
}

float hash21(vec2 p) {
	vec2 q = fract(p * vec2(0.1031, 0.1030));
	vec2 r = q + dot(q, q.yx + 33.33);
	return fract((r.x + r.y) * r.x);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	float a = hash21(i);
	float b = hash21(i + vec2(1.0, 0.0));
	float c = hash21(i + vec2(0.0, 1.0));
	float d = hash21(i + vec2(1.0, 1.0));
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm3(vec2 p) {
	return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.03 + 7.1) + 0.15 * vnoise(p * 4.1 + 3.7);
}

mat2 rot2(float a) {
	float c = cos(a);
	float s = sin(a);
	return mat2(c, s, -s, c);
}

// Premultiplied "top over under".
vec4 over(vec4 top, vec4 under) {
	return top + under * (1.0 - top.a);
}

// Reflectance of a soap film (n = 1.33) of thickness nm, seen at cosI, as
// RGB normalised so a thick film averages white. Seven wavelengths weighted
// towards sRGB: thick films go pastel, mid films vivid magenta / gold /
// cyan, and very thin films fade to the black film just before a pop.
const float FILM_LAMBDA[7] = float[7](410.0, 450.0, 490.0, 530.0, 570.0, 610.0, 650.0);
const vec3 FILM_WEIGHT[7] = vec3[7](
	vec3(0.10, 0.00, 0.45), vec3(0.10, 0.02, 1.00), vec3(0.00, 0.30, 0.65),
	vec3(0.05, 0.95, 0.10), vec3(0.65, 0.80, 0.00), vec3(1.00, 0.35, 0.00),
	vec3(0.70, 0.05, 0.00));

vec3 thinFilm(float nm, float cosI) {
	float sinT2 = (1.0 - cosI * cosI) / (1.33 * 1.33);
	float opd = 2.0 * 1.33 * nm * sqrt(1.0 - sinT2);
	vec3 c = vec3(0.0);
	for (int i = 0; i < 7; i++) {
		float s = sin(PI * opd / FILM_LAMBDA[i]);
		c += FILM_WEIGHT[i] * s * s;
	}
	return c / (vec3(2.60, 2.47, 2.20) * 0.5);
}

// The summer sky around a bubble. Sun high on the upper left.
const vec3 SUN_DIR = vec3(-0.52, 0.62, 0.59);

vec3 skyEnv(vec3 r, float t) {
	float az = atan(r.x, r.z);
	float e = r.y;
	// Rolling green hill along the horizon.
	float hill = -0.04 + 0.11 * sin(az * 1.3 + 0.6) + 0.05 * sin(az * 3.3 + 1.9) + 0.02 * sin(az * 7.0);
	float zen = clamp(e, 0.0, 1.0);
	vec3 sky = mix(vec3(0.70, 0.93, 1.0), vec3(0.17, 0.53, 0.90), pow(zen, 0.55));
	// Cloud puffs projected onto a dome, drifting.
	vec2 cp = r.xz / (abs(r.y) + 0.35) * 1.6 + vec2(t * 0.02, 0.0);
	float cl = smoothstep(0.52, 0.78, fbm3(cp)) * smoothstep(0.0, 0.25, e);
	sky = mix(sky, vec3(1.0, 1.0, 1.0), cl * 0.9);
	float sd = max(dot(r, SUN_DIR), 0.0);
	sky += vec3(1.0, 0.95, 0.75) * (pow(sd, 400.0) * 6.0 + pow(sd, 18.0) * 0.45);
	if (e < hill) {
		// Sunlit crest, deeper grass below it, then bright haze off the meadow.
		float depth = hill - e;
		vec3 grass = mix(vec3(0.62, 0.92, 0.36), vec3(0.26, 0.68, 0.2), smoothstep(0.0, 0.22, depth));
		grass = mix(grass, vec3(0.62, 0.86, 0.7), smoothstep(0.3, 0.9, depth));
		grass += vec3(0.3, 0.32, 0.12) * smoothstep(0.05, 0.0, depth);
		return grass;
	}
	return sky;
}
`;
