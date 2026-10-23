// ARCADE-22: every pixel this page draws is one of these colours.
import { Vector3 } from 'three';

const HEX = [
	0x140c28, // ink: all outlines
	0x2c1d5a, // night
	0x6b2380, // plum
	0xb6216f, // berry
	0xff4598, // pink
	0xec2b3f, // red
	0xff7f1e, // orange
	0xffc42e, // gold
	0xfff57a, // lemon
	0x9ef249, // lime
	0x22b85d, // green
	0x138a86, // teal
	0x3de9ff, // cyan
	0x2d8fff, // sky
	0x3448db, // blue
	0x24287d, // navy
	0xffffff, // white
	0xcfe1ff, // frost
	0x8c97c8, // steel
	0x4d5089, // slate
	0xffe3b3, // cream
	0xa8521f, // rust
];

export const INK = 0;
export const NIGHT = 1;
export const PLUM = 2;
export const BERRY = 3;
export const PINK = 4;
export const RED = 5;
export const ORANGE = 6;
export const GOLD = 7;
export const LEMON = 8;
export const LIME = 9;
export const GREEN = 10;
export const TEAL = 11;
export const CYAN = 12;
export const SKY = 13;
export const BLUE = 14;
export const NAVY = 15;
export const WHITE = 16;
export const FROST = 17;
export const STEEL = 18;
export const SLATE = 19;
export const CREAM = 20;
export const RUST = 21;

export const PALETTE_SIZE = HEX.length;
export const RGB = HEX.map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);

// Raw sRGB values for shader uniforms; deliberately not THREE.Color, which would
// convert them to linear.
export function paletteVectors() {
	return RGB.map(([r, g, b]) => new Vector3(r / 255, g / 255, b / 255));
}

// Colour ramps for things that age: index 0 is newborn.
export const RAMPS = [];
const ramp = (...colours) => RAMPS.push(colours) - 1;

export const R_FIRE = ramp(WHITE, LEMON, GOLD, ORANGE, RED, BERRY, PLUM);
export const R_COOL = ramp(WHITE, CYAN, SKY, BLUE, NAVY);
export const R_COMET = ramp(WHITE, WHITE, CYAN, CYAN, SKY, BLUE, NAVY, NIGHT);
export const R_MAGIC = ramp(WHITE, PINK, BERRY, PLUM);
export const R_SMOKE = ramp(FROST, STEEL, STEEL, SLATE);
export const R_LIME = ramp(WHITE, LIME, GREEN, TEAL);
export const R_GOLD = ramp(WHITE, LEMON, GOLD, ORANGE, RUST);
export const R_RAINBOW = ramp(WHITE, LEMON, GOLD, ORANGE, PINK, CYAN, SKY, LIME);
export const R_ICE = ramp(WHITE, FROST, CYAN, SKY);

export function rampAt(id, t) {
	const r = RAMPS[id];
	return r[Math.min(r.length - 1, Math.max(0, Math.floor(t * r.length)))];
}

// Pairs of (light, dark) for tinted sprites.
export const PAIRS = [
	[LEMON, ORANGE],
	[CYAN, BLUE],
	[PINK, BERRY],
	[LIME, GREEN],
	[FROST, STEEL],
	[GOLD, RUST],
];

export const RAINBOW = [RED, ORANGE, GOLD, LIME, CYAN, SKY, PINK];
