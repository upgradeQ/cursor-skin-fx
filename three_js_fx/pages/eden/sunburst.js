// The right button: god rays fan out from the cursor like sun breaking
// through leaves, and three aurora ribbons swirl in a ring around it, each at
// its own speed. Letting go blooms gold and white petals under a flare.
import { KIND } from './sprites.js';
import { bloom, sparkle, sunFlare } from './bursts.js';

const RISE_S = 0.22;
const FALL_S = 0.5;
const RAYS_PX = [150, 270];          // ray fan radius from press to full
const RINGS = [                      // radius px, angular speed rad/s, phase, ribbon half width px
	[42, 3.1, 0.0, 8],
	[58, -2.3, 2.1, 6.5],
	[76, 1.8, 4.2, 10],
];
const ARC = 4.2;                     // rad each swirl ribbon spans
const PTS = 44;
const MIN_PRESS_S = 0.12;            // shorter presses do not earn the petal burst

export class Sunburst {
	constructor() {
		this.k = 0;
		this.held = false;
		this.age = 0;
		this.xs = new Float32Array(PTS);
		this.ys = new Float32Array(PTS);
		this.ws = new Float32Array(PTS);
		this.as = new Float32Array(PTS);
	}

	get on() {
		return this.k > 0;
	}

	press() {
		this.held = true;
		this.age = 0;
	}

	release(sprites, x, y) {
		if (!this.held) return;
		this.held = false;
		if (this.age < MIN_PRESS_S) return;
		sunFlare(sprites, x, y, 1.3);
		bloom(sprites, x, y, { gold: true, petals: 16 });
	}

	update(dt, t, cursor, sprites, aurora) {
		this.age += dt;
		const on = this.held && cursor.visible;
		this.k = on ? Math.min(1, this.k + dt / RISE_S) : Math.max(0, this.k - dt / FALL_S);
		if (this.k <= 0) return false;
		const e = this.k * this.k * (3 - 2 * this.k);
		const x = cursor.sx;
		const y = cursor.sy;
		const rays = RAYS_PX[0] + (RAYS_PX[1] - RAYS_PX[0]) * e;
		sprites.put(KIND.rays, x, y, rays, rays, t * 0.3, 1.0, 0.82, 0.36, e, 0.3, 0, 0, 0.37);
		sprites.put(KIND.glow, x, y, 40, 40, 0, 1.0, 0.92, 0.6, e * 0.35, 0.4);

		RINGS.forEach(([radius, speed, phase, width], band) => {
			const lead = phase + t * speed;
			const dir = Math.sign(speed);
			const r0 = radius * (0.6 + 0.4 * e);
			for (let j = 0; j < PTS; j++) {
				const u = j / (PTS - 1);
				const a = lead - dir * u * ARC;
				const r = r0 + 5 * Math.sin(a * 3 + t * 4 + band);
				this.xs[j] = x + Math.cos(a) * r;
				this.ys[j] = y + Math.sin(a) * r * 0.94;
				this.ws[j] = width * Math.pow(Math.sin(Math.PI * u), 0.7) * (0.5 + 0.5 * e);
				this.as[j] = e * 0.95;
			}
			aurora.strip(this.xs, this.ys, this.ws, this.as, PTS, band);
		});

		if (on && Math.random() < dt * 30) {
			const a = Math.random() * Math.PI * 2;
			const r = RINGS[Math.floor(Math.random() * RINGS.length)][0];
			sparkle(sprites, x + Math.cos(a) * r, y + Math.sin(a) * r, { speed: 30, size: 3 + Math.random() * 3 });
		}
		return true;
	}
}
