// Shader-drawn frost rings around the cursor: the click shockwave, the frost
// patch that creeps outward while the button is held, and the cracks that
// shatter it on release. Each one is a single quad sized to its radius.
import { premultipliedMaterial, quadGeometry, instancedAttribute, layerMesh, queueUpload } from './gpu.js';

const POOL = 8;
const BURST = 0;
const HOLD = 1;
const CRACK = 2;
const BURST_LIFE = 0.62;
const CRACK_LIFE = 0.75;

const vertexShader = /* glsl */ `
in vec2 position;
in vec4 iA;   // x, y, kind, age
in vec4 iB;   // radius, strength, rotation, extra
uniform vec2 uRes;
out vec2 vP;
flat out vec4 vA;
flat out vec4 vB;

void main() {
	float kind = iA.z;
	float k = kind < 0.5 ? 1.25 : kind < 1.5 ? 1.45 : 1.95;
	vP = position * (iB.x * k + 10.0);
	vA = iA;
	vB = iB;
	gl_Position = toClip(iA.xy + vP, uRes);
}
`;

const fragmentShader = /* glsl */ `
in vec2 vP;
flat in vec4 vA;
flat in vec4 vB;
uniform float uPx;
out vec4 fragColor;

const vec2 BRANCH = vec2(0.5, 0.8660254);
const vec2 EDGE_N = vec2(0.8660254, 0.5);

// Layers a crystalline line (core over a dark outline) onto o.
void ink(inout vec4 o, float d, float a, vec3 core) {
	over(o, C_INK, cover(d - 1.0, uPx) * 0.5 * a);
	float body = cover(d, uPx) * a;
	over(o, core, body);
	o.rgb += C_PALE * body * 0.35;
}

// Hexagonal shockwave whose vertices sprout branching spikes.
vec4 burst(vec2 p, float R, float k, float rot, float flash) {
	vec2 q = fold6(rot2(p, rot));
	float w = mix(0.35, 1.25, k);
	vec2 v0 = vec2(R, 0.0);
	vec2 mid = EDGE_N * R * 0.8660254;
	float d = sdSegment(q, v0, mid) - w;
	d = min(d, sdSegment(q, vec2(R * 0.74, 0.0), vec2(R * 1.2, 0.0)) - w * 0.9);
	d = min(d, sdSegment(q, vec2(R * 0.93, 0.0), vec2(R * 0.93, 0.0) + BRANCH * R * 0.16) - w * 0.7);
	d = min(d, sdSegment(q, vec2(R * 1.06, 0.0), vec2(R * 1.06, 0.0) + BRANCH * R * 0.09) - w * 0.6);
	d = min(d, sdSegment(q, mid, mid * 1.12) - w * 0.7);
	vec4 o = vec4(0.0);
	float inside = 1.0 - smoothstep(-2.0, 0.0, dot(q, EDGE_N) - R * 0.8660254);
	over(o, C_PALE, inside * 0.06 * k);
	ink(o, d, k, mix(C_FROST, C_WHITE, k));
	float r2 = dot(p, p);
	float f = flash * exp(-r2 / (2.0 * 15.0 * 15.0));
	over(o, C_WHITE, f * 0.35);
	o.rgb += C_PALE * f * 0.5;
	return o;
}

float spikes(float a, float n, float sharp) {
	float t = abs(fract(a * n / TAU) - 0.5) * 2.0;
	return pow(t, sharp);
}

// Frost patch: a six-fold fractal edge (6, 18 and 54 teeth), creeping growth
// bands inside and dendrite arms reaching past the rim.
vec4 hold(vec2 p, float R, float s, float rot, float t) {
	vec2 pr = rot2(p, rot);
	float r = length(p);
	float a = atan(pr.y, pr.x);
	float edge = R * (0.86 + 0.1 * spikes(a, 6.0, 5.0) + 0.045 * spikes(a + 0.35, 18.0, 4.0) + 0.022 * spikes(a + 0.11, 54.0, 3.0));
	float dE = r - edge;
	float fw = max(fwidth(dE), uPx * 0.5);
	float fill = clamp(0.5 - dE / fw, 0.0, 1.0);

	vec2 q = fold6(pr);
	float hexR = dot(q, EDGE_N) / 0.8660254;
	float band = smoothstep(0.86, 1.0, fract(hexR / 7.0 - t * 0.45));
	vec4 o = vec4(0.0);
	over(o, C_PALE, fill * (0.07 + 0.08 * band * smoothstep(0.0, R * 0.6, hexR)) * s);

	float rimLine = clamp(1.0 - abs(dE + 0.7) / (0.9 * fw + 0.6), 0.0, 1.0);
	float shimmer = pow(max(0.0, cos(a - t * 1.9)), 14.0);
	over(o, C_INK, clamp(1.0 - abs(dE - 0.9) / (fw + 0.5), 0.0, 1.0) * 0.28 * s);
	over(o, mix(C_FROST, C_WHITE, shimmer), rimLine * (0.55 + 0.4 * shimmer) * s);
	o.rgb += C_PALE * rimLine * shimmer * 0.5 * s;

	float reach = R * (1.0 + 0.3 * s);
	float w = 0.75 + 0.35 * s;
	float d = sdSegment(q, vec2(R * 0.55, 0.0), vec2(reach, 0.0)) - w;
	d = min(d, sdSegment(q, vec2(R * 0.82, 0.0), vec2(R * 0.82, 0.0) + BRANCH * R * 0.2) - w * 0.8);
	d = min(d, sdSegment(q, vec2(R * 0.98, 0.0), vec2(R * 0.98, 0.0) + BRANCH * R * 0.13) - w * 0.7);
	d = min(d, sdSegment(q, EDGE_N * R * 0.78, EDGE_N * R * 1.04) - w * 0.7);
	ink(o, d, s, C_FROST);
	return o;
}

// Jagged radial cracks racing outward, a flash ring and the patch fading out.
vec4 crack(vec2 p, float R, float age, float seed) {
	float r = length(p);
	float a = atan(p.y, p.x);
	const float N = 9.0;
	float sector = TAU / N;
	float k = floor((a + PI) / sector);
	float centre = (k + 0.5 + (hash11(k + seed * 31.0) - 0.5) * 0.3) * sector - PI;
	float jag = (2.0 * sin(r * 0.23 + k * 3.7 + seed * 9.0) + 1.1 * sin(r * 0.61 + k * 1.3)) * min(1.0, r / 30.0);
	float perp = r * sin(a - centre) - jag;
	float len = R * (1.3 + 0.45 * hash11(k * 7.0 + seed * 13.0));
	float grow = 1.0 - pow(1.0 - clamp(age / 0.13, 0.0, 1.0), 3.0);
	float w = mix(1.4, 0.2, clamp(r / len, 0.0, 1.0));
	float d = abs(perp) - w;
	d = max(d, r - len * grow);
	d = max(d, R * 0.28 - r);
	d = max(d, -cos(a - centre));
	float fade = 1.0 - smoothstep(0.16, CRACK_LIFE, age);

	vec4 o = vec4(0.0);
	float haze = (1.0 - smoothstep(0.0, 0.2, age)) * (1.0 - smoothstep(R * 0.85, R, r));
	over(o, C_PALE, haze * 0.1);
	float ringR = R + age * 320.0;
	float ring = clamp(1.0 - abs(r - ringR) / 1.6, 0.0, 1.0) * (1.0 - smoothstep(0.0, 0.3, age));
	over(o, C_FROST, ring * 0.6);
	o.rgb += C_PALE * ring * 0.4;
	ink(o, d, fade, mix(C_FROST, C_WHITE, 1.0 - smoothstep(0.0, 0.25, age)));
	return o;
}

void main() {
	float kind = vA.z;
	vec4 o;
	if (kind < 0.5) o = burst(vP, vB.x, vB.y, vB.z, vB.w);
	else if (kind < 1.5) o = hold(vP, vB.x, vB.y, vB.z, vB.w);
	else o = crack(vP, vB.x, vA.w, vB.w);
	if (o.a < 0.002 && max(o.r, max(o.g, o.b)) < 0.002) discard;
	fragColor = o;
}
`.replace(/CRACK_LIFE/g, CRACK_LIFE.toFixed(3));

export class Rings {
	constructor() {
		const geo = quadGeometry();
		this.a0 = instancedAttribute(geo, 'iA', new Float32Array(POOL * 4), 4);
		this.a1 = instancedAttribute(geo, 'iB', new Float32Array(POOL * 4), 4);
		this.geometry = geo;
		this.mesh = layerMesh(geo, premultipliedMaterial(vertexShader, fragmentShader), 1);
		this.items = Array.from({ length: POOL }, () => ({
			active: false, kind: 0, x: 0, y: 0, age: 0, R: 0, s: 0, rot: 0, seed: 0, t: 0,
		}));
		this.holdItem = null;
		this.ranges = [{ start: 0, count: 0 }, { start: 0, count: 0 }];
	}

	_alloc(kind, x, y) {
		let it = null;
		for (const i of this.items) {
			if (!i.active) {
				it = i;
				break;
			}
		}
		// Pool full: recycle the oldest effect, never the live hold patch.
		if (!it) for (const i of this.items) if (i !== this.holdItem && (!it || i.age > it.age)) it = i;
		it.active = true;
		it.kind = kind;
		it.x = x;
		it.y = y;
		it.age = 0;
		it.R = 0;
		it.s = 0;
		it.rot = Math.random() * Math.PI * 2;
		it.seed = Math.random();
		it.t = 0;
		return it;
	}

	burst(x, y) {
		this._alloc(BURST, x, y);
	}

	crack(x, y, R) {
		this._alloc(CRACK, x, y).R = R;
	}

	// Called every frame while the patch is visible; s is its strength 0..1.
	hold(x, y, R, s, dt) {
		if (!this.holdItem) this.holdItem = this._alloc(HOLD, x, y);
		const it = this.holdItem;
		it.x = x;
		it.y = y;
		it.R = R;
		it.s = s;
		it.t = (it.t + dt) % 400;
	}

	endHold() {
		if (this.holdItem) this.holdItem.active = false;
		this.holdItem = null;
	}

	update(dt) {
		const a0 = this.a0.array;
		const a1 = this.a1.array;
		let n = 0;
		for (const it of this.items) {
			if (!it.active) continue;
			it.age += dt;
			let R = it.R;
			let s = it.s;
			let extra = it.t;
			if (it.kind === BURST) {
				if (it.age >= BURST_LIFE) {
					it.active = false;
					continue;
				}
				const p = Math.min(1, it.age / 0.42);
				R = 14 + 84 * (1 - Math.pow(1 - p, 3));
				s = Math.pow(1 - it.age / BURST_LIFE, 1.2);
				extra = Math.max(0, 1 - it.age / 0.12);
			} else if (it.kind === CRACK) {
				if (it.age >= CRACK_LIFE) {
					it.active = false;
					continue;
				}
				extra = it.seed;
			}
			const o = n * 4;
			a0[o] = it.x;
			a0[o + 1] = it.y;
			a0[o + 2] = it.kind;
			a0[o + 3] = it.age;
			a1[o] = R;
			a1[o + 1] = s;
			a1[o + 2] = it.rot;
			a1[o + 3] = extra;
			n++;
		}
		queueUpload(this.a0, this.ranges[0], 0, n * 4);
		queueUpload(this.a1, this.ranges[1], 0, n * 4);
		this.geometry.instanceCount = n;
		this.mesh.visible = n > 0;
	}
}
