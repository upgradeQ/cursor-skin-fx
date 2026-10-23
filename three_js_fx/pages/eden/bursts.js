// Spawn recipes for the one-shot moments: a click's sun flare and petal
// bloom, a caret splash on text, leaves and petals scattering off fast
// flicks with an anamorphic streak, sparkle dust and the odd leaf along the
// path, and the orb's release into butterflies, leaves and bubbles.
import { KIND } from './sprites.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export const LEAF_GREENS = [[0.50, 0.86, 0.33], [0.30, 0.70, 0.20], [0.64, 0.91, 0.30], [0.22, 0.64, 0.25]];
export const BUTTERFLY_TINTS = [[0.18, 0.60, 1.00], [0.00, 0.76, 0.84], [1.00, 0.60, 0.10]];
const PETAL_WHITE = [1.0, 0.99, 0.95];
const PETAL_GOLD = [1.0, 0.80, 0.20];
const SPARK_TINTS = [[1.0, 0.90, 0.50], [0.55, 0.92, 1.0], [0.70, 1.0, 0.62]];
const GHOST_TINTS = [[0.50, 1.0, 0.55], [0.40, 0.82, 1.0], [1.0, 0.88, 0.45]];

export function sparkle(sprites, x, y, { vx = 0, vy = 0, speed = rand(20, 90), size = rand(3, 6), life = rand(0.35, 0.7) } = {}) {
	const [r, g, b] = pick(SPARK_TINTS);
	const a = rand(0, TAU);
	sprites.spawn(KIND.sparkle, x, y, {
		vx: vx + Math.cos(a) * speed, vy: vy + Math.sin(a) * speed, drag: 3, gy: -12,
		w: size, life, fadeIn: 0.04, fadeOut: life * 0.6, r, g, b, add: 0.5, rot: rand(0, 0.8), spin: rand(-2, 2),
	});
}

export function leaf(sprites, x, y, vx, vy, { size = rand(5, 7.5), life = rand(0.9, 1.5), gy = 90, flutter = 260 } = {}) {
	const [r, g, b] = pick(LEAF_GREENS);
	sprites.spawn(KIND.leaf, x, y, {
		vx, vy, drag: 2.2, gy, w: size, life, fadeIn: 0.06, fadeOut: 0.4, r, g, b,
		rot: rand(0, TAU), spin: rand(-5, 5), flip: rand(0, TAU), flipRate: rand(-9, 9), flutter,
	});
}

export function petal(sprites, x, y, vx, vy, { gold = false, size = rand(4.5, 6.5), life = rand(0.8, 1.1), rot = rand(0, TAU) } = {}) {
	const [r, g, b] = gold ? PETAL_GOLD : PETAL_WHITE;
	sprites.spawn(KIND.petal, x, y, {
		vx, vy, drag: 3.8, gy: 40, w: size, life, fadeIn: 0.03, fadeOut: 0.45, r, g, b,
		rot, spin: rand(-1.6, 1.6), flipRate: rand(-6, 6), flutter: 90,
	});
}

export function bubble(sprites, x, y, { size = rand(4, 8), vy = rand(-70, -40) } = {}) {
	sprites.spawn(KIND.bubble, x, y, {
		vx: rand(-25, 25), vy, drag: 1.2, gy: -30, w: size, life: rand(1.0, 1.6), fadeIn: 0.1, fadeOut: 0.3,
		flutter: 60, grow: 1.2,
	});
}

// A sun flare: starburst, a ring and soft hexagonal ghosts on the line
// through the screen centre, the way a lens would scatter it.
export function sunFlare(sprites, x, y, size = 1) {
	sprites.spawn(KIND.starburst, x, y, {
		w: 48 * size, life: 0.55, fadeIn: 0.02, fadeOut: 0.45, r: 1, g: 0.88, b: 0.5, add: 0.5, grow: 1.25, seed: rand(0, 1),
	});
	sprites.spawn(KIND.ring, x, y, { w: 22 * size, grow: 2.8, life: 0.45, fadeIn: 0.01, fadeOut: 0.4, r: 0.55, g: 1, b: 0.85 });
	let dx = innerWidth / 2 - x;
	let dy = innerHeight / 2 - y;
	const l = Math.hypot(dx, dy);
	if (l < 40) {
		dx = 0.7;
		dy = 0.7;
	} else {
		dx /= l;
		dy /= l;
	}
	const reach = Math.min(280, Math.max(140, l * 0.7)) * size;
	for (const [k, s] of [[0.22, 6], [0.42, 12], [0.66, 8], [0.95, 17]]) {
		const [r, g, b] = pick(GHOST_TINTS);
		sprites.spawn(KIND.ghost, x + dx * reach * k, y + dy * reach * k, {
			w: s * size, life: 0.6, fadeIn: 0.05, fadeOut: 0.5, r, g, b, add: 0.55, rot: rand(0, 1), grow: 1.15,
			vx: dx * 30, vy: dy * 30,
		});
	}
}

// Click: a ring of petals opening outwards with sparkles and a couple of bubbles.
export function bloom(sprites, x, y, { gold = false, petals = 12 } = {}) {
	const turn = rand(0, TAU);
	for (let i = 0; i < petals; i++) {
		const a = turn + (i / petals) * TAU;
		const s = rand(210, 290);
		petal(sprites, x + Math.cos(a) * 5, y + Math.sin(a) * 5, Math.cos(a) * s, Math.sin(a) * s, { gold: gold && i % 3 !== 2, rot: a });
	}
	for (let i = 0; i < 10; i++) sparkle(sprites, x, y, { speed: rand(60, 220), size: rand(3, 5.5) });
	for (let i = 0; i < 2; i++) bubble(sprites, x + rand(-10, 10), y + rand(-6, 6), { size: rand(4, 7) });
}

// Clicking into text: a thin caret flash along the line and a few sparkles.
export function caretSplash(sprites, x, y) {
	sprites.spawn(KIND.streak, x, y, { w: 60, h: 4, life: 0.3, fadeIn: 0.02, fadeOut: 0.26, r: 0.5, g: 0.95, b: 0.8, add: 0.3, grow: 1.6 });
	sprites.spawn(KIND.ring, x, y, { w: 10, grow: 2.2, life: 0.35, fadeIn: 0.01, fadeOut: 0.3, r: 0.5, g: 0.9, b: 1 });
	for (let i = 0; i < 6; i++) sparkle(sprites, x + rand(-4, 4), y + rand(-10, 10), { speed: rand(40, 120), size: rand(2.5, 4.5) });
	for (let i = 0; i < 4; i++) petal(sprites, x, y + rand(-8, 8), rand(-160, 160), rand(-120, -40), { size: rand(3.5, 4.5), life: 0.7 });
}

// Fast flicks: leaves and petals shaken off behind and to the sides.
export function flickScatter(sprites, x, y, vx, vy, dt) {
	const speed = Math.hypot(vx, vy) || 1;
	const nx = -vy / speed;
	const ny = vx / speed;
	const count = Math.random() < (speed / 1200) * dt * 40 ? 1 + (Math.random() < 0.4 ? 1 : 0) : 0;
	for (let i = 0; i < count; i++) {
		const side = Math.random() < 0.5 ? -1 : 1;
		const out = rand(70, 220) * side;
		const back = rand(0.08, 0.2);
		const svx = -vx * back + nx * out;
		const svy = -vy * back + ny * out;
		if (Math.random() < 0.6) leaf(sprites, x, y, svx, svy, { size: rand(5, 8) });
		else petal(sprites, x, y, svx, svy, { size: rand(4, 6), gold: Math.random() < 0.3 });
	}
}

// The anamorphic streak a fast flick throws across the lens.
export function streakFlare(sprites, x, y) {
	sprites.spawn(KIND.streak, x, y, { w: 170, h: 7, life: 0.34, fadeIn: 0.02, fadeOut: 0.3, r: 0.5, g: 0.85, b: 1, add: 0.55, grow: 1.35 });
	sprites.spawn(KIND.glow, x, y, { w: 26, life: 0.3, fadeIn: 0.02, fadeOut: 0.25, r: 0.75, g: 1, b: 0.95, add: 0.5 });
}

// Sparkle dust shed along the path.
export function dust(sprites, x, y, vx, vy) {
	sparkle(sprites, x + rand(-3, 3), y + rand(-3, 3), { vx: -vx * 0.04, vy: -vy * 0.04, speed: rand(8, 40), size: rand(2.2, 4.2), life: rand(0.4, 0.8) });
}

export function trailLeaf(sprites, x, y, vx, vy) {
	const speed = Math.hypot(vx, vy) || 1;
	const side = Math.random() < 0.5 ? -1 : 1;
	leaf(sprites, x, y, (-vy / speed) * 90 * side - vx * 0.08, (vx / speed) * 90 * side - vy * 0.08 - 30, { size: rand(5, 6.5), life: rand(1.1, 1.6) });
}

export function twinkle(sprites, x, y) {
	for (let i = 0; i < 4; i++) sparkle(sprites, x + rand(-6, 14), y + rand(-4, 22), { speed: rand(10, 40), size: rand(2.5, 4) });
}

export function shapePop(sprites, x, y) {
	for (let i = 0; i < 5; i++) sparkle(sprites, x + rand(-8, 12), y + rand(-8, 14), { speed: rand(40, 110), size: rand(2.5, 4.5), life: 0.45 });
}

// The orb lets go: a flare, butterflies lifting off, leaves, petals, bubbles.
export function orbRelease(sprites, x, y, R) {
	sunFlare(sprites, x, y - R * 0.15, Math.max(1, R / 50));
	for (let i = 0; i < 4; i++) {
		const a = -Math.PI / 2 + rand(-1.3, 1.3);
		const [r, g, b] = BUTTERFLY_TINTS[i % BUTTERFLY_TINTS.length];
		sprites.spawn(KIND.butterfly, x + Math.cos(a) * R * 0.55, y + Math.sin(a) * R * 0.55, {
			vx: Math.cos(a) * rand(70, 150), vy: Math.sin(a) * rand(80, 150) - 40, drag: 0.5, gy: -25,
			w: rand(8, 10.5), life: rand(1.9, 2.6), fadeIn: 0.12, fadeOut: 0.7, r, g, b,
			flutter: 480, flap: rand(0, TAU), flapRate: rand(19, 25), faceVel: 1,
		});
	}
	for (let i = 0; i < 14; i++) {
		const a = rand(0, TAU);
		const s = rand(90, 240);
		leaf(sprites, x + Math.cos(a) * R * 0.8, y + Math.sin(a) * R * 0.8, Math.cos(a) * s, Math.sin(a) * s - 60, { size: rand(5.5, 8.5), gy: 60 });
	}
	for (let i = 0; i < 6; i++) {
		const a = rand(0, TAU);
		petal(sprites, x + Math.cos(a) * R * 0.7, y + Math.sin(a) * R * 0.7, Math.cos(a) * 160, Math.sin(a) * 160 - 40, { gold: i % 2 === 0 });
	}
	for (let i = 0; i < 5; i++) bubble(sprites, x + rand(-R, R) * 0.6, y + rand(-R, R) * 0.4, { size: rand(5, 10), vy: rand(-110, -60) });
	for (let i = 0; i < 18; i++) {
		const a = rand(0, TAU);
		sparkle(sprites, x + Math.cos(a) * R, y + Math.sin(a) * R, { speed: rand(30, 150), size: rand(3, 6) });
	}
}

// Bits shed from the dissolving rim while the orb floats away.
export function orbCrumb(sprites, x, y, R) {
	const a = rand(0, TAU);
	const px = x + Math.cos(a) * R * rand(0.6, 1);
	const py = y + Math.sin(a) * R * rand(0.6, 1);
	if (Math.random() < 0.5) leaf(sprites, px, py, Math.cos(a) * 80, Math.sin(a) * 80 - 40, { size: rand(4.5, 7), gy: 50 });
	else sparkle(sprites, px, py, { speed: rand(30, 90), size: rand(3, 5) });
}
