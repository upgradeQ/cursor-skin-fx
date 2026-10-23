// Lightning geometry and its renderer. Bolts are built by midpoint
// displacement with forks; every polyline drawn on the page (bolts, sparks,
// the cursor outline) goes through one Ribbons batch that draws a white-hot
// core inside a blue corona, added onto the page in a single draw call.
import * as THREE from 'three';

export const rand = (a, b) => a + Math.random() * (b - a);

// Jagged path from a to b as a flat [x0, y0, x1, y1, ...] list. `rough` is the
// first displacement as a fraction of the length; each level halves it.
export function jagged(ax, ay, bx, by, rough = 0.2, minSeg = 7) {
	let pts = [ax, ay, bx, by];
	const len = Math.hypot(bx - ax, by - ay);
	let amp = len * rough;
	let seg = len;
	while (seg > minSeg && pts.length < 512) {
		const next = [pts[0], pts[1]];
		for (let i = 2; i < pts.length; i += 2) {
			const x0 = pts[i - 2], y0 = pts[i - 1], x1 = pts[i], y1 = pts[i + 1];
			const dx = x1 - x0, dy = y1 - y0;
			const l = Math.hypot(dx, dy) || 1;
			const off = rand(-1, 1) * amp;
			next.push((x0 + x1) / 2 - (dy / l) * off, (y0 + y1) / 2 + (dx / l) * off, x1, y1);
		}
		pts = next;
		amp *= 0.5;
		seg /= 2;
	}
	return pts;
}

// A bolt with forks: [{ pts, width, core, intensity, taper }], main strand first.
export function forkedBolt(ax, ay, bx, by, { rough = 0.22, forks = 3, depth = 2, width = 18, core = 2.2, intensity = 1 } = {}) {
	const out = [];
	const grow = (x0, y0, x1, y1, w, c, k, level, taper) => {
		const pts = jagged(x0, y0, x1, y1, rough);
		out.push({ pts, width: w, core: c, intensity: k, taper });
		if (level >= depth) return;
		const n = pts.length / 2;
		const count = level === 0 ? forks : Math.floor(forks / 2);
		const dx = x1 - x0, dy = y1 - y0;
		const len = Math.hypot(dx, dy);
		const base = Math.atan2(dy, dx);
		for (let f = 0; f < count; f++) {
			const i = Math.floor(rand(0.15, 0.8) * (n - 1));
			const sx = pts[i * 2], sy = pts[i * 2 + 1];
			const a = base + rand(0.3, 0.95) * (Math.random() < 0.5 ? -1 : 1);
			const l = len * (1 - i / n) * rand(0.25, 0.6);
			grow(sx, sy, sx + Math.cos(a) * l, sy + Math.sin(a) * l, w * 0.55, c * 0.65, k * 0.7, level + 1, 1);
		}
	};
	grow(ax, ay, bx, by, width, core, intensity, 0, 0.35);
	return out;
}

const RIBBON_VERT = /* glsl */ `
attribute float aSide;
attribute vec4 aShape;   // half width, core radius, intensity, hue (0 blue .. 1 violet)
varying float vSide;
varying vec4 vShape;
void main() {
	vSide = aSide;
	vShape = aShape;
	gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const RIBBON_FRAG = /* glsl */ `
varying float vSide;
varying vec4 vShape;
void main() {
	float d = abs(vSide) * vShape.x;
	float core = exp(-pow(d / vShape.y, 2.0));
	float glow = exp(-d / (vShape.x * 0.3)) * (1.0 - smoothstep(0.7, 1.0, abs(vSide)));
	vec3 tint = mix(vec3(0.16, 0.42, 1.0), vec3(0.62, 0.3, 1.0), vShape.w);
	vec3 col = (vec3(0.86, 0.94, 1.0) * core * 1.4 + tint * glow * 0.75) * vShape.z;
	float a = min(1.0, max(col.r, max(col.g, col.b)) * 1.15);
	gl_FragColor = vec4(col, a);
}
`;

// Light adds up: premultiplied colour and alpha both accumulate.
export const additive = {
	transparent: true,
	blending: THREE.CustomBlending,
	blendEquation: THREE.AddEquation,
	blendSrc: THREE.OneFactor,
	blendDst: THREE.OneFactor,
	depthTest: false,
	depthWrite: false,
};

export class Ribbons {
	constructor(scene, maxVerts = 80000) {
		this.max = maxVerts;
		const geo = new THREE.BufferGeometry();
		const attr = (size) => new THREE.BufferAttribute(new Float32Array(maxVerts * size), size).setUsage(THREE.DynamicDrawUsage);
		this.pos = attr(3);
		this.side = attr(1);
		this.shape = attr(4);
		geo.setAttribute('position', this.pos);
		geo.setAttribute('aSide', this.side);
		geo.setAttribute('aShape', this.shape);
		this.index = new THREE.BufferAttribute(new Uint32Array(maxVerts * 3), 1).setUsage(THREE.DynamicDrawUsage);
		geo.setIndex(this.index);
		this.geo = geo;
		this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
			vertexShader: RIBBON_VERT,
			fragmentShader: RIBBON_FRAG,
			side: THREE.DoubleSide,
			...additive,
		}));
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 20;
		scene.add(this.mesh);
		this.v = 0;
		this.i = 0;
	}

	begin() {
		this.v = 0;
		this.i = 0;
	}

	// pts: flat [x, y, ...] in page pixels. taper fades the far end towards
	// (1 - taper) of the intensity; closed joins the last point to the first.
	add(pts, width, core, intensity, { taper = 0, closed = false, hue = 0 } = {}) {
		let n = pts.length / 2;
		if (n < 2 || intensity <= 0.002) return;
		const count = closed ? n + 1 : n;
		if (this.v + count * 2 > this.max) return;
		const P = this.pos.array, S = this.side.array, H = this.shape.array, I = this.index.array;
		const hw = width / 2;
		const at = (k) => (closed ? ((k % n) + n) % n : Math.max(0, Math.min(n - 1, k)));
		const v0 = this.v;
		for (let k = 0; k < count; k++) {
			const a = at(k - 1), b = at(k + 1), c = at(k);
			let tx = pts[b * 2] - pts[a * 2];
			let ty = pts[b * 2 + 1] - pts[a * 2 + 1];
			const l = Math.hypot(tx, ty) || 1;
			const nx = -ty / l * hw, ny = tx / l * hw;
			const x = pts[c * 2], y = pts[c * 2 + 1];
			const k2 = intensity * (1 - taper * (k / (count - 1)));
			for (let s = 0; s < 2; s++) {
				const vi = this.v++;
				const sign = s ? 1 : -1;
				P[vi * 3] = x + nx * sign;
				P[vi * 3 + 1] = y + ny * sign;
				P[vi * 3 + 2] = 0;
				S[vi] = sign;
				H[vi * 4] = hw;
				H[vi * 4 + 1] = core;
				H[vi * 4 + 2] = k2;
				H[vi * 4 + 3] = hue;
			}
		}
		for (let k = 0; k < count - 1; k++) {
			const q = v0 + k * 2;
			I[this.i++] = q; I[this.i++] = q + 1; I[this.i++] = q + 2;
			I[this.i++] = q + 1; I[this.i++] = q + 3; I[this.i++] = q + 2;
		}
	}

	addBolt(strands, scale = 1, hue = 0) {
		for (const s of strands) this.add(s.pts, s.width, s.core, s.intensity * scale, { taper: s.taper, hue });
	}

	end() {
		for (const a of [this.pos, this.side, this.shape]) {
			a.clearUpdateRanges();
			a.addUpdateRange(0, Math.max(1, this.v) * a.itemSize);
			a.needsUpdate = true;
		}
		this.index.clearUpdateRanges();
		this.index.addUpdateRange(0, Math.max(1, this.i));
		this.index.needsUpdate = true;
		this.geo.setDrawRange(0, this.i);
		this.mesh.visible = this.i > 0;
		return this.i > 0;
	}
}
