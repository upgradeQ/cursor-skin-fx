// The soap bubble simulation. Bubbles have buoyancy, drift on a breeze,
// push apart, merge when a small one sinks into a big one, and pop into
// droplets and film flakes. Droplets, fizz and flakes share one ring of
// slots. Requests to spawn are queued during the frame and land after the
// step, so a click's "only if nothing popped" puff knows whether it popped
// anything.
//
// Bubble slots are handed out up front, by when each bubble will have died
// at the latest, so new bubbles never overwrite live ones unless every slot
// is busy.

export const BUBBLES = 640;    // bubble slots
export const DROPS = 2048;     // droplet / fizz / flake slots
export const SPAWNS = 256;     // spawn requests per step

// Spawn request kinds.
export const SPAWN = { bubble: 0, ifNothingPopped: 1, big: 2, water: 3, fizz: 4, flake: 5 };

const GRAVITY = 980;           // px/s^2 for water
const BUOYANCY = 16;           // px/s^2 upwards, an art-directed lift
const SWIRL_RADIUS = 340;      // px reach of the right-button vortex
const ORBIT = 92;              // px radius the vortex gathers bubbles to
const POP_TAIL = 1.4;          // s a pop's droplets can outlive the bubble
const TAU = Math.PI * 2;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, x) => {
	const t = clamp((x - a) / (b - a), 0, 1);
	return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

export function popDuration(r) {
	return 0.085 + r * 0.0016;
}

// Divergence-free breeze: curl of a few drifting sine waves.
function breeze(x, y, t) {
	const a = x * 0.0061 + t * 0.21;
	const b = y * 0.0072 - t * 0.17;
	const c = x * 0.013 - y * 0.011 + t * 0.33;
	const d = x * 0.0023 + y * 0.0031 - t * 0.07;
	return [-Math.sin(a) * Math.sin(b) - 0.45 * Math.cos(c) + 0.6 * Math.cos(d), -Math.cos(a) * Math.cos(b) - 0.5 * Math.cos(c) - 0.45 * Math.cos(d)];
}

// Mode 2 turns towards the newest impulse; mode 3 takes a share of it.
function addWobble(b, amount, angle) {
	if (!(b.w2 > amount * 2)) b.a2 = angle;
	b.w2 = Math.min(b.w2 + amount, 0.13);
	b.w3 = Math.min(b.w3 + amount * 0.4, 0.06);
	b.a3 = angle + 0.7;
}

function newBubble() {
	return { x: 0, y: 0, vx: 0, vy: 0, r: 0, age: 0, life: 0, seed: 0, w2: 0, a2: 0, w3: 0, a3: 0, pop: -1, kind: 0, phase: 0 };
}

export class BubbleSim {
	constructor() {
		this.bubbles = Array.from({ length: BUBBLES }, newBubble);
		this.drops = Array.from({ length: DROPS }, () => ({ x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 0, size: 0, kind: 0, seed: 0 }));
		this.dropHead = 0;
		this.queue = Array.from({ length: SPAWNS }, () => ({ x: 0, y: 0, vx: 0, vy: 0, r: 0, life: 0, slot: 0, kind: 0 }));
		this.count = 0;
		this.ends = new Float32Array(BUBBLES);    // sim time each slot is free again
		this.next = 0;
		this.time = 0;                            // seconds of simulated time
		this.quietAt = 0;                         // sim time when everything is gone
		// Snapshot of the bubbles before a step: x, y, r, alive.
		this.prev = new Float32Array(BUBBLES * 4);
		this.live = new Uint16Array(BUBBLES);
	}

	get busy() {
		return this.time < this.quietAt || this.count > 0;
	}

	get full() {
		return this.count >= SPAWNS;
	}

	// A free bubble slot, or the next one round when all are taken.
	_slot(end) {
		for (let k = 0; k < BUBBLES; k++) {
			const i = (this.next + k) % BUBBLES;
			if (this.ends[i] <= this.time) {
				this.next = (i + 1) % BUBBLES;
				this.ends[i] = end;
				return i;
			}
		}
		const i = this.next;
		this.next = (i + 1) % BUBBLES;
		this.ends[i] = end;
		return i;
	}

	_push(x, y, vx, vy, r, life, slot, kind) {
		if (this.count >= SPAWNS) return false;
		const s = this.queue[this.count++];
		s.x = x; s.y = y; s.vx = vx; s.vy = vy; s.r = r; s.life = life; s.slot = slot; s.kind = kind;
		return true;
	}

	// kind: SPAWN.bubble, SPAWN.ifNothingPopped (only if this step's click popped nothing) or SPAWN.big.
	bubble(x, y, vx, vy, r, life, kind = SPAWN.bubble) {
		if (this.count >= SPAWNS) return false;
		const end = this.time + life + 0.3;
		this.quietAt = Math.max(this.quietAt, end + POP_TAIL);
		return this._push(x, y, vx, vy, r, life, this._slot(end), kind);
	}

	// kind: SPAWN.water, SPAWN.fizz or SPAWN.flake.
	drop(x, y, vx, vy, size, life, kind) {
		this.quietAt = Math.max(this.quietAt, this.time + life);
		return this._push(x, y, vx, vy, size, life, 0, kind);
	}

	_emitDrop(x, y, vx, vy, life, size, kind) {
		const d = this.drops[this.dropHead];
		this.dropHead = (this.dropHead + 1) % DROPS;
		d.x = x; d.y = y; d.vx = vx; d.vy = vy; d.age = 0; d.life = life; d.size = size; d.kind = kind; d.seed = Math.random();
	}

	// The film tears: spray droplets from the rim and shed a few film flakes.
	_burst(b) {
		const n = clamp(Math.floor(b.r * 0.42) + 2, 2, 22);
		for (let k = 0; k < n; k++) {
			const a = ((k + Math.random()) / n) * TAU;
			const cx = Math.cos(a), cy = Math.sin(a);
			const speed = (35 + b.r * 2.4) * (0.45 + Math.random());
			const size = mix(0.7, 1.3 + b.r * 0.018, Math.random());
			this._emitDrop(b.x + cx * b.r * 0.92, b.y + cy * b.r * 0.92, b.vx * 0.4 + cx * speed, b.vy * 0.4 + cy * speed - 50, 0.45 + 0.6 * Math.random(), size, 0);
		}
		const flakes = Math.min(Math.floor(b.r / 11), 5);
		for (let k = 0; k < flakes; k++) {
			const a = Math.random() * TAU;
			const cx = Math.cos(a), cy = Math.sin(a);
			const s = 40 + 60 * Math.random();
			this._emitDrop(b.x + cx * b.r * 0.8, b.y + cy * b.r * 0.8, b.vx * 0.3 + cx * s, b.vy * 0.3 + cy * s, 0.4 + 0.35 * Math.random(), 1.6 + 2.6 * Math.random(), 2);
		}
	}

	// One step. input: { dt, hot: [x, y], body: [x, y], vel: [vx, vy], on,
	// vortex, fling, click: [x, y, r] | null, wand: [x, y, r] | null, width, height }.
	step(input) {
		const { dt, vortex, fling } = input;
		this.time += dt;
		const t = this.time % 2048;
		const all = this.bubbles;

		// Everyone sees the same previous state when pushing apart and merging.
		const prev = this.prev;
		const live = this.live;
		let nLive = 0;
		for (let i = 0; i < BUBBLES; i++) {
			const b = all[i];
			const alive = b.life > 0 && b.pop < 0;
			const o = i * 4;
			prev[o] = b.x; prev[o + 1] = b.y; prev[o + 2] = b.r; prev[o + 3] = alive ? 1 : 0;
			if (alive) live[nLive++] = i;
		}

		let pops = 0;
		for (let i = 0; i < BUBBLES; i++) {
			const b = all[i];
			if (b.life <= 0) continue;
			if (b.pop >= 0) {
				b.pop += dt;
				b.x += b.vx * dt;
				b.y += b.vy * dt;
				if (b.pop > popDuration(b.r)) b.life = 0;
				continue;
			}

			// Soft separation and merging against every other live bubble.
			const bx = prev[i * 4], by = prev[i * 4 + 1], br = prev[i * 4 + 2];
			let px = 0, py = 0, gain = 0, hit = 0, hitAngle = 0, absorbed = false;
			for (let k = 0; k < nLive; k++) {
				const j = live[k];
				if (j === i) continue;
				const qx = prev[j * 4], qy = prev[j * 4 + 1], qr = prev[j * 4 + 2];
				const dx = bx - qx, dy = by - qy;
				const rs = br + qr;
				if (Math.abs(dx) >= rs || Math.abs(dy) >= rs) continue;
				const dist = Math.hypot(dx, dy);
				if (dist >= rs) continue;
				// A small bubble deep inside a big one joins it.
				if (br < qr * 0.5 && dist < qr - br * 0.25) absorbed = true;
				if (qr < br * 0.5 && dist < br - qr * 0.25) {
					gain += qr * qr;
					hit += qr / br;
					hitAngle = Math.atan2(-dy, -dx);
					continue;
				}
				const inv = 1 / Math.max(dist, 0.001);
				const share = (qr * qr) / (br * br + qr * qr);
				const f = (1 - dist / rs) * share * 900;
				px += dx * inv * f;
				py += dy * inv * f;
			}
			if (absorbed) {
				b.life = 0;
				continue;
			}
			if (gain > 0) {
				b.r = Math.sqrt(b.r * b.r + gain);
				addWobble(b, 0.06 + hit * 0.5, hitAngle);
			}

			// Air: buoyancy, drag towards a gentle breeze. Big bubbles carry more momentum.
			const big = smoothstep(14, 60, b.r);
			const [wx, wy] = breeze(b.x, b.y, t + b.seed * 9);
			const amp = mix(22, 14, big);
			const k = 1 - Math.exp(-dt * mix(1.5, 0.55, big));
			b.vx += (wx * amp + 4 - b.vx) * k;
			b.vy += (wy * amp - b.vy) * k;
			b.vy -= BUOYANCY * dt * mix(1, 0.7, big);
			b.vx += px * dt;
			b.vy += py * dt;

			// The cursor shoulders bubbles aside and drags air with it.
			if (input.on) {
				const dx = b.x - input.body[0], dy = b.y - input.body[1];
				const dist = Math.hypot(dx, dy);
				const reach = b.r + 26;
				if (dist < reach) {
					const f = 1 - dist / reach;
					const nx = dx / Math.max(dist, 0.001), ny = dy / Math.max(dist, 0.001);
					b.vx += nx * f * f * 1600 * dt + input.vel[0] * f * 3 * dt;
					b.vy += ny * f * f * 1600 * dt + input.vel[1] * f * 3 * dt;
					addWobble(b, f * dt * 4, Math.atan2(ny, nx));
				}
			}

			// The bubble growing on the wand is solid to the others; small ones join it.
			if (input.wand) {
				const [wx0, wy0, wr] = input.wand;
				const dx = b.x - wx0, dy = b.y - wy0;
				const dist = Math.hypot(dx, dy);
				const reach = wr + b.r;
				if (dist < reach) {
					if (b.r < wr * 0.4 && dist < wr - b.r * 0.3) {
						b.life = 0;
						continue;
					}
					const f = (1 - dist / reach) * 1400 * dt / Math.max(dist, 0.001);
					b.vx += dx * f;
					b.vy += dy * f;
				}
			}

			// Right button: gather into an orbit and spin; let go and everything flies out.
			if (vortex > 0 || fling > 0) {
				const dx = b.x - input.hot[0], dy = b.y - input.hot[1];
				const dist = Math.max(Math.hypot(dx, dy), 0.001);
				const nx = dx / dist, ny = dy / dist;
				const fall = smoothstep(SWIRL_RADIUS, 30, dist);
				const orbit = ORBIT * (0.6 + b.seed * 0.8);
				const swirl = (480 + 240 * b.seed) * fall * vortex;
				const ks = 1 - Math.exp(-dt * 5 * fall * vortex);
				b.vx += (-ny * swirl - b.vx) * ks;
				b.vy += (nx * swirl - b.vy) * ks;
				const pull = (dist - orbit) * 7 * fall * vortex * dt;
				const out = fling * (260 + 900 * fall);
				b.vx += nx * (out - pull);
				b.vy += ny * (out - pull);
				addWobble(b, fling * fall * 0.25 + vortex * fall * dt * 0.8, Math.atan2(ny, nx));
			}

			b.x += b.vx * dt;
			b.y += b.vy * dt;
			b.age += dt;

			// Wobble: damped modes ringing faster on smaller bubbles.
			b.phase = (b.phase + dt * 9 * Math.sqrt(24 / Math.max(b.r, 3))) % 2048;
			b.w2 *= Math.exp(-dt * 2.4);
			b.w3 *= Math.exp(-dt * 3.2);

			let tear = b.age >= b.life;
			if (input.click && Math.hypot(b.x - input.click[0], b.y - input.click[1]) < input.click[2] + b.r * 0.85) {
				tear = true;
				pops++;
			}
			const off = b.y < -b.r * 2 - 30 || b.x < -b.r - 120 || b.x > input.width + b.r + 120 || b.y > input.height + b.r + 120;
			if (off) {
				b.life = 0;
			} else if (tear) {
				b.pop = 0;
				this._burst(b);
			}
		}

		for (const d of this.drops) {
			if (d.life <= 0) continue;
			d.age += dt;
			if (d.kind < 0.5) {
				d.vy += GRAVITY * dt;
				const k = Math.exp(-dt * 0.5);
				d.vx *= k;
				d.vy *= k;
			} else if (d.kind < 1.5) {
				d.vy -= 320 * dt;
				d.vx += Math.sin(d.age * 31 + d.seed * 2048) * 260 * dt;
				const k = Math.exp(-dt * 3);
				d.vx *= k;
				d.vy *= k;
			} else {
				d.vy += 260 * dt;
				d.vx += Math.sin(d.age * 17 + d.seed * 3500) * 420 * dt;
				const k = Math.exp(-dt * 4.5);
				d.vx *= k;
				d.vy *= k;
			}
			d.x += d.vx * dt;
			d.y += d.vy * dt;
			if (d.age >= d.life || d.y > input.height + 30) d.life = 0;
		}

		for (let i = 0; i < this.count; i++) {
			const s = this.queue[i];
			if (s.kind <= SPAWN.big) {
				if (s.kind === SPAWN.ifNothingPopped && pops > 0) continue;
				const seed = Math.random();
				const a = seed * TAU;
				const big = s.kind === SPAWN.big ? 1 : 0;
				const b = all[s.slot];
				b.x = s.x; b.y = s.y; b.vx = s.vx; b.vy = s.vy; b.r = s.r; b.age = 0; b.life = s.life; b.seed = seed;
				b.w2 = 0.07 + 0.05 * big; b.a2 = a; b.w3 = 0.03 + 0.02 * big; b.a3 = a * 1.7;
				b.pop = -1; b.kind = big; b.phase = seed * 30;
			} else {
				this._emitDrop(s.x, s.y, s.vx, s.vy, s.life, s.r, s.kind - SPAWN.water);
			}
		}
		this.count = 0;
	}
}
