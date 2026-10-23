// GLSL shared by the Frost materials. Everything is drawn in page pixels
// (origin top-left, y down) and written as premultiplied alpha.

export const HEADER = /* glsl */ `
precision highp float;
precision highp int;
#define PI 3.14159265
#define TAU 6.28318531
`;

export const COMMON = /* glsl */ `
const vec3 C_WHITE = vec3(1.0);
const vec3 C_FROST = vec3(0.910, 0.965, 1.000);  // #e8f6ff
const vec3 C_PALE = vec3(0.749, 0.902, 1.000);   // #bfe6ff
const vec3 C_ICE = vec3(0.486, 0.784, 0.949);    // #7cc8f2
const vec3 C_DEEP = vec3(0.169, 0.435, 0.659);   // #2b6fa8
const vec3 C_INK = vec3(0.051, 0.184, 0.310);    // #0d2f4f

float hash11(float n) {
	return fract(sin(n * 12.9898 + 4.1414) * 43758.5453);
}

vec2 rot2(vec2 p, float a) {
	float c = cos(a);
	float s = sin(a);
	return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// Folds p into the 0..30 degree wedge of a six-fold mirror-symmetric pattern;
// arms lie along +x.
vec2 fold6(vec2 p) {
	float a = atan(p.y, p.x);
	a = abs(mod(a + PI / 6.0, PI / 3.0) - PI / 6.0);
	return length(p) * vec2(cos(a), sin(a));
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
	vec2 pa = p - a;
	vec2 ba = b - a;
	float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
	return length(pa - ba * h);
}

// Hexagon with vertices on the +-x axis, r = circumradius.
float sdHex(vec2 p, float r) {
	vec2 q = fold6(p);
	return dot(q, vec2(0.8660254, 0.5)) - r * 0.8660254;
}

// Coverage of a signed distance (negative inside), aa = one device pixel in page px.
float cover(float d, float aa) {
	return clamp(0.5 - d / aa, 0.0, 1.0);
}

// Porter-Duff "over" for premultiplied colour.
void over(inout vec4 dst, vec3 rgb, float a) {
	dst = vec4(rgb * a, a) + dst * (1.0 - a);
}

vec4 toClip(vec2 px, vec2 res) {
	return vec4(px.x / res.x * 2.0 - 1.0, 1.0 - px.y / res.y * 2.0, 0.0, 1.0);
}
`;
