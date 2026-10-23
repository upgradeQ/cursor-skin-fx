// Ripples: a height field on a coarse grid, stepped with the 2-D wave equation
// on the GPU (float render targets drawn into in turn) and drawn as clear
// water. The desktop underneath can't be refracted, so the surface shows only
// as light: white on slopes that face the light, deep teal on the others,
// caustic lines along focusing crests and a faint aqua tint where it is
// disturbed. Calm water draws nothing.
//
// The screen is cut into tiles. A disturbance keeps the tiles its ripples can
// reach awake for a while; only awake tiles are simulated (their bounding box)
// and drawn (one instanced quad each), and nothing runs once all are asleep.
import * as THREE from 'three';
import { InstanceLayer, ORDER, premultipliedMaterial, quadGeometry } from './gl.js';

const CELL = 3;              // page px per simulation cell
const TILE = 64;             // page px per drawn tile
const STEP_HZ = 120;         // simulation steps per second
const MAX_STEPS = 3;         // per frame, so a stalled frame can't snowball
const WAVE = 0.42;           // (c dt / dx)^2 per step: ripples run ~230 px/s
const DAMPING = 0.986;       // amplitude kept per step
const VISCOSITY = 0.09;      // damps short wavelengths; WAVE + 2 VISCOSITY must stay under 0.75
const REACH = 280;           // page px from a disturbance where its ripples still show
const LIFE = 2.3;            // s a disturbance keeps its tiles awake
const MAX_SPLATS = 64;       // disturbances per frame

// Every simulation pass draws one quad over a region of the grid, one
// fragment per cell; texel (x, y) of a target is cell (x, y).
const SIM_COMMON = /* glsl */ `
precision highp float;
precision highp int;

uniform vec2 uDims;      // grid size, cells
uniform vec4 uRegion;    // first cell, end cell (exclusive) this pass covers
uniform sampler2D uSrc;
`;

const SIM_VERTEX = SIM_COMMON + /* glsl */ `
in vec2 position;

void main() {
	vec2 cell = mix(uRegion.xy, uRegion.zw, position * 0.5 + 0.5);
	gl_Position = vec4(cell / uDims * 2.0 - 1.0, 0.0, 1.0);
}
`;

const SIM_FRAGMENT = SIM_COMMON + /* glsl */ `
out vec4 fragColor;

const float VISCOSITY = ${VISCOSITY};
uniform float uWave;
uniform float uDamping;
uniform int uCount;
// A capsule from seg.xy to seg.zw (cells) of radius shape.x, raised by
// shape.y; with shape.z > 0 it is instead a ring of that radius. Pairs of
// (seg, shape).
uniform vec4 uSplats[${MAX_SPLATS * 2}];

ivec2 cellOf() {
	return ivec2(gl_FragCoord.xy);
}

bool inner(ivec2 c) {
	return all(greaterThanEqual(c, ivec2(1))) && all(lessThan(c, ivec2(uDims) - 1));
}

vec2 at(ivec2 c) {
	return texelFetch(uSrc, c, 0).xy;
}

#if defined(SPLAT)
void main() {
	ivec2 c = cellOf();
	vec2 h = at(c);
	if (inner(c)) {
		vec2 p = vec2(c);
		float add = 0.0;
		for (int i = 0; i < ${MAX_SPLATS}; i++) {
			if (i >= uCount) break;
			vec4 seg = uSplats[i * 2];
			vec4 shape = uSplats[i * 2 + 1];
			vec2 ab = seg.zw - seg.xy;
			float k = clamp(dot(p - seg.xy, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
			float d = length(p - seg.xy - ab * k);
			if (shape.z > 0.0) d = abs(d - shape.z);
			float w = max(1.0 - d * d / (shape.x * shape.x), 0.0);
			add += shape.y * w * w;
		}
		h.x += add;
	}
	fragColor = vec4(h, 0.0, 0.0);
}
#elif defined(STEP)
// Leapfrog step with the 9-point Laplacian, which keeps rings round, and a
// little viscosity on the velocity, which eats the grid-sized wavelets.
void main() {
	ivec2 c = cellOf();
	if (!inner(c)) {
		fragColor = vec4(0.0);
		return;
	}
	vec2 h = at(c);
	vec2 edge = at(c + ivec2(-1, 0)) + at(c + ivec2(1, 0)) + at(c + ivec2(0, -1)) + at(c + ivec2(0, 1));
	vec2 diag = at(c + ivec2(-1, -1)) + at(c + ivec2(1, -1)) + at(c + ivec2(-1, 1)) + at(c + ivec2(1, 1));
	vec2 lap = (4.0 * edge + diag - 20.0 * h) / 6.0;
	float v = h.x - h.y + uWave * lap.x + VISCOSITY * (lap.x - lap.y);
	fragColor = vec4((h.x + v) * uDamping, h.x, 0.0, 0.0);
}
#else
// Slope (Sobel), height and curvature per cell, for filtered lookups when drawing.
void main() {
	ivec2 c = cellOf();
	if (!inner(c)) {
		fragColor = vec4(0.0);
		return;
	}
	float h = at(c).x;
	float l = at(c + ivec2(-1, 0)).x;
	float r = at(c + ivec2(1, 0)).x;
	float u = at(c + ivec2(0, -1)).x;
	float d = at(c + ivec2(0, 1)).x;
	float ul = at(c + ivec2(-1, -1)).x;
	float ur = at(c + ivec2(1, -1)).x;
	float dl = at(c + ivec2(-1, 1)).x;
	float dr = at(c + ivec2(1, 1)).x;
	float gx = (2.0 * (r - l) + (ur - ul) + (dr - dl)) / 8.0;
	float gy = (2.0 * (d - u) + (dl - ul) + (dr - ur)) / 8.0;
	float lap = (4.0 * (l + r + u + d) + (ul + ur + dl + dr) - 20.0 * h) / 6.0;
	fragColor = vec4(gx, gy, h, lap);
}
#endif
`;

const SURFACE_VERTEX = /* glsl */ `
in vec2 position;
in vec4 iTile;       // tile column, row
out vec2 vPage;

uniform vec4 uSurface;   // page px per cell, page px per tile, grid size (cells)

void main() {
	vec2 p = (iTile.xy + position * 0.5 + 0.5) * uSurface.y;
	vPage = p;
	gl_Position = clipFromPage(p);
}
`;

const SURFACE_FRAGMENT = /* glsl */ `
in vec2 vPage;
out vec4 fragColor;

uniform vec4 uSurface;
uniform sampler2D uSlopes;

const vec2 TO_LIGHT = vec2(-0.57, -0.82);   // screen-plane direction the light comes from
const float SLOPE_GAIN = 3.4;
const float CURVE_GAIN = 3.2;

void main() {
	vec4 s = textureLod(uSlopes, (vPage / uSurface.x + 1.0) / uSurface.zw, 0.0);
	vec2 slope = s.xy * SLOPE_GAIN;
	float m = length(slope);
	if (m < 0.006) discard;
	float facing = dot(-slope, TO_LIGHT);
	float lit = ramp(0.03, 0.40, facing);
	float glint = ramp(0.34, 0.62, facing);
	float shade = ramp(0.03, 0.46, -facing);
	float caustic = ramp(0.08, 0.5, -s.w * CURVE_GAIN) * ramp(0.02, 0.1, m);
	vec4 col = paint(vec3(0.55, 0.90, 1.0), 0.07 * ramp(0.01, 0.3, m));
	col = over(paint(vec3(0.0, 0.28, 0.40), 0.24 * shade), col);
	col = over(paint(vec3(0.78, 1.0, 1.0), 0.32 * caustic), col);
	col = over(paint(vec3(1.0), 0.30 * lit + 0.5 * glint), col);
	fragColor = col;
}
`;

function simMaterial(define, uniforms) {
	return new THREE.RawShaderMaterial({
		glslVersion: THREE.GLSL3,
		vertexShader: SIM_VERTEX,
		fragmentShader: `#define ${define}\n` + SIM_FRAGMENT,
		uniforms,
		depthTest: false,
		depthWrite: false,
		blending: THREE.NoBlending,
		side: THREE.DoubleSide,
	});
}

function target(cols, rows, type, filter) {
	return new THREE.WebGLRenderTarget(cols, rows, {
		type,
		format: THREE.RGBAFormat,
		minFilter: filter,
		magFilter: filter,
		depthBuffer: false,
		generateMipmaps: false,
	});
}


export class Water {
	constructor(scene, renderer) {
		this.scene = scene;
		this.renderer = renderer;
		this.surfaceMaterial = premultipliedMaterial({
			vertex: SURFACE_VERTEX,
			fragment: SURFACE_FRAGMENT,
			uniforms: {
				uSurface: { value: new THREE.Vector4(CELL, TILE, 1, 1) },
				uSlopes: { value: null },
			},
		});
		this.tiles = new InstanceLayer(scene, this.surfaceMaterial, ORDER.water, 1, ['iTile']);

		// The simulation passes: one quad, drawn with whichever pass runs.
		this.region = new THREE.Vector4();
		this.dims = new THREE.Vector2(1, 1);
		this.splats = new Float32Array(MAX_SPLATS * 8);
		const shared = () => ({ uDims: { value: this.dims }, uRegion: { value: this.region }, uSrc: { value: null } });
		this.splatMat = simMaterial('SPLAT', { ...shared(), uCount: { value: 0 }, uSplats: { value: this.splats } });
		this.stepMat = simMaterial('STEP', { ...shared(), uWave: { value: WAVE }, uDamping: { value: DAMPING } });
		this.shadeMat = simMaterial('SHADE', shared());
		this.simScene = new THREE.Scene();
		this.simQuad = new THREE.Mesh(quadGeometry(), this.stepMat);
		this.simQuad.frustumCulled = false;
		this.simScene.add(this.simQuad);
		this.simCamera = new THREE.Camera();

		this.splatCount = 0;
		this.splatBox = [0, 0, 0, 0];
		this.time = 0;
		this.accum = 0;
		this.steps = 0;
		this.current = 0;        // which field target holds the newest heights
		this.awake = false;
		this.clearPending = false;
		this.tileCount = 0;
	}

	get active() {
		return this.awake;
	}

	resize(width, height) {
		this.fields?.forEach((t) => t.dispose());
		this.slopes?.dispose();

		this.cols = Math.ceil(width / CELL) + 3;
		this.rows = Math.ceil(height / CELL) + 3;
		this.dims.set(this.cols, this.rows);
		this.fields = [0, 1].map(() => target(this.cols, this.rows, THREE.FloatType, THREE.NearestFilter));
		this.slopes = target(this.cols, this.rows, THREE.HalfFloatType, THREE.LinearFilter);
		const u = this.surfaceMaterial.uniforms;
		u.uSlopes.value = this.slopes.texture;
		u.uSurface.value.set(CELL, TILE, this.cols, this.rows);

		this.tilesX = Math.ceil(width / TILE);
		this.tilesY = Math.ceil(height / TILE);
		this.expiry = new Float32Array(this.tilesX * this.tilesY);
		this.tiles.mesh.removeFromParent();
		this.tiles.geo.dispose();
		this.tiles = new InstanceLayer(this.scene, this.surfaceMaterial, ORDER.water, this.tilesX * this.tilesY, ['iTile']);

		this.awake = false;
		this.clearPending = true;
		this.splatCount = 0;
		this.accum = 0;
		this.current = 0;
	}

	// Keeps the tiles within reach of (x, y) awake for LIFE seconds.
	touch(x, y, reach = REACH) {
		const until = this.time + LIFE;
		const tx0 = Math.max(0, Math.floor((x - reach) / TILE));
		const tx1 = Math.min(this.tilesX - 1, Math.floor((x + reach) / TILE));
		const ty0 = Math.max(0, Math.floor((y - reach) / TILE));
		const ty1 = Math.min(this.tilesY - 1, Math.floor((y + reach) / TILE));
		const r2 = reach * reach;
		for (let ty = ty0; ty <= ty1; ty++) {
			const dy = Math.max(ty * TILE - y, 0, y - (ty + 1) * TILE);
			for (let tx = tx0; tx <= tx1; tx++) {
				const dx = Math.max(tx * TILE - x, 0, x - (tx + 1) * TILE);
				if (dx * dx + dy * dy > r2) continue;
				const i = ty * this.tilesX + tx;
				if (this.expiry[i] < until) this.expiry[i] = until;
			}
		}
		this.awake = true;
	}

	// Raises (amp > 0) or presses down the water along a segment, radius in
	// page px; with ring > 0 it is a ring of that radius around (x0, y0).
	splat(x0, y0, x1, y1, radius, amp, ring = 0) {
		if (this.splatCount >= MAX_SPLATS || !this.expiry) return;
		const o = this.splatCount++ * 8;
		const s = this.splats;
		s[o] = x0 / CELL + 0.5;
		s[o + 1] = y0 / CELL + 0.5;
		s[o + 2] = x1 / CELL + 0.5;
		s[o + 3] = y1 / CELL + 0.5;
		s[o + 4] = Math.max(radius / CELL, 0.75);
		s[o + 5] = amp;
		s[o + 6] = ring / CELL;
		s[o + 7] = 0;
		const pad = (radius + ring) / CELL + 2;
		const b = this.splatBox;
		const first = this.splatCount === 1;
		b[0] = Math.min(first ? Infinity : b[0], Math.min(s[o], s[o + 2]) - pad);
		b[1] = Math.min(first ? Infinity : b[1], Math.min(s[o + 1], s[o + 3]) - pad);
		b[2] = Math.max(first ? -Infinity : b[2], Math.max(s[o], s[o + 2]) + pad);
		b[3] = Math.max(first ? -Infinity : b[3], Math.max(s[o + 1], s[o + 3]) + pad);
		this.touch(x0, y0, REACH + ring);
		if (x1 !== x0 || y1 !== y0) this.touch(x1, y1);
	}

	drop(x, y, radius, amp) {
		this.splat(x, y, x, y, radius, amp);
	}

	ring(x, y, r, width, amp) {
		this.splat(x, y, x, y, width, amp, r);
	}

	// Picks the awake tiles and the region of the grid to simulate.
	update(dt, time) {
		this.time = time;
		this.steps = 0;
		if (!this.awake) {
			this.tiles.commit(0);
			return;
		}
		const { expiry, tilesX, tilesY } = this;
		const out = this.tiles.data;
		let n = 0;
		let x0 = Infinity;
		let y0 = Infinity;
		let x1 = -Infinity;
		let y1 = -Infinity;
		for (let ty = 0; ty < tilesY; ty++) {
			for (let tx = 0; tx < tilesX; tx++) {
				if (expiry[ty * tilesX + tx] <= time) continue;
				out[n * 4] = tx;
				out[n * 4 + 1] = ty;
				n++;
				if (tx < x0) x0 = tx;
				if (tx > x1) x1 = tx;
				if (ty < y0) y0 = ty;
				if (ty > y1) y1 = ty;
			}
		}
		this.tileCount = n;
		this.tiles.commit(n);
		if (n === 0) {
			// Settled: wipe the field so the next ripple starts from flat water.
			this.awake = false;
			this.clearPending = true;
			this.splatCount = 0;
			return;
		}
		this.accum = Math.min(this.accum + dt * STEP_HZ, MAX_STEPS);
		this.steps = Math.floor(this.accum);
		this.accum -= this.steps;
		this.stepRegion = [
			Math.max(0, Math.floor((x0 * TILE) / CELL) - 1),
			Math.max(0, Math.floor((y0 * TILE) / CELL) - 1),
			Math.min(this.cols, Math.ceil(((x1 + 1) * TILE) / CELL) + 3),
			Math.min(this.rows, Math.ceil(((y1 + 1) * TILE) / CELL) + 3),
		];
	}

	// Draws material over a region of the grid into a target, reading src.
	_pass(material, region, src, dst) {
		material.uniforms.uSrc.value = src.texture;
		this.region.set(region[0], region[1], region[2], region[3]);
		this.simQuad.material = material;
		this.renderer.setRenderTarget(dst);
		this.renderer.render(this.simScene, this.simCamera);
	}

	// Runs this frame's splats, steps and slope pass. Call before drawing.
	simulate() {
		const { renderer } = this;
		const autoClear = renderer.autoClear;
		const prevTarget = renderer.getRenderTarget();
		renderer.autoClear = false;
		if (this.clearPending) {
			for (const t of this.fields) {
				renderer.setRenderTarget(t);
				renderer.clear(true, false, false);
			}
			this.clearPending = false;
		}
		if (this.awake && this.tileCount > 0) {
			if (this.splatCount) {
				// Splats copy the field across while adding to it, so they cover the
				// whole region the steps will read as well as their own.
				const b = this.splatBox;
				const r = this.stepRegion;
				const region = [
					Math.max(0, Math.min(r[0], Math.floor(b[0]))),
					Math.max(0, Math.min(r[1], Math.floor(b[1]))),
					Math.min(this.cols, Math.max(r[2], Math.ceil(b[2]) + 1)),
					Math.min(this.rows, Math.max(r[3], Math.ceil(b[3]) + 1)),
				];
				this.splatMat.uniforms.uCount.value = this.splatCount;
				this._pass(this.splatMat, region, this.fields[this.current], this.fields[this.current ^ 1]);
				this.current ^= 1;
			}
			for (let i = 0; i < this.steps; i++) {
				this._pass(this.stepMat, this.stepRegion, this.fields[this.current], this.fields[this.current ^ 1]);
				this.current ^= 1;
			}
			this._pass(this.shadeMat, this.stepRegion, this.fields[this.current], this.slopes);
		}
		this.splatCount = 0;
		renderer.setRenderTarget(prevTarget);
		renderer.autoClear = autoClear;
	}
}
