// Shattered glass: mini cubic chunks of tempered glass stirred up by the
// cursor, in a haze of fine glass dust. Every chunk is a slightly irregular
// box tumbling in 3D, rasterised here in compute:
//   - faces carry fake reflections of a studio (soft boxes, a strip light, a
//     rim light behind, a dim sky) on slightly bent normals, so highlights
//     sweep across a facet as the chunk turns
//   - front edges glow, back edges show faintly through the glass
//   - a chunk whose face catches a light full on throws a small flare

struct Particle
{
	float2 pos;
	float2 vel;
	float  age;
	float  life;
	float  size;  // half extent of the chunk (px)
	uint   seed;
};

RWStructuredBuffer<Particle> gParts : register(u0);

// Big chunks queued for CSGlassBig: [0] count, then particle indices.
RWStructuredBuffer<uint> gBig : register(u5);
static const uint kBigMax = 4095;
static const uint kBigGroups = 64;  // CSGlassBig dispatch size, see glass_dust.lua
static const int kBigArea = 144;    // bounding box (px) beyond which a chunk is big

#define G_LIFE_MIN  gP[0].x
#define G_LIFE_MAX  gP[0].y
#define G_SIZE_MIN  gP[0].z
#define G_SIZE_MAX  gP[0].w
#define G_SPREAD    gP[1].x
#define G_SPEED     gP[1].y
#define G_INHERIT   gP[1].z
#define G_DRAG      gP[1].w
#define G_GRAVITY   gP[2].x
#define G_DRIFT     gP[2].y
#define G_DRIFT_K   gP[2].z
#define G_WIND      gP[2].w
#define G_WIND_R    gP[3].x
#define G_DUST      gP[3].y   // share of particles that are fine dust
#define G_CUBIC     gP[3].z   // 0 flat plates .. 1 cubes
#define G_IRREGULAR gP[3].w   // corner jitter
#define G_SPIN      gP[4].x
#define G_REFLECT   gP[4].y
#define G_EDGES     gP[4].z
#define G_CURVE     gP[4].w   // fake facet curvature (reflection sweep)
#define G_BODY      gP[5].x
#define G_DISPERSE  gP[5].y
#define G_FLARE     gP[5].z
#define G_BURST_SPD gP[5].w

[numthreads(256, 1, 1)]
void CSGlassSim(uint3 id : SV_DispatchThreadID)
{
	uint i = id.x;
	if (i == 0u)
		gBig[0] = 0u;  // the splat pass refills the big-chunk queue
	if (i >= gEmit.z)
		return;
	float dt = gTime.y;

	uint k = SpawnIndex(i);
	if (k < gEmit.y)
	{
		uint s = SpawnSeed(i);
		Particle p;
		bool burst = k >= gEmit.y - gEmit.w;
		if (burst)
		{
			// click: the glass shatters outwards from the cursor
			p.pos = gCursor.xy + RandDisk(s) * 4.0;
			p.vel = RandDir(s) * (G_BURST_SPD * lerp(0.15, 1.0, Rand(s)));
			p.age = 0.0;
		}
		else
		{
			float t = (float(k) + Rand(s)) / float(gEmit.y - gEmit.w);
			float2 off = RandDisk(s) * (G_SPREAD * lerp(0.35, 1.0, Rand(s)));
			p.pos = lerp(gCursor.zw, gCursor.xy, t) + off;
			p.vel = gMotion.xy * (G_INHERIT * Rand(s)) + RandDir(s) * (G_SPEED * Rand(s));
			p.age = (1.0 - t) * dt;
			p.pos += p.vel * p.age;
		}
		p.life = lerp(G_LIFE_MIN, G_LIFE_MAX, Rand(s));
		bool dust = Rand(s) < G_DUST;
		p.size = dust ? lerp(0.25, 0.7, Rand(s)) : lerp(G_SIZE_MIN, G_SIZE_MAX, pow(Rand(s), 3.2));
		p.seed = s;
		gParts[i] = p;
		return;
	}

	Particle p = gParts[i];
	if (p.age >= p.life)
		return;
	p.age += dt;

	// cursor wind: nearby glass is entrained by the cursor and pushed aside
	float2 dc = p.pos - gCursor.xy;
	float near = exp(-dot(dc, dc) / max(G_WIND_R * G_WIND_R, 1.0)) * gMotion.w;
	p.vel += (gMotion.xy - p.vel) * saturate(G_WIND * near * dt);
	p.vel += dc * (near * gMotion.z * 0.3 * G_WIND * dt / (length(dc) + 4.0));

	float2 flow = Curl2(p.pos * G_DRIFT_K, gTime.x * 0.12);
	p.vel += (flow * G_DRIFT + float2(0.0, G_GRAVITY)) * dt;
	p.vel *= exp(-G_DRAG * dt);
	p.pos += p.vel * dt;
	gParts[i] = p;
}

// ------------------------------------------------------------ chunk geometry

// Box corner c has coordinates (bit0, bit1, bit2) mapped to -1/+1.
// Faces, corners in cyclic order: -X, +X, -Y, +Y, -Z, +Z.
static const uint kFaces[24] = { 0, 2, 6, 4, 1, 5, 7, 3, 0, 4, 5, 1, 2, 3, 7, 6, 0, 1, 3, 2, 4, 6, 7, 5 };
// The 12 edges (from -> to) and, for each, the two faces that meet there.
static const uint kEdges[24] = { 0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7 };
static const uint kEdgeFaces[24] = { 2, 4, 3, 4, 2, 5, 3, 5, 0, 4, 1, 4, 0, 5, 1, 5, 0, 2, 1, 2, 0, 3, 1, 3 };
// The edge along each side of each face. Every face runs its first two
// sides along the edge's direction and its last two against it.
static const uint kFaceEdges[24] = { 4, 10, 6, 8, 9, 7, 11, 5, 8, 2, 9, 0, 1, 11, 3, 10, 0, 5, 1, 4, 6, 3, 7, 2 };

float3x3 AxisAngle(float3 k, float a)
{
	float c = cos(a), s = sin(a), t = 1.0 - c;
	return float3x3(
		t * k.x * k.x + c, t * k.x * k.y - s * k.z, t * k.x * k.z + s * k.y,
		t * k.x * k.y + s * k.z, t * k.y * k.y + c, t * k.y * k.z - s * k.x,
		t * k.x * k.z - s * k.y, t * k.y * k.z + s * k.x, t * k.z * k.z + c);
}

// ----------------------------------------------------------- fake reflections

// A rectangular light around direction dir: (hu, hv) are its half sizes on
// the tangent plane, soft its edge width. Reflected in a facet it shows as a
// crisp bright panel or strip sliding across the glass.
float SoftBox(float3 r, float3 dir, float hu, float hv, float soft)
{
	dir = normalize(dir);
	float3 u = normalize(cross(float3(0.0, 1.0, 0.0), dir));
	float3 v = cross(dir, u);
	float c = dot(r, dir);
	float2 t = float2(dot(r, u), dot(r, v)) / max(c, 1e-3);
	return c <= 0.0 ? 0.0 : smoothstep(hu + soft, hu, abs(t.x)) * smoothstep(hv + soft, hv, abs(t.y));
}

// A made-up studio around the glass; r is a reflection direction in view
// space (x right, y down, z towards the viewer).
float Environment(float3 r)
{
	float e = 0.015 + 0.04 * saturate(-r.y);
	e += 3.0 * SoftBox(r, float3(-0.45, -0.70, 0.55), 0.50, 0.32, 0.05);  // key soft box, upper left
	e += 2.5 * SoftBox(r, float3(0.75, -0.20, 0.62), 0.07, 0.60, 0.03);   // tall strip, right
	e += 1.6 * SoftBox(r, float3(0.00, -0.85, 0.50), 0.90, 0.06, 0.03);   // ceiling band
	e += 1.0 * SoftBox(r, float3(0.10, -0.30, -0.95), 0.40, 0.25, 0.08);  // rim, behind
	return e;
}

// Reflection off a surface whose normal n faces the viewer (n.z >= 0), with
// a Schlick-like rise towards grazing angles (exaggerated for punch).
float Reflection(float3 n)
{
	float3 r = float3(2.0 * n.z * n.x, 2.0 * n.z * n.y, 2.0 * n.z * n.z - 1.0);
	float m = 1.0 - saturate(n.z);
	float m2 = m * m;
	return Environment(r) * (0.25 + 0.75 * m2 * m2);
}

// Flare arm that disperses from white at the core to spectral at the tip.
void PrismArm(float2 center, float2 dir, float len, float3 col, float hue)
{
	int n = min(int(ceil(len)), 48);
	for (int k = 1; k <= n; k++)
	{
		float t = float(k) / len;
		float fall = saturate(1.0 - t);
		float3 c = lerp(float3(1.0, 1.0, 1.0), Spectrum(hue + t * 0.55), G_DISPERSE * saturate(t * 2.0));
		SplatPoint(center + dir * float(k), float4(col * c * (fall * fall), 0.0));
	}
}

// Draws one particle. lane/lanes split the chunk's pixels over threads: the
// per-particle pass draws with one lane and hands big chunks to CSGlassBig
// (one chunk per thread group), so no single thread holds up the dispatch.
void DrawChunk(Particle p, uint index, uint lane, uint lanes)
{
	// per-chunk constants, re-derived from the seed every frame
	uint s = p.seed;
	float depth = Rand(s);  // 0 far .. 1 near
	float3 axis0 = RandUnit3(s);
	float angle0 = Rand(s) * kTau;
	float3 axis1 = RandUnit3(s);
	float spin = G_SPIN * lerp(0.4, 1.6, Rand(s)) * (Rand(s) < 0.5 ? -1.0 : 1.0);
	float3 ext = float3(1.0, lerp(0.45, 1.0, Rand(s)), lerp(0.25, 1.0, G_CUBIC) * lerp(0.5, 1.0, Rand(s)));
	bool wedge = Rand(s) < 0.3;  // some chunks break as triangular prisms
	float hue = Rand(s);

	float x = p.age / p.life;
	float fade = smoothstep(0.0, 0.08, x) * (1.0 - smoothstep(0.6, 1.0, x)) * lerp(0.5, 1.0, depth);
	float scale = p.size * lerp(0.75, 1.25, depth);
	float3x3 rot = mul(AxisAngle(axis1, spin * p.age), AxisAngle(axis0, angle0));
	float3 light = gColor1.rgb;
	float3 tint = gColor0.rgb;

	if (scale < 1.2)
	{
		// fine dust: one speck that twinkles as its facet turns
		float3 n = mul(rot, float3(0.0, 0.0, 1.0));
		n = n.z < 0.0 ? -n : n;
		float b = (0.35 * G_EDGES + G_REFLECT * Reflection(n)) * fade;
		if (lane == 0u)
			SplatPoint(p.pos, float4(light * b, b * 0.3) * saturate(scale * scale * 3.0));
		return;
	}

	// corners of the jittered box (px, relative to the chunk centre)
	float3 v[8];
	[unroll] for (uint c = 0; c < 8; c++)
	{
		float3 corner = float3((c & 1u) != 0u ? 1.0 : -1.0, (c & 2u) != 0u ? 1.0 : -1.0, (c & 4u) != 0u ? 1.0 : -1.0) * ext;
		if (wedge && (c & 2u) != 0u)
			corner.x *= 0.05;
		corner += (float3(Rand(s), Rand(s), Rand(s)) - 0.5) * (0.9 * G_IRREGULAR);
		v[c] = mul(rot, corner) * scale;
	}

	// faces: outward normal, centre, plain reflection, winding
	float3 fn[6];
	float2 fc[6];
	float fr[6];
	float fo[6];  // +1 / -1 makes inside distances positive, 0 = edge-on
	float best = 0.0;
	float2 bestAt = 0.0;
	[unroll] for (uint f = 0; f < 6; f++)
	{
		float3 a = v[kFaces[f * 4 + 0]];
		float3 b = v[kFaces[f * 4 + 1]];
		float3 cc = v[kFaces[f * 4 + 2]];
		float3 d = v[kFaces[f * 4 + 3]];
		float3 center = (a + b + cc + d) * 0.25;
		float3 n = normalize(cross(cc - a, d - b));
		n = dot(n, center) < 0.0 ? -n : n;
		float area = (cc.x - a.x) * (d.y - b.y) - (cc.y - a.y) * (d.x - b.x);
		fn[f] = n;
		fc[f] = center.xy;
		fo[f] = abs(area) < 0.05 ? 0.0 : sign(area);
		fr[f] = n.z > 0.0 ? Reflection(n) : Reflection(-n);
		if (n.z > 0.0 && fr[f] > best)
		{
			best = fr[f];
			bestAt = center.xy;
		}
	}

	// Edges as lines: start, unit direction, length. Silhouettes glow most,
	// creases between front faces less, back edges faintly through the
	// glass, and lit faces light their edges. On small chunks the edges
	// crowd together, so they are dimmed to keep the chunk from turning into
	// a white blob.
	float2 ea[12];
	float2 ed[12];
	float el[12];
	float ei[12];
	float crowd = saturate((scale - 1.0) / 4.0);
	float chip = 0.35 * G_EDGES * (1.0 - crowd);
	[unroll] for (uint e = 0; e < 12; e++)
	{
		float2 a = v[kEdges[e * 2]].xy;
		float2 ab = v[kEdges[e * 2 + 1]].xy - a;
		el[e] = length(ab);
		ea[e] = a;
		ed[e] = ab / max(el[e], 1e-4);
		uint f0 = kEdgeFaces[e * 2], f1 = kEdgeFaces[e * 2 + 1];
		bool front0 = fn[f0].z > 0.0;
		bool front1 = fn[f1].z > 0.0;
		float kind = front0 && front1 ? 0.3 : (front0 || front1 ? 1.0 : 0.07 * crowd);
		ei[e] = G_EDGES * kind * lerp(0.45, 1.0, crowd) * (0.35 + 0.65 * saturate(max(fr[f0], fr[f1]) * 1.5));
	}

	float2 lo2 = v[0].xy, hi2 = v[0].xy;
	[unroll] for (uint c2 = 1; c2 < 8; c2++)
	{
		lo2 = min(lo2, v[c2].xy);
		hi2 = max(hi2, v[c2].xy);
	}
	int2 res = int2(gRes.xy);
	int2 lo = max(int2(floor(p.pos + lo2 - 1.5)), int2(0, 0));
	int2 hi = min(int2(ceil(p.pos + hi2 + 1.5)), res - 1);
	int2 size = min(hi - lo + 1, int2(96, 96));
	if (size.x <= 0 || size.y <= 0)
		return;
	if (lanes == 1u && size.x * size.y > kBigArea)
	{
		uint slot;
		InterlockedAdd(gBig[0], 1u, slot);
		if (slot < kBigMax)
		{
			gBig[slot + 1u] = index;
			return;
		}
	}

	uint count = uint(size.x * size.y);
	uint w = uint(size.x);
	uint stride = uint(res.x);
	for (uint k = lane; k < count; k += lanes)
	{
		int2 px = lo + int2(k % w, k / w);
		float2 q = float2(px) + 0.5 - p.pos;
		float3 col = 0.0;
		float alpha = 0.0;

		// signed distance to every edge line (positive on its left) and the
		// glow of the edge segments
		float side[12];
		[unroll] for (uint ee = 0; ee < 12; ee++)
		{
			float2 aq = q - ea[ee];
			float along = dot(aq, ed[ee]);
			side[ee] = ed[ee].x * aq.y - ed[ee].y * aq.x;
			float past = along - clamp(along, 0.0, el[ee]);
			float g = exp((side[ee] * side[ee] + past * past) * -1.1) * ei[ee];
			col += light * g;
			alpha += 0.5 * g;
		}

		[unroll] for (uint ff = 0; ff < 6; ff++)
		{
			// sides run with, with, against, against their edges; fo turns the
			// face's winding so that inside comes out positive
			float o = fo[ff];
			float inside = min(min(side[kFaceEdges[ff * 4 + 0]] * o, side[kFaceEdges[ff * 4 + 1]] * o),
				min(-side[kFaceEdges[ff * 4 + 2]] * o, -side[kFaceEdges[ff * 4 + 3]] * o));
			float cov = saturate(inside + 0.5) * abs(o);
			if (cov > 0.0)
			{
				// bend the normal by the position across the face: a fake
				// curvature that sweeps reflections over the facet
				float2 bend = (q - fc[ff]) / scale * G_CURVE;
				if (fn[ff].z > 0.0)
				{
					// small chips cannot show their structure, so they read as
					// solid bright bits instead
					float r = Reflection(normalize(fn[ff] + float3(bend, 0.0))) * G_REFLECT + chip;
					float3 fire = lerp(float3(1.0, 1.0, 1.0), Spectrum(hue + dot(bend, float2(0.6, 0.4))),
						G_DISPERSE * saturate(r - 0.5));
					col += (light * fire * r + tint * G_BODY) * cov;
					alpha += (G_BODY + 0.3 * saturate(r)) * cov;
				}
				else
				{
					// the inside of the back face, seen through the glass
					col += (light * (0.2 * fr[ff] * G_REFLECT) + tint * (0.5 * G_BODY)) * cov;
				}
			}
		}

		col *= fade;
		alpha = saturate(alpha * fade);
		if (max(max(col.r, col.g), max(col.b, alpha)) > 0.002)
			AccumAddAt(uint(px.y) * stride + uint(px.x), float4(col, alpha));
	}

	// a face catching a light full on throws a small flare
	float glint = saturate(best * G_REFLECT - 0.8) * fade;
	if (lane == 0u && glint > 0.05 && G_FLARE > 0.0)
	{
		float len = G_FLARE * (0.5 + glint) * lerp(0.7, 1.2, depth);
		float2 at = p.pos + bestAt;
		float3 col = light * (0.6 * glint);
		PrismArm(at, float2(0.94, 0.34), len, col, hue);
		PrismArm(at, float2(-0.94, -0.34), len, col, hue + 0.5);
		PrismArm(at, float2(-0.34, 0.94), len * 0.6, col, hue + 0.25);
		PrismArm(at, float2(0.34, -0.94), len * 0.6, col, hue + 0.75);
	}
}

[numthreads(64, 1, 1)]
void CSGlassSplat(uint3 id : SV_DispatchThreadID)
{
	uint i = id.x;
	if (i >= gEmit.z)
		return;
	Particle p = gParts[i];
	if (p.age < p.life)
		DrawChunk(p, i, 0u, 1u);
}

[numthreads(64, 1, 1)]
void CSGlassBig(uint3 gid : SV_GroupID, uint gi : SV_GroupIndex)
{
	uint n = min(gBig[0], kBigMax);
	for (uint e = gid.x; e < n; e += kBigGroups)
	{
		uint index = gBig[e + 1u];
		DrawChunk(gParts[index], index, gi, 64u);
	}
}
