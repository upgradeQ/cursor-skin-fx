// The goldfish companion and the school the right button calls. Every fish
// swims like a fish: it only moves forward along its heading, turns at a
// limited rate, beats its tail faster the harder it works, bends its body
// into a turn and banks with it. Behaviours only pick where to go and how
// fast: follow the cursor, idle in lazy circles blowing bubbles, dart away
// from a click, live inside the water globe, kiss a link's fingertip, chase
// its tail round the busy ring, school round the cursor, leap out of a burst.
import { FISH_FLOATS, MAX_FISH } from './fish-render.js';

const GOLD = 0;
const BLUE = 1;
const COMPANION_LENGTH = 56;  // px
const TURN_RATE = 4.6;        // rad/s at agility 1
const ACCEL = 1300;           // px/s²
const DECEL = 1100;           // px/s²
const FADE_S = 0.25;
const IDLE_AFTER = 1.5;       // s still before the fish starts its lazy circles
const STARTLE_S = 0.32;       // s of darting away from a click
const STARTLE_RANGE = 320;    // px; clicks further away go unnoticed
const SCHOOL_SIZE = 11;
const SCHOOL_FOLLOW = 5;      // 1/s, how fast the middle of the school follows the cursor
const JUMP_SPEED = 430;       // px/s up when flipped out of a burst globe
const JUMP_GRAVITY = 1500;    // px/s²
const REST = [-36, 42];       // px from the hotspot the fish hangs about at
const TEXT_REST = [-48, 26];

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));

class Fish {
	constructor() {
		this.active = false;
	}

	spawn(x, y, heading, length, variant) {
		this.active = true;
		this.x = x;
		this.y = y;
		this.heading = heading;
		this.speed = 0;
		this.length = length;
		this.variant = variant;
		this.scale = 1;
		this.angVel = 0;
		this.phase = rand(0, TAU);
		this.fin = rand(0, TAU);
		this.amp = 0.04;
		this.bend = 0;
		this.bank = 0;
		this.lift = 0;
		this.alpha = 0;
		this.dim = 0;
		this.seed = Math.random();
		this.flight = null;
		this.mode = 'swim';
		this.radius = 0;
		this.flee = 0;
		return this;
	}

	get noseX() {
		return this.x + Math.cos(this.heading) * this.length * this.scale * 0.48;
	}

	get noseY() {
		return this.y + Math.sin(this.heading) * this.length * this.scale * 0.48;
	}

	// One step of swimming toward a heading and speed.
	swim(dt, wantAngle, wantSpeed, agility = 1) {
		const da = wrap(wantAngle - this.heading);
		const maxTurn = TURN_RATE * agility * dt;
		const turn = clamp(da * Math.min(1, dt * 9 * agility), -maxTurn, maxTurn);
		this.heading = wrap(this.heading + turn);
		this.angVel = approach(this.angVel, dt > 0 ? turn / dt : 0, 12, dt);
		const rate = wantSpeed > this.speed ? ACCEL * agility : DECEL * agility;
		this.speed += clamp(wantSpeed - this.speed, -rate * dt, rate * dt);
		this.x += Math.cos(this.heading) * this.speed * dt;
		this.y += Math.sin(this.heading) * this.speed * dt;
		this._body(dt, Math.max(0, wantSpeed - this.speed));
	}

	// Tail beat, body bend and bank from how the fish is moving.
	_body(dt, push) {
		const effort = Math.min(1, this.speed / 420 + Math.abs(this.angVel) * 0.07 + push / 700);
		this.phase = (this.phase + dt * TAU * (1.3 + 9.5 * effort)) % (TAU * 64);
		this.fin = (this.fin + dt * (5 + 5 * (1 - effort))) % (TAU * 64);
		this.amp = approach(this.amp, 0.03 + 0.085 * effort, 6, dt);
		// The body takes the curvature of its path.
		const len = this.length * this.scale;
		const bend = clamp((this.angVel / Math.max(this.speed, 50)) * len * 0.5, -1.1, 1.1);
		this.bend = approach(this.bend, bend, 10, dt);
		if (!this.flight) this.bank = approach(wrap(this.bank), clamp(this.angVel * this.speed / 2200, -0.8, 0.8), 6, dt);
	}

	// Seek a point, slowing down on arrival.
	seek(dt, tx, ty, maxSpeed, slow = 100, agility = 1) {
		const dx = tx - this.x;
		const dy = ty - this.y;
		const d = Math.hypot(dx, dy);
		this.swim(dt, d > 4 ? Math.atan2(dy, dx) : this.heading, maxSpeed * Math.min(1, d / slow), agility);
		return d;
	}

	// Swim round (cx, cy) at radius r, clockwise for dir 1, hurrying back
	// first when far off the circle.
	orbit(dt, cx, cy, r, speed, dir = 1, agility = 1.5) {
		const off = Math.hypot(this.x - cx, this.y - cy) - r;
		const a = Math.atan2(this.y - cy, this.x - cx) + dir * (off > r ? 0.2 : 0.75);
		const hurry = Math.max(speed, Math.min(900, off * 3.5));
		return this.seek(dt, cx + Math.cos(a) * r, cy + Math.sin(a) * r, hurry, 20, agility);
	}

	// Ballistic leap toward the viewer with a full roll.
	leap(angle) {
		this.flight = { vx: Math.cos(angle) * 230, vy: Math.sin(angle) * 230, vz: JUMP_SPEED, spin: Math.random() < 0.5 ? -1 : 1 };
		this.heading = angle;
		this.lift = 0.1;
	}

	// Returns true on landing.
	fly(dt) {
		const f = this.flight;
		f.vz -= JUMP_GRAVITY * dt;
		this.lift += f.vz * dt;
		this.x += f.vx * dt;
		this.y += f.vy * dt;
		this.speed = 300;
		this.angVel = 0;
		this.bank += (f.spin * TAU * dt) / (2 * JUMP_SPEED / JUMP_GRAVITY);
		this._body(dt, 400);
		if (this.lift > 0) return false;
		this.lift = 0;
		this.flight = null;
		this.bank = wrap(this.bank);
		return true;
	}

	write(out, o) {
		out[o] = this.x;
		out[o + 1] = this.y;
		out[o + 2] = this.heading;
		out[o + 3] = this.length * this.scale;
		out[o + 4] = this.phase;
		out[o + 5] = this.amp;
		out[o + 6] = this.bend;
		out[o + 7] = this.bank;
		out[o + 8] = this.alpha;
		out[o + 9] = this.variant;
		out[o + 10] = this.lift;
		out[o + 11] = this.seed;
		out[o + 12] = this.fin;
		out[o + 13] = this.dim;
		out[o + 14] = 0;
		out[o + 15] = 0;
	}
}

export class Shoal {
	// fx: { bubble(x, y, r), splash(x, y) } for the effects the fish set off.
	constructor(renderer, fx) {
		this.renderer = renderer;
		this.fx = fx;
		this.companion = new Fish().spawn(innerWidth / 2 + REST[0], innerHeight / 2 + REST[1], 0, COMPANION_LENGTH, GOLD);
		this.school = Array.from({ length: MAX_FISH - 1 }, () => new Fish());
		this.startleUntil = -1;
		this.inOrb = false;
		this.nextBubble = 0;
		this.bubbleQueue = 0;
		this.kissed = false;
		this.schooling = false;
	}

	get visible() {
		return this.companion.alpha > 0 || this.school.some((f) => f.active);
	}

	// Cursor shown again: the fish is simply there, near it.
	appear(x, y) {
		const c = this.companion;
		if (c.alpha > 0.05) return;
		c.x = x + REST[0];
		c.y = y + REST[1];
		c.heading = -0.4;
		c.speed = 0;
		c.flight = null;
		c.lift = 0;
		this.inOrb = false;
	}

	startle(x, y, t) {
		const c = this.companion;
		const dx = c.x - x;
		const dy = c.y - y;
		const d = Math.hypot(dx, dy);
		if (d > STARTLE_RANGE || c.flight || this.inOrb) return;
		c.flee = d > 1 ? Math.atan2(dy, dx) + rand(-0.4, 0.4) : rand(0, TAU);
		this.startleUntil = t + STARTLE_S;
	}

	// The globe burst: the fish inside flips out of it.
	burst(x, y) {
		const c = this.companion;
		if (!this.inOrb || c.flight) return;
		this.inOrb = false;
		c.scale = 1;
		c.leap(rand(-Math.PI * 0.85, -Math.PI * 0.15));
	}

	callSchool(x, y) {
		this.schooling = true;
		this.anchorX = x;
		this.anchorY = y;
		let k = 0;
		for (const f of this.school) {
			if (k >= SCHOOL_SIZE) break;
			if (f.active && f.mode !== 'scatter') continue;
			const gold = k % 4 === 0;
			const a = (k / SCHOOL_SIZE) * TAU + rand(-0.2, 0.2);
			f.spawn(x + Math.cos(a) * 8, y + Math.sin(a) * 8, a, gold ? rand(34, 42) : rand(27, 34), gold ? GOLD : BLUE);
			f.speed = rand(420, 640);
			f.mode = 'school';
			f.radius = rand(50, 100);
			k++;
		}
	}

	scatter(x, y) {
		this.schooling = false;
		for (const f of this.school) {
			if (!f.active || f.mode !== 'school') continue;
			f.mode = 'scatter';
			f.flee = Math.atan2(f.y - y, f.x - x) + rand(-0.35, 0.35);
		}
	}

	update(dt, t, cursor, orb) {
		const c = this.companion;
		c.alpha = cursor.visible ? Math.min(1, c.alpha + dt / FADE_S) : Math.max(0, c.alpha - dt / FADE_S);
		// The school circles a lagging copy of the cursor, so a fast swirl
		// becomes one vortex round its middle instead of a chase.
		this.anchorX = approach(this.anchorX ?? cursor.sx, cursor.sx, SCHOOL_FOLLOW, dt);
		this.anchorY = approach(this.anchorY ?? cursor.sy, cursor.sy, SCHOOL_FOLLOW, dt);
		if (c.alpha > 0) this._companion(dt, t, cursor, orb);
		else this.inOrb = false;
		for (const f of this.school) if (f.active) this._schoolFish(f, dt, cursor);
		this._bubbles(dt, t, cursor);
		return this.upload();
	}

	_companion(dt, t, cursor, orb) {
		const c = this.companion;
		const hx = cursor.sx;
		const hy = cursor.sy;
		c.dim = approach(c.dim, this.inOrb ? 0.3 : 0, 8, dt);
		if (!this.inOrb) c.scale = approach(c.scale, cursor.shape === 'wait' ? 0.8 : 1, 4, dt);
		this.mode = 'follow';

		if (c.flight) {
			if (c.fly(dt)) this.fx.splash(c.x, c.y);
			this.mode = 'flight';
			return;
		}
		if (this.schooling) {
			c.orbit(dt, this.anchorX, this.anchorY, 74, 560, 1, 2.2);
			this.mode = 'school';
			return;
		}
		// A growing globe outranks everything: the fish heads straight for it.
		if (orb.holding) {
			this.startleUntil = -1;
			const r = orb.radius;
			const d = Math.hypot(orb.x - c.x, orb.y - c.y);
			if (!this.inOrb && orb.habitable && d < r * 0.8) this.inOrb = true;
			if (this.inOrb) {
				c.scale = approach(c.scale, clamp((r * 1.15) / c.length, 0.45, 1), 6, dt);
				c.orbit(dt, orb.x, orb.y, r * 0.45, r * 0.45 * 2.6, 1, 2.6);
				this.mode = 'orb';
			} else {
				c.seek(dt, orb.x, orb.y, 980, 40, 2.6);
			}
			return;
		}
		this.inOrb = false;
		if (t < this.startleUntil) {
			c.swim(dt, c.flee, 820, 2.6);
			this.mode = 'startle';
			return;
		}

		const shape = cursor.shape;
		if (shape === 'wait') {
			// Chasing its own tail round the busy ring.
			c.orbit(dt, hx, hy, 23, 125, 1, 2.4);
			this.mode = 'wait';
			return;
		}
		if (shape === 'pointer') {
			this._kiss(dt, t, hx, hy);
			return;
		}
		if (cursor.idle > IDLE_AFTER && shape !== 'text') {
			c.orbit(dt, hx + 6, hy + 34, 50, 72, -1, 1);
			this.mode = 'idle';
			return;
		}
		const rest = shape === 'text' ? TEXT_REST : REST;
		const sp = cursor.speed;
		const k = Math.min(1, sp / 320);
		const bx = sp > 1 ? -cursor.vx / sp : 0;
		const by = sp > 1 ? -cursor.vy / sp : 0;
		const tx = hx + rest[0] * (1 - k) + bx * 62 * k + Math.sin(t * 0.9) * 10;
		const ty = hy + rest[1] * (1 - k) + by * 62 * k + Math.cos(t * 0.7) * 7;
		c.seek(dt, tx, ty, 300 + Math.min(sp, 900) * 0.75, 110);
	}

	// Nose up to a link's fingertip and peck at it.
	_kiss(dt, t, hx, hy) {
		const c = this.companion;
		const peck = Math.pow(Math.max(0, Math.sin(t * 4.2)), 6);
		const reach = c.length * c.scale * 0.48 + 4 + (1 - peck) * 6;
		const tx = hx - reach * 0.96;
		const ty = hy + 7;
		const d = Math.hypot(tx - c.x, ty - c.y);
		if (d > 14) c.seek(dt, tx, ty, 760, 70, 2);
		else c.swim(dt, Math.atan2(hy - c.noseY + 2, hx - c.noseX), Math.min(d * 5, 60), 1.4);
		if (peck > 0.9 && !this.kissed && d < 16) this.fx.bubble(c.noseX, c.noseY, rand(2.2, 3.2));
		this.kissed = peck > 0.9;
		this.mode = 'kiss';
	}

	// Now and then, while idling, a few bubbles from the fish's mouth.
	_bubbles(dt, t, cursor) {
		const c = this.companion;
		if (this.mode !== 'idle' || c.alpha < 0.5) {
			this.bubbleQueue = 0;
			this.nextBubble = Math.max(this.nextBubble, t + 0.6);
			return;
		}
		if (t < this.nextBubble) return;
		if (this.bubbleQueue <= 0) this.bubbleQueue = Math.floor(rand(1, 4));
		this.fx.bubble(c.noseX, c.noseY, rand(3, 5.2));
		this.bubbleQueue--;
		this.nextBubble = t + (this.bubbleQueue > 0 ? rand(0.16, 0.26) : rand(1.3, 2.6));
	}

	_schoolFish(f, dt, cursor) {
		if (f.mode === 'scatter') {
			f.swim(dt, f.flee, 950, 3);
			f.alpha -= dt / 0.75;
			if (f.alpha <= 0) f.active = false;
			return;
		}
		f.alpha = Math.min(cursor.visible ? 1 : 0, f.alpha + dt / 0.12);
		if (!cursor.visible) {
			f.mode = 'scatter';
			return;
		}
		// Boids: hold a ring round the cursor, keep apart, swim along together.
		const cx = this.anchorX;
		const cy = this.anchorY;
		const d = Math.hypot(f.x - cx, f.y - cy);
		const a = Math.atan2(f.y - cy, f.x - cx) + 0.8;
		let dx = cx + Math.cos(a) * f.radius - f.x;
		let dy = cy + Math.sin(a) * f.radius - f.y;
		const dl = Math.hypot(dx, dy) || 1;
		dx /= dl;
		dy /= dl;
		let sx = 0;
		let sy = 0;
		let ax = 0;
		let ay = 0;
		for (const o of this.school) {
			if (o === f || !o.active || o.mode !== 'school') continue;
			const ox = f.x - o.x;
			const oy = f.y - o.y;
			const od = Math.hypot(ox, oy);
			if (od < 26 && od > 0.01) {
				sx += (ox / od) * (26 - od) / 26;
				sy += (oy / od) * (26 - od) / 26;
			}
			if (od < 70) {
				ax += Math.cos(o.heading);
				ay += Math.sin(o.heading);
			}
		}
		const al = Math.hypot(ax, ay) || 1;
		const wx = dx + sx * 1.6 + (ax / al) * 0.25;
		const wy = dy + sy * 1.6 + (ay / al) * 0.25;
		f.swim(dt, Math.atan2(wy, wx), clamp(330 + Math.max(0, d - f.radius) * 3, 330, 1150), 2.3);
	}

	upload() {
		const out = this.renderer.instances;
		let n = 0;
		for (const f of this.school) {
			if (!f.active || f.alpha <= 0) continue;
			f.write(out, n++ * FISH_FLOATS);
		}
		if (this.companion.alpha > 0) this.companion.write(out, n++ * FISH_FLOATS);
		this.renderer.upload(n);
		return n > 0;
	}
}
