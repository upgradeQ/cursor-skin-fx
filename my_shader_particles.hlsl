// OBS-specific syntax adaptation to HLSL standard to avoid errors reported by the code editor
#define SamplerState sampler_state
#define Texture2D texture2d
uniform float4x4 ViewProj;
uniform Texture2D image;
// Size of the source picture
uniform int width;
uniform int height;
uniform float itime;
uniform bool afk;
uniform float4 particle1;
uniform float4 particle2;
uniform float4 particle3;
uniform float4 particle4;
uniform float4 particle5;
uniform float4 particle6;
uniform float4 particle7;
uniform float4 particle8;
uniform float4 particle9;
uniform float4 particle10;
uniform float4 particle11;
uniform float4 particle12;
uniform float4 particle13;
uniform float4 particle14;
uniform float4 particle15;
uniform float4 particle16;
uniform float4 particle17;
uniform float4 particle18;
uniform float4 particle19;
uniform float4 particle20;
uniform float4 particle21;
uniform float4 particle22;
uniform float4 particle23;
uniform float4 particle24;
uniform float4 particle25;
uniform float4 particle26;
uniform float4 particle27;
uniform float4 particle28;
uniform float4 particle29;
uniform float4 particle30;
uniform float4 particle31;
uniform float4 particle32;
uniform float4 particle33;
uniform float4 particle34;
uniform float4 particle35;
uniform float4 particle36;
uniform float4 particle37;
uniform float4 particle38;
uniform float4 particle39;
uniform float4 particle40;
uniform float4 particle41;
uniform float4 particle42;
uniform float4 particle43;
uniform float4 particle44;
uniform float4 particle45;
uniform float4 particle46;
uniform float4 particle47;
uniform float4 particle48;
uniform float4 particle49;
uniform float4 particle50;
uniform float4 particle51;
uniform float4 particle52;
uniform float4 particle53;
uniform float4 particle54;
uniform float4 particle55;
uniform float4 particle56;
uniform float4 particle57;
uniform float4 particle58;
uniform float4 particle59;
uniform float4 particle60;
uniform float4 particle61;
uniform float4 particle62;
uniform float4 particle63;
uniform float4 particle64;
uniform float4 particle65;
uniform float4 particle66;
uniform float4 particle67;
uniform float4 particle68;
uniform float4 particle69;
uniform float4 particle70;
uniform float4 particle71;
uniform float4 particle72;
uniform float4 particle73;
uniform float4 particle74;
uniform float4 particle75;
uniform float4 particle76;
uniform float4 particle77;

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

float2 get_trail(float2 uv, float2 trail, float aspect_ratio) {
  uv -=0.5;
  uv -= trail - 0.5;
  uv.x *= aspect_ratio;
  return uv;
}

float remap01(float a, float b, float t) {
  return saturate((t-a)/(b-a));
}

float4 add_trail(float2 uv, float4 p, float4 outer_col, float aspect_ratio) {
  if (p.x<-2 && p.y <-2) return outer_col;
  float4 col = float4(1.0.xxxx);
  p.x /= aspect_ratio;
  p.w = remap01(0.1,1.85,p.w);
  float3 modif = float3(p.w,1-p.w,p.w);
  float2 uv2 = get_trail(uv,p.xy,aspect_ratio);
  float rsize = 0.006 - remap01(0.7,1.0,p.z)*0.001;
  float res2 = sdCircle1(uv2,rsize.xx);
  float res3 = smoothstep(0.0,rsize,sdCircle1(uv2,rsize.xx));
  float3 m = float3(0.0.xxx);
  m+= 0.094/res2;
  col = saturate(lerp(float4(m*float3(modif.r*1.3,modif.g*1.1,modif.b*0.051),1.0),outer_col,0.99)); // 0.99 then 1.01 to compensate brightness
  col = lerp(float4(
  modif.r,saturate(atan(exp(modif.r*dot(modif,modif))/pow(atan(itime)/modif.g,1.1)*sin(itime*10.))),modif.g,1.0),
  col*1.01,res3);
  //col = lerp(float4(saturate(modif),1.0),col,res3);
  return saturate(col);
}

float4 PassThrough(VertDataOut v_in) : TARGET
{
  float4 outer_col = image.Sample(textureSampler, v_in.uv);
  if(afk) return outer_col;
  outer_col = add_trail(v_in.uv, particle1,  outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle2,  outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle3,  outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle4,  outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle5,  outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle6,  outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle7,  outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle8,  outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle9,  outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle10, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle11, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle12, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle13, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle14, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle15, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle16, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle17, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle18, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle19, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle20, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle21, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle22, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle23, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle24, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle25, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle26, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle27, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle28, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle29, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle30, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle31, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle32, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle33, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle34, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle35, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle36, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle37, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle38, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle39, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle40, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle41, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle42, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle43, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle45, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle46, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle47, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle48, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle49, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle50, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle51, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle52, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle53, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle54, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle55, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle56, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle57, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle58, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle59, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle60, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle61, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle62, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle63, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle64, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle65, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle66, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle67, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle68, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle69, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle70, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle71, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle72, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle73, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle74, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle75, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle76, outer_col, v_in.aspect);
  outer_col = add_trail(v_in.uv, particle77, outer_col, v_in.aspect);
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

