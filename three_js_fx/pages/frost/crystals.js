// Instanced ice needles: dendrite branches, fern spines and frozen streaks.
// Every needle is written once when it is spawned; growth, glints and
// sublimation are animated on the GPU from its birth and death times.
import * as THREE from 'three';
import { premultipliedMaterial, quadGeometry, layerMesh, queueUpload } from './gpu.js';

const POOL = 8192;
const STRIDE = 12;
const SIXTY = Math.PI / 3;

export const FROST = 0;
export const SPINE = 1;
export const STREAK = 2;

const vertexShader = /* glsl */ `
in vec2 position;   // x 0..1 along the needle, y -1..1 across
in vec4 iA;         // root x, root y, angle, full length
in vec4 iB;         // width at root, width at tip, birth, growth duration
in vec4 iC;         // death, fade duration, seed, kind
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uCursor;
out vec2 vLocal;    // page px: along from the root, across from the axis
out vec4 vShape;    // current length, half width at root, half width at tip, opacity
out vec4 vLook;     // glint, growth glow, dissolve, seed
flat out float vKind;
flat out float vLit;

const vec2 LIGHT = vec2(-0.6, -0.8);

void main() {
	float age = uTime - iB.z;
	if (age < 0.0 || uTime >= iC.x) {
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		return;
	}
	float g = clamp(age / iB.w, 0.0, 1.0);
	g = 1.0 - (1.0 - g) * (1.0 - g) * (1.0 - g);
	float len = max(iA.w * g, 0.05);
	float life = clamp((iC.x - uTime) / iC.y, 0.0, 1.0);
	float thick = (0.45 + 0.55 * g) * mix(0.5, 1.0, life);
	float hw0 = iB.x * 0.5 * thick;
	float hw1 = iB.y * 0.5 * thick;

	const float pad = 2.6;
	float ext = max(max(hw0, hw1), 0.55) + pad;
	vec2 dir = vec2(cos(iA.z), sin(iA.z));
	vec2 nrm = vec2(-dir.y, dir.x);
	float s = mix(-pad, len + pad, position.x);
	float t = position.y * ext;
	vLocal = vec2(s, t);

	vec2 mid = iA.xy + dir * len * 0.5;
	vec2 dc = mid - uCursor;
	float near = exp(-dot(dc, dc) / (2.0 * 110.0 * 110.0));
	float seed = iC.z;
	float twinkle = pow(max(0.0, sin(uTime * (1.1 + seed * 2.3) + seed * 61.0)), 30.0);
	float fresh = 1.0 - smoothstep(0.0, 0.3, age - iB.w);

	vShape = vec4(len, hw0, hw1, smoothstep(0.0, 0.45, life));
	vLook = vec4(twinkle + near * 0.4, fresh, 1.0 - life, seed);
	vKind = iC.w;
	vLit = dot(nrm, normalize(LIGHT));
	gl_Position = toClip(iA.xy + dir * s + nrm * t, uRes);
}
`;

const fragmentShader = /* glsl */ `
in vec2 vLocal;
in vec4 vShape;
in vec4 vLook;
flat in float vKind;
flat in float vLit;
uniform float uPx;
out vec4 fragColor;

void main() {
	float s = vLocal.x;
	float t = vLocal.y;
	float len = vShape.x;
	float hw = mix(vShape.y, vShape.z, clamp(s / len, 0.0, 1.0));
	// Needles thinner than a pixel are drawn a pixel wide and fainter.
	float hwR = max(hw, 0.55);
	float thin = hw / hwR;
	float d = max(abs(t) - hwR, max(-s, s - len));
	float body = cover(d, uPx) * thin;
	float rim = cover(d - 1.0, uPx) * (0.35 + 0.65 * thin);
	if (rim <= 0.0) discard;

	// Sublimation: short pieces drop out in random order.
	float dissolve = vLook.z;
	float cell = hash11(floor(s / 2.4) + vLook.w * 113.0);
	float keep = smoothstep(dissolve * 1.15 - 0.1, dissolve * 1.15 + 0.02, cell);

	bool streak = vKind > 1.5;
	float ridge = 1.0 - abs(t) / hwR;
	float facet = t > 0.0 ? vLit : -vLit;
	vec3 col = mix(C_ICE, C_FROST, smoothstep(0.05, 0.6, ridge));
	col *= 0.84 + 0.16 * facet;
	float tip = vLook.y * smoothstep(len - 5.0, len, s);
	float shine = clamp(vLook.x * 0.8 + tip + (streak ? 0.55 : 0.0), 0.0, 1.0);
	col = mix(col, C_WHITE, shine);

	vec4 o = vec4(0.0);
	over(o, C_INK, rim * (streak ? 0.55 : 0.38) * keep);
	over(o, col, body * 0.94 * keep);
	o.rgb += C_PALE * body * keep * (0.12 + 0.4 * shine);
	fragColor = o * vShape.w;
}
`;

export class Crystals {
	constructor() {
		this.data = new Float32Array(POOL * STRIDE);
		this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
		this.buffer.setUsage(THREE.DynamicDrawUsage);

		const geo = quadGeometry({ centred: false });
		geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
		geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
		geo.setAttribute('iC', new THREE.InterleavedBufferAttribute(this.buffer, 4, 8));
		this.geometry = geo;
		this.mesh = layerMesh(geo, premultipliedMaterial(vertexShader, fragmentShader), 2);

		this.head = 0;
		this.filled = 0;
		this.writeStart = 0;
		this.written = 0;
		this.lastDeath = 0;
		this.ranges = [{ start: 0, count: 0 }, { start: 0, count: 0 }];
	}

	add(x, y, angle, len, w0, w1, birth, grow, death, fade, kind) {
		const i = this.head;
		if (this.written === 0) this.writeStart = i;
		this.written++;
		this.head = (i + 1) % POOL;
		if (this.filled < POOL) this.filled++;
		if (death > this.lastDeath) this.lastDeath = death;

		const d = this.data;
		const o = i * STRIDE;
		d[o] = x;
		d[o + 1] = y;
		d[o + 2] = angle;
		d[o + 3] = len;
		d[o + 4] = w0;
		d[o + 5] = w1;
		d[o + 6] = birth;
		d[o + 7] = Math.max(grow, 0.001);
		d[o + 8] = death;
		d[o + 9] = Math.max(fade, 0.001);
		d[o + 10] = Math.random();
		d[o + 11] = kind;
	}

	// A needle with 60-degree side branches leaning towards its tip, recursing
	// `depth` levels. Branches start when the growing tip passes them and die a
	// little before their parent, so the crystal sublimates from the outside in.
	dendrite(x, y, angle, len, width, birth, death, depth, rate = 90) {
		const grow = len / rate;
		this.add(x, y, angle, len, width, 0, birth, grow, death, 0.5, FROST);
		if (depth <= 0 || len < 6) return;
		const n = depth > 1 ? 3 : 2;
		const c = Math.cos(angle);
		const s = Math.sin(angle);
		for (let k = 0; k < n; k++) {
			const u = 0.3 + (0.5 * k) / (n - 1) + (Math.random() - 0.5) * 0.08;
			const bl = len * (1 - u) * (0.55 + Math.random() * 0.25);
			if (bl < 2.5) continue;
			const bx = x + c * len * u;
			const by = y + s * len * u;
			// Time at which the eased tip (1 - (1 - g)^3) reaches u.
			const bb = birth + grow * (1 - Math.cbrt(1 - u));
			const bw = width * (1 - u) * 0.9 + 0.25;
			const bd = death - 0.07 - Math.random() * 0.1;
			this.dendrite(bx, by, angle + SIXTY, bl, bw, bb, bd, depth - 1, rate);
			this.dendrite(bx, by, angle - SIXTY, bl * (0.8 + Math.random() * 0.2), bw, bb, bd, depth - 1, rate);
		}
	}

	// Keeps stored times small so float32 stays precise in long sessions.
	rebase(offset) {
		const d = this.data;
		for (let o = 0; o < d.length; o += STRIDE) {
			d[o + 6] -= offset;
			d[o + 8] -= offset;
		}
		this.lastDeath -= offset;
		this.writeStart = 0;
		this.written = POOL;
	}

	update(time) {
		if (this.written > 0) {
			const n = Math.min(this.written, POOL);
			const start = n === POOL ? 0 : this.writeStart;
			const end = start + n;
			if (end <= POOL) {
				queueUpload(this.buffer, this.ranges[0], start * STRIDE, n * STRIDE);
			} else {
				queueUpload(this.buffer, this.ranges[0], start * STRIDE, (POOL - start) * STRIDE);
				queueUpload(this.buffer, this.ranges[1], 0, (end - POOL) * STRIDE);
			}
			this.written = 0;
		}
		this.geometry.instanceCount = this.filled;
		this.mesh.visible = time < this.lastDeath;
	}
}
