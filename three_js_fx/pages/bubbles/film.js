// Draws the simulation: droplets, fizz and flakes first, then every bubble as
// an instanced sphere impostor, the bubble on the wand last.
//
// Each bubble is one quad whose fragments rebuild a sphere: thin-film colour
// from a swirling, draining film thickness, the summer sky reflected in it, a
// Fresnel rim, two window highlights and a thin dark rim that keeps it
// readable on white pages. Popping bubbles tear open from the top, leaving a
// bright retracting rim and a fast outer ring.
import { InstanceLayer, ORDER, premultipliedMaterial } from './gl.js';
import { OPTICS_GLSL } from './optics.js';
import { BUBBLES, DROPS, popDuration } from './sim.js';

const SPAWN_GROW = 0.16;   // s a fresh bubble takes to reach full size

const BUBBLE_VERTEX = /* glsl */ `
in vec2 position;
in vec4 iA;   // centre xy (page px), quad half extent px, unused
in vec4 iB;   // visible radius, life fraction, pop progress (-1 whole), seed
in vec4 iC;   // mode amplitudes already multiplied by their oscillation, and their axes
in vec4 iD;   // kind, age

out vec2 vLocal;   // px from the centre
flat out vec4 vShape;
flat out vec4 vWob;

void main() {
	vLocal = position * iA.z;
	gl_Position = clipFromPage(iA.xy + vLocal);
	vShape = iB;
	vWob = iC;
}
`;

const BUBBLE_FRAGMENT = /* glsl */ `
in vec2 vLocal;
flat in vec4 vShape;
flat in vec4 vWob;
out vec4 fragColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
	vec2 q = abs(p) - b + r;
	return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// Reflected window: a soft four-pane highlight on the upper left, and a
// small sharp one on the lower right where light leaves the far wall.
float windows(vec2 uv) {
	vec2 c = vec2(-0.40, -0.44);
	vec2 w = uv - c;
	float box = sdRoundBox(w, vec2(0.20, 0.14), 0.07);
	float h = (1.0 - smoothstep(-0.02, 0.05, box)) * mix(0.95, 0.45, clamp((w.y + 0.14) / 0.28, 0.0, 1.0));
	float bars = min(abs(w.x), abs(w.y));
	h *= mix(0.55, 1.0, smoothstep(0.012, 0.03, bars));
	float small = 1.0 - smoothstep(0.045, 0.075, length(uv - vec2(0.50, 0.52)));
	return max(h, small * 0.9);
}

void main() {
	float r = vShape.x;
	float life = vShape.y;
	float q = vShape.z;
	float seed = vShape.w;
	float px = 1.0 / uPr;
	float t = uTime;

	float rho = length(vLocal);
	float th = atan(vLocal.y, vLocal.x);
	float R = r * (1.0 + vWob.x * cos(2.0 * (th - vWob.y)) + vWob.z * cos(3.0 * (th - vWob.w)));
	vec2 uv = vLocal / R;
	float edge = rho - R;                                  // px, negative inside
	float inside = clamp(0.5 - edge / px, 0.0, 1.0);
	float u2 = min(dot(uv, uv), 1.0);
	float cosI = sqrt(1.0 - u2);
	vec3 n = vec3(uv.x, -uv.y, cosI);

	// Film thickness (nm): thick and pastel when young, draining downwards,
	// swirled by the air; the crown thins to gold and black before the pop.
	mat2 spin = rot2(t * (0.25 + 0.5 * seed) * (seed > 0.5 ? -1.0 : 1.0) + seed * 6.0);
	vec2 sw = spin * uv;
	float n1 = fbm3(sw * 2.1 + vec2(seed * 17.0, t * 0.21));
	float n2 = fbm3(uv * 3.2 + vec2(n1 * 2.2, n1 * 1.7) + vec2(t * 0.11, -t * 0.07));
	float nm = mix(820.0, 360.0, life) * (0.45 + 0.7 * (0.5 + 0.5 * uv.y)) * (0.62 + 0.8 * n2);
	float crown = smoothstep(0.62, 1.0, life) * smoothstep(0.35, -0.95, uv.y + (n1 - 0.5) * 0.4);
	nm *= 1.0 - 0.9 * crown;
	vec3 film = thinFilm(nm, cosI);
	// Big bubbles are calmer: softer colour, and clearer in the middle.
	float big = smoothstep(18.0, 80.0, r);
	film = max(mix(vec3(dot(film, vec3(0.3333))), film, mix(1.7, 1.15, big)), vec3(0.0));

	vec3 refl = vec3(0.0, 0.0, -1.0) + 2.0 * cosI * n;
	mat2 tilt = rot2((seed - 0.5) * 0.9);
	vec3 rr = vec3(tilt * refl.xz, refl.y);
	vec3 env = skyEnv(vec3(rr.x, rr.z, rr.y), t);

	float rim = pow(1.0 - cosI, 2.0);
	float wR = mix(mix(0.12, 0.05, big), 1.0, rim);
	vec3 col = env * film * wR * 1.05;
	float alpha = wR * 0.3;

	// Thin dark rim right on the outline so the bubble reads on white pages;
	// on dark pages it vanishes and the bright film band inside it carries.
	float ow = mix(1.15, 0.8, smoothstep(4.0, 20.0, r));
	float o = smoothstep(-ow - px * 0.5, -ow * 0.2, edge) * mix(0.5, 0.65, big);
	col = vec3(0.01, 0.17, 0.28) * o + col * (1.0 - o);
	alpha = o + alpha * (1.0 - o);

	float h = windows(uv) * smoothstep(1.0, 0.9, sqrt(u2));
	h *= mix(0.75, 1.0, smoothstep(2.0, 8.0, r));

	if (q >= 0.0) {
		// Torn film: a hole races out from the tear and the film rolls up
		// into a bright iridescent rim; a thin ring flies off the old outline.
		float ta = -1.5708 + (seed - 0.5) * 1.6;
		vec2 tp = 0.92 * vec2(cos(ta), sin(ta));
		float hr = q * 2.3;
		float dh = length(uv - tp);
		float keep = smoothstep(hr - 0.02, hr + 0.06, dh) * (1.0 - q * 0.6);
		float band = exp(-pow((dh - hr) / (0.06 + 0.05 * q), 2.0)) * step(u2, 0.999) * (1.0 - q);
		vec3 rainbow = max(mix(vec3(0.6), thinFilm(320.0 + 260.0 * sin(th * 2.0 + seed * 9.0), 0.9), 1.6), vec3(0.0));
		float ringR = 1.0 + q * 0.55;
		float ring = exp(-pow((length(uv) - ringR) / (0.025 + 0.03 * q), 2.0)) * (1.0 - q) * (1.0 - q);
		vec3 ringCol = mix(vec3(1.0), max(thinFilm(500.0 + 300.0 * sin(th * 3.0), 0.8), vec3(0.0)), 0.6);
		col *= keep;
		alpha *= keep;
		h *= keep;
		float shell = inside;
		vec3 add = (rainbow * band * 1.1) * shell + ringCol * ring * 0.9;
		float addA = band * 0.75 * shell + ring * 0.7;
		vec4 c = vec4(col * shell + add, alpha * shell + addA);
		c = vec4(vec3(h) * shell + c.rgb * (1.0 - h * shell), h * shell + c.a * (1.0 - h * shell));
		fragColor = clamp(c, vec4(0.0), vec4(1.0));
		return;
	}

	col = vec3(h) + col * (1.0 - h);
	alpha = h + alpha * (1.0 - h);
	fragColor = vec4(col, alpha) * inside;
}
`;

const DROP_VERTEX = /* glsl */ `
in vec2 position;
in vec4 iA;   // centre xy (page px), quad half extent px
in vec4 iB;   // size, kind, life fraction, seed
in vec4 iC;   // flake rotation, flutter
in vec4 iD;   // fall direction xy, stretch along it

out vec2 vLocal;
flat out vec4 vInfo;
flat out vec2 vSpin;

void main() {
	vLocal = position * iA.z;
	// Water stretches a little along its fall.
	vec2 dir = iD.xy;
	vec2 p = dir * dot(vLocal, dir) * iD.z + (vLocal - dir * dot(vLocal, dir));
	gl_Position = clipFromPage(iA.xy + p);
	vInfo = iB;
	vSpin = iC.xy;
}
`;

const DROP_FRAGMENT = /* glsl */ `
in vec2 vLocal;
flat in vec4 vInfo;
flat in vec2 vSpin;
out vec4 fragColor;

void main() {
	float s = vInfo.x;
	float kind = vInfo.y;
	float life = vInfo.z;
	float px = 1.0 / uPr;
	float fade = 1.0 - smoothstep(0.65, 1.0, life);
	if (kind < 0.5) {
		// Water bead: aqua body, dark rim, one bright glint.
		float rr = length(vLocal);
		float cov = clamp(0.5 - (rr - s) / px, 0.0, 1.0);
		vec2 uv = vLocal / s;
		float rim = smoothstep(0.35, 1.0, length(uv));
		vec3 col = mix(vec3(0.55, 0.9, 1.0) * 0.55, vec3(0.02, 0.25, 0.38) * 0.75, rim);
		float a = mix(0.55, 0.8, rim);
		float g = 1.0 - smoothstep(0.15, 0.5, length(uv - vec2(-0.35, -0.4)));
		col = vec3(g) + col * (1.0 - g);
		a = g + a * (1.0 - g);
		fragColor = vec4(col, a) * cov * fade;
		return;
	}
	if (kind < 1.5) {
		// Fizz: a tiny bubble ring with a spark of colour.
		float rr = length(vLocal);
		float ring = clamp(1.0 - abs(rr - s * 0.8) / max(s * 0.35, px * 0.9), 0.0, 1.0);
		float cov = clamp(0.5 - (rr - s) / px, 0.0, 1.0);
		vec3 tint = max(thinFilm(500.0 + 400.0 * vInfo.w, 0.8), vec3(0.0));
		vec3 col = mix(vec3(1.0), tint, 0.35);
		float g = 1.0 - smoothstep(0.1, 0.45, length(vLocal / s - vec2(-0.35, -0.35)));
		float a = max(ring * 0.85, g * 0.9) * cov;
		fragColor = vec4(col * a * 0.95, a) * fade;
		return;
	}
	// Film flake: a fluttering iridescent shard.
	vec2 p = rot2(vSpin.x) * vLocal;
	vec2 q = vec2(p.x, p.y / max(vSpin.y, 0.18));
	float wob = 1.0 + 0.25 * sin(atan(q.y, q.x) * 3.0 + vInfo.w * 9.0);
	float rr = length(q) - s * wob;
	float cov = clamp(0.5 - rr / px, 0.0, 1.0);
	vec3 film = max(mix(vec3(0.5), thinFilm(260.0 + 520.0 * vInfo.w + life * 200.0, vSpin.y), 1.6), vec3(0.0));
	float edge = smoothstep(-1.2, -0.2, rr);
	vec3 col = mix(film * 0.85, vec3(0.03, 0.22, 0.33), edge * 0.6);
	float a = mix(0.55, 0.8, edge);
	fragColor = vec4(col * a, a) * cov * fade;
}
`;

const NAMES = ['iA', 'iB', 'iC', 'iD'];

export class FilmRenderer {
	constructor(scene, sim) {
		this.sim = sim;
		const bubbleMat = premultipliedMaterial({ common: OPTICS_GLSL, vertex: BUBBLE_VERTEX, fragment: BUBBLE_FRAGMENT });
		const dropMat = premultipliedMaterial({ common: OPTICS_GLSL, vertex: DROP_VERTEX, fragment: DROP_FRAGMENT });
		this.bubbleLayer = new InstanceLayer(scene, bubbleMat, ORDER.bubbles, BUBBLES + 1, NAMES);
		this.dropLayer = new InstanceLayer(scene, dropMat, ORDER.drops, DROPS, NAMES);
		this.wand = null;
	}

	// The wand's bubble (fields as a simulated bubble, oscillator parked), or null.
	setWand(w) {
		this.wand = w;
	}

	// Packs whatever is alive into the instance layers; nothing when !show.
	update(show) {
		let n = 0;
		if (show) {
			const out = this.bubbleLayer.data;
			for (const b of this.sim.bubbles) {
				if (b.life <= 0 || b.r < 0.3) continue;
				writeBubble(out, n++, b, b.pop >= 0 ? Math.min(1, Math.max(0, b.pop / popDuration(b.r))) : -1);
			}
		}
		if (this.wand) writeBubble(this.bubbleLayer.data, n++, this.wand, -1);
		this.bubbleLayer.commit(n);

		let m = 0;
		if (show) {
			const out = this.dropLayer.data;
			for (const d of this.sim.drops) {
				if (d.life <= 0) continue;
				const o = m++ * 16;
				out[o] = d.x;
				out[o + 1] = d.y;
				out[o + 2] = d.size * (d.kind > 1.5 ? 1.4 : 1) + 2;
				out[o + 4] = d.size;
				out[o + 5] = d.kind;
				out[o + 6] = d.age / d.life;
				out[o + 7] = d.seed;
				out[o + 8] = d.age * (6 + 8 * d.seed) + d.seed * 6;
				out[o + 9] = Math.abs(Math.cos(d.age * (9 + 6 * d.seed) + d.seed * 4));
				let dx = 1, dy = 0, s = 1;
				if (d.kind < 0.5) {
					const sp = Math.hypot(d.vx, d.vy);
					dx = d.vx / Math.max(sp, 0.001);
					dy = d.vy / Math.max(sp, 0.001);
					s = 1 + Math.min(sp / 900, 0.8);
				}
				out[o + 12] = dx;
				out[o + 13] = dy;
				out[o + 14] = s;
			}
		}
		this.dropLayer.commit(m);
	}
}

function writeBubble(out, i, b, q) {
	let grow = 1;
	if (b.kind < 0.5) {
		const g = Math.min(1, Math.max(0, b.age / SPAWN_GROW));
		grow = 0.35 + 0.65 * (1 - (1 - g) * (1 - g));
	}
	const r = b.r * grow;
	const w2 = b.w2 * Math.cos(b.phase);
	const w3 = b.w3 * Math.cos(b.phase * 1.63 + 1);
	const o = i * 16;
	out[o] = b.x;
	out[o + 1] = b.y;
	out[o + 2] = r * (1.05 + Math.abs(w2) + Math.abs(w3)) * (q >= 0 ? 1.75 : 1) + 3;
	out[o + 4] = r;
	out[o + 5] = Math.min(1, Math.max(0, b.age / b.life));
	out[o + 6] = q;
	out[o + 7] = b.seed;
	out[o + 8] = w2;
	out[o + 9] = b.a2;
	out[o + 10] = w3;
	out[o + 11] = b.a3;
	out[o + 12] = b.kind;
	out[o + 13] = b.age;
}
