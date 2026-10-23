// Holding the button grows a little aquarium globe at the hotspot: a glossy
// water orb with a green hill in the bottom, light rays and swirling caustics
// inside. It trails a drag on a wobbly spring and stretches with speed, and
// letting go pops it. Drawn in two layers so a fish can swim between the
// water (back) and the glass (front).
import { layerMesh, ORDER, premultipliedMaterial, quadGeometry } from './gl.js';

const MIN_RADIUS = 12;       // px when it first appears
const MAX_RADIUS = 62;       // px when fully grown
const GROW_S = 0.55;         // s time constant of the growth
const FOLLOW_HZ = 4.6;       // spring the globe trails the hotspot on
const FOLLOW_DAMPING = 0.42;
const POP_S = 0.1;           // s the pop takes
const MAX_STRETCH = 0.14;

const COMMON = /* glsl */ `
uniform vec4 uOrb[3];
#define oCenter uOrb[0].xy
#define oRadius uOrb[0].z
#define oAlpha uOrb[0].w
#define oDir uOrb[1].xy      // stretch direction
#define oStretch uOrb[1].z
#define oWobble uOrb[1].w
#define oSwirl uOrb[2].x     // rad, caustic swirl
#define oGrow uOrb[2].y      // 0..1
`;

const VERTEX = /* glsl */ `
in vec2 position;
out vec2 vLocal;

void main() {
	vec2 local = position * (oRadius * (1.0 + oStretch) * 1.12 + 18.0) + vec2(0.0, 6.0);
	vLocal = local;
	gl_Position = clipFromPage(oCenter + local);
}
`;

const SHAPE = /* glsl */ `
in vec2 vLocal;
out vec4 fragColor;

const vec3 DEEP = vec3(0.02, 0.30, 0.42);

// Un-stretched position, and the wobbling radius there.
vec3 shape(vec2 p) {
	vec2 side = vec2(-oDir.y, oDir.x);
	vec2 q = oDir * (dot(p, oDir) / (1.0 + oStretch)) + side * (dot(p, side) / (1.0 - 0.5 * oStretch));
	float a = atan(q.y, q.x);
	float t = uTime;
	float r = oRadius * (1.0 + oWobble * (0.6 * sin(3.0 * a + t * 5.0) + 0.4 * sin(5.0 * a - t * 7.0)));
	return vec3(q, r);
}

float caustic(vec2 u, float t) {
	float l = length(u);
	float a = atan(u.y, u.x) + oSwirl * (1.2 - l);
	float v = sin(a * 5.0 + l * 9.0 - t * 1.6) * sin(a * 3.0 - l * 7.0 + t * 1.1);
	return pow(1.0 - abs(v), 7.0);
}
`;

const BACK = SHAPE + /* glsl */ `
void main() {
	float px = 1.0 / uPr;
	float t = uTime;
	vec3 s = shape(vLocal);
	float R = s.z;
	float d = length(s.xy) - R;
	vec2 u = s.xy / R;

	float sd = length((vLocal - vec2(4.0, 9.0) * (R / 60.0)) / vec2(1.0, 0.92)) - R * 0.9;
	vec4 col = paint(vec3(0.0, 0.08, 0.14), 0.24 * ramp(R * 0.35, -R * 0.3, sd));

	float cover = clamp(0.5 - d / px, 0.0, 1.0);
	if (cover <= 0.0) {
		fragColor = col * oAlpha;
		return;
	}
	float l = length(u);

	// Water body, paler at the top where the light comes in.
	vec4 w = paint(mix(vec3(0.72, 0.96, 1.0), vec3(0.08, 0.56, 0.88), ramp(-0.9, 0.9, u.y)), 0.40 + 0.30 * ramp(0.45, 1.0, l));
	float rays = pow(0.5 + 0.5 * sin((u.x * 0.8 + u.y * 0.45) * 8.0 + t * 0.7), 5.0) * ramp(0.7, -0.7, u.y);
	w = over(paint(vec3(1.0), 0.16 * rays), w);
	w = over(paint(vec3(0.80, 1.0, 1.0), 0.40 * caustic(u, t) * oGrow), w);

	// A grassy hill in the bottom of the globe.
	float hillY = 0.46 + 0.24 * u.x * u.x - 0.06 * sin(u.x * 3.0 + 0.8);
	float hill = clamp((u.y - hillY) * R / px + 0.5, 0.0, 1.0);
	vec3 grass = mix(vec3(0.62, 0.92, 0.28), vec3(0.14, 0.56, 0.18), ramp(hillY, hillY + 0.45, u.y));
	grass = mix(grass, vec3(0.92, 1.0, 0.62), ramp(0.06, 0.0, u.y - hillY) * ramp(-0.8, 0.0, u.x) * 0.8);
	w = over(paint(grass, 0.92 * hill), w);

	// Small bubbles drifting up.
	float b = 0.0;
	for (int i = 0; i < 5; i++) {
		float fi = float(i);
		float ph = fract(t / (1.6 + 0.35 * fi) + hash11(fi + 9.0));
		vec2 c = vec2((hash11(fi + 4.0) - 0.5) * 1.1 + 0.06 * sin(t * 2.0 + fi), mix(0.55, -0.85, ph)) * R;
		float r = mix(1.2, 2.6, hash11(fi + 2.0)) * (0.5 + 0.5 * oGrow);
		float e = length(vLocal - c);
		b = max(b, ramp(r + px, r - px, e) * ramp(r * 0.35, r, e));
	}
	w = over(paint(vec3(1.0), 0.8 * b), w);
	fragColor = over(w * cover, col) * oAlpha;
}
`;

const FRONT = SHAPE + /* glsl */ `
void main() {
	float px = 1.0 / uPr;
	vec3 s = shape(vLocal);
	float R = s.z;
	float d = length(s.xy) - R;
	vec2 u = s.xy / R;
	float l = length(u);

	vec4 col = paint(vec3(1.0), 0.35 * ramp(1.8, 0.4, d));
	float cover = clamp(0.5 - d / px, 0.0, 1.0);
	if (cover <= 0.0) {
		fragColor = col * oAlpha;
		return;
	}

	// Fresnel rim, brighter toward the light.
	float rim = pow(ramp(0.62, 1.0, l), 2.0);
	vec4 g = paint(mix(vec3(0.75, 0.97, 1.0), vec3(1.0), ramp(0.6, -0.6, u.x + u.y)), 0.55 * rim);
	// Light focused through the globe collects in its lower inside edge.
	g = over(paint(vec3(0.78, 1.0, 1.0), 0.62 * ramp(0.62, 0.95, l) * ramp(0.15, 0.85, u.y)), g);
	// Aero window highlight: crisp top edge, fading toward its lower edge.
	vec2 hp = (u - vec2(-0.04, -0.46)) / vec2(0.70, 0.40);
	float hd = (length(hp) - 1.0) * 0.4 * R;
	float hi = clamp(0.5 - hd / px, 0.0, 1.0) * mix(0.9, 0.08, ramp(-0.9, -0.1, u.y));
	g = over(paint(vec3(1.0), hi), g);
	g = over(paint(vec3(1.0), 0.75 * ramp(0.10, 0.05, length(u - vec2(0.50, 0.46)))), g);
	g = over(paint(DEEP, 0.85 * ramp(1.15 + 0.5 * px, 1.15 - 0.5 * px, -d)), g);
	fragColor = over(g * cover, col) * oAlpha;
}
`;

export class Orb {
	constructor(scene) {
		this.data = new Float32Array(12);
		const geo = quadGeometry();
		const layer = (fragment, order) => layerMesh(scene, geo, premultipliedMaterial({
			common: COMMON,
			vertex: VERTEX,
			fragment,
			uniforms: { uOrb: { value: this.data } },
		}), order);
		this.back = layer(BACK, ORDER.orbBack);
		this.front = layer(FRONT, ORDER.orbFront);
		this.x = 0;
		this.y = 0;
		this.vx = 0;
		this.vy = 0;
		this.radius = 0;
		this.grow = 0;
		this.alpha = 0;
		this.popping = -1;       // s into the pop, or -1
		this.holding = false;
		this.swirl = 0;
		this.wobble = 0;
	}

	get visible() {
		return this.alpha > 0;
	}

	// The globe is big enough for the fish to live in.
	get habitable() {
		return this.holding && this.radius > 24;
	}

	// Ends the hold: pops the globe and returns it, or null if there was none.
	release() {
		if (!this.holding) return null;
		this.holding = false;
		this.popping = 0;
		return { x: this.x, y: this.y, radius: this.radius, strength: this.grow };
	}

	cancel() {
		this.holding = false;
		this.alpha = 0;
	}

	update(dt, t, cursor, held) {
		if (held > 0 && cursor.visible) {
			if (!this.holding) {
				this.holding = true;
				this.popping = -1;
				this.x = cursor.sx;
				this.y = cursor.sy;
				this.vx = this.vy = 0;
				this.wobble = 0.05;
			}
			const grow = 1 - Math.exp(-held / GROW_S);
			const prev = this.radius;
			this.grow = grow;
			this.radius = MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * grow;
			this.alpha = Math.min(1, this.alpha + dt / 0.08);
			// Jelly: wobbles while it grows or swings around.
			const w = Math.PI * 2 * FOLLOW_HZ;
			this.vx += (-w * w * (this.x - cursor.sx) - 2 * FOLLOW_DAMPING * w * this.vx) * dt;
			this.vy += (-w * w * (this.y - cursor.sy) - 2 * FOLLOW_DAMPING * w * this.vy) * dt;
			this.x += this.vx * dt;
			this.y += this.vy * dt;
			const speed = Math.hypot(this.vx, this.vy);
			const target = Math.min(0.035, (this.radius - prev) / Math.max(dt, 1e-3) / 2500 + speed / 30000);
			this.wobble += (target - this.wobble) * (1 - Math.exp(-dt * 6));
		} else if (this.holding) {
			this.cancel();
		}
		if (this.popping >= 0) {
			this.popping += dt;
			const k = Math.min(1, this.popping / POP_S);
			this.radius *= 1 + dt * 2.2;
			this.alpha = 1 - k;
			if (k >= 1) this.popping = -1;
		}
		this.back.visible = this.front.visible = this.alpha > 0;
		if (this.alpha <= 0) return false;

		this.swirl = (this.swirl + dt * 1.8) % (Math.PI * 200);
		const speed = Math.hypot(this.vx, this.vy);
		const u = this.data;
		u[0] = this.x;
		u[1] = this.y;
		u[2] = this.radius;
		u[3] = this.alpha;
		u[4] = speed > 1 ? this.vx / speed : 1;
		u[5] = speed > 1 ? this.vy / speed : 0;
		u[6] = Math.min(MAX_STRETCH, speed / 2400);
		u[7] = this.wobble;
		u[8] = this.swirl;
		u[9] = this.grow;
		return true;
	}
}
