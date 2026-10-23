// Behaviour: turns cursor motion and buttons into frost, snow and ice.
import { Crystals, SPINE, STREAK } from './crystals.js';
import { Particles, POWDER, FLAKE, SPARKLE, SHARD, MIST, GLITTER, VORTEX } from './particles.js';
import { Rings } from './rings.js';
import { IceCursor } from './ice-cursor.js';
import { shared } from './gpu.js';

const TAU = Math.PI * 2;
const SIXTY = Math.PI / 3;
const QUEUE = 512;               // move samples buffered between frames
const STREAK_SPEED = 1500;       // px/s above which the path freezes into a streak
const REBASE_AFTER = 1800;       // s; shader times are kept small for float32

const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (a, b, v) => {
	const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

export class Frost {
	constructor(scene, cursor) {
		this.cursor = cursor;
		this.crystals = new Crystals();
		this.particles = new Particles();
		this.rings = new Rings();
		this.ice = new IceCursor();
		scene.add(this.rings.mesh, this.crystals.mesh, this.particles.mesh, this.ice.mesh);

		this.time = 0;
		this.queue = new Float64Array(QUEUE * 3);
		this.qStart = 0;
		this.qLen = 0;
		this.px = cursor.x;
		this.py = cursor.y;
		this.pt = -1;
		this.moved = 0;

		this.fern = { left: 0, total: 0, gap: 0, has: false, x: 0, y: 0, carry: 0 };
		this.snowCarry = 0;
		this.streak = { on: false, x: 0, y: 0, w: 0, carry: 0 };

		this.downAt = -1;
		this.holdR = 0;
		this.holdS = 0;
		this.edgeCarry = 0;
		this.vortexCarry = 0;
		this.idleFlake = 0.4;
		this.breath = 1;

		cursor.on('move', (s) => this._enqueue(s.x, s.y, s.t));
		cursor.on('show', (e) => this._onShow(e));
		cursor.on('hide', () => this._onHide());
		cursor.on('down', (e) => this._onDown(e.button));
		cursor.on('up', (e) => this._onUp(e.button));
		cursor.on('shape', (e) => this._onShape(e.shape));
	}

	update(dt) {
		this.time += dt;
		if (this.time > REBASE_AFTER) {
			this.time -= REBASE_AFTER;
			this.crystals.rebase(REBASE_AFTER);
		}
		const c = this.cursor;
		this.moved = 0;
		this._drainMoves();

		if (c.visible) {
			this._hold(dt);
			this._blizzard(dt);
			this._idle(dt);
		} else if (this.holdS > 0) {
			this.holdS = 0;
			this.rings.endHold();
		}

		const shed = this.ice.update(dt, c, this.moved, this.downAt >= 0);
		if (shed > 0) this._shedRime(shed);

		shared.uTime.value = this.time;
		shared.uCursor.value.set(c.visible ? c.x : -1e4, c.visible ? c.y : -1e4);
		this.particles.update(dt, this.time, c);
		this.rings.update(dt);
		this.crystals.update(this.time);
		// Whether anything is left to draw.
		return this.ice.mesh.visible || this.particles.mesh.visible || this.rings.mesh.visible || this.crystals.mesh.visible;
	}

	// --- path ---------------------------------------------------------------

	_enqueue(x, y, t) {
		if (this.qLen === QUEUE) {
			this.qStart = (this.qStart + 1) % QUEUE;
			this.qLen--;
		}
		const o = ((this.qStart + this.qLen) % QUEUE) * 3;
		this.queue[o] = x;
		this.queue[o + 1] = y;
		this.queue[o + 2] = t;
		this.qLen++;
	}

	_drainMoves() {
		const visible = this.cursor.visible;
		while (this.qLen > 0) {
			const o = this.qStart * 3;
			const x = this.queue[o];
			const y = this.queue[o + 1];
			const t = this.queue[o + 2];
			this.qStart = (this.qStart + 1) % QUEUE;
			this.qLen--;
			const dt = this.pt < 0 ? 1 / 60 : Math.max((t - this.pt) / 1000, 0.008);
			if (visible) this._segment(this.px, this.py, x, y, dt);
			this.px = x;
			this.py = y;
			this.pt = t;
		}
	}

	_segment(ax, ay, bx, by, dt) {
		const dx = bx - ax;
		const dy = by - ay;
		const len = Math.hypot(dx, dy);
		if (len < 0.01) return;
		this.moved += len;
		const ux = dx / len;
		const uy = dy / len;
		const speed = Math.max(len / dt, this.cursor.speed * 0.5);
		this._fernAlong(ax, ay, ux, uy, len, speed);
		this._snowAlong(ax, ay, ux, uy, len, speed);
		this._streakAlong(ax, ay, ux, uy, len, speed);
	}

	// Frost ferns: a spine along the path with 60-degree branches leaning toward
	// the cursor, the way dendrites grow toward their tip.
	_fernAlong(ax, ay, ux, uy, len, speed) {
		const f = this.fern;
		const dragging = this.cursor.down;
		const spacing = (dragging ? 10 : 13) + Math.min(speed, 4500) * 0.0055;
		let d = spacing - f.carry;
		while (d <= len) {
			this._fernNode(ax + ux * d, ay + uy * d, ux, uy, speed, dragging);
			d += spacing;
		}
		f.carry = len - (d - spacing);
	}

	_fernNode(x, y, ux, uy, speed, dragging) {
		const f = this.fern;
		const now = this.time;
		if (f.left <= 0) {
			if (f.gap > 0) {
				f.gap--;
				f.has = false;
				return;
			}
			f.total = f.left = 4 + ((Math.random() * 5) | 0);
			f.has = false;
		}
		const i = f.total - f.left;
		if (--f.left === 0) f.gap = Math.random() < 0.6 ? 1 : 0;

		const env = Math.pow(Math.sin((Math.PI * (i + 0.5)) / f.total), 0.7);
		const fast = smooth(900, 3200, speed);
		const death = now + (dragging ? 1.7 : 1.15) + Math.random() * 0.5;
		if (f.has) {
			const sx = x - f.x;
			const sy = y - f.y;
			const w = (dragging ? 1.9 : 1.4) * (0.6 + 0.4 * env);
			this.crystals.add(f.x, f.y, Math.atan2(sy, sx), Math.hypot(sx, sy), w, w, now, 0.05, death + 0.1, 0.5, SPINE);
		}
		f.x = x;
		f.y = y;
		f.has = true;

		const heading = Math.atan2(uy, ux);
		const L = (7 + Math.random() * 9) * (0.4 + 0.6 * env) * (1 - 0.4 * fast) * (dragging ? 1.35 : 1);
		for (let side = -1; side <= 1; side += 2) {
			if (!dragging && Math.random() < 0.12) continue;
			const a = heading + side * (SIXTY + (Math.random() - 0.5) * 0.16);
			const bl = L * (0.8 + Math.random() * 0.35);
			this.crystals.dendrite(x, y, a, bl, dragging ? 1.7 : 1.4, now + 0.02, death, bl > 9 ? 1 : 0);
		}
		if (Math.random() < 0.1 + 0.25 * fast) this._sparkle(x + rand(-6, 6), y + rand(-6, 6), rand(3, 5.5), 0.08);
	}

	// Powder kicked up by speed, carried by the cursor's wind, then falling.
	_snowAlong(ax, ay, ux, uy, len, speed) {
		const c = this.cursor;
		const density = smooth(200, 2400, speed) * 0.1;
		this.snowCarry += len * density;
		let n = Math.min(this.snowCarry | 0, 12);
		this.snowCarry -= this.snowCarry | 0;
		const p = this.particles;
		while (n-- > 0) {
			const t = Math.random();
			const side = rand(-90, 90);
			const carry = rand(0.12, 0.38);
			const flake = Math.random() < 0.12;
			const i = p.spawn(flake ? FLAKE : POWDER,
				ax + ux * len * t + rand(-3, 3), ay + uy * len * t + rand(-3, 3),
				c.vx * carry - uy * side, c.vy * carry + ux * side - rand(10, 70),
				rand(0.9, 1.9), flake ? rand(3.2, 5) : rand(0.8, 1.9));
			if (i < 0) return;
			p.drag[i] = flake ? 2.8 : 2.2;
			p.grav[i] = flake ? 45 : 80;
			p.spin[i] = rand(-3, 3);
		}
	}

	// Above STREAK_SPEED the path freezes into a sharp streak that shatters
	// into shards and diamond dust a moment later, in the order it was drawn.
	_streakAlong(ax, ay, ux, uy, len, speed) {
		const s = this.streak;
		if (speed < STREAK_SPEED) {
			s.on = false;
			return;
		}
		if (!s.on) {
			s.on = true;
			s.x = ax;
			s.y = ay;
			s.w = 0;
			s.carry = 0;
		}
		const w = 0.9 + 2.6 * smooth(STREAK_SPEED, 4200, speed);
		const spacing = 9;
		let d = spacing - s.carry;
		while (d <= len) {
			this._streakPiece(ax + ux * d, ay + uy * d, w, speed);
			d += spacing;
		}
		s.carry = len - (d - spacing);
	}

	_streakPiece(x, y, w, speed) {
		const s = this.streak;
		const now = this.time;
		const dx = x - s.x;
		const dy = y - s.y;
		const len = Math.hypot(dx, dy);
		const angle = Math.atan2(dy, dx);
		const shatter = now + 0.15 + Math.random() * 0.05;
		this.crystals.add(s.x, s.y, angle, len + 0.6, s.w, w, now, 0.025, shatter, 0.03, STREAK);
		s.x = x;
		s.y = y;
		s.w = w;

		const p = this.particles;
		const delay = shatter - now;
		const mx = x - dx * 0.5;
		const my = y - dy * 0.5;
		const nx = -dy / len;
		const ny = dx / len;
		const kick = rand(30, 170) * (Math.random() < 0.5 ? -1 : 1);
		const along = speed * 0.035;
		let i = p.spawn(SHARD, mx, my, nx * kick + (dx / len) * along, ny * kick + (dy / len) * along - 30,
			rand(0.55, 0.95), len * rand(0.32, 0.55), w * 0.6 + 0.5);
		if (i < 0) return;
		p.age[i] = -delay;
		p.rot[i] = angle;
		p.spin[i] = rand(-14, 14);
		p.grav[i] = 520;
		p.drag[i] = 0.9;
		p.wind[i] = 0.2;

		const dust = Math.random() < 0.55 ? SPARKLE : GLITTER;
		i = p.spawn(dust, mx + rand(-3, 3), my + rand(-3, 3), rand(-50, 50), rand(-60, 30),
			rand(0.6, 1.3), dust === SPARKLE ? rand(3, 6.5) : rand(1.1, 2.1));
		if (i < 0) return;
		p.age[i] = -delay - rand(0, 0.12);
		p.grav[i] = 35;
		p.drag[i] = 1.6;
		p.spin[i] = rand(-16, 16);
	}

	// --- buttons ------------------------------------------------------------

	_onDown(button) {
		const c = this.cursor;
		if (!c.visible) return;
		if (button === 0) {
			this.downAt = this.time;
			this.holdR = 12;
			this._burst(c.x, c.y);
			this.ice.press();
		} else if (button === 2) {
			this._gust(c.x, c.y);
		}
	}

	_onUp(button) {
		const c = this.cursor;
		if (button === 0) {
			const held = this.downAt >= 0 ? this.time - this.downAt : 0;
			this.downAt = -1;
			if (c.visible && held > 0.32 && this.holdS > 0.3) this._crack(c.x, c.y, this.holdR * this.holdS);
		} else if (button === 2) {
			this.particles.releaseVortex();
			if (c.visible) this._puff(c.x, c.y, 4, 1);
		}
	}

	_burst(x, y) {
		const now = this.time;
		this.rings.burst(x, y);
		// The frozen splat left behind: six dendrites in a hexagon.
		const rot = Math.random() * TAU;
		for (let k = 0; k < 6; k++) {
			const a = rot + k * SIXTY;
			this.crystals.dendrite(x + Math.cos(a) * 4, y + Math.sin(a) * 4, a, rand(16, 22), 1.9,
				now + 0.03, now + 1.35 + Math.random() * 0.3, 2, 120);
		}
		const p = this.particles;
		for (let k = 0; k < 11; k++) {
			const a = Math.random() * TAU;
			const sp = rand(150, 420);
			const i = p.spawn(SHARD, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 80, rand(0.45, 0.85), rand(3, 6.5), rand(1.1, 2.1));
			if (i < 0) break;
			p.rot[i] = a;
			p.spin[i] = rand(-16, 16);
			p.grav[i] = 950;
			p.drag[i] = 1.6;
			p.wind[i] = 0.2;
		}
		for (let k = 0; k < 8; k++) {
			const a = Math.random() * TAU;
			const r = rand(10, 34);
			this._sparkle(x + Math.cos(a) * r, y + Math.sin(a) * r, rand(3, 6), rand(0, 0.12));
		}
	}

	_crack(x, y, R) {
		this.rings.endHold();
		this.holdS = 0;
		this.rings.crack(x, y, R);
		const p = this.particles;
		const count = 8 + Math.round(R * 0.22);
		for (let k = 0; k < count; k++) {
			const a = Math.random() * TAU;
			const r = rand(0.3, 1) * R;
			const sp = rand(140, 360);
			const i = p.spawn(SHARD, x + Math.cos(a) * r, y + Math.sin(a) * r, Math.cos(a) * sp, Math.sin(a) * sp - 60,
				rand(0.5, 0.9), rand(3, 7.5), rand(1.2, 2.4));
			if (i < 0) break;
			p.rot[i] = a;
			p.spin[i] = rand(-12, 12);
			p.grav[i] = 800;
			p.drag[i] = 1.4;
			p.wind[i] = 0.2;
		}
		for (let k = 0; k < 10; k++) {
			const a = Math.random() * TAU;
			const r = rand(0.5, 1.2) * R;
			this._sparkle(x + Math.cos(a) * r, y + Math.sin(a) * r, rand(3, 6.5), rand(0.02, 0.18));
		}
	}

	// Frost creeps outward while the button is held still; moving shrinks it
	// and paints frost along the drag instead.
	_hold(dt) {
		const c = this.cursor;
		const held = this.downAt >= 0 ? this.time - this.downAt : 0;
		if (held > 0.16) {
			const still = 1 - smooth(60, 700, c.speed);
			this.holdR += dt * (still * 42 * (1 - this.holdR / 92) - (1 - still) * 50);
			this.holdR = Math.max(10, this.holdR);
			this.holdS = Math.min(1, this.holdS + dt * 5);
			this.edgeCarry += dt * 16 * still * this.holdS;
			const now = this.time;
			while (this.edgeCarry >= 1) {
				this.edgeCarry -= 1;
				const a = Math.random() * TAU;
				const r = this.holdR * 0.88;
				this.crystals.dendrite(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, a + rand(-0.25, 0.25),
					rand(8, 15), 1.3, now, now + rand(1.1, 1.6), 1, 70);
			}
		} else {
			this.holdS = Math.max(0, this.holdS - dt * 7);
		}
		if (this.holdS > 0) this.rings.hold(c.x, c.y, this.holdR, this.holdS, dt);
		else this.rings.endHold();
	}

	// --- right button: blizzard -----------------------------------------------

	_gust(x, y) {
		const p = this.particles;
		for (let k = 0; k < 30; k++) {
			const a = (k / 30) * TAU + rand(-0.1, 0.1);
			const r = rand(10, 34);
			const flake = k % 3 === 0;
			const i = p.spawn(flake ? FLAKE : POWDER, x + Math.cos(a) * r, y + Math.sin(a) * r,
				-Math.sin(a) * 320, Math.cos(a) * 320, rand(1.4, 2.4), flake ? rand(3.5, 6) : rand(0.9, 1.8));
			if (i < 0) break;
			p.mode[i] = VORTEX;
			p.orbit[i] = rand(24, 72);
			p.drag[i] = 1.8;
			p.grav[i] = 70;
			p.spin[i] = rand(-6, 6);
		}
		this._puff(x, y, 5, 0.8);
	}

	_blizzard(dt) {
		const c = this.cursor;
		if (!(c.buttons & 2)) {
			this.vortexCarry = 0;
			return;
		}
		this.vortexCarry += dt * 75;
		const p = this.particles;
		while (this.vortexCarry >= 1) {
			this.vortexCarry -= 1;
			const a = Math.random() * TAU;
			const r = rand(16, 70);
			const flake = Math.random() < 0.3;
			const i = p.spawn(flake ? FLAKE : POWDER, c.x + Math.cos(a) * r, c.y + Math.sin(a) * r,
				-Math.sin(a) * 200, Math.cos(a) * 200, rand(1.3, 2.3), flake ? rand(3.2, 6) : rand(0.8, 1.8));
			if (i < 0) return;
			p.mode[i] = VORTEX;
			p.orbit[i] = rand(18, 80);
			p.drag[i] = 1.8;
			p.grav[i] = 70;
			p.spin[i] = rand(-6, 6);
		}
	}

	// --- idle, shapes, visibility -------------------------------------------

	_idle(dt) {
		const c = this.cursor;
		if (c.idle < 1.3 || c.buttons) {
			this.idleFlake = 0.25;
			this.breath = 0.6;
			return;
		}
		const p = this.particles;
		this.idleFlake -= dt;
		if (this.idleFlake <= 0) {
			this.idleFlake = rand(0.45, 0.9);
			const i = p.spawn(FLAKE, c.x + rand(-85, 85), c.y + rand(-120, -45), rand(-6, 6), rand(16, 28),
				rand(3.2, 4.4), rand(3, 6.2));
			if (i >= 0) {
				p.drag[i] = 0.5;
				p.grav[i] = 4;
				p.spin[i] = rand(-0.8, 0.8);
			}
		}
		this.breath -= dt;
		if (this.breath <= 0) {
			this.breath = 2.8;
			this._puff(c.x + 7, c.y + 12, 3, 0.55);
			this.ice.pulse(1);
		}
	}

	_puff(x, y, n, strength) {
		const p = this.particles;
		for (let k = 0; k < n; k++) {
			const i = p.spawn(MIST, x + rand(-5, 5), y + rand(-5, 5), rand(-10, 22), rand(-4, 16),
				rand(1.4, 2.1), rand(10, 18));
			if (i < 0) return;
			p.alpha[i] = strength * rand(0.6, 1);
			p.drag[i] = 1.2;
			p.grav[i] = 0;
			p.wind[i] = 1.5;
		}
	}

	_sparkle(x, y, size, delay) {
		const p = this.particles;
		const i = p.spawn(SPARKLE, x, y, rand(-12, 12), rand(-20, 8), rand(0.35, 0.7), size);
		if (i < 0) return;
		p.age[i] = -delay;
		p.rot[i] = Math.random() < 0.7 ? 0 : Math.PI / 4;
		p.grav[i] = 10;
		p.drag[i] = 2;
	}

	_shedRime(amount) {
		const c = this.cursor;
		const n = Math.min(6, Math.ceil(amount * 30));
		for (let k = 0; k < n; k++) {
			const x = c.x + rand(0, 14);
			const y = c.y + rand(2, 24);
			if (Math.random() < 0.5) this._sparkle(x, y, rand(2.5, 4.5), 0);
			else {
				const i = this.particles.spawn(POWDER, x, y, -c.vx * 0.05 + rand(-30, 30), rand(-30, 10), rand(0.6, 1.1), rand(0.7, 1.3));
				if (i >= 0) this.particles.grav[i] = 90;
			}
		}
	}

	_onShape(shape) {
		this.ice.setShape(shape);
		const c = this.cursor;
		if (!c.visible) return;
		for (let k = 0; k < 4; k++) {
			const a = Math.random() * TAU;
			this._sparkle(c.x + Math.cos(a) * rand(6, 16), c.y + Math.sin(a) * rand(6, 16), rand(2.5, 4.5), k * 0.04);
		}
	}

	_onShow(e) {
		this.qLen = 0;
		this.px = e.x;
		this.py = e.y;
		this.pt = -1;
		this.fern.has = false;
		this.fern.carry = 0;
		this.streak.on = false;
		this.snowCarry = 0;
	}

	_onHide() {
		this.particles.releaseVortex();
		this.streak.on = false;
		this.fern.has = false;
		this.downAt = -1;
	}
}
