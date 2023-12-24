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
  instance.loop_time = 0
  instance.source = source
  instance.emit_time = 0.33
  instance.afk = true
  instance.prev_location = {x=999,y=999}

  instance.spawn_rate = 0.01
  instance.afk_time = 5.85 + 0.2
  instance.min_age = 1.3
  instance.max_age = 1.85
  instance.max_particles = 77

  S.obs_enter_graphics()
  instance.effect = S.gs_effect_create(SHADER, nil, nil)
  if instance.effect ~= nil then
    instance.params = {}
    instance.params.width = S.gs_effect_get_param_by_name(instance.effect, 'width')
    instance.params.itime = S.gs_effect_get_param_by_name(instance.effect, 'itime')
    instance.params.height = S.gs_effect_get_param_by_name(instance.effect, 'height')
    instance.params.mouse_x = S.gs_effect_get_param_by_name(instance.effect, 'mouse_x')
    instance.params.mouse_y = S.gs_effect_get_param_by_name(instance.effect, 'mouse_y')
    instance.params.afk = S.gs_effect_get_param_by_name(instance.effect, 'afk')
    local all_particles = {}
    for i=1,instance.max_particles do 
      instance.params['particle'.. i] = S.gs_effect_get_param_by_name(instance.effect, 'particle' .. i)
      instance['particle'.. i .. '_vec4'] = S.vec4()
      table.insert(all_particles,{x=0.0,y=0.0,dx=0.0,dy=0.0,age=0.0})
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

function SourceDef:get_name() return "Cursor shader trail XMAS edition by upgradeQ" end


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

function SourceDef:Emitter(norm_x,norm_y)
  -- on render call 
  if not ((self.prev_location.x == norm_x) and ( self.prev_location.y == norm_y)) then
    self.prev_location.x, self.prev_location.y = norm_x, norm_y
    self.loop_time = 0 -- afk detector
    self.afk = false
  else
    self.loop_time = self.loop_time + self.tick_tock
  end
  self.emit_time = self.emit_time - self.tick_tock
  if self.loop_time > self.afk_time + 0.1 then
    self.afk = true
    return end
  for i=1,self.max_particles do 
    self.all_particles[i].age = self.all_particles[i].age - self.tick_tock  
    if (self.emit_time <= 0) and (self.all_particles[i].age <= 0.0) then
      local angle = 2 * math.pi * math.random()
      -- 0.013 radius, math.random() position on circle radius
      self.all_particles[i].x = 0.013*math.random()*math.cos(angle) + norm_x
      self.all_particles[i].y = 0.013*math.random()*math.sin(angle) + norm_y
      self.all_particles[i].dx, self.all_particles[i].dy =0.0002,0.0008
      --self.all_particles[i].age = 1.3 -- full trail 
      self.all_particles[i].age = math.random(self.min_age,self.max_age)
      self['particle' .. i .. '_vec4'].z = math.random(0.7,1) -- size variation
      if (self.loop_time > 0.02) then
        self.emit_time = self.spawn_rate + math.min(0.2,self.loop_time)
        return
      end
      self.emit_time = self.spawn_rate -- required so all particles do not spawn as one
    end

    if self.loop_time > self.afk_time then -- hide after 5 seconds
      self.all_particles[i].x,self.all_particles[i].y = -3,-3
    end
    if (self.all_particles[i].age < 0.1) then 
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
    self['particle' .. i .. '_vec4'].w = self.all_particles[i].age 
  end
end

function SourceDef:video_tick(seconds)
  self.current_time = self.current_time + seconds
  self.tick_tock = seconds
  skip_tick_render(self) -- if source has crop or transform applied to it, this will let it render
  if ffi.os == "Windows" then
    C.GetCursorPos(mouse_pos)
  else
    mouse_pos.x,mouse_pos.y = get_x11_mpos()
  end
  local norm_x,norm_y = get_cur_norm(self.width,self.height)
  SourceDef.Emitter(self,norm_x,norm_y)
end

function SourceDef:video_render()
  local parent = S.obs_filter_get_parent(self.source)
  self.width = S.obs_source_get_base_width(parent)
  self.height = S.obs_source_get_base_height(parent)
  if not S.obs_source_process_filter_begin(self.source, S.GS_RGBA, S.OBS_ALLOW_DIRECT_RENDERING) then return end
  S.gs_effect_set_float(self.params.itime, self.current_time+0.0)
  S.gs_effect_set_bool(self.params.afk, self.afk)
  S.gs_effect_set_int(self.params.width, self.width)
  S.gs_effect_set_int(self.params.height, self.height)
  for i=1,self.max_particles do 
    S.gs_effect_set_vec4(self.params['particle' .. i],self['particle' .. i .. '_vec4'])
  end
  S.obs_source_process_filter_tech_end(self.source, self.effect, self.width, self.height,"Draw")
end

function script_properties()
  local props = S.obs_properties_create()
  S.obs_properties_add_button(props, "button2", "Cursor shader trail XMAS edition by upgradeQ",
  function() end)
  return props
end

function script_load(settings)
  local my_filter = SourceDef:new({id='filter_cursor_shader_xmas',type=S.OBS_SOURCE_TYPE_FILTER,
    output_flags=_OR(S.OBS_SOURCE_VIDEO,S.OBS_SOURCE_CUSTOM_DRAW)})
  S.obs_register_source(my_filter)
end

function read_from(file)
    local f = assert(io.open(file, "rb"))
    local content = f:read("*all")
    f:close()
    return content
end

SHADER = read_from(script_path() .. "my_shader_particles.hlsl")
