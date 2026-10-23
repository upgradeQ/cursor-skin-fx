// Glitter: flat sprites from the Blender-made atlas, simulated on the CPU
// and drawn as one instanced batch in premultiplied colour. `add` 1 is pure
// light, 0 is solid paint; the light end vanishes over white pages, so most
// sprites sit in between.
//
// Flakes with `glint` catch the light: at the top of their twinkle they flare
// into a white four-point sparkle for a frame or two, which is what makes a
// cloud of them read as glitter rather than confetti.
import * as THREE from 'three';

export const SPARKLE = 0, GLOW = 1, HEART = 2, FLAKE = 3, RING = 4, STREAK = 5, BOKEH = 6, STAR = 7;
const TILES = 8;

const STRIDE = 11;   // x y z | size rot tile add | r g b a

export const PINKS = [
	[1.0, 0.35, 0.7], [1.0, 0.55, 0.85], [1.0, 0.8, 0.92], [0.95, 0.6, 1.0],
	[1.0, 0.85, 0.45], [1.0, 1.0, 1.0], [0.75, 0.55, 1.0], [1.0, 0.25, 0.55],
];
// Deeper glitter that still shows as colour over white pages.
export const GLITTER = [
	[1.0, 0.2, 0.6], [1.0, 0.45, 0.8], [0.85, 0.4, 1.0], [1.0, 0.75, 0.3],
	[1.0, 0.6, 0.9], [0.6, 0.45, 1.0], [1.0, 0.9, 0.95], [1.0, 0.3, 0.45],
];
// Pale, light-only tints for bokeh.
export const BOKEH_TINTS = [[1, 0.75, 0.9], [1, 0.9, 0.96], [0.92, 0.82, 1], [1, 0.85, 0.7]];
export const pick = (list) => list[(Math.random() * list.length) | 0];
export const rand = (a, b) => a + Math.random() * (b - a);

export class Sprites {
	constructor(scene, atlas, capacity = 16000) {
		this.capacity = capacity;
		this.list = [];
		this.pool = [];
		this.data = new Float32Array(capacity * STRIDE);
		const buf = new THREE.InstancedInterleavedBuffer(this.data, STRIDE).setUsage(THREE.DynamicDrawUsage);
		const geo = new THREE.InstancedBufferGeometry();
		const quad = new THREE.PlaneGeometry(2, 2);
		geo.index = quad.index;
		geo.setAttribute('position', quad.getAttribute('position'));
		geo.setAttribute('aPos', new THREE.InterleavedBufferAttribute(buf, 3, 0));
		geo.setAttribute('aSRT', new THREE.InterleavedBufferAttribute(buf, 4, 3));
		geo.setAttribute('aCol', new THREE.InterleavedBufferAttribute(buf, 4, 7));
		geo.instanceCount = 0;
		this.buffer = buf;
		this.geo = geo;
		const mat = new THREE.ShaderMaterial({
			uniforms: { uMap: { value: atlas } },
			vertexShader: /* glsl */ `
				attribute vec3 aPos;
				attribute vec4 aSRT;
				attribute vec4 aCol;
				varying vec2 vUv;
				varying vec4 vCol;
				varying float vAdd;
				void main() {
					vec2 c = position.xy;
					float s = sin(aSRT.y), k = cos(aSRT.y);
					vec2 p = vec2(c.x * k - c.y * s, c.x * s + c.y * k) * aSRT.x * 0.5;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(aPos.x + p.x, -aPos.y + p.y, aPos.z, 1.0);
					vUv = vec2((aSRT.z + c.x * 0.5 + 0.5) / ${TILES}.0, c.y * 0.5 + 0.5);
					vCol = aCol;
					vAdd = aSRT.w;
				}`,
			fragmentShader: /* glsl */ `
				uniform sampler2D uMap;
				varying vec2 vUv;
				varying vec4 vCol;
				varying float vAdd;
				void main() {
					vec4 t = texture2D(uMap, vUv);
					float a = t.a * vCol.a;
					gl_FragColor = vec4(vCol.rgb * t.rgb * a, a * (1.0 - vAdd));
				}`,
			transparent: true,
			depthTest: false,
			depthWrite: false,
			blending: THREE.CustomBlending,
			blendSrc: THREE.OneFactor,
			blendDst: THREE.OneMinusSrcAlphaFactor,
			blendSrcAlpha: THREE.OneFactor,
			blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
		});
		this.mesh = new THREE.Mesh(geo, mat);
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 10;
		scene.add(this.mesh);
	}

	// Page px, y down. o: vx vy (px/s), g (px/s², down), drag (1/s), size, grow
	// (size gain over life, fraction), rot, spin, tile, color, alpha, add, life,
	// twinkle (Hz, 0 for steady), glint (flare into a sparkle at the twinkle's
	// peak), pop (s of pop-in), z, pull {x, y, k}, stretch (streaks: scale size
	// by speed)
	spawn(x, y, o = {}) {
		if (this.list.length >= this.capacity) return null;
		const p = this.pool.pop() ?? {};
		p.x = x; p.y = y; p.z = o.z ?? 50;
		p.vx = o.vx ?? 0; p.vy = o.vy ?? 0;
		p.g = o.g ?? 0; p.drag = o.drag ?? 0;
		p.size = o.size ?? 8; p.grow = o.grow ?? 0;
		p.rot = o.rot ?? Math.random() * Math.PI * 2; p.spin = o.spin ?? 0;
		p.tile = o.tile ?? FLAKE;
		p.color = o.color ?? pick(GLITTER);
		p.alpha = o.alpha ?? 1; p.add = o.add ?? 0.4;
		p.life = o.life ?? 0.8; p.age = 0;
		p.twinkle = o.twinkle ?? 0; p.phase = Math.random() * 6.28;
		p.glint = o.glint ?? false;
		p.pop = o.pop ?? 0;
		p.pull = o.pull ?? null;
		this.list.push(p);
		return p;
	}

	// n sprites flying out of (x, y) in a cone around `angle`.
	burst(x, y, n, speed, o = {}) {
		const angle = o.angle ?? 0, spread = o.spread ?? Math.PI;
		const palette = o.palette ?? GLITTER;
		for (let i = 0; i < n; i++) {
			const a = angle + rand(-spread, spread);
			const v = speed * rand(o.minSpeed ?? 0.3, 1);
			const p = this.spawn(x, y, o);
			if (!p) return;
			p.vx = Math.cos(a) * v + (o.vx ?? 0);
			p.vy = Math.sin(a) * v + (o.vy ?? 0);
			if (!o.color) p.color = pick(palette);
			if (o.tile === STREAK) p.rot = -a;
		}
	}

	update(dt) {
		const list = this.list;
		const d = this.data;
		let n = 0;
		for (let i = 0; i < list.length; i++) {
			const p = list[i];
			p.age += dt;
			if (p.age >= p.life) {
				this.pool.push(p);
				continue;
			}
			if (p.pull) {
				p.vx += (p.pull.x - p.x) * p.pull.k * dt;
				p.vy += (p.pull.y - p.y) * p.pull.k * dt;
			}
			const damp = Math.exp(-p.drag * dt);
			p.vx *= damp;
			p.vy = p.vy * damp + p.g * dt;
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			p.rot += p.spin * dt;
			const t = p.age / p.life;
			let s = p.size * (1 + p.grow * t);
			if (p.pop > 0 && p.age < p.pop) s *= backOut(p.age / p.pop);
			let a = p.alpha * (1 - t * t);
			let tile = p.tile, add = p.add, r = p.color[0], g = p.color[1], b = p.color[2], rot = p.rot;
			if (p.twinkle > 0) {
				const tw = 0.5 + 0.5 * Math.sin(p.age * p.twinkle * 6.283 + p.phase);
				if (p.glint && tw > 0.93) {
					// Catching the light: a white-hot star for the top of the twinkle.
					tile = SPARKLE;
					s *= 2.6;
					add = 0.7;
					r = 1 - (1 - r) * 0.3; g = 1 - (1 - g) * 0.3; b = 1 - (1 - b) * 0.3;
					rot = 0;
				} else a *= 0.3 + 0.7 * tw * tw * tw;
			}
			list[n++] = p;
			const o = (n - 1) * STRIDE;
			d[o] = p.x; d[o + 1] = p.y; d[o + 2] = p.z;
			d[o + 3] = s; d[o + 4] = rot; d[o + 5] = tile; d[o + 6] = add;
			d[o + 7] = r; d[o + 8] = g; d[o + 9] = b; d[o + 10] = a;
		}
		list.length = n;
		this.geo.instanceCount = n;
		if (n > 0) {
			this.buffer.clearUpdateRanges();
			this.buffer.addUpdateRange(0, n * STRIDE);
			this.buffer.needsUpdate = true;
		}
		return n > 0;
	}
}

export function backOut(t, s = 2.4) {
	const u = t - 1;
	return 1 + (s + 1) * u * u * u + s * u * u;
}
