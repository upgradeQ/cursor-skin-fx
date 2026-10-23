// The cursor sprite. It is drawn at full resolution on its own pixel grid,
// anchored so the hotspot lands exactly on the mouse, and transformed in sprite
// space with nearest sampling so squash, stretch and pops stay blocky.
import * as THREE from 'three';
import { art } from './art.js';
import { BAYER_GLSL } from './batch.js';
import { PALETTE_SIZE, INK, SKY, GOLD, LEMON, paletteVectors } from './palette.js';

const vertex = /* glsl */ `
out vec2 vScreen;

void main() {
	vec4 world = modelMatrix * vec4(position, 1.0);
	vScreen = world.xy;
	gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragment = /* glsl */ `
uniform highp sampler2D uAtlas;
uniform vec3 uPal[${PALETTE_SIZE}];
uniform vec4 uCell;    // atlas x, y, w, h
uniform vec2 uHot;     // hotspot in sprite pixels
uniform vec2 uOrigin;  // screen position of the sprite's top-left corner at rest
uniform float uScale;
uniform vec4 uInv;     // 2x2 matrix, rest cell -> sprite, about the hotspot
uniform float uFade;
uniform int uFill;     // palette index that replaces white pixels, -1 for none
uniform float uGlint;  // diagonal band position in sprite pixels
in vec2 vScreen;
${BAYER_GLSL}

vec4 texel(vec2 s) {
	ivec2 p = ivec2(floor(s));
	if (p.x < 0 || p.y < 0 || p.x >= int(uCell.z) || p.y >= int(uCell.w)) return vec4(0.0);
	return texelFetch(uAtlas, ivec2(uCell.xy) + p, 0);
}

void main() {
	vec2 cell = floor((vScreen - uOrigin) / uScale + 0.001);
	vec2 dither = cell + 64.0;
	if (uFade < 0.999 && uFade <= bayer(dither)) discard;
	vec2 q = cell + 0.5 - uHot;
	vec2 s = vec2(uInv.x * q.x + uInv.y * q.y, uInv.z * q.x + uInv.w * q.y) + uHot;
	vec4 t = texel(s);
	if (t.a < 0.1) discard;
	vec3 col;
	if (t.a > 0.55 && t.a < 0.85) {
		col = uPal[${INK}];
	} else {
		col = t.rgb;
		bool white = col.r + col.g + col.b > 2.55;
		if (white && uFill >= 0) col = uPal[uFill];
		float g = s.x + s.y - uGlint;
		if (white && g >= 0.0 && g < 2.0) col = uPal[g < 1.0 ? ${LEMON} : ${GOLD}];
	}
	gl_FragColor = vec4(col, 1.0);
}
`;

// shape -> [main sprite, frames, badge sprite, badge frames, badge x, badge y]
const LOOKS = {
	default: ['arrow', 1],
	pointer: ['glove', 1],
	text: ['ibeam', 1],
	wait: ['coin', 8],
	progress: ['arrow', 1, 'minicoin', 4, 8, 10],
	help: ['arrow', 1, 'qmark', 1, 9, 9],
	crosshair: ['reticle', 1],
	move: ['move', 1],
	'not-allowed': ['noentry', 1],
	'ew-resize': ['ew', 1],
	'ns-resize': ['ns', 1],
	'nwse-resize': ['nwse', 1],
	'nesw-resize': ['nesw', 1],
};

// Where effects that follow the cursor attach, relative to the hotspot in sprite pixels.
const BODY = { arrow: [3, 6], glove: [1, 7] };

const frames = (name, n) => (n === 1 ? [art.get(name)] : Array.from({ length: n }, (_, i) => art.get(name + i)));

function look(shape) {
	const l = LOOKS[shape] || LOOKS.default;
	return {
		shape,
		main: frames(l[0], l[1]),
		badge: l[2] ? frames(l[2], l[3]) : null,
		bx: l[4] || 0,
		by: l[5] || 0,
		body: BODY[l[0]] || [0, 0],
	};
}

const OUT = 0.05;   // seconds the old shape takes to shrink away
const IN = 0.17;    // seconds the new one takes to pop in
const NONE = -1;

function sprite(atlas) {
	const uniforms = {
		uAtlas: { value: atlas },
		uPal: { value: paletteVectors() },
		uCell: { value: new THREE.Vector4() },
		uHot: { value: new THREE.Vector2() },
		uOrigin: { value: new THREE.Vector2() },
		uScale: { value: 4 },
		uInv: { value: new THREE.Vector4(1, 0, 0, 1) },
		uFade: { value: 1 },
		uFill: { value: NONE },
		uGlint: { value: -100 },
	};
	const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
		uniforms,
		vertexShader: vertex,
		fragmentShader: fragment,
		side: THREE.DoubleSide,
		depthTest: false,
		depthWrite: false,
		blending: THREE.NoBlending,
	}));
	mesh.frustumCulled = false;
	mesh.matrixAutoUpdate = false;
	return { mesh, u: uniforms };
}

export class CursorView {
	constructor(scene) {
		this.main = sprite(art.texture);
		this.badge = sprite(art.texture);
		this.main.mesh.renderOrder = 1;
		this.badge.mesh.renderOrder = 2;
		scene.add(this.main.mesh, this.badge.mesh);

		this.scale = 4;
		this.look = look('default');
		this.next = null;       // look waiting for the pop-out to finish
		this.popT = IN;         // seconds into the pop-in
		this.outT = 0;
		this.fade = 0;
		this.squash = 1;        // spring: vertical scale, horizontal is its inverse
		this.squashV = 0;
		this.squashTarget = 1;
		this.flashT = 0;
		this.stretch = 0;
		this.dirX = 1;      // absolute direction components of the motion
		this.dirY = 0;
		this.time = 0;
		this.onSwap = null;     // fn(look) when a new shape pops in
		this.frame = this.look.main[0];
	}

	get visible() {
		return this.fade > 0;
	}

	setScale(scale) {
		this.scale = scale;
	}

	setShape(shape) {
		if (shape === (this.next || this.look).shape) return;
		this.next = look(shape);
		if (this.outT <= 0) this.outT = OUT;
	}

	press() {
		this.squashTarget = 0.72;
		this.squashV -= 6;
		this.flashT = 0.06;
	}

	release(power = 0) {
		this.squashTarget = 1;
		this.squashV += 9 + power * 10;
	}

	// Snap in at a new position: no fly-in, just a pop.
	show() {
		this.popT = 0;
		this.fade = 1;
	}

	update(dt, cursor) {
		this.time += dt;
		const fadeRate = cursor.visible ? 1 / 0.06 : 1 / 0.12;
		this.fade = Math.min(1, Math.max(0, this.fade + (cursor.visible ? fadeRate : -fadeRate) * dt));

		if (this.outT > 0) {
			this.outT -= dt;
			if (this.outT <= 0) {
				this.look = this.next;
				this.next = null;
				this.popT = 0;
				if (this.onSwap) this.onSwap(this.look);
			}
		} else {
			this.popT = Math.min(IN, this.popT + dt);
		}

		// Stiff, lightly damped spring: one punchy overshoot, settled in ~0.2 s.
		const k = 1600;
		const c = 24;
		this.squashV += ((this.squashTarget - this.squash) * k - this.squashV * c) * dt;
		this.squash += this.squashV * dt;
		this.flashT = Math.max(0, this.flashT - dt);

		const s = cursor.speed;
		const want = Math.min(1, Math.max(0, (s - 1200) / 2400));
		this.stretch += (want - this.stretch) * Math.min(1, dt * (want > this.stretch ? 30 : 14));
		if (s > 60) {
			this.dirX = Math.abs(cursor.vx) / s;
			this.dirY = Math.abs(cursor.vy) / s;
		}

		this.draw(cursor);
	}

	pop() {
		if (this.outT > 0) return Math.max(0.15, this.outT / OUT);
		const t = this.popT / IN;
		if (t >= 1) return 1;
		// Back-out ease from 0.35 with a 25% overshoot.
		const u = t - 1;
		const b = 3.2;
		return 0.35 + 0.65 * (1 + (b + 1) * u * u * u + b * u * u);
	}

	draw(cursor) {
		const l = this.look;
		const visible = this.fade > 0;
		this.main.mesh.visible = visible;
		this.badge.mesh.visible = visible && l.badge !== null;
		if (!visible) return;

		const sc = this.scale;
		const shape = l.shape;
		const idle = cursor.idle;
		const spinning = l.main.length > 1;
		const e = l.main[spinning ? Math.floor(this.time * 14) % l.main.length : 0];
		this.frame = e;

		// Sprite -> screen transform, about the hotspot.
		const pop = this.pop();
		let sy = this.squash;
		if (idle > 2 && !spinning && Math.floor(idle * 2.5) % 2 === 1) sy *= 0.94;
		let sx = 1 / Math.max(0.6, sy);
		sx *= pop;
		sy *= pop;
		// Axis-aligned stretch along the dominant motion axes: doubled rows and
		// columns read as a smear frame, where a rotated stretch would shred the art.
		const st = this.stretch * 0.3;
		sx *= 1 + st * this.dirX;
		sy *= 1 + st * this.dirY;
		const u = this.main.u;
		u.uInv.value.set(1 / sx, 0, 0, 1 / sy);

		u.uCell.value.set(e.x, e.y, e.w, e.h);
		u.uHot.value.set(e.hx, e.hy);
		u.uScale.value = sc;
		const ox = Math.round(cursor.x - e.hx * sc);
		const oy = Math.round(cursor.y - e.hy * sc);
		u.uOrigin.value.set(ox, oy);
		u.uFade.value = this.fade;

		let fill = NONE;
		if (this.flashT > 0) fill = GOLD;
		else if (shape === 'text' && idle > 0.5 && Math.floor(idle * 1.8) % 2 === 1) fill = SKY;
		u.uFill.value = fill;
		const glintPeriod = 2.4;
		const g = idle > 2 && !spinning ? ((idle - 2) % glintPeriod) * 40 - 4 : -100;
		u.uGlint.value = g;

		const ext = (Math.max(e.w, e.h) * 1.6 + 2) * sc;
		this.place(this.main.mesh, ox + e.hx * sc, oy + e.hy * sc, ext);

		if (l.badge) {
			const be = l.badge[l.badge.length > 1 ? Math.floor(this.time * 12) % l.badge.length : 0];
			const bu = this.badge.u;
			bu.uCell.value.set(be.x, be.y, be.w, be.h);
			bu.uHot.value.set(be.w / 2, be.h / 2);
			bu.uScale.value = sc;
			const bx = ox + l.bx * sc;
			const by = oy + l.by * sc;
			bu.uOrigin.value.set(bx, by);
			bu.uInv.value.set(1 / pop, 0, 0, 1 / pop);
			bu.uFade.value = this.fade;
			bu.uFill.value = fill === GOLD ? NONE : fill;
			this.place(this.badge.mesh, bx + be.w * sc / 2, by + be.h * sc / 2, Math.max(be.w, be.h) * 1.4 * sc);
		}
	}

	place(mesh, cx, cy, half) {
		mesh.matrix.makeScale(half * 2, half * 2, 1).setPosition(cx, cy, 0);
		mesh.matrixWorldNeedsUpdate = true;
	}
}
