// OBS-specific syntax adaptation to HLSL standard to avoid errors reported by the code editor
#define SamplerState sampler_state
#define Texture2D texture2d
uniform float4x4 ViewProj;
uniform Texture2D image;
// Size of the source picture
uniform int width;
uniform int height;
uniform float mouse_x;
uniform float mouse_y;
uniform float itime;
uniform bool pressed_l;
uniform bool pressed_r;
uniform float idsd;
uniform float rsize;
uniform float r1;
uniform float g1;
uniform float b1;
uniform float r2;
uniform float g2;
uniform float b2;

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
};
VertDataOut VSDefault(VertDataIn v_in)
{
    VertDataOut vert_out;
    vert_out.pos = mul(float4(v_in.pos.xyz, 1.0), ViewProj);
    vert_out.uv  = v_in.uv;
    return vert_out;
}

float sdBox(float2 p, float2 b )
{
    float2 d = abs(p)-b;
    return length(max(d,0.0)) + min(max(d.x,d.y),0.0);
}


float opOnionBox(float2 p,float r, float cr)
{
  return abs(sdBox(p,cr)) - r;
}

float sdCircle1(float2 p, float r)
{
  return length(p) - r;

}

float opOnionCir(float2 p,float r, float cr)
{
  return abs(sdCircle1(p,cr)) - r;
}

float sdEquilateralTriangle(float2 p, float r )
{
    const float k = sqrt(3.0);
    p.x = abs(p.x) - r;
    p.y = p.y + r/k;
    if( p.x+k*p.y>0.0 ) p = float2(p.x-k*p.y,-k*p.x-p.y)/2.0;
    p.x -= clamp( p.x, -2.0*r, 0.0 );
    return -length(p)*sign(p.y);
}

float opOnionTri(float2 p,float r, float cr)
{
  return abs(sdEquilateralTriangle(p,cr)) - r;
}

float drawScene2(float2 uv) {
  float cr = rsize;
  float res;

  if (idsd>0.0) {
    res = sdEquilateralTriangle(uv,cr);
    res = opOnionTri(uv,0.001,cr);
  }

  if (idsd>1.0) {
    res = sdBox(uv,cr.xx);
    res = opOnionBox(uv,0.001,cr);
  }

  if (idsd>2.0) {
    res = sdCircle1(uv,cr.xx);
    res = opOnionCir(uv,0.001,cr);
  }

  res = smoothstep(0.,cr*0.4,res);
  return res;
}

float4 PassThrough(VertDataOut v_in) : TARGET
{
  float3 outer_col = float3(r1,g1,b1);
  float3 inner_col = float3(r2,g2,b2);
  float2 uv = v_in.uv;
  float4 orig = image.Sample(textureSampler, uv);
  uv -= 0.5;
  float2 mousePos = float2(mouse_x,mouse_y);
  uv -= mousePos - 0.5;
  float aspect_ratio = float(width)/float(height);
  uv.x *= aspect_ratio;
  float res = drawScene2(uv);
  float inner_blur = smoothstep(0.0,0.06,2.0 * abs(res));
  outer_col = saturate(lerp(inner_col, outer_col, inner_blur));
  outer_col = lerp(outer_col,orig.rgb,res);
  return float4(outer_col,1.0);
}

technique Draw
{
    pass
    {
        vertex_shader = VSDefault(v_in);
        pixel_shader  = PassThrough(v_in);
    }
}
