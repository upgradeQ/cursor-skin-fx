// The hero cursor: a sliver of glass that is a window onto a Bliss landscape.
// Inside the silhouette a blue sky with a drifting cloud sits over a rolling
// green hill; the hill pans as the cursor crosses the screen and sloshes a
// little behind fast moves. Over it go a crisp white gloss band, a bevel that
// bends the view like a lens rim, a caustic glow along the bottom inner edge,
// a deep teal outline and a soft shadow. Shapes morph by mixing two signed
// distance fields, with a squash-and-pop; resize arrows swing round instead.
import { shapeTile } from '../../shared/cursor-sdf.js';
import { CURSOR_SDF_GLSL, cursorAtlas, layerMesh, ORDER, premultipliedMaterial, quadGeometry } from './gl.js';
import { LANDSCAPE_GLSL, PALETTE_GLSL } from './world.js';

const MORPH_S = 0.2;          // s for one silhouette to become the next
const TURN_RATE = 14;         // 1/s, resize arrows swinging to a new angle
const FADE_IN_S = 0.09;
const FADE_OUT_S = 0.16;
const IDLE_LIFE_S = 1.5;      // idle this long before the glass starts to breathe
const SWEEP_PERIOD_S = 3.4;   // one gloss sweep per period while idle
const SWEEP_S = 0.95;
const SLOSH_K = 70;           // 1/s², spring of the landscape lagging behind motion
const SLOSH_DAMP = 6;         // 1/s
const PAN = 1.3;              // shape heights the hill pans across one screen width
const SPIN_RATE = 5.5;        // rad/s, busy rings

// Landscape frame per shape, page px in screen axes: [top, bottom, centre x].
// Small shapes get a scaled-down world rather than a crop of a big one.
const FRAMES = {
	default: [0, 28.6, 7],
	pointer: [0, 27.6, 5],
	text: [-13, 13, 0],
	wait: [-14.2, 14.2, 0],
	progress: [0, 28.6, 7],
	crosshair: [-13.5, 13.5, 0],
	move: [-14.6, 14.6, 0],
	help: [0, 28.6, 9],
	'not-allowed': [-11.7, 11.7, 0],
	'ew-resize': [-5.4, 5.4, 0],
	'ns-resize': [-14.2, 14.2, 0],
	'nwse-resize': [-10, 10, 0],
	'nesw-resize': [-10, 10, 0],
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);

const COMMON = /* glsl */ `
uniform vec4 uGlass[5];
#define gA uGlass[0]   // hotspot xy (page px), scale xy
#define gB uGlass[1]   // tile from, angle from, tile to, angle to
#define gC uGlass[2]   // morph, alpha, landscape top, bottom (page px from the hotspot)
#define gD uGlass[3]   // landscape centre x, hill shift, cloud shift, horizon shift
#define gE uGlass[4]   // busy spin, gloss sweep (-1 off), pointer hover, text hover

const float QUAD_MIN = -40.0;     // page px around the hotspot the quad covers
const float QUAD_MAX = 64.0;
`;

const VERTEX = /* glsl */ `
in vec2 position;
out vec2 vLocal;

void main() {
	vec2 c = position * 0.5 + 0.5;
	float grow = max(max(gA.z, gA.w), 1.0);
	vLocal = mix(vec2(QUAD_MIN), vec2(QUAD_MAX), c) * grow;
	gl_Position = clipFromPage(gA.xy + vLocal);
}
`;

const FRAGMENT = /* glsl */ `
in vec2 vLocal;
out vec4 fragColor;

const float OUTLINE_OUT = 0.6;    // px the dark outline reaches past the silhouette
const float OUTLINE_IN = 0.45;    // px it reaches inside
const float BEVEL_PX = 3.2;
const float REFRACT_PX = 2.6;
const float HORIZON = 0.6;
const vec2 SHADOW_OFFSET = vec2(1.6, 2.6);
const float SHADOW_BLUR = 4.5;
const float SHADOW_ALPHA = 0.34;
const vec2 LIGHT_2D = vec2(-0.6, -0.8);          // outward normals facing this catch the light
const vec3 LIGHT_3D = vec3(-0.42, -0.62, 0.66);  // screen axes, y down, z to the viewer
const vec2 MINI_RING = vec2(25.0, 30.0);
const vec2 HELP_DOT = vec2(19.5, 23.0);
const vec3 CAUSTIC = vec3(0.80, 1.00, 0.70);

vec3 field(vec2 q) {
	vec3 fa = cursorFieldRotated(gB.x, q, gB.y);
	vec3 fb = cursorFieldRotated(gB.z, q, gB.w);
	return mix(fa, fb, gC.x);
}

vec2 toTile(vec2 q, float angle) {
	float c = cos(angle);
	float s = sin(angle);
	return vec2(c * q.x + s * q.y, -s * q.x + c * q.y);
}

// Material weights of one tile at tq: x busy ring, y mini ring, z sun-gold glyph, w warm red.
vec4 tileMaterial(float tile, vec2 tq) {
	vec4 w = vec4(0.0);
	if (tile == 8.0) w.x = 1.0;
	if (tile == 9.0) w.y = 1.0 - smoothstep(8.5, 10.5, length(tq - MINI_RING));
	if (tile == 7.0) w.z = 1.0 - smoothstep(7.0, 9.0, length(tq - HELP_DOT));
	if (tile == 6.0) w.w = 1.0;
	return w;
}

vec4 materials(vec2 q) {
	vec4 wa = tileMaterial(gB.x, toTile(q, gB.y));
	vec4 wb = tileMaterial(gB.z, toTile(q, gB.w));
	return mix(wa, wb, gC.x);
}

// Glossy green-to-blue comet running round a ring, a sun glint at its head.
vec3 busyRing(vec2 q, vec2 center, float spin) {
	vec2 v = q - center;
	float a = atan(v.y, v.x);
	float f = fract((spin - a) / TAU);
	vec3 col = mix(vec3(0.66, 0.97, 0.34), vec3(0.08, 0.78, 0.78), smoothstep(0.0, 0.42, f));
	col = mix(col, vec3(0.08, 0.36, 0.88), smoothstep(0.38, 1.0, f));
	float ga = atan(sin(a - spin + 0.3), cos(a - spin + 0.3));
	col += vec3(1.0, 0.96, 0.78) * exp(-ga * ga * 24.0) * 0.9;
	return col;
}

vec3 goldGlass(vec2 q) {
	return mix(vec3(1.0, 0.94, 0.58), vec3(1.0, 0.60, 0.08), clamp((q.y - 16.0) / 14.0, 0.0, 1.0));
}

vec3 redGlass(vec2 q) {
	return mix(vec3(1.0, 0.58, 0.36), vec3(0.80, 0.10, 0.06), clamp((q.y + 12.0) / 24.0, 0.0, 1.0));
}

vec3 glassBody(vec2 q, vec2 local, float d, vec2 grad, float px) {
	float inner = -d - OUTLINE_IN;               // px inside the outline
	float edge = 1.0 - clamp(inner / BEVEL_PX, 0.0, 1.0);
	float edge2 = edge * edge;
	float top = gC.z;
	float h = max(gC.w - top, 6.0);

	// the bevel bends the view inward, like the rim of a lens
	vec2 qr = local - grad * edge2 * REFRACT_PX;
	vec2 L = vec2((qr.x - gD.x) / h, (qr.y - top) / h);
	vec3 col = bliss2D(L, gD.y, gD.z, HORIZON + gD.w, px / h, uTime);

	vec4 w = materials(q);
	if (w.x > 0.001) col = mix(col, busyRing(q, vec2(0.0), gE.x), w.x);
	if (w.y > 0.001) col = mix(col, busyRing(q, MINI_RING, gE.x * 1.3), w.y);
	if (w.z > 0.001) col = mix(col, goldGlass(q), w.z);
	if (w.w > 0.001) col = mix(col, redGlass(q), w.w);

	// thicker glass along the edge soaks up a little teal
	col = mix(col, col * vec3(0.50, 0.74, 0.84), edge2 * 0.6);
	// light through the body gathers along the bottom inner edge
	col += CAUSTIC * edge2 * smoothstep(0.15, 0.95, grad.y) * 0.75;
	// a bright rim on the edges that face the light
	float rim = 1.0 - smoothstep(0.0, 1.1, inner);
	float facing = max(dot(grad, LIGHT_2D), 0.0);
	col = mix(col, vec3(1.0), rim * (0.32 + 0.6 * facing));

	// the gloss band: bright at the top, crisp lower edge, inset from the rim
	vec2 Lg = vec2((local.x - gD.x) / h, (local.y - top) / h);
	float line = 0.47 - 0.10 * Lg.x;
	float above = clamp(0.5 - (Lg.y - line) * h / px, 0.0, 1.0);
	float fade = mix(0.66, 0.2, clamp(Lg.y / line, 0.0, 1.0));
	float inset = smoothstep(0.15, 0.85, inner);
	col = mix(col, vec3(1.0), above * fade * inset);

	// specular off the bevel
	vec3 n = normalize(vec3(grad * edge2 * 1.8, 1.0));
	vec3 hv = normalize(normalize(LIGHT_3D) + vec3(0.0, 0.0, 1.0));
	col += vec3(1.0) * pow(max(dot(n, hv), 0.0), 60.0) * 0.8;

	// idle: a gloss sweep crossing the glass
	if (gE.y >= 0.0) {
		float s = Lg.x * 0.55 + Lg.y - mix(-0.45, 1.6, gE.y);
		col = mix(col, vec3(1.0), exp(-s * s / 0.005) * 0.8 * inset);
	}
	return col;
}

// Light behind the glass while hovering links and text.
vec4 hoverLight(vec2 local) {
	vec4 c = vec4(0.0);
	if (gE.z > 0.001) {
		// a halo breathing round the fingertip
		float r = length(local - vec2(0.0, 2.5));
		float k = (r - (9.5 + 1.6 * sin(uTime * 4.2))) / 1.5;
		float a = (exp(-k * k) * 0.6 + exp(-r * r / 70.0) * 0.22) * gE.z;
		c = vec4(vec3(0.36, 0.95, 0.82) * a, a * 0.7);
	}
	if (gE.w > 0.001) {
		// a sunbeam standing behind the I-beam, pulsing like a caret
		float beam = exp(-local.x * local.x / 20.0) * (1.0 - smoothstep(9.0, 20.0, abs(local.y)));
		float a = beam * gE.w * (0.55 + 0.45 * sin(uTime * 3.6));
		c = over(underInk(vec4(vec3(1.0, 0.90, 0.48) * a, a * 0.55), vec3(1.0, 0.78, 0.30), 0.6), c);
	}
	return c;
}

void main() {
	float px = 1.0 / uPr;
	vec2 s = gA.zw;
	float sMin = min(s.x, s.y);
	vec2 q = vLocal / s;
	vec3 f = field(q);
	float d = f.x * sMin;
	// Not renormalised: the gradient fades out along the medial axis of thin
	// parts, which keeps bevel normals from flipping there.
	vec2 grad = f.yz / max(length(f.yz), 1.0);

	float dShadow = field((vLocal - SHADOW_OFFSET) / s).x * sMin;
	float shA = SHADOW_ALPHA * (1.0 - smoothstep(-1.5, SHADOW_BLUR, dShadow));
	vec4 col = vec4(SHADOW_INK * shA, shA);
	col = over(hoverLight(vLocal), col);

	float outer = clamp(0.5 - (d - OUTLINE_OUT) / px, 0.0, 1.0);
	if (outer > 0.0) {
		col = over(vec4(OUTLINE_TEAL, 1.0) * 0.92 * outer, col);
		float inside = clamp(0.5 - (d + OUTLINE_IN) / px, 0.0, 1.0);
		if (inside > 0.0) {
			col = over(vec4(glassBody(q, vLocal, d, grad, px), 1.0) * inside, col);
		}
	}
	fragColor = col * gC.y;
}
`;

export class GlassCursor {
	constructor(scene) {
		this.data = new Float32Array(20);
		const material = premultipliedMaterial({
			common: CURSOR_SDF_GLSL + PALETTE_GLSL + LANDSCAPE_GLSL + COMMON,
			vertex: VERTEX,
			fragment: FRAGMENT,
			uniforms: { uGlass: { value: this.data }, uAtlas: { value: cursorAtlas() } },
		});
		this.mesh = layerMesh(scene, quadGeometry(), material, ORDER.glass);

		this.alpha = 0;
		this.shape = 'default';
		this.from = shapeTile('default');
		this.to = this.from;
		this.angleFrom = 0;
		this.angleTo = 0;
		this.targetAngle = 0;
		this.morph = 1;
		this.frame = [...FRAMES.default];
		this.squash = 0;           // + wide, - tall
		this.squashVel = 0;
		this.scale = 1;
		this.scaleVel = 0;
		this.pressed = false;
		this.slosh = 0;
		this.sloshVel = 0;
		this.sloshY = 0;
		this.sloshYVel = 0;
		this.pointer = 0;
		this.text = 0;
		this.life = 0;             // 0..1, eases in while idle
		this.spin = 0;
	}

	setShape(shape) {
		const next = shapeTile(shape);
		this.shape = shape;
		if (next.tile === this.to.tile) {
			// The same arrows at a new angle swing round the short way; they are
			// symmetric under half a turn.
			const half = Math.PI / 2;
			const delta = ((((next.angle - this.targetAngle + half) % Math.PI) + Math.PI) % Math.PI) - half;
			this.targetAngle += delta;
		} else {
			this.from = this.to;
			this.angleFrom = this.angleTo;
			this.to = next;
			this.angleTo = this.targetAngle = next.angle;
			this.morph = 0;
		}
		this.squashVel += 7;
		this.scale = Math.min(this.scale, 0.84);
	}

	// Appear in place: no morph, a small pop from slightly smaller.
	snap(shape) {
		this.shape = shape;
		this.from = this.to = shapeTile(shape);
		this.angleFrom = this.angleTo = this.targetAngle = this.to.angle;
		this.morph = 1;
		this.frame = [...(FRAMES[shape] ?? FRAMES.default)];
		this.scale = 0.72;
		this.scaleVel = 0;
		this.slosh = this.sloshVel = this.sloshY = this.sloshYVel = 0;
	}

	press(down) {
		this.pressed = down;
		if (!down) this.scaleVel += 2.5;
	}

	// True while anything is on screen.
	update(dt, t, cursor, width, height) {
		const shown = cursor.visible;
		this.alpha = shown ? Math.min(1, this.alpha + dt / FADE_IN_S) : Math.max(0, this.alpha - dt / FADE_OUT_S);
		this.mesh.visible = this.alpha > 0;
		if (this.alpha <= 0) return false;

		this.morph = Math.min(1, this.morph + dt / MORPH_S);
		this.angleTo += (this.targetAngle - this.angleTo) * (1 - Math.exp(-dt * TURN_RATE));
		const target = FRAMES[this.shape] ?? FRAMES.default;
		const kf = 1 - Math.exp(-dt * 12);
		for (let i = 0; i < 3; i++) this.frame[i] += (target[i] - this.frame[i]) * kf;

		const idle = cursor.idle;
		this.life += ((idle > IDLE_LIFE_S ? 1 : 0) - this.life) * (1 - Math.exp(-dt * 2.5));
		let sweep = -1;
		if (idle > IDLE_LIFE_S) {
			const c = (idle - IDLE_LIFE_S) % SWEEP_PERIOD_S;
			if (c < SWEEP_S) sweep = c / SWEEP_S;
		}
		const breathe = this.life * 0.03 * Math.sin(t * 2.4);

		// Semi-implicit springs: squash wobble, press squeeze and pop, slosh.
		this.squashVel += (-200 * this.squash - 9 * this.squashVel) * dt;
		this.squash += this.squashVel * dt;
		const rest = (this.pressed ? 0.86 : 1) + breathe;
		this.scaleVel += (300 * (rest - this.scale) - 15 * this.scaleVel) * dt;
		this.scale += this.scaleVel * dt;
		const sx = clamp(-cursor.vx / 2600, -0.4, 0.4);
		const sy = clamp(-cursor.vy / 9000, -0.08, 0.08);
		this.sloshVel += (SLOSH_K * (sx - this.slosh) - SLOSH_DAMP * this.sloshVel) * dt;
		this.slosh += this.sloshVel * dt;
		this.sloshYVel += (SLOSH_K * (sy - this.sloshY) - SLOSH_DAMP * this.sloshYVel) * dt;
		this.sloshY += this.sloshYVel * dt;

		const kh = 1 - Math.exp(-dt * 9);
		this.pointer += ((this.shape === 'pointer' ? 1 : 0) - this.pointer) * kh;
		this.text += ((this.shape === 'text' ? 1 : 0) - this.text) * kh;
		this.spin = (this.spin + dt * SPIN_RATE) % (Math.PI * 2 * 40);

		const nx = cursor.sx / width - 0.5;
		const ny = cursor.sy / height - 0.5;
		const sq = clamp(this.squash, -0.3, 0.3);
		const d = this.data;
		d[0] = cursor.sx;
		d[1] = cursor.sy;
		d[2] = this.scale * (1 + sq);
		d[3] = this.scale * (1 - sq * 0.8);
		d[4] = this.from.tile;
		d[5] = this.angleFrom;
		d[6] = this.to.tile;
		d[7] = this.angleTo;
		d[8] = smooth(this.morph);
		d[9] = smooth(this.alpha);
		d[10] = this.frame[0];
		d[11] = this.frame[1];
		d[12] = this.frame[2];
		d[13] = nx * PAN + this.slosh;
		d[14] = nx * PAN * 0.45 + this.slosh * 0.5;
		d[15] = ny * 0.08 + this.sloshY;
		d[16] = this.spin;
		d[17] = sweep;
		d[18] = this.pointer;
		d[19] = this.text;
		return true;
	}
}
