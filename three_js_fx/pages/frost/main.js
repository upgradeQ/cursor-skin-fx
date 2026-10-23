// Frost: the cursor freezes the air around it.
import '../../shared/preview.js';
import * as THREE from 'three';
import { CursorFeed } from '../../shared/cursor-feed.js';
import { createStage } from '../../shared/stage.js';
import { Frost } from './frost.js';
import { shared } from './gpu.js';

const stage = createStage({ antialias: false, maxPixelRatio: 1.5 });
const cursor = new CursorFeed();
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);
const frost = new Frost(scene, cursor);

stage.onResize((w, h) => {
	shared.uRes.value.set(w, h);
	shared.uPx.value = 1 / stage.renderer.getPixelRatio();
});

let drawn = false;
stage.loop((dt, now) => {
	cursor.update(now);
	const busy = frost.update(dt);
	// Idle and hidden: draw one last empty frame, then leave the canvas alone.
	if (busy || drawn) stage.renderer.render(scene, camera);
	drawn = busy;
});
