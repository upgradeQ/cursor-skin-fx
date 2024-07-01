local ffi = require("ffi")

local tonumber, setmetatable = tonumber, setmetatable
local C, fnew, cast = ffi.C, ffi.new, ffi.cast

S = obslua
obs = S

local common_lua_h =

[=[
static const int WAIT_ABANDONED_TH = 0x00000080;
static const int WAIT_OBJECT_0_TH = 0x00000000;
static const int WAIT_TIMEOUT_TH = 0x00000102;
static const int INFINITE_TH = 0xFFFFFFFF;
static const int GENERIC_READ  = 0x80000000;
static const int OPEN_EXISTING = 0x00000003;
static const int ERROR_IO_PENDING = 997;
static const int PIPE_ACCESS_DUPLEX = 0x00000003;
static const int PIPE_TYPE_MESSAGE = 0x00000004;
static const int FORMAT_MESSAGE_FROM_SYSTEM = 0x00001000;
static const int FORMAT_MESSAGE_IGNORE_INSERTS = 0x00000200;

typedef int BOOL;
typedef char* LPSTR;
typedef void* LPVOID;
typedef uint32_t DWORD;
typedef void* HANDLE;
typedef int32_t INT;
typedef uint32_t UINT;
typedef int64_t LARGE_INTEGER;
typedef uint32_t ULONG;
typedef uint32_t ULONG_PTR;
typedef long LONG;
typedef DWORD* PDWORD;
typedef uint16_t WORD;
typedef void* LPBYTE;
typedef int NTSTATUS;
typedef wchar_t WCHAR;
typedef const wchar_t* LPCWSTR;
typedef wchar_t WCHAR;
typedef WCHAR* LPWSTR;
typedef const char* LPCSTR;
typedef int *LPDWORD;
typedef BOOL *LPBOOL;
typedef void *PVOID;
typedef struct { ULONG_PTR Internal;
  ULONG_PTR InternalHigh;
  union {
    struct {
      DWORD Offset;
      DWORD OffsetHigh;
    };
    PVOID  Pointer;
  };
  HANDLE    hEvent;
} OVERLAPPED;

int CloseHandle(void*);
int GetExitCodeThread(void*, unsigned long*);
unsigned long WaitForSingleObject(void*, unsigned long);
BOOL ConnectNamedPipe(HANDLE hNamedPipe, LPVOID lpOverlapped);
void Sleep(int ms);

typedef struct lua_State lua_State;
lua_State *luaL_newstate(void);
void luaL_openlibs(lua_State *L);
void lua_close(lua_State *L);
int luaL_loadfile(lua_State *L, const char *filename);
int luaL_loadstring (lua_State *L, const char *s);
int lua_pcall(lua_State *L, int nargs, int nresults, int errfunc);
ptrdiff_t lua_tointeger(lua_State *L, int index);
void lua_settop(lua_State *L, int index);
typedef unsigned long (__stdcall *ThreadProc)(void*);
void* CreateThread(
  void* lpThreadAttributes,
  size_t dwStackSize,
  ThreadProc lpStartAddress,
  void* lpParameter,
  unsigned long dwCreationFlags,
  unsigned long* lpThreadId
);
unsigned long GetLastError();
unsigned long FormatMessageA(
  unsigned long dwFlags,
  const void* lpSource,
  unsigned long dwMessageId,
  unsigned long dwLanguageId,
  char* lpBuffer,
  unsigned long nSize,
  va_list *Arguments
);

void Beep(int freq, int dur);

HANDLE CreateNamedPipeA(
    LPSTR lpName,
    DWORD dwOpenMode,
    DWORD dwPipeMode,
    DWORD nMaxInstances,
    DWORD nOutBufferSize,
    DWORD nInBufferSize,
    DWORD nDefaultTimeOut,
    LPVOID lpSecurityAttributes
);

typedef struct _SECURITY_ATTRIBUTES {
  DWORD  nLength;
  LPVOID lpSecurityDescriptor;
  BOOL   bInheritHandle;
} SECURITY_ATTRIBUTES, *PSECURITY_ATTRIBUTES, *LPSECURITY_ATTRIBUTES;

HANDLE CreateFileA(
  LPCSTR                lpFileName,
  DWORD                 dwDesiredAccess,
  DWORD                 dwShareMode,
  LPSECURITY_ATTRIBUTES lpSecurityAttributes,
  DWORD                 dwCreationDisposition,
  DWORD                 dwFlagsAndAttributes,
  HANDLE                hTemplateFile
);

int WriteFile(HANDLE hFile, const char *lpBuffer, int nNumberOfBytesToWrite, int *lpNumberOfBytesWritten, OVERLAPPED* lpOverlapped);
int ReadFile(HANDLE hFile, PVOID lpBuffer, DWORD nNumberOfBytesToRead, LPDWORD lpNumberOfBytesRead, OVERLAPPED* lpOverlapped);

int FlushFileBuffers(HANDLE hFile);
HANDLE CreateEventA(void*, int, int, const char*);
DWORD  FormatMessageW(DWORD dwFlags, void* lpSource, DWORD dwMessageId, DWORD dwLanguageId, LPVOID lpBuffer, DWORD nSize, void *Arguments);
BOOL SetConsoleOutputCP(UINT wCodePageID);

  int WideCharToMultiByte(
    UINT CodePage,
    DWORD dwFlags,
    LPCWSTR lpWideCharStr,
    int cchWideChar,
    LPSTR lpMultiByteStr,
    int cbMultiByte,
    LPCSTR lpDefaultChar,
    LPBOOL lpUsedDefaultChar
  );

bool SetNamedPipeHandleState(void *hNamedPipe, unsigned long *lpMode, unsigned long *lpMaxCollectionCount, unsigned long *lpCollectDataTimeout);
int DisconnectNamedPipe(HANDLE);
typedef struct {int x, y;} Point;
bool GetCursorPos(Point *lpPoint);
]=]

ffi.cdef(common_lua_h)

local function error_win(lvl)
  local errcode = C.GetLastError()
  local str = fnew("wchar_t[?]", 1024)
  local numout = C.FormatMessageW(bit.bor(C.FORMAT_MESSAGE_FROM_SYSTEM,
    C.FORMAT_MESSAGE_IGNORE_INSERTS), nil, errcode, 0, str, 1024, nil)
  if numout == 0 then
    error("Windows Error: (Error calling FormatMessage)", lvl)
  else
    local utf8_str = fnew("char[?]", numout * 4)
    local bytes_written = C.WideCharToMultiByte(65001, 0, str, numout, utf8_str, numout * 4, nil, nil)
    error("Windows Error: "..ffi.string(utf8_str, bytes_written), lvl)
  end
end

local function error_check(result)
  if result == 0 then
    error_win(4)
  end
end

local function thread_join(thr)
  if thr.thread == nil then error("invalid thread", 3) end
  local timeout_ms = 0.01
  if timeout_ms then
    timeout_ms = timeout_ms*1000
  else
    timeout_ms = C.INFINITE_TH
  end
  local r = C.WaitForSingleObject(thr.thread, timeout_ms)
  if r == C.WAIT_OBJECT_0_TH or r == C.WAIT_ABANDONED_TH then
    local result = fnew"unsigned long[1]"
    local ret = C.GetExitCodeThread(thr.thread, result)
    if ret==0 then error_win(2) end
    return true, result[0]
  elseif r == C.WAIT_TIMEOUT_TH then
    return false
  else
    error_win(2)
  end
  error_check(C.CloseHandle(thr.thread))
end

local thread_mt = {
  __index = {
    join = thread_join,
  }
}

-- https://www.freelists.org/post/luajit/A-new-lua-state-in-a-new-thread-from-luajit,3
local function thread_new(g_lua_string)
  local err = "failed to create child state"
  local L = C.luaL_newstate()
  if L ~= nil then
    local thr = setmetatable({ L = L }, thread_mt)
    C.luaL_openlibs(L)
    if C.luaL_loadstring(L, g_lua_string) == 0 then
      -- Pass any arguments to the chunk here.
      local nargs = 0
      if C.lua_pcall(L, nargs, 1, 0) == 0 then
        local start = cast("ThreadProc", C.lua_tointeger(L, -1))
        local arg_c = cast("LPVOID", 0)
        local flags = 0
        C.lua_settop(L, 0)
        thr.tid = fnew("DWORD[1]")
        thr.thread = C.CreateThread(nil, 0, start, arg_c, flags, thr.tid)
        if  thr.thread then
          return thr
        else
          err = "failed to create child thread"
        end
      else
        err = "failed to run child main"
      end
    else
      err = "failed to load child file"
    end
    C.lua_close(L)
  end
  return false, err
end

local g_lua_string = [===[

local ffi = require("ffi")
local tonumber, setmetatable = tonumber, setmetatable
local C, fnew, cast = ffi.C, ffi.new, ffi.cast

ffi.cdef(]===] .."[[" .. common_lua_h .. "]]" ..[===[)

local function thread_main(child_main)
  return tonumber(cast("intptr_t", cast("void *(*)(void *)", child_main)))
end

local thread = {
  main = thread_main,
}

local u_name = "mouse_values_high_freq"
local p_name = string.format("\\\\.\\pipe\\%s", ffi.string(u_name))

local function create_named_pipe(pipeName)
  local hPipe = C.CreateNamedPipeA(cast("LPSTR", pipeName),
    C.PIPE_ACCESS_DUPLEX,
    C.PIPE_TYPE_MESSAGE,
    1,
    1024, 1024,
    0, nil)
  if hPipe == cast("HANDLE", cast("uintptr_t", -1)) then
    return nil
  end
  return hPipe
end

local function connectNamedPipe(hPipe)
  local overlapped = fnew("OVERLAPPED")
  overlapped.hEvent = C.CreateEventA(nil, true, false, nil)
  if not C.ConnectNamedPipe(hPipe, nil) then
    local error = C.GetLastError()
    if error ~= C.ERROR_IO_PENDING then
      C.CloseHandle(overlapped.hEvent)
      return false
    end
  end
  C.WaitForSingleObject(overlapped.hEvent, 200)
  C.CloseHandle(overlapped.hEvent)
  return true
end

local mouse_pos = fnew("Point")
local mouse_coords = ''
local total = 16.00 - 0.03
local points = 6
local step = total/points

local function calc_mouse()
  for i=1, points do
    C.GetCursorPos(mouse_pos)
    mouse_coords = mouse_coords .. mouse_pos.x .. '.' .. mouse_pos.y .. ';'
    C.Sleep(step)
  end
end

local function main()
  local hPipe = ffi.gc(create_named_pipe(p_name), C.CloseHandle)
  local response = ""
  local buflen = fnew("unsigned long[1]", 1)
  local n = 1
  if hPipe then
    if connectNamedPipe(hPipe) then
      --C.Beep(1000, 300)
      while true do
        calc_mouse()
        C.WriteFile(hPipe, response .. mouse_coords, string.len(response .. mouse_coords), buflen, nil)
        mouse_coords = ''
        C.FlushFileBuffers(hPipe)
      end
    end
  end
end

return thread.main(main)
]===]

local thr = assert(thread_new(g_lua_string))
local init = false
local hPipe;

function init1()
  local u_name = "mouse_values_high_freq"
  local p_name = string.format("\\\\.\\pipe\\%s", ffi.string(u_name))
  hPipe = C.CreateFileA(p_name, C.GENERIC_READ, 0, nil, C.OPEN_EXISTING, 0, nil)
  --error_win(4)
  if hPipe == cast("HANDLE", cast("uintptr_t", -1)) then
    print("[-] Failed to create named pipe")
    error_win(4)
  else
    print(tostring(hPipe))
  end
  init = true
end

local buffer = fnew("char[4096]")
local bytes_read = fnew("unsigned long[1]")
local data = ''

function read_from_pipe_sync()
  if not init then init1() end
  local success = C.ReadFile(hPipe, buffer, 4096, bytes_read, nil)
  data = ffi.string(buffer, bytes_read[0])
  --print('[+]' .. data .. '[+]')
end

function script_unload()
  thr:join()
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

  instance.effect = S.gs_effect_create(EFFECT, "mb_cursor", nil)
  x1, x2, x3, x4, x5, x6 = 0, 0, 0, 0, 0, 0
  y1, y2, y3, y4, y5, y6 = 0, 0, 0, 0, 0, 0
  p1, p2, p3, p4, p5, p6 = S.vec2(), S.vec2(),  S.vec2(),  S.vec2(),  S.vec2(),  S.vec2()
  if instance.effect ~= nil then
    instance.params.width = S.gs_effect_get_param_by_name(instance.effect, 'width')
    instance.params.itime = S.gs_effect_get_param_by_name(instance.effect, 'itime')
    instance.params.height = S.gs_effect_get_param_by_name(instance.effect, 'height')
    instance.params.particle1 = S.gs_effect_get_param_by_name(instance.effect, 'particle1')
    instance.params.particle2 = S.gs_effect_get_param_by_name(instance.effect, 'particle2')
    instance.params.particle3 = S.gs_effect_get_param_by_name(instance.effect, 'particle3')
    instance.params.particle4 = S.gs_effect_get_param_by_name(instance.effect, 'particle4')
    instance.params.particle5 = S.gs_effect_get_param_by_name(instance.effect, 'particle5')
    instance.params.particle6 = S.gs_effect_get_param_by_name(instance.effect, 'particle6')
  end

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
    S.obs_leave_graphics()
  end
end

function parse_string(input_data)
  local coords_pairs = {}
  for coord in string.gmatch(input_data, "%d+%.%d+") do
    table.insert(coords_pairs, coord)
  end
  x1, y1 = coords_pairs[1]:match("(%d+).(%d+)")
  x2, y2 = coords_pairs[2]:match("(%d+).(%d+)")
  x3, y3 = coords_pairs[3]:match("(%d+).(%d+)")
  x4, y4 = coords_pairs[4]:match("(%d+).(%d+)")
  x5, y5 = coords_pairs[5]:match("(%d+).(%d+)")
  x6, y6 = coords_pairs[6]:match("(%d+).(%d+)")
end

function set_params(ctx)
  p1.x, p1.y = x1, y1
  p2.x, p2.y = x2, y2
  p3.x, p3.y = x3, y3
  p4.x, p4.y = x4, y4
  p5.x, p5.y = x5, y5
  p6.x, p6.y = x6, y6
  S.gs_effect_set_vec2(ctx.params.particle1, p1)
  S.gs_effect_set_vec2(ctx.params.particle2, p2)
  S.gs_effect_set_vec2(ctx.params.particle3, p3)
  S.gs_effect_set_vec2(ctx.params.particle4, p4)
  S.gs_effect_set_vec2(ctx.params.particle5, p5)
  S.gs_effect_set_vec2(ctx.params.particle6, p6)
  S.gs_effect_set_float(ctx.params.width, ctx.width)
  S.gs_effect_set_float(ctx.params.height, ctx.height)
end

function SourceDef:video_tick(seconds)
  if (seconds > 0.013) then 
    read_from_pipe_sync()
    parse_string(data)
  end
  self.current_time = self.current_time + seconds
end

function SourceDef:video_render()
  set_params(self)
  while S.gs_effect_loop(self.effect, "Draw") do
    S.gs_draw_sprite(nil, 0, self.width, self.height)
  end
end

function SourceDef:get_name() return "Single pass threaded reverse motion blur" end
function SourceDef:get_width() return self.width end
function SourceDef:get_height() return self.height end


function SourceDef:get_properties()
  local props = S.obs_properties_create()
  S.obs_properties_add_int(props, "_w", "width", 1, 2560, 1)
  S.obs_properties_add_int(props, "_h", "height", 1, 1440, 1)
  S.obs_properties_add_button(props, "button", "Single pass threaded reverse motion blur", function() end)
  return props
end

function SourceDef:update(settings)
  self.width = S.obs_data_get_double(settings, "_w")
  self.height = S.obs_data_get_double(settings, "_h")
end

function SourceDef:get_defaults()
  S.obs_data_set_default_double(self, "_w", 1920)
  S.obs_data_set_default_double(self, "_h", 1080)
end

function script_load(settings)
  local my_source = SourceDef:new({id='cursor_shader_mb', type=S.OBS_SOURCE_TYPE_SOURCE,
    output_flags=bit.bor(S.OBS_SOURCE_VIDEO, S.OBS_SOURCE_CUSTOM_DRAW)})
  S.obs_register_source(my_source)
end

EFFECT = ([[
// OBS-specific syntax adaptation to HLSL standard to avoid errors reported by the code editor
#define SamplerState sampler_state
#define Texture2D texture2d
uniform float4x4 ViewProj;
uniform Texture2D image;
// Size of the source picture
uniform float width;
uniform float height;
uniform float itime;

uniform float2 particle1;
uniform float2 particle2;
uniform float2 particle3;
uniform float2 particle4;
uniform float2 particle5;
uniform float2 particle6;

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
float sdCircle(float2 p, float r) { return length(p) - r; }

float4 set_cursor(float2 p, float2 uv) {
  uv.x *= width/height;
  p.x *= width/height;
  p = float2(p.x/width, p.y/height);
  float d = sdCircle(p-uv, 0.007);
  d = 1-smoothstep(0, 0.007, d);
  return float4(1.0, 1.0, 0.0, d);

}

float4 PassThrough(VertDataOut v_in) : TARGET
{
   float2 uv = v_in.uv;
   float4 basic = float4(0.0, 0.0, 0.0, 0.0);
   basic  = set_cursor(particle1, uv) /2;
   basic += set_cursor(particle2, uv) /2;
   basic += set_cursor(particle3, uv) /2;
   basic += set_cursor(particle4, uv) /2;
   basic += set_cursor(particle5, uv) /2;
   basic += set_cursor(particle6, uv) /2;
   return basic/2;
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
