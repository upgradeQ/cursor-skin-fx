// Bubbles — the cursor is a drop of aqua gel on a summer sky, and the air
// around it is full of soap film. Bubbles are a simulation
// (buoyancy, breeze, separation, merging, popping into droplets) shaded with
// thin-film interference. Motion sheds bubbles, flicks spray fizz, clicks
// pop what is near, holding blows a big bubble on a wand, and the right
// button whirls everything into a vortex that flings it out on release.
import '../../shared/preview.js';
import * as THREE from 'three';
import { CursorFeed } from '../../shared/cursor-feed.js';
import { createStage } from '../../shared/stage.js';
import { compileLayers, setFrame } from './gl.js';
import { BubbleSim, SPAWN } from './sim.js';
import { FilmRenderer } from './film.js';
import { Accents, KIND } from './rings.js';
import { GelCursor } from './gel.js';
import { Wand } from './wand.js';

const BODY = [5, 12];          // px from the hotspot to the middle of the gel
const SHED_SPACING = 13;       // px of travel per shed bubble at low speed
const FLICK_SPEED = 1200;      // px/s where flicks start to spray fizz
const CLICK_POP_R = 34;        // px around the hotspot a click pops
const VORTEX_RAMP = 0.25;      // s for the swirl to spin up
const rand = (a, b) => a + Math.random() * (b - a);

const stage = createStage({ antialias: false, maxPixelRatio: 2 });
const { renderer, canvas } = stage;
// The canvas stays out of the page until the shaders are compiled, so
// nothing that waits for it (the showreel, captures) starts early.
const host = canvas.parentNode;
canvas.remove();
const scene = new THREE.Scene();
// Every layer places its vertices in page pixels itself; the camera is only
// there for the renderer.
const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);
const sim = new BubbleSim();
const film = new FilmRenderer(scene, sim);
const accents = new Accents(scene);
const gel = new GelCursor(scene);
const wand = new Wand(sim, accents);
await compileLayers(renderer, scene, camera);
host.appendChild(canvas);
const cursor = new CursorFeed();

let time = 0;
let shedCarry = 0;
let click = null;
let fling = 0;
let vortex = 0;
let swirl = null;
let halo = null;
let fizzClock = 0;
let tipClock = 0;
let drawn = false;
let dirty = true;

const fx = {
	fizzAt(x, y, n = 1, vx = 0, vy = -70) {
		for (let i = 0; i < n; i++) sim.drop(x, y, vx + rand(-30, 30), vy + rand(-30, 10), rand(0.9, 1.7), rand(0.35, 0.7), SPAWN.fizz);
	},
	fizzBurst(x, y, n, speed) {
		for (let i = 0; i < n; i++) {
			const a = rand(0, Math.PI * 2);
			const s = rand(0.3, 1) * speed;
			sim.drop(x, y, Math.cos(a) * s, Math.sin(a) * s - 40, rand(0.9, 1.8), rand(0.3, 0.6), SPAWN.fizz);
		}
	},
};

cursor.on('show', () => {
	gel.appear(cursor.shape);
	shedCarry = 0;
	accents.add(KIND.ripple, cursor.sx, cursor.sy, { dur: 0.4, r0: 4, r1: 26, amount: 0.6 });
});

cursor.on('hide', () => {
	if (halo) halo.dead = true;
	halo = null;
});

cursor.on('shape', ({ shape }) => {
	gel.setShape(shape);
	if (!cursor.visible) return;
	fx.fizzBurst(cursor.sx + BODY[0], cursor.sy + BODY[1] * 0.5, 6, 90);
});

cursor.on('down', ({ button }) => {
	if (!cursor.visible) return;
	const x = cursor.sx;
	const y = cursor.sy;
	if (button === 0) {
		click = [x, y, CLICK_POP_R];
		gel.jiggle(1);
		accents.add(KIND.ripple, x, y, { dur: 0.5, r0: 5, r1: 48, amount: 1 });
		// If nothing was there to pop, blow a puff of bubbles from the tip instead.
		for (let i = 0; i < 7; i++) {
			const a = -2.2 + rand(-0.75, 0.75);
			const s = rand(90, 250);
			sim.bubble(x - 2, y - 2, Math.cos(a) * s, Math.sin(a) * s, rand(2.5, 8), rand(1.6, 3.4), SPAWN.ifNothingPopped);
		}
	} else if (button === 2) {
		swirl = accents.add(KIND.swirl, x, y, { dur: Infinity, r0: 58, r1: 108, amount: 0 });
	}
});

cursor.on('up', ({ button }) => {
	if (button !== 2) return;
	if (swirl) {
		swirl.dead = true;
		swirl = null;
	}
	if (!cursor.visible) return;
	fling = vortex;
	accents.add(KIND.ripple, cursor.sx, cursor.sy, { dur: 0.6, r0: 20, r1: 170, amount: 0.9 * vortex });
	fx.fizzBurst(cursor.sx, cursor.sy, 20, 380);
});

// Bubbles shed along the path, fizz sprayed on fast flicks.
function emit(dt) {
	const x0 = cursor.prevSX;
	const y0 = cursor.prevSY;
	const dx = cursor.sx - x0;
	const dy = cursor.sy - y0;
	const dist = Math.hypot(dx, dy);
	const speed = cursor.speed;
	const spacing = SHED_SPACING - Math.min(6, speed / 350);
	shedCarry += dist;
	while (shedCarry >= spacing && dist > 0) {
		shedCarry -= spacing;
		const f = 1 - shedCarry / dist;
		const big = Math.random() < 0.08;
		const r = big ? rand(9, 14) : rand(2.2, 7.5);
		sim.bubble(
			x0 + dx * f + BODY[0] + rand(-5, 5), y0 + dy * f + BODY[1] + rand(-6, 6),
			-cursor.vx * 0.1 + rand(-30, 30), -cursor.vy * 0.1 + rand(-35, 20),
			r, rand(1.8, 4.6) + (big ? 2 : 0),
		);
	}
	if (speed > FLICK_SPEED && dist > 0) {
		const n = Math.min(14, 2 + Math.floor((speed - FLICK_SPEED) / 200));
		const nx = -dy / dist;
		const ny = dx / dist;
		for (let i = 0; i < n; i++) {
			const f = Math.random();
			const side = rand(-1, 1) * 170;
			const px = x0 + dx * f + BODY[0];
			const py = y0 + dy * f + BODY[1];
			const kind = Math.random() < 0.3 ? SPAWN.water : SPAWN.fizz;
			sim.drop(px, py, nx * side - cursor.vx * 0.06, ny * side - cursor.vy * 0.06, rand(0.7, 1.6), rand(0.25, 0.6), kind);
		}
	}
}

// Over text the I-beam fizzes like soda; over a link a fingertip shimmers and lets go of tiny bubbles.
function hover(dt) {
	const shape = cursor.shape;
	if (shape === 'text') {
		fizzClock += dt * (10 + Math.min(30, cursor.speed / 30));
		while (fizzClock > 1) {
			fizzClock -= 1;
			fx.fizzAt(cursor.sx + rand(-1.5, 1.5), cursor.sy + rand(6, 12), 1, 0, -90);
		}
	}
	if (shape === 'pointer') {
		if (!halo) halo = accents.add(KIND.halo, cursor.sx, cursor.sy, { dur: Infinity, r0: 7, r1: 12, amount: 0 });
		halo.x = cursor.sx;
		halo.y = cursor.sy + 1;
		halo.amount = Math.min(1, halo.amount + dt * 4);
		tipClock += dt;
		if (tipClock > 0.45) {
			tipClock = 0;
			sim.bubble(cursor.sx + rand(-2, 2), cursor.sy - 3, rand(-15, 15), rand(-60, -30), rand(2, 4), rand(1.2, 2.2));
		}
	} else if (halo) {
		halo.dead = true;
		halo = null;
	}
}

// Right button: spin up a vortex and keep feeding it bubbles.
function whirl(dt) {
	const want = cursor.visible && (cursor.buttons & 2) ? 1 : 0;
	vortex += Math.sign(want - vortex) * Math.min(Math.abs(want - vortex), dt / VORTEX_RAMP);
	if (swirl) {
		swirl.x = cursor.sx;
		swirl.y = cursor.sy;
		swirl.amount = vortex;
	}
	if (want && Math.random() < dt * 60) {
		const a = rand(0, Math.PI * 2);
		const d = rand(70, 180);
		sim.bubble(cursor.sx + Math.cos(a) * d, cursor.sy + Math.sin(a) * d, -Math.sin(a) * 160, Math.cos(a) * 160, rand(2.5, 9), rand(2.2, 4));
	}
}

stage.onResize(() => {
	dirty = true;
});

stage.loop((dt, now) => {
	cursor.update(now);
	time += dt;

	if (cursor.visible) {
		emit(dt);
		hover(dt);
	}
	whirl(dt);
	const wandBubble = wand.update(dt, cursor, fx);
	gel.update(dt, cursor, { charge: wand.charge });
	film.setWand(wandBubble);
	accents.update(dt);

	const live = sim.busy;
	const busy = live || gel.busy || accents.busy || wand.active;
	if (!busy && !drawn && !dirty) return;
	dirty = false;

	setFrame(stage.width, stage.height, renderer.getPixelRatio(), time);
	if (live) {
		sim.step({
			dt,
			hot: [cursor.sx, cursor.sy],
			body: [cursor.sx + BODY[0], cursor.sy + BODY[1]],
			vel: [cursor.vx, cursor.vy],
			on: cursor.visible,
			vortex,
			fling,
			click,
			wand: wand.obstacle,
			width: stage.width,
			height: stage.height,
		});
	}
	click = null;
	fling = 0;
	film.update(live);
	renderer.render(scene, camera);
	// Idle and hidden: this was the last, empty frame; leave the canvas alone after it.
	drawn = busy;
});
