// Vista "aurora" swooshes: glossy translucent ribbons flowing green -> aqua ->
// sky white, each with one bright lit edge and one deeper edge. Strips are
// expanded on the CPU into one vertex buffer per frame. Trail turns the
// cursor's recent path into three intertwined ribbons; the right-button swirl
// adds rings of its own through Aurora.strip().
import { layerMesh, ORDER, premultipliedMaterial, streamGeometry, uploadPrefix } from './gl.js';

const MAX_VERTS = 24000;
const FLOATS = 8;              // x, y, u, v, band, alpha, half width px, arc px

const TRAIL_LIFE = 0.42;       // s a point of the path stays on screen
const MIN_STEP = 2;            // px between recorded points
const STEP = 4;                // px between resampled points
const MAX_RAW = 160;
const MAX_PTS = 512;
const BANDS = [                // width share, wave phase, band colour
	[1.0, 0.0, 0.0],
	[0.66, 2.1, 1.0],
	[0.36, 4.2, 2.0],
];

const VERTEX = /* glsl */ `
in vec2 position;
in vec2 uv;
in vec4 meta;   // band, alpha, half width px, arc px
out vec2 vUv;
out vec4 vMeta;

void main() {
	gl_Position = clipFromPage(position);
	vUv = uv;
	vMeta = meta;
}
`;

const FRAGMENT = /* glsl */ `
in vec2 vUv;
in vec4 vMeta;
out vec4 fragColor;

const vec3 GREEN = vec3(0.42, 0.86, 0.28);
const vec3 AQUA = vec3(0.06, 0.78, 0.76);
const vec3 SKY = vec3(0.55, 0.88, 1.00);
const vec3 DEEP = vec3(0.02, 0.34, 0.44);

void main() {
	float u = vUv.x;          // 0 at the head, 1 at the tail
	float v = vUv.y;          // -1..1 across
	float band = vMeta.x;
	float halfW = vMeta.z;
	float av = abs(v);
	float aaV = 1.3 / max(halfW * uPr, 0.8);
	float cov = 1.0 - smoothstep(1.0 - aaV, 1.0, av);
	float ek = (av - 0.8) / 0.14;
	float edge = exp(-ek * ek);

	vec3 base = mix(GREEN, AQUA, clamp(band, 0.0, 1.0));
	base = mix(base, SKY, clamp(band - 1.0, 0.0, 1.0));
	base = mix(base, GREEN, smoothstep(0.35, 1.0, u) * 0.55);
	base = mix(base, vec3(1.0), (1.0 - smoothstep(0.0, 0.22, u)) * 0.45);
	float shimmer = 0.86 + 0.14 * sin(vMeta.w * 0.07 - uTime * 7.0 + band * 2.0);
	// one edge catches the light, the other is a deeper line that reads on white
	float lit = v < 0.0 ? edge : edge * 0.3;
	float deep = v > 0.0 ? edge : 0.0;
	vec3 rgb = mix(base * shimmer, vec3(1.0), lit * 0.85);
	rgb = mix(rgb, DEEP, deep * 0.4);
	float a = (0.16 + 0.12 * (1.0 - av) + 0.5 * edge) * cov * vMeta.y;
	fragColor = vec4(rgb * a * 1.25, a);
}
`;

export class Aurora {
	constructor(scene) {
		this.verts = new Float32Array(MAX_VERTS * FLOATS);
		const { geo, buffer } = streamGeometry(this.verts, FLOATS, [['position', 2], ['uv', 2], ['meta', 4]]);
		this.geo = geo;
		this.buffer = buffer;
		this.mesh = layerMesh(scene, geo, premultipliedMaterial({ vertex: VERTEX, fragment: FRAGMENT }), ORDER.aurora);
		this.n = 0;
	}

	begin() {
		this.n = 0;
	}

	// One ribbon through count points (head first): xs/ys page px, ws half
	// widths px, as opacities. band 0 green, 1 aqua, 2 sky white.
	strip(xs, ys, ws, as, count, band) {
		if (count < 2 || this.n + (count - 1) * 6 > MAX_VERTS) return;
		let total = 0;
		for (let i = 1; i < count; i++) total += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
		if (total < 0.5) return;
		const v = this.verts;
		let arc = 0;
		let plx = 0, ply = 0, prx = 0, pry = 0, pu = 0, pa = 0, pw = 0, parc = 0;
		for (let i = 0; i < count; i++) {
			const a = Math.max(0, i - 1);
			const b = Math.min(count - 1, i + 1);
			let tx = xs[b] - xs[a];
			let ty = ys[b] - ys[a];
			const tl = Math.hypot(tx, ty) || 1;
			tx /= tl;
			ty /= tl;
			if (i > 0) arc += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
			const w = ws[i];
			const lx = xs[i] - ty * w, ly = ys[i] + tx * w;
			const rx = xs[i] + ty * w, ry = ys[i] - tx * w;
			const u = arc / total;
			if (i > 0) {
				let o = this.n * FLOATS;
				o = put(v, o, plx, ply, pu, -1, band, pa, pw, parc);
				o = put(v, o, prx, pry, pu, 1, band, pa, pw, parc);
				o = put(v, o, lx, ly, u, -1, band, as[i], w, arc);
				o = put(v, o, lx, ly, u, -1, band, as[i], w, arc);
				o = put(v, o, prx, pry, pu, 1, band, pa, pw, parc);
				put(v, o, rx, ry, u, 1, band, as[i], w, arc);
				this.n += 6;
			}
			plx = lx; ply = ly; prx = rx; pry = ry; pu = u; pa = as[i]; pw = w; parc = arc;
		}
	}

	upload() {
		this.geo.setDrawRange(0, this.n);
		this.mesh.visible = this.n > 0;
		uploadPrefix(this.buffer, this.n * FLOATS);
	}
}

function put(v, o, x, y, u, side, band, alpha, w, arc) {
	v[o] = x;
	v[o + 1] = y;
	v[o + 2] = u;
	v[o + 3] = side;
	v[o + 4] = band;
	v[o + 5] = alpha;
	v[o + 6] = w;
	v[o + 7] = arc;
	return o + FLOATS;
}

// The cursor's recent path as three ribbons that weave round one another,
// widest where the motion was fastest, thin at both ends.
export class Trail {
	constructor() {
		this.rx = new Float32Array(MAX_RAW);
		this.ry = new Float32Array(MAX_RAW);
		this.rt = new Float32Array(MAX_RAW);
		this.rs = new Float32Array(MAX_RAW);
		this.count = 0;
		this.px = new Float32Array(MAX_PTS);
		this.py = new Float32Array(MAX_PTS);
		this.page = new Float32Array(MAX_PTS);
		this.pspeed = new Float32Array(MAX_PTS);
		this.bx = new Float32Array(MAX_PTS);
		this.by = new Float32Array(MAX_PTS);
		this.bw = new Float32Array(MAX_PTS);
		this.ba = new Float32Array(MAX_PTS);
		this.n = 0;
	}

	cut() {
		this.count = 0;
		this.n = 0;
	}

	// Records the cursor (seconds clock t) and drops what has aged out.
	record(t, cursor) {
		if (cursor.visible) {
			const i = this.count - 1;
			const x = cursor.sx;
			const y = cursor.sy;
			if (i < 0 || Math.hypot(x - this.rx[i], y - this.ry[i]) >= MIN_STEP) {
				if (this.count === MAX_RAW) this._drop(1);
				const k = this.count++;
				this.rx[k] = x;
				this.ry[k] = y;
				this.rt[k] = t;
				this.rs[k] = cursor.speed;
			}
		}
		let old = 0;
		while (old < this.count && t - this.rt[old] > TRAIL_LIFE) old++;
		if (old > 0) this._drop(old);
	}

	_drop(k) {
		this.rx.copyWithin(0, k, this.count);
		this.ry.copyWithin(0, k, this.count);
		this.rt.copyWithin(0, k, this.count);
		this.rs.copyWithin(0, k, this.count);
		this.count -= k;
	}

	// Resamples the path head first along a Catmull-Rom curve. Long, fast
	// paths are sampled more coarsely so the whole tail always fits.
	_resample(t) {
		const n = this.count;
		let m = 0;
		const rx = this.rx, ry = this.ry;
		let length = 0;
		for (let i = 1; i < n; i++) length += Math.hypot(rx[i] - rx[i - 1], ry[i] - ry[i - 1]);
		// every segment may round up by one sample, and the oldest point is added last
		const budget = Math.max(1, MAX_PTS - 1 - n);
		const step = Math.max(STEP, length / budget);
		let i = n - 1;
		for (; i > 0 && m < MAX_PTS - 1; i--) {
			const i0 = Math.min(n - 1, i + 1), i3 = Math.max(0, i - 2);
			const x0 = rx[i0], y0 = ry[i0], x1 = rx[i], y1 = ry[i], x2 = rx[i - 1], y2 = ry[i - 1], x3 = rx[i3], y3 = ry[i3];
			const len = Math.hypot(x2 - x1, y2 - y1);
			const steps = Math.max(1, Math.ceil(len / step));
			for (let s = 0; s < steps && m < MAX_PTS - 1; s++) {
				const f = s / steps;
				const f2 = f * f, f3 = f2 * f;
				this.px[m] = 0.5 * (2 * x1 + (-x0 + x2) * f + (2 * x0 - 5 * x1 + 4 * x2 - x3) * f2 + (-x0 + 3 * x1 - 3 * x2 + x3) * f3);
				this.py[m] = 0.5 * (2 * y1 + (-y0 + y2) * f + (2 * y0 - 5 * y1 + 4 * y2 - y3) * f2 + (-y0 + 3 * y1 - 3 * y2 + y3) * f3);
				this.page[m] = t - (this.rt[i] + (this.rt[i - 1] - this.rt[i]) * f);
				this.pspeed[m] = this.rs[i] + (this.rs[i - 1] - this.rs[i]) * f;
				m++;
			}
		}
		// Only a path sampled all the way back ends at the oldest point; joining
		// a cut-short one to it would draw a straight jump across the loop.
		if (n > 0 && i === 0) {
			this.px[m] = rx[0];
			this.py[m] = ry[0];
			this.page[m] = t - this.rt[0];
			this.pspeed[m] = this.rs[0];
			m++;
		}
		this.n = m;
	}

	// Emits the ribbons; false when there is nothing to draw.
	build(aurora, t, opacity) {
		if (this.count < 2 || opacity <= 0) return false;
		this._resample(t);
		const m = this.n;
		if (m < 3) return false;
		let total = 0;
		for (let i = 1; i < m; i++) total += Math.hypot(this.px[i] - this.px[i - 1], this.py[i] - this.py[i - 1]);
		if (total < 6) return false;
		for (const [share, phase, band] of BANDS) {
			let arc = 0;
			for (let i = 0; i < m; i++) {
				if (i > 0) arc += Math.hypot(this.px[i] - this.px[i - 1], this.py[i] - this.py[i - 1]);
				const u = arc / total;
				const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1);
				let tx = this.px[b] - this.px[a], ty = this.py[b] - this.py[a];
				const tl = Math.hypot(tx, ty) || 1;
				tx /= tl;
				ty /= tl;
				const profile = Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(u, 0.6))), 0.8);
				const wide = Math.min(16, 1.8 + this.pspeed[i] / 120);
				const w = wide * profile;
				const wave = Math.sin(arc * 0.03 - t * 5.5 + phase) * w * 0.85;
				this.bx[i] = this.px[i] - ty * wave;
				this.by[i] = this.py[i] + tx * wave;
				this.bw[i] = Math.max(0.6, w * share);
				const age = Math.min(1, this.page[i] / TRAIL_LIFE);
				this.ba[i] = opacity * (1 - age * age) * Math.min(1, 0.45 + this.pspeed[i] / 1400);
			}
			aurora.strip(this.bx, this.by, this.bw, this.ba, m, band);
		}
		return true;
	}
}
