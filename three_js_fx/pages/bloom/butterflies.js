// Right button: butterflies with the Blender wing, flapping fast, swirl
// around the cursor while it is held and scatter when it is let go.
import * as THREE from 'three';
import { jewelMaterial } from './assets.js';
import { FLAKE, GLOW, SPARKLE, pick, rand } from './sprites.js';

const MAX = 40;
const COLORS = [[1, 0.85, 0.95], [1, 0.7, 0.85], [0.85, 0.75, 1], [1, 0.9, 0.75], [1, 1, 1]];

const _m = new THREE.Matrix4();
const _w = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class Butterflies {
	constructor(scene, assets) {
		const mat = jewelMaterial(assets.matcap.pearl, { map: assets.wingMap, glitter: 1.0, side: THREE.DoubleSide });
		this.mesh = new THREE.InstancedMesh(assets.geo.wing, mat, MAX * 2);
		this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		this.mesh.frustumCulled = false;
		this.mesh.count = 0;
		this.mesh.setColorAt(0, _c.set(1, 1, 1));
		scene.add(this.mesh);
		this.list = [];
		this.held = false;
		this.spawnClock = 0;
		this.swirl = 0;
	}

	press(x, y) {
		this.held = true;
		this.spawnClock = 0;
		for (let i = 0; i < 10; i++) this.add(x, y);
	}

	release(fx) {
		if (!this.held) return;
		this.held = false;
		let cx = 0, cy = 0, n = 0;
		for (const b of this.list) {
			if (b.free) continue;
			b.free = true;
			b.age = 0;
			// Fling out along the orbit's tangent, and up.
			const a = b.angle + Math.PI / 2;
			b.vx = Math.cos(b.angle) * 500 + Math.cos(a) * 700;
			b.vy = Math.sin(b.angle) * 500 + Math.sin(a) * 700 - 300;
			cx += b.x; cy += b.y; n++;
			fx.glitter(b.x, b.y, 10, 300, { life: 0.8, palette: [[0.8, 0.55, 1], [1, 0.55, 0.85], [1, 0.9, 1]] });
		}
		if (n) fx.shockwave(cx / n, cy / n, 180, { color: [0.8, 0.6, 1] });
	}

	add(x, y) {
		if (this.list.length >= MAX) return;
		const a = Math.random() * Math.PI * 2;
		this.list.push({
			x, y, z: 0, vx: Math.cos(a) * 600, vy: Math.sin(a) * 600,
			angle: a, radius: rand(45, 110), tiltZ: rand(-60, 60), speed: rand(5, 8) * (Math.random() < 0.25 ? -1 : 1),
			flap: Math.random() * 6, size: rand(16, 26), free: false, age: 0, life: rand(1.6, 2.4),
			color: pick(COLORS), heading: a,
		});
	}

	update(dt, t, cursor, fx) {
		if (this.held) {
			this.spawnClock += dt;
			while (this.spawnClock > 0.05) {
				this.spawnClock -= 0.05;
				this.add(cursor.sx, cursor.sy);
			}
		}
		let n = 0;
		const list = this.list;
		for (let i = 0; i < list.length; i++) {
			const b = list[i];
			b.age += dt;
			let scale = 1;
			if (b.free) {
				if (b.age >= b.life) continue;
				// Wander off, fluttering upward.
				b.vx += rand(-1, 1) * 1800 * dt;
				b.vy += (rand(-1, 1) * 1800 - 500) * dt;
				const damp = Math.exp(-1.2 * dt);
				b.vx *= damp;
				b.vy *= damp;
				const k = b.age / b.life;
				scale = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
			} else {
				// Orbit the cursor on a tilted ellipse; the spring makes the swirl whip.
				b.angle += b.speed * dt;
				const tx = cursor.sx + Math.cos(b.angle) * b.radius;
				const ty = cursor.sy + Math.sin(b.angle) * b.radius * 0.6;
				b.vx += ((tx - b.x) * 160 - b.vx * 14) * dt;
				b.vy += ((ty - b.y) * 160 - b.vy * 14) * dt;
				b.z = Math.sin(b.angle) * b.tiltZ;
				scale = Math.min(1, b.age / 0.15);
			}
			b.x += b.vx * dt;
			b.y += b.vy * dt;
			const sp = Math.hypot(b.vx, b.vy);
			if (sp > 30) {
				const want = Math.atan2(-b.vy, b.vx) - Math.PI / 2;
				let d = want - b.heading;
				d = Math.atan2(Math.sin(d), Math.cos(d));
				b.heading += d * (1 - Math.exp(-dt * 16));
			}
			b.flap += dt * 34;
			const beat = 0.15 + 1.15 * (0.5 + 0.5 * Math.sin(b.flap));
			const s = b.size * scale;
			// Body frame: position, heading in the page plane, a little pitch toward the viewer.
			_w.compose(_p.set(b.x, -b.y, 80 + b.z), _q.setFromEuler(_e.set(-0.5, 0, b.heading)), _s.setScalar(1));
			for (const side of [1, -1]) {
				_m.makeRotationY(-side * beat);
				_m.premultiply(_w);
				_m.multiply(new THREE.Matrix4().makeScale(side * s, s, s));
				this.mesh.setMatrixAt(n * 2 + (side > 0 ? 0 : 1), _m);
				this.mesh.setColorAt(n * 2 + (side > 0 ? 0 : 1), _c.setRGB(...b.color, THREE.SRGBColorSpace));
			}
			const dust = Math.floor(rand(0, 1) + dt * 70);
			for (let k = 0; k < dust; k++) {
				fx.sprites.spawn(b.x + rand(-6, 6), b.y + rand(-6, 6), { tile: FLAKE, size: rand(3.5, 7), life: rand(0.5, 0.9), g: 140, add: 0.5, twinkle: 8, glint: true, vx: -b.vx * 0.15, vy: -b.vy * 0.15, color: pick([[0.8, 0.55, 1], [1, 0.55, 0.85], [1, 0.85, 0.5], [1, 0.9, 1]]) });
			}
			if (Math.random() < dt * 4) fx.sprites.spawn(b.x, b.y, { tile: SPARKLE, size: 22, life: 0.3, add: 0.8, color: [1, 0.9, 1], pop: 0.05 });
			list[n++] = b;
		}
		list.length = n;
		this.mesh.count = n * 2;
		if (n > 0) {
			this.mesh.instanceMatrix.needsUpdate = true;
			this.mesh.instanceColor.needsUpdate = true;
			if (this.held) fx.sprites.spawn(cursor.sx, cursor.sy, { tile: GLOW, size: 260, color: [0.85, 0.5, 1], alpha: 0.35, add: 1, life: dt * 1.01, z: -80 });
		}
		return n > 0;
	}
}
