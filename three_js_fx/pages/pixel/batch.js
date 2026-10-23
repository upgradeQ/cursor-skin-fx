// Immediate-mode pixel primitives for the low-resolution effect layer. Every
// frame the simulation pushes what it wants drawn; the batches upload only the
// used range of fixed-size buffers.
import * as THREE from 'three';
import { PALETTE_SIZE, INK, paletteVectors } from './palette.js';

export const KIND = { DISC: 0, RING: 1, SPRITE: 2, SILHOUETTE: 3, GLYPH: 4, STAR: 5, SQUARE: 6 };

// Flag bits. FLAT pixels do not cast the ink outline (dither, sparkles, sprites
// that carry their own outline).
export const FLAT = 1;
export const turn = (quarterTurns, flip = false) => ((quarterTurns & 3) << 1) | (flip ? 8 : 0);
const zoom = (k) => (k - 1) << 4;

// 4x4 ordered dither: the only way anything here fades.
export const BAYER_GLSL = /* glsl */ `
const int BAYER[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
float bayer(vec2 frag) {
	ivec2 p = ivec2(frag) & 3;
	return (float(BAYER[p.y * 4 + p.x]) + 0.5) / 16.0;
}
`;

const pointVertex = /* glsl */ `
in vec4 aShape; // size, kind, colour A, colour B
in vec4 aLook;  // fade, atlas cell (x + y * 256), extent (w + h * 256) or ring width, flags
out float vSize;
out float vFade;
flat out ivec4 vInfo;
flat out ivec4 vCell;

void main() {
	float s = aShape.x;
	vec2 corner = floor(position.xy - s * 0.5 + 0.5);
	gl_Position = projectionMatrix * vec4(corner + s * 0.5, 0.0, 1.0);
	gl_PointSize = s;
	vSize = s;
	vFade = aLook.x;
	vInfo = ivec4(int(aShape.y), int(aShape.z), int(aShape.w), int(aLook.w));
	int cell = int(aLook.y);
	int ext = int(aLook.z);
	vCell = ivec4(cell & 255, cell >> 8, ext & 255, ext >> 8);
}
`;

const pointFragment = /* glsl */ `
uniform highp sampler2D uAtlas;
uniform vec3 uPal[${PALETTE_SIZE}];
in float vSize;
in float vFade;
flat in ivec4 vInfo;
flat in ivec4 vCell;
${BAYER_GLSL}

// Pixel-centre disc test tuned so small sizes read as round (3 -> plus, 4 -> rounded square).
bool disc(vec2 d, float r) {
	return dot(d, d) <= r * r - r * 0.5 + 0.01;
}

void main() {
	if (vFade < 0.999 && vFade <= bayer(gl_FragCoord.xy)) discard;
	int kind = vInfo.x;
	int flags = vInfo.w;
	ivec2 lp = ivec2(gl_PointCoord * vSize);
	vec2 d = vec2(lp) + 0.5 - vSize * 0.5;
	float r = vSize * 0.5;
	vec3 col = uPal[vInfo.y];

	if (kind == 0) {
		if (!disc(d, r)) discard;
	} else if (kind == 1) {
		if (!disc(d, r) || disc(d, r - float(vCell.z))) discard;
	} else if (kind == 5) {
		vec2 a = abs(d);
		float arm = max(0.0, (r - max(a.x, a.y)) * 0.2) + 0.5;
		if (min(a.x, a.y) > arm && a.x + a.y > r * 0.5) discard;
		if (a.x + a.y < r * 0.3) col = uPal[vInfo.z];
	} else if (kind != 6) {
		int k = ((flags >> 4) & 7) + 1;
		ivec2 sp = lp / k;
		int n = int(vSize) / k - 1;
		if ((flags & 8) != 0) sp.x = n - sp.x;
		int q = (flags >> 1) & 3;
		if (q == 1) sp = ivec2(sp.y, n - sp.x);
		else if (q == 2) sp = ivec2(n - sp.x, n - sp.y);
		else if (q == 3) sp = ivec2(n - sp.y, sp.x);
		if (sp.x < 0 || sp.y < 0 || sp.x >= vCell.z || sp.y >= vCell.w) discard;
		vec4 t = texelFetch(uAtlas, vCell.xy + sp, 0);
		if (t.a < 0.1) discard;
		bool outline = t.a > 0.55 && t.a < 0.85;
		if (kind == 3) col = uPal[outline ? vInfo.z : vInfo.y];
		else if (kind == 4) col = uPal[sp.y < 3 ? vInfo.y : vInfo.z];
		else if (t.a > 0.85) col = t.rgb;
		else if (outline) col = uPal[${INK}];
		else col = uPal[t.a > 0.35 ? vInfo.y : vInfo.z];
	}
	gl_FragColor = vec4(col, (flags & 1) != 0 ? 0.5 : 1.0);
}
`;

const lineVertex = /* glsl */ `
in vec3 aLine; // colour, fade, flags
flat out int vCol;
flat out int vFlags;
out float vFade;

void main() {
	gl_Position = projectionMatrix * vec4(floor(position.xy) + 0.5, 0.0, 1.0);
	vCol = int(aLine.x);
	vFade = aLine.y;
	vFlags = int(aLine.z);
}
`;

const lineFragment = /* glsl */ `
uniform vec3 uPal[${PALETTE_SIZE}];
flat in int vCol;
flat in int vFlags;
in float vFade;
${BAYER_GLSL}

void main() {
	if (vFade < 0.999 && vFade <= bayer(gl_FragCoord.xy)) discard;
	gl_FragColor = vec4(uPal[vCol], (vFlags & 1) != 0 ? 0.5 : 1.0);
}
`;

const opaque = { depthTest: false, depthWrite: false, blending: THREE.NoBlending, transparent: false };

export function pointMaterial(atlas) {
	return new THREE.ShaderMaterial({
		...opaque,
		uniforms: { uAtlas: { value: atlas }, uPal: { value: paletteVectors() } },
		vertexShader: pointVertex,
		fragmentShader: pointFragment,
	});
}

export function lineMaterial() {
	return new THREE.ShaderMaterial({
		...opaque,
		uniforms: { uPal: { value: paletteVectors() } },
		vertexShader: lineVertex,
		fragmentShader: lineFragment,
	});
}

// Union of everything pushed this frame, in virtual pixels.
export class Bounds {
	constructor() {
		this.reset();
	}

	reset() {
		this.x0 = this.y0 = Infinity;
		this.x1 = this.y1 = -Infinity;
	}

	add(x0, y0, x1, y1) {
		if (x0 < this.x0) this.x0 = x0;
		if (y0 < this.y0) this.y0 = y0;
		if (x1 > this.x1) this.x1 = x1;
		if (y1 > this.y1) this.y1 = y1;
	}

	get empty() {
		return this.x1 < this.x0;
	}
}

function dynamic(array, size) {
	return new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
}

function upload(attributes, count) {
	if (count === 0) return;
	for (const a of attributes) {
		a.clearUpdateRanges();
		a.addUpdateRange(0, count * a.itemSize);
		a.needsUpdate = true;
	}
}

export class PointBatch {
	constructor(capacity, material, bounds) {
		this.capacity = capacity;
		this.count = 0;
		this.bounds = bounds;
		this.pos = new Float32Array(capacity * 3);
		this.shape = new Float32Array(capacity * 4);
		this.look = new Float32Array(capacity * 4);
		this.attributes = [dynamic(this.pos, 3), dynamic(this.shape, 4), dynamic(this.look, 4)];
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', this.attributes[0]);
		g.setAttribute('aShape', this.attributes[1]);
		g.setAttribute('aLook', this.attributes[2]);
		g.setDrawRange(0, 0);
		this.object = new THREE.Points(g, material);
		this.object.frustumCulled = false;
	}

	begin() {
		this.count = 0;
	}

	// (x, y) is the centre; size is in whole virtual pixels.
	push(x, y, size, kind, colA, colB = INK, fade = 1, cell = 0, ext = 0, flags = 0) {
		if (this.count >= this.capacity || size < 1 || fade <= 0) return;
		const i = this.count++;
		this.pos[i * 3] = x;
		this.pos[i * 3 + 1] = y;
		const s = this.shape;
		s[i * 4] = size;
		s[i * 4 + 1] = kind;
		s[i * 4 + 2] = colA;
		s[i * 4 + 3] = colB;
		const l = this.look;
		l[i * 4] = fade;
		l[i * 4 + 1] = cell;
		l[i * 4 + 2] = ext;
		l[i * 4 + 3] = flags;
		const h = size * 0.5 + 1;
		this.bounds.add(x - h, y - h, x + h, y + h);
	}

	// Atlas entry with its top-left pixel at (left, top), magnified k times.
	sprite(e, left, top, kind, colA, colB, fade = 1, flags = 0, k = 1) {
		const size = Math.max(e.w, e.h) * k;
		this.push(Math.round(left) + size * 0.5, Math.round(top) + size * 0.5, size, kind, colA, colB, fade, e.cell, e.ext, flags | zoom(k));
	}

	end() {
		upload(this.attributes, this.count);
		this.object.geometry.setDrawRange(0, this.count);
	}
}

export class LineBatch {
	constructor(capacity, material, bounds) {
		this.capacity = capacity;
		this.count = 0;
		this.bounds = bounds;
		this.pos = new Float32Array(capacity * 6);
		this.info = new Float32Array(capacity * 6);
		this.attributes = [dynamic(this.pos, 3), dynamic(this.info, 3)];
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', this.attributes[0]);
		g.setAttribute('aLine', this.attributes[1]);
		g.setDrawRange(0, 0);
		this.object = new THREE.LineSegments(g, material);
		this.object.frustumCulled = false;
	}

	begin() {
		this.count = 0;
	}

	push(x0, y0, x1, y1, col, fade = 1, flags = 0) {
		if (this.count >= this.capacity || fade <= 0) return;
		const i = this.count++;
		const p = this.pos;
		p[i * 6] = x0;
		p[i * 6 + 1] = y0;
		p[i * 6 + 3] = x1;
		p[i * 6 + 4] = y1;
		const f = this.info;
		f[i * 6] = f[i * 6 + 3] = col;
		f[i * 6 + 1] = f[i * 6 + 4] = fade;
		f[i * 6 + 2] = f[i * 6 + 5] = flags;
		this.bounds.add(Math.min(x0, x1) - 1, Math.min(y0, y1) - 1, Math.max(x0, x1) + 2, Math.max(y0, y1) + 2);
	}

	end() {
		upload(this.attributes, this.count * 2);
		this.object.geometry.setDrawRange(0, this.count * 2);
	}
}
