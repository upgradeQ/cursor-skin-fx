// The cursor as a live conductor: a dark glass body outlined by a jittering
// white-hot filament, with small arcs crawling over it. Shapes swap with a
// pop and a crack of sparks. Units are page pixels around the hotspot, y down.
import * as THREE from 'three';
import { jagged, rand } from './bolts.js';

const circle = (r, n = 40, cx = 0, cy = 0) => {
	const pts = [];
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2;
		pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
	}
	return pts;
};

const rotate = (pts, a) => pts.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);

const ARROW = [[0, 0], [0, 31], [7.8, 24.2], [12.6, 35.6], [19.05, 32.88], [14.25, 21.48], [22.6, 21.5]].map(([x, y]) => [x * 0.9, y * 0.9]);
const BOLT = [[3, 0], [15, 0], [9, 12], [17, 12], [-1, 34], [4, 17], [-4, 17]];
const IBEAM = [[-6, -13], [6, -13], [6, -10.5], [1.4, -10.5], [1.4, 10.5], [6, 10.5], [6, 13], [-6, 13], [-6, 10.5], [-1.4, 10.5], [-1.4, -10.5], [-6, -10.5]];

function plus(L, w) {
	return [[-w, -L], [w, -L], [w, -w], [L, -w], [L, w], [w, w], [w, L], [-w, L], [-w, w], [-L, w], [-L, -w], [-w, -w]];
}

function doubleArrow() {
	const L = 15, b = 8.2, h = 6.6, a = 2.5;
	return [[-L, 0], [-b, -h], [-b, -a], [b, -a], [b, -h], [L, 0], [b, h], [b, a], [-b, a], [-b, h]];
}

function fourArrow() {
	const L = 15, b = 8.6, h = 5.8, a = 2.3;
	const pts = [];
	for (let k = 0; k < 4; k++) {
		const arm = [[a, -a], [b, -a], [b, -h], [L, 0], [b, h], [b, a]];
		pts.push(...rotate(arm, (k * Math.PI) / 2));
	}
	return pts;
}

// Each shape: pieces { outer, holes } and an optional spinner ring { x, y, r }.
const SHAPES = {
	default: { pieces: [{ outer: ARROW }] },
	help: { pieces: [{ outer: ARROW }, { outer: circle(3.2, 16, 24, 6) }] },
	pointer: { pieces: [{ outer: BOLT }] },
	text: { pieces: [{ outer: IBEAM }] },
	wait: { pieces: [{ outer: circle(12), holes: [circle(7.5).reverse()] }], spinner: { x: 0, y: 0, r: 17 } },
	progress: { pieces: [{ outer: ARROW }, { outer: circle(6.5, 28, 24, 30), holes: [circle(3.6, 20, 24, 30).reverse()] }], spinner: { x: 24, y: 30, r: 10 } },
	crosshair: { pieces: [{ outer: plus(13, 1.4) }] },
	move: { pieces: [{ outer: fourArrow() }] },
	'not-allowed': { pieces: [{ outer: circle(12), holes: [circle(8.6).reverse()] }, { outer: rotate([[-9, -1.6], [9, -1.6], [9, 1.6], [-9, 1.6]], Math.PI / 4) }] },
	'ew-resize': { pieces: [{ outer: doubleArrow() }] },
	'ns-resize': { pieces: [{ outer: rotate(doubleArrow(), Math.PI / 2) }] },
	'nwse-resize': { pieces: [{ outer: rotate(doubleArrow(), Math.PI / 4) }] },
	'nesw-resize': { pieces: [{ outer: rotate(doubleArrow(), -Math.PI / 4) }] },
};

// Points every `step` px along a closed loop, as a flat list.
function resample(loop, step = 3) {
	const out = [];
	for (let i = 0; i < loop.length; i++) {
		const [x0, y0] = loop[i];
		const [x1, y1] = loop[(i + 1) % loop.length];
		const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
		for (let k = 0; k < n; k++) out.push(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n);
	}
	return out;
}

const FILL_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uCharge;
varying vec2 vP;
void main() {
	vec3 col = mix(vec3(0.02, 0.035, 0.09), vec3(0.1, 0.22, 0.6), uCharge * 0.6 + 0.15 * smoothstep(30.0, 0.0, length(vP)));
	gl_FragColor = vec4(col, 0.82) * uOpacity;
}
`;

const FILL_VERT = /* glsl */ `
varying vec2 vP;
void main() {
	vP = position.xy;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export class VoltCursor {
	constructor(scene) {
		this.alpha = 0;
		this.shape = 'default';
		this.charge = 0;
		this.entries = new Map();
		for (const [name, def] of Object.entries(SHAPES)) {
			const shapes = def.pieces.map(({ outer, holes = [] }) => {
				const s = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
				for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
				return s;
			});
			const material = new THREE.ShaderMaterial({
				uniforms: { uOpacity: { value: 0 }, uCharge: { value: 0 } },
				vertexShader: FILL_VERT,
				fragmentShader: FILL_FRAG,
				transparent: true,
				premultipliedAlpha: true,
				blending: THREE.NormalBlending,
				depthTest: false,
				depthWrite: false,
				side: THREE.DoubleSide,
			});
			const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shapes, 6), material);
			mesh.renderOrder = 10;
			mesh.frustumCulled = false;
			mesh.visible = false;
			scene.add(mesh);
			const loops = def.pieces.flatMap(({ outer, holes = [] }) => [outer, ...holes]).map((l) => resample(l));
			this.entries.set(name, { name, def, mesh, material, loops, presence: name === 'default' ? 1 : 0, pop: 1 });
		}
		this.jitter = new Map();
		this.nextJitter = 0;
		this.crawl = [];
		this.nextCrawl = 0;
	}

	setShape(shape) {
		this.shape = this.entries.has(shape) ? shape : 'default';
		this.entries.get(this.shape).pop = 0.55;
	}

	snapShape(shape) {
		this.setShape(shape);
		for (const e of this.entries.values()) e.presence = e.name === this.shape ? 1 : 0;
	}

	// A random point on the current outline, in page pixels.
	randomPoint(cursor) {
		const loops = this.entries.get(this.shape).loops;
		const loop = loops[Math.floor(Math.random() * loops.length)];
		const i = Math.floor(Math.random() * (loop.length / 2)) * 2;
		return [cursor.x + loop[i], cursor.y + loop[i + 1]];
	}

	update(dt, t, cursor, ribbons, glows) {
		const target = cursor.visible ? 1 : 0;
		const rate = cursor.visible ? dt / 0.08 : dt / 0.12;
		this.alpha = target > this.alpha ? Math.min(1, this.alpha + rate) : Math.max(0, this.alpha - rate);
		if (this.alpha <= 0) {
			for (const e of this.entries.values()) e.mesh.visible = false;
			return false;
		}

		const regen = t >= this.nextJitter;
		if (regen) this.nextJitter = t + 1 / 30;
		const flicker = 0.85 + 0.15 * Math.sin(t * 61) * Math.sin(t * 37);

		for (const e of this.entries.values()) {
			const want = e.name === this.shape ? 1 : 0;
			e.presence += Math.sign(want - e.presence) * Math.min(Math.abs(want - e.presence), dt / 0.1);
			e.pop += (1 - e.pop) * (1 - Math.exp(-dt * 18));
			const op = this.alpha * e.presence;
			e.mesh.visible = op > 0.003;
			if (!e.mesh.visible) continue;
			const scale = e.name === this.shape ? e.pop : 1 + (1 - e.presence) * 0.4;
			e.mesh.position.set(cursor.x, cursor.y, 0);
			e.mesh.scale.setScalar(scale);
			e.material.uniforms.uOpacity.value = op;
			e.material.uniforms.uCharge.value = this.charge;

			// Filament: the outline shivering by a fraction of a pixel, re-cut at 30 Hz.
			const amp = 0.5 + this.charge * 1.4;
			e.loops.forEach((loop, li) => {
				const key = `${e.name}:${li}`;
				let pts = this.jitter.get(key);
				if (!pts || regen) {
					pts = loop.map((v) => v + rand(-amp, amp));
					this.jitter.set(key, pts);
				}
				const world = new Array(pts.length);
				for (let i = 0; i < pts.length; i += 2) {
					world[i] = cursor.x + pts[i] * scale;
					world[i + 1] = cursor.y + pts[i + 1] * scale;
				}
				ribbons.add(world, 9 + this.charge * 8, 1.1 + this.charge * 0.6, op * flicker * (0.75 + this.charge * 0.6), { closed: true, hue: 0.15 });
			});

			const spin = e.def.spinner;
			if (spin) {
				for (let k = 0; k < 3; k++) {
					const a0 = t * 7 + (k * Math.PI * 2) / 3;
					const arc = [];
					for (let s = 0; s <= 8; s++) {
						const a = a0 + s * 0.09;
						const r = spin.r + rand(-1, 1);
						arc.push(cursor.x + (spin.x + Math.cos(a) * r) * scale, cursor.y + (spin.y + Math.sin(a) * r) * scale);
					}
					ribbons.add(arc, 10, 1.4, op, { taper: 0.9, hue: 0.5 });
				}
			}
		}

		this._crawl(dt, t, cursor, ribbons, glows);
		return true;
	}

	// Short arcs that hop between neighbouring points of the outline.
	_crawl(dt, t, cursor, ribbons, glows) {
		if (t >= this.nextCrawl && cursor.visible) {
			this.nextCrawl = t + rand(0.05, 0.22) / (1 + this.charge * 3);
			const [ax, ay] = this.randomPoint(cursor);
			const a = Math.random() * Math.PI * 2;
			const l = rand(8, 18) * (1 + this.charge);
			this.crawl.push({ ax, ay, dx: Math.cos(a) * l, dy: Math.sin(a) * l, ox: ax - cursor.x, oy: ay - cursor.y, born: t, life: rand(0.06, 0.14) });
		}
		this.crawl = this.crawl.filter((c) => t - c.born < c.life);
		for (const c of this.crawl) {
			const x = cursor.x + c.ox, y = cursor.y + c.oy;
			const k = 1 - (t - c.born) / c.life;
			ribbons.add(jagged(x, y, x + c.dx, y + c.dy, 0.35, 3), 7, 0.9, this.alpha * k, { taper: 0.8, hue: 0.3 });
			glows.add(x, y, 10, this.alpha * k * 0.5, 0.2, 0.8);
		}
	}
}
