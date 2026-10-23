// Molten sparks thrown off by strikes: streaks stretched along their
// velocity, falling under gravity and skipping off the bottom of the screen.
import { rand } from './bolts.js';

const POOL = 600;
const GRAVITY = 1400;

export class Sparks {
	constructor() {
		this.items = [];
		this.height = innerHeight;
		addEventListener('resize', () => (this.height = innerHeight));
	}

	// count sparks from (x, y), spraying around `angle` (radians, y down) by `spread`.
	burst(t, x, y, count, speed, { angle = -Math.PI / 2, spread = Math.PI, life = 0.7 } = {}) {
		for (let i = 0; i < count && this.items.length < POOL; i++) {
			const a = angle + rand(-spread, spread);
			const v = speed * rand(0.3, 1);
			this.items.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, born: t, life: life * rand(0.5, 1.2) });
		}
	}

	update(dt, t, ribbons, glows) {
		const floor = this.height - 2;
		const drag = Math.exp(-1.6 * dt);
		this.items = this.items.filter((s) => t - s.born < s.life);
		for (const s of this.items) {
			s.vx *= drag;
			s.vy = s.vy * drag + GRAVITY * dt;
			s.x += s.vx * dt;
			s.y += s.vy * dt;
			if (s.y > floor && s.vy > 0) {
				s.y = floor;
				s.vy *= -0.35;
				s.vx *= 0.7;
			}
			const k = 1 - (t - s.born) / s.life;
			const tail = 0.022;
			ribbons.add([s.x, s.y, s.x - s.vx * tail, s.y - s.vy * tail], 6, 0.9, k * 1.1, { taper: 1, hue: 0.05 });
			glows.add(s.x, s.y, 7, k * 0.6, 0, 1);
		}
		return this.items.length > 0;
	}
}
