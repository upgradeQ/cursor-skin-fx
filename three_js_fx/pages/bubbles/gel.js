// The hero cursor: an Aqua-style gel drawn from the cursor distance atlas in
// one small quad round the hotspot. Saturated aqua deepening towards the
// bottom, a crisp white gloss band over the top half, light pooling at the
// bottom inner edge, a thin dark-teal outline and a soft shadow. The busy
// cursors are rings of glossy beads chasing round, built analytically so the
// same gel material and morph apply to them.
//
// On the CPU: fade in and out, shape morphs with a pop, jelly springs for
// clicks and a slight stretch along fast motion, the busy bead rings, and
// the idle gloss sweep.
import { shapeTile, TILE } from '../../shared/cursor-sdf.js';
import { CURSOR_SDF_GLSL, cursorAtlas, layerMesh, ORDER, premultipliedMaterial, quadGeometry } from './gl.js';
import { OPTICS_GLSL } from './optics.js';

const FADE_IN = 0.09;         // s
const FADE_OUT = 0.16;        // s
const MORPH = 0.17;           // s for one silhouette to melt into the next
const SPRING_K = 520;         // jelly stiffness, 1/s^2
const SPRING_C = 13;          // jelly damping, 1/s
const STRETCH_SPEED = 3200;   // px/s of motion for the full stretch
const STRETCH_MAX = 0.1;
const IDLE_SWEEP = 1.5;       // s idle before light sweeps across the gel
const SWEEP_EVERY = 3.2;      // s between sweeps
const SWEEP_TIME = 0.75;      // s one sweep takes
const UNIFORM_FLOATS = 28;

const COMMON = /* glsl */ `
uniform vec4 uGel[7];
#define gPos uGel[0].xy      // hotspot, page px
#define gAlpha uGel[0].z
#define gClock uGel[0].w     // wrapped seconds for the bubbles inside the gel
#define gA uGel[1]           // tile, angle, mode (0 tile, 1 wait beads, 2 arrow + progress beads), morph 0..1 towards b
#define gB uGel[2]           // tile, angle, mode, unused
#define gInv uGel[3]         // inverse of the jelly transform (column-major 2x2)
#define gBounds uGel[4]      // top / bottom of shape a, then of shape b (px from the hotspot)
#define gSweep uGel[5].x     // gloss sweep position 0..1, < 0 when off
#define gCharge uGel[5].y    // 0..1 while a bubble is being blown
#define gWait uGel[5].z      // bead ring rotation, rad
#define gProgress uGel[5].w
#define gScale uGel[6].x     // mean jelly scale, turns field distances back into px

const vec2 QUAD_MIN = vec2(-46.0, -46.0);
const vec2 QUAD_MAX = vec2(62.0, 64.0);
`;

const VERTEX = /* glsl */ `
in vec2 position;
out vec2 vLocal;

void main() {
	vec2 c = position * 0.5 + 0.5;
	vLocal = mix(QUAD_MIN, QUAD_MAX, c);
	gl_Position = clipFromPage(gPos + vLocal);
}
`;

const FRAGMENT = /* glsl */ `
in vec2 vLocal;
out vec4 fragColor;

// Ring of n beads round c, growing towards the leading one. Returns
// (distance, gradient, hue 0 aqua .. 1 grass green).
vec4 beads(vec2 p, vec2 c, float radius, int n, float small, float large, float phase) {
	vec4 best = vec4(1e4, 0.0, 0.0, 0.0);
	for (int k = 0; k < n; k++) {
		float f = float(k) / float(n - 1);
		float a = phase + float(k) / float(n) * TAU;
		vec2 q = p - (c + radius * vec2(cos(a), sin(a)));
		float l = length(q);
		float d = l - mix(small, large, pow(f, 1.7));
		if (d < best.x) best = vec4(d, q / max(l, 1e-4), f);
	}
	return best;
}

vec4 field(float tile, float angle, float mode, vec2 p) {
	if (mode > 0.5 && mode < 1.5) {
		return beads(p, vec2(0.0), 10.5, 8, 1.3, 3.7, gWait);
	}
	vec4 f = vec4(cursorFieldRotated(tile, p, angle), 0.0);
	if (mode > 1.5) {
		vec4 r = beads(p, vec2(25.0, 30.0), 6.0, 6, 0.9, 2.1, gProgress);
		if (r.x < f.x) return vec4(r.xyz, 1.0);
	}
	return f;
}

vec4 morphField(vec2 p) {
	float m = gA.w;
	if (m <= 0.0) return field(gA.x, gA.y, gA.z, p);
	if (m >= 1.0) return field(gB.x, gB.y, gB.z, p);
	vec4 fa = field(gA.x, gA.y, gA.z, p);
	vec4 fb = field(gB.x, gB.y, gB.z, p);
	vec4 f = mix(fa, fb, m);
	return vec4(f.x, normalize(f.yz + vec2(1e-5, 0.0)), f.w);
}

vec2 jelly(vec2 p) {
	return mat2(gInv.xy, gInv.zw) * p;
}

void main() {
	float px = 1.0 / uPr;
	vec2 p = jelly(vLocal);
	vec4 f = morphField(p);
	float d = f.x * gScale;
	vec2 g = f.yz;
	float hue = f.w;
	float m = clamp(gA.w, 0.0, 1.0);
	float y0 = mix(gBounds.x, gBounds.z, m);
	float y1 = mix(gBounds.y, gBounds.w, m);
	float yN = clamp((p.y - y0) / max(y1 - y0, 1.0), 0.0, 1.0);

	// Soft shadow, down and to the right.
	vec4 fs = morphField(jelly(vLocal - vec2(1.6, 2.8)));
	float sh = (1.0 - smoothstep(-2.0, 4.5, fs.x * gScale)) * 0.36;
	vec4 shadow = vec4(vec3(0.0, 0.05, 0.09) * sh, sh);
	float cov = clamp(0.5 - d / px, 0.0, 1.0);
	if (cov <= 0.0) {
		fragColor = shadow * gAlpha;
		return;
	}

	// Rounded gel profile: normals tip outwards over the last ~3 px.
	float h = clamp(-d / 3.0, 0.0, 1.0);
	float tipOut = pow(1.0 - h, 1.5) * 1.8;
	vec3 nrm = normalize(vec3(g * tipOut, 1.0));
	vec3 L = normalize(vec3(-0.55, -0.75, 0.9));

	vec3 topC = mix(vec3(0.48, 0.92, 1.0), vec3(0.80, 1.0, 0.55), hue);
	vec3 midC = mix(vec3(0.0, 0.68, 0.94), vec3(0.42, 0.84, 0.22), hue);
	vec3 lowC = mix(vec3(0.0, 0.38, 0.78), vec3(0.16, 0.56, 0.12), hue);
	vec3 col = mix(topC, midC, smoothstep(0.0, 0.55, yN));
	col = mix(col, lowC, smoothstep(0.5, 1.0, yN));
	col *= mix(0.8, 1.0, h) * (0.86 + 0.22 * max(dot(nrm, L), 0.0));

	// Light passing through pools at the bottom inner edge.
	float glowAmt = 0.95 + gCharge * 0.8 + 0.25 * gCharge * sin(gClock * 9.0);
	float rimGlow = exp(-pow((d + 1.9) / 1.0, 2.0)) * smoothstep(-0.3, 0.7, g.y) * smoothstep(0.45, 1.0, yN);
	col += mix(vec3(0.62, 1.0, 1.0), vec3(0.9, 1.0, 0.6), hue) * rimGlow * glowAmt;
	col += vec3(0.25, 0.75, 0.95) * smoothstep(0.55, 1.0, yN) * h * (0.22 + gCharge * 0.3);

	// Tiny bubbles rising inside the gel now and then.
	for (int k = 0; k < 3; k++) {
		float fk = float(k);
		float cyc = fract(gClock * (0.21 + fk * 0.04) + fk * 0.37);
		if (cyc < 0.55) {
			float prog = cyc / 0.55;
			float by = mix(y1 - 4.0, y0 + 5.0, prog);
			float bx = (by - y0) * 0.27 + 1.6 + fk * 0.9 + sin(prog * 7.0 + fk * 2.0) * 0.5;
			float rb = 0.7 + 0.25 * fk;
			float rr = length(p - vec2(bx, by));
			float ring = exp(-pow((rr - rb) / 0.42, 2.0)) * smoothstep(-1.0, -1.8, d) * sin(prog * PI);
			col = mix(col, vec3(0.92, 1.0, 1.0), ring * 0.75);
		}
	}

	// Crisp gloss band over the top half, fading into the body.
	float band = (1.0 - smoothstep(0.40, 0.49, yN)) * smoothstep(-0.65, -1.45, d);
	col = mix(col, vec3(1.0), band * mix(0.92, 0.38, clamp(yN / 0.45, 0.0, 1.0)));
	float spec = pow(max(dot(reflect(-L, nrm), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
	col += vec3(spec * 0.8);

	// Idle: a streak of light sweeps across.
	if (gSweep >= 0.0) {
		float u = (p.x * 0.8 + (p.y - y0)) / (max(y1 - y0, 10.0) * 1.5);
		float s = exp(-pow((u - gSweep) / 0.07, 2.0)) * smoothstep(-0.5, -1.2, d);
		col = mix(col, vec3(1.0), s * 0.85);
	}

	// Thin dark-teal outline.
	float o = smoothstep(-1.25, -0.4, d);
	col = mix(col, mix(vec3(0.0, 0.2, 0.32), vec3(0.06, 0.26, 0.08), hue), o * 0.92);

	vec4 body = vec4(min(col, vec3(1.0)), 1.0) * cov;
	fragColor = (body + shadow * (1.0 - body.a)) * gAlpha;
}
`;

// Tile, rotation, mode and the vertical extent (px from the hotspot) of each shape.
const DOUBLE_HALF = [14.2, 5.4];
function describe(shape) {
	const { tile, angle } = shapeTile(shape);
	if (shape === 'wait') return { tile, angle: 0, mode: 1, top: -14.5, bottom: 14.5 };
	if (shape === 'progress') return { tile: TILE.arrow, angle: 0, mode: 2, top: 0, bottom: 32 };
	let top = 0;
	let bottom = 28.6;
	if (tile === TILE.hand) bottom = 27.6;
	else if (tile === TILE.beam) [top, bottom] = [-13, 13];
	else if (tile === TILE.move) [top, bottom] = [-14.6, 14.6];
	else if (tile === TILE.crosshair) [top, bottom] = [-13.5, 13.5];
	else if (tile === TILE.notAllowed) [top, bottom] = [-11.7, 11.7];
	else if (tile === TILE.double) {
		const h = Math.abs(Math.sin(angle)) * DOUBLE_HALF[0] + Math.abs(Math.cos(angle)) * DOUBLE_HALF[1];
		[top, bottom] = [-h, h];
	}
	return { tile, angle, mode: 0, top, bottom };
}

class Spring {
	constructor() {
		this.x = 0;
		this.v = 0;
	}

	step(dt) {
		// Sub-stepped so a long frame cannot blow it up.
		const n = Math.ceil(dt / 0.008);
		const h = dt / n;
		for (let i = 0; i < n; i++) {
			this.v += (-SPRING_K * this.x - SPRING_C * this.v) * h;
			this.x += this.v * h;
		}
	}
}

export class GelCursor {
	constructor(scene) {
		this.alpha = 0;
		this.from = describe('default');
		this.to = this.from;
		this.morph = 1;
		this.scale = new Spring();   // uniform pop
		this.sx = new Spring();      // jelly squash per axis
		this.sy = new Spring();
		this.wait = 0;
		this.progress = 0;
		this.clock = 0;
		this.charge = 0;
		this.u = new Float32Array(UNIFORM_FLOATS);

		const material = premultipliedMaterial({
			common: OPTICS_GLSL + CURSOR_SDF_GLSL + COMMON,
			vertex: VERTEX,
			fragment: FRAGMENT,
			uniforms: { uGel: { value: this.u }, uAtlas: { value: cursorAtlas() } },
		});
		this.mesh = layerMesh(scene, quadGeometry(), material, ORDER.gel);
	}

	get busy() {
		return this.alpha > 0;
	}

	setShape(shape) {
		// Start from wherever the current morph has got to, rounded to its nearer end.
		this.from = this.morph < 0.5 ? this.from : this.to;
		this.to = describe(shape);
		this.morph = 0;
		this.scale.v -= 7;
	}

	snapShape(shape) {
		this.from = this.to = describe(shape);
		this.morph = 1;
	}

	// Appearing: pops up from a smaller drop of gel, in place.
	appear(shape) {
		this.snapShape(shape);
		this.scale.x = -0.45;
		this.scale.v = 0;
	}

	// A click: the jelly squashes down and wobbles back.
	jiggle(strength = 1) {
		this.sy.v -= 9 * strength;
		this.sx.v += 7 * strength;
	}

	update(dt, cursor, { charge = 0 } = {}) {
		const rate = cursor.visible ? dt / FADE_IN : -dt / FADE_OUT;
		this.alpha = Math.min(1, Math.max(0, this.alpha + rate));
		this.mesh.visible = this.alpha > 0;
		this.morph = Math.min(1, this.morph + dt / MORPH);
		this.scale.step(dt);
		this.sx.step(dt);
		this.sy.step(dt);
		this.clock = (this.clock + dt) % 2048;
		this.wait = (this.wait + dt * 5.4) % (Math.PI * 2);
		this.progress = (this.progress + dt * 6.5) % (Math.PI * 2);
		this.charge += (charge - this.charge) * (1 - Math.exp(-dt * 8));

		const u = this.u;
		const m = this.morph;
		const e = m * m * (3 - 2 * m);
		u[0] = cursor.sx; u[1] = cursor.sy; u[2] = this.alpha; u[3] = this.clock;
		u[4] = this.from.tile; u[5] = this.from.angle; u[6] = this.from.mode; u[7] = m >= 1 ? 1 : e;
		u[8] = this.to.tile; u[9] = this.to.angle; u[10] = this.to.mode; u[11] = 0;

		// Jelly transform about the hotspot: pop, squash, stretch along motion.
		const s = 1 + this.scale.x;
		const ax = s * (1 + this.sx.x);
		const ay = s * (1 + this.sy.x);
		const k = Math.min(STRETCH_MAX, (cursor.speed / STRETCH_SPEED) * STRETCH_MAX);
		const dir = cursor.speed > 1 ? [cursor.vx / cursor.speed, cursor.vy / cursor.speed] : [1, 0];
		const along = 1 + k;
		const across = 1 - k * 0.5;
		// M = R diag(along, across) R^T diag(ax, ay)
		const c = dir[0];
		const sn = dir[1];
		const m00 = (c * c * along + sn * sn * across) * ax;
		const m01 = (c * sn * (along - across)) * ay;
		const m10 = (c * sn * (along - across)) * ax;
		const m11 = (sn * sn * along + c * c * across) * ay;
		const det = m00 * m11 - m01 * m10;
		// Column-major inverse.
		u[12] = m11 / det; u[13] = -m10 / det; u[14] = -m01 / det; u[15] = m00 / det;
		u[16] = this.from.top; u[17] = this.from.bottom; u[18] = this.to.top; u[19] = this.to.bottom;
		u[20] = this._sweep(cursor); u[21] = this.charge; u[22] = this.wait; u[23] = this.progress;
		u[24] = Math.sqrt(Math.abs(det));
	}

	_sweep(cursor) {
		if (cursor.idle < IDLE_SWEEP) return -1;
		const t = (cursor.idle - IDLE_SWEEP) % SWEEP_EVERY;
		return t < SWEEP_TIME ? (t / SWEEP_TIME) * 1.5 - 0.25 : -1;
	}
}
