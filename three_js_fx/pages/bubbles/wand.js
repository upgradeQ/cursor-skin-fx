// Holding the button blows a bubble: a sunny wand ring appears at the hotspot
// and a bubble inflates out of it, ballooning away from the direction of
// drag, swirling and wobbling. Letting go sets it free into the simulation.
// When the cursor rests, the same machinery blows a little bubble at the tip.
import { SPAWN } from './sim.js';
import { KIND } from './rings.js';

const HOLD_DELAY = 0.16;     // s before a press counts as a hold
const RING_R = 11;           // px radius of the wand ring
const MAX_R = 110;           // px the blown bubble approaches
const GROW = 0.62;           // 1/s inflation rate
const DRAG_GROW = 0.018;     // extra px of radius per px/s of drag, per second
const IDLE_BLOW = 2.2;       // s idle before the tip blows a bubble
const BLOW_EVERY = 4.2;      // s between idle bubbles
const BLOW_TIME = 1.1;       // s a tip bubble takes to grow
const rand = (a, b) => a + Math.random() * (b - a);

export class Wand {
	constructor(sim, accents) {
		this.sim = sim;
		this.accents = accents;
		this.active = false;
		this.mode = 'hold';
		this.r = 0;
		this.age = 0;
		this.seed = 0;
		this.dir = [-0.5, -0.87];
		this.x = 0;
		this.y = 0;
		this.vx = 0;
		this.vy = 0;
		this.jig = 0;          // wobble amplitude, decays
		this.jigPhase = 0;
		this.ring = null;
		this.blownAt = -Infinity;
		this.record = { x: 0, y: 0, vx: 0, vy: 0, r: 0, age: 0, life: 12, seed: 0, kind: 1, w2: 0, a2: 0, w3: 0, a3: 0, phase: 0 };
	}

	get charge() {
		return this.active && this.mode === 'hold' ? Math.min(1, (this.r - RING_R) / 60) : 0;
	}

	// Called every frame. Returns the Bubble record to draw, or null.
	update(dt, cursor, fx) {
		const holding = cursor.visible && cursor.down && cursor.held > HOLD_DELAY;
		if (holding && (!this.active || this.mode !== 'hold')) this._start('hold', cursor);
		if (this.active && this.mode === 'hold' && !holding) this._release(cursor, fx);

		const idleBlow = !this.active && cursor.visible && !cursor.down && cursor.shape === 'default'
			&& cursor.idle > IDLE_BLOW && cursor.idle - this.blownAt > BLOW_EVERY;
		if (idleBlow) {
			this.blownAt = cursor.idle;
			this._start('tip', cursor);
		}
		if (this.active && this.mode === 'tip' && (!cursor.visible || cursor.idle < 0.05)) this.active = false;
		if (!cursor.visible || cursor.idle < 0.05) this.blownAt = -Infinity;
		if (!this.active) return null;

		this.age += dt;
		this.jig *= Math.exp(-dt * 3);
		this.jigPhase += dt * (14 * Math.sqrt(30 / Math.max(this.r, 8)));
		const speed = cursor.speed;
		if (this.mode === 'hold') {
			this.r += (MAX_R - this.r) * (1 - Math.exp(-dt * GROW)) + speed * DRAG_GROW * dt;
			this.r = Math.min(this.r, MAX_R + 10);
			// Balloon away from the drag; at rest it lifts up and to the left, clear of the cursor.
			let tx = -0.5;
			let ty = -0.87;
			if (speed > 30) {
				const k = Math.min(1, speed / 700) * 0.9;
				tx = tx * (1 - k) - (cursor.vx / speed) * k;
				ty = ty * (1 - k) - (cursor.vy / speed) * k;
			}
			const l = Math.hypot(tx, ty) || 1;
			const f = 1 - Math.exp(-dt * 6);
			this.dir[0] += (tx / l - this.dir[0]) * f;
			this.dir[1] += (ty / l - this.dir[1]) * f;
			const dl = Math.hypot(this.dir[0], this.dir[1]) || 1;
			this.dir[0] /= dl;
			this.dir[1] /= dl;
			const reach = Math.sqrt(Math.max(this.r * this.r - RING_R * RING_R * 0.7, 0));
			this.x = cursor.sx + this.dir[0] * reach;
			this.y = cursor.sy + this.dir[1] * reach;
			if (this.ring) {
				this.ring.x = cursor.sx;
				this.ring.y = cursor.sy;
			}
			if (Math.random() < dt * 6 + speed * dt * 0.004) {
				fx.fizzAt(cursor.sx + rand(-RING_R, RING_R), cursor.sy + rand(-RING_R, RING_R), 1);
			}
		} else {
			const k = Math.min(1, this.age / BLOW_TIME);
			this.r = 1.5 + 6.5 * (1 - (1 - k) * (1 - k));
			this.x = cursor.sx - this.r * 0.62;
			this.y = cursor.sy - this.r * 0.62;
			if (k >= 1) {
				this.sim.bubble(this.x, this.y, rand(-8, 8), -22, this.r, rand(4, 6));
				this.active = false;
				return null;
			}
		}
		this.vx = cursor.vx;
		this.vy = cursor.vy;

		// Stretch along the drag plus the decaying jiggle; the shader's
		// oscillator is parked at phase 0 so these amplitudes apply as given.
		const rec = this.record;
		const stretch = this.mode === 'hold' ? Math.min(0.16, speed / 5000) : 0;
		const breath = 0.025 * Math.sin(this.age * 5.3);
		rec.x = this.x; rec.y = this.y; rec.vx = this.vx; rec.vy = this.vy;
		rec.r = this.r;
		rec.age = this.mode === 'hold' ? 3.5 + this.age * 0.6 : 2 + this.age;
		rec.life = 12;
		rec.seed = this.seed;
		rec.w2 = stretch + breath + this.jig * Math.cos(this.jigPhase);
		rec.a2 = Math.atan2(this.dir[1], this.dir[0]);
		rec.w3 = (0.02 * Math.sin(this.age * 7.1) + this.jig * 0.5 * Math.cos(this.jigPhase * 1.6)) / Math.cos(1);
		rec.a3 = this.age * 0.8;
		rec.phase = 0;
		return rec;
	}

	// For the simulation: the wand bubble as an obstacle [x, y, r], or null.
	get obstacle() {
		return this.active && this.mode === 'hold' ? [this.x, this.y, this.r] : null;
	}

	_start(mode, cursor) {
		this.active = true;
		this.mode = mode;
		this.age = 0;
		this.seed = Math.random();
		this.jig = mode === 'hold' ? 0.12 : 0.05;
		this.dir = [-0.5, -0.87];
		this.r = mode === 'hold' ? RING_R + 1 : 1.5;
		if (this.ring) this.ring.dead = true;
		this.ring = mode === 'hold'
			? this.accents.add(KIND.wand, cursor.sx, cursor.sy, { dur: Infinity, r0: RING_R, r1: RING_R, amount: 1 })
			: null;
	}

	// Let go: the bubble floats away and the wand shrinks out with a burst of light.
	_release(cursor, fx) {
		this.active = false;
		const r = this.r;
		const vx = cursor.vx * 0.35 + this.dir[0] * 30;
		const vy = cursor.vy * 0.35 + this.dir[1] * 30 - 20;
		this.sim.bubble(this.x, this.y, vx, vy, r, 6 + r * 0.035, SPAWN.big);
		if (this.ring) {
			this.ring.fade = 0.22;
			this.ring = null;
		}
		if (!cursor.visible) return;
		this.accents.add(KIND.flash, cursor.sx, cursor.sy, { dur: 0.45, r1: 34 + r * 0.35, amount: 1 });
		this.accents.add(KIND.ripple, cursor.sx, cursor.sy, { dur: 0.5, r0: RING_R, r1: RING_R + 30, amount: 0.9 });
		fx.fizzBurst(cursor.sx, cursor.sy, 14, 160);
	}
}
