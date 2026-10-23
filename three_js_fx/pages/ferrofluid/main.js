// Ferrofluid: the cursor is a magnet dragging a bead of glossy black ferrofluid.
import '../../shared/preview.js';
import * as THREE from 'three';
import { CursorFeed } from '../../shared/cursor-feed.js';
import { createStage } from '../../shared/stage.js';
import { Ferrofluid } from './fluid.js';
import { FluidView } from './fluid-view.js';
import { Marker } from './marker.js';

const HIDE_SECONDS = 0.12;

const stage = createStage({ antialias: false, maxPixelRatio: 1.5 });
const cursor = new CursorFeed();
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
stage.onResize((w, h) => {
	camera.right = w;
	camera.bottom = h;
	camera.updateProjectionMatrix();
});

const sim = new Ferrofluid();
const fluid = new FluidView(scene);
const marker = new Marker(scene);
let opacity = 0;
let drewSomething = true;

// Compile both programs up front: building the raymarcher on the first visible frame
// would freeze the cursor for a moment right when it appears.
fluid.compile(stage.renderer);
fluid.composite.visible = marker.mesh.visible = true;
stage.renderer.compile(scene, camera);
fluid.composite.visible = marker.mesh.visible = false;
stage.renderer.clear();

cursor.on('show', ({ x, y }) => {
	sim.setShape(cursor.shape);
	sim.reset(x, y);
	marker.snapShape(cursor.shape);
});
cursor.on('shape', ({ shape }) => {
	sim.setShape(shape);
	marker.setShape(shape);
});
cursor.on('down', ({ button }) => sim.onDown(button));
cursor.on('up', ({ button }) => sim.onUp(button));

stage.loop((dt, now) => {
	cursor.update(now);
	if (cursor.visible) opacity += (1 - opacity) * (1 - Math.exp(-dt * 30));
	else opacity = Math.max(0, opacity - dt / HIDE_SECONDS);

	const pixelRatio = stage.renderer.getPixelRatio();
	sim.update(dt, cursor);
	const drawn = fluid.update(sim, opacity, now / 1000, stage.renderer) | marker.update(dt, cursor, opacity, pixelRatio);
	// Once an empty frame has been presented there is nothing to redraw until the cursor returns.
	if (drawn || drewSomething) stage.renderer.render(scene, camera);
	drewSomething = drawn;
});
