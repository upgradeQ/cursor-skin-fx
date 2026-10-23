// Short-lived accents drawn as instanced quads from a small CPU list: soap
// film ripples on clicks, the bubble wand, the swirl of air under the right
// button, the sunburst when a blown bubble lets go, and the shimmer around a
// fingertip resting on a link. Each is analytic in its own quad.
import { InstanceLayer, ORDER, premultipliedMaterial } from './gl.js';
import { OPTICS_GLSL } from './optics.js';

export const KIND = { ripple: 0, wand: 1, swirl: 2, flash: 3, halo: 4 };
const CAPACITY = 48;

const VERTEX = /* glsl */ `
in vec2 position;
in vec4 iA;   // centre xy (page px), age s, duration s
in vec4 iB;   // r0 px, r1 px, kind, amount (strength / opacity)

out vec2 vLocal;
flat out vec4 vA;   // age, dur, r0, r1
flat out vec2 vB;   // kind, amount

void main() {
	float kind = iB.z;
	float extent = iB.y + 14.0;
	if (kind > 0.5 && kind < 1.5) extent = iB.x + 34.0;
	if (kind > 1.5 && kind < 2.5) extent = iB.y + 40.0;
	vLocal = position * extent;
	gl_Position = clipFromPage(iA.xy + vLocal);
	vA = vec4(iA.zw, iB.xy);
	vB = iB.zw;
}
`;

const FRAGMENT = /* glsl */ `
in vec2 vLocal;
flat in vec4 vA;
flat in vec2 vB;
out vec4 fragColor;

float easeOut(float k) {
	return 1.0 - pow(1.0 - k, 3.0);
}

// A click on the film: a thin rainbow ring with a dark inner line, spreading and thinning.
vec4 ripple(vec2 p, float age, float dur, float r0, float r1, float amount) {
	float k = clamp(age / dur, 0.0, 1.0);
	float r = mix(r0, r1, easeOut(k));
	float d = length(p) - r;
	float w = mix(3.2, 0.9, k);
	float fade = (1.0 - k) * (1.0 - k) * amount;
	float th = atan(p.y, p.x);
	vec3 film = max(mix(vec3(0.7), thinFilm(380.0 + 260.0 * sin(th * 2.0 + age * 6.0) + d * 20.0, 0.8), 1.5), vec3(0.0));
	float bright = exp(-pow(d / w, 2.0));
	float dark = exp(-pow((d + w * 1.2) / (w * 0.45 + 0.5), 2.0));
	vec4 c = vec4(vec3(0.02, 0.24, 0.36) * 0.55, 0.55) * dark * fade;
	c = over(vec4(mix(vec3(1.0), film, 0.55) * 0.95, 0.75) * bright * fade, c);
	return c;
}

// A sunny plastic bubble wand: glossy ring on a short handle tucked under the cursor.
vec4 wand(vec2 p, float age, float r, float amount, float px) {
	float pop = 1.0 + 0.35 * exp(-age * 9.0) * sin(age * 30.0);
	vec2 q = p / pop;
	float tube = 2.4;
	float dRing = abs(length(q) - r) - tube;
	vec2 hd = normalize(vec2(1.0, 1.25));
	float along = clamp(dot(q, hd), r, r + 20.0);
	float dHandle = length(q - hd * along) - 2.0;
	float d = min(dRing, dHandle);
	float cov = clamp(0.5 - d * pop / px, 0.0, 1.0);
	// Rounded tube shading from the distance across it.
	float across = clamp(-d / tube, 0.0, 1.0);
	float sideRing = (length(q) - r) / tube;
	float side = dHandle < dRing ? -dot(q - hd * along, vec2(-hd.y, hd.x)) / 2.0 : sideRing;
	vec3 warm = mix(vec3(1.0, 0.62, 0.08), vec3(1.0, 0.86, 0.28), clamp(0.5 - side * 0.6 - q.y / (r * 3.0), 0.0, 1.0));
	vec3 col = warm * mix(0.75, 1.05, across);
	float gloss = smoothstep(0.25, 0.9, across) * smoothstep(0.1, -0.7, side) * 0.85;
	col = mix(col, vec3(1.0), gloss);
	float outline = smoothstep(-0.9, -0.15, d);
	col = mix(col, vec3(0.55, 0.25, 0.02), outline * 0.7);
	float shadowD = min(abs(length(q - vec2(1.4, 2.4)) - r) - tube, length(q - vec2(1.4, 2.4) - hd * along) - 2.0);
	float shadow = (1.0 - smoothstep(-1.0, 3.0, shadowD)) * 0.28;
	vec4 body = vec4(col, 1.0) * cov;
	return over(body, vec4(0.0, 0.05, 0.08, 1.0) * shadow) * amount;
}

// Vista-style aurora swooshes orbiting the cursor while the right button swirls.
vec4 swirl(vec2 p, float age, float r0, float r1, float amount) {
	float rr = length(p);
	float th = atan(p.y, p.x);
	vec4 c = vec4(0.0);
	for (int k = 0; k < 3; k++) {
		float fk = float(k);
		float rad = mix(r0, r1, fk / 2.0) + 6.0 * sin(age * 3.0 + fk * 2.0);
		float a = fract((th - age * (4.2 + fk * 0.9) - fk * 2.1) / TAU);
		float tail = smoothstep(0.0, 0.32, a) * (1.0 - smoothstep(0.32, 0.36, a));
		float band = exp(-pow((rr - rad - a * 10.0) / (3.0 + 6.0 * a), 2.0));
		vec3 hue = mix(vec3(0.5, 0.95, 1.0), vec3(0.62, 0.95, 0.4), fk / 2.0);
		float s = band * tail * amount;
		c = over(underInk(vec4(mix(vec3(1.0), hue, 0.6) * s * 0.85, s * 0.45), hue, 1.0), c);
	}
	return c;
}

// Sunburst where a blown bubble lets go: warm core, soft rays, a ring of light.
vec4 flash(vec2 p, float age, float dur, float r1, float amount) {
	float k = clamp(age / dur, 0.0, 1.0);
	float rr = length(p);
	float th = atan(p.y, p.x);
	float fade = (1.0 - k) * amount;
	float core = exp(-rr * rr / (40.0 + 300.0 * k));
	float rays = pow(abs(cos(th * 4.0 + age * 1.5)), 24.0) * exp(-rr / (r1 * (0.3 + 0.7 * k)));
	float ringD = rr - r1 * easeOut(k);
	float ring = exp(-pow(ringD / 2.5, 2.0)) * (1.0 - k);
	float light = core * 0.9 + rays * 0.6 + ring * 0.5;
	vec3 col = mix(vec3(1.0, 0.95, 0.7), vec3(0.75, 0.97, 1.0), smoothstep(0.0, r1 * 0.5, rr));
	return underInk(vec4(col * light, light * 0.4), vec3(1.0, 0.78, 0.35), 0.55) * fade;
}

// Film shimmer breathing round a fingertip.
vec4 halo(vec2 p, float age, float r0, float amount) {
	float r = r0 * (1.0 + 0.08 * sin(age * 4.0));
	float d = length(p) - r;
	float th = atan(p.y, p.x);
	vec3 film = max(mix(vec3(0.6), thinFilm(420.0 + 240.0 * sin(th * 2.0 - age * 3.0), 0.85), 1.5), vec3(0.0));
	float b = exp(-pow(d / 1.3, 2.0)) * amount;
	float inner = exp(-pow((d + 2.0) / 0.9, 2.0)) * amount * 0.4;
	return over(vec4(mix(vec3(1.0), film, 0.6) * b, b * 0.65), vec4(vec3(0.02, 0.22, 0.33) * inner, inner));
}

void main() {
	float kind = vB.x;
	float px = 1.0 / uPr;
	if (kind < 0.5) fragColor = ripple(vLocal, vA.x, vA.y, vA.z, vA.w, vB.y);
	else if (kind < 1.5) fragColor = wand(vLocal, vA.x, vA.z, vB.y, px);
	else if (kind < 2.5) fragColor = swirl(vLocal, vA.x, vA.z, vA.w, vB.y);
	else if (kind < 3.5) fragColor = flash(vLocal, vA.x, vA.y, vA.w, vB.y);
	else fragColor = halo(vLocal, vA.x, vA.z, vB.y);
}
`;

export class Accents {
	constructor(scene) {
		this.items = [];
		const material = premultipliedMaterial({ common: OPTICS_GLSL, vertex: VERTEX, fragment: FRAGMENT });
		this.layer = new InstanceLayer(scene, material, ORDER.accents, CAPACITY, ['iA', 'iB']);
	}

	// A timed accent; returns it so callers can move or end it. dur = Infinity
	// keeps it until end() is called.
	add(kind, x, y, { dur = 0.5, r0 = 4, r1 = 40, amount = 1 } = {}) {
		if (this.items.length >= CAPACITY) this.items.shift();
		const item = { kind, x, y, age: 0, dur, r0, r1, amount, dead: false, fade: 0 };
		this.items.push(item);
		return item;
	}

	get busy() {
		return this.items.length > 0;
	}

	update(dt) {
		const items = this.items;
		let n = 0;
		for (const it of items) {
			it.age += dt;
			if (it.fade) it.amount -= dt / it.fade;
			if (!it.dead && it.age < it.dur && it.amount > -0.01) items[n++] = it;
		}
		items.length = n;
		const d = this.layer.data;
		for (let i = 0; i < n; i++) {
			const it = items[i];
			const o = i * 8;
			d[o] = it.x; d[o + 1] = it.y; d[o + 2] = it.age % 2048; d[o + 3] = Math.min(it.dur, 1e6);
			d[o + 4] = it.r0; d[o + 5] = it.r1; d[o + 6] = it.kind; d[o + 7] = Math.max(0, it.amount);
		}
		this.layer.commit(n);
	}
}
