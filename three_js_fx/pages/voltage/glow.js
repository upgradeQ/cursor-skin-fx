// Round glows filled in every frame: impact flashes, the plasma core, chain
// nodes and spark heads. One instanced draw, added onto the page.
import * as THREE from 'three';
import { additive } from './bolts.js';

const GLOW_VERT = /* glsl */ `
attribute vec4 aA;   // x, y, radius, intensity
attribute vec4 aB;   // hue (0 blue .. 1 violet), white core amount
varying vec2 vP;
varying vec4 vB;
varying float vI;
void main() {
	vP = position.xy;
	vB = aB;
	vI = aA.w;
	gl_Position = projectionMatrix * viewMatrix * vec4(aA.xy + position.xy * aA.z, 0.0, 1.0);
}
`;

const GLOW_FRAG = /* glsl */ `
varying vec2 vP;
varying vec4 vB;
varying float vI;
void main() {
	float d2 = dot(vP, vP);
	if (d2 >= 1.0) discard;
	float g = exp(-d2 * 4.5) * (1.0 - smoothstep(0.7, 1.0, d2));
	float core = exp(-d2 * 40.0) * vB.y;
	vec3 tint = mix(vec3(0.16, 0.42, 1.0), vec3(0.62, 0.3, 1.0), vB.x);
	vec3 col = (tint * g * 0.8 + vec3(0.9, 0.95, 1.0) * core) * vI;
	float a = min(1.0, max(col.r, max(col.g, col.b)) * 1.15);
	gl_FragColor = vec4(col, a);
}
`;

export class Glows {
	constructor(scene, max = 512) {
		this.max = max;
		const geo = new THREE.InstancedBufferGeometry();
		const quad = new THREE.PlaneGeometry(2, 2);
		geo.index = quad.index;
		geo.setAttribute('position', quad.getAttribute('position'));
		this.A = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
		this.B = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
		geo.setAttribute('aA', this.A);
		geo.setAttribute('aB', this.B);
		geo.instanceCount = 0;
		this.geo = geo;
		this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
			vertexShader: GLOW_VERT,
			fragmentShader: GLOW_FRAG,
			side: THREE.DoubleSide,
			...additive,
		}));
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 15;
		scene.add(this.mesh);
		this.n = 0;
	}

	begin() {
		this.n = 0;
	}

	add(x, y, radius, intensity, hue = 0, core = 0) {
		if (this.n >= this.max || intensity <= 0.002) return;
		const o = this.n++ * 4;
		const A = this.A.array, B = this.B.array;
		A[o] = x; A[o + 1] = y; A[o + 2] = radius; A[o + 3] = intensity;
		B[o] = hue; B[o + 1] = core;
	}

	end() {
		for (const a of [this.A, this.B]) {
			a.clearUpdateRanges();
			a.addUpdateRange(0, Math.max(1, this.n) * 4);
			a.needsUpdate = true;
		}
		this.geo.instanceCount = this.n;
		this.mesh.visible = this.n > 0;
		return this.n > 0;
	}
}
