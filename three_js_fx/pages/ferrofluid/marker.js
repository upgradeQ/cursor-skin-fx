// Crisp chrome marker at the hotspot. Every cursor shape is a 2D distance field, so a
// shape change morphs one field into the other while the marker pops.
import * as THREE from 'three';

const SIZE = 64;

const IDS = {
	default: 0, progress: 0, help: 0, pointer: 1, text: 2, wait: 3, crosshair: 4, move: 5,
	'not-allowed': 6, 'ew-resize': 7, 'ns-resize': 7, 'nwse-resize': 7, 'nesw-resize': 7,
};
const ANGLES = { 'ns-resize': Math.PI / 2, 'nwse-resize': Math.PI / 4, 'nesw-resize': -Math.PI / 4 };

const vertex = /* glsl */ `
varying vec2 vPos;

void main() {
	vec4 world = modelMatrix * vec4(position, 1.0);
	vPos = world.xy;
	gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragment = /* glsl */ `
precision highp float;

uniform vec2 uHot;
uniform int uShapeA;
uniform int uShapeB;
uniform float uAngA;
uniform float uAngB;
uniform float uMix;
uniform float uScale;
uniform float uOpacity;
uniform float uAA;

varying vec2 vPos;

float sdSeg(vec2 p, vec2 a, vec2 b) {
	vec2 pa = p - a;
	vec2 ba = b - a;
	float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
	return length(pa - ba * h);
}

float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
	vec2 e0 = p1 - p0;
	vec2 e1 = p2 - p1;
	vec2 e2 = p0 - p2;
	vec2 v0 = p - p0;
	vec2 v1 = p - p1;
	vec2 v2 = p - p2;
	vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
	vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
	vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
	float s = sign(e0.x * e2.y - e0.y * e2.x);
	vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
		vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
		vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
	return -sqrt(d.x) * sign(d.y);
}

float sdQuad(vec2 p, vec2 v0, vec2 v1, vec2 v2, vec2 v3) {
	vec2 v[4] = vec2[4](v0, v1, v2, v3);
	float d = dot(p - v[0], p - v[0]);
	float s = 1.0;
	for (int i = 0, j = 3; i < 4; j = i, i++) {
		vec2 e = v[j] - v[i];
		vec2 w = p - v[i];
		vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
		d = min(d, dot(b, b));
		bvec3 c = bvec3(p.y >= v[i].y, p.y < v[j].y, e.x * w.y > e.y * w.x);
		if (all(c) || all(not(c))) s *= -1.0;
	}
	return s * sqrt(d);
}

// Dart arrow; the rounded tip lands on the hotspot.
float sdArrow(vec2 p) {
	p -= vec2(0.45, 1.05);
	return sdQuad(p, vec2(0.0), vec2(0.0, 15.6), vec2(4.3, 12.0), vec2(11.0, 11.6)) - 0.65;
}

float sdRing(vec2 p) {
	return abs(length(p) - 4.4) - 1.15;
}

float sdIBeam(vec2 p) {
	vec2 q = vec2(abs(p.x), abs(p.y));
	float d = sdSeg(q, vec2(0.0, 0.0), vec2(0.0, 7.6));
	d = min(d, sdSeg(q, vec2(0.0, 7.6), vec2(3.1, 9.0)));
	return d - 0.75;
}

float sdCross(vec2 p) {
	vec2 q = abs(p);
	float d = min(sdSeg(q, vec2(0.0, 3.4), vec2(0.0, 10.0)), sdSeg(q, vec2(3.4, 0.0), vec2(10.0, 0.0))) - 0.75;
	return min(d, length(p) - 1.2);
}

float sdMove(vec2 p) {
	vec2 q = abs(p);
	if (q.y > q.x) q = q.yx;
	float d = sdSeg(q, vec2(0.0), vec2(7.0, 0.0)) - 0.8;
	return min(d, sdTri(q, vec2(11.0, 0.0), vec2(6.6, -3.6), vec2(6.6, 3.6)) - 0.35);
}

float sdNotAllowed(vec2 p) {
	float d = abs(length(p) - 6.6) - 1.2;
	return min(d, sdSeg(p, vec2(-4.6, -4.6), vec2(4.6, 4.6)) - 1.2);
}

float sdResize(vec2 p, float a) {
	float c = cos(a);
	float s = sin(a);
	vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
	q.x = abs(q.x);
	float d = sdSeg(q, vec2(0.0), vec2(7.0, 0.0)) - 0.8;
	return min(d, sdTri(q, vec2(11.5, 0.0), vec2(6.8, -4.0), vec2(6.8, 4.0)) - 0.35);
}

float shape(int id, float a, vec2 p) {
	if (id == 1) return sdRing(p);
	if (id == 2) return sdIBeam(p);
	if (id == 3) return length(p) - 2.5;
	if (id == 4) return sdCross(p);
	if (id == 5) return sdMove(p);
	if (id == 6) return sdNotAllowed(p);
	if (id == 7) return sdResize(p, a);
	return sdArrow(p);
}

float field(vec2 p) {
	vec2 q = p / uScale;
	return mix(shape(uShapeA, uAngA, q), shape(uShapeB, uAngB, q), clamp(uMix, 0.0, 1.0)) * uScale;
}

// Polished chrome: sky above a sharp horizon, darker ground below, bevel at the rim.
vec3 chrome(vec3 n, vec2 p) {
	float g = p.y * 0.05 + 0.38 + n.y * 0.55 - n.x * 0.15;
	vec3 sky = mix(vec3(1.0, 1.0, 1.0), vec3(0.66, 0.71, 0.78), smoothstep(0.0, 0.47, g));
	vec3 ground = mix(vec3(0.2, 0.2, 0.23), vec3(0.62, 0.6, 0.58), smoothstep(0.5, 1.0, g));
	vec3 col = mix(sky, ground, smoothstep(0.47, 0.53, g));
	float spec = pow(max(dot(n, normalize(vec3(-0.45, -0.6, 0.66))), 0.0), 20.0);
	return col + spec * 0.7;
}

void main() {
	vec2 p = vPos - uHot;
	float d = field(p);
	float aa = uAA;
	float outline = 1.25;
	float fillA = clamp(0.5 - d / aa, 0.0, 1.0);
	float lineA = clamp(0.5 - (d - outline) / aa, 0.0, 1.0);
	float shadowA = 0.34 * (1.0 - smoothstep(-1.0, 3.8, field(p - vec2(0.9, 1.8)) - outline));

	vec4 col = vec4(0.0, 0.0, 0.0, shadowA * (1.0 - lineA));
	col += vec4(vec3(0.03, 0.03, 0.04) * (lineA - fillA), lineA - fillA);
	if (fillA > 0.0) {
		float e = 0.5;
		vec2 grad = vec2(field(p + vec2(e, 0.0)) - d, field(p + vec2(0.0, e)) - d) / e;
		float bevel = 1.0 - smoothstep(0.0, 1.8, -d);
		vec3 n = normalize(vec3(grad * bevel * 1.6, 1.0));
		col += vec4(chrome(n, p) * fillA, fillA);
	}
	gl_FragColor = col * uOpacity;
}
`;

const spring = (x) => ({ x, v: 0 });

function step(s, target, omega, zeta, dt) {
	s.v += (omega * omega * (target - s.x) - 2 * zeta * omega * s.v) * dt;
	s.x += s.v * dt;
}

export class Marker {
	constructor(scene) {
		this.uniforms = {
			uHot: { value: new THREE.Vector2() },
			uShapeA: { value: 0 },
			uShapeB: { value: 0 },
			uAngA: { value: 0 },
			uAngB: { value: 0 },
			uMix: { value: 1 },
			uScale: { value: 1 },
			uOpacity: { value: 0 },
			uAA: { value: 1 },
		};
		this.mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(SIZE, SIZE),
			new THREE.ShaderMaterial({
				vertexShader: vertex,
				fragmentShader: fragment,
				uniforms: this.uniforms,
				transparent: true,
				depthTest: false,
				depthWrite: false,
				side: THREE.DoubleSide,
				blending: THREE.CustomBlending,
				blendSrc: THREE.OneFactor,
				blendDst: THREE.OneMinusSrcAlphaFactor,
				blendSrcAlpha: THREE.OneFactor,
				blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
			}),
		);
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 1;
		this.mesh.visible = false;
		scene.add(this.mesh);
		this.mix = spring(1);
		this.scale = spring(1);
		this.pressed = false;
	}

	setShape(shape) {
		const u = this.uniforms;
		const id = IDS[shape] ?? 0;
		const angle = ANGLES[shape] ?? 0;
		if (id === u.uShapeB.value && angle === u.uAngB.value) return;
		if (this.mix.x >= 0.5) {
			u.uShapeA.value = u.uShapeB.value;
			u.uAngA.value = u.uAngB.value;
		}
		u.uShapeB.value = id;
		u.uAngB.value = angle;
		this.mix.x = 0;
		this.mix.v = 0;
		this.scale.v -= 4;
	}

	snapShape(shape) {
		const u = this.uniforms;
		u.uShapeA.value = u.uShapeB.value = IDS[shape] ?? 0;
		u.uAngA.value = u.uAngB.value = ANGLES[shape] ?? 0;
		this.mix.x = 1;
		this.mix.v = 0;
		this.scale.x = 1;
		this.scale.v = 0;
	}

	update(dt, cursor, opacity, pixelRatio) {
		const h = Math.min(dt, 1 / 60);
		for (let t = 0; t < dt; t += h) {
			const k = Math.min(h, dt - t);
			step(this.mix, 1, 22, 0.85, k);
			step(this.scale, cursor.down ? 0.86 : 1, 26, 0.38, k);
		}
		const u = this.uniforms;
		u.uMix.value = this.mix.x;
		u.uScale.value = Math.max(0.5, this.scale.x);
		u.uOpacity.value = opacity;
		u.uAA.value = 1 / pixelRatio;
		u.uHot.value.set(cursor.x, cursor.y);
		this.mesh.position.set(cursor.x + 4, cursor.y + 6, 0);
		this.mesh.visible = opacity > 0.002;
		return this.mesh.visible;
	}
}
