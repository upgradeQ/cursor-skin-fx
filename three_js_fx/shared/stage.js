// Transparent full-window three.js canvas and frame loop for the overlay pages.
import * as THREE from 'three';

export function createStage({ antialias = true, maxPixelRatio = 2 } = {}) {
	const renderer = new THREE.WebGLRenderer({
		antialias,
		alpha: true,
		premultipliedAlpha: true,
		// OBS's browser source (CEF) can composite a buffer the page has not
		// finished drawing; keeping the last frame avoids flashes there.
		preserveDrawingBuffer: true,
		powerPreference: 'high-performance',
	});
	renderer.setClearColor(0x000000, 0);
	renderer.setPixelRatio(Math.min(devicePixelRatio || 1, maxPixelRatio));
	renderer.setSize(innerWidth, innerHeight);

	const canvas = renderer.domElement;
	canvas.style.cssText = 'position:fixed;inset:0;z-index:1;pointer-events:none;';
	document.body.appendChild(canvas);

	const resizeHandlers = new Set();
	const stage = {
		renderer,
		canvas,
		width: innerWidth,
		height: innerHeight,

		// fn(width, height) runs now and on every resize.
		onResize(fn) {
			resizeHandlers.add(fn);
			fn(stage.width, stage.height);
			return () => resizeHandlers.delete(fn);
		},

		// fn(dt seconds, now ms) once per animation frame; dt is clamped to
		// [0, 50 ms] (the first frame's timestamp can predate performance.now()).
		loop(fn) {
			let last = performance.now();
			const frame = (now) => {
				const dt = Math.max(0, Math.min((now - last) / 1000, 0.05));
				last = now;
				fn(dt, now);
				requestAnimationFrame(frame);
			};
			requestAnimationFrame(frame);
		},
	};

	addEventListener('resize', () => {
		stage.width = innerWidth;
		stage.height = innerHeight;
		renderer.setSize(innerWidth, innerHeight);
		for (const fn of resizeHandlers) fn(stage.width, stage.height);
	});

	return stage;
}
