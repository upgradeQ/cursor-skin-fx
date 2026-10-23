// The cut-ice cursor. Every shape is a signed distance field around the
// hotspot, so shape changes morph by blending two fields. The interior is lit
// as a chiselled gem: the field's gradient gives each bevel a flat facet normal.
// Static silhouettes come from a precomputed atlas; only the snowflake spinner
// is evaluated analytically, since its arms animate.
import { premultipliedMaterial, quadGeometry, layerMesh } from './gpu.js';
import { createCursorAtlas, TILE_PX, TILE_ORIGIN, TILE } from './cursor-atlas.js';

const SHAPE_IDS = {
	default: 0, pointer: 1, text: 2, wait: 3, progress: 4, crosshair: 5, move: 6,
	'ew-resize': 7, 'ns-resize': 8, 'nwse-resize': 9, 'nesw-resize': 10, 'not-allowed': 11, help: 12,
};

const f1 = (v) => v.toFixed(1);

const shapesGlsl = (tiles) => /* glsl */ `
uniform sampler2D uAtlas;

// (distance, gradient) of one atlas tile; outside the tile the distance keeps growing.
vec3 atlas(vec2 p, float tile) {
	vec2 q = p + ${f1(TILE_ORIGIN)};
	vec2 qc = clamp(q, 0.25, ${f1(TILE_PX - 0.25)});
	vec2 uv = vec2((tile * ${f1(TILE_PX)} + qc.x) / ${f1(TILE_PX * tiles)}, qc.y / ${f1(TILE_PX)});
	vec3 s = textureLod(uAtlas, uv, 0.0).xyz;
	s.x += length(q - qc);
	return s;
}

vec3 atlasRot(vec2 p, float tile, float a) {
	vec3 s = atlas(rot2(p, -a), tile);
	s.yz = rot2(s.yz, a);
	return s;
}

// Snowflake spinner: each arm breathes in turn, so a wave runs around it.
float sdSpinner(vec2 p, float R) {
	p = rot2(p, uSpin * 1.6);
	float a = atan(p.y, p.x);
	float k = floor(a / (PI / 3.0) + 0.5);
	float la = a - k * PI / 3.0;
	vec2 q = length(p) * vec2(cos(la), abs(sin(la)));
	float L = R * (0.58 + 0.42 * (0.5 + 0.5 * sin(uSpin * 6.0 - k * 1.0471976)));
	float w = R * 0.1 + 0.15;
	const vec2 BR = vec2(0.5, 0.8660254);
	float d = sdSegment(q, vec2(0.0), vec2(L, 0.0)) - w;
	d = min(d, sdSegment(q, vec2(L * 0.48, 0.0), vec2(L * 0.48, 0.0) + BR * L * 0.36) - w * 0.85);
	d = min(d, sdSegment(q, vec2(L * 0.76, 0.0), vec2(L * 0.76, 0.0) + BR * L * 0.2) - w * 0.75);
	return min(d, sdHex(p, R * 0.27));
}

vec3 spinner(vec2 p, float R) {
	float d = sdSpinner(p, R);
	const float e = 0.3;
	vec2 g = vec2(sdSpinner(p + vec2(e, 0.0), R) - d, sdSpinner(p + vec2(0.0, e), R) - d);
	return vec3(d, g / max(length(g), 1e-4));
}

vec3 shape(vec2 p, int id) {
	if (id == 3) return spinner(p, 13.0);
	if (id == 4) {
		vec3 a = atlas(p, 0.0);
		vec3 b = spinner(p - vec2(20.0, 25.0), 7.6);
		return a.x < b.x ? a : b;
	}
	if (id >= 7 && id <= 10) {
		float a = id == 8 ? PI * 0.5 : id == 9 ? PI * 0.25 : id == 10 ? -PI * 0.25 : 0.0;
		return atlasRot(p, ${f1(TILE.double)}, a);
	}
	float tile = id == 1 ? ${f1(TILE.hand)} : id == 2 ? ${f1(TILE.beam)} : id == 5 ? ${f1(TILE.crosshair)}
		: id == 6 ? ${f1(TILE.move)} : id == 11 ? ${f1(TILE.notAllowed)} : id == 12 ? ${f1(TILE.help)} : ${f1(TILE.arrow)};
	return atlas(p, tile);
}
`;

const vertexShader = /* glsl */ `
in vec2 position;
uniform vec2 uRes;
uniform vec2 uPos;
uniform float uScale;
out vec2 vOff;

void main() {
	vOff = position * 60.0 * max(uScale, 1.0);
	gl_Position = toClip(uPos + vOff, uRes);
}
`;

const fragmentShader = /* glsl */ `
in vec2 vOff;
uniform float uPx;
uniform int uShapeA;
uniform int uShapeB;
uniform float uMix;
uniform float uScale;
uniform float uTilt;
uniform float uAlpha;
uniform vec2 uLight;
uniform float uGlint;
uniform float uRime;
uniform float uSpin;
uniform float uGlow;
out vec4 fragColor;

${shapesGlsl(Object.keys(TILE).length)}

// (distance, gradient) of the cursor, blending the two shapes while morphing.
vec3 cursorField(vec2 p) {
	if (uMix <= 0.0) return shape(p, uShapeA);
	if (uMix >= 1.0) return shape(p, uShapeB);
	return mix(shape(p, uShapeA), shape(p, uShapeB), uMix);
}

const vec2 GLINT_DIR = vec2(0.832, 0.555);

void main() {
	vec2 p = rot2(vOff, -uTilt) / uScale;
	float aa = uPx / uScale;
	vec3 field = cursorField(p);
	float d = field.x;
	if (d > 16.0) discard;

	vec4 o = vec4(0.0);
	// Soft drop shadow keeps the white core readable on light content.
	float ds = cursorField(p - vec2(1.1, 2.3)).x;
	over(o, vec3(0.0, 0.03, 0.07), (1.0 - smoothstep(-1.0, 4.5, ds)) * 0.34);

	float sil = cover(d - 1.4, aa);
	float body = cover(d, aa);
	if (sil > 0.0) over(o, C_INK, sil);
	if (body > 0.0) {
		vec2 g = field.yz;
		float depth = -d;
		// Bevelled crown facets around a flat table.
		float bevel = 1.0 - smoothstep(2.5, 3.3, depth);
		vec3 n = normalize(vec3(g * 1.2 * bevel, 1.0));
		vec3 L = normalize(vec3(uLight, 0.85));
		float diff = max(dot(n, L), 0.0);
		float spec = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 40.0);
		vec3 col = mix(C_DEEP, C_ICE, smoothstep(0.0, 1.6, depth));
		col = mix(col, C_FROST, smoothstep(1.4, 4.0, depth));
		col = col * (0.56 + 0.56 * diff) + spec * 0.8;
		// Glint band sweeping along the diagonal, shifted per facet like refraction.
		float along = dot(p, GLINT_DIR) + dot(n.xy, GLINT_DIR) * 9.0;
		col += exp(-pow((along - uGlint) / 2.4, 2.0)) * 0.85 * vec3(0.92, 0.98, 1.0);
		// Rime creeping in from the edges while the cursor rests.
		float grain = hash11(dot(floor(p * 1.6), vec2(1.0, 57.0)));
		float rime = smoothstep(0.0, 0.9, uRime * 7.0 - depth + grain * 1.5) * min(uRime * 3.0, 1.0);
		col = mix(col, mix(C_PALE, C_WHITE, grain), rime * 0.8);
		over(o, min(col, vec3(1.0)), body);
	}
	// Faint cold halo: additive, so it lifts dark content and vanishes on white.
	o.rgb += C_PALE * exp(-max(d, 0.0) / 4.5) * (0.14 + 0.3 * uGlow) * (1.0 - sil);
	fragColor = o * uAlpha;
}
`;

const MORPH_S = 0.2;
const SPIN_WRAP = Math.PI * 10;   // every spinner frequency is a multiple of 0.2 rad/s

export class IceCursor {
	constructor() {
		this.uniforms = {
			uAtlas: { value: createCursorAtlas().texture },
			uPos: { value: { x: 0, y: 0 } },
			uScale: { value: 1 },
			uTilt: { value: 0 },
			uAlpha: { value: 0 },
			uShapeA: { value: 0 },
			uShapeB: { value: 0 },
			uMix: { value: 0 },
			uLight: { value: { x: -0.6, y: -0.8 } },
			uGlint: { value: -40 },
			uRime: { value: 0 },
			uSpin: { value: 0 },
			uGlow: { value: 0 },
		};
		const geo = quadGeometry();
		geo.instanceCount = 1;
		this.mesh = layerMesh(geo, premultipliedMaterial(vertexShader, fragmentShader, this.uniforms), 4);

		this.from = 0;
		this.to = 0;
		this.morph = 1;
		this.scale = 1;
		this.scaleV = 0;
		this.tilt = 0;
		this.tiltV = 0;
		this.alpha = 0;
		this.glint = -40;
		this.spin = 0;
		this.rime = 0;
		this.glow = 0;
	}

	setShape(shape) {
		const id = SHAPE_IDS[shape] ?? 0;
		if (id === this.to) return;
		// Continue from whichever shape currently dominates the blend.
		this.from = this.morph < 0.5 ? this.from : this.to;
		this.to = id;
		this.morph = 0;
		this.scaleV -= 3.2;
	}

	press() {
		this.scaleV -= 2.0;
	}

	pulse(amount) {
		this.glow = Math.max(this.glow, amount);
	}

	// Returns the rime that was shaken off this frame (0..1), for the caller to scatter.
	update(dt, c, moved, held) {
		const visible = c.visible;
		this.alpha = visible ? Math.min(1, this.alpha + dt / 0.08) : Math.max(0, this.alpha - dt / 0.12);

		this.morph = Math.min(1, this.morph + dt / MORPH_S);
		const m = this.morph;
		const eased = m < 0.5 ? 4 * m * m * m : 1 - Math.pow(-2 * m + 2, 3) / 2;

		const target = (c.down ? 0.86 : 1) * (1 + 0.025 * this.glow);
		this.scaleV += ((target - this.scale) * 380 - this.scaleV * 20) * dt;
		this.scale += this.scaleV * dt;

		const lean = Math.max(-1, Math.min(1, c.vx / 2600)) * 0.16;
		this.tiltV += ((lean - this.tilt) * 240 - this.tiltV * 17) * dt;
		this.tilt += this.tiltV * dt;

		this.glint += Math.min(moved * 0.6, dt * 420) + dt * 13;
		if (this.glint > 80) this.glint -= 115;
		this.spin = (this.spin + dt) % SPIN_WRAP;
		this.glow = Math.max(0, this.glow - dt * 0.9);

		let shed = 0;
		if (c.idle > 2.2 && !held) {
			this.rime = Math.min(0.85, this.rime + dt * 0.12);
		} else if (c.speed > 160) {
			shed = Math.min(this.rime, dt * 4);
			this.rime -= shed;
		}

		const u = this.uniforms;
		u.uPos.value.x = c.x;
		u.uPos.value.y = c.y;
		u.uScale.value = this.scale;
		u.uTilt.value = this.tilt;
		u.uAlpha.value = this.alpha;
		u.uShapeA.value = this.from;
		u.uShapeB.value = this.to;
		u.uMix.value = eased;
		const la = -2.2 + this.tilt * 3.0;
		u.uLight.value.x = Math.cos(la);
		u.uLight.value.y = Math.sin(la);
		u.uGlint.value = this.glint;
		u.uRime.value = this.rime;
		u.uSpin.value = this.spin;
		u.uGlow.value = this.glow;
		this.mesh.visible = this.alpha > 0;
		return shed;
	}
}
