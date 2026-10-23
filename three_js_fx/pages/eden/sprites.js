// Instanced sprites for everything small that flies, falls or flashes: leaves,
// petals, butterflies, sparkles, soap bubbles and the lens-flare pieces, plus
// the god-ray fan. Particles live in a fixed ring of slots simulated on the
// CPU; owners of attached effects add one-frame sprites with put(). Each
// frame the live ones are packed by layer into one instance buffer per layer
// and drawn with one call per layer. Every kind is drawn procedurally in the
// shader.
import { layerMesh, ORDER, premultipliedMaterial, streamGeometry, uploadPrefix } from './gl.js';

export const KIND = {
	sparkle: 0, leaf: 1, petal: 2, butterfly: 3, ghost: 4, starburst: 5,
	streak: 6, glow: 7, bubble: 8, rays: 9, ring: 10,
};
// 0 under the aurora, 1 between the aurora and the orb, 2 above the cursor.
// Flares and glows stay under the cursor so it is never buried.
const LAYER_OF = [2, 1, 1, 2, 1, 1, 1, 1, 1, 0, 1];
export const LAYERS = 3;
const LAYER_ORDER = [ORDER.spritesBack, ORDER.spritesMid, ORDER.spritesTop];

const CAPACITY = 1024;         // simulated particles
const IMMEDIATE = 64;          // one-frame sprites per frame
const FLOATS = 16;             // per instance: see the attributes in the shader

const DEFAULTS = {
	vx: 0, vy: 0, gx: 0, gy: 0, drag: 0, rot: 0, spin: 0, w: 6, h: 0, grow: 1,
	life: 1, fadeIn: 0.05, fadeOut: 0.3, r: 1, g: 1, b: 1, a: 1, add: 0,
	flip: 0, flipRate: 0, flap: 0, flapRate: 0, flutter: 0, faceVel: 0, seed: -1,
};

const VERTEX = /* glsl */ `
in vec2 position;
in vec4 iA;   // centre xy, half size xy (page px)
in vec4 iB;   // rotation, kind, age 0..1, seed
in vec4 iC;   // tint rgb, opacity
in vec4 iD;   // flip, flap, additive share, spare

out vec2 vUv;
flat out vec4 vB;
flat out vec4 vC;
flat out vec4 vD;
flat out vec2 vSize;

void main() {
	vec2 local = position * iA.zw;
	float kind = iB.y;
	// leaves and petals turn about their long axis; butterflies fold their wings
	if (kind == 1.0 || kind == 2.0) local.y *= cos(iD.x);
	if (kind == 3.0) local.x *= max(abs(cos(iD.y)), 0.1);
	gl_Position = clipFromPage(iA.xy + rot2(iB.x, local));
	vUv = position;
	vB = iB;
	vC = iC;
	vD = iD;
	vSize = iA.zw;
}
`;

const FRAGMENT = /* glsl */ `
in vec2 vUv;
flat in vec4 vB;
flat in vec4 vC;
flat in vec4 vD;
flat in vec2 vSize;
out vec4 fragColor;

// Coverage of d < 0 with an edge aa wide.
float cover(float d, float aa) {
	return clamp(0.5 - d / aa, 0.0, 1.0);
}

vec4 sparkle(vec2 uv, vec3 tint, float add) {
	vec2 a = abs(uv);
	float r2 = dot(uv, uv);
	float rays = exp(-a.x * 14.0) * max(1.0 - a.y, 0.0) + exp(-a.y * 14.0) * max(1.0 - a.x, 0.0);
	float core = exp(-r2 * 36.0);
	float halo = exp(-r2 * 5.0) * 0.3;
	float light = rays * 0.9 + core + halo;
	vec3 rgb = mix(tint, vec3(1.0), clamp(core * 1.2 + rays * 0.35, 0.0, 1.0));
	float alpha = clamp(core * 0.9 + rays * 0.5 + halo * 0.8, 0.0, 1.0) * (1.0 - add);
	return vec4(rgb * light, alpha);
}

vec4 leaf(vec2 uv, vec3 tint, float aa, float back, float seed) {
	// blade along x, stem end at -1; two arcs meet at the tips
	vec2 p = vec2(uv.x * 1.06 + 0.04, abs(uv.y));
	float R = 1.16;
	float off = R - 0.48;
	float d = length(p - vec2(0.0, -off)) - R;
	float stem = max(abs(uv.y) - 0.05, abs(uv.x + 0.95) - 0.08);
	float shape = min(d, stem);
	float cov = cover(shape, aa);
	if (cov <= 0.0) return vec4(0.0);
	vec3 col = tint * mix(1.08, 0.82, smoothstep(-0.4, 0.4, uv.y));
	col = mix(col, col * vec3(0.85, 0.95, 0.6) + vec3(0.08, 0.06, 0.0), back);
	// midrib and veins, a lighter green
	float rib = exp(-uv.y * uv.y / 0.003) * step(uv.x, 0.85);
	float vein = smoothstep(0.86, 0.98, sin((uv.x * 2.4 - abs(uv.y) * 2.6) * 6.0)) * step(abs(uv.y), 0.36);
	col = mix(col, vec3(0.86, 1.0, 0.62), rib * 0.6 + vein * 0.25);
	// a wet gloss along the upper half
	float gy = uv.y + 0.2;
	float gl = exp(-gy * gy / 0.02) * (1.0 - back) * (1.0 - smoothstep(-0.3, 0.9, abs(uv.x)));
	col = mix(col, vec3(1.0), gl * 0.45);
	// a darker rim so the leaf reads on white
	float rim = smoothstep(-0.16, -0.02, shape);
	col = mix(col, tint * vec3(0.30, 0.45, 0.30), rim * 0.75);
	return vec4(col, 1.0) * cov;
}

vec4 petal(vec2 uv, vec3 tint, float aa, float back) {
	// base at x = -1, rounded tip with a small notch at +1
	float t = clamp((uv.x + 1.0) * 0.5, 0.0, 1.0);
	float halfW = 0.16 + 0.62 * sin(t * 2.75) * (0.55 + 0.45 * t);
	float d = max(abs(uv.y) - halfW, abs(uv.x) - 0.96) * 0.8;
	d = max(d, -(length(uv - vec2(1.06, 0.0)) - 0.2));
	float cov = cover(d, aa);
	if (cov <= 0.0) return vec4(0.0);
	vec3 col = mix(vec3(1.0, 0.82, 0.25), tint, smoothstep(0.0, 0.45, t));
	col *= mix(1.0, 0.86, back);
	float sheen = (uv.y + halfW * 0.4) / 0.12;
	col += vec3(0.12) * exp(-sheen * sheen) * (1.0 - back);
	float rim = smoothstep(-0.14, -0.01, d);
	col = mix(col, tint * vec3(0.62, 0.66, 0.50), rim * 0.65);
	return vec4(col, 1.0) * cov;
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
	vec2 pa = p - a;
	vec2 ba = b - a;
	float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
	return length(pa - ba * h);
}

float ellipseD(vec2 p, vec2 c, vec2 r, float a) {
	vec2 q = rot2(-a, p - c) / r;
	return (length(q) - 1.0) * min(r.x, r.y);
}

vec4 butterfly(vec2 uv, vec3 tint, float aa, float seed) {
	vec2 p = vec2(abs(uv.x), uv.y);
	float up = ellipseD(p, vec2(0.46, -0.24), vec2(0.50, 0.38), -0.5);
	float low = ellipseD(p, vec2(0.32, 0.34), vec2(0.32, 0.28), 0.45);
	float wing = min(up, low);
	float body = max(abs(uv.x) - 0.07, abs(uv.y - 0.05) - 0.55);
	float ant = sdSegment(p, vec2(0.02, -0.5), vec2(0.24, -0.94)) - 0.03;
	float knob = length(p - vec2(0.25, -0.96)) - 0.055;
	float dark = min(min(body, ant), knob);
	float shape = min(wing, dark);
	float cov = cover(shape, aa);
	if (cov <= 0.0) return vec4(0.0);
	// wings: deep near the body, bright at the edge, a dark border with white spots
	float k = smoothstep(0.05, 0.75, length(p));
	vec3 col = mix(tint * 0.55, mix(tint, vec3(1.0), 0.35), k);
	float border = smoothstep(-0.13, -0.06, wing);
	col = mix(col, tint * 0.18 + vec3(0.02, 0.03, 0.08), border);
	float spot = 1.0 - smoothstep(0.14, 0.22, length(fract(p * 6.0 + seed) - 0.5));
	col = mix(col, vec3(1.0), spot * border * step(0.2, p.x));
	// gloss on the upper wings
	float gl = exp(-dot(p - vec2(0.4, -0.38), p - vec2(0.4, -0.38)) / 0.03);
	col = mix(col, vec3(1.0), gl * 0.5);
	float isDark = cover(dark - 0.005, aa);
	col = mix(col, vec3(0.06, 0.08, 0.12), isDark);
	return vec4(col, 1.0) * cov;
}

float sdHex(vec2 p, float r) {
	vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
	vec2 q = abs(p);
	q -= 2.0 * min(dot(k.xy, q), 0.0) * k.xy;
	q -= vec2(clamp(q.x, -k.z * r, k.z * r), r);
	return length(q) * sign(q.y);
}

vec4 ghost(vec2 uv, vec3 tint, float add) {
	float d = sdHex(uv, 0.8);
	// soft, out of focus: a gentle fill brightening toward a blurred rim
	float fill = (1.0 - smoothstep(-0.3, 0.08, d)) * (0.5 + 0.5 * smoothstep(-0.8, 0.0, d));
	float rim = exp(-abs(d + 0.04) * 9.0) * 0.35;
	float light = fill * 0.4 + rim;
	return vec4(tint * light, (fill * 0.14 + rim * 0.12) * (1.0 - add));
}

vec4 starburst(vec2 uv, vec3 tint, float add, float age, float seed) {
	float r = length(uv);
	float a = atan(uv.y, uv.x);
	float core = exp(-r * r * 110.0);
	float glow = exp(-r * 5.5) * 0.45;
	float reach = 1.0 - age * 0.5;
	float rays = pow(0.5 + 0.5 * cos(a * 6.0 + seed * 6.0), 24.0) * exp(-r * 3.0 / reach);
	rays += pow(0.5 + 0.5 * cos(a * 11.0 + seed * 13.0), 40.0) * exp(-r * 4.0 / reach) * 0.7;
	// a faint rainbow ring opening outwards
	float rr = (r - 0.55 - age * 0.3) / 0.035;
	float ring = exp(-rr * rr) * 0.35;
	vec3 hue = mix(vec3(0.55, 1.0, 0.55), vec3(0.45, 0.85, 1.0), 0.5 + 0.5 * sin(r * 30.0));
	float light = core * 1.2 + glow + rays;
	vec3 rgb = mix(tint, vec3(1.0), clamp(core * 1.5, 0.0, 1.0)) * light + hue * ring;
	return vec4(rgb, clamp(core * 0.9 + glow * 0.45 + rays * 0.35 + ring * 0.4, 0.0, 1.0) * (1.0 - add));
}

vec4 streak(vec2 uv, vec3 tint, float add) {
	float along = max(1.0 - abs(uv.x), 0.0);
	float line = exp(-uv.y * uv.y * 30.0) * along * along * along;
	float core = exp(-(uv.x * uv.x * 300.0 + uv.y * uv.y * 4.0));
	float light = line + core;
	vec3 rgb = mix(tint, vec3(1.0), clamp(core + line * 0.3, 0.0, 1.0)) * light;
	return vec4(rgb, clamp(line * 0.45 + core * 0.7, 0.0, 1.0) * (1.0 - add));
}

vec4 softGlow(vec2 uv, vec3 tint, float add) {
	float r2 = dot(uv, uv);
	float k = exp(-r2 * 4.5) * (1.0 - smoothstep(0.7, 1.0, r2));
	return vec4(tint * k, k * 0.6 * (1.0 - add));
}

vec4 bubble(vec2 uv, float aa, float age, float seed) {
	float r = length(uv);
	float cov = cover(r - 1.0, aa);
	if (cov <= 0.0) return vec4(0.0);
	float film = smoothstep(0.62, 0.97, r);
	float hue = atan(uv.y, uv.x) / TAU + r * 1.4 + seed + age * 0.6;
	vec3 irid = 0.62 + 0.38 * cos(TAU * (hue + vec3(0.0, 0.33, 0.67)));
	float hl = exp(-dot(uv - vec2(-0.38, -0.42), uv - vec2(-0.38, -0.42)) / 0.03);
	float hl2 = exp(-dot(uv - vec2(0.42, 0.45), uv - vec2(0.42, 0.45)) / 0.012) * 0.6;
	float edge = smoothstep(0.88, 0.99, r);
	vec3 rgb = irid * film * 0.9 + vec3(1.0) * (hl + hl2);
	rgb = mix(rgb, vec3(0.12, 0.42, 0.58), edge * 0.35);
	float alpha = clamp(0.05 + film * 0.42 + hl * 0.85 + hl2 + edge * 0.2, 0.0, 1.0);
	return vec4(rgb * alpha, alpha) * cov;
}

vec4 godRays(vec2 uv, vec3 tint, float add, float seed) {
	float r = length(uv);
	float a = atan(uv.y, uv.x);
	float r1 = pow(0.5 + 0.5 * cos(a * 9.0), 7.0);
	float r2 = pow(0.5 + 0.5 * cos(a * 14.0 + 1.7 + sin(a * 3.0 + seed) * 0.6), 12.0);
	float rays = max(r1, r2 * 0.85);
	float fall = pow(max(1.0 - r, 0.0), 1.7) * smoothstep(0.03, 0.16, r);
	float core = exp(-r * r * 500.0) * 0.8;
	vec3 warm = mix(tint, vec3(1.0, 0.96, 0.78), exp(-r * 6.0) * 0.7);
	float light = rays * fall * 0.95 + core + exp(-r * 9.0) * 0.18;
	float alpha = clamp(rays * fall * 0.40 + core * 0.4 + exp(-r * 9.0) * 0.08, 0.0, 1.0) * (1.0 - add);
	return vec4(warm * light, alpha);
}

vec4 ringWave(vec2 uv, vec3 tint, float aa, float age) {
	float r = length(uv);
	float w = 0.07 * (1.0 - age * 0.6);
	float k = (r - 0.88) / w;
	float band = exp(-k * k);
	float inner = exp(-(0.88 - r) * 9.0) * 0.12 * step(r, 0.88);
	vec3 rgb = mix(tint, vec3(1.0), band * 0.7);
	// a deeper line just inside the bright one, so the ring reads on white
	float dk = (r - 0.88 + w * 1.5) / (w * 0.6);
	float dark = exp(-dk * dk) * 0.4 * (1.0 - age);
	return over(vec4(rgb * (band + inner), band * 0.55 + inner * 0.5), vec4(tint * 0.3 * dark, dark));
}

void main() {
	int kind = int(vB.y + 0.5);
	float age = vB.z;
	float seed = vB.w;
	vec3 tint = vC.rgb;
	float add = vD.z;
	float aa = 1.4 / (max(min(vSize.x, vSize.y), 0.5) * uPr);
	float back = cos(vD.x) < 0.0 ? 1.0 : 0.0;
	vec4 c = vec4(0.0);
	switch (kind) {
		case 0: c = sparkle(vUv, tint, add); break;
		case 1: c = leaf(vUv, tint, aa, back, seed); break;
		case 2: c = petal(vUv, tint, aa, back); break;
		case 3: c = butterfly(vUv, tint, aa, seed); break;
		case 4: c = ghost(vUv, tint, add); break;
		case 5: c = starburst(vUv, tint, add, age, seed); break;
		case 6: c = streak(vUv, tint, add); break;
		case 7: c = softGlow(vUv, tint, add); break;
		case 8: c = bubble(vUv, aa, age, seed); break;
		case 9: c = godRays(vUv, tint, add, seed); break;
		case 10: c = ringWave(vUv, tint, aa, age); break;
		default: break;
	}
	// Flares, glows and rays are light: give them colour to show on white pages.
	if (kind == 0 || (kind >= 4 && kind <= 7)) c = underInk(c, tint, 0.5);
	else if (kind == 9) c = underInk(c, tint, 0.75);
	else if (kind == 10) c = underInk(c, tint, 0.45);
	fragColor = c * vC.a;
}
`;

const rand = Math.random;

export class Sprites {
	constructor(scene) {
		const material = premultipliedMaterial({ vertex: VERTEX, fragment: FRAGMENT });
		const total = CAPACITY + IMMEDIATE;
		this.layers = LAYER_ORDER.map((order) => {
			const instances = new Float32Array(total * FLOATS);
			const { geo, buffer } = streamGeometry(instances, FLOATS, [['iA', 4], ['iB', 4], ['iC', 4], ['iD', 4]], { instanced: true });
			return { instances, geo, buffer, mesh: layerMesh(scene, geo, material, order) };
		});
		this.pool = Array.from({ length: CAPACITY }, () => ({ ...DEFAULTS, kind: 0, x: 0, y: 0, age: 0, live: false }));
		this.next = 0;
		this.live = 0;
		this.immediate = Array.from({ length: IMMEDIATE }, () => ({}));
		this.immediateCount = 0;
	}

	// Starts a simulated particle; o overrides DEFAULTS. Sizes are half extents
	// in page px (h defaults to w), speeds px/s, angles rad.
	spawn(kind, x, y, o) {
		const p = this.pool[this.next];
		this.next = (this.next + 1) % CAPACITY;
		Object.assign(p, DEFAULTS, o);
		p.kind = kind;
		p.x = x;
		p.y = y;
		p.age = 0;
		if (!p.h) p.h = p.w;
		if (p.seed < 0) p.seed = rand();
		p.live = true;
		return p;
	}

	// A sprite for this frame only (attached effects that follow something).
	put(kind, x, y, w, h, rot, r, g, b, a, add = 0, flip = 0, flap = 0, seed = 0.5, age = 0) {
		if (this.immediateCount >= IMMEDIATE || a <= 0.002) return;
		const s = this.immediate[this.immediateCount++];
		s.kind = kind; s.x = x; s.y = y; s.w = w; s.h = h; s.rot = rot;
		s.r = r; s.g = g; s.b = b; s.a = a; s.add = add; s.flip = flip; s.flap = flap; s.seed = seed; s.age = age;
	}

	update(dt) {
		let live = 0;
		for (const p of this.pool) {
			if (!p.live) continue;
			p.age += dt;
			if (p.age >= p.life) {
				p.live = false;
				continue;
			}
			live++;
			const damp = Math.exp(-p.drag * dt);
			p.vx = p.vx * damp + p.gx * dt;
			p.vy = p.vy * damp + p.gy * dt;
			if (p.flutter) {
				const ph = p.age * 7 + p.seed * 40;
				p.vx += Math.sin(ph) * p.flutter * dt;
				p.vy += Math.cos(ph * 1.3) * p.flutter * 0.6 * dt;
			}
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			p.rot += p.spin * dt;
			if (p.faceVel) p.rot += (Math.max(-0.7, Math.min(0.7, p.vx / 300)) - p.rot) * Math.min(1, dt * 6);
			p.flip += p.flipRate * dt;
			p.flap += p.flapRate * dt;
		}
		this.live = live;
		return live > 0 || this.immediateCount > 0;
	}

	// Packs particles and one-frame sprites by layer and uploads them.
	upload() {
		for (let layer = 0; layer < LAYERS; layer++) {
			const { instances: out, geo, buffer, mesh } = this.layers[layer];
			let n = 0;
			for (const p of this.pool) {
				if (!p.live || LAYER_OF[p.kind] !== layer) continue;
				const t = p.age / p.life;
				const fade = Math.min(1, p.age / p.fadeIn) * Math.min(1, (p.life - p.age) / p.fadeOut);
				const grow = 1 + (p.grow - 1) * t;
				write(out, n++, p, p.w * grow, p.h * grow, t, p.a * fade);
			}
			for (let i = 0; i < this.immediateCount; i++) {
				const s = this.immediate[i];
				if (LAYER_OF[s.kind] === layer) write(out, n++, s, s.w, s.h, s.age, s.a);
			}
			geo.instanceCount = n;
			mesh.visible = n > 0;
			uploadPrefix(buffer, n * FLOATS);
		}
		this.immediateCount = 0;
	}
}

function write(out, i, s, w, h, age, alpha) {
	const o = i * FLOATS;
	out[o] = s.x;
	out[o + 1] = s.y;
	out[o + 2] = w;
	out[o + 3] = h;
	out[o + 4] = s.rot;
	out[o + 5] = s.kind;
	out[o + 6] = age;
	out[o + 7] = s.seed;
	out[o + 8] = s.r;
	out[o + 9] = s.g;
	out[o + 10] = s.b;
	out[o + 11] = alpha;
	out[o + 12] = s.flip;
	out[o + 13] = s.flap;
	out[o + 14] = s.add;
	out[o + 15] = 0;
}
