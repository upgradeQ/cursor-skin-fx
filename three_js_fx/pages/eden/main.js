// Eden — the cursor is a sliver of glass looking onto a Bliss-green hill under
// a blue sky. Motion draws Vista aurora swooshes with sparkle dust and the odd
// leaf, fast flicks scatter leaves and petals under an anamorphic streak,
// clicks bloom into petals under a sun flare, holding grows a ray-traced glass
// orb with a tiny world inside that floats off into butterflies, and the right
// button fans out god rays inside a ring of swirling aurora. Left idle, the
// glass breathes, a gloss sweeps across it and a butterfly comes to rest.
import '../../shared/preview.js';
import * as THREE from 'three';
import { CursorFeed } from '../../shared/cursor-feed.js';
import { createStage } from '../../shared/stage.js';
import { compileLayers } from '../../shared/gl-layers.js';
import { setFrame } from './gl.js';
import { GlassCursor } from './glass-cursor.js';
import { Orbs } from './orb.js';
import { Aurora, Trail } from './aurora.js';
import { Sprites } from './sprites.js';
import { Sunburst } from './sunburst.js';
import { BusyLeaves, IdleButterfly } from './nature.js';
import * as burst from './bursts.js';

const HOLD_DELAY = 0.16;       // s before a held button starts growing the orb
const FLICK_SPEED = 1200;      // px/s
const FLICK_COOLDOWN = 0.3;    // s between anamorphic streaks
const DUST_EVERY = 18;         // px of travel per sparkle of dust
const LEAF_EVERY = 260;        // px of travel per leaf twirling off the trail

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
	const sprites = new Sprites(scene);
	const aurora = new Aurora(scene);
	const trail = new Trail();
	const orbs = new Orbs(scene, sprites);
	const glass = new GlassCursor(scene);
	const sunburst = new Sunburst();
	const butterfly = new IdleButterfly();
	const busyLeaves = new BusyLeaves();
	// Compile every program up front, so the first frames do not stall and
	// the demo autopilot starts in step with them.
	await compileLayers(renderer, scene, camera);
	host.appendChild(canvas);
	const cursor = new CursorFeed();

	let time = 0;
	let drawn = false;
	let dustTravel = 0;
	let leafTravel = 0;
	let lastStreak = -Infinity;
	let wasFast = false;

	// A resize clears the canvas: draw at least once more.
	stage.onResize(() => {
		drawn = true;
	});

	cursor.on('show', ({ x, y }) => {
		glass.snap(cursor.shape);
		trail.cut();
		orbs.snap(x, y);
		burst.twinkle(sprites, x, y);
	});

	cursor.on('shape', ({ shape }) => {
		glass.setShape(shape);
		if (cursor.visible) burst.shapePop(sprites, cursor.sx, cursor.sy);
	});

	cursor.on('down', ({ button }) => {
		if (!cursor.visible) return;
		const x = cursor.sx;
		const y = cursor.sy;
		if (button === 0) {
			glass.press(true);
			if (cursor.shape === 'pointer') {
				burst.sunFlare(sprites, x, y, 1.1);
				burst.bloom(sprites, x, y, { gold: true, petals: 14 });
			} else if (cursor.shape === 'text') {
				burst.caretSplash(sprites, x, y);
			} else {
				burst.sunFlare(sprites, x, y, 1);
				burst.bloom(sprites, x, y);
			}
		} else if (button === 2) {
			sunburst.press();
		}
	});

	cursor.on('up', ({ button }) => {
		if (button === 0) {
			glass.press(false);
			orbs.release();
		} else if (button === 2) {
			sunburst.release(sprites, cursor.sx, cursor.sy);
		}
	});

	// Dust and leaves shed along the path, leaves and petals off fast flicks.
	function motion(dt) {
		const x0 = cursor.prevSX;
		const y0 = cursor.prevSY;
		const dx = cursor.sx - x0;
		const dy = cursor.sy - y0;
		const moved = Math.hypot(dx, dy);
		if (moved > 0 && moved < 400) {
			let along = DUST_EVERY - dustTravel;
			dustTravel += moved;
			while (dustTravel >= DUST_EVERY) {
				const f = Math.min(1, along / moved);
				burst.dust(sprites, x0 + dx * f, y0 + dy * f, cursor.vx, cursor.vy);
				dustTravel -= DUST_EVERY;
				along += DUST_EVERY;
			}
			leafTravel += moved;
			if (leafTravel > LEAF_EVERY) {
				leafTravel = 0;
				burst.trailLeaf(sprites, cursor.sx, cursor.sy, cursor.vx, cursor.vy);
			}
		}
		const fast = cursor.speed > FLICK_SPEED && !sunburst.on && !orbs.holding;
		if (fast) {
			burst.flickScatter(sprites, cursor.sx, cursor.sy, cursor.vx, cursor.vy, dt);
			if (!wasFast && time - lastStreak > FLICK_COOLDOWN) {
				burst.streakFlare(sprites, cursor.sx, cursor.sy);
				lastStreak = time;
			}
		}
		wasFast = fast;
	}

	stage.loop((dt, now) => {
		cursor.update(now);
		time += dt;
		const visible = cursor.visible;
		if (visible) motion(dt);

		const holding = visible && cursor.down && cursor.held > HOLD_DELAY;
		aurora.begin();
		trail.record(time, cursor);
		let busy = trail.build(aurora, time, 1);
		busy = sunburst.update(dt, time, cursor, sprites, aurora) || busy;
		busy = orbs.update(dt, time, cursor, holding, cursor.held - HOLD_DELAY) || busy;
		busy = glass.update(dt, time, cursor, stage.width, stage.height) || busy;
		const calm = cursor.shape === 'default' && !orbs.holding && !sunburst.on && !cursor.buttons;
		busy = butterfly.update(dt, time, cursor, sprites, calm) || busy;
		busy = busyLeaves.update(dt, time, cursor, sprites, visible && cursor.shape === 'wait', glass.alpha) || busy;
		busy = sprites.update(dt) || busy;

		// Nothing left on screen: clear once, then stop submitting work.
		if (!busy && !drawn) return;
		drawn = busy;

		setFrame(stage.width, stage.height, renderer.getPixelRatio(), time);
		sprites.upload();
		aurora.upload();
		renderer.render(scene, camera);
	});
}

start();
