// Bloom — a pink pearl cursor in a storm of glitter and sakura. Moving draws
// a glowing ribbon and sheds glitter that glints as it falls, fast moves
// scatter petals and pop blossoms along the path, clicks burst into flowers
// with shockwaves (hearts over links, petal rain on combos), holding grows a
// rose that blows apart on release, and the right button calls a swirl of
// butterflies. Models, matcaps and textures were made in Blender (assets/).
import '../../shared/preview.js';
import * as THREE from 'three';
import { CursorFeed } from '../../shared/cursor-feed.js';
import { createStage } from '../../shared/stage.js';
import { glitterTime, jewelMaterial, loadAssets } from './assets.js';
import { Bodies } from './bodies.js';
import { Butterflies } from './butterflies.js';
import { Jewel } from './jewel.js';
import { Rose } from './rose.js';
import { BOKEH, BOKEH_TINTS, FLAKE, GLITTER, GLOW, HEART, PINKS, RING, SPARKLE, STAR, STREAK, Sprites, pick, rand } from './sprites.js';

const HOLD_DELAY = 0.18;   // s before a held button starts growing the rose
const PETAL_EVERY = 15;    // px of fast travel per shed petal
const BLOSSOM_EVERY = 70;  // px of very fast travel per popped blossom
const RIBBON_STEP = 3;     // px between the glowing ribbon's beads
const PETAL_COLORS = [[1, 0.72, 0.85], [1, 0.85, 0.92], [1, 0.55, 0.75], [1, 1, 1], [0.92, 0.75, 1]];
const BLOSSOM_COLORS = [[1, 0.8, 0.9], [1, 0.62, 0.8], [1, 1, 1], [0.95, 0.8, 1]];
const WHITE_HOT = [[1, 0.92, 0.98], [1, 0.7, 0.9], [1, 0.88, 0.55]];

const stage = createStage({ maxPixelRatio: 1.5 });
const { renderer } = stage;
renderer.autoClear = false;
const cursor = new CursorFeed();
const scene = new THREE.Scene();      // flowers, petals, glitter
const front = new THREE.Scene();      // the cursor, always on top
const camera = new THREE.OrthographicCamera(0, 1, 0, -1, 1, 4000);
camera.position.z = 2000;
stage.onResize((w, h) => {
	camera.right = w;
	camera.bottom = -h;
	camera.updateProjectionMatrix();
});

const assets = await loadAssets();
const { geo, matcap } = assets;
const petalMat = jewelMaterial(matcap.petal, { map: assets.petalMap, glitter: 0.7, side: THREE.DoubleSide });

const sprites = new Sprites(scene, assets.sprites);
const fx = {
	sprites,
	petals: new Bodies(scene, [{ geometry: geo.petal, material: petalMat }], 900),
	leaves: new Bodies(scene, [{ geometry: geo.leaf, material: jewelMaterial(matcap.leaf, { side: THREE.DoubleSide }) }], 160),
	blossoms: new Bodies(scene, [
		{ geometry: geo.blossom_petal, material: petalMat },
		{ geometry: geo.blossom_center, material: jewelMaterial(matcap.gold) },
		{ geometry: geo.blossom_gold, material: jewelMaterial(matcap.gold, { glitter: 1 }) },
	], 320),
	hearts: new Bodies(scene, [{ geometry: geo.heart, material: jewelMaterial(matcap.candy, { glitter: 1.6 }) }], 240),
	stars: new Bodies(scene, [{ geometry: geo.star, material: jewelMaterial(matcap.gold, { glitter: 1.6 }) }], 240),

	// A brief pink wash over the whole page.
	flash(strength) {
		const size = Math.hypot(innerWidth, innerHeight) * 2.2;
		sprites.spawn(innerWidth / 2, innerHeight / 2, { tile: GLOW, size, color: [1, 0.55, 0.85], alpha: strength, add: 0.85, life: 0.25, z: -500 });
	},
	// An expanding ring of light reaching `radius` px.
	shockwave(x, y, radius, { color = [1, 0.6, 0.9], life = 0.35, alpha = 1 } = {}) {
		const s0 = radius * 0.2;
		sprites.spawn(x, y, { tile: RING, size: s0, grow: (radius * 2) / s0 - 1, color, alpha, add: 0.6, life, rot: 0 });
	},
	// Lens flare: a horizontal streak and a white star.
	flare(x, y, size, color = [1, 0.75, 0.95]) {
		sprites.spawn(x, y, { tile: STREAK, size: size * 2.4, color, add: 0.85, life: 0.28, rot: 0 });
		sprites.spawn(x, y, { tile: SPARKLE, size, color: [1, 1, 1], add: 0.85, life: 0.25, rot: 0, spin: 3 });
	},
	// Glitter thrown out of a point, glinting as it falls.
	glitter(x, y, n, speed, o = {}) {
		sprites.burst(x, y, n, speed, { tile: FLAKE, size: 6, life: 1.2, drag: 3, g: 380, twinkle: 7, glint: true, minSpeed: 0.08, add: 0.45, spin: 8, ...o });
	},
	// Petals falling from the top of the page around x.
	petalRain(x, n, spread = 420) {
		for (let i = 0; i < n; i++) {
			fx.petals.spawn(x + rand(-spread, spread), rand(-60, -10), {
				vx: rand(-80, 80), vy: rand(200, 520), g: 260, drag: 0.6, flutter: 600, size: rand(10, 16),
				life: rand(1.8, 2.8), pop: 0.1, color: pick(PETAL_COLORS),
			});
		}
		sprites.burst(x, -10, n * 3, 300, { tile: FLAKE, size: 6, life: 2, drag: 0.5, g: 260, twinkle: 6, glint: true, angle: Math.PI / 2, spread: 1.2, vx: 0 });
	},
};
const rose = new Rose(scene, assets);
const butterflies = new Butterflies(scene, assets);
const jewel = new Jewel(front, assets, renderer);

let elapsed = 0;
let drawn = false;
let petalRun = 0;
let blossomRun = 0;
let ribbonRun = 0;
let combo = 0;         // clicks in quick succession make bigger bursts
let lastClick = -10;

cursor.on('show', ({ x, y }) => {
	jewel.snapShape(cursor.shape);
	sprites.burst(x, y, 20, 300, { tile: SPARKLE, size: 14, life: 0.4, drag: 5, add: 0.7, palette: WHITE_HOT });
	fx.glitter(x, y, 40, 400);
	fx.shockwave(x, y, 60);
});

cursor.on('hide', ({ x, y }) => {
	fx.glitter(x, y, 60, 360, { life: 0.9 });
});

cursor.on('shape', ({ shape }) => {
	if (!jewel.setShape(shape) || !cursor.visible) return;
	fx.glitter(cursor.x, cursor.y, 30, 420, { life: 0.6 });
	sprites.spawn(cursor.x, cursor.y, { tile: SPARKLE, size: 54, color: [1, 0.9, 1], add: 0.8, life: 0.3, pop: 0.06, spin: 5 });
	fx.shockwave(cursor.x, cursor.y, 45, { life: 0.25 });
});

cursor.on('down', ({ button, x, y }) => {
	if (!cursor.visible) return;
	if (button === 0) {
		combo = elapsed - lastClick < 0.45 ? Math.min(combo + 1, 5) : 0;
		lastClick = elapsed;
		jewel.click(1 + combo * 0.15);
		if (cursor.shape === 'pointer') heartBurst(x, y, combo);
		else flowerBurst(x, y, combo);
		if (combo >= 2) fx.petalRain(x, 10 + combo * 8);
	} else if (button === 2) {
		butterflies.press(x, y);
		jewel.click(0.6);
		sprites.burst(x, y, 40, 800, { tile: SPARKLE, size: 16, life: 0.45, drag: 5, add: 0.75, palette: [[0.85, 0.7, 1], [1, 0.8, 0.95]] });
		fx.glitter(x, y, 80, 900, { palette: [[0.75, 0.5, 1], [1, 0.5, 0.85], [0.9, 0.8, 1]] });
		fx.shockwave(x, y, 140, { color: [0.8, 0.6, 1] });
		fx.flash(0.3);
	}
});

cursor.on('up', ({ button }) => {
	if (button === 2) butterflies.release(fx);
	if (button === 0) rose.release(fx);
});

// A click: one big blossom pops open on the hotspot, a ring of smaller ones
// and petals fly out, gem hearts hop up, shockwaves and a ring of sparkles
// race away and the air fills with glitter.
function flowerBurst(x, y, combo) {
	const k = 1 + combo * 0.3;
	fx.blossoms.spawn(x, y, { size: 34 * k, pop: 0.2, life: 0.75, face: 1, w: new THREE.Vector3(0, 0, 9), g: 500, vy: -260, drag: 1, z: 150, color: [1, 0.75, 0.88] });
	const n = Math.round(10 + 3 * combo);
	const turn = Math.random() * Math.PI * 2;
	for (let i = 0; i < n; i++) {
		const a = turn + (i / n) * Math.PI * 2;
		const v = rand(600, 950) * k;
		fx.blossoms.spawn(x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v - 150, g: 800, drag: 2.4, size: rand(10, 16), life: rand(0.9, 1.3), pop: 0.18, face: 0.5, color: pick(BLOSSOM_COLORS) });
	}
	for (let i = 0; i < 26 * k; i++) {
		const a = Math.random() * Math.PI * 2, v = rand(250, 1000) * k;
		fx.petals.spawn(x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v - 200, g: 420, drag: 2, flutter: 500, size: rand(9, 14), life: rand(1.1, 1.8), pop: 0.1, color: pick(PETAL_COLORS) });
	}
	for (let i = 0; i < 4 + combo; i++) {
		fx.hearts.spawn(x + rand(-10, 10), y, { vx: rand(-350, 350), vy: -rand(550, 900), g: 1500, drag: 0.5, size: rand(9, 14), life: rand(0.8, 1.1), pop: 0.2, face: 0.85, w: new THREE.Vector3(0, rand(-12, 12), 0), z: 160 });
	}
	ringOfSparkles(x, y, 32, 1000 * k);
	fx.glitter(x, y, 160 * k, 1100);
	sprites.burst(x, y, 14, 500, { tile: BOKEH, size: 26, life: 0.7, drag: 3, alpha: 0.5, add: 0.95, minSpeed: 0.2, palette: BOKEH_TINTS });
	sprites.burst(x, y, 10, 700, { tile: STAR, size: 14, life: 0.7, drag: 3, g: 500, add: 0.3, spin: 8, palette: [[1, 0.8, 0.3], [1, 0.5, 0.8]] });
	fx.shockwave(x, y, 150 * k);
	fx.shockwave(x, y, 90 * k, { life: 0.25, color: [1, 0.9, 1] });
	sprites.spawn(x, y, { tile: GLOW, size: 240 * k, grow: 0.4, color: [1, 0.45, 0.8], alpha: 0.9, add: 1, life: 0.25 });
	fx.flare(x, y, 150 * k);
	if (combo >= 2) fx.flash(0.14 * combo);
}

// Clicking a link: a fountain of gem hearts and gold stars.
function heartBurst(x, y, combo) {
	const k = 1 + combo * 0.3;
	for (let i = 0; i < 13 * k; i++) {
		const a = -Math.PI / 2 + rand(-1.1, 1.1), v = rand(550, 1100) * k;
		fx.hearts.spawn(x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 1700, drag: 0.8, size: rand(9, 16), life: rand(0.8, 1.2), pop: 0.15, face: 0.85, w: new THREE.Vector3(0, rand(-14, 14), rand(-2, 2)), z: 150 });
	}
	for (let i = 0; i < 8 * k; i++) {
		const a = Math.random() * Math.PI * 2, v = rand(400, 850) * k;
		fx.stars.spawn(x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v - 200, g: 900, drag: 2, size: rand(10, 15), life: rand(0.7, 1), pop: 0.15, face: 0.9, w: new THREE.Vector3(0, 0, rand(-14, 14)) });
	}
	sprites.burst(x, y, 36 * k, 800, { tile: HEART, size: 12, life: 0.8, drag: 3, g: 500, add: 0.2, angle: -Math.PI / 2, spread: 1.4, palette: [[1, 0.3, 0.6], [1, 0.55, 0.8], [1, 0.8, 0.9]], pop: 0.1 });
	fx.glitter(x, y, 120 * k, 1000, { angle: -Math.PI / 2, spread: 1.6, palette: [[1, 0.25, 0.55], [1, 0.75, 0.3], [1, 0.6, 0.85]] });
	ringOfSparkles(x, y, 24, 900 * k);
	fx.shockwave(x, y, 130 * k, { color: [1, 0.4, 0.7] });
	sprites.spawn(x, y, { tile: GLOW, size: 220 * k, grow: 0.4, color: [1, 0.35, 0.65], alpha: 0.9, add: 1, life: 0.22 });
	sprites.spawn(x, y, { tile: HEART, size: 80 * k, color: [1, 0.35, 0.65], add: 0.3, life: 0.35, pop: 0.12, grow: 0.9, rot: 0 });
	fx.flare(x, y, 120 * k, [1, 0.5, 0.75]);
}

function ringOfSparkles(x, y, n, speed) {
	const turn = Math.random();
	for (let i = 0; i < n; i++) {
		const a = ((i + turn) / n) * Math.PI * 2;
		sprites.spawn(x, y, { tile: SPARKLE, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, drag: 6, size: 24, life: 0.45, add: 0.75, color: pick(WHITE_HOT), spin: 6 });
	}
}

// The ribbon cycles hot pink -> lilac -> peach gold.
const RIBBON_HUES = [[1, 0.3, 0.7], [0.8, 0.45, 1], [1, 0.7, 0.45], [1, 0.3, 0.7]];
function ribbonColor(t) {
	const f = (t * 0.6) % 1 * 3;
	const i = Math.floor(f), u = f - i;
	const a = RIBBON_HUES[i], b = RIBBON_HUES[i + 1];
	return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

// What a moving cursor leaves behind: a glowing ribbon, glitter along every
// pixel of the path, sparkles and bokeh, and when it moves fast, petals and
// freshly popped blossoms.
function trail(dt) {
	const ax = cursor.prevSX, ay = cursor.prevSY, bx = cursor.sx, by = cursor.sy;
	const dist = Math.hypot(bx - ax, by - ay);
	const speed = cursor.speed;
	const back = Math.atan2(-cursor.vy, -cursor.vx);
	const hot = Math.min(1, speed / 2500);

	// Luminous ribbon: beads of glow every few px, shrinking as they age.
	ribbonRun += dist;
	const color = ribbonColor(elapsed);
	while (ribbonRun > RIBBON_STEP) {
		ribbonRun -= RIBBON_STEP;
		const f = dist > 0 ? Math.max(0, 1 - ribbonRun / dist) : 1;
		const x = ax + (bx - ax) * f + 7, y = ay + (by - ay) * f + 11;
		sprites.spawn(x, y, { tile: GLOW, size: 20 + 16 * hot, grow: -0.9, color, alpha: 0.8, add: 0.7, life: 0.3, z: -50 });
		sprites.spawn(x, y, { tile: GLOW, size: 7 + 4 * hot, grow: -0.9, color: [1, 0.95, 1], alpha: 0.9, add: 0.8, life: 0.18, z: -40 });
	}

	// Glitter dust, a lot of it, glinting as it tumbles down.
	const n = Math.min(160, Math.floor(dist / 1.6 + Math.random()));
	for (let i = 0; i < n; i++) {
		const f = Math.random();
		const a = back + rand(-1.3, 1.3), v = rand(30, 220) * (0.5 + hot);
		const big = Math.random() < 0.1;
		sprites.spawn(ax + (bx - ax) * f + 8 + rand(-8, 8), ay + (by - ay) * f + 12 + rand(-8, 8), {
			tile: FLAKE, size: big ? rand(8, 12) : rand(3.5, 7.5), life: rand(0.6, 1.4), vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 200, drag: 1.6,
			twinkle: rand(4, 12), glint: true, add: 0.45, spin: rand(-10, 10),
		});
	}
	if (Math.random() < dist / 22) {
		sprites.spawn(bx + rand(-14, 26), by + rand(-8, 32), { tile: SPARKLE, size: rand(14, 34), life: rand(0.25, 0.45), add: 0.75, pop: 0.06, spin: rand(-4, 4), color: pick(WHITE_HOT) });
	}
	if (Math.random() < dist / 40) {
		sprites.spawn(bx + rand(-30, 40), by + rand(-20, 50), { tile: BOKEH, size: rand(14, 34), life: rand(0.5, 0.9), vy: -rand(10, 40), alpha: 0.45, add: 0.95, color: pick(BOKEH_TINTS), pop: 0.15 });
	}
	if (speed > 1400 && Math.random() < dt * 30) {
		sprites.spawn(bx + 8, by + 12, { tile: STREAK, size: rand(60, 120) * hot, rot: -Math.atan2(cursor.vy, cursor.vx), life: 0.2, add: 0.85, color: color });
	}

	if (speed > 300) {
		petalRun += dist;
		while (petalRun > PETAL_EVERY) {
			petalRun -= PETAL_EVERY;
			const f = Math.random();
			const leaf = Math.random() < 0.12;
			(leaf ? fx.leaves : fx.petals).spawn(ax + (bx - ax) * f + 6, ay + (by - ay) * f + 12, {
				vx: -cursor.vx * 0.15 + rand(-160, 160), vy: -cursor.vy * 0.15 + rand(-200, 40),
				g: 260, drag: 1.8, flutter: 460, size: leaf ? rand(10, 14) : rand(9, 15), life: rand(1.4, 2.2), pop: 0.12,
				color: leaf ? [1, 1, 1] : pick(PETAL_COLORS),
			});
		}
	} else petalRun = 0;

	if (speed > 700) {
		blossomRun += dist;
		while (blossomRun > BLOSSOM_EVERY) {
			blossomRun -= BLOSSOM_EVERY;
			const f = Math.random();
			const x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
			const side = (Math.random() < 0.5 ? -1 : 1) * rand(12, 34);
			const nx = -cursor.vy / speed, ny = cursor.vx / speed;
			const px = x + nx * side, py = y + ny * side;
			fx.blossoms.spawn(px, py, {
				size: rand(12, 20), pop: 0.22, life: rand(0.9, 1.3), face: 0.85, g: 220, drag: 2,
				vx: nx * side * 6, vy: ny * side * 6, w: new THREE.Vector3(rand(-2, 2), rand(-2, 2), rand(-9, 9)), color: pick(BLOSSOM_COLORS),
			});
			sprites.spawn(px, py, { tile: SPARKLE, size: 40, add: 0.8, life: 0.25, color: [1, 0.95, 1] });
			fx.shockwave(px, py, 30, { life: 0.22, alpha: 0.7 });
			fx.glitter(px, py, 12, 260, { life: 0.8 });
		}
	} else blossomRun = 0;

	// Whip-fast flicks throw off gold stars and gem hearts.
	if (speed > 2000 && Math.random() < dt * 40) {
		const a = back + rand(-0.8, 0.8), v = rand(300, 700);
		const heart = Math.random() < 0.35;
		(heart ? fx.hearts : fx.stars).spawn(bx, by, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 700, drag: 1.5, size: rand(7, 11), life: 0.8, pop: 0.1, face: 0.9, w: new THREE.Vector3(0, heart ? rand(-12, 12) : 0, heart ? 0 : rand(-15, 15)) });
	}

	// Resting: twinkles and little hearts so the magic never quite stops.
	if (dist < 0.5 && Math.random() < dt * 8) {
		const a = Math.random() * Math.PI * 2, r = rand(20, 55);
		sprites.spawn(bx + 8 + Math.cos(a) * r, by + 12 + Math.sin(a) * r, { tile: pick([SPARKLE, HEART, STAR]), size: rand(8, 16), life: 0.7, vy: -30, add: 0.5, pop: 0.12, twinkle: 3, color: pick(GLITTER), spin: rand(-2, 2) });
	}
}

// Build every shader before the first visible frame.
renderer.compile(scene, camera);
renderer.compile(front, camera);

stage.loop((dt, now) => {
	cursor.update(now);
	elapsed += dt;
	glitterTime.value = elapsed % 1000;

	const holding = cursor.visible && cursor.down && cursor.held > HOLD_DELAY;
	if (cursor.visible) trail(dt);
	let busy = rose.update(dt, elapsed, cursor, holding, fx);
	busy = butterflies.update(dt, elapsed, cursor, fx) || busy;
	busy = jewel.update(dt, elapsed, cursor, sprites) || busy;
	busy = fx.petals.update(dt) || busy;
	busy = fx.leaves.update(dt) || busy;
	busy = fx.blossoms.update(dt) || busy;
	busy = fx.hearts.update(dt) || busy;
	busy = fx.stars.update(dt) || busy;
	busy = sprites.update(dt) || busy;

	// Idle and hidden: draw one last empty frame, then leave the canvas alone.
	if (busy || drawn) {
		renderer.clear();
		renderer.render(scene, camera);
		renderer.render(front, camera);
	}
	drawn = busy;
});
