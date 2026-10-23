// Holding the button grows a glass orb at the hotspot: an analytically
// ray-traced sphere that refracts, with a touch of dispersion toward the rim,
// a tiny world sealed inside it (a round green hill, a round-canopied tree,
// bushes, flowers and drifting clouds under a sky with the sun in it). Over
// it go sky reflections weighted by Fresnel, an Aero gloss cap, a sun glint,
// a caustic along the bottom inner edge and a crisp rim. The world turns
// slowly and rolls with a drag; the orb rides a spring that lags behind the
// cursor and bobs. Let go and it floats up and dissolves into butterflies.
import { layerMesh, ORDER, premultipliedMaterial, quadGeometry } from './gl.js';
import { PALETTE_GLSL, SCENE_GLSL } from './world.js';
import { orbCrumb, orbRelease } from './bursts.js';

const GROW_S = 0.75;          // s of holding to reach full size
const RADIUS = 70;            // px at full size
const MIN_RELEASE = 0.3;      // growth needed to float away; less just shrinks back
const SHRINK_RATE = 5;        // 1/s, growth lost after an early release
const SPRING_K = 110;         // 1/s², centre pulled toward the cursor
const SPRING_DAMP = 8;        // 1/s, underdamped: it lags, overshoots a little and settles
const BOB_PX = 3;
const FLOAT_S = 1.05;         // s to rise and dissolve after release
const RISE_ACCEL = 260;       // px/s² upward while floating
const BASE_SPIN = 0.45;       // rad/s the world turns on its own
const ROLL = 0.35;            // share of a drag's rolling speed passed to the world
const PITCH = 0.42;           // rad the world leans toward the viewer so the meadow shows
const CRUMB_RATE = 26;        // leaves and sparkles shed per second while dissolving

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const COMMON = /* glsl */ `
uniform vec4 uOrb[5];
#define oA uOrb[0]   // centre xy (page px), radius px, opacity
#define oB uOrb[1]   // dissolve 0..1, unused, aura, seed
// uOrb[2..4]: world-from-view rotation, by columns

const float EXTENT = 1.45;        // quad half size in radii: room for shadow and aura
`;

const VERTEX = /* glsl */ `
in vec2 position;
out vec2 vP;

void main() {
	vP = position * EXTENT;
	gl_Position = clipFromPage(oA.xy + vP * oA.z);
}
`;

const FRAGMENT = /* glsl */ `
in vec2 vP;
out vec4 fragColor;

const vec3 LIGHT_VIEW = vec3(-0.50, 0.72, 0.48);  // key light, view space (y up, z to the viewer)
const vec3 SUN_VIEW = vec3(-0.42, 0.48, -0.77);   // the sun in the little sky, behind the hill
const vec3 GLINT_VIEW = vec3(-0.55, 0.10, 0.83);  // where the sharp sun glint sits on the glass
const vec3 RIM_TINT = vec3(0.78, 0.98, 1.00);
const vec3 CAUSTIC = vec3(0.85, 1.00, 0.62);
const vec3 BURN = vec3(0.80, 1.00, 0.66);

// What the outside of the glass reflects: sky above, a bright horizon, meadow below.
vec3 envView(vec3 r) {
	vec3 sky = skyGradient(1.0 - clamp(r.y * 1.2, 0.0, 1.0));
	vec3 ground = mix(GRASS, GRASS_DEEP, clamp(-r.y * 2.0, 0.0, 1.0));
	vec3 c = mix(ground, sky, smoothstep(-0.12, 0.04, r.y));
	c += vec3(1.0) * exp(-r.y * r.y * 120.0) * 0.35;
	return c;
}

void main() {
	float px = 1.0 / (uPr * oA.z);     // one device pixel in orb radii
	float dissolve = oB.x;
	vec2 p = vP;
	float r = length(p);

	// a soft shadow below, and an aura while it grows
	vec2 sp = (p - vec2(0.12, 0.34)) * vec2(1.0, 1.4);
	// hidden under the glass until it dissolves, so it has to go first
	float sh = 0.24 * (1.0 - smoothstep(0.45, 1.15, length(sp))) * max(1.0 - dissolve * 4.0, 0.0);
	vec4 col = vec4(SHADOW_INK * sh, sh);
	float halo = exp(-max(r - 1.0, 0.0) * 7.0) * step(1.0, r) * oB.z * 0.35;
	col = over(vec4(vec3(0.55, 0.95, 0.85) * halo, halo * 0.5), col);

	float lineCov = clamp(0.5 - (r - 1.0 - 1.1 * px) / px, 0.0, 1.0);
	if (lineCov <= 0.0) { fragColor = col * oA.w; return; }
	// only a ring: a filled disc would show through where the glass dissolves
	float ring = clamp((r - 1.0 + 2.0 * px) / px, 0.0, 1.0);
	col = over(vec4(OUTLINE_TEAL, 1.0) * 0.8 * lineCov * ring * (1.0 - dissolve), col);
	float bodyCov = clamp(0.5 - (r - 1.0) / px, 0.0, 1.0);
	if (bodyCov <= 0.0) { fragColor = col * oA.w; return; }

	vec2 pp = p * min(1.0, 0.998 / max(r, 1e-4));
	float rr = length(pp);
	float nz = sqrt(max(1.0 - rr * rr, 0.0));
	vec3 n = vec3(pp.x, -pp.y, nz);
	vec3 V = vec3(0.0, 0.0, -1.0);
	mat3 M = mat3(uOrb[2].xyz, uOrb[3].xyz, uOrb[4].xyz);
	vec3 L = M * normalize(LIGHT_VIEW);
	vec3 sun = M * normalize(SUN_VIEW);
	float t = uTime;
	vec3 ro = M * n;

	vec3 world = sceneColor(ro, M * refract(V, n, 1.0 / 1.22), L, sun, t);
	float spread = smoothstep(0.6, 0.85, rr);
	if (spread > 0.0) {
		// a touch of dispersion toward the rim: red bends less, blue more
		vec3 cr = sceneColor(ro, M * refract(V, n, 1.0 / 1.16), L, sun, t);
		vec3 cb = sceneColor(ro, M * refract(V, n, 1.0 / 1.29), L, sun, t);
		world = mix(world, vec3(cr.r, world.g, cb.b), spread);
	}

	float fres = 0.04 + 0.96 * pow(1.0 - nz, 5.0);
	vec3 body = mix(world, envView(reflect(V, n)), fres);
	// the glass deepens to aqua toward the rim
	body = mix(body, body * vec3(0.70, 0.90, 0.96), smoothstep(0.75, 1.0, rr) * 0.5);
	// caustic: light gathered along the bottom inner edge
	float below = smoothstep(0.1, 0.85, pp.y / max(rr, 1e-3));
	float band = smoothstep(0.62, 0.9, rr) * (1.0 - smoothstep(0.9, 0.99, rr));
	body += CAUSTIC * below * band * 0.6;
	// crisp Fresnel rim, brightest on top
	body = mix(body, RIM_TINT, smoothstep(0.9, 1.0, rr) * (0.35 + 0.3 * clamp(-pp.y, 0.0, 1.0)));
	// the Aero gloss cap: bright at the top, fading down to a crisp lower edge
	vec2 gq = (pp - vec2(0.0, -0.47)) / vec2(0.74, 0.44);
	float gcov = clamp(0.5 - (length(gq) - 1.0) * 0.44 / px, 0.0, 1.0);
	float gfade = mix(0.72, 0.04, clamp((pp.y + 0.91) / 0.88, 0.0, 1.0));
	body = mix(body, vec3(1.0), gcov * gfade);
	// a sharp sun glint
	body += vec3(1.0, 0.98, 0.9) * pow(max(dot(n, normalize(GLINT_VIEW)), 0.0), 500.0) * 1.6;

	float keep = 1.0;
	float burn = 0.0;
	if (dissolve > 0.0) {
		float nn = noise2(pp * 4.5 + oB.w * 13.0) * 0.62 + noise2(pp * 12.0 - oB.w * 7.0) * 0.38;
		float th = dissolve * 1.15 - 0.08;
		keep = smoothstep(th, th + 0.05, nn);
		float bk = (nn - th) / 0.07;
		burn = exp(-bk * bk) * step(0.001, dissolve);
	}
	col = over(vec4(body, 1.0) * bodyCov * keep, col);
	col += vec4(BURN * burn * bodyCov * 0.9, burn * bodyCov * 0.25);
	fragColor = col * oA.w;
}
`;

class Orb {
	constructor(scene, geo, order) {
		this.data = new Float32Array(20);
		const material = premultipliedMaterial({
			common: PALETTE_GLSL + SCENE_GLSL + COMMON,
			vertex: VERTEX,
			fragment: FRAGMENT,
			uniforms: { uOrb: { value: this.data } },
		});
		this.mesh = layerMesh(scene, geo, material, order);
		this.active = false;
		this.floating = false;
	}

	start(x, y) {
		this.active = true;
		this.floating = false;
		this.charge = 0;
		this.x = x;
		this.y = y;
		this.vx = 0;
		this.vy = 0;
		this.yaw = Math.random() * Math.PI * 2;
		this.yawVel = BASE_SPIN;
		this.pitch = PITCH;
		this.radius = 0;
		this.scale = 1;
		this.dissolve = 0;
		this.age = 0;
		this.seed = Math.random();
	}

	copyFrom(o) {
		for (const k of ['charge', 'x', 'y', 'vx', 'vy', 'yaw', 'yawVel', 'pitch', 'radius', 'seed']) this[k] = o[k];
		this.active = true;
		this.floating = true;
		this.scale = 1;
		this.dissolve = 0;
		this.age = 0;
	}

	write(opacity, aura) {
		const cy = Math.cos(-this.yaw), sy = Math.sin(-this.yaw);
		const cp = Math.cos(-this.pitch), sp = Math.sin(-this.pitch);
		const d = this.data;
		d[0] = this.x;
		d[1] = this.y;
		d[2] = Math.max(1, this.radius * this.scale);
		d[3] = opacity;
		d[4] = this.dissolve;
		d[5] = 0;
		d[6] = aura;
		d[7] = this.seed;
		// world-from-view = Ry(-yaw) * Rx(-pitch), by columns
		d[8] = cy; d[9] = 0; d[10] = -sy;
		d[12] = sy * sp; d[13] = cp; d[14] = cy * sp;
		d[16] = sy * cp; d[17] = -sp; d[18] = cy * cp;
	}

	// Shows the mesh only while there is an orb to draw.
	show() {
		this.mesh.visible = this.active && this.radius * this.scale >= 1;
	}
}

export class Orbs {
	constructor(scene, sprites) {
		const geo = quadGeometry();
		this.held = new Orb(scene, geo, ORDER.orbHeld);
		this.free = new Orb(scene, geo, ORDER.orbFree);
		this.sprites = sprites;
		this.crumbs = 0;
	}

	get holding() {
		return this.held.active;
	}

	// The cursor reappeared somewhere else: a held orb comes with it.
	snap(x, y) {
		if (!this.held.active) return;
		this.held.x = x;
		this.held.y = y;
		this.held.vx = this.held.vy = 0;
	}

	// Button up: a grown orb floats away, a small one shrinks back.
	release() {
		const o = this.held;
		if (!o.active || o.charge < MIN_RELEASE) return;
		this.free.copyFrom(o);
		o.active = false;
		orbRelease(this.sprites, o.x, o.y, o.radius);
	}

	update(dt, t, cursor, holding, heldFor) {
		const o = this.held;
		if (holding) {
			if (!o.active) o.start(cursor.sx, cursor.sy);
			o.charge = clamp(heldFor / GROW_S, 0, 1);
		} else if (o.active) {
			o.charge -= dt * SHRINK_RATE;
			if (o.charge <= 0) o.active = false;
		}
		if (o.active) {
			const c = o.charge;
			// ease out with a little overshoot, like a bubble blown to size
			const e = 1 + 2.2 * Math.pow(c - 1, 3) + 1.2 * Math.pow(c - 1, 2);
			o.radius = RADIUS * clamp(e, 0, 1.2);
			const tx = cursor.sx;
			const ty = cursor.sy + Math.sin(t * 2.4) * BOB_PX * c;
			o.vx += (SPRING_K * (tx - o.x) - SPRING_DAMP * o.vx) * dt;
			o.vy += (SPRING_K * (ty - o.y) - SPRING_DAMP * o.vy) * dt;
			o.x += o.vx * dt;
			o.y += o.vy * dt;
			this._turn(o, dt, o.vx, o.vy);
			o.write(1, c);
		}

		const f = this.free;
		if (f.active) {
			f.age += dt;
			f.vy -= RISE_ACCEL * dt;
			f.vx *= Math.exp(-dt * 2);
			f.x += f.vx * dt;
			f.y += f.vy * dt;
			f.scale = 1 + 0.18 * f.age;
			const k = f.age / FLOAT_S;
			f.dissolve = clamp(k * k * (3 - 2 * k) * 1.05, 0, 1);
			this._turn(f, dt, 0, 0);
			this.crumbs += dt * CRUMB_RATE;
			while (this.crumbs >= 1) {
				this.crumbs--;
				orbCrumb(this.sprites, f.x, f.y, f.radius * f.scale);
			}
			if (f.age >= FLOAT_S) f.active = false;
			else f.write(1, 0);
		}
		o.show();
		f.show();
		return o.active || f.active;
	}

	// The world spins on its own and rolls with the orb's motion.
	_turn(o, dt, vx, vy) {
		const r = Math.max(o.radius, 20);
		const want = BASE_SPIN + clamp((vx / r) * ROLL, -6, 6);
		o.yawVel += (want - o.yawVel) * (1 - Math.exp(-dt * 5));
		o.yaw = (o.yaw + o.yawVel * dt) % (Math.PI * 2);
		const lean = PITCH + clamp((vy / r) * 0.06, -0.25, 0.25);
		o.pitch += (lean - o.pitch) * (1 - Math.exp(-dt * 6));
	}
}
