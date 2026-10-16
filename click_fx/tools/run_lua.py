"""
Runs a Lua file with the LuaJIT that ships with OBS (lua51.dll), so scripts can
be exercised outside OBS with the same interpreter and FFI.

Usage (64-bit Python, e.g. the one bundled with Blender):
    python tools/run_lua.py tools/test_script.lua
"""

import ctypes
import os
import sys

DEFAULT_DLL = r"C:\Program Files\obs-studio\bin\64bit\lua51.dll"
LUA_GLOBALSINDEX = -10002


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    script = os.path.abspath(sys.argv[1])
    lua = ctypes.CDLL(os.environ.get("OBS_LUA_DLL", DEFAULT_DLL))
    lua.luaL_newstate.restype = ctypes.c_void_p
    lua.luaL_openlibs.argtypes = [ctypes.c_void_p]
    lua.luaL_loadfile.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    lua.lua_pcall.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int]
    lua.lua_tolstring.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
    lua.lua_tolstring.restype = ctypes.c_char_p
    lua.lua_close.argtypes = [ctypes.c_void_p]

    L = lua.luaL_newstate()
    lua.luaL_openlibs(L)
    rc = lua.luaL_loadfile(L, script.encode("mbcs"))
    if rc == 0:
        rc = lua.lua_pcall(L, 0, 0, 0)
    if rc != 0:
        msg = lua.lua_tolstring(L, -1, None)
        print("LUA ERROR:", msg.decode("utf-8", "replace") if msg else rc)
    sys.stdout.flush()
    lua.lua_close(L)
    return 1 if rc else 0


if __name__ == "__main__":
    sys.exit(main())
