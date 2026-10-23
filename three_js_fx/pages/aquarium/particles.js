// Water out of the water: droplets flung or splashed up that arc back down
// and leave a splash ring and a dent in the ripples where they land, bubbles
// that rise, wobble and pop, and small star glints. Simulated on the CPU in
// fixed-size arrays and drawn as instanced quads in two layers: on the
// surface (rings, droplet shadows) and above it (droplets, bubbles, glints).
//
// Droplets live in a three-quarter view: (x, y) is the spot on the surface
// below them and z their height, drawn as a lift up the screen.
import { InstanceLayer, ORDER, premultipliedMaterial } from './gl.js';

const CAPACITY = 640;        // live particles
const FLOATS = 12;           // per drawn instance
const NAMES = ['iA', 'iB', 'iC'];
const GRAVITY = 1500;        // px/s², pulls droplets back to the surface
const AIR_DRAG = 0.6;        // 1/s on ground speed while airborne

const DROP = 0;
const RING = 1;
const BUBBLE = 2;
const GLINT = 3;
const SHADOW = 4;            // drawn only, under each airborne droplet

const CROWN = 1;             // aux flag: the drop splashes a crown when it lands

const rand = (a, b) => a + Math.random() * (b - a);

const VERTEX = /* glsl */ `
in vec2 position;
in vec4 iA;   // x, y, size, kind
in vec4 iB;   // dir, stretch, alpha
in vec4 iC;   // age 0..1, seed, z, aux

out vec2 vLocal;      // px, along / across the stretch direction
flat out vec4 vA;
flat out vec4 vB;
flat out vec4 vC;

void main() {
	float pad = 2.0;
	vec2 halfSize = vec2(iA.z * iB.z + pad, iA.z + pad);
	if (iA.w == ${GLINT}.0) halfSize = vec2(iA.z * 1.2 + pad);
	vec2 local = position * halfSize;
	vec2 dir = iB.xy;
	vec2 p = iA.xy + dir * local.x + vec2(-dir.y, dir.x) * local.y;
	gl_Position = clipFromPage(p);
	vLocal = local;
	vA = iA;
	vB = iB;
	vC = iC;
}
`;

const FRAGMENT = /* glsl */ `
in vec2 vLocal;
flat in vec4 vA;
flat in vec4 vB;
flat in vec4 vC;
out vec4 fragColor;

const vec3 DEEP = vec3(0.02, 0.36, 0.50);

// A clear water droplet: a faint body, a dark rim where light bends away,
// light focused on the far side and a crisp highlight.
vec4 droplet(vec2 q, float r, float aa) {
	float l = length(q);
	float cover = clamp(0.5 - (l - r) / aa, 0.0, 1.0);
	vec2 u = q / r;
	float lu = length(u);
	vec4 col = paint(vec3(0.62, 0.92, 1.0), 0.22 + 0.35 * ramp(0.3, 1.0, lu));
	col = over(paint(DEEP, 0.75 * ramp(0.62, 1.0, lu)), col);
	col = over(paint(vec3(0.85, 1.0, 1.0), 0.85 * ramp(0.62, 0.0, length(u - vec2(0.28, 0.36)))), col);
	col = over(paint(vec3(1.0), ramp(0.36, 0.22, length(u - vec2(-0.34, -0.36)))), col);
	return col * cover;
}

// An expanding splash ring: light on the outer lip, teal on the inner one.
vec4 splashRing(vec2 q, float r, float width, float aa) {
	float d = length(q) - r;
	float lip = ramp(width + aa, 0.0, abs(d - width * 0.5));
	float inner = ramp(width * 1.6 + aa, 0.0, abs(d + width * 0.9));
	vec4 col = paint(DEEP, 0.35 * inner);
	col = over(paint(vec3(1.0), 0.85 * lip), col);
	return col;
}

// Soap-film colours, sliding with thickness.
vec3 film(float t) {
	return 0.6 + 0.4 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + t));
}

vec4 bubble(vec2 q, float r, float seed, float age, float aa) {
	float l = length(q);
	float cover = clamp(0.5 - (l - r) / aa, 0.0, 1.0);
	vec2 u = q / r;
	float lu = length(u);
	float rim = ramp(0.55, 1.0, lu);
	vec4 col = paint(vec3(0.9, 0.98, 1.0), 0.06);
	col = over(paint(film(lu * 1.4 + seed + age * 0.8 + u.y * 0.3), 0.55 * rim * rim), col);
	col = over(paint(DEEP, 0.45 * ramp(1.0 - 1.4 * aa / r, 1.0, lu)), col);
	float win = length((rot(u - vec2(-0.36, -0.38), 0.7)) / vec2(0.30, 0.17));
	col = over(paint(vec3(1.0), ramp(1.0, 0.7, win)), col);
	col = over(paint(vec3(1.0), 0.7 * ramp(0.16, 0.08, length(u - vec2(0.42, 0.44)))), col);
	return col * cover;
}

vec4 glint(vec2 q, float size) {
	vec2 a = abs(q) / size;
	float star = max(exp(-a.x * 14.0 - a.y * 1.8), exp(-a.y * 14.0 - a.x * 1.8));
	float core = exp(-dot(a, a) * 18.0);
	return paint(mix(vec3(0.75, 0.97, 1.0), vec3(1.0), core), clamp(star + core, 0.0, 1.0));
}

void main() {
	float aa = 1.0 / uPr;
	float kind = vA.w;
	float size = vA.z;
	float alpha = vB.w;
	vec4 col = vec4(0.0);
	if (kind == ${DROP}.0) {
		col = droplet(vec2(vLocal.x / vB.z, vLocal.y), size, aa);
	} else if (kind == ${RING}.0) {
		col = splashRing(vLocal, vC.z, vC.w, aa);
	} else if (kind == ${BUBBLE}.0) {
		col = bubble(vLocal, size, vC.y, vC.x, aa);
	} else if (kind == ${GLINT}.0) {
		col = underInk(glint(vLocal, size), vec3(0.45, 0.85, 1.0), 0.8);
	} else {
		float l = length(vec2(vLocal.x / vB.z, vLocal.y)) / size;
		col = paint(vec3(0.0, 0.10, 0.16), 0.20 * ramp(1.0, 0.25, l));
	}
	fragColor = col * alpha;
}
`;

export class Particles {
	constructor(scene, water) {
		this.water = water;
		const material = premultipliedMaterial({ vertex: VERTEX, fragment: FRAGMENT });
		// A live particle draws at most once per layer (an airborne droplet's shadow goes on the surface).
		this.surface = new InstanceLayer(scene, material, ORDER.surface, CAPACITY, NAMES);
		this.air = new InstanceLayer(scene, material, ORDER.air, CAPACITY, NAMES);

		const f = () => new Float32Array(CAPACITY);
		this.kind = new Uint8Array(CAPACITY);
		this.aux = new Uint8Array(CAPACITY);
		this.x = f();
		this.y = f();
		this.z = f();
		this.vx = f();
		this.vy = f();
		this.vz = f();
		this.r = f();       // radius; rings: final radius
		this.r0 = f();      // rings: start radius; bubbles: rise speed
		this.w = f();       // rings: line width
		this.age = f();
		this.life = f();
		this.seed = f();
		this.count = 0;
	}

	_spawn(kind) {
		if (this.count >= CAPACITY) return -1;
		const i = this.count++;
		this.kind[i] = kind;
		this.aux[i] = 0;
		this.age[i] = 0;
		this.z[i] = this.vx[i] = this.vy[i] = this.vz[i] = 0;
		this.seed[i] = Math.random();
		return i;
	}

	drop(x, y, z, vx, vy, vz, r) {
		const i = this._spawn(DROP);
		if (i < 0) return -1;
		this.x[i] = x;
		this.y[i] = y;
		this.z[i] = z;
		this.vx[i] = vx;
		this.vy[i] = vy;
		this.vz[i] = vz;
		this.r[i] = r;
		this.life[i] = 4;
		return i;
	}

	ring(x, y, r0, r1, life, width = 2) {
		const i = this._spawn(RING);
		if (i < 0) return;
		this.x[i] = x;
		this.y[i] = y;
		this.r0[i] = r0;
		this.r[i] = r1;
		this.w[i] = width;
		this.life[i] = life;
	}

	bubble(x, y, r, life, rise) {
		const i = this._spawn(BUBBLE);
		if (i < 0) return;
		this.x[i] = x;
		this.y[i] = y;
		this.r[i] = r;
		this.r0[i] = rise;
		this.life[i] = life;
	}

	glint(x, y, size, life) {
		const i = this._spawn(GLINT);
		if (i < 0) return;
		this.x[i] = x;
		this.y[i] = y;
		this.r[i] = size;
		this.life[i] = life;
	}

	// A drop falling onto (x, y) from just above the screen; it lands almost
	// at once and splashes up a crown.
	fall(x, y) {
		const i = this.drop(x, y, 54, 0, 0, -1000, 4.2);
		if (i >= 0) this.aux[i] = CROWN;
	}

	// Crown splash: droplets thrown up in a ring, rings and ripples.
	crown(x, y, strength = 1) {
		const n = Math.round(9 + 5 * strength);
		const turn = Math.random() * Math.PI * 2;
		for (let k = 0; k < n; k++) {
			const a = turn + (k / n) * Math.PI * 2 + rand(-0.15, 0.15);
			const v = rand(70, 170) * strength;
			this.drop(x + Math.cos(a) * 5, y + Math.sin(a) * 5, 2, Math.cos(a) * v, Math.sin(a) * v, rand(260, 440) * Math.sqrt(strength), rand(1.6, 3.1));
		}
		this.drop(x, y, 2, 0, 0, 520 * Math.sqrt(strength), 3.4);
		this.ring(x, y, 3, 48 * strength, 0.6, 2.2);
		this.ring(x, y, 2, 30 * strength, 0.45, 1.4);
		this.glint(x - 3, y - 6, 9 * strength, 0.25);
		this.water.drop(x, y, 14, -1.1 * strength);
	}

	// Droplets flung off a fast-moving cursor, carried by its velocity.
	fling(x, y, vx, vy, n) {
		for (let k = 0; k < n; k++) {
			const keep = rand(0.25, 0.55);
			const side = rand(-160, 160);
			const s = Math.hypot(vx, vy) || 1;
			this.drop(x + rand(-4, 4), y + rand(-4, 4), rand(4, 12),
				vx * keep - (vy / s) * side, vy * keep + (vx / s) * side, rand(140, 360), rand(2.2, 4.4));
		}
	}

	// Popping a water globe: droplets thrown out from its whole rim.
	burst(x, y, radius, strength) {
		const n = Math.round(18 + 26 * strength);
		for (let k = 0; k < n; k++) {
			const a = (k / n) * Math.PI * 2 + rand(-0.12, 0.12);
			const v = rand(140, 380) * (0.6 + 0.6 * strength);
			const c = Math.cos(a);
			const s = Math.sin(a);
			this.drop(x + c * radius * 0.8, y + s * radius * 0.8, radius * 0.4, c * v, s * v, rand(160, 520), rand(2, 4.6));
		}
		this.ring(x, y, radius * 0.9, radius * 0.9 + 70 + 60 * strength, 0.7, 3);
		this.ring(x, y, radius * 0.5, radius + 40, 0.5, 1.8);
		this.ring(x, y, radius, radius * 1.25, 0.14, 4.5);
		for (let k = 0; k < 4; k++) {
			const a = rand(0, Math.PI * 2);
			this.glint(x + Math.cos(a) * radius * 0.7, y + Math.sin(a) * radius * 0.7, rand(8, 15), rand(0.25, 0.4));
		}
		this.water.ring(x, y, radius * 0.7, 9, -0.38 * (0.5 + strength));
		this.water.drop(x, y, radius * 0.4, 0.25);
	}

	_kill(i) {
		const j = --this.count;
		if (i === j) return;
		this.kind[i] = this.kind[j];
		this.aux[i] = this.aux[j];
		this.x[i] = this.x[j];
		this.y[i] = this.y[j];
		this.z[i] = this.z[j];
		this.vx[i] = this.vx[j];
		this.vy[i] = this.vy[j];
		this.vz[i] = this.vz[j];
		this.r[i] = this.r[j];
		this.r0[i] = this.r0[j];
		this.w[i] = this.w[j];
		this.age[i] = this.age[j];
		this.life[i] = this.life[j];
		this.seed[i] = this.seed[j];
	}

	_land(i) {
		const x = this.x[i];
		const y = this.y[i];
		const r = this.r[i];
		if (this.aux[i] === CROWN) {
			this.crown(x, y);
			return;
		}
		this.ring(x, y, r * 0.6, r * 2.6 + 5, 0.3, r > 3 ? 1.4 : 1.1);
		this.water.drop(x, y, 6 + r, -0.2 - r * 0.08);
	}

	update(dt) {
		const drag = Math.exp(-AIR_DRAG * dt);
		for (let i = this.count - 1; i >= 0; i--) {
			this.age[i] += dt;
			const kind = this.kind[i];
			if (kind === DROP) {
				this.vz[i] -= GRAVITY * dt;
				this.vx[i] *= drag;
				this.vy[i] *= drag;
				this.x[i] += this.vx[i] * dt;
				this.y[i] += this.vy[i] * dt;
				this.z[i] += this.vz[i] * dt;
				if (this.z[i] <= 0 && this.vz[i] < 0) {
					this._land(i);
					this._kill(i);
					continue;
				}
			} else if (kind === BUBBLE) {
				const a = this.age[i];
				this.y[i] -= this.r0[i] * dt;
				this.x[i] += Math.sin(a * 5.5 + this.seed[i] * 6.3) * 14 * dt;
			}
			if (this.age[i] >= this.life[i]) {
				if (kind === BUBBLE) {
					this.ring(this.x[i], this.y[i], this.r[i] * 0.8, this.r[i] * 2.6, 0.2, 1.1);
					this.water.drop(this.x[i], this.y[i], 6, -0.15);
				}
				this._kill(i);
			}
		}
		return this.count > 0;
	}

	// Fills the instance layers: the surface one, then the air one.
	upload() {
		let out = this.surface.data;
		let n = 0;
		const put = (x, y, size, kind, dx, dy, stretch, alpha, t, seed, z, aux) => {
			const o = n++ * FLOATS;
			out[o] = x;
			out[o + 1] = y;
			out[o + 2] = size;
			out[o + 3] = kind;
			out[o + 4] = dx;
			out[o + 5] = dy;
			out[o + 6] = stretch;
			out[o + 7] = alpha;
			out[o + 8] = t;
			out[o + 9] = seed;
			out[o + 10] = z;
			out[o + 11] = aux;
		};
		for (let i = 0; i < this.count; i++) {
			const kind = this.kind[i];
			const t = Math.min(1, this.age[i] / this.life[i]);
			if (kind === RING) {
				const grow = 1 - Math.pow(1 - t, 2.6);
				const r = this.r0[i] + (this.r[i] - this.r0[i]) * grow;
				put(this.x[i], this.y[i], r + this.w[i] * 2.5, RING, 1, 0, 1, Math.pow(1 - t, 1.4), t, this.seed[i], r, this.w[i] * (1 - 0.5 * t));
			} else if (kind === DROP && this.z[i] > 0.5) {
				const lift = Math.min(1, this.z[i] / 160);
				put(this.x[i], this.y[i], this.r[i] * (1.5 + lift), SHADOW, 1, 0, 1.4, 1 - lift * 0.7, t, 0, this.z[i], 0);
			}
		}
		this.surface.commit(n);
		out = this.air.data;
		n = 0;
		for (let i = 0; i < this.count; i++) {
			const kind = this.kind[i];
			const t = Math.min(1, this.age[i] / this.life[i]);
			if (kind === DROP) {
				// Stretched along its screen motion (ground motion plus lift).
				const sx = this.vx[i];
				const sy = this.vy[i] - this.vz[i];
				const s = Math.hypot(sx, sy);
				const stretch = 1 + Math.min(1.1, s / 900);
				const scale = 1 + this.z[i] / 500;
				put(this.x[i], this.y[i] - this.z[i], this.r[i] * scale, DROP, s > 1 ? sx / s : 1, s > 1 ? sy / s : 0, stretch, 1, t, this.seed[i], this.z[i], 0);
			} else if (kind === BUBBLE) {
				const pop = Math.min(1, (this.life[i] - this.age[i]) / 0.08);
				const grow = 0.6 + 0.4 * Math.min(1, this.age[i] / 0.3);
				put(this.x[i], this.y[i], this.r[i] * grow * (1 + 0.15 * t), BUBBLE, 1, 0, 1, pop, t, this.seed[i], 0, 0);
			} else if (kind === GLINT) {
				const k = Math.sin(Math.PI * t);
				put(this.x[i], this.y[i], this.r[i] * (0.5 + 0.5 * k), GLINT, 1, 0, 1, k, t, this.seed[i], 0, 0);
			}
		}
		this.air.commit(n);
	}
}
