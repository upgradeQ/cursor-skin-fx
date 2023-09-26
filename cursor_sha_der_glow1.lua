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
    instance.params.idsd = S.gs_effect_get_param_by_name(instance.effect, 'idsd')
    instance.params.rsize = S.gs_effect_get_param_by_name(instance.effect, 'rsize')
    instance.params.r1 = S.gs_effect_get_param_by_name(instance.effect, 'r1')
    instance.params.g1 = S.gs_effect_get_param_by_name(instance.effect, 'g1')
    instance.params.b1 = S.gs_effect_get_param_by_name(instance.effect, 'b1')
    instance.params.r2 = S.gs_effect_get_param_by_name(instance.effect, 'r2')
    instance.params.g2 = S.gs_effect_get_param_by_name(instance.effect, 'g2')
    instance.params.b2 = S.gs_effect_get_param_by_name(instance.effect, 'b2')
  end
  S.obs_leave_graphics()
  if instance.effect == nil then
    SourceDef.destroy(instance)
    return nil
  end
  SourceDef.update(instance,self) -- initialize, self = settings
  return instance
end

function SourceDef:destroy()
  if self.effect ~= nil then
    S.obs_enter_graphics()
    S.gs_effect_destroy(self.effect)
    S.obs_leave_graphics()
  end
end

function SourceDef:get_name() return "Neon shape cursor by upgradeQ" end

function SourceDef:get_properties()
  local props = S.obs_properties_create()
  S.obs_properties_add_float_slider(props, "idsd", "Shape id", 0.5, 3.0, 1.00)
  S.obs_properties_add_float_slider(props, "rsize", "Size", 0.01, 0.3, 0.0001)
  S.obs_properties_add_float_slider(props, "r1", "Red channel", 0.0, 1.0, 0.0001)
  S.obs_properties_add_float_slider(props, "g1", "Green channel", 0.0, 1.0, 0.0001)
  S.obs_properties_add_float_slider(props, "b1", "Blue channel", 0.0, 1.0, 0.0001)
  S.obs_properties_add_float_slider(props, "r2", "[i]Red channel", 0.0, 1.0, 0.0001)
  S.obs_properties_add_float_slider(props, "g2", "[i]Green channel", 0.0, 1.0, 0.0001)
  S.obs_properties_add_float_slider(props, "b2", "[i]Blue channel", 0.0, 1.0, 0.0001)
  return props
end

function SourceDef.get_defaults(settings)
  S.obs_data_set_default_double(settings, "rsize", 0.05)
  S.obs_data_set_default_double(settings, "idsd", 0.0)
  S.obs_data_set_default_double(settings, "r1", 0.0)
  S.obs_data_set_default_double(settings, "g1", 0.5)
  S.obs_data_set_default_double(settings, "b1", 0.0)
  S.obs_data_set_default_double(settings, "r2", 1.0)
  S.obs_data_set_default_double(settings, "g2", 1.0)
  S.obs_data_set_default_double(settings, "b2", 1.0)
end

function SourceDef:update(settings)
  self.rsize = S.obs_data_get_double(settings, "rsize")
  self.idsd = S.obs_data_get_double(settings, "idsd")
  self.r1 = S.obs_data_get_double(settings, "r1")
  self.g1 = S.obs_data_get_double(settings, "g1")
  self.b1 = S.obs_data_get_double(settings, "b1")
  self.r2 = S.obs_data_get_double(settings, "r2")
  self.g2 = S.obs_data_get_double(settings, "g2")
  self.b2 = S.obs_data_get_double(settings, "b2")
end
function SourceDef:get_width() return self.width end
function SourceDef:get_height() return self.height end
function SourceDef:video_tick(seconds)
  self.current_time = self.current_time + seconds
  skip_tick_render(self) -- if source has crop or transform applied to it, this will let it render
end

local function norm(val,amin,amax) return (val-amin ) / (amax- amin) end

function SourceDef:video_render()
  if ffi.os == "Windows" then
    C.GetCursorPos(mouse_pos)
  else
    mouse_pos.x,mouse_pos.y = get_x11_mpos()
  end
  local target = S.obs_filter_get_target(self.source)
  local norm_x = norm(mouse_pos.x,0,self.width)
  local norm_y = norm(mouse_pos.y,0,self.height)
  S.gs_effect_set_float(self.params.itime, self.current_time+0.0)
  S.gs_effect_set_float(self.params.mouse_x, norm_x)
  S.gs_effect_set_float(self.params.mouse_y, norm_y)
  S.gs_effect_set_bool(self.params.pressed_l, _G.pressed_l)
  S.gs_effect_set_bool(self.params.pressed_r, _G.pressed_r)
  S.gs_effect_set_int(self.params.width, self.width)
  S.gs_effect_set_int(self.params.height, self.height)
  S.gs_effect_set_float(self.params.rsize, self.rsize)
  S.gs_effect_set_float(self.params.idsd, self.idsd)
  S.gs_effect_set_float(self.params.r1, self.r1)
  S.gs_effect_set_float(self.params.g1, self.g1)
  S.gs_effect_set_float(self.params.b1, self.b1)
  S.gs_effect_set_float(self.params.r2, self.r2)
  S.gs_effect_set_float(self.params.g2, self.g2)
  S.gs_effect_set_float(self.params.b2, self.b2)
  if not S.obs_source_process_filter_begin(self.source, S.GS_RGBA, S.OBS_ALLOW_DIRECT_RENDERING) then return end
  S.obs_source_process_filter_tech_end(self.source, self.effect, self.width, self.height,"Draw")
end

function script_properties()
  local props = S.obs_properties_create()
  S.obs_properties_add_button(props, "button2", "Neon shape cursor by upgradeQ",
  function() end)
  return props
end

function script_load(settings) -- OBS_SOURCE_CUSTOM_DRAW
  local my_filter = SourceDef:new({id='filter_cursor_shader_neon',type=S.OBS_SOURCE_TYPE_FILTER,
    output_flags=_OR(S.OBS_SOURCE_VIDEO,S.OBS_SOURCE_CUSTOM_DRAW)})
  hook_mouse_buttons()
  S.obs_register_source(my_filter)
end

function read_from(file)
    local f = assert(io.open(file, "rb"))
    local content = f:read("*all")
    f:close()
    return content
end

--SHADER = ([==[ ]==])
SHADER = read_from(script_path() .. "my_glow_shader.hlsl")
