// The low-resolution effect layer: batches render into a small target in
// virtual pixels, then one quad covering only what was drawn upscales it with
// nearest sampling and rings every solid pixel with a 1-px ink outline.
import * as THREE from 'three';
import { art } from './art.js';
import { Bounds, PointBatch, LineBatch, pointMaterial, lineMaterial } from './batch.js';
import { RGB, INK } from './palette.js';

const VIRTUAL_HEIGHT = 270;

export function pixelScale(height) {
	return Math.max(2, Math.round(height / VIRTUAL_HEIGHT));
}

const vertex = /* glsl */ `
out vec2 vScreen;

void main() {
	vScreen = position.xy;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Target alpha: 0 empty, 0.5 solid but casts no outline, 1 solid with outline.
const fragment = /* glsl */ `
uniform highp sampler2D uTex;
uniform ivec2 uSize;
uniform float uScale;
uniform vec2 uShake;
uniform vec3 uInk;
in vec2 vScreen;

vec4 fetch(ivec2 v) {
	if (v.x < 0 || v.y < 0 || v.x >= uSize.x || v.y >= uSize.y) return vec4(0.0);
	return texelFetch(uTex, ivec2(v.x, uSize.y - 1 - v.y), 0);
}

void main() {
	ivec2 v = ivec2(floor((vScreen - uShake) / uScale));
	vec4 c = fetch(v);
	if (c.a > 0.25) {
		gl_FragColor = vec4(c.rgb, 1.0);
		return;
	}
	float n = max(
		max(fetch(v + ivec2(1, 0)).a, fetch(v - ivec2(1, 0)).a),
		max(fetch(v + ivec2(0, 1)).a, fetch(v - ivec2(0, 1)).a)
	);
	if (n < 0.75) discard;
	gl_FragColor = vec4(uInk, 1.0);
}
`;

export class PixelLayer {
	constructor() {
		this.bounds = new Bounds();
		this.points = new PointBatch(4096, pointMaterial(art.texture), this.bounds);
		this.lines = new LineBatch(768, lineMaterial(), this.bounds);
		this.lines.object.renderOrder = 0;
		this.points.object.renderOrder = 1;

		this.scene = new THREE.Scene();
		this.scene.add(this.lines.object, this.points.object);
		this.camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);
		this.target = new THREE.WebGLRenderTarget(1, 1, {
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter,
			generateMipmaps: false,
			depthBuffer: false,
		});

		this.scale = 4;
		this.width = 1;   // virtual pixels
		this.height = 1;
		this.screenW = 1;
		this.screenH = 1;
		this.shakeX = 0;  // virtual pixels, whole numbers
		this.shakeY = 0;

		const ink = RGB[INK];
		this.uniforms = {
			uTex: { value: this.target.texture },
			uSize: { value: new THREE.Vector2(1, 1) },
			uScale: { value: 4 },
			uShake: { value: new THREE.Vector2() },
			uInk: { value: new THREE.Vector3(ink[0] / 255, ink[1] / 255, ink[2] / 255) },
		};
		this.quad = new Float32Array(12);
		const geometry = new THREE.BufferGeometry();
		this.quadAttribute = new THREE.BufferAttribute(this.quad, 3).setUsage(THREE.DynamicDrawUsage);
		geometry.setAttribute('position', this.quadAttribute);
		geometry.setIndex([0, 1, 2, 0, 2, 3]);
		this.composite = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
			uniforms: this.uniforms,
			vertexShader: vertex,
			fragmentShader: fragment,
			side: THREE.DoubleSide,
			depthTest: false,
			depthWrite: false,
			blending: THREE.NoBlending,
		}));
		this.composite.frustumCulled = false;
		this.composite.renderOrder = 0;
	}

	// Returns true when the virtual grid changed size, which invalidates positions.
	resize(w, h) {
		const scale = pixelScale(h);
		const width = Math.ceil(w / scale);
		const height = Math.ceil(h / scale);
		const changed = scale !== this.scale || width !== this.width || height !== this.height;
		this.scale = scale;
		this.width = width;
		this.height = height;
		this.screenW = w;
		this.screenH = h;
		this.target.setSize(width, height);
		this.camera.right = width;
		this.camera.bottom = height;
		this.camera.updateProjectionMatrix();
		this.uniforms.uSize.value.set(width, height);
		this.uniforms.uScale.value = scale;
		return changed;
	}

	begin() {
		this.bounds.reset();
		this.points.begin();
		this.lines.begin();
	}

	end() {
		this.points.end();
		this.lines.end();
	}

	// Draws this frame's batches into the target and fits the composite quad
	// around them. Returns false when there is nothing to show.
	render(renderer) {
		const b = this.bounds;
		if (b.empty) {
			this.composite.visible = false;
			return false;
		}
		renderer.setRenderTarget(this.target);
		renderer.clear(true, false, false);
		renderer.render(this.scene, this.camera);

		const s = this.scale;
		const sx = this.shakeX * s;
		const sy = this.shakeY * s;
		this.uniforms.uShake.value.set(sx, sy);
		// One spare virtual pixel on each side for the outline.
		const x0 = Math.max(0, Math.floor(b.x0 - 1) * s + sx);
		const y0 = Math.max(0, Math.floor(b.y0 - 1) * s + sy);
		const x1 = Math.min(this.screenW, Math.ceil(b.x1 + 1) * s + sx);
		const y1 = Math.min(this.screenH, Math.ceil(b.y1 + 1) * s + sy);
		if (x1 <= x0 || y1 <= y0) {
			this.composite.visible = false;
			return false;
		}
		const q = this.quad;
		q[0] = x0; q[1] = y0;
		q[3] = x1; q[4] = y0;
		q[6] = x1; q[7] = y1;
		q[9] = x0; q[10] = y1;
		this.quadAttribute.needsUpdate = true;
		this.composite.visible = true;
		return true;
	}
}
