// Tumbling 3D things: blossoms, petals, leaves, gem hearts and stars. Each
// kind is a pool drawn as instanced meshes (several parts can share one set
// of instance transforms, as the blossom's petals, centre and stamens do).
// They pop in with an overshoot, flutter, spin and shrink away.
import * as THREE from 'three';
import { backOut, rand } from './sprites.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _w = new THREE.Vector3();
const _c = new THREE.Color();

export class Bodies {
	// parts: [{ geometry, material }]; the first part carries instance colours.
	constructor(scene, parts, capacity) {
		this.capacity = capacity;
		this.list = [];
		this.meshes = parts.map(({ geometry, material }, i) => {
			const mesh = new THREE.InstancedMesh(geometry, material, capacity);
			mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
			mesh.frustumCulled = false;
			mesh.count = 0;
			scene.add(mesh);
			return mesh;
		});
		const head = this.meshes[0];
		head.setColorAt(0, _c.set(1, 1, 1));
		for (const mesh of this.meshes.slice(1)) mesh.instanceMatrix = head.instanceMatrix;
	}

	// Page px, y down. o: vx vy vz, g, drag, size, life, pop (s), q (Quaternion),
	// w (Vector3 rad/s), flutter (px/s² sideways sway), z, color [r,g,b], shrink
	// (fraction of life spent shrinking away), face (start facing the viewer).
	spawn(x, y, o = {}) {
		if (this.list.length >= this.capacity) this.list.shift();
		const b = {
			x, y, z: o.z ?? rand(-40, 40),
			vx: o.vx ?? 0, vy: o.vy ?? 0, vz: o.vz ?? 0,
			g: o.g ?? 0, drag: o.drag ?? 1,
			size: o.size ?? 10, life: o.life ?? 1.5, age: 0,
			pop: o.pop ?? 0.2, shrink: o.shrink ?? 0.35,
			q: o.q ? o.q.clone() : randomQuat(o.face ?? 0),
			w: o.w ? o.w.clone() : new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)),
			flutter: o.flutter ?? 0, phase: Math.random() * 6.28,
			color: o.color ?? [1, 1, 1],
		};
		this.list.push(b);
		return b;
	}

	update(dt) {
		const list = this.list;
		const head = this.meshes[0];
		let n = 0;
		for (let i = 0; i < list.length; i++) {
			const b = list[i];
			b.age += dt;
			if (b.age >= b.life) continue;
			const damp = Math.exp(-b.drag * dt);
			if (b.flutter) {
				// Falling-leaf sway: sideways push and a matching rock.
				const s = Math.sin(b.age * 5 + b.phase);
				b.vx += s * b.flutter * dt;
				b.w.z += s * 4 * dt;
			}
			b.vx *= damp;
			b.vy = b.vy * damp + b.g * dt;
			b.vz *= damp;
			b.x += b.vx * dt;
			b.y += b.vy * dt;
			b.z += b.vz * dt;
			_w.copy(b.w).multiplyScalar(dt);
			const angle = _w.length();
			if (angle > 1e-6) {
				_dq.setFromAxisAngle(_w.divideScalar(angle), angle);
				b.q.premultiply(_dq);
			}
			const t = b.age / b.life;
			let s = b.size;
			if (b.pop > 0 && b.age < b.pop) s *= backOut(b.age / b.pop);
			const fade = 1 - b.shrink;
			if (t > fade) s *= 1 - easeIn((t - fade) / b.shrink);
			list[n] = b;
			_m.compose(_p.set(b.x, -b.y, b.z), b.q, _s.setScalar(Math.max(s, 1e-4)));
			head.setMatrixAt(n, _m);
			head.setColorAt(n, _c.setRGB(b.color[0], b.color[1], b.color[2], THREE.SRGBColorSpace));
			n++;
		}
		list.length = n;
		for (const mesh of this.meshes) mesh.count = n;
		if (n > 0) {
			head.instanceMatrix.clearUpdateRanges();
			head.instanceMatrix.addUpdateRange(0, n * 16);
			head.instanceMatrix.needsUpdate = true;
			head.instanceColor.clearUpdateRanges();
			head.instanceColor.addUpdateRange(0, n * 3);
			head.instanceColor.needsUpdate = true;
		}
		return n > 0;
	}
}

// Random orientation; face 1 keeps the model's front (+z) toward the viewer,
// only spun around the view axis.
export function randomQuat(face = 0) {
	const q = new THREE.Quaternion().setFromAxisAngle(_p.set(0, 0, 1), Math.random() * Math.PI * 2);
	if (face < 1) {
		const tilt = (1 - face) * rand(-Math.PI, Math.PI);
		q.premultiply(_q.setFromAxisAngle(_p.set(rand(-1, 1), rand(-1, 1), 0).normalize(), tilt));
	}
	return q;
}

const easeIn = (t) => t * t * t;
