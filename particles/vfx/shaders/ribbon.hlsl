// Ribbon trail. The CPU lays control points along the smoothed cursor path;
// the GPU lets them drift in a curl-noise flow and rasterises the strip itself:
//
//   CSRibbonSim      write this frame's new points, integrate the rest
//   CSRibbonRaster   one group per segment claims pixels with InterlockedMax on
//                    (closeness | segment): every pixel belongs to the segment
//                    whose centre line is nearest relative to its width, which
//                    is the distance field of the whole polyline, so joints
//                    are seamless and never blend twice
//   CSRibbonResolve  per pixel, re-evaluate the winning segment and shade it as
//                    a twisting two-sided strip

struct RibbonPoint
{
	float2 pos;
	float2 vel;
	float  age;
	float  arc;    // arc length along the path at emission (px)
	uint   seed;
	uint   flags;  // kBreak: no segment joins this point to the previous one
};

RWStructuredBuffer<RibbonPoint> gPoints : register(u0);
RWStructuredBuffer<uint>        gOwner  : register(u5);

cbuffer RibbonSpawn : register(b1)
{
	float4 gSpawnA[64];  // xy position, zw velocity
	float4 gSpawnB[64];  // x arc length, y age, z seed bits, w flag bits
};

// gRange: x slot of the oldest live point, y number of live points

#define R_WIDTH       gP[0].x
#define R_LIFE        gP[0].y
#define R_TAPER       gP[0].z
#define R_HEAD        gP[0].w   // head taper length (px of arc)
#define R_TWIST_FREQ  gP[1].x
#define R_TWIST_PHASE gP[1].y   // twist phase at arc 0 (spin over time, from the CPU)
#define R_TWIST       gP[1].z
#define R_SOFT        gP[1].w
#define R_FLUTTER     gP[2].x
#define R_FLUTTER_K   gP[2].y
#define R_DRAG        gP[2].z
#define R_GRAVITY     gP[2].w
#define R_LIGHT       gP[3].xyz
#define R_SHINE       gP[3].w
#define R_SHEEN       gP[4].x
#define R_EDGE        gP[4].y
#define R_SOLID       gP[4].z
#define R_CORE        gP[4].w
#define R_GAIN        gP[5].x
#define R_FADE        gP[5].y
#define R_HEAD_ARC    gP[5].z   // arc length at the cursor
#define R_REBASE      gP[5].w   // subtracted from every stored arc this frame

static const uint kBreak = 1u;

uint PointSlot(uint j)
{
	return (gRange.x + j) % gEmit.z;
}

// Half width at a point; also returns its normalised age and twist phase.
float HalfWidth(RibbonPoint p, out float u, out float phase)
{
	u = saturate(p.age / max(R_LIFE, 1e-3));
	phase = p.arc * R_TWIST_FREQ + R_TWIST_PHASE;
	// rounded nose: elliptical profile over the first R_HEAD px from the cursor
	float x = saturate((R_HEAD_ARC - p.arc) / max(R_HEAD, 1e-3));
	float grow = lerp(0.15, 1.0, sqrt(x * (2.0 - x)));
	float taper = pow(max(1.0 - u, 1e-4), R_TAPER);
	float twist = lerp(1.0, abs(cos(phase)), R_TWIST);
	return max(0.5 * R_WIDTH * grow * taper * twist, 0.3);
}

// t: projection on ab (unclamped), d: distance to the segment,
// side: which side of ab the point lies on.
void SegmentDistance(float2 p, float2 a, float2 b, out float t, out float d, out float side)
{
	float2 ab = b - a;
	float2 ap = p - a;
	float l2 = dot(ab, ab);
	t = l2 > 1e-8 ? dot(ap, ab) / l2 : 0.0;
	d = length(ap - ab * saturate(t));
	side = (ab.x * ap.y - ab.y * ap.x) >= 0.0 ? 1.0 : -1.0;
}

float2 RibbonForce(float2 pos)
{
	return Curl2(pos * R_FLUTTER_K, gTime.x * 0.35) * R_FLUTTER + float2(0.0, R_GRAVITY);
}

[numthreads(256, 1, 1)]
void CSRibbonSim(uint3 id : SV_DispatchThreadID)
{
	uint cap = gEmit.z;
	uint i = id.x;
	if (i >= cap)
		return;

	uint k = SpawnIndex(i);
	if (k < gEmit.y)
	{
		RibbonPoint p;
		p.pos = gSpawnA[k].xy;
		p.vel = gSpawnA[k].zw;
		p.arc = gSpawnB[k].x;
		p.age = gSpawnB[k].y;
		p.seed = asuint(gSpawnB[k].z);
		p.flags = asuint(gSpawnB[k].w);
		// Points laid earlier in the frame are older: advance them by that
		// sub-frame age, otherwise each frame's batch drifts as one block and
		// the trail turns into a staircase.
		float2 acc = RibbonForce(p.pos);
		p.pos += (p.vel + 0.5 * acc * p.age) * p.age;
		p.vel += acc * p.age;
		gPoints[i] = p;
		return;
	}

	if ((i + cap - gRange.x) % cap >= gRange.y)
		return;

	RibbonPoint p = gPoints[i];
	float dt = gTime.y;
	p.age += dt;
	p.arc -= R_REBASE;
	p.vel += RibbonForce(p.pos) * dt;
	p.vel *= exp(-R_DRAG * dt);
	p.pos += p.vel * dt;
	gPoints[i] = p;
}

[numthreads(64, 1, 1)]
void CSRibbonRaster(uint3 gid : SV_GroupID, uint gi : SV_GroupIndex)
{
	uint j = gid.x;
	if (j + 1u >= gRange.y)
		return;

	RibbonPoint a = gPoints[PointSlot(j)];
	RibbonPoint b = gPoints[PointSlot(j + 1u)];
	if ((b.flags & kBreak) != 0u)
		return;

	float ua, pa, ub, pb;
	float wa = HalfWidth(a, ua, pa);
	float wb = HalfWidth(b, ub, pb);
	float r = max(wa, wb) + 1.0;

	int2 res = int2(gRes.xy);
	int2 lo = max(int2(floor(min(a.pos, b.pos) - r)), int2(0, 0));
	int2 hi = min(int2(ceil(max(a.pos, b.pos) + r)), res - 1);
	int2 size = min(hi - lo + 1, int2(512, 512));
	if (size.x <= 0 || size.y <= 0)
		return;

	uint w = uint(size.x);
	uint count = w * uint(size.y);
	for (uint k = gi; k < count; k += 64u)
	{
		int2 px = lo + int2(k % w, k / w);
		float t, d, side;
		SegmentDistance(float2(px) + 0.5, a.pos, b.pos, t, d, side);
		float reach = lerp(wa, wb, saturate(t)) + 0.5;
		if (d >= reach)
			continue;
		uint q = max(1u, uint((1.0 - d / reach) * 65535.0));
		InterlockedMax(gOwner[uint(px.y) * uint(res.x) + uint(px.x)], (q << 16) | (j & 0xFFFFu));
	}
}

[numthreads(8, 8, 1)]
void CSRibbonResolve(uint3 id : SV_DispatchThreadID)
{
	uint w = uint(gRes.x);
	if (id.x >= w || id.y >= uint(gRes.y))
		return;
	uint pix = id.y * w + id.x;
	uint key = gOwner[pix];
	if (key == 0u)
		return;
	gOwner[pix] = 0u;

	uint j = key & 0xFFFFu;
	RibbonPoint a = gPoints[PointSlot(j)];
	RibbonPoint b = gPoints[PointSlot(j + 1u)];
	float ua, pa, ub, pb;
	float wa = HalfWidth(a, ua, pa);
	float wb = HalfWidth(b, ub, pb);

	float t, d, side;
	SegmentDistance(float2(id.xy) + 0.5, a.pos, b.pos, t, d, side);
	t = saturate(t);
	float hw = lerp(wa, wb, t);
	float cov = saturate(hw - d + 0.5);
	float u = lerp(ua, ub, t);
	float phase = lerp(pa, pb, t);
	float v = side * saturate(d / hw);  // -1..1 across the strip

	float2 tan2 = b.pos - a.pos;
	tan2 = dot(tan2, tan2) > 1e-8 ? normalize(tan2) : float2(1.0, 0.0);
	float3 across = float3(-tan2.y, tan2.x, 0.0);

	// The strip spins around its tangent: phase 0 faces the viewer, pi/2 is
	// edge-on. Two-sided, with a slight bulge so the sheen slides across it.
	float c = cos(phase);
	float s = sin(phase);
	bool back = c < 0.0;
	float3 n = float3(0.0, 0.0, 1.0) * abs(c) - across * (s * (back ? -1.0 : 1.0));
	n = normalize(n + across * (v * 0.45));

	float3 l = normalize(R_LIGHT);
	float3 h = normalize(l + float3(0.0, 0.0, 1.0));
	float diffuse = 0.35 + 0.65 * saturate(dot(n, l));
	float spec = pow(saturate(dot(n, h)), max(R_SHINE, 1.0));
	float edgeOn = 1.0 - abs(c);

	float3 front = lerp(gColor0.rgb, gColor1.rgb, smoothstep(0.0, 0.85, u));
	float3 base = back ? gColor2.rgb * lerp(1.0, 0.7, u) : front;

	float feather = 1.0 - smoothstep(1.0 - max(R_SOFT, 1e-3), 1.0, abs(v));
	float fade = 1.0 - smoothstep(1.0 - max(R_FADE, 1e-3), 1.0, u);
	float alpha = cov * feather * fade;

	float3 rgb = base * diffuse * (1.0 + R_EDGE * edgeOn * edgeOn) + spec * R_SHEEN;
	float dpx = v * hw;  // signed px from the centre line
	rgb += gColor0.rgb * (R_CORE * exp(-0.5 * dpx * dpx));
	rgb *= alpha * R_GAIN;

	uint o = pix * 4u;
	gAccum[o + 0u] += uint(rgb.r * kFix + 0.5);
	gAccum[o + 1u] += uint(rgb.g * kFix + 0.5);
	gAccum[o + 2u] += uint(rgb.b * kFix + 0.5);
	gAccum[o + 3u] += uint(alpha * R_SOLID * kFix + 0.5);
}
