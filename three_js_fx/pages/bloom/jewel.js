// The cursor: a pink pearl jewel modelled in Blender for each silhouette
// (arrow, hand, I-beam, busy ring), with glitter in its finish. It tilts into
// the direction of travel, squashes on clicks, swaps shape with a springy
// pop, a band of light sweeps across it every couple of seconds, two gold
// stars orbit it trailing glitter, and glitter drips from it all the time.
import * as THREE from 'three';
import { jewelMaterial } from './assets.js';
import { FLAKE, GLITTER, GLOW, SPARKLE, pick, rand } from './sprites.js';

const SHAPES = { default: 'arrow', pointer: 'hand', text: 'beam', wait: 'ring', progress: 'ring' };
const KINDS = ['arrow', 'hand', 'beam', 'ring'];
const SCALE = 1.12;   // model px -> page px
const Z = 400;        // in front of everything else
const SHINE_EVERY = 1.9; // s between light sweeps

export class Jewel {
	constructor(scene, assets, renderer) {
		this.renderer = renderer;
		this.shine = { value: new THREE.Vector3(0, 0, 1e5) };
		this.group = new THREE.Group();
		this.group.position.z = Z;
		scene.add(this.group);
		const pearl = jewelMaterial(assets.matcap.pearl, { glitter: 0.9, rim: 0.8, shine: this.shine });
		pearl.color.set(0xffb8dc);
		this.shapes = KINDS.map((k) => {
			const mesh = new THREE.Mesh(assets.geo[`cursor_${k}`], pearl);
			mesh.scale.setScalar(0);
			this.group.add(mesh);
			return { mesh, amount: 0, vel: 0 };
		});
		const gold = jewelMaterial(assets.matcap.gold, { glitter: 1.2 });
		this.stars = [0, 1].map(() => {
			const m = new THREE.Mesh(assets.geo.star, gold);
			scene.add(m);
			return m;
		});
		this.kind = 'arrow';
		this.visible = 0;     // 0..1 presence, sprung
		this.visVel = 0;
		this.squash = 0;      // sprung click squash
		this.squashVel = 0;
		this.tilt = new THREE.Vector2();
		this.shineAt = 0;
	}

	setShape(shape) {
		const kind = SHAPES[shape] ?? 'arrow';
		if (kind === this.kind) return false;
		this.kind = kind;
		return true;
	}

	snapShape(shape) {
		this.setShape(shape);
		for (const s of this.shapes) s.amount = s.vel = 0;
	}

	click(strength = 1) {
		this.squashVel -= 26 * strength;
		this.shineAt = -1;   // a click sends a sweep across straight away
	}

	update(dt, t, cursor, sprites) {
		const target = cursor.visible ? 1 : 0;
		this.visVel += ((target - this.visible) * 260 - this.visVel * 20) * dt;
		this.visible = Math.max(0, this.visible + this.visVel * dt);
		this.squashVel += (-this.squash * 600 - this.squashVel * 18) * dt;
		this.squash += this.squashVel * dt;

		// Each silhouette springs toward 1 when current, 0 otherwise; the
		// underdamped spring gives the swap its bounce.
		for (let i = 0; i < KINDS.length; i++) {
			const s = this.shapes[i];
			const goal = KINDS[i] === this.kind ? 1 : 0;
			s.vel += ((goal - s.amount) * (goal ? 420 : 900) - s.vel * (goal ? 16 : 40)) * dt;
			s.amount = Math.max(0, s.amount + s.vel * dt);
			s.mesh.visible = s.amount > 0.002;
		}

		// Lean into the motion like a jewel on a string.
		const k = 1 / 2600;
		const tx = THREE.MathUtils.clamp(cursor.vy * k, -0.75, 0.75);
		const ty = THREE.MathUtils.clamp(cursor.vx * k, -0.75, 0.75);
		this.tilt.x += (tx - this.tilt.x) * (1 - Math.exp(-dt * 14));
		this.tilt.y += (ty - this.tilt.y) * (1 - Math.exp(-dt * 14));
		const idle = Math.min(1, cursor.idle / 0.6);
		this.group.position.set(cursor.sx, -cursor.sy, Z);
		this.group.rotation.set(
			this.tilt.x + idle * 0.18 * Math.sin(t * 2.1),
			this.tilt.y + idle * 0.3 * Math.sin(t * 1.6),
			0,
		);
		const sq = this.squash;
		this.group.scale.set(SCALE * (1 - sq * 0.5), SCALE * (1 + sq), SCALE * (1 - sq * 0.5)).multiplyScalar(this.visible);
		for (let i = 0; i < KINDS.length; i++) this.shapes[i].mesh.scale.setScalar(this.shapes[i].amount);

		// The busy ring spins and wobbles.
		const ring = this.shapes[3].mesh;
		ring.rotation.set(0.6 * Math.sin(t * 3), 0.6 * Math.cos(t * 3), -t * 9);
		ring.position.set(0, 0, 0);

		// The light sweep, in device px with y up as gl_FragCoord has it.
		const pr = this.renderer.getPixelRatio();
		const since = t - this.shineAt;
		if (since > SHINE_EVERY || this.shineAt < 0) this.shineAt = t;
		const sweep = Math.min(1, (t - this.shineAt) / 0.4);
		this.shine.value.set(cursor.sx * pr, (innerHeight - cursor.sy) * pr, (-30 + 75 * sweep) * pr * SCALE + (sweep >= 1 ? 1e5 : 0));

		// Two gold stars orbit the body of the cursor, passing behind and in front.
		const cx = cursor.sx + (this.kind === 'arrow' ? 9 : this.kind === 'hand' ? 6 : 0);
		const cy = cursor.sy + (this.kind === 'arrow' ? 14 : this.kind === 'hand' ? 14 : 0);
		for (let i = 0; i < 2; i++) {
			const a = t * 4.2 + i * Math.PI;
			const star = this.stars[i];
			star.position.set(cx + Math.cos(a) * 30, -(cy + Math.sin(a) * 10 - 6), Z + Math.sin(a) * 40);
			star.rotation.set(0.4, t * 5 + i, t * 3);
			star.scale.setScalar(8.5 * this.visible * (0.85 + 0.15 * Math.sin(a)));
			if (this.visible > 0.5 && Math.random() < dt * 40) {
				sprites.spawn(star.position.x, -star.position.y, { tile: FLAKE, size: rand(3, 6), life: rand(0.4, 0.7), g: 90, add: 0.5, twinkle: 9, glint: true, color: pick([[1, 0.8, 0.35], [1, 0.9, 0.6], [1, 0.6, 0.85]]), z: 300 });
			}
		}

		if (this.visible > 0.05) {
			// Soft shadow so the jewel sits on light pages, pink halo for dark ones.
			const v = Math.min(1, this.visible);
			sprites.spawn(cursor.sx + 10, cursor.sy + 18, { tile: GLOW, size: 52, color: [0.35, 0.05, 0.2], alpha: 0.22 * v, add: 0, life: dt * 1.01, z: -100 });
			sprites.spawn(cursor.sx + 8, cursor.sy + 12, { tile: GLOW, size: 90, color: [1, 0.4, 0.8], alpha: 0.35 * v, add: 1, life: dt * 1.01, z: -100 });
			// A constant drip of glitter off the jewel.
			const drip = Math.floor(rand(0, 1) + dt * 55 * v);
			for (let i = 0; i < drip; i++) {
				sprites.spawn(cursor.sx + rand(-2, 16), cursor.sy + rand(4, 26), { tile: FLAKE, size: rand(3, 7), life: rand(0.6, 1.2), vx: rand(-30, 30), vy: rand(-20, 30), g: 170, drag: 1, add: 0.45, twinkle: rand(5, 11), glint: true, spin: rand(-6, 6), color: pick(GLITTER) });
			}
			if (Math.random() < dt * 9) {
				sprites.spawn(cursor.sx + (Math.random() - 0.2) * 26, cursor.sy + Math.random() * 30, { tile: SPARKLE, size: 10 + Math.random() * 14, color: [1, 0.55, 0.85], add: 0.55, life: 0.35, pop: 0.08, spin: 3, z: 500 });
			}
		}
		return this.visible > 0.002 || Math.abs(this.visVel) > 0.01;
	}
}
