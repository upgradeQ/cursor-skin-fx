S = obslua
local ffi = require"ffi"
local C = ffi.C
ffi.cdef[[
typedef struct {int x, y;} Point;
bool GetCursorPos(Point *lpPoint);
]]
RESOLUTION = {2560,1440};
local mouse_pos = ffi.new("Point")
local function norm(val,amin,amax) return (val-amin ) / (amax- amin) end

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
  instance.source = source
  S.obs_enter_graphics()
  instance.effect = S.gs_effect_create(SHADER, nil, nil)
  if instance.effect ~= nil then
    instance.params = {}
    instance.params.mouse_x = S.gs_effect_get_param_by_name(instance.effect, 'mouse_x')
    instance.params.mouse_y = S.gs_effect_get_param_by_name(instance.effect, 'mouse_y')
  end
  S.obs_leave_graphics()
  if instance.effect == nil then
    SourceDef.destroy(instance)
    return nil
  end
  return instance
end

function SourceDef:destroy()
  if self.effect ~= nil then
    S.obs_enter_graphics()
    S.gs_effect_destroy(self.effect)
    S.obs_leave_graphics()
  end
end

function SourceDef:get_name() return "Cursor Shader by upgradeQ" end
function SourceDef:get_width() return self.width end
function SourceDef:get_height() return self.height end
function SourceDef:video_tick(seconds)
  skip_tick_render(self) -- if source has crop or transform applied to it, this will let it render
end

function SourceDef:video_render(effect)
  if not S.obs_source_process_filter_begin(self.source, S.GS_RGBA, S.OBS_ALLOW_DIRECT_RENDERING) then return end
  C.GetCursorPos(mouse_pos)
  local norm_x = norm(mouse_pos.x,0,RESOLUTION[1])
  local norm_y = norm(mouse_pos.y,0,RESOLUTION[2])
  S.gs_effect_set_float(self.params.mouse_x, norm_x)
  S.gs_effect_set_float(self.params.mouse_y, norm_y)
  S.gs_effect_set_int(self.params.width, self.width)
  S.gs_effect_set_int(self.params.height, self.height)
  S.obs_source_process_filter_end(self.source, self.effect, self.width, self.height)
end

function script_load(settings)
  local my_filter = SourceDef:new({id='filter_cursor_shader',type=S.OBS_SOURCE_TYPE_FILTER,output_flags=S.OBS_SOURCE_VIDEO})
  S.obs_register_source(my_filter)
end

SHADER = ([[
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

float4 lerp(float4 a, float4 b, float t) { return (a + t*(b-a)); }

float4 PassThrough(VertDataOut v_in) : TARGET

{
   float2 uv = v_in.uv;
   float2 mousePos = float2(mouse_x,mouse_y);
   float ratio = %s.0/%s.0;
   float2 difference = uv - mousePos;
   difference.x *= ratio;
   float r = sqrt(difference.x*difference.x + difference.y*difference.y);
   r = clamp(r,0.0,1.0);
   r = 1.0 - r;
   float innerR = step(0.95,r);
   r = step(0.93,r);
   r -= innerR;
   float4 orig = image.Sample(textureSampler, uv);
   float4 col2 = float4(1.0,1.0,0.0,1.0);
   orig = lerp(orig,col2,r);
   return orig;

}

technique Draw
{
    pass
    {
        vertex_shader = VSDefault(v_in);
        pixel_shader  = PassThrough(v_in);
    }
}

]]):format(RESOLUTION[1],RESOLUTION[2])
