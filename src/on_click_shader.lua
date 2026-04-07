S = obslua
local ffi = require("ffi")
local C = ffi.C
local bit = require("bit")
local _OR = bit.bor
if ffi.os == "Windows" then
  ffi.cdef([[
typedef struct {int x, y;} Point;
bool GetCursorPos(Point *lpPoint);
]])
  mouse_pos = ffi.new("Point")
else
  error("Not implemented, but may be possible on other platforms")
end

local _RUNTIME_STATE = {
  width = 1920,
  height = 1080,
  particles = nil,
  mouse_hooked = false,
  highlight = 0,
}

local function hook_mouse_buttons(particles, width, height)
  if _RUNTIME_STATE.mouse_hooked then
    return
  end
  local key_1 = '{"hlsl_1_mouse": [ { "key": "OBS_KEY_MOUSE1" } ], '
  local key_2 = '"hlsl_2_mouse": [ { "key": "OBS_KEY_MOUSE2" } ]}'
  local json_s = key_1 .. key_2
  default_hotkeys = {
    {
      id = "hlsl_1_mouse",
      des = "LMB state",
      callback = function(p)
        if p and _RUNTIME_STATE.particles then
          on_click_check(_RUNTIME_STATE.particles, _RUNTIME_STATE.width, _RUNTIME_STATE.height)
        end
      end,
    },
    { id = "hlsl_2_mouse", des = "RMB state", callback = function(p) end },
  }
  local settings = S.obs_data_create_from_json(json_s)
  for _, k in pairs(default_hotkeys) do
    local a = S.obs_data_get_array(settings, k.id)
    local h = S.obs_hotkey_register_frontend(k.id, k.des, k.callback)
    S.obs_hotkey_load(h, a)
    S.obs_data_array_release(a)
  end
  S.obs_data_release(settings)
  _RUNTIME_STATE.mouse_hooked = true
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

  instance.max_particles = 7

  S.obs_enter_graphics()
  instance.effect = S.gs_effect_create(SHADER, nil, nil)
  if instance.effect ~= nil then
    instance.params = {}
    instance.params.width = S.gs_effect_get_param_by_name(instance.effect, "width")
    instance.params.itime = S.gs_effect_get_param_by_name(instance.effect, "itime")
    instance.params.height = S.gs_effect_get_param_by_name(instance.effect, "height")
    instance.params.mouse = S.gs_effect_get_param_by_name(instance.effect, "mouse")
    instance.mouse_vec3 = S.vec3()
    local all_particles = {}
    for i = 1, instance.max_particles do
      instance.params["particle" .. i] = S.gs_effect_get_param_by_name(instance.effect, "particle" .. i)
      instance["particle" .. i .. "_vec4"] = S.vec4()
      table.insert(all_particles, { x = 0.0, y = 0.0, z = 0.0, dx = 0.0, dy = 0.0, age = 0.0 })
    end
    instance.all_particles = all_particles
  end
  S.obs_leave_graphics()
  if instance.effect == nil then
    SourceDef.destroy(instance)
    return nil
  end
  SourceDef.update(instance, self) -- initialize, self = settings
  return instance
end

function SourceDef:destroy()
  if self.effect ~= nil then
    S.obs_enter_graphics()
    S.gs_effect_destroy(self.effect)
    S.obs_leave_graphics()
  end
end

function SourceDef:get_name()
  return "[🎇] Click highlight by upgradeQ"
end
function SourceDef:get_width()
  return self.width
end
function SourceDef:get_height()
  return self.height
end

function SourceDef:get_properties()
  local props = S.obs_properties_create()
  S.obs_properties_add_int(props, "_w", "width", 1, 25600, 1)
  S.obs_properties_add_int(props, "_h", "height", 1, 14400, 1)
  return props
end

function SourceDef:update(settings)
  self.width = S.obs_data_get_double(settings, "_w")
  self.height = S.obs_data_get_double(settings, "_h")
  _RUNTIME_STATE.width = self.width
  _RUNTIME_STATE.height = self.height
  _RUNTIME_STATE.particles = self.all_particles
end

function SourceDef:get_defaults()
  S.obs_data_set_default_double(self, "_w", 1920)
  S.obs_data_set_default_double(self, "_h", 1080)
end

local function norm(val, amin, amax)
  return (val - amin) / (amax - amin)
end

local function get_cur_norm(w, h)
  C.GetCursorPos(mouse_pos)
  local norm_x = norm(mouse_pos.x, 0, w)
  norm_x = norm_x * (w / h) -- aspect ratio
  local norm_y = norm(mouse_pos.y, 0, h)
  return norm_x, norm_y
end

function on_click_check(particles, width, height)
  for _, v in ipairs(particles) do
    if v.age < 0 then
      v.age = 36
      v.x, v.y = get_cur_norm(width, height)
      v.dx, v.dy = 0.0000, 0.0000
      v.z = math.random()
      return
    end
  end
end

function SourceDef:Emitter()
  -- on render call
  for i = 1, self.max_particles do
    self.all_particles[i].age = self.all_particles[i].age - 1
    if self.all_particles[i].age < 0.0 then
      self.all_particles[i].x, self.all_particles[i].y = -3, -3
    end -- removes flickering
    self.all_particles[i].x = self.all_particles[i].x - self.all_particles[i].dx
    self.all_particles[i].y = self.all_particles[i].y + self.all_particles[i].dy

    self["particle" .. i .. "_vec4"].x = self.all_particles[i].x
    self["particle" .. i .. "_vec4"].y = self.all_particles[i].y
    self["particle" .. i .. "_vec4"].z = self.all_particles[i].z
    self["particle" .. i .. "_vec4"].w = self.all_particles[i].age
  end
end

function SourceDef:video_tick(seconds)
  self.current_time = self.current_time + seconds
  self.tick_tock = seconds
  SourceDef.Emitter(self)
end

function SourceDef:video_render()
  if not _RUNTIME_STATE.mouse_hooked then
    hook_mouse_buttons(self.all_particles, self.width, self.height)
  end

  S.gs_effect_set_float(self.params.itime, self.current_time + 0.0)
  self.mouse_vec3.x, self.mouse_vec3.y = get_cur_norm(self.width, self.height)
  self.mouse_vec3.z = _RUNTIME_STATE.highlight
  S.gs_effect_set_vec3(self.params.mouse, self.mouse_vec3)
  S.gs_effect_set_int(self.params.width, self.width)
  S.gs_effect_set_int(self.params.height, self.height)
  for i = 1, self.max_particles do
    S.gs_effect_set_vec4(self.params["particle" .. i], self["particle" .. i .. "_vec4"])
  end

  while S.gs_effect_loop(self.effect, "Draw") do
    S.gs_draw_sprite(nil, 0, self.width, self.height)
  end
end

function script_properties()
  local props = S.obs_properties_create()
  S.obs_properties_add_button(props, "button2", "[🎇] Click highlight by upgradeQ", function() end)
  S.obs_properties_add_button(props, "button3", "Show/Hide", function()
    _RUNTIME_STATE.highlight = 1 - _RUNTIME_STATE.highlight
  end)
  return props
end

function script_load(settings)
  local my_filter = SourceDef:new({
    id = "cursor_shader_click",
    type = S.OBS_SOURCE_TYPE_SOURCE,
    output_flags = _OR(S.OBS_SOURCE_VIDEO, S.OBS_SOURCE_CUSTOM_DRAW),
  })
  S.obs_register_source(my_filter)
end

function script_description()
  return [[
<h2> cursor skin fx  for OBS Studio </h2>
<a style="color: #0000ff; text-decoration: none; font-size:26px;"
href="https://www.github.com/upgradeQ/cursor-skin-fx/blob/master/README.md">Visit the repository README.md</a><br/>
Copyright &copy; 2026 upgradeQ<br/>
Distributed under <a style="color: #ffffff; text-decoration: none;"> MIT license</a>
]]
end

SHADER = [[

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
    return lerp(destination, source, source.a);
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
  float circle = step(0.00001,d); 
  col = float4(circle,0,0,saturate(m*2));
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
  col = opOver(outer_col,col);

  return col;
}

float4 PassThrough(VertDataOut v_in) : TARGET
{
  float4 outer_col = float4(0,0,0,0);
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
]]
