// Pixel art for the page: cursor sprites, particle sprites and a 5x7 bitmap
// font, authored as strings (or drawn procedurally) and packed into one RGBA
// atlas. The atlas alpha carries each pixel's role so shaders can recolour it:
//   255 literal colour, 180 outline (ink), 120 tint light, 60 tint dark.
import * as THREE from 'three';
import {
	RGB, INK, PLUM, BERRY, PINK, RED, ORANGE, GOLD, LEMON, LIME, TEAL, CYAN, SKY, BLUE, NAVY,
	WHITE, FROST, STEEL, SLATE, CREAM, RUST,
} from './palette.js';

const EMPTY = -1;
const OUTLINE = 100;
const LIGHT = 101;
const DARK = 102;

export const ATLAS_SIZE = 256;

const CHARS = {
	X: OUTLINE, W: WHITE, F: FROST, S: STEEL, L: SLATE, C: CYAN, K: SKY, B: BLUE, N: NAVY,
	P: PINK, E: BERRY, R: RED, O: ORANGE, G: GOLD, Y: LEMON, I: LIME, T: TEAL, M: PLUM,
	Q: CREAM, U: RUST, a: LIGHT, b: DARK,
};

function blank(w, h) {
	return { w, h, px: new Int16Array(w * h).fill(EMPTY) };
}

// Rows separated by whitespace; '.' (or any unmapped char) is empty.
function parse(text, map = CHARS) {
	const rows = text.trim().split(/\s+/);
	const s = blank(Math.max(...rows.map((r) => r.length)), rows.length);
	rows.forEach((row, y) => {
		for (let x = 0; x < row.length; x++) {
			const c = map[row[x]];
			if (c !== undefined) s.px[y * s.w + x] = c;
		}
	});
	return s;
}

const at = (s, x, y) => (x < 0 || y < 0 || x >= s.w || y >= s.h ? EMPTY : s.px[y * s.w + x]);

function touches(s, x, y) {
	for (let dy = -1; dy <= 1; dy++) {
		for (let dx = -1; dx <= 1; dx++) {
			if ((dx || dy) && at(s, x + dx, y + dy) !== EMPTY) return true;
		}
	}
	return false;
}

// Grows the sprite by one pixel on each side and rings it with ink.
function outlined(s) {
	const o = blank(s.w + 2, s.h + 2);
	for (let y = 0; y < s.h; y++) {
		for (let x = 0; x < s.w; x++) o.px[(y + 1) * o.w + x + 1] = s.px[y * s.w + x];
	}
	return inked(o);
}

// Turns empty pixels that touch filled ones into ink, in place.
function inked(s) {
	const src = { ...s, px: s.px.slice() };
	for (let y = 0; y < s.h; y++) {
		for (let x = 0; x < s.w; x++) {
			if (at(src, x, y) === EMPTY && touches(src, x, y)) s.px[y * s.w + x] = OUTLINE;
		}
	}
	return s;
}

function transposed(s) {
	const o = blank(s.h, s.w);
	for (let y = 0; y < s.h; y++) {
		for (let x = 0; x < s.w; x++) o.px[x * o.w + y] = s.px[y * s.w + x];
	}
	return o;
}

function mirrored(s) {
	const o = blank(s.w, s.h);
	for (let y = 0; y < s.h; y++) {
		for (let x = 0; x < s.w; x++) o.px[y * s.w + (s.w - 1 - x)] = s.px[y * s.w + x];
	}
	return o;
}

// ---- cursor sprites -------------------------------------------------------

const ARROW = parse(`
	X.........
	XX........
	XWX.......
	XWWX......
	XWWWX.....
	XWWWCX....
	XWWWWCX...
	XWWWWWCX..
	XWWWFFFCX.
	XWWFFXXXXX
	XWFXFFX...
	XFX.XFKX..
	XX..XFKX..
	X....XFKX.
	.....XKKX.
	......XX..
`);

const GLOVE = parse(`
	....XX.......
	...XWWX......
	...XWWX......
	...XWWX......
	...XWWXXXXX..
	.XXXWWXWWXWX.
	XWWXWWXWWXWWX
	XWWXWWWWWWWWX
	XWWWWWWWWWWWX
	.XWWWWWWWWWFX
	.XFWWWWWWWWFX
	..XFWWWWWWFX.
	..XXFFFFFFXX.
	..XPPPPPPPPX.
	..XEEEEEEEEX.
	..XXXXXXXXXX.
`);

const IBEAM = parse(`
	XXX.XXX
	XWWXWWX
	.XXWXX.
	..XWX..
	..XWX..
	..XWX..
	..XWX..
	..XWX..
	..XWX..
	..XWX..
	..XWX..
	..XWX..
	.XXWXX.
	XWWXWWX
	XXX.XXX
`);

const MOVE = outlined(parse(`
	.......W.......
	......WWW......
	.....WWWWW.....
	.......W.......
	.......W.......
	..W....W....W..
	.WW....W....WW.
	WWWWWWWWWWWWWWW
	.WW....W....WW.
	..W....W....W..
	.......W.......
	.......W.......
	.....WWWWW.....
	......WWW......
	.......W.......
`));

const EW = outlined(parse(`
	..W.......W..
	.WW.......WW.
	WWWWWWWWWWWWW
	.WW.......WW.
	..W.......W..
`));

const NWSE = outlined(parse(`
	WWWWW......
	WWWW.......
	WWW........
	WW.W.......
	W...W......
	.....W.....
	......W...W
	.......W.WW
	........WWW
	.......WWWW
	......WWWWW
`));

function reticle() {
	const n = 13;
	const c = 6;
	const s = blank(n, n);
	for (let y = 0; y < n; y++) {
		for (let x = 0; x < n; x++) {
			const dx = x - c;
			const dy = y - c;
			const d = Math.hypot(dx, dy);
			let col = EMPTY;
			if (Math.abs(d - 5) < 0.55 && Math.min(Math.abs(dx), Math.abs(dy)) > 1) col = RED;
			if ((dx === 0 && Math.abs(dy) >= 3) || (dy === 0 && Math.abs(dx) >= 3)) col = WHITE;
			if (dx === 0 && dy === 0) col = RED;
			s.px[y * n + x] = col;
		}
	}
	return outlined(s);
}

function noEntry() {
	const n = 13;
	const c = 6;
	const s = blank(n, n);
	for (let y = 0; y < n; y++) {
		for (let x = 0; x < n; x++) {
			const dx = x - c;
			const dy = y - c;
			const d = Math.hypot(dx, dy);
			const ring = d <= 6.2 && d >= 4.4;
			const slash = d < 4.6 && Math.abs(dx - dy) <= 0.5;
			if (ring || slash) s.px[y * n + x] = d > 5.6 && dy > 1 ? BERRY : RED;
		}
	}
	return outlined(s);
}

// A coin seen from `turn` of a half revolution (0..1), ink-outlined in place.
function coin(size, turn) {
	const s = blank(size, size);
	const mid = size / 2;
	const r = mid - 1;
	const c = Math.cos(turn * Math.PI);
	const a = r * Math.abs(c);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const ox = x + 0.5 - mid;
			const dy = (y + 0.5 - mid) / r;
			let inside;
			let dx = 0;
			if (a < 1) {
				inside = Math.abs(ox) < 1 && Math.abs(dy) < 0.92;
			} else {
				dx = ox / a;
				inside = dx * dx + dy * dy <= 1.02;
			}
			if (!inside) continue;
			let col = GOLD;
			if (a < 1.6) col = Math.abs(dy) < 0.5 ? ORANGE : RUST;
			else if (dx < -0.45 && dy < 0.5) col = LEMON;
			else if (dx > 0.5 || dy > 0.7) col = ORANGE;
			if (a >= 2.5 && Math.abs(dy) < 0.5 && size > 9) {
				if (Math.floor(ox) === -1) col = c > 0 ? LEMON : ORANGE;
				if (Math.floor(ox) === 0) col = c > 0 ? RUST : LEMON;
			}
			if (a >= 1.6 && dx < -0.3 && dy < -0.3 && dx * dx + dy * dy > 0.55) col = WHITE;
			s.px[y * size + x] = col;
		}
	}
	return inked(s);
}

// ---- particle sprites (tinted: a = light colour, b = dark colour) ------------

const STARS = [
	`.a. aWa .a.`,
	`..b.. ..a.. baWab ..a.. ..b..`,
	`...b... ...a... ..bab.. baaWaab ..bab.. ...a... ...b...`,
];

const DEBRIS = [
	`aa. aab .bb`,
	`ab bb`,
	`.aa. aaab abbb`,
	`aab .bb`,
];

const CONFETTI = [
	`... aaa ...`,
	`..a .a. a..`,
	`.b. .b. .b.`,
	`b.. .b. ..b`,
];

// ---- 5x7 font -------------------------------------------------------------

const FONT = {
	'0': '.###. #...# #..## #.#.# ##..# #...# .###.',
	'1': '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
	'2': '.###. #...# ....# ..##. .#... #.... #####',
	'3': '##### ...#. ..#.. ...#. ....# #...# .###.',
	'4': '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
	'5': '##### #.... ####. ....# ....# #...# .###.',
	'6': '..##. .#... #.... ####. #...# #...# .###.',
	'7': '##### ....# ...#. ..#.. .#... .#... .#...',
	'8': '.###. #...# #...# .###. #...# #...# .###.',
	'9': '.###. #...# #...# .#### ....# ...#. .##..',
	'+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
	'x': '..... ..... #...# .#.#. ..#.. .#.#. #...#',
	'!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..',
	'?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
	'A': '.###. #...# #...# ##### #...# #...# #...#',
	'B': '####. #...# #...# ####. #...# #...# ####.',
	'C': '.###. #...# #.... #.... #.... #...# .###.',
	'D': '####. #...# #...# #...# #...# #...# ####.',
	'E': '##### #.... #.... ####. #.... #.... #####',
	'F': '##### #.... #.... ####. #.... #.... #....',
	'G': '.###. #...# #.... #.### #...# #...# .####',
	'H': '#...# #...# #...# ##### #...# #...# #...#',
	'I': '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
	'J': '..### ...#. ...#. ...#. ...#. #..#. .##..',
	'K': '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
	'L': '#.... #.... #.... #.... #.... #.... #####',
	'M': '#...# ##.## #.#.# #.#.# #...# #...# #...#',
	'N': '#...# #...# ##..# #.#.# #..## #...# #...#',
	'O': '.###. #...# #...# #...# #...# #...# .###.',
	'P': '####. #...# #...# ####. #.... #.... #....',
	'Q': '.###. #...# #...# #...# #.#.# #..#. .##.#',
	'R': '####. #...# #...# ####. #.#.. #..#. #...#',
	'S': '.#### #.... #.... .###. ....# ....# ####.',
	'T': '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
	'U': '#...# #...# #...# #...# #...# #...# .###.',
	'V': '#...# #...# #...# #...# #...# .#.#. ..#..',
	'W': '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
	'X': '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
	'Y': '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
	'Z': '##### ....# ...#. ..#.. .#... #.... #####',
};
export const GLYPH_W = 5;
export const GLYPH_H = 7;

// ---- atlas ----------------------------------------------------------------

const ROLE_ALPHA = { [OUTLINE]: 180, [LIGHT]: 120, [DARK]: 60 };
const INK_RGB = RGB[INK];

class AtlasBuilder {
	constructor() {
		this.data = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
		this.x = 1;
		this.y = 1;
		this.row = 0;
		this.entries = [];
		this.names = new Map();
	}

	add(name, s, hx = 0, hy = 0) {
		if (this.x + s.w + 1 > ATLAS_SIZE) {
			this.x = 1;
			this.y += this.row + 1;
			this.row = 0;
		}
		if (this.y + s.h + 1 > ATLAS_SIZE) throw new Error('pixel atlas is full');
		const e = {
			name, id: this.entries.length, x: this.x, y: this.y, w: s.w, h: s.h, hx, hy,
			cell: this.x + this.y * 256, ext: s.w + s.h * 256,
		};
		for (let y = 0; y < s.h; y++) {
			for (let x = 0; x < s.w; x++) {
				const v = s.px[y * s.w + x];
				if (v === EMPTY) continue;
				const o = ((e.y + y) * ATLAS_SIZE + e.x + x) * 4;
				const rgb = v === OUTLINE ? INK_RGB : v >= 100 ? [255, 255, 255] : RGB[v];
				this.data[o] = rgb[0];
				this.data[o + 1] = rgb[1];
				this.data[o + 2] = rgb[2];
				this.data[o + 3] = ROLE_ALPHA[v] ?? 255;
			}
		}
		this.x += s.w + 1;
		this.row = Math.max(this.row, s.h);
		this.entries.push(e);
		this.names.set(name, e);
		return e;
	}

	frames(name, sprites, hx, hy) {
		sprites.forEach((s, i) => this.add(name + i, s, hx, hy));
	}
}

function build() {
	const b = new AtlasBuilder();

	b.add('arrow', ARROW, 0, 0);
	b.add('glove', GLOVE, 5, 0);
	b.add('ibeam', IBEAM, 3.5, 7.5);
	b.add('move', MOVE, 8.5, 8.5);
	b.add('ew', EW, 7.5, 3.5);
	b.add('ns', transposed(EW), 3.5, 7.5);
	b.add('nwse', NWSE, 6.5, 6.5);
	b.add('nesw', mirrored(NWSE), 6.5, 6.5);
	b.add('reticle', reticle(), 7.5, 7.5);
	b.add('noentry', noEntry(), 7.5, 7.5);
	b.frames('coin', Array.from({ length: 8 }, (_, i) => coin(14, i / 8)), 7, 7);
	b.frames('minicoin', [0, 0.3, 0.5, 0.7].map((t) => coin(8, t)), 4, 4);
	b.add('qmark', outlined(parse(FONT['?'], { '#': GOLD })), 0, 0);

	b.frames('star', STARS.map((s) => parse(s)));
	b.frames('debris', DEBRIS.map((s) => parse(s)));
	b.frames('confetti', CONFETTI.map((s) => parse(s)));

	const glyphs = new Map();
	for (const [ch, rows] of Object.entries(FONT)) glyphs.set(ch, b.add('glyph' + ch, parse(rows, { '#': LIGHT })));

	const texture = new THREE.DataTexture(b.data, ATLAS_SIZE, ATLAS_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
	texture.minFilter = THREE.NearestFilter;
	texture.magFilter = THREE.NearestFilter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;

	return {
		texture,
		entries: b.entries,
		get: (name) => b.names.get(name),
		id: (name) => b.names.get(name).id,
		glyph: (ch) => glyphs.get(ch),
	};
}

export const art = build();
