
// OBS-specific syntax adaptation to HLSL standard to avoid errors reported by the code editor
#define SamplerState sampler_state
#define Texture2D texture2d
uniform float4x4 ViewProj;
uniform Texture2D image;
// Size of the source picture
uniform int width;
uniform int height;
uniform float itime;
uniform float3 mouse;
// x,y - normalized location on screen
// z - random seed/or other info, w - age in frames
uniform float4 particle1;
uniform float4 particle2;
uniform float4 particle3;
uniform float4 particle4;
uniform float4 particle5;
uniform float4 particle6;
uniform float4 particle7;

SamplerState textureSampler {
    Filter   = Linear;
    AddressU = Clamp;
    AddressV = Clamp;
};
struct VertDataIn {
    float4 pos : POSITION;
    float2 uv  : TEXCOORD0;
};
struct VertDataOut {
    float4 pos : POSITION;
    float2 uv  : TEXCOORD0;
    float aspect  : TEXCOORD1;
};
VertDataOut VSDefault(VertDataIn v_in)
{
    VertDataOut vert_out;
    vert_out.pos = mul(float4(v_in.pos.xyz, 1.0), ViewProj);
    vert_out.uv  = v_in.uv;
    vert_out.aspect  = float(width)/float(height);
    return vert_out;
}

float sdCircle1(float2 p, float r) { return length(p) - r; }

float remap01(float a, float b, float t) {
  return saturate((t - a) / (b - a));
}

float remap(float a, float b, float c, float d, float t) {
  return remap01(a, b, t) * (d - c) + c;
}

float4 opOver(float4 destination, float4 source) {
    return source + destination*(1.0-source.a);
}

float4 draw_particle(float2 uv, float4 p, float4 outer_col, float aspect_ratio) {
  if (p.x<-2 && p.y <-2) return outer_col;
  float4 col = float4(0.0.xxx,1.0);
  float rsize = remap(0,45,0.6/4,0.1,p.w);
  float rsize2 = 0.25*0.0125;
  rsize *= rsize;
  uv.x *= aspect_ratio;
  float d = sdCircle1(uv-p.xy, rsize.xx);
  d = rsize2 - d;
  float m = remap(0,45,0.00,1.0,p.w);
  float circle = step(0.00001,d); // 0.001 removes dark edges
  col = float4(circle,0,0,m*2);
  col.xyz *= col.a;
  col = opOver(outer_col,col);
  float m2 = remap(0,45,rsize2-d,rsize2*2.0-d,p.w);
  m = step(rsize2,abs(m2-d*2));
  col = lerp(col,outer_col,m);
  return saturate(col);
}
float4 draw_highlight(float2 uv, float4 outer_col, float aspect_ratio) {
  if (mouse.z>0.0) return outer_col;
  float4 col = float4(0.0.xxx,1.0);
  uv.x *= aspect_ratio;
  float d = sdCircle1(uv-mouse.xy, 0.01);
  float circle = 1-smoothstep(0.004,0.0051,d); 
  col = float4(1.0,1.0,0,circle);
  col.a *= 0.8;
  col.xyz *= col.a;
  col = opOver(outer_col,col);

  return col;
}

float4 PassThrough(VertDataOut v_in) : TARGET
{
  float4 outer_col = image.Sample(textureSampler, v_in.uv);
  outer_col = draw_particle(v_in.uv, particle1,  outer_col, v_in.aspect);
  outer_col = draw_particle(v_in.uv, particle2,  outer_col, v_in.aspect);
  outer_col = draw_particle(v_in.uv, particle3,  outer_col, v_in.aspect);
  outer_col = draw_particle(v_in.uv, particle4,  outer_col, v_in.aspect);
  outer_col = draw_particle(v_in.uv, particle5,  outer_col, v_in.aspect);
  outer_col = draw_particle(v_in.uv, particle6,  outer_col, v_in.aspect);
  outer_col = draw_particle(v_in.uv, particle7,  outer_col, v_in.aspect);
  outer_col = draw_highlight(v_in.uv, outer_col, v_in.aspect);
  return outer_col;
}

technique Draw
{
    pass
    {
        vertex_shader = VSDefault(v_in);
        pixel_shader  = PassThrough(v_in);
    }
}

