// Ambient life: a butterfly that drifts in to perch beside an idle cursor and
// flies off the moment it moves, and leaves circling the busy ring.
import { KIND } from './sprites.js';
import { BUTTERFLY_TINTS, LEAF_GREENS } from './bursts.js';

const ARRIVE_IDLE_S = 2.0;    // idle this long before a butterfly comes
const FLY_IN_S = 1.7;
const LEAVE_S = 1.3;
const PERCH = [25, 3];        // px from the hotspot where it settles, clear of the glass
const SIZE = 9;               // half size px
const FLAP_RATE = 21;         // rad/s in flight

const rand = (a, b) => a + Math.random() * (b - a);

export class IdleButterfly {
	constructor() {
		this.state = 'away';
		this.t = 0;
		this.x = 0;
		this.y = 0;
		this.flap = 0;
		this.tint = BUTTERFLY_TINTS[0];
		this.visits = 0;
	}

	update(dt, t, cursor, sprites, allowed) {
		this.t += dt;
		const px = cursor.sx + PERCH[0];
		const py = cursor.sy + PERCH[1];
		const stay = allowed && cursor.visible && cursor.idle > 0.12;
		let rot = 0;

		if (this.state === 'away') {
			if (!(allowed && cursor.visible && cursor.idle > ARRIVE_IDLE_S)) return false;
			const side = Math.random() < 0.5 ? -1 : 1;
			this.sx = px + side * rand(170, 240);
			this.sy = py - rand(110, 180);
			this.cx = (this.sx + px) / 2 + side * rand(-40, 60);
			this.cy = Math.min(this.sy, py) - rand(40, 90);
			this.x = this.sx;
			this.y = this.sy;
			this.tint = BUTTERFLY_TINTS[this.visits++ % BUTTERFLY_TINTS.length];
			this.state = 'in';
			this.t = 0;
		}

		if (this.state === 'in') {
			if (!stay) this._leave();
			else {
				const f = Math.min(1, this.t / FLY_IN_S);
				const e = 1 - Math.pow(1 - f, 2.2);
				const m = 1 - e;
				const nx = m * m * this.sx + 2 * m * e * this.cx + e * e * px;
				const ny = m * m * this.sy + 2 * m * e * this.cy + e * e * py;
				const wob = (1 - f) * 7;
				rot = Math.max(-0.6, Math.min(0.6, (nx - this.x) / Math.max(dt, 1e-3) / 250));
				this.x = nx + Math.sin(this.t * 9) * wob;
				this.y = ny + Math.cos(this.t * 7) * wob;
				this.flap += dt * FLAP_RATE * (1 - 0.5 * f);
				if (f >= 1) {
					this.state = 'perched';
					this.t = 0;
				}
			}
		}

		if (this.state === 'perched') {
			if (!stay) this._leave();
			else {
				this.x = px;
				this.y = py;
				rot = -0.18;
				// wings opening and closing slowly in the sun
				this.flap = 1.25 * (0.5 - 0.5 * Math.cos(this.t * 2.0)) * (0.6 + 0.4 * Math.sin(this.t * 0.7));
			}
		}

		if (this.state === 'out') {
			const f = this.t / LEAVE_S;
			if (f >= 1) {
				this.state = 'away';
				return false;
			}
			this.vy -= 420 * dt;
			this.x += this.vx * dt + Math.sin(this.t * 10) * 1.2;
			this.y += this.vy * dt;
			this.flap += dt * FLAP_RATE * 1.2;
			rot = Math.max(-0.6, Math.min(0.6, this.vx / 300));
		}

		const fade = this.state === 'out' ? 1 - this.t / LEAVE_S : Math.min(1, this.t / 0.3 + (this.state === 'perched' ? 1 : 0));
		const [r, g, b] = this.tint;
		sprites.put(KIND.butterfly, this.x, this.y, SIZE, SIZE, rot, r, g, b, fade, 0, 0, this.flap, 0.3);
		return true;
	}

	_leave() {
		this.state = 'out';
		this.t = 0;
		this.vx = rand(-1, 1) * 160 + 60;
		this.vy = -rand(60, 120);
	}
}

// Three leaves riding round the busy ring.
export class BusyLeaves {
	constructor() {
		this.k = 0;
	}

	update(dt, t, cursor, sprites, active, opacity) {
		this.k += ((active ? 1 : 0) - this.k) * (1 - Math.exp(-dt * 7));
		if (this.k < 0.01) return false;
		const r0 = 13 + 9 * this.k;
		for (let i = 0; i < 3; i++) {
			const a = t * 2.6 + i * 2.094;
			const r = r0 + 1.5 * Math.sin(t * 3 + i * 2);
			const x = cursor.sx + Math.cos(a) * r;
			const y = cursor.sy + Math.sin(a) * r;
			const [cr, cg, cb] = LEAF_GREENS[i];
			sprites.put(KIND.leaf, x, y, 6, 6, a + Math.PI / 2 + 0.35, cr, cg, cb, this.k * opacity, 0, Math.sin(t * 3.5 + i) * 1.1, 0, i * 0.3);
		}
		return true;
	}
}
