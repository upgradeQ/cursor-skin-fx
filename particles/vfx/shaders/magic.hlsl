// Magic white particles: soft glowing motes and twinkling four-point stars
// spill from the cursor, float upward and swirl in a curl-noise breeze.

struct Particle
{
	float2 pos;
	float2 vel;
	float  age;
	float  life;
	float  size;
	uint   seed;
};

RWStructuredBuffer<Particle> gParts : register(u0);

#define M_LIFE_MIN  gP[0].x
#define M_LIFE_MAX  gP[0].y
#define M_SIZE_MIN  gP[0].z
#define M_SIZE_MAX  gP[0].w
#define M_SPREAD    gP[1].x
#define M_SPEED     gP[1].y
#define M_INHERIT   gP[1].z
#define M_DRAG      gP[1].w
#define M_RISE      gP[2].x
#define M_SWIRL     gP[2].y
#define M_SWIRL_K   gP[2].z
#define M_GLINTS    gP[2].w
#define M_TWINKLE   gP[3].x
#define M_RAYS      gP[3].y
#define M_ORB_GAIN  gP[3].z
#define M_STAR_GAIN gP[3].w
#define M_TINT_MIX  gP[4].x
#define M_BURST_SPD gP[4].y

[numthreads(256, 1, 1)]
void CSMagicSim(uint3 id : SV_DispatchThreadID)
{
	uint i = id.x;
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
			p.pos = gCursor.xy + RandDisk(s) * 3.0;
			p.vel = RandDir(s) * (M_BURST_SPD * lerp(0.25, 1.0, Rand(s)));
			p.age = 0.0;
		}
		else
		{
			// spread spawns along the path the cursor took this frame
			float t = (float(k) + Rand(s)) / float(gEmit.y - gEmit.w);
			p.pos = lerp(gCursor.zw, gCursor.xy, t) + RandDisk(s) * M_SPREAD;
			p.vel = gMotion.xy * (M_INHERIT * lerp(0.3, 1.0, Rand(s)))
				+ RandDir(s) * (M_SPEED * lerp(0.2, 1.0, Rand(s)));
			p.age = (1.0 - t) * dt;
			p.pos += p.vel * p.age;
		}
		p.life = lerp(M_LIFE_MIN, M_LIFE_MAX, Rand(s)) * (burst ? 1.25 : 1.0);
		p.size = lerp(M_SIZE_MIN, M_SIZE_MAX, pow(Rand(s), 1.8));
		p.seed = s;
		gParts[i] = p;
		return;
	}

	Particle p = gParts[i];
	if (p.age >= p.life)
		return;
	p.age += dt;
	float2 flow = Curl2(p.pos * M_SWIRL_K, gTime.x * 0.2);
	p.vel += (flow * M_SWIRL + float2(0.0, -M_RISE)) * dt;
	p.vel *= exp(-M_DRAG * dt);
	p.pos += p.vel * dt;
	gParts[i] = p;
}

[numthreads(64, 1, 1)]
void CSMagicSplat(uint3 id : SV_DispatchThreadID)
{
	uint i = id.x;
	if (i >= gEmit.z)
		return;
	Particle p = gParts[i];
	if (p.age >= p.life)
		return;

	// per-particle constants, re-derived from its seed every frame
	uint s = p.seed;
	float rate = lerp(4.0, 15.0, Rand(s));
	float phase = Rand(s) * kTau;
	float3 tint = lerp(float3(1.0, 1.0, 1.0), gColor0.rgb, M_TINT_MIX * Rand(s));
	bool star = Rand(s) < M_GLINTS;
	float spin = (Rand(s) - 0.5) * 2.0;
	float angle = Rand(s) * kTau + gTime.x * spin;

	float x = p.age / p.life;
	float env = smoothstep(0.0, 0.08, x) * (1.0 - smoothstep(0.4, 1.0, x));
	float tw = 0.5 + 0.5 * sin(gTime.x * rate + phase);
	tw = lerp(1.0, 1.6 * tw * tw, M_TWINKLE);
	float b = env * tw;
	if (b < 0.003)
		return;
	float r = p.size * lerp(0.55, 1.0, env);

	if (star)
	{
		float4 c = float4(tint * (M_STAR_GAIN * b), 0.0);
		SplatGauss(p.pos, r * 0.75, c);
		float2 d0 = float2(cos(angle), sin(angle));
		float2 d1 = float2(-d0.y, d0.x);
		float len = r * M_RAYS * lerp(0.5, 1.15, tw);
		float4 ray = c * 0.6;
		SplatArm(p.pos, d0, len, ray);
		SplatArm(p.pos, -d0, len, ray);
		SplatArm(p.pos, d1, len * 0.65, ray);
		SplatArm(p.pos, -d1, len * 0.65, ray);
	}
	else
	{
		// hot core plus a soft halo; fast motes smear over the distance they
		// covered this frame
		float4 c = float4(tint * (M_ORB_GAIN * b), 0.0);
		float2 travel = p.vel * gTime.y;
		int n = clamp(int(ceil(length(travel) / 1.5)), 1, 6);
		c /= float(n);
		for (int k = 0; k < n; k++)
		{
			float2 q = p.pos - travel * (float(k) / float(n));
			SplatGauss(q, r * 0.45, c);
			SplatGauss(q, r * 1.4, c * 0.16);
		}
	}
}
