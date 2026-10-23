// Eden's layer order and the GLSL every Eden layer starts from (hashing,
// noise, rotation, premultiplied "over"), on top of shared/gl-layers.js.
import * as layers from '../../shared/gl-layers.js';

export { CURSOR_SDF_GLSL, cursorAtlas, layerMesh, quadGeometry, setFrame, streamGeometry, uploadPrefix } from '../../shared/gl-layers.js';

// Draw order, back to front.
export const ORDER = { spritesBack: 0, aurora: 1, spritesMid: 2, orbFree: 3, orbHeld: 4, glass: 5, spritesTop: 6 };

export function premultipliedMaterial({ common = '', ...rest }) {
	return layers.premultipliedMaterial({ common: COMMON_GLSL + common, ...rest });
}

const COMMON_GLSL = /* glsl */ `
const float TAU = 6.2831853;

vec2 rot2(float a, vec2 p) {
	float c = cos(a);
	float s = sin(a);
	return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// Premultiplied "a over b".
vec4 over(vec4 a, vec4 b) {
	return a + b * (1.0 - a.a);
}

float hash21(vec2 p) {
	vec2 q = fract(p * vec2(123.34, 456.21));
	q += dot(q, q + 45.32);
	return fract(q.x * q.y);
}

float noise2(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	float a = hash21(i);
	float b = hash21(i + vec2(1.0, 0.0));
	float c = hash21(i + vec2(0.0, 1.0));
	float d = hash21(i + vec2(1.0, 1.0));
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;
