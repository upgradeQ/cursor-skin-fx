// The Bliss world in GLSL: one palette and two views of the same place. The
// flat view is what the cursor glass looks onto (sky, a drifting cloud, a far
// ridge and a rolling green hill); the 3D view is the little world sealed in
// the orb (a round hill, a round-canopied tree, bushes, flowers and clouds),
// traced analytically with spheres and a capsule.

export const PALETTE_GLSL = /* glsl */ `
const vec3 SKY_ZENITH = vec3(0.04, 0.33, 0.86);
const vec3 SKY_MID = vec3(0.20, 0.62, 0.98);
const vec3 SKY_HAZE = vec3(0.80, 0.95, 1.00);
const vec3 CLOUD_LIT = vec3(1.00, 1.00, 1.00);
const vec3 CLOUD_SHADE = vec3(0.72, 0.85, 0.97);
const vec3 GRASS_SUN = vec3(0.76, 0.96, 0.36);
const vec3 GRASS = vec3(0.42, 0.82, 0.24);
const vec3 GRASS_DEEP = vec3(0.15, 0.58, 0.14);
const vec3 GRASS_SHADE = vec3(0.07, 0.38, 0.13);
const vec3 FAR_HILL = vec3(0.40, 0.76, 0.56);
const vec3 SUN_GOLD = vec3(1.00, 0.86, 0.40);
const vec3 BARK = vec3(0.45, 0.29, 0.14);
const vec3 SOIL = vec3(0.52, 0.33, 0.16);
const vec3 SOIL_DARK = vec3(0.30, 0.18, 0.09);
const vec3 OUTLINE_TEAL = vec3(0.02, 0.22, 0.30);
const vec3 SHADOW_INK = vec3(0.00, 0.09, 0.14);

// 0 at the zenith, 1 at the horizon.
vec3 skyGradient(float y) {
	vec3 a = mix(SKY_ZENITH, SKY_MID, smoothstep(0.0, 0.6, y));
	return mix(a, SKY_HAZE, smoothstep(0.5, 1.0, y));
}

// A soft cumulus with a flat base, about 2 units wide: signed distance.
float cloudShape(vec2 p) {
	float d1 = length(p - vec2(-0.50, 0.08)) - 0.36;
	float d2 = length(p - vec2(0.02, -0.12)) - 0.52;
	float d3 = length(p - vec2(0.55, 0.08)) - 0.33;
	return max(min(min(d1, d2), d3), p.y - 0.24);
}
`;

// L is in shape heights: x across from the shape's centre, y from 0 at its top
// to 1 at its bottom. Shifts pan the layers, aa is one device pixel in L units.
export const LANDSCAPE_GLSL = /* glsl */ `
vec3 bliss2D(vec2 L, float hillShift, float cloudShift, float horizon, float aa, float t) {
	vec3 col = skyGradient(clamp(L.y / horizon, 0.0, 1.0));
	// warm light from the sun off the top left
	vec2 sp = L - vec2(-0.65, -0.05);
	col += SUN_GOLD * 0.30 * exp(-dot(sp, sp) * 5.0);

	// one cloud drifting through, wrapping round
	float span = 1.5;
	float cx = fract((L.x + cloudShift - t * 0.045) / span + 0.5) * span - span * 0.5;
	float cs = 0.24;
	vec2 cp = vec2(cx, L.y - horizon * 0.6) / cs;
	float cd = cloudShape(cp) * cs;
	float cloud = 1.0 - smoothstep(-aa - 0.02, aa + 0.012, cd);
	vec3 cloudCol = mix(CLOUD_LIT, CLOUD_SHADE, smoothstep(-0.35, 0.25, cp.y));
	col = mix(col, cloudCol, cloud * 0.95);

	// a far ridge, hazy blue-green
	float far = horizon - 0.05 + 0.045 * sin((L.x + hillShift * 0.55) * 4.2 + 1.3);
	float farK = smoothstep(far - aa, far + aa, L.y);
	col = mix(col, mix(FAR_HILL, GRASS, smoothstep(far, far + 0.3, L.y) * 0.5), farK);

	// the hill: a rounded hump rolling into the meadow
	float hx = L.x + hillShift;
	float crest = horizon + 0.05 - 0.24 * exp(-hx * hx * 3.2);
	float k = L.y - crest;
	float hill = smoothstep(-aa, aa, k);
	vec3 g = mix(GRASS_SUN, GRASS, smoothstep(0.0, 0.16, k));
	g = mix(g, GRASS_DEEP, smoothstep(0.12, 0.55, k));
	// lit on the sun side of the hump, a little shade on the far slope
	float slope = hx * exp(-hx * hx * 3.2);
	g *= 1.0 + clamp(-slope * 1.4, -0.22, 0.18);
	col = mix(col, g, hill);
	return col;
}
`;

// Orb interior, in world units (orb radius 1, y up). All lighting directions
// arrive already turned into world space.
export const SCENE_GLSL = /* glsl */ `
const vec3 HILL_C = vec3(0.0, -1.62, 0.0);
const float HILL_R = 1.42;
const vec3 TRUNK_A = vec3(0.10, -0.26, 0.06);
const vec3 TRUNK_B = vec3(0.10, 0.22, 0.06);
const float TRUNK_R = 0.042;
const vec3 CANOPY_DARK = vec3(0.07, 0.36, 0.12);
const vec3 CANOPY_LIGHT = vec3(0.55, 0.90, 0.26);
const vec3 FLOWER_A = vec3(1.0, 0.92, 0.30);
const vec3 FLOWER_B = vec3(1.0, 1.0, 0.96);

// Nearest positive hit of a ray with a sphere, or -1.
float sphereHit(vec3 ro, vec3 rd, vec3 c, float r) {
	vec3 oc = ro - c;
	float b = dot(oc, rd);
	float h = b * b - (dot(oc, oc) - r * r);
	if (h < 0.0) return -1.0;
	float s = sqrt(h);
	float t0 = -b - s;
	if (t0 > 0.0) return t0;
	return -b + s > 0.0 ? -b + s : -1.0;
}

// Ray against a capsule (iq), -1 on a miss.
float capsuleHit(vec3 ro, vec3 rd, vec3 pa, vec3 pb, float ra) {
	vec3 ba = pb - pa;
	vec3 oa = ro - pa;
	float baba = dot(ba, ba);
	float bard = dot(ba, rd);
	float baoa = dot(ba, oa);
	float rdoa = dot(rd, oa);
	float oaoa = dot(oa, oa);
	float a = baba - bard * bard;
	float b = baba * rdoa - baoa * bard;
	float c = baba * oaoa - baoa * baoa - ra * ra * baba;
	float h = b * b - a * c;
	if (h >= 0.0) {
		float t = (-b - sqrt(h)) / a;
		float y = baoa + t * bard;
		if (y > 0.0 && y < baba) return t;
		vec3 oc = y <= 0.0 ? oa : ro - pb;
		float b2 = dot(rd, oc);
		float c2 = dot(oc, oc) - ra * ra;
		float h2 = b2 * b2 - c2;
		if (h2 > 0.0) return -b2 - sqrt(h2);
	}
	return -1.0;
}

const vec4 CANOPY[6] = vec4[6](
	vec4(0.10, 0.38, 0.06, 0.25),
	vec4(-0.10, 0.27, 0.12, 0.17),
	vec4(0.29, 0.28, 0.00, 0.17),
	vec4(0.13, 0.54, -0.02, 0.15),
	vec4(-0.50, -0.25, -0.22, 0.12),   // bushes on the meadow
	vec4(-0.37, -0.27, -0.30, 0.09)
);

vec3 innerSky(vec3 rd, vec3 sun) {
	// the world leans toward the viewer, so even the highest rays look only a
	// little upward: the gradient spans a narrow band of elevations
	float y = clamp(1.0 - (rd.y + 0.22) / 0.62, 0.0, 1.0);
	vec3 c = skyGradient(y);
	float sd = max(dot(rd, sun), 0.0);
	c += SUN_GOLD * (pow(sd, 5.0) * 0.30 + pow(sd, 60.0) * 0.9);
	c += vec3(1.0) * smoothstep(0.995, 0.999, sd);
	return c;
}

vec3 grassAt(vec3 p, vec3 rd, vec3 L) {
	vec3 n = normalize(p - HILL_C);
	float dif = max(dot(n, L), 0.0);
	vec3 c = mix(GRASS_DEEP, GRASS_SUN, smoothstep(0.05, 0.95, dif));
	// sheen along the crest
	c += vec3(0.10, 0.12, 0.02) * pow(max(n.y, 0.0), 10.0);
	// flowers dotted over the meadow
	vec2 cell = floor(p.xz * 9.0);
	float h = hash21(cell);
	vec2 fp = (cell + 0.5 + (vec2(hash21(cell + 7.1), hash21(cell + 3.7)) - 0.5) * 0.6) / 9.0;
	float fd = length(p.xz - fp);
	float flower = (1.0 - smoothstep(0.014, 0.024, fd)) * step(0.72, h);
	c = mix(c, h > 0.86 ? FLOWER_A : FLOWER_B, flower);
	// the tree's shadow
	vec4 c0 = CANOPY[0];
	if (sphereHit(p + n * 0.01, L, c0.xyz, c0.w * 0.95) > 0.0) c *= vec3(0.74, 0.80, 0.86);
	return c;
}

vec3 canopyAt(vec3 p, vec4 c, vec3 rd, vec3 L) {
	vec3 n = normalize(p - c.xyz);
	// leafy clumps: a little noise on the lighting
	float clump = noise2(vec2(atan(n.z, n.x) * 2.6, n.y * 4.0) + c.xz * 9.0);
	float dif = clamp(dot(n, L) * 0.55 + 0.45 + (clump - 0.5) * 0.45, 0.0, 1.0);
	vec3 col = mix(CANOPY_DARK, CANOPY_LIGHT, dif);
	// light through the leaves at the silhouette
	float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
	col += vec3(0.35, 0.45, 0.05) * rim * 0.6;
	return col;
}

vec3 soilAt(vec3 p, float depth) {
	if (depth < 0.05) return mix(GRASS_SUN, GRASS_DEEP, depth / 0.05);
	float band = 0.5 + 0.5 * sin(depth * 46.0 + noise2(p.xz * 7.0) * 3.0);
	vec3 c = mix(SOIL_DARK, SOIL, 0.35 + 0.4 * band);
	float peb = noise2(p.xy * 26.0 + p.z * 9.0);
	c = mix(c, vec3(0.80, 0.68, 0.50), smoothstep(0.78, 0.86, peb) * 0.7);
	return c * (1.0 - smoothstep(0.1, 0.8, depth) * 0.35);
}

vec3 sceneClouds(vec3 ro, vec3 rd, float tMax, vec3 base, vec3 L, float t) {
	vec3 col = base;
	for (int i = 0; i < 3; i++) {
		float fi = float(i);
		float ang = t * 0.16 + fi * 2.094;
		vec3 ctr = vec3(cos(ang) * 0.56, 0.50 + 0.08 * fi, sin(ang) * 0.56);
		for (int j = 0; j < 2; j++) {
			vec3 off = vec3(-sin(ang), 0.0, cos(ang)) * (float(j) * 0.16 - 0.08) + vec3(0.0, float(j) * 0.04, 0.0);
			vec3 c = ctr + off;
			float tc = clamp(dot(c - ro, rd), 0.0, tMax);
			vec3 q = (ro + rd * tc - c) * vec3(1.0, 1.7, 1.0);
			float dd = length(q);
			float dens = 1.0 - smoothstep(0.08, 0.17, dd);
			vec3 lit = mix(CLOUD_SHADE, CLOUD_LIT, smoothstep(-0.08, 0.1, q.y + dot(q, L) * 0.4));
			col = mix(col, lit, dens * 0.95);
		}
	}
	return col;
}

// Colour seen along a ray that entered the orb at ro (on the unit sphere).
vec3 sceneColor(vec3 ro, vec3 rd, vec3 L, vec3 sun, float t) {
	float tExit = -2.0 * dot(ro, rd);
	// looking straight into the soil where the glass cuts the hill
	float depth = HILL_R - length(ro - HILL_C);
	if (depth > 0.0) return soilAt(ro, depth);

	float tHit = tExit;
	int mat = 0;
	vec4 sph = vec4(0.0);
	float th = sphereHit(ro, rd, HILL_C, HILL_R);
	if (th > 0.0 && th < tHit) { tHit = th; mat = 1; }
	float tt = capsuleHit(ro, rd, TRUNK_A, TRUNK_B, TRUNK_R);
	if (tt > 0.0 && tt < tHit) { tHit = tt; mat = 2; }
	for (int i = 0; i < 6; i++) {
		vec4 s = CANOPY[i];
		float ts = sphereHit(ro, rd, s.xyz, s.w);
		if (ts > 0.0 && ts < tHit) { tHit = ts; mat = 3; sph = s; }
	}

	vec3 p = ro + rd * tHit;
	vec3 col = vec3(0.0);
	if (mat == 1) {
		col = grassAt(p, rd, L);
	} else if (mat == 2) {
		vec3 ax = TRUNK_B - TRUNK_A;
		float h = clamp(dot(p - TRUNK_A, ax) / dot(ax, ax), 0.0, 1.0);
		vec3 n = normalize(p - (TRUNK_A + ax * h));
		col = BARK * (0.45 + 0.75 * max(dot(n, L), 0.0));
	} else if (mat == 3) {
		col = canopyAt(p, sph, rd, L);
	} else {
		col = innerSky(rd, sun);
	}
	return sceneClouds(ro, rd, tHit, col, L, t);
}
`;
