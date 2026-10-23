// Signed distance atlas of the cursor silhouettes, built once on the CPU;
// shared/gl-layers.js turns it into a texture and samples it in GLSL. Each
// texel stores the distance to the outline in page px (negative inside) and
// the unit gradient of that distance, so shaders get bevel normals, outlines,
// glows and shadows from one texture fetch. Two fields mixed by a factor
// morph one silhouette into another.
//
// Tiles sit side by side in one row. Each covers TILE_PX page px with the
// hotspot TILE_ORIGIN px in from its top-left corner; outside a tile the
// distance keeps growing, so a field can be sampled anywhere.

export const TILE_PX = 64;
export const TILE_ORIGIN = 24;
const DENSITY = 2;               // texels per page px
const TEXELS = TILE_PX * DENSITY;
const FAR = 60;                  // distances are clamped to this, px

// Polygons in page px, hotspot at the origin, y down.
const ARROW = [[0, 0], [0, 25.5], [6.2, 19.6], [10.4, 28.6], [14.6, 26.8], [10.5, 18.0], [18.2, 18.0]];

const HAND = [
	[-1.4, 0], [1.4, 0], [2.6, 1.5], [2.6, 9.4], [3.6, 8.3], [6.6, 8.3], [7.7, 9.9], [8.7, 9.5],
	[11.5, 9.5], [12.6, 11.2], [13.5, 11.2], [15.7, 11.4], [16.7, 13.2], [16.7, 19.6], [15.1, 24.2],
	[14.2, 27.6], [4.6, 27.6], [3.3, 24.4], [-4.6, 17.8], [-5.9, 15.6], [-4.9, 14.0], [-2.6, 14.8], [-2.6, 1.5],
];

const BEAM = [
	[-6.4, -13.0], [6.4, -13.0], [6.4, -10.6], [1.5, -10.6], [1.5, 10.6], [6.4, 10.6], [6.4, 13.0],
	[-6.4, 13.0], [-6.4, 10.6], [-1.5, 10.6], [-1.5, -10.6], [-6.4, -10.6],
];

const DOUBLE = [
	[-8.5, -1.7], [8.5, -1.7], [8.5, -5.4], [14.2, 0], [8.5, 5.4], [8.5, 1.7],
	[-8.5, 1.7], [-8.5, 5.4], [-14.2, 0], [-8.5, -5.4],
];

// Question mark as a chain of capsules plus its dot, placed beside the arrow.
const QUESTION = [[-2.7, -2.4], [-1.7, -4.6], [0.5, -5.3], [2.7, -4.0], [2.9, -1.8], [0.4, 0.4], [0.4, 2.2]];

// Busy ring centred on the hotspot, and the small one that rides beside the
// arrow while an app is working in the background.
const RING = { x: 0, y: 0, r: 11, w: 3.2 };
const MINI_RING = { x: 25, y: 30, r: 6, w: 2 };

export const TILE = {
	arrow: 0, hand: 1, beam: 2, double: 3, move: 4, crosshair: 5, notAllowed: 6, help: 7, ring: 8, progress: 9,
};
export const TILE_COUNT = Object.keys(TILE).length;

// System cursor (CSS keyword) -> tile and rotation (radians, y down). The ring
// tiles are there to be animated: the wait cursor has no arrow at all.
const SHAPE_TILES = {
	default: { tile: TILE.arrow, angle: 0 },
	pointer: { tile: TILE.hand, angle: 0 },
	text: { tile: TILE.beam, angle: 0 },
	wait: { tile: TILE.ring, angle: 0 },
	progress: { tile: TILE.progress, angle: 0 },
	crosshair: { tile: TILE.crosshair, angle: 0 },
	move: { tile: TILE.move, angle: 0 },
	help: { tile: TILE.help, angle: 0 },
	'not-allowed': { tile: TILE.notAllowed, angle: 0 },
	'ew-resize': { tile: TILE.double, angle: 0 },
	'ns-resize': { tile: TILE.double, angle: Math.PI / 2 },
	'nwse-resize': { tile: TILE.double, angle: Math.PI / 4 },
	'nesw-resize': { tile: TILE.double, angle: -Math.PI / 4 },
};

export function shapeTile(shape) {
	return SHAPE_TILES[shape] ?? SHAPE_TILES.default;
}

function sdPolygon(pts) {
	const n = pts.length;
	const xs = Float64Array.from(pts, (p) => p[0]);
	const ys = Float64Array.from(pts, (p) => p[1]);
	return (x, y) => {
		let d2 = Infinity;
		let inside = false;
		for (let i = 0, j = n - 1; i < n; j = i++) {
			const xi = xs[i];
			const yi = ys[i];
			const ex = xs[j] - xi;
			const ey = ys[j] - yi;
			const wx = x - xi;
			const wy = y - yi;
			const h = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
			const qx = wx - ex * h;
			const qy = wy - ey * h;
			d2 = Math.min(d2, qx * qx + qy * qy);
			if ((yi > y) !== (ys[j] > y) && x < xi + ((y - yi) * ex) / ey) inside = !inside;
		}
		const d = Math.sqrt(d2);
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

const sdRing = ({ x: cx, y: cy, r, w }) => (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r) - w;

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

// float32 -> IEEE half, round to nearest.
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
	f32[0] = v;
	const x = u32[0];
	const sign = (x >>> 16) & 0x8000;
	const e = ((x >>> 23) & 0xff) - 112;
	const m = x & 0x7fffff;
	if (e <= 0) return e < -10 ? sign : sign | (((m | 0x800000) >> (1 - e)) + 0x1000) >> 13;
	if (e >= 31) return sign | 0x7c00;
	return (sign | (e << 10) | (m >> 13)) + ((m >> 12) & 1);
}

// rgba16float texels: distance, gradient x, gradient y, 1.
export function buildCursorAtlas() {
	const arrow = sdPolygon(ARROW);
	const ring = sdRing(RING);
	const mini = sdRing(MINI_RING);
	const fields = [];
	fields[TILE.arrow] = arrow;
	fields[TILE.hand] = sdPolygon(HAND);
	fields[TILE.beam] = sdPolygon(BEAM);
	fields[TILE.double] = sdPolygon(DOUBLE);
	fields[TILE.move] = sdPolygon(fourWay());
	fields[TILE.crosshair] = sdCrosshair;
	fields[TILE.notAllowed] = sdNotAllowed;
	fields[TILE.help] = sdHelp(arrow);
	fields[TILE.ring] = ring;
	fields[TILE.progress] = (x, y) => Math.min(arrow(x, y), mini(x, y));

	const width = TEXELS * TILE_COUNT;
	const data = new Uint16Array(width * TEXELS * 4);
	const field = new Float32Array(TEXELS * TEXELS);
	fields.forEach((sd, tile) => {
		for (let ty = 0; ty < TEXELS; ty++) {
			const y = (ty + 0.5) / DENSITY - TILE_ORIGIN;
			for (let tx = 0; tx < TEXELS; tx++) field[ty * TEXELS + tx] = sd((tx + 0.5) / DENSITY - TILE_ORIGIN, y);
		}
		// Gradient by central differences over the grid (one-sided at the tile edges).
		for (let ty = 0; ty < TEXELS; ty++) {
			const y0 = Math.max(0, ty - 1) * TEXELS;
			const y1 = Math.min(TEXELS - 1, ty + 1) * TEXELS;
			for (let tx = 0; tx < TEXELS; tx++) {
				const x0 = Math.max(0, tx - 1);
				const x1 = Math.min(TEXELS - 1, tx + 1);
				let gx = field[ty * TEXELS + x1] - field[ty * TEXELS + x0];
				let gy = field[y1 + tx] - field[y0 + tx];
				const gl = Math.sqrt(gx * gx + gy * gy) || 1;
				gx /= gl;
				gy /= gl;
				const o = (ty * width + tile * TEXELS + tx) * 4;
				data[o] = toHalf(Math.min(field[ty * TEXELS + tx], FAR));
				data[o + 1] = toHalf(gx);
				data[o + 2] = toHalf(gy);
				data[o + 3] = 0x3c00; // 1.0
			}
		}
	});
	return { data, width, height: TEXELS };
}
