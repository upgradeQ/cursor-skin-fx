"""
Renders the click effects through OBS's own libobs + D3D11 renderer, offscreen,
and writes contact sheets as PNG. This exercises exactly what OBS does at
runtime: the libobs effect parser, its D3D11 shader translation and compile,
texture loading with gs_texture_create_from_file, premultiplied blending.

Usage (64-bit Python with numpy, e.g. Blender's):
    python tools/obs_render_test.py [out_dir] [--only Ink,Fire,...]

Writes obs_sheet_dark.png / obs_sheet_light.png: one row per style, one column
per age, composited over a dark and a light backdrop.
"""

import ctypes
import os
import struct
import sys
import zlib
from ctypes import POINTER, byref, c_bool, c_char_p, c_float, c_int, c_uint32, c_void_p

import numpy as np

OBS_BIN = os.environ.get("OBS_BIN", r"C:\Program Files\obs-studio\bin\64bit")
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, "..", "premium_click_fx"))

GS_RGBA, GS_ZS_NONE, GS_CLEAR_COLOR = 3, 0, 1
GS_BLEND_ONE, GS_BLEND_INVSRCALPHA = 1, 5

# Mirror of STYLES in premium_click_fx.lua.
STYLES = [
    ("Ink", 1.25, 1.0, (-1.5, -1.5, 1.5, 1.5), (0xFF4136, 0xFFB3A7, 0x000000, 0x000000)),
    ("SciFi", 0.78, 1.0, (-1.8, -1.8, 1.8, 1.8), (0x1E8BFF, 0x6FF4FF, 0xE8FBFF, 0x000000)),
    ("Fire", 1.3, 0.95, (-1.6, -2.3, 1.6, 1.2), (0xFF7A1A, 0x7A0A00, 0x000000, 0x000000)),
    ("Pop", 0.85, 0.9, (-1.5, -1.5, 1.5, 1.65), (0xFF4F81, 0xFFC93C, 0x2EC4B6, 0x7B5CFF)),
    ("Liquid", 1.1, 0.85, (-1.4, -1.4, 1.4, 1.45), (0x8B5CF6, 0xF0ABFC, 0x1E1035, 0x000000)),
    ("Halftone", 0.7, 0.9, (-1.65, -1.65, 1.65, 1.65), (0xFFE14D, 0xFF3B30, 0x141414, 0xFF8A00)),
]
STYLE_INDEX = {s[0]: i for i, s in enumerate(STYLES)}   # fx_shape.w for the Hold technique
HOLD_EXT = (-0.8, -1.05, 0.8, 0.8)
FRACTIONS = (0.06, 0.18, 0.34, 0.55, 0.78)
CELL = 300
R_BASE = 1440 * 0.065


def write_png(path, rgb):
    h, w, _ = rgb.shape
    rgba = np.concatenate([rgb, np.full((h, w, 1), 255, np.uint8)], -1)
    raw = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def rgb(c):
    return ((c >> 16) & 255) / 255.0, ((c >> 8) & 255) / 255.0, (c & 255) / 255.0


def main():
    global STYLES
    args = sys.argv[1:]
    if "--only" in args:
        i = args.index("--only")
        keep = set(args[i + 1].split(","))
        STYLES = [s for s in STYLES if s[0] in keep]
        del args[i:i + 2]
    out_dir = args[0] if args else os.getcwd()
    os.add_dll_directory(OBS_BIN)
    obs = ctypes.CDLL(os.path.join(OBS_BIN, "obs.dll"))

    def fn(name, res, *args):
        f = getattr(obs, name)
        f.restype, f.argtypes = res, list(args)
        return f

    gs_create = fn("gs_create", c_int, POINTER(c_void_p), c_char_p, c_uint32)
    gs_enter_context = fn("gs_enter_context", None, c_void_p)
    gs_leave_context = fn("gs_leave_context", None)
    gs_destroy = fn("gs_destroy", None, c_void_p)
    gs_effect_create = fn("gs_effect_create", c_void_p, c_char_p, c_char_p, POINTER(c_char_p))
    gs_effect_get_param = fn("gs_effect_get_param_by_name", c_void_p, c_void_p, c_char_p)
    gs_effect_set_vec4 = fn("gs_effect_set_vec4", None, c_void_p, POINTER(c_float))
    gs_effect_set_texture = fn("gs_effect_set_texture", None, c_void_p, c_void_p)
    gs_effect_loop = fn("gs_effect_loop", c_bool, c_void_p, c_char_p)
    gs_texture_from_file = fn("gs_texture_create_from_file", c_void_p, c_char_p)
    gs_texture_destroy = fn("gs_texture_destroy", None, c_void_p)
    gs_texrender_create = fn("gs_texrender_create", c_void_p, c_int, c_int)
    gs_texrender_begin = fn("gs_texrender_begin", c_bool, c_void_p, c_uint32, c_uint32)
    gs_texrender_end = fn("gs_texrender_end", None, c_void_p)
    gs_texrender_get_texture = fn("gs_texrender_get_texture", c_void_p, c_void_p)
    gs_texrender_destroy = fn("gs_texrender_destroy", None, c_void_p)
    gs_ortho = fn("gs_ortho", None, c_float, c_float, c_float, c_float, c_float, c_float)
    gs_clear = fn("gs_clear", None, c_uint32, POINTER(c_float), c_float, c_uint32)
    gs_enable_blending = fn("gs_enable_blending", None, c_bool)
    gs_blend_function = fn("gs_blend_function", None, c_int, c_int)
    gs_blend_state_push = fn("gs_blend_state_push", None)
    gs_blend_state_pop = fn("gs_blend_state_pop", None)
    gs_matrix_push = fn("gs_matrix_push", None)
    gs_matrix_pop = fn("gs_matrix_pop", None)
    gs_matrix_identity = fn("gs_matrix_identity", None)
    gs_matrix_translate3f = fn("gs_matrix_translate3f", None, c_float, c_float, c_float)
    gs_draw_sprite = fn("gs_draw_sprite", None, c_void_p, c_uint32, c_uint32, c_uint32)
    gs_stagesurface_create = fn("gs_stagesurface_create", c_void_p, c_uint32, c_uint32, c_int)
    gs_stage_texture = fn("gs_stage_texture", None, c_void_p, c_void_p)
    gs_stagesurface_map = fn("gs_stagesurface_map", c_bool, c_void_p, POINTER(c_void_p), POINTER(c_uint32))
    gs_stagesurface_unmap = fn("gs_stagesurface_unmap", None, c_void_p)
    gs_stagesurface_destroy = fn("gs_stagesurface_destroy", None, c_void_p)

    graphics = c_void_p()
    rc = gs_create(byref(graphics), os.path.join(OBS_BIN, "libobs-d3d11.dll").encode("mbcs"), 0)
    if rc != 0:
        print("gs_create failed:", rc)
        return 1
    gs_enter_context(graphics)
    failed = False
    try:
        path = os.path.join(ASSETS, "click_fx.effect")
        with open(path, "rb") as f:
            text = f.read()
        err = c_char_p()
        effect = gs_effect_create(text, path.encode("mbcs"), byref(err))
        if not effect:
            print("libobs failed to build the effect:\n", (err.value or b"(no message)").decode("utf-8", "replace"))
            return 1
        print("libobs parsed and compiled click_fx.effect")
        params = {n: gs_effect_get_param(effect, n.encode()) for n in (
            "fx_quad", "fx_anim", "fx_shape", "fx_clip", "fx_col_a", "fx_col_b", "fx_col_c", "fx_col_d",
            "noise_tex", "brush_tex", "ramp_tex", "hud_tex", "matcap_tex")}
        missing = [n for n, p in params.items() if not p]
        if missing:
            print("missing params:", missing)
            failed = True
        textures = {}
        for name, file in (("noise_tex", "noise.png"), ("brush_tex", "brush.png"), ("ramp_tex", "ramps.png"),
                           ("hud_tex", "hud.png"), ("matcap_tex", "matcap.png")):
            tex = gs_texture_from_file(os.path.join(ASSETS, "textures", file).encode("mbcs"))
            if not tex:
                print("texture failed to load:", file)
                failed = True
            textures[name] = tex

        cols = len(FRACTIONS) + 1
        W, H = CELL * cols, CELL * len(STYLES)
        tr = gs_texrender_create(GS_RGBA, GS_ZS_NONE)
        vec = (c_float * 4)()

        def set4(name, a, b, c, d):
            vec[0], vec[1], vec[2], vec[3] = a, b, c, d
            gs_effect_set_vec4(params[name], vec)

        def draw(tech, idx, cx, cy, ext, R, age, dur, colors, opacity=1.0):
            x0, y0 = ext[0] * R, ext[1] * R
            w, h = int(np.ceil((ext[2] - ext[0]) * R)), int(np.ceil((ext[3] - ext[1]) * R))
            for name, tex in textures.items():
                gs_effect_set_texture(params[name], tex)
            set4("fx_quad", x0, y0, w, h)
            set4("fx_anim", age, dur, 0.37, 0.0)
            set4("fx_shape", R, opacity, 0.0, float(idx))
            set4("fx_clip", cx % CELL, cy % CELL, CELL, CELL)
            for slot, c in zip(("fx_col_a", "fx_col_b", "fx_col_c", "fx_col_d"), colors):
                set4(slot, *rgb(c), 0.0)
            gs_matrix_push()
            gs_matrix_translate3f(cx + x0, cy + y0, 0.0)
            while gs_effect_loop(effect, tech.encode()):
                gs_draw_sprite(None, 0, w, h)
            gs_matrix_pop()

        if not gs_texrender_begin(tr, W, H):
            print("gs_texrender_begin failed")
            return 1
        gs_ortho(0.0, float(W), 0.0, float(H), -100.0, 100.0)
        gs_matrix_identity()
        clear = (c_float * 4)(0.0, 0.0, 0.0, 0.0)
        gs_clear(GS_CLEAR_COLOR, clear, 0.0, 0)
        gs_blend_state_push()
        gs_enable_blending(True)
        gs_blend_function(GS_BLEND_ONE, GS_BLEND_INVSRCALPHA)
        for row, (tech, dur, rmul, ext, colors) in enumerate(STYLES):
            R = min(R_BASE * rmul, CELL / (ext[2] - ext[0]), CELL / (ext[3] - ext[1]))
            idx = STYLE_INDEX[tech]
            for col, frac in enumerate(FRACTIONS):
                cx = col * CELL + CELL * (-ext[0]) / (ext[2] - ext[0])
                cy = row * CELL + CELL * (-ext[1]) / (ext[3] - ext[1])
                draw(tech, idx, cx, cy, ext, R, frac * dur, dur, colors)
            cx, cy = len(FRACTIONS) * CELL + CELL / 2, row * CELL + CELL * 0.55
            draw("Hold", idx, cx, cy, HOLD_EXT, R_BASE * rmul * 1.4, 0.6, dur, colors)
        gs_blend_state_pop()
        gs_texrender_end(tr)

        stage = gs_stagesurface_create(W, H, GS_RGBA)
        gs_stage_texture(stage, gs_texrender_get_texture(tr))
        data, linesize = c_void_p(), c_uint32()
        if not gs_stagesurface_map(stage, byref(data), byref(linesize)):
            print("map failed")
            return 1
        buf = ctypes.string_at(data.value, linesize.value * H)
        gs_stagesurface_unmap(stage)
        px = np.frombuffer(buf, np.uint8).reshape(H, linesize.value)[:, :W * 4].reshape(H, W, 4).astype(np.float64) / 255
        gs_stagesurface_destroy(stage)
        gs_texrender_destroy(tr)
        for tex in textures.values():
            if tex:
                gs_texture_destroy(tex)

        print(f"rendered {W}x{H}; alpha max {px[..., 3].max():.3f}, covered pixels {(px[..., 3] > 0.02).mean() * 100:.1f}%")
        over_alpha = (px[..., :3].max(-1) > px[..., 3] + 0.02).mean() * 100
        print(f"emissive pixels (rgb above alpha): {over_alpha:.1f}%")
        for name, bg in (("dark", (0.11, 0.12, 0.13)), ("light", (0.96, 0.965, 0.975))):
            comp = px[..., :3] + np.array(bg) * (1 - px[..., 3:4])
            comp[::CELL, :, :] = 0.5
            comp[:, ::CELL, :] = 0.5
            out = os.path.join(out_dir, f"obs_sheet_{name}.png")
            write_png(out, (np.clip(comp, 0, 1) * 255 + 0.5).astype(np.uint8))
            print("wrote", out)
    finally:
        gs_leave_context()
        gs_destroy(graphics)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
