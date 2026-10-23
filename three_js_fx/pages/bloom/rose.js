// Holding the button grows a rose out of the Blender petal: rings of petals
// that start as a closed bud and unfurl as the charge builds, spinning and
// trailing the cursor. Letting go blows every petal outward as a loose,
// tumbling petal, with hearts and glitter.
import * as THREE from 'three';
import { jewelMaterial } from './assets.js';
import { BOKEH, BOKEH_TINTS, FLAKE, GLITTER, GLOW, HEART, SPARKLE, STAR, pick, rand } from './sprites.js';

const RINGS = [
	{ n: 5, r: 1.5, len: 15, bud: 1.45, open: 0.95, color: [0.95, 0.2, 0.5] },
	{ n: 7, r: 3, len: 21, bud: 1.35, open: 0.62, color: [1.0, 0.35, 0.62] },
	{ n: 9, r: 5, len: 27, bud: 1.2, open: 0.32, color: [1.0, 0.55, 0.75] },
	{ n: 11, r: 7, len: 33, bud: 1.05, open: 0.08, color: [1.0, 0.75, 0.88] },
	{ n: 13, r: 9, len: 37, bud: 0.95, open: -0.12, color: [1.0, 0.88, 0.95] },
];
const COUNT = RINGS.reduce((a, r) => a + r.n, 0);
const GROW_S = 0.95;  // s to full bloom

const _m = new THREE.Matrix4();
const _r = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

export class Rose {
	constructor(scene, assets) {
		const mat = jewelMaterial(assets.matcap.petal, { map: assets.petalMap, glitter: 0.6, side: THREE.DoubleSide });
		this.mesh = new THREE.InstancedMesh(assets.geo.petal, mat, COUNT);
		this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		this.mesh.frustumCulled = false;
		this.mesh.count = 0;
		let i = 0;
		for (const ring of RINGS) for (let k = 0; k < ring.n; k++) this.mesh.setColorAt(i++, _c.setRGB(...ring.color, THREE.SRGBColorSpace));
		scene.add(this.mesh);
		this.charge = 0;
		this.active = false;
		this.x = 0;
		this.y = 0;
		this.spin = 0;
		this.size = 0;
		this.petals = [];   // world transform of each petal, for the release
	}

	update(dt, t, cursor, holding, fx) {
		if (holding && !this.active) {
			this.active = true;
			this.charge = 0;
			this.x = cursor.sx;
			this.y = cursor.sy;
			fx.sprites.burst(this.x, this.y, 24, 340, { tile: SPARKLE, size: 16, life: 0.4, add: 0.7, drag: 4 });
			fx.shockwave(this.x, this.y, 70, { life: 0.3 });
		}
		if (!this.active) return false;
		if (holding) this.charge = Math.min(1, this.charge + dt / GROW_S);

		// Trail the cursor on a soft spring, just above the hotspot.
		const f = 1 - Math.exp(-dt * 12);
		this.x += (cursor.sx - this.x) * f;
		this.y += (cursor.sy - 8 - this.y) * f;
		this.spin += dt * (1.2 + 3 * this.charge);
		const c = this.charge;
		const grow = easeOut(Math.min(1, c * 1.4));
		this.size = 0.5 + 1.3 * grow;
		const tiltX = THREE.MathUtils.clamp(cursor.vy / 2500, -0.6, 0.6) + 0.25;
		const tiltY = THREE.MathUtils.clamp(cursor.vx / 2500, -0.6, 0.6);
		_r.makeRotationFromEuler(_e.set(tiltX, tiltY, 0));
		_r.setPosition(this.x, -this.y, 0);

		let i = 0;
		this.petals.length = 0;
		RINGS.forEach((ring, ri) => {
			// Inner rings open later than outer ones.
			const local = THREE.MathUtils.clamp(c * 1.5 - ri * 0.1, 0, 1);
			const theta = ring.bud + (ring.open - ring.bud) * easeOut(local);
			const breathe = 0.04 * Math.sin(t * 6 + ri);
			for (let k = 0; k < ring.n; k++) {
				const phi = (k / ring.n) * Math.PI * 2 + ri * 0.7 + this.spin * (ri % 2 ? 1 : -0.6) * 0.3;
				_m.makeRotationZ(phi - Math.PI / 2);
				_m.multiply(new THREE.Matrix4().makeTranslation(0, ring.r * this.size, 0));
				_m.multiply(new THREE.Matrix4().makeRotationX(theta + breathe));
				_m.multiply(new THREE.Matrix4().makeScale(ring.len * this.size, ring.len * this.size, ring.len * this.size));
				_m.premultiply(_r);
				this.mesh.setMatrixAt(i, _m);
				_m.decompose(_p, _q, _s);
				this.petals.push({ x: _p.x, y: -_p.y, z: _p.z, q: _q.clone(), size: _s.x, ring: ri, phi });
				i++;
			}
		});
		this.mesh.count = COUNT;
		this.mesh.instanceMatrix.needsUpdate = true;

		// Magic being drawn in: glitter spirals into the bloom while it charges.
		if (holding) {
			const R = 90 + 70 * c;
			const n = Math.floor(rand(0, 1) + dt * (120 + 380 * c));
			const pull = { x: this.x, y: this.y, k: 34 };
			for (let j = 0; j < n; j++) {
				const a = Math.random() * Math.PI * 2;
				const r = R * rand(0.8, 1.3);
				const px = this.x + Math.cos(a) * r, py = this.y + Math.sin(a) * r;
				fx.sprites.spawn(px, py, {
					tile: Math.random() < 0.2 ? SPARKLE : FLAKE, size: rand(4, 11), life: 0.5, add: 0.55,
					vx: -Math.sin(a) * 340, vy: Math.cos(a) * 340, pull, drag: 3,
					color: pick(GLITTER), twinkle: 9, glint: true, spin: 6,
				});
			}
			// A halo of sparkles and stars orbiting the bloom, faster as it charges.
			for (let j = 0; j < 6; j++) {
				const a = t * (3 + 5 * c) + (j / 6) * Math.PI * 2;
				const r = (60 + 50 * c) * this.size / 1.8;
				fx.sprites.spawn(this.x + Math.cos(a) * r, this.y + Math.sin(a) * r * 0.55, { tile: j % 2 ? STAR : SPARKLE, size: 10 + 10 * c, color: j % 2 ? [1, 0.8, 0.35] : [1, 0.9, 1], add: j % 2 ? 0.3 : 0.8, life: dt * 1.01, rot: a, z: 200 });
			}
			if (Math.random() < dt * 30 * c) fx.shockwave(this.x, this.y, 40 + 60 * c, { life: 0.3, alpha: 0.35 * c, color: [1, 0.7, 0.95] });
			fx.sprites.spawn(this.x, this.y, { tile: GLOW, size: 140 + 140 * c, color: [1, 0.45, 0.8], alpha: 0.35 + 0.25 * Math.sin(t * 14) * c, add: 1, life: dt * 1.01, z: -80 });
			if (Math.random() < dt * (2 + 8 * c)) {
				fx.sprites.spawn(this.x + rand(-40, 40), this.y + rand(-10, 20), { tile: HEART, size: rand(10, 18), vy: -rand(80, 160), life: 0.9, add: 0.2, color: [1, 0.3, 0.6], pop: 0.15 });
			}
		}
		return true;
	}

	// Blow the bloom apart; strength follows the charge.
	release(fx) {
		if (!this.active) return;
		this.active = false;
		this.mesh.count = 0;
		const c = this.charge;
		const { x, y } = this;
		for (const p of this.petals) {
			const out = 260 + 800 * c * rand(0.6, 1.1);
			const a = p.phi + rand(-0.3, 0.3);
			// The petals leave at full size and dwindle all the way down.
			fx.petals.spawn(p.x, p.y, {
				z: p.z, q: p.q, size: p.size, pop: 0,
				vx: Math.cos(a) * out, vy: Math.sin(a) * out - 200 * c, vz: rand(-200, 200),
				g: 520, drag: 2.2, flutter: 500, life: rand(0.9, 1.5), shrink: 0.9,
				w: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-6, 6)),
				color: RINGS[p.ring].color,
			});
		}
		if (c < 0.2) return;
		const n = Math.round(4 + 10 * c);
		for (let i = 0; i < n; i++) {
			const a = (i / n) * Math.PI * 2;
			fx.hearts.spawn(x, y, { vx: Math.cos(a) * 700 * c, vy: Math.sin(a) * 700 * c - 300, g: 900, drag: 1.5, size: rand(10, 16), life: rand(1, 1.5), pop: 0.25, face: 0.8, w: new THREE.Vector3(0, rand(-10, 10), rand(-3, 3)), color: [1, 1, 1], z: 120 });
		}
		for (let i = 0; i < Math.round(10 * c); i++) {
			const a = Math.random() * Math.PI * 2;
			fx.blossoms.spawn(x, y, { vx: Math.cos(a) * 600, vy: Math.sin(a) * 600 - 200, g: 600, drag: 2, size: rand(14, 22), life: 1.4, pop: 0.3, face: 0.6, color: pick([[1, 0.8, 0.9], [1, 0.6, 0.8], [1, 1, 1]]) });
		}
		fx.glitter(x, y, Math.round(420 * c), 1700, { size: 7, life: 1.5 });
		fx.sprites.burst(x, y, 50, 1300, { tile: SPARKLE, size: 28, life: 0.5, drag: 5, add: 0.75, minSpeed: 0.8, color: [1, 0.85, 0.95] });
		fx.sprites.burst(x, y, 24, 900, { tile: BOKEH, size: 34, life: 0.9, drag: 3, alpha: 0.5, add: 0.95, minSpeed: 0.3, palette: BOKEH_TINTS });
		fx.sprites.burst(x, y, 30, 1100, { tile: HEART, size: 14, life: 1.0, drag: 3, g: 500, add: 0.2, pop: 0.1, palette: [[1, 0.3, 0.6], [1, 0.55, 0.8]] });
		fx.sprites.spawn(x, y, { tile: GLOW, size: 650 * c, grow: 0.6, color: [1, 0.5, 0.85], alpha: 0.9, add: 1, life: 0.35 });
		fx.flare(x, y, 340 * c);
		fx.shockwave(x, y, 320 * c, { life: 0.45 });
		fx.shockwave(x, y, 200 * c, { life: 0.35, color: [1, 0.9, 1] });
		fx.shockwave(x, y, 110 * c, { life: 0.25, color: [0.85, 0.6, 1] });
		fx.flash(0.6 * c);
		if (c > 0.8) fx.petalRain(x, 30);
	}
}

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
