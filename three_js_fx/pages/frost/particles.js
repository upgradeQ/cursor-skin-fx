// Snow, diamond dust, ice shards and mist: a fixed pool simulated on the CPU
// (structure of arrays, swap-remove) and drawn as instanced quads whose shapes
// are generated in the fragment shader.
import { premultipliedMaterial, quadGeometry, instancedAttribute, layerMesh, queueUpload } from './gpu.js';

const POOL = 4096;

export const POWDER = 0;
export const FLAKE = 1;
export const SPARKLE = 2;
export const SHARD = 3;
export const MIST = 4;
export const GLITTER = 5;

export const FREE = 0;
export const VORTEX = 1;

const FIELDS = [
	'x', 'y', 'vx', 'vy', 'age', 'life', 'sx', 'sy', 'rot', 'spin',
	'type', 'seed', 'alpha', 'drag', 'grav', 'mode', 'orbit', 'wind',
];

const vertexShader = /* glsl */ `
in vec2 position;
in vec4 iA;   // x, y, rotation, type
in vec4 iB;   // half length, half width, opacity, seed
uniform vec2 uRes;
out vec2 vP;
flat out vec4 vB;
flat out float vType;
flat out vec2 vRot;

void main() {
	if (iB.z <= 0.003) {
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		return;
	}
	vec2 local = position * (iB.xy + 1.8);
	vec2 cs = vec2(cos(iA.z), sin(iA.z));
	vP = local;
	vB = iB;
	vType = iA.w;
	vRot = cs;
	gl_Position = toClip(iA.xy + vec2(cs.x * local.x - cs.y * local.y, cs.y * local.x + cs.x * local.y), uRes);
}
`;

const fragmentShader = /* glsl */ `
in vec2 vP;
flat in vec4 vB;
flat in float vType;
flat in vec2 vRot;
uniform float uPx;
out vec4 fragColor;

const vec2 LIGHT = vec2(-0.6, -0.8);

float sdRhombus(vec2 p, vec2 b) {
	p = abs(p);
	float h = clamp((b.x * (b.x - 2.0 * p.x) - b.y * (b.y - 2.0 * p.y)) / dot(b, b), -1.0, 1.0);
	float d = length(p - 0.5 * b * vec2(1.0 - h, 1.0 + h));
	return d * sign(p.x * b.y + p.y * b.x - b.x * b.y);
}

// Powder grain, stretched along its velocity into a short streak.
vec4 powder(vec2 p, vec2 h) {
	float r = max(h.y, 0.6);
	float d = length(vec2(max(abs(p.x) - max(h.x - r, 0.0), 0.0), p.y)) - r;
	float a = cover(d, uPx) * min(h.y / 0.6, 1.0);
	float core = clamp(-d / r, 0.0, 1.0);
	vec3 col = mix(C_DEEP, C_WHITE, smoothstep(0.0, 0.7, core));
	return vec4(col * a + C_PALE * a * 0.22, a);
}

// Six-fold stellar dendrite; the seed varies where the side branches sit.
vec4 flake(vec2 p, float R, float seed) {
	vec2 q = fold6(p);
	float w = max(R * 0.075, 0.5);
	float b1 = mix(0.36, 0.52, seed);
	float b2 = mix(0.66, 0.8, fract(seed * 7.31));
	const vec2 BR = vec2(0.5, 0.8660254);
	float d = sdSegment(q, vec2(0.0), vec2(R, 0.0)) - w;
	d = min(d, sdSegment(q, vec2(R * b1, 0.0), vec2(R * b1, 0.0) + BR * R * 0.36) - w * 0.85);
	d = min(d, sdSegment(q, vec2(R * b2, 0.0), vec2(R * b2, 0.0) + BR * R * 0.2) - w * 0.75);
	d = min(d, sdHex(p, R * 0.2));
	float body = cover(d, uPx);
	float rim = cover(d - 1.0, uPx);
	vec4 o = vec4(0.0);
	over(o, C_INK, rim * 0.42);
	over(o, mix(C_ICE, C_WHITE, 0.72), body);
	o.rgb += C_PALE * body * 0.2;
	return o;
}

// Four-point star: hairline arms and a hot core.
vec4 sparkle(vec2 p, float R) {
	float w = max(R * 0.07, 0.42);
	vec2 a = clamp(1.0 - abs(p) / R, 0.0, 1.0);
	float arms = max(a.x * a.x * exp(-p.y * p.y / (w * w)), a.y * a.y * exp(-p.x * p.x / (w * w)));
	float core = exp(-dot(p, p) / (R * R * 0.035 + 0.5));
	float m = clamp(arms + core, 0.0, 1.0);
	vec3 col = mix(C_DEEP, C_WHITE, clamp(core * 1.5 + arms * 0.35, 0.0, 1.0));
	return vec4(col * m + C_PALE * (core * 0.6 + arms * 0.3), m);
}

// Faceted kite: four facets lit by their world-space normals.
vec4 shard(vec2 p, vec2 h, float seed, vec2 cs) {
	vec2 b = vec2(p.x > 0.0 ? h.x : h.x * mix(0.35, 0.75, seed), h.y);
	float d = sdRhombus(p, b);
	float body = cover(d, uPx);
	float rim = cover(d - 1.0, uPx);
	if (rim <= 0.0) return vec4(0.0);
	vec2 n = normalize(vec2(sign(p.x) * b.y, sign(p.y) * b.x));
	vec2 nw = vec2(cs.x * n.x - cs.y * n.y, cs.y * n.x + cs.x * n.y);
	float lit = dot(nw, normalize(LIGHT)) * 0.5 + 0.5;
	vec3 col = mix(C_ICE * 0.8, C_WHITE, lit);
	vec4 o = vec4(0.0);
	over(o, C_INK, rim * 0.55);
	over(o, col, body * 0.95);
	o.rgb += C_PALE * pow(lit, 10.0) * body * 0.6;
	return o;
}

vec4 mist(vec2 p, vec2 h) {
	vec2 q = p / h;
	float a = exp(-dot(q, q) * 2.6) * 0.5;
	return vec4(C_PALE * a, a);
}

// Tumbling hexagonal plate that flashes when it catches the light.
vec4 glitter(vec2 p, float R, vec2 cs) {
	float d = sdHex(p, R);
	float body = cover(d, uPx);
	float rim = cover(d - 0.8, uPx);
	float flash = pow(abs(cs.x * 0.6 - cs.y * 0.8), 8.0);
	vec4 o = vec4(0.0);
	over(o, C_DEEP, rim * 0.7);
	over(o, mix(C_ICE, C_WHITE, flash), body);
	o.rgb += C_PALE * flash * (body + rim * 0.5) * 0.8;
	return o;
}

void main() {
	int type = int(vType + 0.5);
	vec4 o;
	if (type == 0) o = powder(vP, vB.xy);
	else if (type == 1) o = flake(vP, vB.x, vB.w);
	else if (type == 2) o = sparkle(vP, vB.x);
	else if (type == 3) o = shard(vP, vB.xy, vB.w, vRot);
	else if (type == 4) o = mist(vP, vB.xy);
	else o = glitter(vP, vB.x, vRot);
	o *= vB.z;
	if (o.a < 0.002 && max(o.r, max(o.g, o.b)) < 0.002) discard;
	fragColor = o;
}
`;

export class Particles {
	constructor() {
		for (const f of FIELDS) this[f] = new Float32Array(POOL);
		this.columns = FIELDS.map((f) => this[f]);
		this.count = 0;

		const geo = quadGeometry();
		this.a0 = instancedAttribute(geo, 'iA', new Float32Array(POOL * 4), 4);
		this.a1 = instancedAttribute(geo, 'iB', new Float32Array(POOL * 4), 4);
		this.geometry = geo;
		this.mesh = layerMesh(geo, premultipliedMaterial(vertexShader, fragmentShader), 3);
		this.ranges = [{ start: 0, count: 0 }, { start: 0, count: 0 }];
	}

	get free() {
		return POOL - this.count;
	}

	// Returns the new particle's index (to tweak its other fields) or -1 when full.
	spawn(type, x, y, vx, vy, life, sx, sy = sx) {
		if (this.count >= POOL) return -1;
		const i = this.count++;
		this.type[i] = type;
		this.x[i] = x;
		this.y[i] = y;
		this.vx[i] = vx;
		this.vy[i] = vy;
		this.age[i] = 0;
		this.life[i] = life;
		this.sx[i] = sx;
		this.sy[i] = sy;
		this.rot[i] = Math.random() * Math.PI * 2;
		this.spin[i] = 0;
		this.seed[i] = Math.random();
		this.alpha[i] = 1;
		this.drag[i] = 1.5;
		this.grav[i] = 60;
		this.mode[i] = FREE;
		this.orbit[i] = 0;
		this.wind[i] = 1;
		return i;
	}

	_kill(i) {
		const last = --this.count;
		if (i === last) return;
		for (const col of this.columns) col[i] = col[last];
	}

	releaseVortex() {
		for (let i = 0; i < this.count; i++) this.mode[i] = FREE;
	}

	// c: cursor {x, y, vx, vy, visible}. Wind from the cursor carries light
	// particles along; VORTEX particles orbit it until released.
	update(dt, time, c) {
		const { x, y, vx, vy, age, life, rot, spin } = this;
		const windOn = c.visible && c.speed > 30;
		let i = 0;
		while (i < this.count) {
			age[i] += dt;
			if (age[i] >= life[i]) {
				this._kill(i);
				continue;
			}
			if (age[i] < 0) {
				this.a1.array[i * 4 + 2] = 0;
				i++;
				continue;
			}
			const seed = this.seed[i];
			if (this.mode[i] === VORTEX) {
				const dx = x[i] - c.x;
				const dy = y[i] - c.y;
				const r = Math.hypot(dx, dy) + 0.001;
				const nx = dx / r;
				const ny = dy / r;
				const vt = 140 + Math.min(r, 70) * 6.5;
				const vr = (this.orbit[i] - r) * 3.2;
				const k = 1 - Math.exp(-dt * 5.5);
				vx[i] += (-ny * vt + nx * vr + c.vx * 0.85 - vx[i]) * k;
				vy[i] += (nx * vt + ny * vr + c.vy * 0.85 - vy[i]) * k;
			} else {
				let ax = Math.sin(y[i] * 0.019 + time * 1.7 + seed * 20) * 36;
				let ay = this.grav[i] + Math.cos(x[i] * 0.016 - time * 1.3 + seed * 13) * 24;
				if (windOn) {
					const dx = x[i] - c.x;
					const dy = y[i] - c.y;
					const d2 = dx * dx + dy * dy;
					if (d2 < 19600) {
						const f = 1 - d2 / 19600;
						const k = f * f * 5 * this.wind[i];
						ax += (c.vx - vx[i]) * k;
						ay += (c.vy - vy[i]) * k;
					}
				}
				vx[i] += ax * dt;
				vy[i] += ay * dt;
				const damp = Math.exp(-this.drag[i] * dt);
				vx[i] *= damp;
				vy[i] *= damp;
			}
			x[i] += vx[i] * dt;
			y[i] += vy[i] * dt;
			rot[i] += spin[i] * dt;
			this._write(i);
			i++;
		}

		const n = this.count * 4;
		queueUpload(this.a0, this.ranges[0], 0, n);
		queueUpload(this.a1, this.ranges[1], 0, n);
		this.geometry.instanceCount = this.count;
		this.mesh.visible = this.count > 0;
	}

	_write(i) {
		const type = this.type[i];
		const u = this.age[i] / this.life[i];
		let alpha = this.alpha[i];
		let sx = this.sx[i];
		let sy = this.sy[i];
		let rot = this.rot[i];
		if (type === POWDER) {
			alpha *= Math.min(1, this.age[i] * 16) * Math.min(1, (1 - u) * 2.5);
			const v = Math.hypot(this.vx[i], this.vy[i]);
			sx += Math.min(v * 0.014, 14);
			rot = Math.atan2(this.vy[i], this.vx[i]);
		} else if (type === FLAKE) {
			alpha *= Math.min(1, this.age[i] * 6) * Math.min(1, (1 - u) * 3);
		} else if (type === SPARKLE) {
			const k = Math.pow(Math.sin(Math.PI * u), 0.7);
			sx *= k;
			sy *= k;
			alpha *= (0.7 + 0.3 * Math.sin(this.age[i] * 31 + this.seed[i] * 40)) * Math.min(1, k * 3);
		} else if (type === SHARD) {
			alpha *= Math.min(1, (1 - u) * 2.8);
		} else if (type === MIST) {
			const g = 1 + u * 1.3;
			sx *= g;
			sy *= g;
			alpha *= Math.sin(Math.PI * Math.sqrt(u));
		} else {
			alpha *= Math.min(1, this.age[i] * 10) * Math.min(1, (1 - u) * 2.5);
		}
		const o = i * 4;
		const a0 = this.a0.array;
		const a1 = this.a1.array;
		a0[o] = this.x[i];
		a0[o + 1] = this.y[i];
		a0[o + 2] = rot;
		a0[o + 3] = type;
		a1[o] = sx;
		a1[o + 1] = sy;
		a1[o + 2] = alpha;
		a1[o + 3] = this.seed[i];
	}
}
