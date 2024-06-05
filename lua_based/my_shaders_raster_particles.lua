S = obslua
obs = S
local ffi = require"ffi"
local C = ffi.C
ffi.cdef[[
typedef struct {int x, y;} Point;
bool GetCursorPos(Point *lpPoint);
]]

function try_load_library(alias, name)
  if ffi.os == "OSX" then name = name .. ".0.dylib" end
  ok, _G[alias] = pcall(ffi.load, name)
  if not ok then 
    print(("WARNING:%s:Has failed to load, %s is nil"):format(name, alias))
  end
end

try_load_library("obsffi", "obs")

ffi.cdef[[
typedef struct {int x, y;} Point;
bool GetCursorPos(Point *lpPoint);
void *bmalloc(size_t size);
struct gs_device;
typedef struct gs_device gs_device_t;
void *gs_get_device_obj(void);

typedef unsigned long index_t;
struct gs_index_buffer;
typedef struct gs_index_buffer gs_indexbuffer_t;
enum gs_index_type {
  GS_UNSIGNED_SHORT,
  GS_UNSIGNED_LONG,
};

gs_indexbuffer_t *gs_indexbuffer_create(enum gs_index_type type, void *indices, size_t num, uint32_t flags);
void gs_load_indexbuffer(gs_indexbuffer_t *indexbuffer);
void gs_indexbuffer_destroy(gs_indexbuffer_t *indexbuffer);
void *bmalloc(size_t size);

struct d3ddeviceVTBL {
  void *QueryInterface;
  void *AddRef;
  void *Release;
  void *CreateBuffer;
  void *CreateTexture1D;
  void *CreateTexture2D;
  void *CreateTexture3D;
  void *CreateShaderResourceView;
  void *CreateUnorderedAccessView;
  void *CreateRenderTargetView;
  void *CreateDepthStencilView;
  void *CreateInputLayout;
  void *CreateVertexShader;
  void *CreateGeometryShader;
  void *CreateGeometryShaderWithStreamOutput;
  void *CreatePixelShader;
  void *CreateHullShader;
  void *CreateDomainShader;
  void *CreateComputeShader;
  void *CreateClassLinkage;
  void *CreateBlendState;
  void *CreateDepthStencilState;
  void *CreateRasterizerState;
  void *CreateSamplerState;
  void *CreateQuery;
  void *CreatePredicate;
  void *CreateCounter;
  void *CreateDeferredContext;
  void *OpenSharedResource;
  void *CheckFormatSupport;
  void *CheckMultisampleQualityLevels;
  void *CheckCounterInfo;
  void *CheckCounter;
  void *CheckFeatureSupport;
  void *GetPrivateData;
  void *SetPrivateData;
  void *SetPrivateDataInterface;
  void *GetFeatureLevel;
  void *GetCreationFlags;
  void *GetDeviceRemovedReason;
  void *GetImmediateContext;
  void *SetExceptionMode;
  void *GetExceptionMode;
};
struct d3ddevice {
  struct d3ddeviceVTBL** lpVtbl;
};

struct d3ddevicecontextVTBL {
  void *QueryInterface;
  void *Addref;
  void *Release;
  void *GetDevice;
  void *GetPrivateData;
  void *SetPrivateData;
  void *SetPrivateDataInterface;
  void *VSSetConstantBuffers;
  void *PSSetShaderResources;
  void *PSSetShader;
  void *SetSamplers;
  void *SetShader;
  void *DrawIndexed;
  void *Draw;
  void *Map;
  void *Unmap;
  void *PSSetConstantBuffer;
  void *IASetInputLayout;
  void *IASetVertexBuffers;
  void *IASetIndexBuffer;
  void *DrawIndexedInstanced;
  void *DrawInstanced;
  void *GSSetConstantBuffers;
  void *GSSetShader;
  void *IASetPrimitiveTopology;
  void *VSSetShaderResources;
  void *VSSetSamplers;
  void *Begin;
  void *End;
  void *GetData;
  void *GSSetPredication;
  void *GSSetShaderResources;
  void *GSSetSamplers;
  void *OMSetRenderTargets;
  void *OMSetRenderTargetsAndUnorderedAccessViews;
  void *OMSetBlendState;
  void *OMSetDepthStencilState;
  void *SOSetTargets;
  void *DrawAuto;
  void *DrawIndexedInstancedIndirect;
  void *DrawInstancedIndirect;
  void *Dispatch;
  void *DispatchIndirect;
  void *RSSetState;
  void *RSSetViewports;
  void *RSSetScissorRects;
  void *CopySubresourceRegion;
  void *CopyResource;
  void *UpdateSubresource;
  void *CopyStructureCount;
  void *ClearRenderTargetView;
  void *ClearUnorderedAccessViewUint;
  void *ClearUnorderedAccessViewFloat;
  void *ClearDepthStencilView;
  void *GenerateMips;
  void *SetResourceMinLOD;
  void *GetResourceMinLOD;
  void *ResolveSubresource;
  void *ExecuteCommandList;
  void *HSSetShaderResources;
  void *HSSetShader;
  void *HSSetSamplers;
  void *HSSetConstantBuffers;
  void *DSSetShaderResources;
  void *DSSetShader;
  void *DSSetSamplers;
  void *DSSetConstantBuffers;
  void *DSSetShaderResources;
  void *CSSetUnorderedAccessViews;
  void *CSSetShader;
  void *CSSetSamplers;
  void *CSSetConstantBuffers;
  void *VSGetConstantBuffers;
  void *PSGetShaderResources;
  void *PSGetShader;
  void *PSGetSamplers;
  void *VSGetShader;
  void *PSGetConstantBuffers;
  void *IAGetInputLayout;
  void *IAGetVertexBuffers;
  void *IAGetIndexBuffer;
  void *GSGetConstantBuffers;
  void *GSGetShader;
  void *IAGetPrimitiveTopology;
  void *VSGetShaderResources;
  void *VSGetSamplers;
  void *GetPredication;
  void *GSGetShaderResources;
  void *GSGetSamplers;
  void *OMGetRenderTargets;
  void *OMGetRenderTargetsAndUnorderedAccessViews;
  void *OMGetBlendState;
  void *OMGetDepthStencilState;
  void *SOGetTargets;
  void *RSGetState;
  void *RSGetViewports;
  void *RSGetScissorRects;
  void *HSGetShaderResources;
  void *HSGetShader;
  void *HSGetSamplers;
  void *HSGetConstantBuffers;
  void *DSGetShaderResources;
  void *DSGetShader;
  void *DSGetSamplers;
  void *DSGetConstantBuffers;
  void *CSGetShaderResources;
  void *CSGetUnorderedAccessViews;
  void *CSGetShader;
  void *CSGetSamplers;
  void *CSGetConstantBuffers;
  void *ClearState;
  void *Flush;
  void *GetType;
  void *GetContextFlags;
  void *FinishCommandList;
};

struct d3ddevicecontext {
  struct d3ddevicecontextVTBL** lpVtbl;
};

]]

local function skip_tick_render(ctx)
  local target = S.obs_filter_get_target(ctx.source)
  local width, height;
  if target == nil then width = 0; height = 0; else
    width = S.obs_source_get_base_width(target)
    height = S.obs_source_get_base_height(target)
  end
  ctx.width, ctx.height = width , height
end

local SourceDef = {}

function SourceDef:new(o)
  o = o or {}
  setmetatable(o, self)
  self.__index = self
  return o
end

function SourceDef:create(source)
  local instance = {}
  instance.width = 1
  instance.height = 1
  instance.current_time = 0
  instance.source = source
  S.obs_enter_graphics()
  instance.params = {}
  instance.made_by_upgradeQ = true

  instance.dt_width = 100
  instance.dt_height = 100
  instance.vertex_num = 6 * math.floor((instance.dt_width * instance.dt_height))
  instance.nvertex_num = (instance.vertex_num / 6) * 4
  instance.mouse_pos = ffi.new("Point")

  instance.effect = S.gs_effect_create(EFFECT, "simulation_step", nil)
  instance.texture_a = S.gs_texrender_create(S.GS_RGBA32F, S.GS_ZS_NONE) 
  instance.texture_b = S.gs_texrender_create(S.GS_RGBA32F, S.GS_ZS_NONE) 
  instance.texture_c = S.gs_texrender_create(S.GS_RGBA, S.GS_ZS_NONE) 
  instance.texture_c_clear = S.vec4()
  instance.clear_flags = bit.bor(S.GS_CLEAR_COLOR)
  instance.current_texrender = instance.texture_a
  instance.tex3 = S.gs_texrender_get_texture(instance.texture_a)
  instance.pingpong = nil
  instance.num = 0
  instance.effect2 = S.gs_effect_create(EFFECT2, "raster_step", nil)
  if instance.effect2 == nil then print('failed to compile effect2') end

  instance.params.image2 = S.gs_effect_get_param_by_name(instance.effect2, 'image')
  instance.effect3 = S.obs_get_base_effect(S.OBS_EFFECT_DEFAULT)
  instance.params.image3 = S.gs_effect_get_param_by_name(instance.effect3, 'image')
  if instance.effect ~= nil then
    instance.params.width = S.gs_effect_get_param_by_name(instance.effect, 'width')
    instance.params.itime = S.gs_effect_get_param_by_name(instance.effect, 'itime')
    instance.params.height = S.gs_effect_get_param_by_name(instance.effect, 'height')
    instance.params.mouse_x = S.gs_effect_get_param_by_name(instance.effect, 'mouse_x')
    instance.params.mouse_y = S.gs_effect_get_param_by_name(instance.effect, 'mouse_y')
    instance.params.image = S.gs_effect_get_param_by_name(instance.effect, 'image')
  end

  instance.params.itime2 = S.gs_effect_get_param_by_name(instance.effect2, "itime")
  instance.params.nvertex = S.gs_effect_get_param_by_name(instance.effect2, "nvertex")
  instance.params.width2 = S.gs_effect_get_param_by_name(instance.effect2, "width")
  instance.params.height2 = S.gs_effect_get_param_by_name(instance.effect2, "height")
  instance.params.scale = S.gs_effect_get_param_by_name(instance.effect2, "scale")
  instance.params.tar_tex = S.gs_effect_get_param_by_name(instance.effect2, "target_tex")

  local inum = instance.vertex_num
  local indices = ffi.cast("index_t*", obsffi.bmalloc(inum * ffi.sizeof("index_t")))
  for i =0, inum -1, 6 do
    indices[i+0] = (i/6)*4 + 0
    indices[i+1] = (i/6)*4 + 1
    indices[i+2] = (i/6)*4 + 2

    indices[i+3] = (i/6)*4 + 2
    indices[i+4] = (i/6)*4 + 3
    indices[i+5] = (i/6)*4 + 1
  end
  instance.indexbuffer = obsffi.gs_indexbuffer_create(S.GS_UNSIGNED_LONG, indices, inum, 0)

  S.gs_render_start(true)
  local x, y, r;
  for i = 0, (instance.dt_width * instance.dt_height) - 1 do
    x = math.floor(i / instance.dt_width)
    y = i % instance.dt_width
    r = math.random()
    S.gs_vertex3f(x, y, r)
    S.gs_vertex3f(x, y, r)
    S.gs_vertex3f(x, y, r)
    S.gs_vertex3f(x, y, r)
  end
  instance.my_v_buf = S.gs_render_save()

  instance.device = obsffi.gs_get_device_obj()

  instance.pDevice = ffi.cast("struct d3ddevice*", instance.device)
  instance.GetImmediateContext = ffi.cast("long(__stdcall*)(void*, void**)", instance.pDevice.lpVtbl[40])
  instance.arg1 = ffi.new('unsigned long[1]') 
  instance.pContext = ffi.cast("void**", instance.arg1)
  instance.GetImmediateContext(instance.pDevice, instance.pContext)
  instance.pContext2 = ffi.cast("struct d3ddevicecontext*", instance.pContext[0])
  instance.Release_pContext = ffi.cast("unsigned long(__stdcall*)(void*)", instance.pContext2.lpVtbl[2])
  instance.Release_pDevice = ffi.cast("unsigned long(__stdcall*)(void*)", instance.pDevice.lpVtbl[2])
  instance.VSSetShaderResources = ffi.cast("long(__stdcall*)(void*, unsigned int, unsigned int, void**)", instance.pContext2.lpVtbl[25])
  instance.PSGetShaderResources = ffi.cast("long(__stdcall*)(void*, unsigned int, unsigned int, void**)", instance.pContext2.lpVtbl[73])

  instance.arg2 = ffi.new("unsigned long[1]")
  instance.pRes = ffi.cast("void**", instance.arg2)

  S.obs_leave_graphics()
  if instance.effect == nil then
    SourceDef.destroy(instance)
    return nil
  end

  SourceDef.update(instance, self)
  return instance
end

function SourceDef:destroy()
  if self.effect ~= nil then
    S.obs_enter_graphics()
    S.gs_effect_destroy(self.effect)
    S.gs_effect_destroy(self.effect2)
    S.gs_vertexbuffer_destroy(self.my_v_buf)
    obsffi.gs_indexbuffer_destroy(self.indexbuffer)

    self.Release_pContext(self.pContext2)
    self.Release_pDevice(self.pDevice)
    S.gs_texrender_destroy(self.texture_a)
    S.gs_texrender_destroy(self.texture_b)
    S.gs_texrender_destroy(self.texture_c)
    S.obs_leave_graphics()
  end
end

function SourceDef:get_name() return "^🪄 Raster particles cursor by upgradeQ 🪄^" end
function SourceDef:get_width() return self.width end
function SourceDef:get_height() return self.height end


function SourceDef:get_properties()
  local props = S.obs_properties_create()
  S.obs_properties_add_int(props, "_w", "width", 1, 2560, 1)
  S.obs_properties_add_int(props, "_h", "height", 1, 1440, 1)
  S.obs_properties_add_button(props, "button", "^🪄 Raster particles cursor by upgradeQ 🪄^", function() end)
  return props
end

function SourceDef:update(settings)
  self.width = S.obs_data_get_double(settings, "_w")
  self.height = S.obs_data_get_double(settings, "_h")
end

function SourceDef:get_defaults()
  S.obs_data_set_default_double(self, "_w", 128)
  S.obs_data_set_default_double(self, "_h", 72)
end

function SourceDef:video_tick(seconds)
  self.current_time = self.current_time + seconds
end

function SourceDef:video_render()
  C.GetCursorPos(self.mouse_pos)

  S.gs_texrender_reset(self.current_texrender)
  S.gs_effect_set_float(self.params.itime, self.current_time)
  S.gs_effect_set_float(self.params.mouse_x, self.mouse_pos.x)
  S.gs_effect_set_float(self.params.mouse_y, self.mouse_pos.y)
  S.gs_effect_set_int(self.params.width, self.width)
  S.gs_effect_set_int(self.params.height, self.height)
  S.gs_effect_set_texture(self.params.image, self.tex3)
  if S.gs_texrender_begin(self.current_texrender, self.dt_width, self.dt_height) then

    while S.gs_effect_loop(self.effect, "Draw") do
      S.gs_ortho(0, self.dt_width, 0, self.dt_height, -100.0, 100.0)
      S.gs_draw_sprite(nil, 0, self.dt_width, self.dt_height)
    end
    S.gs_texrender_end(self.current_texrender)
  end

  self.tex3 = S.gs_texrender_get_texture(self.current_texrender)
  if (self.made_by_upgradeQ) then
    self.current_texrender = self.texture_b
  else
    self.current_texrender = self.texture_a
  end
  self.made_by_upgradeQ = not self.made_by_upgradeQ

  S.gs_texrender_reset(self.texture_c)
  if S.gs_texrender_begin(self.texture_c, self.width*(self.width/2560), self.height*(self.width/2560)) then

    S.gs_clear(self.clear_flags, self.texture_c_clear, 0, 0)

    self.pingpong = S.gs_texrender_get_texture(self.current_texrender)
    S.gs_effect_set_texture(self.params.image2, self.pingpong)
    S.gs_effect_set_float(self.params.itime2, self.current_time)
    S.gs_effect_set_float(self.params.nvertex, self.nvertex_num)
    S.gs_effect_set_float(self.params.width2, self.width)
    S.gs_effect_set_float(self.params.height2, self.height)
    S.gs_effect_set_float(self.params.scale, self.width/2560)
    while S.gs_effect_loop(self.effect2, "Draw123") do
      S.gs_load_texture(self.pingpong, 0)
      self.PSGetShaderResources(self.pContext2, 0, 1, self.pRes)
      self.VSSetShaderResources(self.pContext2, 0, 1, self.pRes)
      obsffi.gs_load_indexbuffer(self.indexbuffer)
      S.gs_load_vertexbuffer(self.my_v_buf)
      S.gs_draw(S.GS_TRIS, 0, self.vertex_num)
    end
    S.gs_texrender_end(self.texture_c)
  end

  self.tex4 = S.gs_texrender_get_texture(self.texture_c)
  S.gs_effect_set_texture(self.params.image3, self.tex4)
  while S.gs_effect_loop(self.effect3, "Draw") do
    S.gs_draw_sprite(self.tex4, 0, self.width, self.height)
  end

end

function script_load(settings) -- OBS_SOURCE_CUSTOM_DRAW
  local my_source = SourceDef:new({id='cursor_shader_raster_particles', type=S.OBS_SOURCE_TYPE_SOURCE,
    output_flags=bit.bor(S.OBS_SOURCE_VIDEO, S.OBS_SOURCE_CUSTOM_DRAW)})
  S.obs_register_source(my_source)
end

EFFECT2 = [[
// OBS-specific syntax adaptation to HLSL standard to avoid errors reported by the code editor
#define SamplerState sampler_state
#define Texture2D texture2d
uniform float4x4 ViewProj;
uniform Texture2D image;


uniform float itime;
uniform float nvertex;
uniform float width;
uniform float height;
uniform float scale;


SamplerState textureSampler {
    Filter   = Linear;
    AddressU = Clamp;
    AddressV = Clamp;
};

struct VertexShaderInput {
  float4 pos : POSITION;
  uint id : VERTEXID;
};
// note VERTEXID naming

struct PixelShaderInput {
  float4 pos : POSITION;
  float4 uv  : TEXCOORD0;
  float2 center  : TEXCOORD1;
};

float t5p5(float v) {
   return v*0.5 + 0.5;
}

float sdCircle1(float2 p, float r) {
  return length(p) - r;
}


float remap01(float a, float b, float t) {
  return saturate((t - a) / (b - a));
}

float remap(float a, float b, float c, float d, float t) {
  return remap01(a, b, t) * (d - c) + c;
}

float hash11(float p)
{
    p = frac(p * .1031);
    p *= p + 33.33;
    p *= p + p;
    return frac(p);
}

float sm1(float t, float T) {
  if( t>=T ) return t - 0.5*T;
  float f = t/T;
  return f*f*f*(T-t*0.5);
}

PixelShaderInput VSParticles(VertexShaderInput vert_in)
{
  PixelShaderInput vert_out;

  uint qid = vert_in.id % 4;
  uint qid2 = vert_in.id / 4;
  float2 position = float2(qid % 2, qid / 2);
  uint2 coord = uint2(vert_in.pos.xy);
  float r_id = vert_in.pos.z;
  float4 tex_data = image.Load(uint3(coord, 0)); 
  vert_in.pos.xyz = tex_data.xyz;
  vert_in.pos.x *= width/height;
  vert_in.pos.xy /= .5;
  vert_in.pos.xy *= scale;
  vert_out.uv.xy = float2((vert_in.id << 1) & 2, vert_in.id & 2);
  vert_out.uv.zw = float2(vert_in.pos.z, qid2);

  float rsize = 1-vert_out.uv.z;
  float r_angle = r_id*2*3.14159;

  float r_x = 4.4*rsize * cos(r_angle);
  float r_y = 4.4*rsize * sin(r_angle);
  vert_out.center = float2( rsize * cos(r_angle), rsize * sin(r_angle));

  float t1 = vert_out.uv.z;
  position.x -= 0.7;
  position.y -= 0.6 ;
  position.x -= r_x;
  position.y -= r_y ;

  position += vert_in.pos.xy*14.5;

  vert_in.pos.xy = position;
  vert_in.pos.xy *= 50;
  vert_out.pos = mul(float4(vert_in.pos.xy, 1.0, 1.0), ViewProj);
  return vert_out;
}

float4 PSParticles(PixelShaderInput vert_in) : TARGET
{
  float d = sdCircle1(vert_in.uv.xy-1.0.xx, sm1(vert_in.uv.z*1.66666667, vert_in.uv.z));
  float2 c0 = vert_in.center;
  d = (1-smoothstep(0, 0.15, d));
  //return float4(1, 1, 1, d);
  float b = 1-smoothstep(0,0.9,vert_in.uv.z);
  return float4(d*0.1 + b , d*0.9 + b ,b + d*1.0, d*0.15*vert_in.uv.z);
  //return float4(vert_in.uv.xy, 0.0, 1.0);
}
technique Draw123
{
    pass
    {
        vertex_shader = VSParticles(vert_in);
        pixel_shader  = PSParticles(vert_in);
    }
}
]]

EFFECT = ([[
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

float hash11(float p)
{
    p = frac(p * .1031);
    p *= p + 33.33;
    p *= p + p;
    return frac(p);
}

float t5p5(float v) {
   return v*0.5 + 0.5;
}
float4 PassThrough(VertDataOut v_in) : TARGET
{
   float2 uv = v_in.uv;
   float2 mousePos = float2(mouse_x, mouse_y);
   float4 draw = image.Sample(textureSampler, uv);
   float4 fragColor = float4(draw.rgb, 1.0f);
   fragColor.z -= 1.01 * 0.015;
   fragColor.y += 0.005;
   if(fragColor.z <0.0) {
      float4 draw2 = image.Sample(textureSampler, uv+float2(hash11(v_in.pos.x*sin(itime)), hash11(v_in.pos.y)));
      fragColor.xy = (mousePos/float2(width, height)) + float2(0.003,0.003);
      fragColor.z = t5p5(sin(v_in.pos.x*v_in.pos.y*draw2.r*draw2.g));
    }
   return fragColor;
}
technique Draw
{
    pass
    {
        vertex_shader = VSDefault(v_in);
        pixel_shader  = PassThrough(v_in);
    }
}
]])

-- vim: ft=lua ts=2 sw=2 et sts=2
