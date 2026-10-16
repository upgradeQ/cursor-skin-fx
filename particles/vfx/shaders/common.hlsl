// Shared declarations and kernels for the cursor VFX compute shaders.
//
// Every effect binds the same slots for a whole frame, so one
// CSSetUnorderedAccessViews call serves all of its dispatches:
//   b0  Frame (below)          u0  effect state (particles / ribbon points)
//   b1  effect constants       u1  accumulation, 4 x uint per pixel (fixed point)
//                              u2  glow buffer A (float4, quarter resolution)
//                              u3  glow buffer B
//                              u4  output, premultiplied linear RGBA16F
//                              u5  effect extra buffer

cbuffer Frame : register(b0)
{
	float4 gRes;     // xy render size (px), zw 1 / size
	float4 gTime;    // x time (s), y frame dt (s), z frame index, w random 0..1
	float4 gCursor;  // xy cursor now (px), zw cursor last frame (px)
	float4 gMotion;  // xy cursor velocity (px/s), z speed, w 1 while the cursor is inside
	uint4  gEmit;    // x first spawn slot, y spawn count, z capacity, w burst count (end of the spawn range)
	uint4  gRange;   // effect specific
	float4 gOutput;  // x opacity, y exposure, z unused, w glow strength
	float4 gBloom;   // x blur sigma (quarter-res px), y threshold, zw glow buffer size
	float4 gColor0;
	float4 gColor1;
	float4 gColor2;
	float4 gP[6];    // effect parameters
};

RWStructuredBuffer<uint>   gAccum  : register(u1);
RWStructuredBuffer<float4> gBloomA : register(u2);
RWStructuredBuffer<float4> gBloomB : register(u3);
RWTexture2D<float4>        gOut    : register(u4);

static const float kFix = 4096.0;
static const float kTau = 6.28318530718;

// ------------------------------------------------------------------ random

uint Pcg(uint v)
{
	uint state = v * 747796405u + 2891336453u;
	uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
	return (word >> 22u) ^ word;
}

float Rand(inout uint s)
{
	s = Pcg(s);
	return float(s >> 8) * (1.0 / 16777216.0);
}

float2 RandDir(inout uint s)
{
	float a = Rand(s) * kTau;
	return float2(cos(a), sin(a));
}

float2 RandDisk(inout uint s)
{
	float2 d = RandDir(s);
	return d * sqrt(Rand(s));
}

float3 RandUnit3(inout uint s)
{
	float z = Rand(s) * 2.0 - 1.0;
	float a = Rand(s) * kTau;
	float r = sqrt(saturate(1.0 - z * z));
	return float3(r * cos(a), r * sin(a), z);
}

uint SpawnSeed(uint slot)
{
	return Pcg(slot ^ Pcg(uint(gTime.z) * 2654435761u + 1013904223u));
}

// Index of `slot` inside this frame's spawn range, or >= gEmit.y if outside.
uint SpawnIndex(uint slot)
{
	return (slot + gEmit.z - gEmit.x) % gEmit.z;
}

// ------------------------------------------------------------------- noise

float3 Grad3(int3 c)
{
	uint h = Pcg(uint(c.x) ^ Pcg(uint(c.y) ^ Pcg(uint(c.z))));
	return float3(h & 1023u, (h >> 10) & 1023u, (h >> 20) & 1023u) * (2.0 / 1023.0) - 1.0;
}

// Gradient noise, roughly -1..1.
float Noise3(float3 p)
{
	float3 fl = floor(p);
	int3 i = int3(fl);
	float3 f = p - fl;
	float3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
	float n000 = dot(Grad3(i), f);
	float n100 = dot(Grad3(i + int3(1, 0, 0)), f - float3(1, 0, 0));
	float n010 = dot(Grad3(i + int3(0, 1, 0)), f - float3(0, 1, 0));
	float n110 = dot(Grad3(i + int3(1, 1, 0)), f - float3(1, 1, 0));
	float n001 = dot(Grad3(i + int3(0, 0, 1)), f - float3(0, 0, 1));
	float n101 = dot(Grad3(i + int3(1, 0, 1)), f - float3(1, 0, 1));
	float n011 = dot(Grad3(i + int3(0, 1, 1)), f - float3(0, 1, 1));
	float n111 = dot(Grad3(i + int3(1, 1, 1)), f - float3(1, 1, 1));
	float x00 = lerp(n000, n100, u.x);
	float x10 = lerp(n010, n110, u.x);
	float x01 = lerp(n001, n101, u.x);
	float x11 = lerp(n011, n111, u.x);
	return lerp(lerp(x00, x10, u.y), lerp(x01, x11, u.y), u.z);
}

// Divergence-free 2D flow: the curl of an animated noise field.
float2 Curl2(float2 p, float t)
{
	const float e = 0.05;
	float ny0 = Noise3(float3(p.x, p.y - e, t));
	float ny1 = Noise3(float3(p.x, p.y + e, t));
	float nx0 = Noise3(float3(p.x - e, p.y, t));
	float nx1 = Noise3(float3(p.x + e, p.y, t));
	return float2(ny1 - ny0, nx0 - nx1) * (0.5 / e);
}

// ------------------------------------------------------------------ colour

float3 Spectrum(float h)
{
	return saturate(abs(frac(h + float3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0);
}

// ------------------------------------------------------------ accumulation

void AccumAddAt(uint pix, float4 c)
{
	uint4 q = uint4(max(c, 0.0) * kFix + 0.5);
	uint o = pix * 4u;
	if (q.x != 0u)
		InterlockedAdd(gAccum[o + 0u], q.x);
	if (q.y != 0u)
		InterlockedAdd(gAccum[o + 1u], q.y);
	if (q.z != 0u)
		InterlockedAdd(gAccum[o + 2u], q.z);
	if (q.w != 0u)
		InterlockedAdd(gAccum[o + 3u], q.w);
}

void AccumAdd(int2 p, float4 c)
{
	if (p.x < 0 || p.y < 0 || p.x >= int(gRes.x) || p.y >= int(gRes.y))
		return;
	AccumAddAt(uint(p.y) * uint(gRes.x) + uint(p.x), c);
}

float4 AccumLoad(uint pix)
{
	uint o = pix * 4u;
	return float4(gAccum[o], gAccum[o + 1u], gAccum[o + 2u], gAccum[o + 3u]) * (1.0 / kFix);
}

// Bilinear point: spreads c over the four nearest pixels, energy preserving.
void SplatPoint(float2 p, float4 c)
{
	float2 q = p - 0.5;
	float2 fl = floor(q);
	int2 i = int2(fl);
	float2 f = q - fl;
	AccumAdd(i, c * ((1.0 - f.x) * (1.0 - f.y)));
	AccumAdd(i + int2(1, 0), c * (f.x * (1.0 - f.y)));
	AccumAdd(i + int2(0, 1), c * ((1.0 - f.x) * f.y));
	AccumAdd(i + int2(1, 1), c * (f.x * f.y));
}

// Gaussian blob whose centre value is c.
void SplatGauss(float2 center, float sigma, float4 c)
{
	sigma = clamp(sigma, 0.5, 12.0);
	float r = sigma * 2.6;
	int2 lo = max(int2(floor(center - r)), int2(0, 0));
	int2 hi = min(int2(floor(center + r)), int2(gRes.xy) - 1);
	float k = -0.5 / (sigma * sigma);
	uint w = uint(gRes.x);
	for (int y = lo.y; y <= hi.y; y++)
	{
		for (int x = lo.x; x <= hi.x; x++)
		{
			float2 d = float2(x, y) + 0.5 - center;
			float g = exp(dot(d, d) * k);
			if (g > 0.004)
				AccumAddAt(uint(y) * w + uint(x), c * g);
		}
	}
}

// One tapered arm of a star flare, drawn from the centre outwards.
void SplatArm(float2 center, float2 dir, float len, float4 c)
{
	int n = min(int(ceil(len)), 64);
	for (int k = 1; k <= n; k++)
	{
		float fall = saturate(1.0 - float(k) / len);
		SplatPoint(center + dir * float(k), c * (fall * fall));
	}
}

// -------------------------------------------------------------------- glow

[numthreads(8, 8, 1)]
void CSBloomDown(uint3 id : SV_DispatchThreadID)
{
	uint bw = uint(gBloom.z), bh = uint(gBloom.w);
	if (id.x >= bw || id.y >= bh)
		return;
	uint w = uint(gRes.x), h = uint(gRes.y);
	float3 sum = 0.0;
	[unroll] for (uint y = 0; y < 4; y++)
	{
		[unroll] for (uint x = 0; x < 4; x++)
		{
			uint2 p = min(id.xy * 4u + uint2(x, y), uint2(w - 1u, h - 1u));
			sum += AccumLoad(p.y * w + p.x).rgb;
		}
	}
	sum *= 1.0 / 16.0;
	float m = max(sum.r, max(sum.g, sum.b));
	float keep = m > 1e-5 ? saturate((m - gBloom.y) / m) : 0.0;
	gBloomA[id.y * bw + id.x] = float4(sum * keep, 0.0);
}

[numthreads(8, 8, 1)]
void CSBloomBlurH(uint3 id : SV_DispatchThreadID)
{
	uint bw = uint(gBloom.z), bh = uint(gBloom.w);
	if (id.x >= bw || id.y >= bh)
		return;
	float sigma = max(gBloom.x, 0.5);
	int r = min(int(ceil(sigma * 2.5)), 40);
	float k = -0.5 / (sigma * sigma);
	float3 acc = 0.0;
	float wsum = 0.0;
	for (int i = -r; i <= r; i++)
	{
		float g = exp(float(i * i) * k);
		wsum += g;
		int x = int(id.x) + i;
		if (x >= 0 && x < int(bw))
			acc += gBloomA[id.y * bw + uint(x)].rgb * g;
	}
	gBloomB[id.y * bw + id.x] = float4(acc / wsum, 0.0);
}

[numthreads(8, 8, 1)]
void CSBloomBlurV(uint3 id : SV_DispatchThreadID)
{
	uint bw = uint(gBloom.z), bh = uint(gBloom.w);
	if (id.x >= bw || id.y >= bh)
		return;
	float sigma = max(gBloom.x, 0.5);
	int r = min(int(ceil(sigma * 2.5)), 40);
	float k = -0.5 / (sigma * sigma);
	float3 acc = 0.0;
	float wsum = 0.0;
	for (int i = -r; i <= r; i++)
	{
		float g = exp(float(i * i) * k);
		wsum += g;
		int y = int(id.y) + i;
		if (y >= 0 && y < int(bh))
			acc += gBloomB[uint(y) * bw + id.x].rgb * g;
	}
	gBloomA[id.y * bw + id.x] = float4(acc / wsum, 0.0);
}

float3 SampleBloom(float2 q)
{
	int bw = int(gBloom.z), bh = int(gBloom.w);
	q -= 0.5;
	float2 fl = floor(q);
	float2 f = q - fl;
	int2 hi = int2(bw - 1, bh - 1);
	int2 i0 = clamp(int2(fl), int2(0, 0), hi);
	int2 i1 = clamp(int2(fl) + 1, int2(0, 0), hi);
	float3 a = gBloomA[uint(i0.y * bw + i0.x)].rgb;
	float3 b = gBloomA[uint(i0.y * bw + i1.x)].rgb;
	float3 c = gBloomA[uint(i1.y * bw + i0.x)].rgb;
	float3 d = gBloomA[uint(i1.y * bw + i1.x)].rgb;
	return lerp(lerp(a, b, f.x), lerp(c, d, f.x), f.y);
}

// Soft shoulder above 0.6 and hot values bleaching towards white, so dense
// light reads as a white-hot core instead of a clipped flat colour.
float3 Tonemap(float3 c)
{
	c = max(c, 0.0);
	float m = max(c.r, max(c.g, c.b));
	if (m < 1e-6)
		return 0.0;
	float mt = m < 0.6 ? m : 0.6 + 0.4 * (1.0 - exp((0.6 - m) / 0.4));
	float white = saturate((m - 1.0) * 0.3);
	return lerp(c / m, 1.0, white) * mt;
}

// Resolve accumulation + glow into the output and clear the accumulator.
// Alpha is the brightest channel (or explicit coverage), so premultiplied
// "over" blending behaves like a screen blend for light.
[numthreads(8, 8, 1)]
void CSComposite(uint3 id : SV_DispatchThreadID)
{
	uint w = uint(gRes.x);
	if (id.x >= w || id.y >= uint(gRes.y))
		return;
	uint pix = id.y * w + id.x;
	float4 c = AccumLoad(pix);
	uint o = pix * 4u;
	gAccum[o + 0u] = 0u;
	gAccum[o + 1u] = 0u;
	gAccum[o + 2u] = 0u;
	gAccum[o + 3u] = 0u;

	float3 rgb = c.rgb;
	if (gOutput.w > 0.0)
		rgb += SampleBloom((float2(id.xy) + 0.5) * 0.25) * gOutput.w;
	rgb = Tonemap(rgb * gOutput.y);
	float a = saturate(max(max(rgb.r, rgb.g), max(rgb.b, c.a)));
	gOut[id.xy] = float4(rgb, a) * gOutput.x;
}
