// Draws the fish: one instanced quad each, a signed-distance goldfish (or a
// little blue tang) seen from above. The body follows a travelling wave and
// the bend of its turn by shearing fish space along the spine; the twin fan
// tail, pectoral fins and dorsal ridge ride on the same wave. Banking rolls
// the body: it widens, its colours slide from back to flank to belly and the
// dorsal ridge and far eye tip away. Shadows go in a pass of their own so no
// fish's shadow lands on another fish.
import { layerMesh, ORDER, premultipliedMaterial, streamGeometry, uploadPrefix } from './gl.js';

export const FISH_FLOATS = 16;   // per instance, see Shoal.upload()
export const MAX_FISH = 16;

// Instance: a = x, y, heading, length px; b = tail phase, wave amplitude,
// bend, bank; c = alpha, variant (0 gold, 1 blue), lift px, seed;
// d = fin phase, dim (seen through water), unused, unused.
const VERTEX = /* glsl */ `
in vec2 position;
in vec4 iA;
in vec4 iB;
in vec4 iC;
in vec4 iD;

out vec2 vQ;          // fish space, body lengths: x to the nose, y to its right
flat out vec4 vB;
flat out vec4 vC;
flat out vec4 vD;
flat out vec4 vE;     // length px, heading

const vec2 SHADOW_OFFSET = vec2(5.0, 10.0);   // px, the fish swims a little above the floor
const float SHADOW_BLUR = 4.0;                // px

vec4 box(float bend, float pad) {
	float y = 0.5 + abs(bend) * 0.32 + pad;
	return vec4(-0.72 - pad, -y, 0.62 + pad, y);
}

void main() {
#ifdef SHADOW
	vec2 center = iA.xy + SHADOW_OFFSET * (1.0 + iC.z / 45.0);
	float len = iA.w;
	vec4 bx = box(iB.z, SHADOW_BLUR * 1.5 / iA.w);
#else
	// A fish jumping out of the water comes toward the viewer.
	float len = iA.w * (1.0 + iC.z / 240.0);
	vec2 center = iA.xy - vec2(0.0, iC.z);
	vec4 bx = box(iB.z, 0.0);
#endif
	vec2 q = mix(bx.xy, bx.zw, position * 0.5 + 0.5);
	gl_Position = clipFromPage(center + rot(q * len, iA.z));
	vQ = q;
	vB = iB;
	vC = iC;
	vD = iD;
	vE = vec4(len, iA.z, 0.0, 0.0);
}
`;

const PARTS = /* glsl */ `
in vec2 vQ;
flat in vec4 vB;
flat in vec4 vC;
flat in vec4 vD;
flat in vec4 vE;
out vec4 fragColor;

const float SHADOW_BLUR = 4.0;   // px

float sdEllipse(vec2 p, vec2 r) {
	float k0 = length(p / r);
	float k1 = length(p / (r * r));
	return k0 * (k0 - 1.0) / max(k1, 1e-5);
}

// Capsule from a to b whose radius runs from ra to rb.
float sdTaper(vec2 p, vec2 a, vec2 b, float ra, float rb) {
	vec2 ba = b - a;
	float h = clamp(dot(p - a, ba) / dot(ba, ba), 0.0, 1.0);
	return length(p - a - ba * h) - mix(ra, rb, h);
}

float smin(float a, float b, float k) {
	float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
	return mix(b, a, h) - k * h * (1.0 - h);
}

// Leaf-shaped fin lobe from root along dir.
float lobe(vec2 p, vec2 root, vec2 dir, float len, float wid) {
	vec2 v = p - root - dir * len * 0.5;
	return sdEllipse(vec2(dot(v, dir), dot(v, vec2(-dir.y, dir.x))), vec2(len * 0.5, wid));
}

// Sideways offset of the spine at x: a wave running from head to tail that
// grows toward the tail and whips the fins a beat later, plus the bend of the turn.
float spine(float x, float phase, float amp, float bend) {
	float env = 0.14 + 0.86 * ramp(0.32, -0.62, x);
	float w = 8.0 * x + phase;
	float fins = max(-0.2 - x, 0.0);
	return amp * env * sin(w) + bend * x * x + fins * amp * 1.7 * sin(w - 0.9);
}

struct Parts {
	vec2 s;              // fish space straightened along the spine
	float body;
	float tail;
	float fins;
	float dorsal;
	float tailAngle;     // around the tail root, for the fin rays
	float tailReach;     // 0 at the tail root .. 1 at its tips
	float width;
	float wide;          // body widening from the bank
};

Parts parts(vec2 q, vec4 b, vec4 d, float blue) {
	float phase = b.x;
	float bank = b.w;
	Parts P;
	vec2 s = vec2(q.x, q.y - spine(q.x, phase, b.y, b.z));
	P.s = s;
	P.width = mix(0.152, 0.104, blue);
	// The body is deeper than it is wide, so it looks wider when rolled.
	P.wide = sqrt(cos(bank) * cos(bank) + 1.8 * sin(bank) * sin(bank));
	vec2 sb = vec2(s.x, s.y / P.wide);
	float head = sdEllipse(sb - vec2(0.16, 0.0), vec2(mix(0.31, 0.32, blue), P.width));
	float rear = sdTaper(sb, vec2(0.08, 0.0), vec2(-0.215, 0.0), P.width * 0.82, 0.028);
	P.body = smin(head, rear, 0.06) * min(P.wide, 1.0);

	// Twin fan tail, opening and closing with each beat.
	float spread = mix(0.62, 0.40, blue) + 0.14 * sin(phase - 1.3);
	float tl = mix(0.36, 0.25, blue);
	float tw = mix(0.11, 0.07, blue);
	vec2 root = vec2(-0.19, 0.0);
	vec2 dr = vec2(-cos(spread), sin(spread));
	vec2 dl = vec2(-cos(spread), -sin(spread));
	P.tail = smin(lobe(s, root, dr, tl, tw), lobe(s, root, dl, tl, tw), 0.05);
	vec2 r = s - root;
	P.tailAngle = atan(r.y, -r.x);
	P.tailReach = length(r) / tl;

	// Pectoral fins paddling out of step, and the small pelvic pair.
	float yw = P.width * P.wide * 0.72;
	float ar = 2.19 - 0.32 * sin(d.x);
	float al = 2.19 - 0.32 * sin(d.x + 1.4);
	vec2 base = vec2(0.25, yw);
	float fr = sdTaper(s, base, base + vec2(cos(ar), sin(ar)) * 0.15, 0.016, 0.046);
	float fl = sdTaper(vec2(s.x, -s.y), base, base + vec2(cos(al), sin(al)) * 0.15, 0.016, 0.046);
	vec2 pb = vec2(0.0, yw * 0.75);
	float pv = sdTaper(vec2(s.x, abs(s.y)), pb, pb + vec2(-0.85, 0.53) * 0.09, 0.012, 0.03);
	P.fins = min(min(fr, fl), pv);

	// Dorsal ridge: edge-on from above, tipping sideways as the fish rolls.
	float sbk = sin(bank);
	float k = clamp((s.x + 0.13) / 0.34, 0.0, 1.0);
	float fh = 0.13 * pow(sin(3.14159 * k), 0.7);
	float r0 = -sbk * P.width * 1.1;
	float r1 = r0 - sbk * fh;
	float halfW = max(0.5 * abs(r1 - r0), 0.006);
	P.dorsal = max(abs(s.y - 0.5 * (r0 + r1)) - halfW, abs(s.x - 0.035) - 0.165);
	return P;
}

float cover(float dist, float aa) {
	return clamp(0.5 - dist / aa, 0.0, 1.0);
}
`;

const BODY = PARTS + /* glsl */ `
void main() {
	float len = vE.x;
	float aa = 1.0 / (uPr * len);   // one device px in body lengths
	float blue = vC.y;
	float bank = vB.w;
	Parts P = parts(vQ, vB, vD, blue);
	vec2 s = P.s;

	vec3 finA = mix(vec3(1.0, 0.50, 0.12), vec3(0.50, 0.80, 1.0), blue);
	vec3 finB = mix(vec3(1.0, 0.90, 0.70), vec3(0.90, 0.98, 1.0), blue);
	vec3 tailA = mix(vec3(1.0, 0.40, 0.05), vec3(1.0, 0.74, 0.06), blue);
	vec3 tailB = mix(vec3(1.0, 0.84, 0.60), vec3(1.0, 0.95, 0.55), blue);
	vec3 ink = mix(vec3(0.55, 0.14, 0.02), vec3(0.02, 0.12, 0.36), blue);

	// Tail: translucent, ribbed, paler and thinner toward its frilly edge.
	float rays = 0.5 + 0.5 * cos(P.tailAngle * 26.0);
	float reach = ramp(0.15, 1.0, P.tailReach);
	vec4 col = paint(mix(tailA, tailB, reach) * (0.9 + 0.14 * rays), (0.80 - 0.34 * reach) * cover(P.tail, aa));
	col = over(paint(vec3(1.0), 0.55 * ramp(2.2 * aa, 0.4 * aa, -P.tail) * cover(P.tail, aa)), col);
	col = over(paint(ink, 0.30 * ramp(1.4 * aa, 0.0, abs(P.tail))), col);

	float fc = cover(P.fins, aa);
	col = over(paint(mix(finA, finB, 0.45), 0.6 * fc), col);
	col = over(paint(vec3(1.0), 0.45 * ramp(2.0 * aa, 0.3 * aa, -P.fins) * fc), col);
	col = over(paint(ink, 0.30 * ramp(1.4 * aa, 0.0, abs(P.fins))), col);

	// Body: colour by how far round the body this point is (back, flank, belly).
	float hw = max(abs(s.y) - P.body, 1e-3);
	float sn = clamp(s.y / hw, -1.0, 1.0);
	float beta0 = asin(sn) - bank;
	float beta = atan(sin(beta0), cos(beta0));
	float ab = abs(beta);
	vec3 back = mix(vec3(0.92, 0.30, 0.05), vec3(0.10, 0.40, 0.92), blue);
	vec3 flank = mix(vec3(1.0, 0.55, 0.10), vec3(0.26, 0.68, 1.0), blue);
	vec3 gold = mix(vec3(1.0, 0.76, 0.30), vec3(0.62, 0.90, 1.0), blue);
	vec3 belly = mix(vec3(1.0, 0.93, 0.78), vec3(0.88, 0.97, 1.0), blue);
	vec3 bc = mix(back, flank, ramp(0.15, 1.0, ab));
	bc = mix(bc, gold, ramp(0.95, 1.55, ab));
	bc = mix(bc, belly, ramp(1.7, 2.3, ab));
	// The tang's dark saddle.
	bc = mix(bc, vec3(0.04, 0.12, 0.38), blue * ramp(0.18, 0.06, abs(ab - 0.8)) * ramp(-0.16, -0.05, s.x) * ramp(0.34, 0.24, s.x));

	// Scales: offset rows of crescents that glitter as the fish rolls.
	float scaleK = ramp(30.0, 56.0, len) * ramp(0.3, 0.6, ab) * ramp(2.3, 1.8, ab) * ramp(-0.18, -0.06, s.x) * ramp(0.36, 0.26, s.x);
	vec2 gs = vec2(s.x * 22.0, beta * 3.4);
	float row = floor(gs.y);
	vec2 cell = vec2(fract(gs.x + row * 0.5), fract(gs.y)) - 0.5;
	bc *= 1.0 - 0.16 * ramp(0.34, 0.5, length(cell - vec2(0.42, 0.0))) * scaleK;
	float id = floor(gs.x + row * 0.5) * 7.0 + row * 13.0;
	bc += vec3(1.0, 0.95, 0.8) * 0.4 * scaleK * pow(max(sin(uTime * 2.3 + hash11(id) * 40.0 + bank * 6.0), 0.0), 14.0);

	// Light from the upper left, in fish space.
	vec2 hd = vec2(cos(vE.y), sin(vE.y));
	vec2 l2 = vec2(-0.45, -0.70);
	vec3 L = normalize(vec3(dot(l2, hd), dot(l2, vec2(-hd.y, hd.x)), 0.75));
	float nx = ramp(0.28, 0.48, s.x) * 0.9 - ramp(0.0, -0.21, s.x) * 0.3;
	vec3 n = normalize(vec3(nx, sn, sqrt(max(1.0 - sn * sn, 0.0)) + 0.05));
	vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
	float sp = max(dot(n, H), 0.0);
	bc = bc * (0.62 + 0.5 * max(dot(n, L), 0.0)) + 0.25 * pow(sp, 22.0);
	bc = mix(bc, vec3(1.0), 0.85 * ramp(0.952, 0.972, sp));
	bc = mix(bc, vec3(1.0, 0.97, 0.92), 0.2 * ramp(0.65, 1.0, abs(sn)));
	col = over(paint(bc, cover(P.body, aa)), col);

	// Dorsal ridge, hidden when the fish rolls belly up.
	float dc = cover(P.dorsal, aa) * ramp(-0.1, 0.35, cos(bank));
	col = over(paint(mix(finA, finB, 0.6), 0.6 * dc), col);

	// Eyes bulging from the sides of the head; the far one dips out of sight.
	float eyeR = mix(0.054, 0.044, blue);
	float sil = P.body;
	for (int i = 0; i < 2; i++) {
		float side = i == 1 ? 1.0 : -1.0;
		float ang = side * 1.15 + bank;
		float vis = ramp(-0.25, 0.2, cos(ang));
		vec2 ec = vec2(0.335, sin(ang) * P.width * 0.86 * P.wide * 1.1);
		float de = length(s - ec) - eyeR;
		float ecov = cover(de, aa) * vis;
		sil = min(sil, mix(1.0, de, step(0.01, vis)));
		vec4 ev = paint(mix(vec3(1.0, 0.86, 0.45), vec3(0.92, 0.97, 1.0), blue), 1.0);
		ev = over(paint(vec3(0.03, 0.02, 0.04), cover(length(s - ec) - eyeR * 0.66, aa)), ev);
		vec2 glintAt = ec + vec2(dot(l2, hd), dot(l2, vec2(-hd.y, hd.x))) * eyeR * 0.42;
		ev = over(paint(vec3(1.0), cover(length(s - glintAt) - eyeR * 0.26, aa)), ev);
		col = over(ev * ecov, col);
	}

	// Thin dark outline round the body so it holds up on white.
	col = over(paint(ink, 0.7 * ramp(1.3 * aa, 0.3 * aa, abs(sil + 0.6 * aa))), col);

	// Seen through water: cooler and a touch paler.
	col = vec4(mix(col.rgb, col.rgb * vec3(0.72, 0.92, 1.0) + vec3(0.0, 0.05, 0.08) * col.a, vD.y), col.a);
	fragColor = col * vC.x;
}
`;

const SHADOW = PARTS + /* glsl */ `
void main() {
	float len = vE.x;
	Parts P = parts(vQ, vB, vD, vC.y);
	float dist = min(min(P.body, P.tail + 0.012), P.fins + 0.01);
	float blur = SHADOW_BLUR / len;
	float fade = 1.0 - 0.65 * ramp(0.0, 180.0, vC.z);
	fragColor = paint(vec3(0.0, 0.10, 0.16), 0.20 * ramp(blur, -blur, dist) * vC.x * fade * (1.0 - 0.5 * vD.y));
}
`;

export class FishRenderer {
	constructor(scene) {
		this.instances = new Float32Array(MAX_FISH * FISH_FLOATS);
		const names = [['iA', 4], ['iB', 4], ['iC', 4], ['iD', 4]];
		const { geo, buffer } = streamGeometry(this.instances, FISH_FLOATS, names, { instanced: true });
		this.geo = geo;
		this.buffer = buffer;
		this.shadows = layerMesh(scene, geo, premultipliedMaterial({ vertex: '#define SHADOW\n' + VERTEX, fragment: SHADOW }), ORDER.fishShadows);
		this.bodies = layerMesh(scene, geo, premultipliedMaterial({ vertex: VERTEX, fragment: BODY }), ORDER.fish);
		this.count = 0;
	}

	upload(count) {
		this.count = count;
		this.geo.instanceCount = count;
		this.shadows.visible = this.bodies.visible = count > 0;
		uploadPrefix(this.buffer, count * FISH_FLOATS);
	}
}
