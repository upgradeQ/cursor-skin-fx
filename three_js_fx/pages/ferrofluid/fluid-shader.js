// Raymarched ferrofluid. The quad only covers the fluid's bounding box. World space
// is the screen plane seen through a tilted orthographic camera: x right, y toward
// the viewer (page y / cos(tilt), so floor contact points land exactly on their page
// pixels), z up off the screen. The fluid sits on the z = 0 floor.
import { MAX_DROPS } from './fluid.js';

export const fluidVertex = /* glsl */ `
varying vec2 vPos;

void main() {
	vec4 world = modelMatrix * vec4(position, 1.0);
	vPos = world.xy;
	gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const fluidFragment = /* glsl */ `
precision highp float;

#define MAX_DROPS ${MAX_DROPS}
#define STEPS 48
#define PI 3.14159265

uniform vec4 uHead;               // x, y, radius along motion, radius across
uniform vec4 uHeadB;              // motion dir x, y, height radius, I-beam morph
uniform vec4 uSpike;              // length, tip radius, spin, fillet
uniform vec2 uSpikeB;             // lattice spacing, depth of the focus below the floor
uniform vec4 uStrandA;            // head x, y, magnet x, y
uniform vec4 uStrandB;            // radius at head, radius at magnet, bead radius
uniform vec4 uDrops[MAX_DROPS];   // x, y, radius, height scale
uniform vec4 uDropsV[MAX_DROPS];  // stretch dir x, y, stretch
uniform int uCount;
uniform float uZTop;
uniform float uTime;
uniform float uOpacity;
uniform float uAA;
uniform vec2 uTilt;               // sin, cos

varying vec2 vPos;

float smin(float a, float b, float k) {
	float h = max(k - abs(a - b), 0.0) / k;
	return min(a, b) - h * h * k * 0.25;
}

float sdEllipsoid(vec3 p, vec3 r) {
	float k0 = length(p / r);
	float k1 = length(p / (r * r));
	return k1 < 1e-5 ? -min(r.x, min(r.y, r.z)) : k0 * (k0 - 1.0) / k1;
}

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
	vec3 pa = p - a;
	vec3 ba = b - a;
	float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
	return length(pa - ba * h) - r;
}

float dot2(vec3 v) { return dot(v, v); }

float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
	vec3 ba = b - a;
	float l2 = dot(ba, ba);
	float rr = r1 - r2;
	float a2 = l2 - rr * rr;
	float il2 = 1.0 / l2;
	vec3 pa = p - a;
	float y = dot(pa, ba);
	float z = y - l2;
	float x2 = dot2(pa * l2 - ba * y);
	float y2 = y * y * l2;
	float z2 = z * z * l2;
	float k = sign(rr) * rr * rr * x2;
	if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
	if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
	return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

// One spike of the lattice cell centred at c (floor-plane coordinates, already rotated
// back). Spikes follow field lines fanning out from a focus below the bead, so every
// spike stays inside the cell its axis was projected from.
float spikeCone(vec3 l, vec2 c, vec3 rad, float base0) {
	float f = uSpikeB.y;
	vec3 dir = normalize(vec3(c, f));
	vec3 a = vec3(0.0, 0.0, -f) / rad;
	vec3 b = dir / rad;
	float A = dot(b, b);
	float B = dot(a, b);
	float C = dot(a, a) - 1.0;
	float disc = B * B - A * C;
	if (disc < 0.0) return 1e4;
	float t = (-B + sqrt(disc)) / A;
	vec3 base = vec3(0.0, 0.0, -f) + dir * t;
	float e = length(base.xy / rad.xy);
	float len = uSpike.x * (1.0 - 0.6 * e * e) * (0.82 + 0.36 * hash(dot(c, vec2(1.7, 9.3))));
	if (e > 0.97 || base.z < 0.0) return 1e4;
	float br = base0 * (base.z + f) / f;
	return sdRoundCone(l, base - dir * br, base + dir * len, br, uSpike.y);
}

// Rosensweig peaks: a hexagonal array of cones over the bead, slowly rotating.
float spikes(vec3 l, vec3 rad, float d) {
	float f = uSpikeB.y;
	vec2 q = l.xy * f / max(l.z + f, 1e-3);
	float cs = cos(uSpike.z);
	float sn = sin(uSpike.z);
	mat2 rot = mat2(cs, sn, -sn, cs);
	q = rot * q;
	float sp = uSpikeB.x;
	vec2 R = vec2(1.0, 1.7320508) * sp;
	vec2 ga = mod(q, R) - 0.5 * R;
	vec2 gb = mod(q - 0.5 * R, R) - 0.5 * R;
	mat2 back = mat2(cs, -sn, sn, cs);
	float base0 = 0.5 * sp;
	float dc = min(spikeCone(l, back * (q - ga), rad, base0), spikeCone(l, back * (q - gb), rad, base0));
	return smin(d, dc, uSpike.w);
}

float sdIBeam(vec3 q) {
	float h = 11.0 / uTilt.y;
	float d = sdCapsule(q, vec3(0.0, -h, 0.0), vec3(0.0, h, 0.0), 2.4);
	d = smin(d, sdCapsule(q, vec3(-4.6, -h, 0.0), vec3(4.6, -h, 0.0), 2.0), 2.5);
	d = smin(d, sdCapsule(q, vec3(-4.6, h, 0.0), vec3(4.6, h, 0.0), 2.0), 2.5);
	return d;
}

float headSDF(vec3 p) {
	vec3 q = p - vec3(uHead.xy, 0.0);
	float d = 1e4;
	if (uHead.z > 0.3) {
		vec2 dir = uHeadB.xy;
		vec3 l = vec3(dot(q.xy, dir), dot(q.xy, vec2(-dir.y, dir.x)), q.z);
		vec3 rad = vec3(uHead.zw, uHeadB.z);
		d = sdEllipsoid(l, rad);
		if (uSpike.x > 0.05 && d < uSpike.x * 1.25 + 2.0) d = spikes(l, rad, d);
	}
	if (uHeadB.w > 0.002) d = mix(d, sdIBeam(q), clamp(uHeadB.w, 0.0, 1.0));
	return d;
}

float map(vec3 p) {
	float d = headSDF(p);
	if (uStrandB.x > 0.05) {
		float ds = sdRoundCone(p, vec3(uStrandA.xy, 0.0), vec3(uStrandA.zw, 0.0), uStrandB.x, uStrandB.y);
		d = smin(d, ds, 6.0);
	}
	if (uStrandB.z > 0.2) {
		vec3 q = p - vec3(uStrandA.zw, 0.0);
		d = smin(d, length(vec3(q.xy, q.z * 1.2)) - uStrandB.z, 6.0);
	}
	for (int i = 0; i < MAX_DROPS; i++) {
		if (i >= uCount) break;
		vec4 a = uDrops[i];
		vec3 q = p - vec3(a.xy, 0.0);
		vec4 v = uDropsV[i];
		float reach = d + a.z * v.z + 6.0;
		if (dot(q.xy, q.xy) > reach * reach) continue;
		vec3 l = vec3(dot(q.xy, v.xy), dot(q.xy, vec2(-v.y, v.x)), q.z);
		float is = inversesqrt(v.z);
		d = smin(d, sdEllipsoid(l, a.z * vec3(v.z, is, a.w * is)), 5.0);
	}
	return d;
}

vec3 calcNormal(vec3 p) {
	const vec2 k = vec2(1.0, -1.0);
	const float e = 0.3;
	return normalize(k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) +
		k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
}

// Soft-box light seen in direction r: a rounded rectangle on the plane one unit along c.
float softbox(vec3 r, vec3 c, vec3 up, vec2 size, float soft) {
	float f = dot(r, c);
	if (f < 0.05) return 0.0;
	vec3 ux = normalize(cross(c, up));
	vec3 uy = cross(ux, c);
	vec2 uv = vec2(dot(r, ux), dot(r, uy)) / f;
	vec2 q = abs(uv) - size;
	float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
	return 1.0 - smoothstep(-soft, soft, d);
}

vec3 studio(vec3 r) {
	const vec3 up = vec3(0.0, 0.0, 1.0);
	vec3 col = mix(vec3(0.0015, 0.0018, 0.0025), vec3(0.01, 0.012, 0.018), smoothstep(-0.05, 1.0, r.z));
	col += vec3(0.012, 0.012, 0.014) * smoothstep(0.0, -0.7, r.z);
	col += vec3(0.16, 0.18, 0.24) * exp(-abs(r.z - 0.03) * 18.0);
	col += vec3(1.0, 0.98, 0.95) * 6.0 * softbox(r, normalize(vec3(-0.32, -0.58, 0.75)), vec3(0.0, 1.0, 0.0), vec2(0.55, 0.26), 0.04);
	col += vec3(0.8, 0.9, 1.0) * 3.0 * softbox(r, normalize(vec3(-0.95, 0.12, 0.3)), up, vec2(0.07, 0.55), 0.025);
	col += vec3(1.0, 0.8, 0.58) * 2.6 * softbox(r, normalize(vec3(0.8, -0.4, 0.42)), up, vec2(0.08, 0.42), 0.025);
	col += vec3(0.7, 0.8, 1.0) * 1.0 * softbox(r, normalize(vec3(0.1, 0.85, 0.5)), up, vec2(0.7, 0.05), 0.04);
	return col;
}

vec3 shade(vec3 p, vec3 n, vec3 rd) {
	float ndv = clamp(dot(n, -rd), 0.0, 1.0);
	vec3 r = reflect(rd, n);
	float fre = 0.05 + 0.95 * pow(1.0 - ndv, 5.0);
	vec3 refl = studio(r) * mix(0.3, 1.0, fre);

	// Thin oil film: an interference tint drifting slowly over the surface, strongest at grazing angles.
	float film = 0.55 + 0.25 * sin(p.x * 0.09 + p.y * 0.07 + uTime * 0.7) + 0.2 * sin(p.y * 0.13 - p.x * 0.05 - uTime * 0.9);
	vec3 tint = 0.5 + 0.5 * cos(6.2832 * (film * (1.6 - ndv) + vec3(0.0, 0.3, 0.62)));
	refl *= mix(vec3(1.0), tint * 1.4, 0.1 + 0.25 * pow(1.0 - ndv, 2.0));
	refl += tint * vec3(0.02, 0.015, 0.03) * pow(1.0 - ndv, 2.0);

	vec3 col = refl + vec3(0.5, 0.6, 0.78) * pow(1.0 - ndv, 7.0) * 0.5;
	col = 1.0 - exp(-col * 1.2);
	return pow(col, vec3(1.0 / 2.2));
}

void main() {
	float sT = uTilt.x;
	float cT = uTilt.y;
	vec3 rd = vec3(0.0, -sT, -cT);
	vec3 floorP = vec3(vPos.x, vPos.y / cT, 0.0);
	float tMax = uZTop / cT;
	float dFloor = map(floorP);

	float shadow = 0.0;
	if (dFloor < 16.0) {
		float ds = map(floorP + vec3(-1.5, -5.0, 0.0));
		shadow = 0.34 * (1.0 - smoothstep(-2.0, 11.0, ds)) + 0.3 * (1.0 - smoothstep(0.0, 3.5, dFloor));
	}

	float cov = 0.0;
	float edge = dFloor;
	vec3 col = vec3(0.0);
	if (dFloor < tMax + 2.0) {
		vec3 ro = floorP - rd * tMax;
		float t = 0.0;
		float dmin = 1e9;
		float tmin = 0.0;
		float stepScale = uSpike.x > 0.05 ? 0.75 : 0.95;
		float pd = 1e9;
		float ps = 0.0;
		for (int i = 0; i < STEPS; i++) {
			float d = map(ro + rd * t);
			// Closest approach between two samples, triangulated from both distance spheres,
			// so near-miss coverage does not depend on where the steps happened to land.
			float y = ps > 0.0 ? clamp((ps * ps + d * d - pd * pd) / (2.0 * ps), 0.0, ps) : 0.0;
			float est = sqrt(max(d * d - y * y, 0.0));
			if (est < dmin) {
				dmin = est;
				tmin = t - y;
			}
			if (d < 0.06 || t > tMax) break;
			pd = d;
			ps = d * stepScale;
			t += ps;
		}
		edge = dmin;
		float aa = 1.1 * uAA;
		cov = 1.0 - smoothstep(0.06, aa, dmin);
		if (cov > 0.0) {
			vec3 p = ro + rd * clamp(tmin, 0.0, tMax);
			vec3 n = calcNormal(p);
			col = shade(p - n * max(dmin, 0.0), n, rd);
		}
	}

	vec4 outCol = vec4(col * cov, cov) + vec4(0.0, 0.0, 0.0, shadow) * (1.0 - cov);
	// Faint cold halo, pure added light: it outlines the black fluid on dark content and
	// vanishes on white, where the contact shadow does that job.
	float halo = 1.0 - smoothstep(0.0, 4.5, edge);
	outCol.rgb += vec3(0.42, 0.5, 0.66) * (0.2 * halo * halo * (1.0 - cov));
	gl_FragColor = outCol * uOpacity;
}
`;
