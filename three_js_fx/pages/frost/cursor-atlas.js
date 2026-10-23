// Signed distance atlas of the static cursor silhouettes, built once on the
// CPU. Each texel stores the distance to the outline in page px and the unit
// gradient of that distance, so the shader gets bevel normals for free and
// never has to evaluate a polygon per pixel.
import * as THREE from 'three';

export const TILE_PX = 64;       // page px covered by one tile
export const TILE_ORIGIN = 24;   // hotspot offset from the tile's top-left corner, px
const DENSITY = 2;               // texels per page px
const TEXELS = TILE_PX * DENSITY;

// Polygons in page px, hotspot at the origin, y down.
const ARROW = [[0, 0], [0, 25.5], [6.2, 19.6], [10.4, 28.6], [14.6, 26.8], [10.5, 18.0], [18.2, 18.0]];

const HAND = [
	[-1.4, 0], [1.4, 0], [2.6, 1.5], [2.6, 9.4], [3.6, 8.3], [6.6, 8.3], [7.7, 9.9], [8.7, 9.5],
	[11.5, 9.5], [12.6, 11.2], [13.5, 11.2], [15.7, 11.4], [16.7, 13.2], [16.7, 19.6], [15.1, 24.2],
	[14.2, 27.6], [4.6, 27.6], [3.3, 24.4], [-4.6, 17.8], [-5.9, 15.6], [-4.9, 14.0], [-2.6, 14.8], [-2.6, 1.5],
];

// I-beam with icicles hanging from its lower serif.
const BEAM = [
	[-6.4, -13.0], [6.4, -13.0], [6.4, -10.6], [1.5, -10.6], [1.25, 10.4], [5.6, 10.4], [5.6, 12.8],
	[4.1, 12.8], [3.3, 16.2], [2.5, 12.8], [-1.3, 12.8], [-2.3, 17.6], [-3.3, 12.8], [-5.6, 12.8],
	[-5.6, 10.4], [-1.25, 10.4], [-1.5, -10.6], [-6.4, -10.6],
];

const DOUBLE = [
	[-8.5, -1.7], [8.5, -1.7], [8.5, -5.4], [14.2, 0], [8.5, 5.4], [8.5, 1.7],
	[-8.5, 1.7], [-8.5, 5.4], [-14.2, 0], [-8.5, -5.4],
];

function fourWay() {
	const w = 1.7;
	const arm = [[9.2, -w], [9.2, -5.2], [14.6, 0], [9.2, 5.2], [9.2, w], [w, w]];
	const out = [];
	for (let k = 0; k < 4; k++) {
		for (let [x, y] of arm) {
			for (let r = 0; r < k; r++) [x, y] = [-y, x];
			out.push([x, y]);
		}
	}
	return out;
}

function sdPolygon(pts) {
	const n = pts.length;
	return (x, y) => {
		let d = Infinity;
		let inside = false;
		for (let i = 0, j = n - 1; i < n; j = i++) {
			const [xi, yi] = pts[i];
			const [xj, yj] = pts[j];
			const ex = xj - xi;
			const ey = yj - yi;
			const wx = x - xi;
			const wy = y - yi;
			const h = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
			d = Math.min(d, Math.hypot(wx - ex * h, wy - ey * h));
			if ((yi > y) !== (yj > y) && x < xi + ((y - yi) * ex) / ey) inside = !inside;
		}
		return inside ? -d : d;
	};
}

function sdSegment(x, y, ax, ay, bx, by) {
	const px = x - ax;
	const py = y - ay;
	const ex = bx - ax;
	const ey = by - ay;
	const h = Math.min(1, Math.max(0, (px * ex + py * ey) / (ex * ex + ey * ey)));
	return Math.hypot(px - ex * h, py - ey * h);
}

function sdCrosshair(x, y) {
	let qx = Math.abs(x);
	let qy = Math.abs(y);
	if (qy > qx) [qx, qy] = [qy, qx];
	const taper = 1.5 - 0.9 * Math.min(1, Math.max(0, (qx - 4.6) / 9));
	return Math.min(sdSegment(qx, qy, 4.6, 0, 13.5, 0) - taper, Math.hypot(x, y) - 1.6);
}

function sdNotAllowed(x, y) {
	const r = Math.hypot(x, y);
	const ring = Math.abs(r - 9.6) - 2.1;
	const c = Math.SQRT1_2;
	const bx = Math.abs(c * x + c * y) - 9.6;
	const by = Math.abs(-c * x + c * y) - 1.9;
	const box = Math.hypot(Math.max(bx, 0), Math.max(by, 0)) + Math.min(Math.max(bx, by), 0);
	return Math.min(ring, Math.max(box, r - 9.8));
}

// Question mark as a chain of capsules plus its dot, beside the arrow.
const QUESTION = [[-2.7, -2.4], [-1.7, -4.6], [0.5, -5.3], [2.7, -4.0], [2.9, -1.8], [0.4, 0.4], [0.4, 2.2]];

function sdHelp(arrow) {
	return (x, y) => {
		const qx = x - 19.5;
		const qy = y - 23;
		let d = Infinity;
		for (let i = 0; i < QUESTION.length - 1; i++) {
			const [ax, ay] = QUESTION[i];
			const [bx, by] = QUESTION[i + 1];
			d = Math.min(d, sdSegment(qx, qy, ax, ay, bx, by));
		}
		d = Math.min(d - 1.25, Math.hypot(qx - 0.4, qy - 5.4) - 1.45);
		return Math.min(arrow(x, y), d);
	};
}

export const TILE = { arrow: 0, hand: 1, beam: 2, double: 3, move: 4, crosshair: 5, notAllowed: 6, help: 7 };

export function createCursorAtlas() {
	const arrow = sdPolygon(ARROW);
	const fields = [
		arrow, sdPolygon(HAND), sdPolygon(BEAM), sdPolygon(DOUBLE), sdPolygon(fourWay()),
		sdCrosshair, sdNotAllowed, sdHelp(arrow),
	];
	const width = TEXELS * fields.length;
	const data = new Uint16Array(width * TEXELS * 4);
	const half = THREE.DataUtils.toHalfFloat;
	const e = 0.2;
	fields.forEach((sd, tile) => {
		for (let ty = 0; ty < TEXELS; ty++) {
			const y = (ty + 0.5) / DENSITY - TILE_ORIGIN;
			for (let tx = 0; tx < TEXELS; tx++) {
				const x = (tx + 0.5) / DENSITY - TILE_ORIGIN;
				const d = sd(x, y);
				let gx = sd(x + e, y) - sd(x - e, y);
				let gy = sd(x, y + e) - sd(x, y - e);
				const gl = Math.hypot(gx, gy) || 1;
				gx /= gl;
				gy /= gl;
				const o = (ty * width + tile * TEXELS + tx) * 4;
				data[o] = half(Math.min(d, 60));
				data[o + 1] = half(gx);
				data[o + 2] = half(gy);
				data[o + 3] = half(1);
			}
		}
	});
	const tex = new THREE.DataTexture(data, width, TEXELS, THREE.RGBAFormat, THREE.HalfFloatType);
	tex.minFilter = THREE.LinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.generateMipmaps = false;
	tex.flipY = false;
	tex.needsUpdate = true;
	return { texture: tex, tiles: fields.length };
}
