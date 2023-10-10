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
uniform float rsize;
uniform float r2;
uniform float g2;
uniform float b2;
uniform float4x4 m1;
uniform float4x4 m2;

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
// ################################################################################

float sdCircle1(float2 p, float r) { return length(p) - r; }

float drawScene3(float2 uv) {
  float res;
  res = sdCircle1(uv,rsize.xx);
  res = smoothstep(0.0,rsize*0.4,res);
  return res;
}

float2 get_trail(float2 uv, float2 trail) {
  uv -=0.5;
  uv -= trail - 0.5;
  float aspect_ratio = float(width)/float(height);
  uv.x *= aspect_ratio;
  return uv;
}

float opUnion( float d1, float d2 ) { return min(d1,d2); }

float3 add_trail(float2 uv, float2 p, float res, float3 outer_col, float3 modif) {
  float3 inner_col = float3(r2,g2,b2);
  float2 uv2 = get_trail(uv,p);
  float res2 = opUnion(res,drawScene3(uv2));
  modif.g = 0.3/res2;
  float3 outer_col1 = lerp(inner_col*modif,outer_col,res2);
  return outer_col1;
}

float4 PassThrough(VertDataOut v_in) : TARGET
{
  float4x4 m1t = transpose(m1);
  float4x4 m2t = transpose(m2);
  float2 p1 = float2(m1t[0].x,m1t[0].y);
  float2 p2 = float2(m1t[0].z,m1t[0].w);
  float2 p3 = float2(m1t[1].x,m1t[1].y);
  float2 p4 = float2(m1t[1].z,m1t[1].w);
  float2 p5 = float2(m1t[2].x,m1t[2].y);
  float2 p6 = float2(m1t[2].z,m1t[2].w);
  float2 p7 = float2(m1t[3].x,m1t[3].y);
  float2 p8 = float2(m1t[3].z,m1t[3].w);
  float2 p9 = float2(m2t[0].x,m2t[0].y);
  float2 p10 = float2(m2t[0].z,m2t[0].w);
  float2 p11 = float2(m2t[1].x,m2t[1].y);
  float2 p12 = float2(m2t[1].z,m2t[1].w);
  float2 p13 = float2(m2t[2].x,m2t[2].y);
  float2 p14 = float2(m2t[2].z,m2t[2].w);
  float2 p15 = float2(m2t[3].x,m2t[3].y);
  float2 p16 = float2(m2t[3].z,m2t[3].w);

  float3 inner_col = float3(r2,g2,b2);
  float2 uv = v_in.uv;
  float4 orig = image.Sample(textureSampler, uv);
  uv -= 0.5;
  float2 mousePos = float2(mouse_x,mouse_y);
  uv -= mousePos - 0.5;
  float aspect_ratio = float(width)/float(height);
  uv.x *= aspect_ratio;
  float res = 1.0;// skip first circle
  float3 outer_col = orig.rgb;
  outer_col = add_trail(v_in.uv, p1, res, outer_col, float3(1.0,0.2,0.4));     //     |            
  outer_col = add_trail(v_in.uv, p2, res, outer_col, float3(1.0,0.2,0.6));     //     |            
  outer_col = add_trail(v_in.uv, p3, res, outer_col, float3(1.0,0.2,0.8));     //     |            
  outer_col = add_trail(v_in.uv, p4, res, outer_col, float3(0.8,0.2,1.0));     //     |            
  outer_col = add_trail(v_in.uv, p5, res, outer_col, float3(0.6,0.4,0.8));     //     |            
  outer_col = add_trail(v_in.uv, p6, res, outer_col, float3(0.4,0.6,0.6));     //     |            
  outer_col = add_trail(v_in.uv, p7, res, outer_col, float3(0.2,0.8,0.4));     //     |            
  outer_col = add_trail(v_in.uv, p8, res, outer_col, float3(0.0,1.0,0.2));     //     |            
  outer_col = add_trail(v_in.uv, p9, res, outer_col, float3(0.0,0.8,0.2));     //     |            
  outer_col = add_trail(v_in.uv, p10, res, outer_col,float3(0.0,0.6,0.2));    //     |             
  outer_col = add_trail(v_in.uv, p11, res, outer_col,float3(0.4,0.4,0.2));    //     |             
  outer_col = add_trail(v_in.uv, p12, res, outer_col,float3(1.0*0.2,0.2,0.2));//     |                 
  outer_col = add_trail(v_in.uv, p13, res, outer_col,float3(1.0*0.4,0.2,0.2));//     |                 
  outer_col = add_trail(v_in.uv, p14, res, outer_col,float3(1.0*0.6,0.2,0.2));//     |                 
  outer_col = add_trail(v_in.uv, p15, res, outer_col,float3(1.0*0.8,0.2,0.2));//   \ # /               
  outer_col = add_trail(v_in.uv, p16, res, outer_col,float3(1.0,0.2,0.2));    //     |             
  return float4(outer_col,1.0);
}

// ################################################################################
technique Draw
{
    pass
    {
        vertex_shader = VSDefault(v_in);
        pixel_shader  = PassThrough(v_in);
    }
}
