// The aquarium's layer order and the GLSL every aquarium shader starts with,
// on top of shared/gl-layers.js.
import * as layers from '../../shared/gl-layers.js';

export { compileLayers, CURSOR_SDF_GLSL, cursorAtlas, InstanceLayer, layerMesh, quadGeometry, setFrame, streamGeometry, uploadPrefix } from '../../shared/gl-layers.js';

// Draw order, back to front.
export const ORDER = { water: 0, surface: 1, fishShadows: 2, orbBack: 3, fish: 4, orbFront: 5, air: 6, glass: 7 };

export function premultipliedMaterial({ common = '', ...rest }) {
	return layers.premultipliedMaterial({ common: COMMON_GLSL + common, ...rest });
}

export const COMMON_GLSL = /* glsl */ `
// Hermite step that also runs downhill when a > b.
float ramp(float a, float b, float x) {
	float t = clamp((x - a) / (b - a), 0.0, 1.0);
	return t * t * (3.0 - 2.0 * t);
}

// Premultiplied "top over under".
vec4 over(vec4 top, vec4 under) {
	return top + under * (1.0 - top.a);
}

// A flat colour at some opacity, premultiplied.
vec4 paint(vec3 rgb, float a) {
	float k = clamp(a, 0.0, 1.0);
	return vec4(rgb * k, k);
}

float hash11(float n) {
	return fract(sin(n * 127.1 + 11.3) * 43758.5453);
}

vec2 rot(vec2 v, float a) {
	float c = cos(a);
	float s = sin(a);
	return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}
`;
