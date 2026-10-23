// Voltage — the cursor is a live conductor. Motion leaves an ionised trail
// that forks on fast flicks, clicks call lightning down from the top of the
// screen, holding charges a plasma globe that discharges on release, and the
// right button strings chain lightning between points around the cursor.
import '../../shared/preview.js';
import * as THREE from 'three';
import { CursorFeed } from '../../shared/cursor-feed.js';
import { createStage } from '../../shared/stage.js';
import { Ribbons, forkedBolt, jagged, rand } from './bolts.js';
import { Glows } from './glow.js';
import { Sparks } from './sparks.js';
import { VoltCursor } from './cursor.js';
import { Arcs, Chain, Flashes, Plasma, Rings } from './storm.js';

const HOLD_DELAY = 0.16;     // s before a held button starts charging
const TRAIL_MS = 110;        // ms of path the ionised trail covers

const stage = createStage({ maxPixelRatio: 1.5 });
const { renderer } = stage;
const cursor = new CursorFeed();
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
stage.onResize((w, h) => {
	camera.right = w;
	camera.bottom = h;
	camera.updateProjectionMatrix();
});

const ribbons = new Ribbons(scene);
const glows = new Glows(scene);
const volt = new VoltCursor(scene);
const fx = {
	ribbons, glows,
	sparks: new Sparks(),
	arcs: new Arcs(),
	rings: new Rings(),
	flashes: new Flashes(),
};
const plasma = new Plasma();
const chain = new Chain();

let elapsed = 0;
let drawn = false;

cursor.on('show', ({ x, y }) => {
	volt.snapShape(cursor.shape);
	fx.flashes.spawn(elapsed, x, y, 50, 0.9, { life: 0.2 });
});
cursor.on('shape', ({ shape }) => {
	volt.setShape(shape);
	if (!cursor.visible) return;
	fx.sparks.burst(elapsed, cursor.x, cursor.y, 8, 380, { life: 0.4 });
	fx.flashes.spawn(elapsed, cursor.x, cursor.y, 40, 0.8, { life: 0.15, hue: 0.3 });
});

cursor.on('down', ({ button, x, y }) => {
	if (!cursor.visible) return;
	if (button === 0) strike(x, y);
	else if (button === 2) chain.press(elapsed, x, y, fx);
});

cursor.on('up', ({ button, x, y }) => {
	if (button === 2) chain.release(elapsed, fx);
	if (button !== 0 || !cursor.visible) return;
	if (plasma.charge > 0.25) discharge(x, y, plasma.charge);
});

// Lightning out of the top of the screen onto the hotspot.
function strike(x, y) {
	const sx = x + rand(-240, 240);
	fx.arcs.spawn(elapsed, sx, -40, x, y, { rough: 0.18, forks: 5, depth: 2, width: 30, core: 3.2, intensity: 1.3 }, { life: 0.4, every: 0.05, glow: 0 });
	fx.flashes.spawn(elapsed, x, y, 170, 1.3, { life: 0.3, hue: 0.2 });
	fx.flashes.spawn(elapsed, x, y, Math.max(innerWidth, innerHeight) * 0.9, 0.16, { life: 0.22, hue: 0.25, core: 0 });
	fx.rings.spawn(elapsed, x, y, 8, 120, { life: 0.35 });
	fx.sparks.burst(elapsed, x, y, 36, 900, { angle: -Math.PI / 2, spread: 1.3, life: 0.8 });
}

// Letting go of a charged globe: the charge earths itself in every direction.
function discharge(x, y, c) {
	const n = Math.round(5 + 8 * c);
	const turn = Math.random() * Math.PI * 2;
	for (let i = 0; i < n; i++) {
		const a = turn + (i / n) * Math.PI * 2 + rand(-0.25, 0.25);
		const d = rand(180, 260 + 300 * c);
		const bx = x + Math.cos(a) * d, by = y + Math.sin(a) * d;
		fx.arcs.spawn(elapsed, x, y, bx, by, { rough: 0.2, forks: 3, depth: 2, width: 24, core: 2.6, intensity: 1.2 }, { life: rand(0.3, 0.5), every: 0.045, hue: 0.4, glow: 40 });
		fx.sparks.burst(elapsed, bx, by, 6, 500, { life: 0.6 });
	}
	fx.flashes.spawn(elapsed, x, y, 220 + 120 * c, 1.6, { life: 0.4, hue: 0.4 });
	fx.flashes.spawn(elapsed, x, y, Math.max(innerWidth, innerHeight), 0.22 * c, { life: 0.3, hue: 0.4, core: 0 });
	fx.rings.spawn(elapsed, x, y, 20, 160 + 140 * c, { life: 0.45, width: 18 });
	fx.rings.spawn(elapsed, x, y, 10, 90 + 60 * c, { life: 0.3, width: 12 });
	fx.sparks.burst(elapsed, x, y, Math.round(30 + 50 * c), 1100, { spread: Math.PI, life: 0.9 });
}

// The ionised path behind a moving cursor, newest point first so the old end
// fades out; fast flicks tear side arcs off it.
function trail(dt, now) {
	const speed = cursor.speed;
	if (speed < 200) return;
	const pts = [cursor.x, cursor.y];
	const h = cursor.history;
	for (let i = h.length - 1; i >= 0 && now - h[i].t < TRAIL_MS; i--) {
		if (h[i].x !== pts[pts.length - 2] || h[i].y !== pts[pts.length - 1]) pts.push(h[i].x, h[i].y);
	}
	if (pts.length < 4) return;
	const amp = Math.min(7, speed / 350);
	const path = [pts[0], pts[1]];
	for (let i = 2; i < pts.length; i += 2) {
		const seg = jagged(pts[i - 2], pts[i - 1], pts[i], pts[i + 1], 0, 9);
		for (let k = 2; k < seg.length; k += 2) path.push(seg[k] + rand(-amp, amp), seg[k + 1] + rand(-amp, amp));
	}
	const k = Math.min(1, (speed - 200) / 2000);
	ribbons.add(path, 12 + 6 * k, 1.2 + k, 0.9 * k, { taper: 1, hue: 0.2 });

	if (speed > 1300 && Math.random() < Math.min(1, ((speed - 1300) / 2500) * dt * 40)) {
		const back = Math.atan2(-cursor.vy, -cursor.vx) + rand(-1.1, 1.1);
		const l = rand(40, 110);
		const i = Math.floor(rand(0, path.length / 2)) * 2;
		const ax = path[i], ay = path[i + 1];
		fx.arcs.spawn(elapsed, ax, ay, ax + Math.cos(back) * l, ay + Math.sin(back) * l, { rough: 0.3, forks: 1, depth: 1, width: 12, core: 1.3, intensity: 0.9 }, { life: 0.12, every: 0.04, hue: 0.3 });
	}
	if (speed > 1800 && Math.random() < dt * 20) {
		fx.sparks.burst(elapsed, cursor.x, cursor.y, 2, 400, { angle: Math.atan2(-cursor.vy, -cursor.vx), spread: 0.8, life: 0.4 });
	}
}

// Build the shaders before the first visible frame.
ribbons.add(forkedBolt(0, 0, 10, 10)[0].pts, 4, 1, 1);
glows.add(0, 0, 1, 1);
ribbons.end();
glows.end();
renderer.compile(scene, camera);

stage.loop((dt, now) => {
	cursor.update(now);
	elapsed += dt;
	ribbons.begin();
	glows.begin();

	const holding = cursor.visible && cursor.down && cursor.held > HOLD_DELAY;
	let busy = plasma.update(dt, elapsed, cursor, holding, cursor.held - HOLD_DELAY, fx);
	volt.charge = plasma.charge;
	busy = chain.update(dt, elapsed, cursor, fx) || busy;
	if (cursor.visible) trail(dt, now);
	busy = fx.arcs.update(elapsed, ribbons, glows) || busy;
	busy = fx.rings.update(elapsed, ribbons) || busy;
	busy = fx.flashes.update(elapsed, glows) || busy;
	busy = fx.sparks.update(dt, elapsed, ribbons, glows) || busy;
	busy = volt.update(dt, elapsed, cursor, ribbons, glows) || busy;

	ribbons.end();
	glows.end();
	// Idle and hidden: draw one last empty frame, then leave the canvas alone.
	if (busy || drawn) renderer.render(scene, camera);
	drawn = busy;
});
