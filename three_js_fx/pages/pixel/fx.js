// Game-feel effects on the low-resolution layer: dash trails, click
// explosions, charge shots, fireworks, coins and score popups. Everything
// lives in fixed pools and is pushed into the batches again every frame.
import { art, GLYPH_W, GLYPH_H } from './art.js';
import { KIND, FLAT, turn } from './batch.js';
import {
	INK, NIGHT, BERRY, PINK, ORANGE, GOLD, LEMON, LIME, GREEN, CYAN, WHITE,
	PAIRS, RAINBOW, rampAt, R_FIRE, R_COOL, R_COMET, R_MAGIC, R_SMOKE, R_GOLD, R_LIME, R_ICE,
} from './palette.js';

const SPARK = 1;
const STAR = 2;
const DEBRIS = 3;
const CONFETTI = 4;
const SMOKE = 5;
const RING = 6;
const FLASH = 7;
const GHOST = 8;
const COIN = 9;
const STREAK = 10;
const SPEEDLINE = 11;

const E_STAR = [art.get('star0'), art.get('star1'), art.get('star2')];
const E_DEBRIS = [art.get('debris0'), art.get('debris1'), art.get('debris2'), art.get('debris3')];
const E_CONFETTI = [art.get('confetti0'), art.get('confetti1'), art.get('confetti2'), art.get('confetti3')];
const E_MINICOIN = [art.get('minicoin0'), art.get('minicoin1'), art.get('minicoin2'), art.get('minicoin3')];

const SPARK_RAMPS = [R_FIRE, R_COOL, R_MAGIC, R_LIME, R_GOLD];
const GHOST_COLOURS = [[PINK, BERRY], [LEMON, ORANGE], [LIME, GREEN]];

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[(Math.random() * list.length) | 0];
const fadeAfter = (t, start) => (t < start ? 1 : 1 - (t - start) / (1 - start));
const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);

class Pool {
	constructor(capacity) {
		this.capacity = capacity;
		this.n = 0;
		this.type = new Uint8Array(capacity);
		this.fields = [];
		const f = () => {
			const a = new Float32Array(capacity);
			this.fields.push(a);
			return a;
		};
		this.x = f();
		this.y = f();
		this.vx = f();
		this.vy = f();
		this.age = f();
		this.life = f();
		this.a = f();
		this.b = f();
		this.c = f();
		this.d = f();
		this.rel = new Uint8Array(capacity);  // 1: position is relative to the cursor
	}

	spawn(type, x, y, vx, vy, life) {
		if (this.n >= this.capacity) return -1;
		const i = this.n++;
		this.type[i] = type;
		this.rel[i] = 0;
		this.x[i] = x;
		this.y[i] = y;
		this.vx[i] = vx;
		this.vy[i] = vy;
		this.age[i] = 0;
		this.life[i] = life;
		this.a[i] = this.b[i] = this.c[i] = this.d[i] = 0;
		return i;
	}

	kill(i) {
		const j = --this.n;
		if (i === j) return;
		this.type[i] = this.type[j];
		this.rel[i] = this.rel[j];
		for (const a of this.fields) a[i] = a[j];
	}
}

// Score popups in the bitmap font.
const POPUPS = 16;
const POPUP_CHARS = 12;
const GLYPHS = new Array(128).fill(null);
for (let c = 32; c < 128; c++) GLYPHS[c] = art.glyph(String.fromCharCode(c)) || null;

class Popups {
	constructor() {
		this.n = 0;
		this.x = new Float32Array(POPUPS);
		this.y = new Float32Array(POPUPS);
		this.age = new Float32Array(POPUPS);
		this.delay = new Float32Array(POPUPS);
		this.colA = new Uint8Array(POPUPS);
		this.colB = new Uint8Array(POPUPS);
		this.wave = new Uint8Array(POPUPS);
		this.len = new Uint8Array(POPUPS);
		this.chars = new Uint8Array(POPUPS * POPUP_CHARS);
	}

	// Returns the slot; the oldest popup is recycled when full.
	add(x, y, colA, colB, wave = 0, delay = 0) {
		let i = this.n;
		if (i >= POPUPS) {
			i = 0;
			for (let k = 1; k < POPUPS; k++) if (this.age[k] > this.age[i]) i = k;
		} else {
			this.n++;
		}
		this.x[i] = x;
		this.y[i] = y;
		this.age[i] = -delay;
		this.colA[i] = colA;
		this.colB[i] = colB;
		this.wave[i] = wave;
		this.len[i] = 0;
		return i;
	}

	text(i, s) {
		for (let k = 0; k < s.length; k++) this.char(i, s.charCodeAt(k));
		return this;
	}

	number(i, v) {
		let div = 1;
		while (div * 10 <= v) div *= 10;
		for (; div >= 1; div = Math.floor(div / 10)) this.char(i, 48 + (Math.floor(v / div) % 10));
		return this;
	}

	char(i, code) {
		const n = this.len[i];
		if (n >= POPUP_CHARS) return;
		this.chars[i * POPUP_CHARS + n] = code;
		this.len[i] = n + 1;
	}

	kill(i) {
		const j = --this.n;
		if (i === j) return;
		this.x[i] = this.x[j];
		this.y[i] = this.y[j];
		this.age[i] = this.age[j];
		this.colA[i] = this.colA[j];
		this.colB[i] = this.colB[j];
		this.wave[i] = this.wave[j];
		this.len[i] = this.len[j];
		this.chars.copyWithin(i * POPUP_CHARS, j * POPUP_CHARS, (j + 1) * POPUP_CHARS);
	}
}

const POPUP_LIFE = 0.8;

// Comet trail samples, a ring buffer in virtual pixels.
const TRAIL = 512;
const TRAIL_LIFE = 0.16;

// Charge ring geometry.
const RING_STEPS = 72;
const RING_R = 11;
const RING_COS = new Float32Array(RING_STEPS);
const RING_SIN = new Float32Array(RING_STEPS);
for (let i = 0; i < RING_STEPS; i++) {
	const a = -Math.PI / 2 + (i / RING_STEPS) * Math.PI * 2;
	RING_COS[i] = Math.cos(a);
	RING_SIN[i] = Math.sin(a);
}
const CHARGE_DELAY = 0.18;
const CHARGE_TIME = 0.75;

const DASH_ON = 1500;   // px/s
const DASH_OFF = 1000;
const COMBO_WINDOW = 0.75;

export class Arcade {
	constructor(layer, view) {
		this.layer = layer;
		this.view = view;
		this.p = new Pool(1024);
		this.popups = new Popups();
		this.trailX = new Float32Array(TRAIL);
		this.trailY = new Float32Array(TRAIL);
		this.trailT = new Float32Array(TRAIL);
		this.trailS = new Float32Array(TRAIL);
		this.trailHead = 0;
		this.trailCount = 0;

		this.time = 0;         // effect clock, stops during hit-stop
		this.clock = 0;        // real clock
		this.hitStop = 0;
		this.shake = 0;
		this.shakeTick = 0;
		this.lastX = NaN;      // virtual pixels, previous frame's anchor
		this.lastY = NaN;
		this.dash = false;
		this.ghostT = 0;
		this.speedLineT = 0;
		this.travelStar = 0;
		this.travelCoin = 0;
		this.travelConfetti = 0;
		this.idleSparkT = 0;
		this.charge = 0;
		this.charged = false;
		this.combo = 0;
		this.lastClick = -10;
	}

	reset() {
		this.p.n = 0;
		this.popups.n = 0;
		this.trailCount = 0;
		this.lastX = NaN;
	}

	// ---- events ---------------------------------------------------------

	anchor(cursor) {
		const s = this.layer.scale;
		return [cursor.x / s, cursor.y / s];
	}

	body(x, y) {
		const b = this.view.look.body;
		return [x + b[0], y + b[1]];
	}

	down(button, cursor) {
		const [ax, ay] = this.anchor(cursor);
		if (button === 0) this.click(ax, ay);
		else if (button === 2) this.fireworks(...this.body(ax, ay));
	}

	up(button, cursor) {
		if (button !== 0) return;
		const [ax, ay] = this.anchor(cursor);
		const power = this.charge >= 0.3 && cursor.visible ? this.charge : 0;
		this.view.release(power);
		if (power > 0) this.powerShot(ax, ay, power);
		this.charge = 0;
		this.charged = false;
	}

	show(cursor) {
		const [ax, ay] = this.anchor(cursor);
		this.lastX = ax;
		this.lastY = ay;
		this.dash = false;
	}

	hide() {
		this.dash = false;
		this.charge = 0;
		this.charged = false;
	}

	click(x, y) {
		const combo = this.clock - this.lastClick < COMBO_WINDOW ? this.combo + 1 : 1;
		this.combo = combo;
		this.lastClick = this.clock;
		const heat = Math.min(combo, 5);

		this.hitStop = Math.max(this.hitStop, 0.035);
		this.shake = Math.max(this.shake, 1.2 + heat * 0.45);
		this.flash(x, y, 9 + heat);
		this.ring(x, y, 9 + heat * 2, 3, R_FIRE, 0.24, 0);
		this.ring(x, y, 15 + heat * 3, 1, R_COOL, 0.28, 0.05);

		const p = this.p;
		const debris = 6 + heat * 2;
		for (let k = 0; k < debris; k++) {
			const a = -Math.PI * (0.1 + 0.8 * Math.random());
			const v = rnd(50, 120);
			const i = p.spawn(DEBRIS, x, y - 1, Math.cos(a) * v * 1.2, Math.sin(a) * v - 30, rnd(0.7, 1.0));
			if (i < 0) break;
			p.a[i] = (Math.random() * PAIRS.length) | 0;
			p.b[i] = (Math.random() * E_DEBRIS.length) | 0;
			p.c[i] = y + rnd(10, 20);
		}
		for (let k = 0; k < 6; k++) {
			const a = (k / 6) * Math.PI * 2 + rnd(-0.3, 0.3);
			const i = p.spawn(SMOKE, x + Math.cos(a) * 3, y + Math.sin(a) * 3, Math.cos(a) * rnd(14, 26), Math.sin(a) * rnd(10, 20) - 6, rnd(0.35, 0.5));
			if (i < 0) break;
			p.a[i] = Math.round(rnd(6, 9));
		}
		this.sparks(x, y, 8 + heat * 2, 90, 170, R_FIRE, 0);

		const u = this.popups;
		const i = u.add(x, y - 7, LEMON, ORANGE);
		u.text(i, '+').number(i, 100 * combo);
		if (combo >= 2) {
			const w = (u.len[i] * (GLYPH_W + 1)) / 2;
			const j = u.add(x + w + 9, y - 13, PINK, BERRY, 0, 0.04);
			u.text(j, 'x').number(j, combo);
		}
		if (combo === 3 || (combo > 3 && combo % 5 === 0)) {
			const j = u.add(x, y - 21, WHITE, PINK, 1, 0.08);
			u.text(j, 'COMBO!');
		}
	}

	powerShot(x, y, charge) {
		const full = charge >= 1;
		this.hitStop = Math.max(this.hitStop, full ? 0.08 : 0.05);
		this.shake = Math.max(this.shake, 3 + charge * 3);
		this.flash(x, y, 15);
		const r = 24 + charge * 28;
		this.ring(x, y, r, 4, R_COOL, 0.38, 0);
		this.ring(x, y, r * 0.7, 2, R_FIRE, 0.32, 0.04);
		if (full) this.ring(x, y, r * 1.35, 1, R_MAGIC, 0.42, 0.08);

		const p = this.p;
		const n = full ? 20 : 14;
		for (let k = 0; k < n; k++) {
			const a = (k / n) * Math.PI * 2 + rnd(-0.08, 0.08);
			const i = p.spawn(STREAK, x, y, rnd(160, 260), 0, rnd(0.2, 0.3));
			if (i < 0) break;
			p.a[i] = Math.cos(a);
			p.b[i] = Math.sin(a);
			p.c[i] = rnd(5, 9);
			p.d[i] = rnd(8, 16);
		}
		this.sparks(x, y, full ? 26 : 16, 110, 220, R_COOL, 0);
		for (let k = 0; k < 8; k++) {
			const a = (k / 8) * Math.PI * 2;
			const i = p.spawn(SMOKE, x + Math.cos(a) * 6, y + Math.sin(a) * 6, Math.cos(a) * 30, Math.sin(a) * 30, rnd(0.4, 0.55));
			if (i < 0) break;
			p.a[i] = Math.round(rnd(8, 11));
		}

		const u = this.popups;
		const i = u.add(x, y - 16, WHITE, CYAN);
		u.text(i, '+').number(i, full ? 1000 : 500);
		if (full) u.text(u.add(x, y - 26, WHITE, PINK, 1, 0.06), 'MAX!');
	}

	fireworks(x, y) {
		this.shake = Math.max(this.shake, 1.5);
		this.flash(x, y, 7);
		this.ring(x, y, 18, 2, R_MAGIC, 0.3, 0);
		const p = this.p;
		const n = 26;
		const ramp = pick(SPARK_RAMPS);
		for (let k = 0; k < n; k++) {
			const a = (k / n) * Math.PI * 2 + rnd(-0.1, 0.1);
			const v = k % 2 ? rnd(55, 75) : rnd(95, 120);
			const i = p.spawn(SPARK, x, y, Math.cos(a) * v, Math.sin(a) * v, rnd(0.6, 0.85));
			if (i < 0) break;
			p.a[i] = k % 2 ? ramp : R_ICE;
			p.b[i] = 110;
			p.c[i] = 2.6;
			p.d[i] = 2;
		}
		this.confetti(x, y, 18, 90);
	}

	// ---- spawn helpers --------------------------------------------------

	flash(x, y, size) {
		const i = this.p.spawn(FLASH, x, y, 0, 0, 0.07);
		if (i >= 0) this.p.a[i] = size;
	}

	ring(x, y, radius, width, ramp, life, delay) {
		const i = this.p.spawn(RING, x, y, 0, 0, life);
		if (i < 0) return;
		this.p.age[i] = -delay;
		this.p.a[i] = ramp;
		this.p.b[i] = radius;
		this.p.c[i] = width;
	}

	sparks(x, y, n, v0, v1, ramp, gravity) {
		const p = this.p;
		for (let k = 0; k < n; k++) {
			const a = Math.random() * Math.PI * 2;
			const v = rnd(v0, v1);
			const i = p.spawn(SPARK, x, y, Math.cos(a) * v, Math.sin(a) * v, rnd(0.18, 0.32));
			if (i < 0) return;
			p.a[i] = ramp;
			p.b[i] = gravity;
			p.c[i] = 7;
			p.d[i] = k % 3 === 0 ? 2 : 1;
		}
	}

	star(x, y, vx, vy, life, frame, rel = 0) {
		const i = this.p.spawn(STAR, x, y, vx, vy, life);
		if (i < 0) return;
		this.p.a[i] = (Math.random() * 4) | 0;
		this.p.b[i] = frame;
		this.p.rel[i] = rel;
	}

	confetti(x, y, n, v) {
		const p = this.p;
		for (let k = 0; k < n; k++) {
			const i = p.spawn(CONFETTI, x, y, rnd(-v, v), rnd(-v * 1.3, -v * 0.3), rnd(0.9, 1.3));
			if (i < 0) return;
			p.a[i] = (Math.random() * PAIRS.length) | 0;
			p.b[i] = Math.random() * 6;
		}
	}

	// ---- per frame --------------------------------------------------------

	update(dt, cursor) {
		this.clock += dt;
		let sim = dt;
		if (this.hitStop > 0) {
			this.hitStop -= dt;
			sim = 0;
		}
		this.time += sim;

		const layer = this.layer;
		layer.begin();
		if (cursor.visible) this.follow(dt, cursor);
		this.step(sim);
		this.drawTrail();
		this.drawParticles(true, cursor);
		this.drawParticles(false, cursor);
		this.drawCharge(cursor);
		this.drawBusy(cursor);
		this.drawPopups(sim);
		this.updateShake(dt);
		layer.end();
	}

	// Spawning driven by the cursor's motion this frame, interpolated along the
	// path so fast flicks stay continuous.
	follow(dt, cursor) {
		const s = this.layer.scale;
		const x = cursor.x / s;
		const y = cursor.y / s;
		if (Number.isNaN(this.lastX)) {
			this.lastX = x;
			this.lastY = y;
		}
		const x0 = this.lastX;
		const y0 = this.lastY;
		this.lastX = x;
		this.lastY = y;
		const dx = x - x0;
		const dy = y - y0;
		const dist = Math.hypot(dx, dy);
		const speed = cursor.speed;
		const ux = dist > 0 ? dx / dist : 0;
		const uy = dist > 0 ? dy / dist : 0;
		const bo = this.view.look.body;
		const bx = bo[0];
		const by = bo[1];

		const wasDash = this.dash;
		this.dash = speed > (this.dash ? DASH_OFF : DASH_ON);
		if (this.dash && !wasDash && dist > 0) this.dashStart(x0 + bx, y0 + by, ux, uy);

		// Comet trail samples every virtual pixel along the path.
		const sf = Math.min(1, Math.max(0, (speed - 600) / 2400));
		if (sf > 0 && dist > 0) {
			const steps = Math.min(64, Math.ceil(dist));
			for (let k = 1; k <= steps; k++) {
				const f = k / steps;
				this.addTrail(x0 + dx * f + bx, y0 + dy * f + by, this.clock - dt * (1 - f), sf);
			}
		}

		const p = this.p;
		if (this.dash) {
			this.ghostT -= dt;
			if (this.ghostT <= 0) {
				this.ghostT = 0.028;
				const e = this.view.frame;
				const i = p.spawn(GHOST, x - e.hx, y - e.hy, 0, 0, 0.16);
				if (i >= 0) {
					const c = GHOST_COLOURS[Math.floor(this.clock * 30) % 3];
					p.a[i] = e.id;
					p.b[i] = c[0];
					p.c[i] = c[1];
				}
			}
			this.speedLineT -= dt;
			while (this.speedLineT <= 0 && dist > 0) {
				this.speedLineT += 1 / 70;
				const side = rnd(-14, 14);
				const back = rnd(2, 16);
				const i = p.spawn(SPEEDLINE, x + bx - ux * back - uy * side, y + by - uy * back + ux * side, 0, 0, rnd(0.09, 0.14));
				if (i < 0) break;
				p.a[i] = -ux;
				p.b[i] = -uy;
				p.c[i] = Math.min(34, speed / s / 26 + rnd(0, 6));
			}
		} else {
			this.speedLineT = 0;
		}

		// Sparkle stars along a moving cursor, spaced by distance.
		if (speed > 160 && cursor.buttons === 0) {
			this.travelStar += dist;
			const gap = this.dash ? 7 : 15;
			while (this.travelStar > gap) {
				this.travelStar -= gap;
				const f = this.travelStar / Math.max(dist, 1e-3);
				const sx = x - dx * f + bx + rnd(-4, 4);
				const sy = y - dy * f + by + rnd(-4, 4);
				if (this.dash) {
					const i = p.spawn(SPARK, sx, sy, -ux * rnd(20, 60) + rnd(-25, 25), -uy * rnd(20, 60) + rnd(-25, 25), rnd(0.2, 0.32));
					if (i >= 0) {
						p.a[i] = R_COMET;
						p.c[i] = 4;
						p.d[i] = Math.random() < 0.4 ? 2 : 1;
					}
				} else {
					this.star(sx, sy, -dx * 0.5 + rnd(-6, 6), -dy * 0.5 + rnd(-8, 2), rnd(0.35, 0.5), Math.random() < 0.3 ? 2 : 1);
				}
			}
		}

		// Dragging with the left button drops a line of coins.
		if (cursor.down && speed > 200) {
			this.travelCoin += dist;
			while (this.travelCoin > 11) {
				this.travelCoin -= 11;
				const f = this.travelCoin / Math.max(dist, 1e-3);
				const i = p.spawn(COIN, x - dx * f, y - dy * f, rnd(-10, 10), rnd(-50, -30), rnd(0.42, 0.5));
				if (i >= 0) p.c[i] = y - dy * f + 4;
			}
		}

		// Right button held: a stream of confetti.
		if ((cursor.buttons & 2) !== 0 && dist > 0) {
			this.travelConfetti += dist;
			while (this.travelConfetti > 9) {
				this.travelConfetti -= 9;
				const f = this.travelConfetti / Math.max(dist, 1e-3);
				const cx = x - dx * f + bx;
				const cy = y - dy * f + by;
				const i = p.spawn(CONFETTI, cx, cy, -ux * 30 + rnd(-30, 30), -uy * 30 + rnd(-50, 10), rnd(0.45, 0.7));
				if (i >= 0) {
					p.a[i] = (Math.random() * PAIRS.length) | 0;
					p.b[i] = Math.random() * 6;
				}
				if (Math.random() < 0.35) this.star(cx + rnd(-5, 5), cy + rnd(-5, 5), rnd(-10, 10), rnd(-10, 10), 0.3, 1);
			}
		}

		this.updateCharge(dt, cursor, x, y);

		// Idle: an occasional twinkle beside the sprite.
		if (cursor.idle > 2 && cursor.buttons === 0 && this.view.look.main.length === 1) {
			this.idleSparkT -= dt;
			if (this.idleSparkT <= 0) {
				this.idleSparkT = rnd(0.7, 1.3);
				this.star(x + bx + rnd(-9, 9), y + by + rnd(-10, 8), 0, -6, 0.55, 2);
			}
		} else {
			this.idleSparkT = 0.3;
		}
	}

	dashStart(x, y, ux, uy) {
		const p = this.p;
		for (let k = 0; k < 4; k++) {
			const i = p.spawn(SMOKE, x - ux * 3 + rnd(-2, 2), y - uy * 3 + rnd(-2, 2), -ux * rnd(20, 40) - uy * rnd(-25, 25), -uy * rnd(20, 40) + ux * rnd(-25, 25), rnd(0.25, 0.35));
			if (i < 0) break;
			p.a[i] = Math.round(rnd(4, 7));
		}
	}

	addTrail(x, y, t, s) {
		const h = this.trailHead;
		this.trailX[h] = x;
		this.trailY[h] = y;
		this.trailT[h] = t;
		this.trailS[h] = s;
		this.trailHead = (h + 1) % TRAIL;
		this.trailCount = Math.min(TRAIL, this.trailCount + 1);
	}

	updateCharge(dt, cursor, x, y) {
		if (!cursor.down || cursor.held < CHARGE_DELAY) {
			this.charge = 0;
			return;
		}
		const before = this.charge;
		this.charge = Math.min(1, (cursor.held - CHARGE_DELAY) / CHARGE_TIME);
		// Sparkles drawn inward to the ring while it fills.
		if (this.charge < 1 && Math.random() < dt * 28) {
			const a = Math.random() * Math.PI * 2;
			const r = rnd(20, 26);
			const life = rnd(0.2, 0.28);
			this.star(Math.cos(a) * r, Math.sin(a) * r, -Math.cos(a) * (r - RING_R) / life, -Math.sin(a) * (r - RING_R) / life, life, 1, 1);
		}
		if (before < 1 && this.charge >= 1 && !this.charged) {
			this.charged = true;
			this.ring(x, y, RING_R + 7, 2, R_GOLD, 0.2, 0);
			this.view.flashT = 0.05;
			for (let k = 0; k < 6; k++) {
				const a = (k / 6) * Math.PI * 2;
				this.star(Math.cos(a) * RING_R, Math.sin(a) * RING_R, Math.cos(a) * 50, Math.sin(a) * 50, 0.25, 1, 1);
			}
		}
	}

	step(dt) {
		if (dt <= 0) return;
		const p = this.p;
		for (let i = p.n - 1; i >= 0; i--) {
			const age = (p.age[i] += dt);
			if (age >= p.life[i]) {
				if (p.type[i] === COIN) this.star(p.x[i], p.y[i], 0, -10, 0.25, 2);
				p.kill(i);
				continue;
			}
			if (age < 0) continue;
			switch (p.type[i]) {
				case SPARK: {
					const drag = Math.exp(-p.c[i] * dt);
					p.vx[i] *= drag;
					p.vy[i] = p.vy[i] * drag + p.b[i] * dt;
					break;
				}
				case DEBRIS:
					p.vy[i] += 420 * dt;
					if (p.y[i] + p.vy[i] * dt > p.c[i] && p.vy[i] > 0) {
						p.vy[i] *= -0.45;
						p.vx[i] *= 0.6;
						if (p.vy[i] > -25) p.vy[i] = 0;
						p.d[i]++;
					}
					break;
				case CONFETTI: {
					const drag = Math.exp(-3 * dt);
					p.vx[i] *= drag;
					p.vy[i] = p.vy[i] * drag + 140 * dt;
					if (p.vy[i] > 34) p.vy[i] = 34;
					p.x[i] += Math.sin(age * 9 + p.b[i]) * 22 * dt;
					break;
				}
				case SMOKE: {
					const drag = Math.exp(-6 * dt);
					p.vx[i] *= drag;
					p.vy[i] = p.vy[i] * drag - 10 * dt;
					break;
				}
				case STAR:
					if (!p.rel[i]) {
						p.vx[i] *= Math.exp(-4 * dt);
						p.vy[i] *= Math.exp(-4 * dt);
					}
					break;
				case COIN:
					if (age < p.life[i] - 0.14) {
						p.vy[i] += 260 * dt;
						if (p.y[i] > p.c[i] && p.vy[i] > 0) {
							p.y[i] = p.c[i];
							p.vy[i] = 0;
							p.vx[i] = 0;
						}
					} else {
						p.vy[i] = -170;
					}
					break;
				case STREAK:
					p.c[i] += p.vx[i] * dt;
					p.vx[i] *= Math.exp(-7 * dt);
					continue;
				default:
					break;
			}
			p.x[i] += p.vx[i] * dt;
			p.y[i] += p.vy[i] * dt;
		}
	}

	drawTrail() {
		if (this.trailCount === 0) return;
		const pts = this.layer.points;
		const now = this.clock;
		// Two passes: a blue rim, then a white-hot core on top.
		for (let pass = 0; pass < 2; pass++) {
			for (let k = this.trailCount; k >= 1; k--) {
				const h = (this.trailHead - k + TRAIL) % TRAIL;
				const t = (now - this.trailT[h]) / TRAIL_LIFE;
				if (t >= 1 || t < 0) continue;
				const w = this.trailS[h] * (1 - t);
				if (pass === 0) {
					const size = Math.round(1 + w * 4);
					pts.push(this.trailX[h], this.trailY[h], size, KIND.DISC, rampAt(R_COMET, 0.3 + t * 0.7));
				} else {
					const size = Math.round(w * 2.4);
					if (size >= 1) pts.push(this.trailX[h], this.trailY[h], size, KIND.DISC, t < 0.4 ? WHITE : CYAN, INK, 1, 0, 0, FLAT);
				}
			}
		}
		while (this.trailCount > 0) {
			const h = (this.trailHead - this.trailCount + TRAIL) % TRAIL;
			if (now - this.trailT[h] < TRAIL_LIFE) break;
			this.trailCount--;
		}
	}

	drawParticles(under, cursor) {
		const p = this.p;
		const pts = this.layer.points;
		const lines = this.layer.lines;
		const s = this.layer.scale;
		const ax = cursor.x / s;
		const ay = cursor.y / s;
		for (let i = 0; i < p.n; i++) {
			const age = p.age[i];
			if (age < 0) continue;
			const type = p.type[i];
			const isUnder = type === SMOKE || type === RING || type === GHOST || type === FLASH;
			if (isUnder !== under) continue;
			const t = age / p.life[i];
			let x = p.x[i];
			let y = p.y[i];
			if (p.rel[i]) {
				x += ax;
				y += ay;
			}
			switch (type) {
				case SPARK: {
					const size = t < 0.55 ? p.d[i] : 1;
					pts.push(x, y, size, KIND.SQUARE, rampAt(p.a[i], t));
					break;
				}
				case STAR: {
					const frame = Math.min(p.b[i], Math.floor((1 - t) * (p.b[i] + 1)));
					const e = E_STAR[frame];
					const pair = PAIRS[p.a[i]];
					pts.sprite(e, x - e.w / 2 + 0.5, y - e.h / 2 + 0.5, KIND.SPRITE, pair[0], pair[1]);
					break;
				}
				case DEBRIS: {
					const e = E_DEBRIS[p.b[i]];
					const pair = PAIRS[p.a[i]];
					const f = fadeAfter(t, 0.7);
					const spin = p.d[i] < 2 ? turn(Math.floor(age * 18)) : 0;
					pts.sprite(e, x - e.w / 2, y - e.h / 2, KIND.SPRITE, pair[0], pair[1], f, spin | (f < 1 ? FLAT : 0));
					break;
				}
				case CONFETTI: {
					const e = E_CONFETTI[Math.floor(age * 12 + p.b[i]) & 3];
					const pair = PAIRS[p.a[i]];
					const f = fadeAfter(t, 0.65);
					pts.sprite(e, x - 1, y - 1, KIND.SPRITE, pair[0], pair[1], f, f < 1 ? FLAT : 0);
					break;
				}
				case COIN: {
					const e = E_MINICOIN[Math.floor(age * 16) & 3];
					pts.sprite(e, x - 4, y - 4, KIND.SPRITE, 0, 0, 1, FLAT);
					break;
				}
				case SMOKE: {
					const size = Math.round(2 + (p.a[i] - 2) * easeOut(Math.min(1, t * 2.5)));
					const f = fadeAfter(t, 0.35);
					pts.push(x, y, size, KIND.DISC, rampAt(R_SMOKE, t), INK, f, 0, 0, f < 1 ? FLAT : 0);
					break;
				}
				case RING: {
					const r = p.b[i] * easeOut(t);
					const width = Math.max(1, Math.round(p.c[i] * (1 - t)));
					const size = Math.round(r * 2);
					if (size > width * 2 + 1) {
						const f = fadeAfter(t, 0.6);
						pts.push(x, y, size, KIND.RING, rampAt(p.a[i], t), INK, f, 0, width, f < 1 ? FLAT : 0);
					}
					break;
				}
				case FLASH:
					pts.push(x, y, t < 0.5 ? p.a[i] : p.a[i] + 4, KIND.DISC, t < 0.5 ? WHITE : LEMON);
					break;
				case GHOST: {
					const e = art.entries[p.a[i]];
					pts.sprite(e, x, y, KIND.SILHOUETTE, p.b[i], p.c[i], 1 - t, FLAT);
					break;
				}
				case STREAK: {
					const r0 = p.c[i];
					const len = p.d[i] * (1 - t);
					const ca = p.a[i];
					const sa = p.b[i];
					lines.push(x + ca * r0, y + sa * r0, x + ca * (r0 + len), y + sa * (r0 + len), rampAt(R_FIRE, t * 0.8));
					break;
				}
				case SPEEDLINE: {
					const len = p.c[i];
					const ux = p.a[i];
					const uy = p.b[i];
					lines.push(x + ux * len * t, y + uy * len * t, x + ux * len, y + uy * len, t < 0.5 ? WHITE : CYAN);
					break;
				}
				default:
					break;
			}
		}
	}

	drawCharge(cursor) {
		if (this.charge <= 0 || !cursor.visible) return;
		const pts = this.layer.points;
		const s = this.layer.scale;
		const x = Math.round(cursor.x / s);
		const y = Math.round(cursor.y / s);
		// Snap in from a wider ring: anticipation.
		const appear = Math.min(1, (cursor.held - CHARGE_DELAY) / 0.08);
		const r = RING_R + Math.round((1 - appear) * 6);
		pts.push(x, y, r * 2 + 1, KIND.RING, NIGHT, INK, 1, 0, 1, FLAT);
		const full = this.charge >= 1;
		const filled = full ? RING_STEPS : Math.floor(this.charge * RING_STEPS);
		const blink = Math.floor(this.clock * 20) % RAINBOW.length;
		for (let k = 0; k < filled; k++) {
			let col = k === filled - 1 ? WHITE : k / RING_STEPS < 0.5 ? GOLD : ORANGE;
			if (full) col = RAINBOW[(blink + ((k / 6) | 0)) % RAINBOW.length];
			pts.push(x + RING_COS[k] * r + 0.5, y + RING_SIN[k] * r + 0.5, 2, KIND.SQUARE, col);
		}
	}

	// Three tiny stars orbiting the busy coin.
	drawBusy(cursor) {
		if (!cursor.visible || this.view.look.shape !== 'wait' || this.view.outT > 0) return;
		const pts = this.layer.points;
		const s = this.layer.scale;
		const x = cursor.x / s;
		const y = cursor.y / s;
		for (let k = 0; k < 3; k++) {
			const a = this.clock * 5 + (k / 3) * Math.PI * 2;
			pts.push(x + Math.cos(a) * 12, y + Math.sin(a) * 9, 5, KIND.STAR, k === 0 ? LEMON : k === 1 ? CYAN : PINK, WHITE);
		}
	}

	drawPopups(dt) {
		const u = this.popups;
		const pts = this.layer.points;
		const adv = GLYPH_W + 1;
		for (let i = u.n - 1; i >= 0; i--) {
			const age = (u.age[i] += dt);
			if (age >= POPUP_LIFE) {
				u.kill(i);
				continue;
			}
			if (age < 0) continue;
			// Pop in at double size, rise fast, hang, then dither away.
			const k = age < 0.05 ? 2 : 1;
			const rise = easeOut(Math.min(1, age / 0.2)) * 10;
			const f = fadeAfter(age / POPUP_LIFE, 0.7);
			const n = u.len[i];
			const width = n * adv * k - k;
			const left = Math.round(u.x[i] - width / 2);
			const top = Math.round(u.y[i] - rise - GLYPH_H * k);
			for (let c = 0; c < n; c++) {
				const e = GLYPHS[u.chars[i * POPUP_CHARS + c]];
				if (!e) continue;
				let colA = u.colA[i];
				let dy = 0;
				if (u.wave[i]) {
					colA = RAINBOW[(Math.floor(this.clock * 16) + c) % RAINBOW.length];
					dy = Math.round(Math.sin(this.clock * 14 - c * 0.9) * 1.5);
				}
				pts.sprite(e, left + c * adv * k, top + dy, KIND.GLYPH, colA, u.colB[i], f, f < 1 ? FLAT : 0, k);
			}
		}
	}

	updateShake(dt) {
		const layer = this.layer;
		this.shake *= Math.exp(-dt * 16);
		if (this.shake < 0.5) {
			this.shake = 0;
			layer.shakeX = layer.shakeY = 0;
			return;
		}
		// New offset every other frame reads chunkier than per-frame jitter.
		this.shakeTick ^= 1;
		if (this.shakeTick) {
			layer.shakeX = Math.round(rnd(-1, 1) * this.shake);
			layer.shakeY = Math.round(rnd(-1, 1) * this.shake);
		}
	}
}
