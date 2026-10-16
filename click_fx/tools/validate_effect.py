"""
Compiles every technique of a libobs .effect file the way OBS does on Windows:
the effect dialect is rewritten to plain HLSL (as libobs' D3D11 shader processor
does) and each pass is compiled with D3DCompile from d3dcompiler_47.dll
(vs_4_0 / ps_4_0, optimisation level 3).

Prints warnings, errors and the instruction count of every pixel shader.
Exit code 1 if anything fails to compile.

Usage (any Python 3 on Windows, e.g. the one bundled with Blender):
    python tools/validate_effect.py [path/to/file.effect]
"""

import ctypes
import os
import re
import sys
from ctypes import POINTER, byref, c_char_p, c_size_t, c_uint, c_void_p

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = os.path.join(HERE, "..", "premium_click_fx", "click_fx.effect")

D3DCOMPILE_OPTIMIZATION_LEVEL3 = 1 << 15

_d3d = ctypes.WinDLL("d3dcompiler_47.dll")
_compile = _d3d.D3DCompile
_compile.argtypes = [c_void_p, c_size_t, c_char_p, c_void_p, c_void_p, c_char_p, c_char_p,
                     c_uint, c_uint, POINTER(c_void_p), POINTER(c_void_p)]
_compile.restype = ctypes.c_long
_disasm = _d3d.D3DDisassemble
_disasm.argtypes = [c_void_p, c_size_t, c_uint, c_char_p, POINTER(c_void_p)]
_disasm.restype = ctypes.c_long


def _blob(ptr, release=True):
    """Returns the bytes of an ID3DBlob and releases it."""
    if not ptr:
        return b""
    vtbl = ctypes.cast(ctypes.cast(ptr, POINTER(c_void_p))[0], POINTER(c_void_p))
    get_ptr = ctypes.WINFUNCTYPE(c_void_p, c_void_p)(vtbl[3])
    get_size = ctypes.WINFUNCTYPE(c_size_t, c_void_p)(vtbl[4])
    data = ctypes.string_at(get_ptr(ptr), get_size(ptr))
    if release:
        ctypes.WINFUNCTYPE(ctypes.c_ulong, c_void_p)(vtbl[2])(ptr)
    return data


def compile_hlsl(src, target, name):
    code, errors = c_void_p(), c_void_p()
    data = src.encode("utf-8")
    hr = _compile(data, len(data), name.encode(), None, None, b"main", target.encode(),
                  D3DCOMPILE_OPTIMIZATION_LEVEL3, 0, byref(code), byref(errors))
    messages = _blob(errors.value).decode("utf-8", "replace").strip()
    slots = None
    if hr >= 0 and code.value:
        vtbl = ctypes.cast(ctypes.cast(code.value, POINTER(c_void_p))[0], POINTER(c_void_p))
        get_ptr = ctypes.WINFUNCTYPE(c_void_p, c_void_p)(vtbl[3])
        get_size = ctypes.WINFUNCTYPE(c_size_t, c_void_p)(vtbl[4])
        text = c_void_p()
        if _disasm(get_ptr(code.value), get_size(code.value), 0, None, byref(text)) >= 0:
            asm = _blob(text.value).decode("utf-8", "replace")
            m = re.search(r"Approximately (\d+) instruction slots used", asm)
            slots = int(m.group(1)) if m else None
        _blob(code.value)
    return hr >= 0, messages, slots


def to_hlsl(effect):
    """Rewrites the libobs effect dialect into plain HLSL; returns (hlsl, techniques)."""
    techniques = []
    for m in re.finditer(r"technique\s+(\w+)\s*\{\s*pass\s*\{(.*?)\}\s*\}", effect, re.S):
        vs = re.search(r"vertex_shader\s*=\s*(\w+)\s*\(", m.group(2)).group(1)
        ps = re.search(r"pixel_shader\s*=\s*(\w+)\s*\(", m.group(2)).group(1)
        techniques.append((m.group(1), vs, ps))
    src = re.sub(r"technique\s+\w+\s*\{\s*pass\s*\{.*?\}\s*\}", "", effect, flags=re.S)
    src = re.sub(r"sampler_state\s+(\w+)\s*\{[^}]*\}\s*;", r"SamplerState \1;", src)
    src = re.sub(r"\btexture2d\b", "Texture2D", src)
    src = re.sub(r":\s*TARGET\b", ": SV_Target", src)
    src = re.sub(r":\s*POSITION\b", ": SV_Position", src)
    return src, techniques


def main():
    path = os.path.normpath(sys.argv[1] if len(sys.argv) > 1 else DEFAULT)
    with open(path, encoding="utf-8") as f:
        hlsl, techniques = to_hlsl(f.read())
    if not techniques:
        print("no techniques found")
        return 1
    ok_all = True
    vs_done = set()
    for name, vs, ps in techniques:
        if vs not in vs_done:
            vs_done.add(vs)
            src = hlsl + f"\nVertData main(VertData v_in) {{ return {vs}(v_in); }}\n"
            ok, msg, _ = compile_hlsl(src, "vs_4_0", f"{name}.vs")
            ok_all &= ok
            print(f"[{'ok' if ok else 'FAIL'}] vertex {vs}")
            if msg:
                print("    " + msg.replace("\n", "\n    "))
        src = hlsl + f"\nfloat4 main(VertData v_in) : SV_Target {{ return {ps}(v_in); }}\n"
        ok, msg, slots = compile_hlsl(src, "ps_4_0", f"{name}.ps")
        ok_all &= ok
        print(f"[{'ok' if ok else 'FAIL'}] technique {name:<9} ({ps}) "
              + (f"~{slots} instruction slots" if slots else ""))
        if msg:
            print("    " + msg.replace("\n", "\n    "))
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
