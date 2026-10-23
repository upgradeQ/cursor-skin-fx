// Packs the simulation into shader uniforms, raymarches the fluid's bounding box into a
// supersampled offscreen target and composites it back with a box-filtered quad.
import * as THREE from 'three';
import { MAX_DROPS, NONE } from './fluid.js';
import { fluidVertex, fluidFragment } from './fluid-shader.js';

const TILT = (50 * Math.PI) / 180;
const SIN_T = Math.sin(TILT);
const COS_T = Math.cos(TILT);
const INV_COS = 1 / COS_T;
const HEIGHT = 0.8;              // head height relative to its radius: a bead, not a ball
const SUPERSAMPLE = 2;
const SUPERSAMPLE_MAX_PX = 520000;   // above this many target pixels, render at 1x instead
const TARGET_MAX = 2048;

const PREMULTIPLIED = {
	transparent: true,
	depthTest: false,
	depthWrite: false,
	side: THREE.DoubleSide,
	blending: THREE.CustomBlending,
	blendSrc: THREE.OneFactor,
	blendDst: THREE.OneMinusSrcAlphaFactor,
	blendSrcAlpha: THREE.OneFactor,
	blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
};

const compositeVertex = /* glsl */ `
varying vec2 vPos;

void main() {
	vec4 world = modelMatrix * vec4(position, 1.0);
	vPos = world.xy;
	gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// Sampling between the 2x2 texels of each output pixel makes bilinear filtering a box filter.
const compositeFragment = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uOrigin;   // page x of the left edge, page y of the bottom edge
uniform vec2 uScale;    // target texels per page pixel / target size

varying vec2 vPos;

void main() {
	vec2 uv = vec2(vPos.x - uOrigin.x, uOrigin.y - vPos.y) * uScale;
	gl_FragColor = texture2D(uTex, uv);
}
`;

export class FluidView {
	constructor(scene) {
		this.drops = new Float32Array(MAX_DROPS * 4);
		this.dropsV = new Float32Array(MAX_DROPS * 4);
		this.uniforms = {
			uHead: { value: new THREE.Vector4() },
			uHeadB: { value: new THREE.Vector4(1, 0, 1, 0) },
			uSpike: { value: new THREE.Vector4() },
			uSpikeB: { value: new THREE.Vector2(1, 1) },
			uStrandA: { value: new THREE.Vector4() },
			uStrandB: { value: new THREE.Vector4() },
			uDrops: { value: this.drops },
			uDropsV: { value: this.dropsV },
			uCount: { value: 0 },
			uZTop: { value: 1 },
			uTime: { value: 0 },
			uOpacity: { value: 0 },
			uAA: { value: 1 },
			uTilt: { value: new THREE.Vector2(SIN_T, COS_T) },
		};
		// The fluid writes premultiplied colour straight into a cleared target.
		this.mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(1, 1),
			new THREE.ShaderMaterial({
				vertexShader: fluidVertex,
				fragmentShader: fluidFragment,
				uniforms: this.uniforms,
				depthTest: false,
				depthWrite: false,
				side: THREE.DoubleSide,
				blending: THREE.NoBlending,
			}),
		);
		this.mesh.frustumCulled = false;
		this.rtScene = new THREE.Scene();
		this.rtScene.add(this.mesh);
		this.rtCamera = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
		this.target = new THREE.WebGLRenderTarget(256, 256, {
			depthBuffer: false,
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			generateMipmaps: false,
		});
		this.target.scissorTest = true;

		this.composite = new THREE.Mesh(
			new THREE.PlaneGeometry(1, 1),
			new THREE.ShaderMaterial({
				vertexShader: compositeVertex,
				fragmentShader: compositeFragment,
				uniforms: {
					uTex: { value: this.target.texture },
					uOrigin: { value: new THREE.Vector2() },
					uScale: { value: new THREE.Vector2() },
				},
				...PREMULTIPLIED,
			}),
		);
		this.composite.frustumCulled = false;
		this.composite.visible = false;
		scene.add(this.composite);
		this.minX = this.minY = this.maxX = this.maxY = 0;
	}

	// Compiles the raymarcher; the composite quad is compiled with the main scene.
	compile(renderer) {
		const previous = renderer.getRenderTarget();
		renderer.setRenderTarget(this.target);
		renderer.compile(this.rtScene, this.rtCamera);
		renderer.setRenderTarget(previous);
	}

	// Grows the bounds by a blob of footprint radius r and height z standing on the floor at
	// page (x, y): the tilted view squashes the footprint and lifts the top, plus room for
	// the contact shadow below and the halo all round.
	expand(x, y, r, z) {
		this.minX = Math.min(this.minX, x - r - 6);
		this.maxX = Math.max(this.maxX, x + r + 7);
		this.minY = Math.min(this.minY, y - r * COS_T - z * SIN_T - 6);
		this.maxY = Math.max(this.maxY, y + r * COS_T + 13);
	}

	update(sim, opacity, time, renderer) {
		const u = this.uniforms;
		this.minX = this.minY = Infinity;
		this.maxX = this.maxY = -Infinity;
		let zTop = 0;

		const r = sim.r.x;
		const wob = sim.wob.x;
		const st = sim.stretch;
		const along = r * st * (1 + wob);
		const across = (r / Math.sqrt(st)) * (1 + wob);
		const height = Math.max(0.3, ((r * HEIGHT) / Math.sqrt(st)) * (1 - 1.3 * wob));
		const spikeLen = Math.max(0, sim.spike.x) * r;
		let wx = sim.dirX;
		let wy = sim.dirY * INV_COS;
		const wl = Math.hypot(wx, wy) || 1;
		wx /= wl;
		wy /= wl;
		u.uHead.value.set(sim.drawX, sim.drawY * INV_COS, along, across);
		u.uHeadB.value.set(wx, wy, height, sim.text.x);
		u.uSpike.value.set(spikeLen, 1.1 - 0.45 * sim.sharp, sim.spin, 3.4 - 1.4 * sim.sharp);
		u.uSpikeB.value.set(Math.max(3, r * 0.42), height * 1.3);
		if (r > 0.3) {
			this.expand(sim.drawX, sim.drawY, Math.max(along, across) + spikeLen * 0.8 + 2, height + spikeLen * 1.25);
			zTop = Math.max(zTop, height + spikeLen * 1.25);
		}
		if (sim.text.x > 0.01) {
			this.expand(sim.drawX, sim.drawY, 10, 20);
			zTop = Math.max(zTop, 2.6);
		}

		const on = sim.strand.x;
		const len = Math.hypot(sim.magX - sim.drawX, sim.magY - sim.drawY);
		const lenW = Math.hypot(sim.magX - sim.drawX, (sim.magY - sim.drawY) * INV_COS);
		let rB = Math.max(0, sim.tip.x * on);
		let rA = Math.max(rB, sim.strandRadius(len) * on);
		if (on < 0.02 || r < 0.5 || lenW < rA - rB + 0.5) rA = rB = 0;
		const bead = Math.max(0, sim.bead.x);
		u.uStrandA.value.set(sim.drawX, sim.drawY * INV_COS, sim.magX, sim.magY * INV_COS);
		u.uStrandB.value.set(rA, rB, bead, 0);
		if (rA > 0 || bead > 0.2) {
			this.expand(sim.magX, sim.magY, Math.max(rB, bead) + 2, Math.max(rA, bead));
			zTop = Math.max(zTop, rA, bead);
		}

		let n = 0;
		for (const d of sim.drops) {
			if (d.mode === NONE || d.r < 0.25) continue;
			const o = n * 4;
			const sp = Math.hypot(d.vx, d.vy);
			let dx = d.vx;
			let dy = d.vy * INV_COS;
			const dl = Math.hypot(dx, dy);
			if (dl > 1e-3) {
				dx /= dl;
				dy /= dl;
			} else {
				dx = 1;
				dy = 0;
			}
			const s = 1 + 0.8 * (1 - Math.exp(-sp / 1300));
			this.drops[o] = d.x;
			this.drops[o + 1] = d.y * INV_COS;
			this.drops[o + 2] = d.r;
			this.drops[o + 3] = 0.85;
			this.dropsV[o] = dx;
			this.dropsV[o + 1] = dy;
			this.dropsV[o + 2] = s;
			this.expand(d.x, d.y, d.r * s + 1, d.r);
			zTop = Math.max(zTop, d.r);
			n++;
		}
		u.uCount.value = n;
		u.uZTop.value = zTop + 1.5;
		u.uTime.value = time;
		u.uOpacity.value = opacity;
		const visible = opacity > 0.002 && this.maxX > this.minX;
		this.composite.visible = visible;
		if (visible) this.render(renderer);
		return visible;
	}

	render(renderer) {
		const x0 = Math.floor(this.minX);
		const y0 = Math.floor(this.minY);
		const x1 = Math.ceil(this.maxX);
		const y1 = Math.ceil(this.maxY);
		const w = x1 - x0;
		const h = y1 - y0;
		const pr = renderer.getPixelRatio();
		let scale = pr * SUPERSAMPLE;
		if (w * h * scale * scale > SUPERSAMPLE_MAX_PX || Math.max(w, h) * scale > TARGET_MAX) scale = pr;
		const tw = Math.min(TARGET_MAX, Math.ceil(w * scale));
		const th = Math.min(TARGET_MAX, Math.ceil(h * scale));

		const target = this.target;
		if (tw > target.width || th > target.height) {
			const grow = (n, have) => Math.min(TARGET_MAX, Math.max(have, Math.ceil(n / 128) * 128));
			target.setSize(grow(tw, target.width), grow(th, target.height));
		}
		target.viewport.set(0, 0, tw, th);
		target.scissor.set(0, 0, tw, th);

		const cam = this.rtCamera;
		cam.left = x0;
		cam.right = x0 + tw / scale;
		cam.top = y1 - th / scale;
		cam.bottom = y1;
		cam.updateProjectionMatrix();
		this.mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
		this.mesh.scale.set(w, h, 1);
		this.uniforms.uAA.value = 1 / scale;

		const previous = renderer.getRenderTarget();
		renderer.setRenderTarget(target);
		renderer.clear(true, false, false);
		renderer.render(this.rtScene, cam);
		renderer.setRenderTarget(previous);

		const cu = this.composite.material.uniforms;
		cu.uOrigin.value.set(x0, y1);
		cu.uScale.value.set(scale / target.width, scale / target.height);
		this.composite.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
		this.composite.scale.set(w, h, 1);
	}
}
