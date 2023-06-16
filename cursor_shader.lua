S = obslua
local ffi = require"ffi"
local C = ffi.C
local _OR = bit.bor
local x11,mouse_pos,get_x11_mpos;
if ffi.os == "Windows" then
ffi.cdef[[
typedef struct {int x, y;} Point;
bool GetCursorPos(Point *lpPoint);
]]
mouse_pos = ffi.new("Point")
elseif ffi.os == "Linux" then
mouse_pos = {x=0,y=0}
x11 = ffi.load("X11.so.6")
ffi.cdef[[
typedef void Display;
typedef unsigned long XID;
typedef XID Window;
typedef XID Colormap;
typedef struct{
  void* ext_data;
  void* display;
  Window root;
  int width, height;
  int mwidth, mheight;
  int ndepths;
  void* depths;
  int root_depth;
  void* root_visual;
  void* default_gc;
  Colormap cmap;
  // Rest doesn't matter
}Screen;
typedef char* XPointer;
typedef struct{
  void* ext_data;
  void* private1;
  int fd;
  int private2;
  int proto_major_version;
  int proto_minor_version;
  char* vendor;
  XID private3;
  XID private4;
  XID private5;
  int private6;
  XID (*resource_alloc)(void*);
  int byte_order;
  int bitmap_unit;
  int bitmap_pad;
  int bitmap_bit_order;
  int nformats;
  void* pixmap_format;
  int private8;
  int release;
  void* private9, *private10;
  int qlen;
  unsigned long last_request_read;
  unsigned long request;
  XPointer private11;
  XPointer private12;
  XPointer private13;
  XPointer private14;
  unsigned max_request_size;
  void* db;
  int (*private15)(void*);
  char* display_name;
  int default_screen;
  // Rest doesn't matter
}*_XPrivDisplay;
typedef int Bool;
typedef struct{
  int x, y;
  int width, height;
  int border_width;
  int depth;
  void* visual;
  Window root;
  int class;
  int bit_gravity;
  int win_gravity;
  int backing_store;
  unsigned long backing_planes;
  unsigned long backing_pixel;
  Bool save_under;
  Colormap colormap;
  Bool map_installed;
  int map_state;
  long all_event_masks;
  long your_event_mask;
  long do_not_propagate_mask;
  Bool override_redirect;
  Screen *screen;
}XWindowAttributes;
Display* XOpenDisplay(char*);
int XCloseDisplay(Display*);
Screen* XScreenOfDisplay(Display*, int);
Bool XQueryPointer(Display*, Window, Window*, Window*, int*, int*, int*, int*, unsigned int*);
]]
-- from https://gist.github.com/Youka/193afdec83321f4f51a2
function get_x11_mpos()
  local display = x11.XOpenDisplay(nil)
  if not display then
    error("Couldn't open display!", 2)
  end
  local root = x11.XScreenOfDisplay(display, ffi.cast("_XPrivDisplay", display)[0].default_screen)[0].root
  -- Get cursor position
  local root_window, child_window, root_x, root_y, win_x, win_y, mask = ffi.new("Window[1]"), ffi.new("Window[1]"), ffi.new("int[1]"), ffi.new("int[1]"), ffi.new("int[1]"), ffi.new("int[1]"), ffi.new("unsigned int[1]")
  if x11.XQueryPointer(display, root, root_window, child_window, root_x, root_y, win_x, win_y, mask) == 0 then
    error("Couldn't get cursor position!", 2)
  end
  x11.XCloseDisplay(display)
  return win_x[0], win_y[0]
end

else
  error("Not implemented")
end
_G.pressed_l, _G.pressed_r = false, false

local function skip_tick_render(ctx)
  local target = S.obs_filter_get_target(ctx.source)
  local width, height;
  if target == nil then width = 0; height = 0; else
    width = S.obs_source_get_base_width(target)
    height = S.obs_source_get_base_height(target)
  end
  ctx.width, ctx.height = width , height
end

local function hook_mouse_buttons()
    if _G.MOUSE_HOOKED then return end
    local key_1 = '{"htk_1_mouse": [ { "key": "OBS_KEY_MOUSE1" } ], '
    local key_2 = '"htk_2_mouse": [ { "key": "OBS_KEY_MOUSE2" } ]}'
    local json_s = key_1 .. key_2
    default_hotkeys = {
      {id="htk_1_mouse", des="LMB state", callback=function(p) _G.pressed_l = p end},
      {id="htk_2_mouse", des="RMB state", callback=function(p) _G.pressed_r = p end},
    }
    local settings = S.obs_data_create_from_json(json_s)
    for _,k in pairs(default_hotkeys) do
      local a = S.obs_data_get_array(settings, k.id)
      local h = S.obs_hotkey_register_frontend(k.id, k.des, k.callback)
      S.obs_hotkey_load(h, a)
      S.obs_data_array_release(a)
    end
    S.obs_data_release(settings)
    _G.MOUSE_HOOKED = True
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
  instance.effect = S.gs_effect_create(SHADER, nil, nil)
  if instance.effect ~= nil then
    instance.params = {}
    instance.params.width = S.gs_effect_get_param_by_name(instance.effect, 'width')
    instance.params.itime = S.gs_effect_get_param_by_name(instance.effect, 'itime')
    instance.params.height = S.gs_effect_get_param_by_name(instance.effect, 'height')
    instance.params.mouse_x = S.gs_effect_get_param_by_name(instance.effect, 'mouse_x')
    instance.params.mouse_y = S.gs_effect_get_param_by_name(instance.effect, 'mouse_y')
    instance.params.image = S.gs_effect_get_param_by_name(instance.effect, 'image')
    instance.params.pressed_l = S.gs_effect_get_param_by_name(instance.effect, 'pressed_l')
    instance.params.pressed_r = S.gs_effect_get_param_by_name(instance.effect, 'pressed_r')
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

function SourceDef:get_name() return "Magic stick shader by upgradeQ" end

function SourceDef:get_properties()
  local props = S.obs_properties_create()
  S.obs_properties_add_button(props, "button1", "Magic stick shader by upgradeQ",
  function() end)
  return props
end

function SourceDef:update(settings) end
function SourceDef:get_width() return self.width end
function SourceDef:get_height() return self.height end
function SourceDef:video_tick(seconds)
  self.current_time = self.current_time + seconds
  skip_tick_render(self) -- if source has crop or transform applied to it, this will let it render
end

function SourceDef:video_render()
  if ffi.os == "Windows" then
    C.GetCursorPos(mouse_pos)
  else
    mouse_pos.x,mouse_pos.y = get_x11_mpos()
  end
  local target = S.obs_filter_get_target(self.source)

  S.gs_effect_set_float(self.params.itime, self.current_time+0.0)
  S.gs_effect_set_float(self.params.mouse_x, mouse_pos.x+0.0)
  S.gs_effect_set_float(self.params.mouse_y, mouse_pos.y+0.0)
  S.gs_effect_set_bool(self.params.pressed_l, _G.pressed_l)
  S.gs_effect_set_bool(self.params.pressed_r, _G.pressed_r)
  S.gs_effect_set_int(self.params.width, self.width)
  S.gs_effect_set_int(self.params.height, self.height)
  if not S.obs_source_process_filter_begin(self.source, S.GS_RGBA, S.OBS_ALLOW_DIRECT_RENDERING) then return end
  S.obs_source_process_filter_tech_end(self.source, self.effect, self.width, self.height,"Draw")
end

function script_properties()
  local props = S.obs_properties_create()
  S.obs_properties_add_button(props, "button2", "Magic stick shader by upgradeQ",
  function() end)
  return props
end

function script_load(settings) -- OBS_SOURCE_CUSTOM_DRAW
  local my_filter = SourceDef:new({id='filter_cursor_shader3d',type=S.OBS_SOURCE_TYPE_FILTER,
    output_flags=_OR(S.OBS_SOURCE_VIDEO,S.OBS_SOURCE_CUSTOM_DRAW)})
  hook_mouse_buttons()
  S.obs_register_source(my_filter)
end

SHADER = ([==[
// OBS-specific syntax adaptation to HLSL standard to avoid errors reported by the code editor
#define SamplerState sampler_state
#define Texture2D texture2d

// Mandatory - Set by OBS: View-projection matrix to adapt raw coordinates according to transform
uniform float4x4 ViewProj;

// Mandatory - Set by OBS: Texture with the source picture transformed by previous filters in chain
uniform Texture2D image;

// Size of the source picture
uniform int width;
uniform int height;

uniform float mouse_x;
uniform float mouse_y;
uniform float itime;

uniform bool pressed_l;
uniform bool pressed_r;

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


VertDataOut VSDefault(VertDataIn v_in) {
  VertDataOut vert_out;
  vert_out.pos = mul(float4(v_in.pos.xyz, 1.0), ViewProj);
  vert_out.uv  = v_in.uv;

  return vert_out;
}

#define MAX_MARCHING_STEPS 55
#define MIN_DIST 0.0
#define MAX_DIST 100.0
#define PRECISION 0.001
#define COLOR_BACKGROUND float3(0.835,1.0,1.0)

float3x3 rotateX(float theta) {
  float c = cos(theta);
  float s = sin(theta);
  return float3x3(
    float3(1.0,0.0,0.0),
    float3(1.0,c,-s),
    float3(1.0,s,c));
}

float3x3 rotateY(float theta) {
  float c = cos(theta);
  float s = sin(theta);
  return float3x3(
    float3(c,0.0,s),
    float3(0.0,1.0,0.0),
    float3(-s,0.0,c));
}

float3x3 rotateZ(float theta) {
  float c = cos(theta);
  float s = sin(theta);
  return float3x3(
    float3(c,-s,0.0),
    float3(s,c,0.0),
    float3(0.0,0.0,1.0));
}

float3x3 identity() {
  return float3x3(
    float3(1.0,0.0,0.0),
    float3(0.0,1.0,0.0),
    float3(0.0,0.0,1.0));
}

float sdBox( float3 p, float3 b,float3x3 transform) {
  p = mul(p,transform);
  float3 q = abs(p) - b;
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0);
}

float2 opU(float2 d1, float2 d2) {
  return(d1.x < d2.x) ? d1 : d2; // x = signed distance
}

float2 map(float3 p) {
  float2 res = float2(1e10,0.);
  float2 my_box = float2(sdBox(p - float3(-2.5-0.185,-0.6-0.40,0.),float3(0.3,0.3,0.2),rotateZ(45.0*3.14159/180.0)), 1.5);
  float2 my_box2 = float2(sdBox(p - float3(-1.75-0.185,0.15-0.40,-0.001),float3(1.1,0.3,0.2),rotateZ(45.0*3.14159/180.0)), 2.5);
  res = opU(res, my_box);
  res = opU(res, my_box2);
  return res; // the y-component is the ID of the object hit by the ray
}

float2 rayMarch(float3 ro, float3 rd) {
  float depth = MIN_DIST;
  float2 res = float2(0.0,0.0); // initialize result to zero for signed distance value and ID
  float id = 0.;

  for (int i = 0; i < MAX_MARCHING_STEPS; i++) {
    float3 p = ro + depth * rd;
    res = map(p); // find resulting target hit by ray
    depth += res.x;
    id = res.y;
    if (res.x < PRECISION || depth > MAX_DIST) break;
  }
  return float2(depth, id);
}

float3 calcNormal(in float3 p) {
    float2 e = float2(1.0, -1.0) * 0.0005; // epsilon
    return normalize(
      e.xyy * map(p + e.xyy).x +
      e.yyx * map(p + e.yyx).x +
      e.yxy * map(p + e.yxy).x +
      e.xxx * map(p + e.xxx).x);
}

float3 render(float3 ro, float3 rd, float3 bg_col, float2 uv) {
    float3 col = bg_col;
    float2 res = rayMarch(ro, rd);
    float d = res.x; // signed distance value
    if (d > MAX_DIST) return col; // render background color since ray hit nothing

    float id = res.y; // id of object
    
    float3 p = ro + rd * d; // point on sphere or floor we discovered from ray marching
    float3 normal = calcNormal(p);
    float3 lightPosition = float3(2., 2., 7.);
    float3 lightDirection = normalize(lightPosition - p);

    float dif = clamp(dot(normal, lightDirection), 0.3, 1.);

    if (id > 0.) col = dif * float3(0.2,0.2,0.2);
    if (id > 1.){ // simple blur
    float4 s11 = image.Sample(textureSampler, uv + float2(-1.0f / width, -1.0f / height));
    float4 s12 = image.Sample(textureSampler, uv  + float2(0.0, -1.0f / height));
    float4 s13 = image.Sample(textureSampler, uv  + float2(1.0f / width, -1.0f / height));

    float4 s21 =  image.Sample(textureSampler, uv + float2(-1.0f / width, 0.0));
    float4 col1 = image.Sample(textureSampler, uv );
    float4 s23 =  image.Sample(textureSampler, uv + float2(-1.0f / width, 0.0));

    float4 s31 =  image.Sample(textureSampler, uv + float2(-1.0f / width, 1.0f / height));
    float4 s32 = image.Sample(textureSampler, uv  + float2(0.0, 1.0f / height));
    float4 s33 = image.Sample(textureSampler, uv  + float2(1.0f / width, 1.0f / height));
    // Average the color with surrounding samples
    col1 = (col1 + s11 + s12 + s13 + s21 + s23 + s31 + s32 + s33) / 9;
    col = dif*col1.rgb;
    if(pressed_l) col *= float3(1.0,0.4,0.0);
    if(pressed_r) col *= float3(0.9,0.5,0.8);
    }
    if (id > 2.){ // shadertoy MdsXDM 2 sides painted
      float2 pos = (uv.xy-0.5);
      float2 cir = ((pos.xy*pos.xy+sin(mouse_x*0.001*0.5*uv.x*18.0+itime)/25.0*sin(uv.y*7.0+itime*1.5)/1.0)+uv.x*sin(itime)/16.0+uv.y*sin(itime*1.2)/16.0);
      float circles = (sqrt(abs(cir.x+cir.y*0.5)*25.0)*5.0);
      float4 fragColor1 = float4(sin(circles*1.25+2.0),abs(sin(circles*1.0-1.0)-sin(circles)),abs(sin(circles)*1.0),1.0);
      col = lerp(col, fragColor1, abs(dot(normal,float3(0.0,0.0,1.0))));
      cir = ((pos.xy*pos.xy+sin(mouse_x*0.001*0.5*uv.x*15.0+itime)/25.0*sin(uv.y*4.0+itime*1.5)/1.0)+uv.x*sin(itime)/16.0+uv.y*sin(itime*1.2)/16.0);
      circles = (sqrt(abs(cir.x+cir.y*0.5)*25.0)*5.0);
      float4 fragColor2 = float4(sin(circles*2.25+2.0),abs(sin(circles*1.0-1.0)-sin(circles)),abs(sin(circles)*1.0),1.0);
      col = lerp(col, fragColor2, abs(dot(normal,float3(0.0,1.0,0.0))));
      col = dif * col.rgb;
    }
  col += COLOR_BACKGROUND * 0.2; // add a bit of the light background color 
  return col;
}

bool is_inside_rect(float2 position) {
 bool is_to_left = position.x < 0.25;
 bool is_to_right = position.x > 0.75;
 bool is_below = position.y < 0.25;
 bool is_above = position.y > 0.75;
 return !(is_to_left || is_to_right || is_below || is_above );
}

float4 PassThrough(VertDataOut v_in) : TARGET {

  float4 orig = image.Sample(textureSampler, v_in.uv);
  float2 poss = v_in.pos.xy;
  poss.x -= mouse_x;
  poss.y -= mouse_y;
  float2 uv = (poss-.5*float2(width,height))/height;
  uv.x += .40;
  uv.y += .25;
  float3 ro = float3(0.,0.,3.); // ray origing that represents camera position
  float3 rd = normalize(float3(uv,-.5)); //ray direction

  if (is_inside_rect(float2(uv.x+0.85,uv.y+0.55))) { // bounding box
   float3 col = render(ro,rd,orig.rgb,v_in.uv);
   return float4(col.rgb,1.0);
  }
  return float4(orig.rgb,1.0);
}

technique Draw {
  pass {
    vertex_shader = VSDefault(v_in);
    pixel_shader  = PassThrough(v_in);
  }
}

]==])
