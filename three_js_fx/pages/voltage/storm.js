// The weather: bolts that re-strike while they live, shock rings, flashes,
// the plasma charge under a held left button and the chain lightning that
// the right button strings between points around the cursor.
import { forkedBolt, jagged, rand } from './bolts.js';

const smooth = (v) => v * v * (3 - 2 * v);

// Bolts with a lifetime. The path is re-cut every `every` seconds, so a bolt
// flickers and jumps like a real discharge instead of hanging still.
export class Arcs {
	constructor() {
		this.items = [];
	}

	spawn(t, ax, ay, bx, by, opts = {}, { life = 0.3, every = 0.05, hue = 0, glow = 0 } = {}) {
		this.items.push({ ax, ay, bx, by, opts, born: t, life, every, next: 0, strands: null, hue, glow });
	}

	update(t, ribbons, glows) {
		this.items = this.items.filter((a) => t - a.born < a.life);
		for (const a of this.items) {
			if (t >= a.next) {
				a.strands = forkedBolt(a.ax, a.ay, a.bx, a.by, a.opts);
				a.next = t + a.every * rand(0.6, 1.4);
				a.blink = Math.random() < 0.18 ? 0.35 : 1;
			}
			const p = (t - a.born) / a.life;
			const k = Math.pow(1 - p, 1.4) * a.blink;
			ribbons.addBolt(a.strands, k, a.hue);
			if (a.glow) glows.add(a.bx, a.by, a.glow, k * 0.9, a.hue, 1);
		}
		return this.items.length > 0;
	}
}

// Expanding rings of ionised air, ragged and re-cut every frame.
export class Rings {
	constructor() {
		this.items = [];
	}

	spawn(t, x, y, r0, r1, { life = 0.35, width = 14 } = {}) {
		this.items.push({ x, y, r0, r1, born: t, life, width });
	}

	update(t, ribbons) {
		this.items = this.items.filter((r) => t - r.born < r.life);
		for (const r of this.items) {
			const p = (t - r.born) / r.life;
			const e = 1 - Math.pow(1 - p, 3);
			const radius = r.r0 + (r.r1 - r.r0) * e;
			const n = Math.max(24, Math.round(radius * 0.6));
			const pts = [];
			const p1 = rand(0, 6.3), p2 = rand(0, 6.3), wob = 2 + radius * 0.05;
			for (let i = 0; i < n; i++) {
				const a = (i / n) * Math.PI * 2;
				const rr = radius + (0.6 * Math.sin(a * 5 + p1) + 0.4 * Math.sin(a * 11 + p2)) * wob + rand(-0.6, 0.6);
				pts.push(r.x + Math.cos(a) * rr, r.y + Math.sin(a) * rr);
			}
			ribbons.add(pts, r.width, 1.4, Math.pow(1 - p, 1.5) * 0.9, { closed: true, hue: 0.35 });
		}
		return this.items.length > 0;
	}
}

export class Flashes {
	constructor() {
		this.items = [];
	}

	spawn(t, x, y, radius, intensity, { life = 0.25, hue = 0, core = 1 } = {}) {
		this.items.push({ x, y, radius, intensity, born: t, life, hue, core });
	}

	update(t, glows) {
		this.items = this.items.filter((f) => t - f.born < f.life);
		for (const f of this.items) {
			const p = (t - f.born) / f.life;
			glows.add(f.x, f.y, f.radius * (0.8 + 0.2 * p), f.intensity * Math.pow(1 - p, 2), f.hue, f.core);
		}
		return this.items.length > 0;
	}
}

// Held left button: a plasma globe builds up around the cursor. Tendrils
// wander, multiply and lengthen with the charge, and at high charge stray
// arcs ground themselves into the page.
export class Plasma {
	constructor() {
		this.charge = 0;
		this.tendrils = Array.from({ length: 14 }, (_, i) => ({
			angle: (i / 14) * Math.PI * 2 + rand(-0.2, 0.2),
			w: rand(-1.5, 1.5),
			len: rand(0.7, 1),
		}));
	}

	update(dt, t, cursor, holding, heldFor, fx) {
		if (holding) this.charge = Math.min(1, Math.max(this.charge, smooth(Math.min(1, heldFor / 1.6))));
		else this.charge = Math.max(0, this.charge - dt / 0.12);
		const c = this.charge;
		if (c <= 0) return false;

		const { ribbons, glows, arcs, sparks } = fx;
		const x = cursor.x, y = cursor.y;
		const radius = 34 + 120 * c;
		const count = Math.round(3 + 11 * c);
		const flicker = 0.8 + 0.2 * Math.random();
		glows.add(x, y, 30 + 60 * c, (0.5 + 0.9 * c) * flicker, 0.35, 1);
		glows.add(x, y, 10 + 8 * c, 1.2, 0.1, 1.5);

		for (let i = 0; i < count; i++) {
			const d = this.tendrils[i];
			// Tendrils lean away from the motion like flames in wind.
			d.w += rand(-6, 6) * dt;
			d.w *= Math.exp(-dt);
			d.angle += d.w * dt;
			const lean = Math.min(1, cursor.speed / 1500) * 0.6;
			const ex = Math.cos(d.angle) - (cursor.vx / (cursor.speed || 1)) * lean;
			const ey = Math.sin(d.angle) - (cursor.vy / (cursor.speed || 1)) * lean;
			const l = Math.hypot(ex, ey) || 1;
			const r = radius * d.len * (0.85 + 0.15 * Math.sin(t * 9 + i));
			const tx = x + (ex / l) * r, ty = y + (ey / l) * r;
			ribbons.add(jagged(x, y, tx, ty, 0.16, 5), 12 + 8 * c, 1.3 + c, (0.55 + 0.6 * c) * flicker, { taper: 0.5, hue: 0.45 });
			glows.add(tx, ty, 10 + 10 * c, 0.6 + 0.4 * c, 0.5, 0.8);
			if (Math.random() < dt * 3 * c) sparks.burst(t, tx, ty, 2, 300, { angle: Math.atan2(ey, ex), spread: 0.6, life: 0.4 });
		}

		if (c > 0.55 && Math.random() < dt * 7 * c) {
			const a = Math.random() * Math.PI * 2;
			const dist = rand(160, 340) * c;
			const gx = x + Math.cos(a) * dist, gy = y + Math.sin(a) * dist;
			arcs.spawn(t, x, y, gx, gy, { rough: 0.22, forks: 2, depth: 1, width: 16, core: 1.8, intensity: 0.9 }, { life: 0.12, every: 0.03, hue: 0.3, glow: 26 });
			sparks.burst(t, gx, gy, 5, 420, { life: 0.45 });
		}
		return true;
	}
}

// Right button: chain lightning strung from the cursor through five nodes
// around it. Nodes left too far behind jump to a new spot.
export class Chain {
	constructor() {
		this.nodes = [];
		this.links = [];
		this.held = false;
		this.next = 0;
		this.fade = 0;
	}

	_place(x, y, i, n) {
		const a = (i / n) * Math.PI * 2 + rand(-0.35, 0.35);
		const d = rand(110, 240);
		const m = 30;
		return {
			x: Math.min(innerWidth - m, Math.max(m, x + Math.cos(a) * d)),
			y: Math.min(innerHeight - m, Math.max(m, y + Math.sin(a) * d)),
			a, pulse: Math.random() * 6,
		};
	}

	press(t, x, y, fx) {
		this.held = true;
		this.nodes = Array.from({ length: 5 }, (_, i) => this._place(x, y, i, 5)).sort((p, q) => p.a - q.a);
		this.next = 0;
		for (const n of this.nodes) fx.flashes.spawn(t, n.x, n.y, 60, 1, { life: 0.3, hue: 0.7 });
	}

	release(t, fx) {
		if (!this.held) return;
		this.held = false;
		for (const n of this.nodes) {
			fx.flashes.spawn(t, n.x, n.y, 90, 1.2, { life: 0.35, hue: 0.7 });
			fx.sparks.burst(t, n.x, n.y, 10, 600, { spread: Math.PI, life: 0.6 });
			fx.rings.spawn(t, n.x, n.y, 6, 60, { life: 0.3, width: 10 });
		}
	}

	update(dt, t, cursor, fx) {
		this.fade = this.held ? 1 : Math.max(0, this.fade - dt / 0.15);
		if (this.fade <= 0) return false;
		const { ribbons, glows } = fx;
		if (this.held) {
			this.nodes.forEach((n, i) => {
				if (Math.hypot(n.x - cursor.x, n.y - cursor.y) > 420) {
					Object.assign(n, this._place(cursor.x, cursor.y, i, this.nodes.length));
					fx.flashes.spawn(t, n.x, n.y, 70, 1, { life: 0.25, hue: 0.7 });
				}
			});
		}
		if (t >= this.next) {
			this.next = t + 1 / 30;
			const path = [{ x: cursor.x, y: cursor.y }, ...this.nodes];
			this.links = [];
			for (let i = 0; i + 1 < path.length; i++) {
				const a = path[i], b = path[i + 1];
				this.links.push(forkedBolt(a.x, a.y, b.x, b.y, { rough: 0.2, forks: 1, depth: 1, width: 18, core: 2, intensity: 1 }));
			}
		}
		const k = this.fade * (0.75 + 0.25 * Math.random());
		for (const strands of this.links) ribbons.addBolt(strands, k, 0.75);
		for (const n of this.nodes) {
			n.pulse += dt * 12;
			glows.add(n.x, n.y, 34 + 6 * Math.sin(n.pulse), k * 1.1, 0.7, 1.2);
			if (this.held && Math.random() < dt * 4) fx.sparks.burst(t, n.x, n.y, 2, 380, { life: 0.4 });
		}
		return true;
	}
}
