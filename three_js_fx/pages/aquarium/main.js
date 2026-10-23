// Aquarium — the cursor is a clear glass vessel half full of water, with a
// goldfish for company. Moving it leaves ripples in a height field, fast
// flicks fling droplets off it, clicks drop water in with a crown splash,
// holding grows a little globe the fish swims into until it bursts, and the
// right button calls a school of fish to circle it.
import '../../shared/preview.js';
import * as THREE from 'three';
import { CursorFeed } from '../../shared/cursor-feed.js';
import { createStage } from '../../shared/stage.js';
import { compileLayers, setFrame } from './gl.js';
import { Water } from './water.js';
import { Particles } from './particles.js';
import { Orb } from './orb.js';
import { FishRenderer } from './fish-render.js';
import { Shoal } from './fish.js';
import { GlassCursor } from './glass-cursor.js';

const HOLD_DELAY = 0.16;     // s before a held button starts growing the globe
const FLICK_SPEED = 1200;    // px/s above which water flies off the cursor
const FLICK_RATE = 44;       // droplets per s per 1000 px/s over FLICK_SPEED
const STOP_ACCEL = 30000;    // px/s² of braking that throws the water forward
const WAKE_RADIUS = 9;       // px, width of the trench the cursor ploughs
const WAKE_DEPTH = 0.3;      // height-field units at full speed
const WAKE_FULL = 1400;      // px/s for a full-depth wake
const TIME_WRAP = 2048;      // s, keeps shader time precise
// Where the water sits inside the arrow, from the hotspot (px).
const WATER_CENTER = [7, 19];

async function start() {
	const stage = createStage({ antialias: false, maxPixelRatio: 2 });
	const { renderer, canvas } = stage;
	// The canvas stays out of the page until the shaders are compiled, so
	// nothing that waits for it (the showreel, captures) starts early.
	const host = canvas.parentNode;
	canvas.remove();
	const scene = new THREE.Scene();
	// Every layer places its vertices in page pixels itself; the camera is
	// only there for the renderer.
	const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);
	const water = new Water(scene, renderer);
	const particles = new Particles(scene, water);
	const orb = new Orb(scene);
	const fishRenderer = new FishRenderer(scene);
	const glass = new GlassCursor(scene);
	const shoal = new Shoal(fishRenderer, {
		bubble: (x, y, r) => particles.bubble(x, y, r, 1.6 + Math.random() * 1.0, 24 + Math.random() * 14),
		splash: (x, y) => particles.crown(x, y, 0.75),
	});

	stage.onResize((w, h) => water.resize(w, h));
	await compileLayers(renderer, scene, camera);
	host.appendChild(canvas);
	const cursor = new CursorFeed();

	let elapsed = 0;
	let flickCarry = 0;
	let drawn = false;

	cursor.on('show', ({ x, y }) => {
		glass.snap(cursor.shape);
		shoal.appear(x, y);
		flickCarry = 0;
	});
	cursor.on('shape', ({ shape }) => {
		glass.setShape(shape);
		if (cursor.visible && glass.visible) water.drop(cursor.sx, cursor.sy, 12, 0.3);
	});
	cursor.on('down', ({ button, x, y }) => {
		if (!cursor.visible) return;
		if (button === 0) {
			glass.press();
			particles.fall(x, y);
			shoal.startle(x, y, elapsed);
		} else if (button === 2) {
			shoal.callSchool(x, y);
			water.ring(x, y, 20, 12, -0.6);
			particles.ring(x, y, 6, 70, 0.5, 2);
		}
	});
	cursor.on('up', ({ button, x, y }) => {
		if (button === 2) {
			shoal.scatter(x, y);
			water.ring(x, y, 40, 12, -0.5);
			return;
		}
		if (button !== 0) return;
		const popped = orb.release();
		if (!popped || popped.radius < 18) return;
		particles.burst(popped.x, popped.y, popped.radius, popped.strength);
		shoal.burst(popped.x, popped.y);
	});

	// Water leaves the cursor on fast flicks, and all at once when it brakes hard.
	function fling(dt) {
		const speed = cursor.speed;
		const [ax, ay] = glass.accel;
		const ox = cursor.sx + WATER_CENTER[0];
		const oy = cursor.sy + WATER_CENTER[1];
		if (speed > FLICK_SPEED) {
			flickCarry += ((speed - FLICK_SPEED) / 1000) * FLICK_RATE * dt;
			const n = Math.floor(flickCarry);
			flickCarry -= n;
			if (n) particles.fling(ox, oy, cursor.vx, cursor.vy, n);
		}
		const braking = speed > 500 ? -(ax * cursor.vx + ay * cursor.vy) / speed : 0;
		if (braking > STOP_ACCEL && Math.random() < dt * 30) particles.fling(ox, oy, cursor.vx, cursor.vy, 2);
	}

	// The cursor ploughs a shallow trench that spreads into a wake of ripples.
	function wake() {
		const dx = cursor.sx - cursor.prevSX;
		const dy = cursor.sy - cursor.prevSY;
		if (dx === 0 && dy === 0) return;
		const k = Math.min(1, cursor.speed / WAKE_FULL);
		if (k < 0.02) return;
		const ox = WATER_CENTER[0] * 0.5;
		const oy = WATER_CENTER[1] * 0.5;
		water.splat(cursor.prevSX + ox, cursor.prevSY + oy, cursor.sx + ox, cursor.sy + oy, WAKE_RADIUS, -WAKE_DEPTH * k);
	}

	stage.loop((dt, now) => {
		cursor.update(now);
		elapsed += dt;
		const t = elapsed % TIME_WRAP;

		const visible = cursor.visible;
		if (visible) {
			fling(dt);
			wake();
		}
		const held = visible && cursor.down && cursor.held > HOLD_DELAY ? cursor.held - HOLD_DELAY : 0;
		let busy = glass.update(dt, cursor);
		busy = orb.update(dt, t, cursor, held) || busy;
		busy = shoal.update(dt, t, cursor, orb) || busy;
		busy = particles.update(dt) || busy;
		water.update(dt, elapsed);
		busy = water.active || busy;

		// Everything settled and hidden: one clear frame, then leave the GPU alone.
		if (!busy && !drawn) return;
		drawn = busy;
		setFrame(stage.width, stage.height, renderer.getPixelRatio(), t);
		particles.upload();
		water.simulate();
		// Hidden layers draw nothing, so the last frame just clears the canvas.
		if (!busy) for (const mesh of scene.children) mesh.visible = false;
		renderer.render(scene, camera);
	});
}

start();
