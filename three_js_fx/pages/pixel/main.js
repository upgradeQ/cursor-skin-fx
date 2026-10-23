// Arcade: the desktop becomes a 16-bit arcade. Effects render on a
// low-resolution layer in a strict palette; the cursor sprite rides on top.
import '../../shared/preview.js';
import * as THREE from 'three';
import { CursorFeed } from '../../shared/cursor-feed.js';
import { createStage } from '../../shared/stage.js';
import { PixelLayer } from './layer.js';
import { CursorView } from './cursor.js';
import { Arcade } from './fx.js';

const stage = createStage({ antialias: false, maxPixelRatio: 1 });
const { renderer } = stage;
renderer.autoClear = false;
stage.canvas.style.imageRendering = 'pixelated';

const cursor = new CursorFeed();
const screen = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);
const layer = new PixelLayer();
const view = new CursorView(screen);
const arcade = new Arcade(layer, view);
screen.add(layer.composite);

stage.onResize((w, h) => {
	camera.right = w;
	camera.bottom = h;
	camera.updateProjectionMatrix();
	if (layer.resize(w, h)) arcade.reset();
	view.setScale(layer.scale);
});

view.onSwap = (look) => {
	if (!cursor.visible) return;
	const s = layer.scale;
	const x = cursor.x / s + look.body[0];
	const y = cursor.y / s + look.body[1];
	for (let k = 0; k < 5; k++) {
		const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
		arcade.star(x + Math.cos(a) * 6, y + Math.sin(a) * 6, Math.cos(a) * 70, Math.sin(a) * 70, 0.2, 1);
	}
};

cursor.on('shape', ({ shape }) => view.setShape(shape));
cursor.on('show', () => {
	view.show();
	arcade.show(cursor);
});
cursor.on('hide', () => arcade.hide());
cursor.on('down', ({ button }) => {
	if (!cursor.visible) return;
	if (button === 0) view.press();
	arcade.down(button, cursor);
});
cursor.on('up', ({ button }) => arcade.up(button, cursor));
view.setShape(cursor.shape);

let drewLast = true;
stage.loop((dt, now) => {
	cursor.update(now);
	view.update(dt, cursor);
	arcade.update(dt, cursor);
	const fx = layer.render(renderer);
	const any = fx || view.visible;
	// Once everything has decayed, one transparent frame and then nothing.
	if (!any && !drewLast) return;
	drewLast = any;
	renderer.setRenderTarget(null);
	renderer.clear();
	if (any) renderer.render(screen, camera);
});
