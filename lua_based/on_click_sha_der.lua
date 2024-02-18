S = obslua
local ffi = require"ffi"
local C = ffi.C
local bit = require"bit"
local _OR = bit.bor
if ffi.os == "Windows" then
ffi.cdef[[
typedef struct {int x, y;} Point;
bool GetCursorPos(Point *lpPoint);
]]
mouse_pos = ffi.new("Point")
else
  error("Not implemented, but may be possible on other platforms")
end

local function hook_mouse_buttons(particles,width,height)
  if _G.MOUSE_HOOKED then return end
  local key_1 = '{"hlsl_1_mouse": [ { "key": "OBS_KEY_MOUSE1" } ], '
  local key_2 = '"hlsl_2_mouse": [ { "key": "OBS_KEY_MOUSE2" } ]}'
  local json_s = key_1 .. key_2
  default_hotkeys = {
    {id="hlsl_1_mouse", des="LMB state", callback=function(p) return p and on_click_check(particles,width,height) end},
    {id="hlsl_2_mouse", des="RMB state", callback=function(p) end},
  }
  local settings = S.obs_data_create_from_json(json_s)
  for _,k in pairs(default_hotkeys) do
    local a = S.obs_data_get_array(settings, k.id)
    local h = S.obs_hotkey_register_frontend(k.id, k.des, k.callback)
    S.obs_hotkey_load(h, a)
    S.obs_data_array_release(a)
  end
  S.obs_data_release(settings)
  _G.MOUSE_HOOKED = true
end

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

  instance.max_particles = 7

  S.obs_enter_graphics()
  instance.effect = S.gs_effect_create(SHADER, nil, nil)
  if instance.effect ~= nil then
    instance.params = {}
    instance.params.width = S.gs_effect_get_param_by_name(instance.effect, 'width')
    instance.params.itime = S.gs_effect_get_param_by_name(instance.effect, 'itime')
    instance.params.height = S.gs_effect_get_param_by_name(instance.effect, 'height')
    instance.params.mouse = S.gs_effect_get_param_by_name(instance.effect, 'mouse')
    instance.mouse_vec3 = S.vec3()
    local all_particles = {}
    for i=1,instance.max_particles do 
      instance.params['particle'.. i] = S.gs_effect_get_param_by_name(instance.effect, 'particle' .. i)
      instance['particle'.. i .. '_vec4'] = S.vec4()
      table.insert(all_particles,{x=0.0,y=0.0,z=0.0,dx=0.0,dy=0.0,age=0.0})
    end
    instance.all_particles = all_particles
  end
  S.obs_leave_graphics()
  if instance.effect == nil then
    SourceDef.destroy(instance)
    return nil
  end
  --SourceDef.update(instance,self) -- initialize, self = settings
  return instance
end

function SourceDef:destroy()
  if self.effect ~= nil then
    S.obs_enter_graphics()
    S.gs_effect_destroy(self.effect)
    S.obs_leave_graphics()
  end
end

function SourceDef:get_name() return "Cursor highlight click visualisation by upgradeQ" end
function SourceDef:get_width() return self.width end
function SourceDef:get_height() return self.height end

local function norm(val,amin,amax) return (val-amin ) / (amax- amin) end

local function get_cur_norm(w,h)
  C.GetCursorPos(mouse_pos)
  local norm_x = norm(mouse_pos.x,0,w)
  norm_x = norm_x * (w/h) -- aspect ratio
  local norm_y = norm(mouse_pos.y,0,h)
  return norm_x,norm_y
end

function on_click_check(particles,width,height) 
  for _,v in ipairs(particles) do 
    if v.age < 0 then
      v.age = 36
      v.x,v.y = get_cur_norm(width,height)
      v.dx,v.dy = 0.0000,0.0000
      v.z = math.random()
      return
    end
  end
end


function SourceDef:Emitter()
  -- on render call 
  for i=1,self.max_particles do 
    self.all_particles[i].age = self.all_particles[i].age - 1
    if (self.all_particles[i].age < 0.0) then 
      self.all_particles[i].x,self.all_particles[i].y = -3, -3 
    end -- removes flickering
    --if i == 2 then
      --print(tostring(self.all_particles[i].x))
      --print(tostring(self.all_particles[i].age) .. 'log' .. 'i' .. tostring(i))
      --print(tostring(self.tick_tock)) -- 0.016
    --end
    self.all_particles[i].x = self.all_particles[i].x - self.all_particles[i].dx
    self.all_particles[i].y = self.all_particles[i].y + self.all_particles[i].dy

    self['particle' .. i .. '_vec4'].x = self.all_particles[i].x
    self['particle' .. i .. '_vec4'].y = self.all_particles[i].y
    self['particle' .. i .. '_vec4'].z = self.all_particles[i].z
    self['particle' .. i .. '_vec4'].w = self.all_particles[i].age 
  end

end

function SourceDef:video_tick(seconds)
  self.current_time = self.current_time + seconds
  self.tick_tock = seconds
  skip_tick_render(self) -- if source has crop or transform applied to it, this will let it render
  SourceDef.Emitter(self)
end

function SourceDef:video_render()
  local parent = S.obs_filter_get_parent(self.source)
  self.width = S.obs_source_get_base_width(parent)
  self.height = S.obs_source_get_base_height(parent)
  if not _G.MOUSE_HOOKED  then
    hook_mouse_buttons(self.all_particles,self.width,self.height)
  end
  if not S.obs_source_process_filter_begin(self.source, S.GS_RGBA, S.OBS_ALLOW_DIRECT_RENDERING) then return end
  S.gs_effect_set_float(self.params.itime, self.current_time+0.0)
  self.mouse_vec3.x,self.mouse_vec3.y = get_cur_norm(self.width,self.height)
  self.mouse_vec3.z = _G.HIGHLIGHT
  S.gs_effect_set_vec3(self.params.mouse,self.mouse_vec3)
  S.gs_effect_set_int(self.params.width, self.width)
  S.gs_effect_set_int(self.params.height, self.height)
  for i=1,self.max_particles do 
    S.gs_effect_set_vec4(self.params['particle' .. i],self['particle' .. i .. '_vec4'])
  end
  S.obs_source_process_filter_tech_end(self.source, self.effect, self.width, self.height,"Draw")
end

_G.HIGHLIGHT1 = 0
_G.HIGHLIGHT = 0 

function flip()
  _G.HIGHLIGHT1 = 1 - _G.HIGHLIGHT1
  return _G.HIGHLIGHT1
end

function script_properties()
  local props = S.obs_properties_create()
  S.obs_properties_add_button(props, "button2", "Cursor highlight click visualisation by upgradeQ",
  function() end)
  S.obs_properties_add_button(props, "button3", "Show/Hide",
  function() _G.HIGHLIGHT = flip() end)
  return props
end

function script_load(settings)
  local my_filter = SourceDef:new({id='filter_cursor_shader_click',type=S.OBS_SOURCE_TYPE_FILTER,
    output_flags=_OR(S.OBS_SOURCE_VIDEO,S.OBS_SOURCE_CUSTOM_DRAW)})
  S.obs_register_source(my_filter)
end

function read_from(file)
    local f = assert(io.open(file, "rb"))
    local content = f:read("*all")
    f:close()
    return content
end

SHADER = read_from(script_path() .. "my_shader_click_working_ring.hlsl")
