// The hero cursor: a clear glass vessel half full of water. The water line
// is a damped spring that tilts against the cursor's acceleration and ripples
// when shaken, with a bright meniscus and tiny bubbles rising through it.
// Bevelled rim, white Aero gloss over the top, thin dark-teal outline and a
// soft shadow. Shapes morph by blending two signed-distance fields, with a
// squash-and-pop; busy cursors run a glossy blue-green head round their ring.
import { shapeTile } from '../../shared/cursor-sdf.js';
import { CURSOR_SDF_GLSL, cursorAtlas, layerMesh, ORDER, premultipliedMaterial, quadGeometry } from './gl.js';

const MORPH_S = 0.22;        // s to blend one silhouette into the next
const FADE_IN_S = 0.1;
const FADE_OUT_S = 0.18;
const FILL = 0.58;           // share of the silhouette's height under water
const SIZE = 1.06;           // silhouette scale: a touch larger than the system cursor
const SLOSH_G = 3600;        // px/s², the "gravity" sloshing is measured against
const SLOSH_HZ = 2.3;        // natural frequency of the water line
const SLOSH_DAMPING = 0.13;  // damping ratio of the water line
const MAX_TILT = 0.85;       // water line slope limit
const WAVE_DECAY = 2.4;      // 1/s
const MAX_WAVE = 2.0;        // px
const BUSY_SPEED = 7;        // rad/s of the busy ring's head
const IDLE_AFTER = 1.6;      // s still before the idle shine
const SWEEP_EVERY = 3.4;     // s between idle shines
const SWEEP_S = 0.85;        // s one shine takes to cross

// Per system cursor: vertical extent of the silhouette (page px from the
// hotspot, y down, as drawn after rotation), the x the water line pivots
// about, how far thin strokes are fattened so they can hold water, whether
// it is water all through, and the coral tint for the refusal cursor.
const SHAPES = {
	default: { top: 0, bottom: 28.6, cx: 7 },
	pointer: { top: 0, bottom: 27.6, cx: 6 },
	text: { top: -13, bottom: 13, cx: 0, inflate: 1.0 },
	wait: { top: -14.2, bottom: 14.2, cx: 0, fill: 1 },
	progress: { top: 0, bottom: 28.6, cx: 8 },
	crosshair: { top: -13.5, bottom: 13.5, cx: 0, inflate: 0.8 },
	move: { top: -14.6, bottom: 14.6, cx: 0, inflate: 0.35 },
	help: { top: 0, bottom: 28.6, cx: 9 },
	'not-allowed': { top: -11.7, bottom: 11.7, cx: 0, tint: 1 },
	'ew-resize': { top: -5.4, bottom: 5.4, cx: 0, inflate: 0.45 },
	'ns-resize': { top: -14.2, bottom: 14.2, cx: 0, inflate: 0.45 },
	'nwse-resize': { top: -10.1, bottom: 10.1, cx: 0, inflate: 0.45 },
	'nesw-resize': { top: -10.1, bottom: 10.1, cx: 0, inflate: 0.45 },
};

const shapeOf = (name) => SHAPES[name] ?? SHAPES.default;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

const COMMON = /* glsl */ `
uniform vec4 uGlass[6];
#define gPos uGlass[0].xy       // hotspot, page px
#define gAlpha uGlass[0].z
#define gScale uGlass[0].w
#define gTiles uGlass[1].xy     // from, to
#define gAngles uGlass[1].zw
#define gInflate uGlass[2].xy
#define gMorph uGlass[2].z
#define gFill uGlass[2].w       // 1: water all through
#define gLevel uGlass[3].x      // water line at cx, px below the hotspot
#define gTilt uGlass[3].y       // water line slope
#define gWave uGlass[3].z       // px
#define gWavePhase uGlass[3].w
#define gTop uGlass[4].x        // silhouette extent, px from the hotspot
#define gBottom uGlass[4].y
#define gCx uGlass[4].z
#define gBusy uGlass[4].w       // rad, head of the busy ring
#define gSweep uGlass[5].x      // idle shine position 0..1, off outside
#define gTint uGlass[5].y       // coral water
#define gGlow uGlass[5].z       // click flash

const float QUAD_MIN = -46.0;   // px around the hotspot the quad covers
const float QUAD_MAX = 66.0;
`;

const VERTEX = /* glsl */ `
in vec2 position;
out vec2 vLocal;

void main() {
	vLocal = mix(vec2(QUAD_MIN), vec2(QUAD_MAX), position * 0.5 + 0.5);
	gl_Position = clipFromPage(gPos + vLocal);
}
`;

const FRAGMENT = /* glsl */ `
in vec2 vLocal;
out vec4 fragColor;

const vec2 TO_LIGHT = vec2(-0.6, -0.8);
const vec3 OUTLINE_RGB = vec3(0.02, 0.24, 0.33);
const float OUTLINE_W = 1.1;
const vec3 SHADOW_RGB = vec3(0.0, 0.06, 0.12);
const vec2 SHADOW_OFFSET = vec2(1.4, 2.6);
const vec3 AIR_RGB = vec3(0.84, 0.95, 1.0);
const vec3 WATER_TOP = vec3(0.38, 0.88, 1.0);
const vec3 WATER_DEEP = vec3(0.0, 0.44, 0.86);
const vec3 CORAL_TOP = vec3(1.0, 0.72, 0.62);
const vec3 CORAL_DEEP = vec3(0.92, 0.22, 0.26);
const float RING_TILE = 8.0;
const float PROGRESS_TILE = 9.0;

// The morphing silhouette at p (px from the hotspot): distance, outward normal.
vec3 field(vec2 p) {
	vec2 q = p / gScale;
	vec3 a = cursorFieldRotated(gTiles.x, q, gAngles.x);
	vec3 b = cursorFieldRotated(gTiles.y, q, gAngles.y);
	float d = mix(a.x - gInflate.x, b.x - gInflate.y, gMorph) * gScale;
	vec2 n = mix(a.yz, b.yz, gMorph);
	return vec3(d, n / max(length(n), 1e-4));
}

// Bright wandering lines of light inside the water.
float caustic(vec2 p, float t) {
	vec2 q = p + vec2(sin(p.y * 0.8 + t * 1.7), cos(p.x * 0.7 - t * 1.3)) * 1.1;
	float v = sin(q.x * 0.75 + t * 0.9) * sin(q.y * 0.7 - t * 1.1);
	return pow(1.0 - abs(v), 8.0);
}

// Busy ring: x = on the ring, y = 1 at the sweeping head fading behind it.
vec2 spin(vec2 p, vec2 c, float r, float w, float angle) {
	vec2 v = p - c;
	float on = ramp(w + 1.5, w - 0.5, abs(length(v) - r));
	float behind = fract((angle - atan(v.y, v.x)) / 6.2831853);
	return vec2(on, pow(1.0 - behind, 2.2));
}

vec3 spinColor(float head) {
	vec3 tail = mix(vec3(0.0, 0.38, 0.86), vec3(0.08, 0.78, 0.95), ramp(0.0, 0.5, head));
	return mix(tail, vec3(0.55, 0.96, 0.38), ramp(0.55, 1.0, head)) + head * head * 0.3;
}

void main() {
	float px = 1.0 / uPr;
	float t = uTime;
	vec2 p = vLocal;
	vec3 f = field(p);
	float d = f.x;
	vec2 n = f.yz;

	// Soft drop shadow, and a hairline of light just outside the outline so the
	// edge also reads on dark content.
	float ds = field(p - SHADOW_OFFSET * gScale).x;
	vec4 under = paint(SHADOW_RGB, 0.32 * ramp(5.0, -1.5, ds));
	under = over(paint(vec3(1.0), 0.32 * ramp(1.3, 0.3, d)), under);

	float cover = clamp(0.5 - d / px, 0.0, 1.0);
	if (cover <= 0.0) {
		fragColor = under * gAlpha;
		return;
	}

	float depth = -d;
	float h = max(gBottom - gTop, 1.0);
	float wx = p.x - gCx;
	float dry = 1.0 - gFill;

	// Water line: tilted by sloshing, rippled by waves.
	float surfaceY = gLevel + gTilt * wx + gWave * (sin(wx * 0.55 + gWavePhase) + 0.45 * sin(wx * 1.3 - gWavePhase * 1.7));
	float below = p.y - surfaceY;
	float wet = max(clamp(below / px + 0.5, 0.0, 1.0), gFill);
	float deep = max(ramp(0.0, 13.0, below) * dry, gFill * ramp(0.5, 4.0, depth));

	vec3 wc = mix(WATER_TOP, WATER_DEEP, deep);
	wc = mix(wc, mix(CORAL_TOP, CORAL_DEEP, deep), gTint);
	float ringW = (gTiles.x == RING_TILE ? 1.0 - gMorph : 0.0) + (gTiles.y == RING_TILE ? gMorph : 0.0);
	float progW = (gTiles.x == PROGRESS_TILE ? 1.0 - gMorph : 0.0) + (gTiles.y == PROGRESS_TILE ? gMorph : 0.0);
	if (ringW > 0.0) {
		vec2 s = spin(p, vec2(0.0), 11.0 * gScale, 3.4 * gScale, gBusy);
		wc = mix(wc, spinColor(s.y), s.x * ringW * 0.9);
	}
	if (progW > 0.0) {
		vec2 s = spin(p, vec2(25.0, 30.0) * gScale, 6.0 * gScale, 2.2 * gScale, gBusy * 1.3);
		wc = mix(wc, spinColor(s.y), s.x * progW * 0.9);
	}
	wc += vec3(0.30, 0.26, 0.18) * caustic(p * 0.7, t) * 0.4;
	// Light coming through gathers along the lower inside edge.
	float glow = ramp(4.0, 1.2, depth) * ramp(0.1, 0.9, n.y);
	wc = mix(wc, vec3(0.75, 1.0, 0.98), 0.75 * glow);
	wc = mix(wc, vec3(0.9, 1.0, 1.0), gGlow * 0.5);

	vec4 body = paint(AIR_RGB, 0.18 + 0.14 * ramp(gLevel, gTop, p.y));
	body = mix(body, paint(wc, 0.86), wet);

	// Meniscus: a bright line on the surface over a pale band.
	body = over(paint(vec3(0.80, 1.0, 1.0), 0.40 * ramp(0.4, 1.2, below) * ramp(3.4, 1.4, below) * dry), body);
	body = over(paint(vec3(1.0), 0.95 * ramp(1.15, 0.25, abs(below)) * dry), body);

	// Tiny bubbles rising to the surface, or riding round a ring of water.
	float bub = 0.0;
	for (int i = 0; i < 4; i++) {
		float fi = float(i);
		float ph = fract(t / (1.25 + 0.4 * fi) + hash11(fi + 3.0));
		vec2 rise = vec2(gCx + (hash11(fi + 7.0) - 0.5) * 9.0 + sin(t * 3.0 + fi * 2.1) * 0.8, mix(gBottom - 2.5, gLevel + 1.0, ph));
		float a = gBusy * 0.55 + fi * 1.5708;
		vec2 orbit = vec2(cos(a), sin(a)) * (11.0 + 1.2 * sin(fi * 2.0 + t * 4.0)) * gScale;
		vec2 c = mix(rise, orbit, gFill);
		float r = (0.55 + 0.5 * hash11(fi + 1.0)) * mix(0.7, 1.0, ph);
		bub = max(bub, clamp((r - length(p - c)) / px + 0.5, 0.0, 1.0));
	}
	body = over(paint(vec3(1.0), 0.85 * bub * wet * ramp(1.3, 2.3, depth)), body);

	// Bevel: rim facing the light catches it, the far rim darkens.
	float bevel = ramp(3.2, 0.8, depth);
	float facing = dot(n, TO_LIGHT);
	body = over(paint(vec3(1.0), 0.80 * bevel * max(facing, 0.0)), body);
	body = over(paint(OUTLINE_RGB, 0.40 * bevel * max(-facing, 0.0)), body);

	// Aero gloss: crisp white over the upper part, soft lower edge, inset.
	float glossY = gTop + h * 0.38 + wx * 0.18;
	float gloss = ramp(glossY + 0.35, glossY - 0.9, p.y) * ramp(1.0, 1.9, depth);
	body = over(paint(vec3(1.0), gloss * mix(0.95, 0.62, ramp(gTop, glossY, p.y))), body);

	// Idle shine sweeping across the glass.
	float sw = (p.x * 0.6 + p.y - gTop) / (h + 12.0);
	body = over(paint(vec3(1.0), 0.75 * ramp(0.10, 0.0, abs(sw - gSweep)) * ramp(1.0, 2.0, depth)), body);

	body = over(paint(OUTLINE_RGB, 0.95 * ramp(OUTLINE_W + 0.5 * px, OUTLINE_W - 0.5 * px, depth)), body);
	fragColor = over(body * cover, under) * gAlpha;
}
`;

export class GlassCursor {
	constructor(scene) {
		this.data = new Float32Array(24);
		const material = premultipliedMaterial({
			common: CURSOR_SDF_GLSL + COMMON,
			vertex: VERTEX,
			fragment: FRAGMENT,
			uniforms: { uGlass: { value: this.data }, uAtlas: { value: cursorAtlas() } },
		});
		this.mesh = layerMesh(scene, quadGeometry(), material, ORDER.glass);
		this.from = 'default';
		this.to = 'default';
		this.morph = 1;
		this.alpha = 0;
		this.scale = 1;
		this.scaleVel = 0;
		this.tilt = 0;
		this.tiltVel = 0;
		this.wave = 0;
		this.wavePhase = 0;
		this.ax = 0;
		this.ay = 0;
		this.lastVx = 0;
		this.lastVy = 0;
		this.busy = 0;
		this.glow = 0;
	}

	get visible() {
		return this.alpha > 0;
	}

	// Smoothed cursor acceleration, px/s² (also used for flicks).
	get accel() {
		return [this.ax, this.ay];
	}

	snap(shape) {
		this.from = this.to = shape;
		this.morph = 1;
		this.tilt = this.tiltVel = 0;
		this.wave = 0;
		this.ax = this.ay = 0;
		this.lastVx = this.lastVy = 0;
	}

	setShape(shape) {
		if (shape === this.to) return;
		this.from = this.morph < 0.5 ? this.from : this.to;
		this.to = shape;
		this.morph = 0;
		this.scaleVel -= 3.4;
		this.wave = Math.min(MAX_WAVE, this.wave + 1.2);
	}

	press() {
		this.scaleVel -= 2.6;
		this.glow = 1;
		this.wave = Math.min(MAX_WAVE, this.wave + 0.9);
	}

	update(dt, cursor) {
		const target = cursor.visible ? 1 : 0;
		this.alpha = target > this.alpha
			? Math.min(1, this.alpha + dt / FADE_IN_S)
			: Math.max(0, this.alpha - dt / FADE_OUT_S);
		this.mesh.visible = this.alpha > 0;
		if (this.alpha <= 0) return false;

		this.morph = Math.min(1, this.morph + dt / MORPH_S);
		this.scaleVel += (-380 * (this.scale - 1) - 13 * this.scaleVel) * dt;
		this.scale = Math.min(1.3, Math.max(0.72, this.scale + this.scaleVel * dt));
		this.glow = Math.max(0, this.glow - dt * 4);
		this.busy = (this.busy + dt * BUSY_SPEED) % (Math.PI * 2);

		// The water line leans against acceleration like water in a carried glass.
		if (dt > 0) {
			const k = 1 - Math.exp(-dt * 14);
			this.ax += ((cursor.vx - this.lastVx) / dt - this.ax) * k;
			this.ay += ((cursor.vy - this.lastVy) / dt - this.ay) * k;
		}
		this.lastVx = cursor.vx;
		this.lastVy = cursor.vy;
		const want = Math.max(-MAX_TILT, Math.min(MAX_TILT, this.ax / Math.max(SLOSH_G * 0.4, SLOSH_G - this.ay)));
		const w = Math.PI * 2 * SLOSH_HZ;
		this.tiltVel += (-w * w * (this.tilt - want) - 2 * SLOSH_DAMPING * w * this.tiltVel) * dt;
		this.tilt = Math.max(-1, Math.min(1, this.tilt + this.tiltVel * dt));
		this.wave = Math.min(MAX_WAVE, this.wave * Math.exp(-WAVE_DECAY * dt) + Math.abs(this.tiltVel) * dt * 1.6);
		this.wavePhase = (this.wavePhase + dt * 10) % (Math.PI * 200);

		const e = smooth(this.morph);
		const a = shapeOf(this.from);
		const b = shapeOf(this.to);
		const ta = shapeTile(this.from);
		const tb = shapeTile(this.to);
		const top = lerp(a.top, b.top, e);
		const bottom = lerp(a.bottom, b.bottom, e);
		const idle = cursor.idle - IDLE_AFTER;
		const breath = idle > 0 ? 0.5 * Math.sin(cursor.idle * 1.9) * Math.min(1, idle) : 0;
		const sweepT = idle > 0 ? (idle % SWEEP_EVERY) / SWEEP_S : 9;

		const size = SIZE * this.scale;
		const u = this.data;
		u[0] = cursor.sx;
		u[1] = cursor.sy;
		u[2] = this.alpha;
		u[3] = size;
		u[4] = ta.tile;
		u[5] = tb.tile;
		u[6] = ta.angle;
		u[7] = tb.angle;
		u[8] = a.inflate ?? 0;
		u[9] = b.inflate ?? 0;
		u[10] = e;
		u[11] = lerp(a.fill ?? 0, b.fill ?? 0, e);
		u[12] = (top + (bottom - top) * (1 - FILL) + breath) * size;
		u[13] = this.tilt;
		u[14] = this.wave;
		u[15] = this.wavePhase;
		u[16] = top * size;
		u[17] = bottom * size;
		u[18] = lerp(a.cx, b.cx, e) * size;
		u[19] = this.busy;
		u[20] = sweepT <= 1 ? -0.15 + sweepT * 1.3 : -9;
		u[21] = lerp(a.tint ?? 0, b.tint ?? 0, e);
		u[22] = this.glow;
		u[23] = 0;
		return true;
	}
}
