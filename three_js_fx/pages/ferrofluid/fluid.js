// Ferrofluid body, simulated in page pixels: a head blob pulled toward the cursor
// magnet on a spring, a strand stretched between head and magnet that snaps when
// pulled too far, and a bounded pool of droplets that shed, orbit and get pulled
// back in.

export const MAX_DROPS = 14;
export const HEAD_RADIUS = 12.5;

export const NONE = 0;
export const FREE = 1;
export const ORBIT = 2;
export const MERGE = 3;

const SUBSTEP = 1 / 240;
const SNAP_LENGTH = 95;
const LEASH = 110;          // the head never trails the magnet by more than this
const REATTACH_LENGTH = 60;
const SHED_SPACING = 30;

// How the fluid arranges itself for each cursor shape, relative to the hotspot:
// head anchor (ax, ay), magnet point (mx, my), head size, bead held by the magnet,
// strand tip radius, strand on/off, I-beam morph, and an optional droplet ring.
const ARROW = { ax: 7, ay: 12, mx: 3.4, my: 7, head: 1, bead: 3.3, tip: 1.9, strand: 1, text: 0, ring: null };
const LOOKS = {
	default: ARROW,
	pointer: { ax: 0, ay: 27, mx: 0, my: 0.6, head: 0.85, bead: 0, tip: 0.85, strand: 1, text: 0, ring: null },
	text: { ax: 0, ay: 0, mx: 0, my: 0, head: 0.9, bead: 0, tip: 1, strand: 0, text: 1, ring: null },
	wait: {
		ax: 0, ay: 0, mx: 0, my: 0, head: 0, bead: 0, tip: 1, strand: 0, text: 0,
		ring: { x: 0, y: 0, radius: 15, count: 7, size: 4.2, spin: 5, core: 0 },
	},
	progress: {
		...ARROW, ax: 21, ay: 24, head: 0, strand: 0,
		ring: { x: 21, y: 24, radius: 9, count: 6, size: 3.1, spin: 6, core: 0 },
	},
	crosshair: { ax: 15, ay: 17, mx: 15, my: 17, head: 0.8, bead: 0, tip: 1, strand: 0, text: 0, ring: null },
};
const REPEL = { x: 3.4, y: 7, radius: 34, count: 8, size: 4.8, spin: 3.2, core: 0.32 };

const spring = (x) => ({ x, v: 0 });

function step(s, target, omega, zeta, h) {
	s.v += (omega * omega * (target - s.x) - 2 * zeta * omega * s.v) * h;
	s.x += s.v * h;
}

const smoothstep = (a, b, x) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

export class Ferrofluid {
	constructor() {
		this.x = 0;
		this.y = 0;
		this.drawX = 0;
		this.drawY = 0;
		this.vx = 0;
		this.vy = 0;
		this.dirX = 1;
		this.dirY = 0;
		this.stretch = 1;
		this.r = spring(0);
		this.wob = spring(0);
		this.spike = spring(0);
		this.press = spring(0);
		this.sharp = 0;
		this.spin = 0;
		this.spinRate = 0;

		this.ax = spring(ARROW.ax);
		this.ay = spring(ARROW.ay);
		this.mx = spring(ARROW.mx);
		this.my = spring(ARROW.my);
		this.bead = spring(0);
		this.tip = spring(ARROW.tip);
		this.text = spring(0);
		this.strand = spring(1);
		this.magX = 0;
		this.magY = 0;
		this.attached = true;

		this.look = ARROW;
		this.ring = null;
		this.ringPhase = 0;
		this.ringOpen = spring(0);
		this.shed = 0;
		this.time = 0;
		this.drops = Array.from({ length: MAX_DROPS }, () => ({
			mode: NONE, x: 0, y: 0, vx: 0, vy: 0, r: 0, rv: 0, rt: 0, age: 0, delay: 0, slot: 0,
		}));
	}

	reset(cx, cy) {
		const look = this.look;
		this.ax.x = look.ax;
		this.ay.x = look.ay;
		this.mx.x = look.mx;
		this.my.x = look.my;
		this.x = this.drawX = cx + look.ax;
		this.y = this.drawY = cy + look.ay;
		this.vx = this.vy = 0;
		this.stretch = 1;
		this.magX = cx + look.mx;
		this.magY = cy + look.my;
		this.attached = true;
		this.ring = null;
		this.ringOpen.x = 0;
		this.shed = 0;
		for (const s of [this.ax, this.ay, this.mx, this.my, this.wob, this.spike, this.press]) s.v = 0;
		this.spike.x = 0;
		this.wob.x = 0;
		this.r.x = HEAD_RADIUS * look.head * 0.6;
		this.r.v = 0;
		this.bead.x = look.bead;
		this.tip.x = look.tip;
		this.text.x = look.text;
		this.strand.x = look.strand;
		for (const d of this.drops) d.mode = NONE;
	}

	setShape(shape) {
		this.look = LOOKS[shape] ?? ARROW;
	}

	onDown(button) {
		if (button === 0) {
			this.spike.v += 7;
			this.wob.v -= 1.8;
		}
	}

	onUp(button) {
		if (button === 0) this.wob.v += 2.6;
	}

	update(dt, cursor) {
		if (dt <= 0) return;
		this.time += dt;
		const look = this.look;
		const live = cursor.visible;
		const repel = live && (cursor.buttons & 2) !== 0;
		const ring = repel ? REPEL : look.ring;
		this.syncRing(ring);

		const pressing = live && cursor.down && !ring;
		const held = pressing ? cursor.held : 0;
		const idle = live ? cursor.idle : 0;
		let freeCount = 0;
		for (const d of this.drops) if (d.mode === FREE) freeCount++;

		let spikeT = pressing ? 0.75 + 0.35 * smoothstep(0, 1.4, held) : 0;
		if (idle > 2.2 && !ring) {
			const beat = (idle - 2.2) % 3.4;
			if (beat < 0.2) spikeT = Math.max(spikeT, 0.24);
		}
		spikeT *= 1 - Math.min(1, this.text.x);
		const breathe = 0.035 * Math.sin(this.time * 2.3) * smoothstep(1, 3, idle);
		let headT = HEAD_RADIUS * (ring ? ring.core : look.head);
		headT *= (1 + 0.3 * this.press.x + breathe) * (1 - Math.min(0.3, 0.025 * freeCount));

		const omega = 27 * (pressing ? 1.4 : 1) * (1 + 0.9 * this.text.x);
		const sharpT = pressing ? smoothstep(0.1, 1.3, held) : 0;
		this.sharp += (sharpT - this.sharp) * (1 - Math.exp(-dt * (pressing ? 4 : 10)));
		const spinT = pressing && held > 0.2 ? 0.8 : 0;
		this.spinRate += (spinT - this.spinRate) * (1 - Math.exp(-dt * 3));
		this.spin += this.spinRate * dt;

		const strandT = look.strand && this.attached && !ring ? 1 : 0;
		const cvx = (cursor.x - cursor.prevX) / dt;
		const cvy = (cursor.y - cursor.prevY) / dt;
		const n = Math.max(1, Math.ceil(dt / SUBSTEP));
		const h = dt / n;
		for (let s = 1; s <= n; s++) {
			const f = s / n;
			const cx = cursor.prevX + (cursor.x - cursor.prevX) * f;
			const cy = cursor.prevY + (cursor.y - cursor.prevY) * f;

			step(this.ax, look.ax, 18, 0.9, h);
			step(this.ay, look.ay, 18, 0.9, h);
			step(this.mx, look.mx, 22, 0.9, h);
			step(this.my, look.my, 22, 0.9, h);
			step(this.bead, ring ? 0 : look.bead, 20, 0.6, h);
			step(this.tip, look.tip, 20, 0.8, h);
			step(this.text, look.text, 15, 0.75, h);
			step(this.strand, strandT, strandT ? 14 : 34, strandT ? 0.7 : 1, h);
			step(this.press, pressing ? 1 : 0, 16, 0.45, h);
			step(this.spike, spikeT, 17, 0.3, h);
			step(this.wob, 0, 24, 0.22, h);
			step(this.r, headT, 16, 0.45, h);
			step(this.ringOpen, ring ? 1 : 0, 14, 0.45, h);
			if (ring) this.ringPhase += ring.spin * h;

			const tx = cx + this.ax.x;
			const ty = cy + this.ay.x;
			this.vx += (omega * omega * (tx - this.x) - 1.1 * omega * this.vx) * h;
			this.vy += (omega * omega * (ty - this.y) - 1.1 * omega * this.vy) * h;
			this.x += this.vx * h;
			this.y += this.vy * h;
			this.leash(tx, ty, cvx, cvy);
			this.magX = cx + this.mx.x;
			this.magY = cy + this.my.x;

			this.stepDrops(h, cx, cy, ring);
		}
		// The text bar is drawn mostly pinned to the caret, keeping only a little of the spring's lag.
		const pin = 0.85 * Math.max(0, Math.min(1, this.text.x));
		this.drawX = this.x + (cursor.x + this.ax.x - this.x) * pin;
		this.drawY = this.y + (cursor.y + this.ay.x - this.y) * pin;
		this.wob.x = Math.max(-0.35, Math.min(0.35, this.wob.x));
		this.r.x = Math.max(0, this.r.x);

		const speed = Math.hypot(this.vx, this.vy);
		const stretchT = 1 + 0.85 * (1 - Math.exp(-speed / 1600));
		this.stretch += (stretchT - this.stretch) * (1 - Math.exp(-dt * 14));
		if (speed > 40) {
			const k = 1 - Math.exp(-dt * 18);
			this.dirX += (this.vx / speed - this.dirX) * k;
			this.dirY += (this.vy / speed - this.dirY) * k;
			const l = Math.hypot(this.dirX, this.dirY) || 1;
			this.dirX /= l;
			this.dirY /= l;
		}

		this.updateStrand(cursor, live && !ring && look.strand > 0);
	}

	// Keeps the head within LEASH of its target, dropping any velocity that would carry it further out.
	leash(tx, ty, cvx, cvy) {
		const lx = this.x - tx;
		const ly = this.y - ty;
		const l = Math.hypot(lx, ly);
		if (l <= LEASH) return;
		const nx = lx / l;
		const ny = ly / l;
		this.x = tx + nx * LEASH;
		this.y = ty + ny * LEASH;
		const out = (this.vx - cvx) * nx + (this.vy - cvy) * ny;
		if (out > 0) {
			this.vx -= out * nx;
			this.vy -= out * ny;
		}
	}

	updateStrand(cursor, active) {
		const dx = this.magX - this.x;
		const dy = this.magY - this.y;
		const len = Math.hypot(dx, dy);
		if (!this.attached) {
			if (len < REATTACH_LENGTH) this.attached = true;
			return;
		}
		if (!active) return;
		if (len > SNAP_LENGTH) {
			// The strand breaks up into a string of beads, which then get pulled back in.
			this.attached = false;
			const r = this.strandRadius(len) * Math.max(0, Math.min(1, this.strand.x));
			const count = Math.max(3, Math.min(6, Math.round(len / 26)));
			for (let i = 0; i < count; i++) {
				const u = (i + 0.6 + (Math.random() - 0.5) * 0.3) / (count + 0.6);
				this.spawn(u, r * (1.1 - u * 0.4) + 1.0, cursor, 0.4, true);
			}
			this.strand.x = 0;
			this.strand.v = 0;
			this.bead.v += 28;
			return;
		}
		const speed = cursor.speed;
		if (len > 46 && speed > 1000) {
			this.shed += Math.hypot(cursor.x - cursor.prevX, cursor.y - cursor.prevY) * smoothstep(1000, 4000, speed);
			while (this.shed > SHED_SPACING) {
				this.shed -= SHED_SPACING;
				const u = 0.25 + Math.random() * 0.55;
				this.spawn(u, 1.5 + Math.random() * 1.6, cursor, 0.45);
			}
		} else {
			this.shed = 0;
		}
	}

	// Radius of the strand where it leaves the head; it thins as it is pulled longer.
	strandRadius(len) {
		return this.r.x * 0.6 * Math.sqrt(Math.min(1, 22 / Math.max(len, 1)));
	}

	// Pinches a droplet off the strand at fraction u from the head toward the magnet.
	spawn(u, radius, cursor, carry, formed = false) {
		const d = this.freeSlot();
		if (!d) return;
		d.mode = FREE;
		d.x = this.x + (this.magX - this.x) * u;
		d.y = this.y + (this.magY - this.y) * u;
		const jitter = (Math.random() - 0.5) * 260;
		const nx = -(this.magY - this.y);
		const ny = this.magX - this.x;
		const nl = Math.hypot(nx, ny) || 1;
		d.vx = (this.vx + (cursor.vx - this.vx) * u) * carry + (nx / nl) * jitter;
		d.vy = (this.vy + (cursor.vy - this.vy) * u) * carry + (ny / nl) * jitter;
		d.r = formed ? radius * 0.85 : 0.6;
		d.rv = 0;
		d.rt = radius;
		d.age = 0;
		d.delay = 0.12 + Math.random() * 0.25;
	}

	freeSlot() {
		for (const d of this.drops) if (d.mode === NONE) return d;
		return null;
	}

	// Hands droplets to the active ring, or releases them back to the head.
	syncRing(ring) {
		if (ring === this.ring) return;
		let j = 0;
		for (const d of this.drops) {
			if (d.mode !== ORBIT) continue;
			d.mode = FREE;
			d.age = 0;
			d.delay = 0.02 * j++;
		}
		this.ring = ring;
		this.ringOpen.x = 0;
		this.ringOpen.v = 0;
		if (!ring) return;
		for (let slot = 0; slot < ring.count; slot++) {
			let d = this.freeSlot();
			if (d) {
				d.x = this.x;
				d.y = this.y;
				d.vx = this.vx;
				d.vy = this.vy;
				d.r = 0.8;
				d.rv = 0;
			} else {
				// Pool is full: recruit a loose droplet where it is.
				d = this.drops.find((o) => o.mode === FREE || o.mode === MERGE);
				if (!d) break;
				d.r = Math.max(d.r, 0.8);
			}
			d.mode = ORBIT;
			d.slot = slot;
		}
	}

	stepDrops(h, cx, cy, ring) {
		const homeHead = this.r.x > 2.5;
		const hx = homeHead ? this.x : ring ? cx + ring.x : this.magX;
		const hy = homeHead ? this.y : ring ? cy + ring.y : this.magY;
		const mergeDist = homeHead ? this.r.x * 0.85 + 1 : 5;
		for (const d of this.drops) {
			if (d.mode === NONE) continue;
			if (d.mode === MERGE) {
				const k = 1 - Math.exp(-18 * h);
				d.x += (hx - d.x) * k;
				d.y += (hy - d.y) * k;
				d.r -= h * 40;
				if (d.r <= 0.2) {
					d.mode = NONE;
					if (homeHead) this.wob.v += 0.25 * d.rt;
				}
				continue;
			}
			if (d.mode === ORBIT) {
				const a = this.ringPhase + (6.2832 * d.slot) / ring.count;
				const rad = ring.radius * this.ringOpen.x;
				const tx = cx + ring.x + Math.cos(a) * rad;
				const ty = cy + ring.y + Math.sin(a) * rad;
				d.vx += (900 * (tx - d.x) - 36 * d.vx) * h;
				d.vy += (900 * (ty - d.y) - 36 * d.vy) * h;
				const wave = 0.5 + 0.5 * Math.cos(a - this.ringPhase * 2.2);
				d.rt = ring.size * (0.7 + 0.45 * wave * wave);
			} else {
				d.age += h;
				const dx = hx - d.x;
				const dy = hy - d.y;
				const dist = Math.hypot(dx, dy) + 1e-3;
				// Drag, plus a viscous capture near home so droplets settle in instead of slingshotting past.
				const damp = Math.exp(-3.2 * h);
				d.vx *= damp;
				d.vy *= damp;
				const capture = (1 - Math.exp(-14 * h)) * smoothstep(90, 15, dist) * Math.min(1, d.age * 2);
				d.vx += (this.vx - d.vx) * capture;
				d.vy += (this.vy - d.vy) * capture;
				if (d.age > d.delay) {
					const ramp = Math.min(1, (d.age - d.delay) * 3);
					const acc = ramp * (2200 + 5.5e5 / (dist + 30));
					d.vx += (dx / dist) * acc * h;
					d.vy += (dy / dist) * acc * h;
				}
				if (dist < mergeDist + d.r * 0.6) d.mode = MERGE;
			}
			d.x += d.vx * h;
			d.y += d.vy * h;
			d.rv += (784 * (d.rt - d.r) - 28 * d.rv) * h;
			d.r = Math.max(0, d.r + d.rv * h);
		}
	}
}
