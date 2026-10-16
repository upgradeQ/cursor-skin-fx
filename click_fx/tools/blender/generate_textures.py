"""
Premium Click FX - texture generator for Blender 5.x.

Builds every texture the OBS effect samples, using Blender's procedural
noise / Voronoi / Color Ramp shader nodes, real geometry for the HUD rings
and Cycles renders of a lit sphere for the liquid matcap.

Each texture is rendered to a float EXR inside a throwaway scene, packed
with numpy and written as a plain 8-bit RGBA PNG (no gamma or ICC chunks,
alpha always 255), so OBS samples exactly the bytes written here.

Usage
  Live Blender (Text Editor, or any Python console):
      import runpy
      runpy.run_path(r"<repo>/tools/blender/generate_textures.py", run_name="__main__")
  Command line:
      blender -b --factory-startup -P tools/blender/generate_textures.py -- [--out DIR] [--keep]

The temporary scene and every datablock it creates are removed afterwards
unless --keep is given, so the open .blend file is left as it was.
"""

import math
import os
import struct
import sys
import tempfile
import zlib

import bmesh
import bpy
import numpy as np
from mathutils import Vector

TAU = 2.0 * math.pi


# ---------------------------------------------------------------------------
# Small numeric helpers
# ---------------------------------------------------------------------------

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def stretch(a, lo_pct=0.5, hi_pct=99.5):
    """Maps the [lo_pct, hi_pct] percentile range of a to [0, 1]."""
    lo, hi = np.percentile(a, [lo_pct, hi_pct])
    return np.clip((a - lo) / max(hi - lo, 1e-6), 0.0, 1.0)


def srgb_encode(lin):
    lin = np.clip(lin, 0.0, 1.0)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1.0 / 2.4) - 0.055)


def srgb_decode(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, np.power((c + 0.055) / 1.055, 2.4))


def gaussian_blur(a, sigma):
    """Separable Gaussian blur of a 2D array; x wraps (it is an angle), y reflects."""
    r = max(1, int(math.ceil(sigma * 3.0)))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    rows = np.zeros_like(a)
    for i, w in enumerate(k):
        rows += w * np.roll(a, i - r, axis=1)
    padded = np.pad(rows, ((r, r), (0, 0)), mode="reflect")
    out = np.zeros_like(a)
    for i, w in enumerate(k):
        out += w * padded[i:i + a.shape[0]]
    return out


def write_png(path, rgb):
    """Writes an (h, w, 3) float array in [0, 1] as 8-bit RGBA with alpha = 255.

    Only IHDR / IDAT / IEND chunks: nothing a loader could treat as gamma or a
    colour profile, so every viewer and OBS read back the same bytes.
    """
    h, w, _ = rgb.shape
    rgba = np.empty((h, w, 4), np.uint8)
    rgba[..., :3] = np.clip(rgb * 255.0 + 0.5, 0.0, 255.0).astype(np.uint8)
    rgba[..., 3] = 255
    raw = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


# ---------------------------------------------------------------------------
# Shader node graph helper
# ---------------------------------------------------------------------------

class Graph:
    def __init__(self, node_tree):
        self.nt = node_tree
        self.nt.nodes.clear()

    def node(self, idname, **props):
        n = self.nt.nodes.new(idname)
        for key, value in props.items():
            setattr(n, key, value)
        return n

    def feed(self, socket, value):
        if isinstance(value, bpy.types.NodeSocket):
            self.nt.links.new(value, socket)
        else:
            socket.default_value = value

    def link(self, out_socket, in_socket):
        self.nt.links.new(out_socket, in_socket)

    def math(self, op, a, b=None):
        n = self.node("ShaderNodeMath", operation=op)
        self.feed(n.inputs[0], a)
        if b is not None:
            self.feed(n.inputs[1], b)
        return n.outputs[0]

    def generated(self):
        tc = self.node("ShaderNodeTexCoord")
        sep = self.node("ShaderNodeSeparateXYZ")
        self.link(tc.outputs["Generated"], sep.inputs[0])
        return sep.outputs[0], sep.outputs[1]

    def xyz(self, x, y, z):
        c = self.node("ShaderNodeCombineXYZ")
        for i, v in enumerate((x, y, z)):
            self.feed(c.inputs[i], v)
        return c.outputs[0]

    def rgb(self, r, g, b):
        c = self.node("ShaderNodeCombineColor")
        for i, v in enumerate((r, g, b)):
            self.feed(c.inputs[i], v)
        return c.outputs[0]

    def ring(self, t, radius):
        """(cos 2pi t, sin 2pi t) * radius: a periodic coordinate pair."""
        a = self.math("MULTIPLY", t, TAU)
        return (self.math("MULTIPLY", self.math("COSINE", a), radius),
                self.math("MULTIPLY", self.math("SINE", a), radius))

    def torus4(self, ru, rv):
        """Generated (u, v) wrapped onto a 4D torus: 4D noise sampled here tiles in u and v."""
        u, v = self.generated()
        x, y = self.ring(u, ru)
        z, w = self.ring(v, rv)
        return self.xyz(x, y, z), w

    def noise(self, vec, w, scale, detail, roughness, kind="FBM", dims="4D", lacunarity=2.0, distortion=0.0):
        n = self.node("ShaderNodeTexNoise", noise_dimensions=dims, noise_type=kind)
        self.feed(n.inputs["Vector"], vec)
        if dims == "4D":
            self.feed(n.inputs["W"], w)
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = roughness
        n.inputs["Lacunarity"].default_value = lacunarity
        n.inputs["Distortion"].default_value = distortion
        return n.outputs["Fac"]

    def voronoi(self, vec, w, scale, feature="F1"):
        n = self.node("ShaderNodeTexVoronoi", voronoi_dimensions="4D", feature=feature)
        self.feed(n.inputs["Vector"], vec)
        self.feed(n.inputs["W"], w)
        n.inputs["Scale"].default_value = scale
        return n.outputs["Distance"]

    def color_ramp(self, fac, stops):
        """stops: [(position, (r, g, b) in sRGB 0..1)]; interpolated by Blender in linear."""
        n = self.node("ShaderNodeValToRGB")
        ramp = n.color_ramp
        ramp.interpolation = "EASE"
        while len(ramp.elements) > 1:
            ramp.elements.remove(ramp.elements[-1])
        for i, (pos, col) in enumerate(stops):
            el = ramp.elements[0] if i == 0 else ramp.elements.new(pos)
            el.position = pos
            lin = srgb_decode(col)
            el.color = (float(lin[0]), float(lin[1]), float(lin[2]), 1.0)
        self.feed(n.inputs["Fac"], fac)
        return n.outputs["Color"]


# ---------------------------------------------------------------------------
# Throwaway render stage
# ---------------------------------------------------------------------------

class Stage:
    """A temporary Cycles scene; rendering returns linear float pixels, top row first."""

    def __init__(self, tmp_dir):
        self.tmp = tmp_dir
        self.count = 0
        self.ids = []

        self.scene = self.track(bpy.data.scenes.new("PCFX_AssetGen"))
        s = self.scene
        try:
            s.render.engine = "CYCLES"
        except TypeError as exc:
            raise RuntimeError(f"Cycles must be enabled to generate textures ({exc})")
        cy = s.cycles
        cy.device = "CPU"
        cy.use_denoising = False
        cy.use_adaptive_sampling = False
        s.render.use_compositing = False
        s.render.use_sequencer = False
        s.render.resolution_percentage = 100
        fmt = s.render.image_settings
        fmt.file_format = "OPEN_EXR"
        fmt.color_depth = "32"

        s.world = self.track(bpy.data.worlds.new("PCFX_World"))
        self.world_color((0.0, 0.0, 0.0), 0.0)

        cam_data = self.track(bpy.data.cameras.new("PCFX_Camera"))
        cam_data.type = "ORTHO"
        cam_data.clip_start = 0.01
        cam_data.clip_end = 1000.0
        self.cam = self.track(bpy.data.objects.new("PCFX_Camera", cam_data))
        s.collection.objects.link(self.cam)
        s.camera = self.cam

    def track(self, idblock):
        self.ids.append(idblock)
        return idblock

    def world_color(self, color, strength):
        g = Graph(self.scene.world.node_tree)
        bg = g.node("ShaderNodeBackground")
        bg.inputs["Color"].default_value = (*color, 1.0)
        bg.inputs["Strength"].default_value = strength
        out = g.node("ShaderNodeOutputWorld")
        g.link(bg.outputs[0], out.inputs["Surface"])

    def material(self, name):
        mat = self.track(bpy.data.materials.new(name))
        return mat, Graph(mat.node_tree)

    def emission_material(self, name, build):
        mat, g = self.material(name)
        out = g.node("ShaderNodeOutputMaterial")
        em = g.node("ShaderNodeEmission")
        em.inputs["Strength"].default_value = 1.0
        g.feed(em.inputs["Color"], build(g))
        g.link(em.outputs[0], out.inputs["Surface"])
        return mat

    def add_object(self, name, data, material=None):
        ob = self.track(bpy.data.objects.new(name, data))
        if material is not None:
            data.materials.append(material)
        self.scene.collection.objects.link(ob)
        return ob

    def clear(self):
        for ob in list(self.scene.collection.objects):
            if ob != self.cam:
                self.scene.collection.objects.unlink(ob)
        self.scene.render.film_transparent = False

    def top_down(self, w, h):
        """Camera frames the rectangle [0, w] x [0, h] on z = 0 at one unit per pixel."""
        s = self.scene
        s.render.resolution_x, s.render.resolution_y = w, h
        self.cam.data.ortho_scale = float(max(w, h))
        self.cam.location = (w / 2.0, h / 2.0, 100.0)
        self.cam.rotation_euler = (0.0, 0.0, 0.0)

    def rect_mesh(self, name, rects_or_polys, png_h, ids=None):
        """Builds a mesh from polygons given in PNG pixel space (y down)."""
        verts, faces = [], []
        for poly in rects_or_polys:
            base = len(verts)
            verts.extend((x, png_h - y, 0.0) for x, y in poly)
            faces.append(tuple(range(base, base + len(poly))))
        me = self.track(bpy.data.meshes.new(name))
        me.from_pydata(verts, [], faces)
        if ids is not None:
            attr = me.color_attributes.new("pcfx_id", "FLOAT_COLOR", "CORNER")
            cols = np.zeros((len(me.loops), 4), np.float32)
            for poly, eid in zip(me.polygons, ids):
                cols[poly.loop_start:poly.loop_start + poly.loop_total] = (eid, eid, eid, 1.0)
            attr.data.foreach_set("color", cols.ravel())
        me.update()
        return me

    def plane(self, name, x0, y0, x1, y1, png_h, material):
        me = self.rect_mesh(name, [[(x0, y0), (x1, y0), (x1, y1), (x0, y1)]], png_h)
        return self.add_object(name, me, material)

    def render(self, samples=1, filter_width=0.01, filter_type="BOX", bounces=0):
        s = self.scene
        s.cycles.samples = samples
        s.cycles.pixel_filter_type = filter_type
        s.cycles.filter_width = filter_width
        s.cycles.max_bounces = bounces
        self.count += 1
        path = os.path.join(self.tmp, f"pcfx_{self.count:02d}.exr")
        s.render.filepath = path
        bpy.ops.render.render(write_still=True, scene=s.name)
        img = bpy.data.images.load(path, check_existing=False)
        w, h = img.size
        buf = np.empty(w * h * 4, np.float32)
        img.pixels.foreach_get(buf)
        bpy.data.images.remove(img)
        return buf.reshape(h, w, 4)[::-1].copy()

    def cleanup(self):
        removers = {
            bpy.types.Object: bpy.data.objects,
            bpy.types.Mesh: bpy.data.meshes,
            bpy.types.Material: bpy.data.materials,
            bpy.types.Camera: bpy.data.cameras,
            bpy.types.Light: bpy.data.lights,
            bpy.types.World: bpy.data.worlds,
            bpy.types.Scene: bpy.data.scenes,
        }
        for idblock in reversed(self.ids):
            for kind, collection in removers.items():
                if isinstance(idblock, kind):
                    try:
                        collection.remove(idblock)
                    except (ReferenceError, RuntimeError):
                        pass
                    break
        self.ids.clear()


# ---------------------------------------------------------------------------
# 1. noise.png - tileable RGB noise: fBm / Voronoi cells / ridged multifractal
# ---------------------------------------------------------------------------

def make_noise(st, out_dir):
    size = 512
    st.clear()
    st.top_down(size, size)

    def build(g):
        vec, w = g.torus4(1.0, 1.0)
        fbm = g.noise(vec, w, scale=1.15, detail=8.0, roughness=0.58, kind="FBM")
        cells = g.voronoi(vec, w, scale=2.4)
        wisps = g.noise(vec, w, scale=1.4, detail=7.0, roughness=0.56, kind="FBM", distortion=1.8)
        return g.rgb(fbm, cells, wisps)

    st.plane("PCFX_NoisePlane", 0, 0, size, size, size, st.emission_material("PCFX_Noise", build))
    px = st.render()
    rgb = np.stack([stretch(px[..., c]) for c in range(3)], axis=-1)
    write_png(os.path.join(out_dir, "noise.png"), rgb)
    return rgb


# ---------------------------------------------------------------------------
# 2. brush.png - dry-brush stroke strip, tiles along U
#    R = stroke coverage with ragged edges, G = bristle streaks, B = paper grain
# ---------------------------------------------------------------------------

def make_brush(st, out_dir):
    w_px, h_px = 512, 64
    st.clear()
    st.top_down(w_px, h_px)

    def build(g):
        u, v = g.generated()
        # Edge wobble: varies only along the stroke.
        ex, ey = g.ring(u, 0.9)
        edge = g.noise(g.xyz(ex, ey, 0.0), None, scale=1.3, detail=4.0, roughness=0.55, dims="3D")
        # Bristles: long along the stroke, fast across it.
        bx, by = g.ring(u, 0.55)
        bristle = g.noise(g.xyz(bx, by, g.math("MULTIPLY", v, 7.5)), None,
                          scale=1.7, detail=3.0, roughness=0.5, dims="3D")
        # Paper grain: isotropic in pixels, tiles in both axes (u circle is 8x the v circle).
        gx, gy = g.ring(u, 2.8)
        gz, gw = g.ring(v, 0.35)
        grain = g.noise(g.xyz(gx, gy, gz), gw, scale=9.0, detail=2.0, roughness=0.6)
        return g.rgb(edge, bristle, grain)

    st.plane("PCFX_BrushPlane", 0, 0, w_px, h_px, h_px, st.emission_material("PCFX_Brush", build))
    px = st.render()
    edge = stretch(px[..., 0])
    bristle = stretch(px[..., 1])
    grain = stretch(px[..., 2])

    v = (np.arange(h_px) + 0.5) / h_px
    centre = (1.0 - np.abs(2.0 * v - 1.0))[:, None]          # 0 at the stroke edges, 1 in the middle
    threshold = 0.07 + 0.17 * edge + 0.12 * (bristle - 0.5) + 0.06 * (grain - 0.5)   # ragged, fibrous edge
    coverage = smoothstep(threshold - 0.045, threshold + 0.045, centre)
    coverage *= smoothstep(0.0, 0.07, centre)                   # outermost rows are always empty

    write_png(os.path.join(out_dir, "brush.png"), np.stack([coverage, bristle, grain], axis=-1))


# ---------------------------------------------------------------------------
# 3. ramps.png - 256 x 16, four 4-px rows of display-referred colour ramps
#    (Blender Color Ramp nodes, stops authored in sRGB, blended in linear)
#    row 0 fire, row 1 sci-fi plasma, row 2 blue flame, row 3 violet flame.
#    x = 0 is always black: the shader treats the ramp as emitted light.
# ---------------------------------------------------------------------------

RAMPS = [
    ("Fire", [(0.0, (0, 0, 0)), (0.12, (0.16, 0.015, 0.0)), (0.28, (0.55, 0.05, 0.0)),
              (0.44, (0.92, 0.2, 0.01)), (0.6, (1.0, 0.45, 0.04)), (0.76, (1.0, 0.7, 0.18)),
              (0.9, (1.0, 0.9, 0.55)), (1.0, (1.0, 1.0, 0.92))]),
    ("Plasma", [(0.0, (0, 0, 0)), (0.2, (0.0, 0.04, 0.22)), (0.45, (0.0, 0.33, 1.0)),
                (0.72, (0.22, 0.82, 1.0)), (1.0, (0.92, 1.0, 1.0))]),
    ("BlueFlame", [(0.0, (0, 0, 0)), (0.22, (0.05, 0.02, 0.32)), (0.48, (0.1, 0.3, 1.0)),
                   (0.76, (0.42, 0.84, 1.0)), (1.0, (1.0, 1.0, 1.0))]),
    ("VioletFlame", [(0.0, (0, 0, 0)), (0.22, (0.2, 0.0, 0.3)), (0.48, (0.62, 0.1, 0.95)),
                     (0.76, (1.0, 0.45, 0.9)), (1.0, (1.0, 0.95, 1.0))]),
]


def make_ramps(st, out_dir):
    w_px, h_px = 256, 16
    st.clear()
    st.top_down(w_px, h_px)

    def ramp(stops):
        def build(g):
            x, _ = g.generated()
            return g.color_ramp(x, stops)
        return build

    for i, (name, stops) in enumerate(RAMPS):
        st.plane(f"PCFX_Ramp{name}", 0, i * 4, w_px, i * 4 + 4, h_px,
                 st.emission_material(f"PCFX_Ramp{name}", ramp(stops)))
    px = st.render()[..., :3]

    out = np.zeros((h_px, w_px, 3))
    for row in range(len(RAMPS)):
        out[row * 4:row * 4 + 4] = srgb_encode(px[row * 4 + 1])[None]
    write_png(os.path.join(out_dir, "ramps.png"), out)


# ---------------------------------------------------------------------------
# 4. hud.png - 512 x 256 polar HUD atlas, eight 32-px bands rendered from
#    real geometry. x = angle around the ring (wraps), y = radius inside a band
#    (band-local 0 = inner edge, 28 = outer edge, 2-px margins).
#    R = coverage, G = per-element id * coverage, B = blurred coverage (glow)
# ---------------------------------------------------------------------------

def hud_shapes(rng):
    polys, ids = [], []

    def put(band, pts, eid=None):
        polys.append([(x, band * 32 + 2 + y) for x, y in pts])
        ids.append(float(rng.uniform(0.12, 1.0)) if eid is None else eid)

    def rect(band, x0, y0, x1, y1):
        put(band, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)])

    # 0: ticks with a base line
    rect(0, 0, 0, 512, 1.5)
    for i in range(64):
        x = i * 8 + 4
        length, width = (24, 3) if i % 16 == 0 else (15, 2) if i % 4 == 0 else (8, 2)
        rect(0, x - width / 2, 2, x + width / 2, 2 + length)

    # 1: segmented arc with slanted ends
    for a, b in [(0.0, 0.1), (0.125, 0.19), (0.215, 0.37), (0.4, 0.435),
                 (0.46, 0.63), (0.66, 0.78), (0.805, 0.835), (0.86, 0.975)]:
        x0, x1 = a * 512 + 2, b * 512
        put(1, [(x0, 9), (x1, 9), (x1 + 4, 19), (x0 + 4, 19)])

    # 2: dot ring, every fourth dot larger
    for i in range(32):
        x = i * 16 + 8
        s = 3.0 if i % 4 == 0 else 2.0
        rect(2, x - s, 14 - s, x + s, 14 + s)

    # 3: three heavy chamfered arcs, each notched into five pieces
    for j in range(3):
        start = j * 512 / 3 + 8
        piece = 512 * 0.235 / 5
        for k in range(5):
            x0 = start + k * piece
            x1 = x0 + piece - 3
            chamfer_l = 6 if k == 0 else 0
            chamfer_r = 6 if k == 4 else 0
            put(3, [(x0 + chamfer_l, 6), (x1, 6), (x1 - chamfer_r, 22), (x0, 22)])

    # 4: chevrons pointing along the direction of rotation
    for i in range(16):
        x = i * 32 + 8
        eid = float(rng.uniform(0.12, 1.0))
        put(4, [(x, 4), (x + 5, 4), (x + 13, 14), (x + 8, 14)], eid)
        put(4, [(x + 8, 14), (x + 13, 14), (x + 5, 24), (x, 24)], eid)

    # 5: spectrum bars
    for i in range(64):
        x = i * 8 + 2
        h = 4 + 22 * (0.5 + 0.5 * math.sin(i * 0.61) * math.cos(i * 0.23)) * rng.uniform(0.55, 1.0)
        rect(5, x, 1, x + 4, 1 + h)

    # 6: double rail with ties
    for i in range(8):
        x0 = i * 64 + 6
        x1 = x0 + 52
        rect(6, x0, 6, x1, 8.5)
        rect(6, x0, 19.5, x1, 22)
        for t in range(3):
            tx = x0 + 8 + t * 16
            rect(6, tx, 8.5, tx + 2, 19.5)

    # 7: rows of random "data glyph" blocks
    for y0, y1 in ((3, 8), (11, 16), (19, 24)):
        x = 2.0
        while True:
            w = float(rng.integers(2, 13))
            if x + w > 509:
                break
            rect(7, x, y0, x + w, y1)
            x += w + float(rng.integers(2, 7))

    return polys, ids


def make_hud(st, out_dir):
    w_px, h_px = 512, 256
    st.clear()
    st.top_down(w_px, h_px)
    polys, ids = hud_shapes(np.random.default_rng(1440))

    mat, g = st.material("PCFX_Hud")
    out = g.node("ShaderNodeOutputMaterial")
    em = g.node("ShaderNodeEmission")
    attr = g.node("ShaderNodeAttribute", attribute_name="pcfx_id")
    sep = g.node("ShaderNodeSeparateColor")
    g.link(attr.outputs["Color"], sep.inputs[0])
    g.link(g.rgb(1.0, sep.outputs[0], 0.0), em.inputs["Color"])
    g.link(em.outputs[0], out.inputs["Surface"])
    st.add_object("PCFX_HudShapes", st.rect_mesh("PCFX_HudShapes", polys, h_px, ids), mat)

    px = st.render(samples=64, filter_width=1.0)
    cov = np.clip(px[..., 0], 0.0, 1.0)
    eid = np.clip(px[..., 1], 0.0, 1.0)
    glow = np.zeros_like(cov)
    for band in range(8):
        sl = slice(band * 32, band * 32 + 32)
        glow[sl] = gaussian_blur(cov[sl], 2.6)
    glow = np.clip(glow * 1.6, 0.0, 1.0)
    write_png(os.path.join(out_dir, "hud.png"), np.stack([cov, eid, glow], axis=-1))


# ---------------------------------------------------------------------------
# 5. matcap.png - 256 x 256 lit sphere, view-space normal -> uv
#    R = diffuse, G = sharp specular, B = soft sheen (all white light, tinted in
#    the shader). Pixels outside the sphere repeat the rim so filtering is safe.
# ---------------------------------------------------------------------------

def make_matcap(st, out_dir):
    n = 256
    s = st.scene
    st.clear()
    s.render.film_transparent = True
    s.render.resolution_x = s.render.resolution_y = n
    st.cam.data.ortho_scale = 2.0
    st.cam.location = (0.0, -10.0, 0.0)
    st.cam.rotation_euler = (math.pi / 2.0, 0.0, 0.0)
    st.world_color((0.012, 0.012, 0.014), 1.0)

    me = st.track(bpy.data.meshes.new("PCFX_Sphere"))
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=128, v_segments=64, radius=1.0)
    bm.to_mesh(me)
    bm.free()
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.update()
    sphere = st.add_object("PCFX_Sphere", me)

    def area(name, loc, sx, sy, energy):
        data = st.track(bpy.data.lights.new(name, "AREA"))
        data.shape = "RECTANGLE"
        data.size, data.size_y = sx, sy
        data.energy = energy
        ob = st.add_object(name, data)
        ob.location = loc
        ob.rotation_euler = (Vector((0.0, 0.0, 0.0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()

    area("PCFX_Key", (-2.2, -3.6, 2.4), 2.8, 1.8, 1300.0)
    area("PCFX_Fill", (3.4, -2.2, -0.6), 1.2, 3.0, 70.0)
    area("PCFX_Rim", (1.6, 3.2, 2.2), 3.4, 0.5, 900.0)
    area("PCFX_Floor", (0.0, -1.5, -3.2), 4.0, 4.0, 35.0)

    def surface(kind, roughness=0.0):
        mat, g = st.material(f"PCFX_Matcap{kind}")
        out = g.node("ShaderNodeOutputMaterial")
        if kind == "Diffuse":
            bsdf = g.node("ShaderNodeBsdfDiffuse")
        else:
            bsdf = g.node("ShaderNodeBsdfAnisotropic")   # the Glossy BSDF node since Blender 4.0
            bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Color"].default_value = (0.8, 0.8, 0.8, 1.0)
        g.link(bsdf.outputs[0], out.inputs["Surface"])
        me.materials.clear()
        me.materials.append(mat)

    surface("Diffuse")
    diffuse = st.render(samples=128, filter_width=1.5, filter_type="GAUSSIAN", bounces=2)
    surface("Sharp", 0.06)
    sharp = st.render(samples=256, filter_width=1.5, filter_type="GAUSSIAN", bounces=2)
    surface("Sheen", 0.32)
    sheen = st.render(samples=128, filter_width=1.5, filter_type="GAUSSIAN", bounces=2)

    alpha = diffuse[..., 3]

    def channel(px, gain_pct):
        lum = px[..., :3].mean(axis=-1) / np.maximum(alpha, 1e-4)
        inside = lum[alpha > 0.5]
        gain = 1.0 / max(np.percentile(inside, gain_pct), 1e-4)
        return srgb_encode(np.clip(lum * gain, 0.0, 1.0))

    out = np.stack([channel(diffuse, 99.0) * 0.96, channel(sharp, 99.7), channel(sheen, 99.5)], axis=-1)

    # Outside the disc, repeat the value found just inside along the same radius.
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float64)
    c = (n - 1) / 2.0
    dx, dy = xx - c, yy - c
    dist = np.sqrt(dx * dx + dy * dy)
    lim = n / 2.0 - 2.5
    scale = np.where(dist > lim, lim / np.maximum(dist, 1e-6), 1.0)
    sx = np.clip(np.round(c + dx * scale).astype(int), 0, n - 1)
    sy = np.clip(np.round(c + dy * scale).astype(int), 0, n - 1)
    outside = (dist > lim) | (alpha < 0.98)
    out[outside] = out[sy[outside], sx[outside]]
    write_png(os.path.join(out_dir, "matcap.png"), out)
    st.scene.collection.objects.unlink(sphere)


# ---------------------------------------------------------------------------

def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out_dir, keep = None, False
    i = 0
    while i < len(argv):
        if argv[i] == "--out" and i + 1 < len(argv):
            out_dir = argv[i + 1]
            i += 1
        elif argv[i] == "--keep":
            keep = True
        i += 1
    if out_dir is None:
        here = os.path.dirname(os.path.abspath(__file__))
        out_dir = os.path.join(here, "..", "..", "premium_click_fx", "textures")
    return os.path.normpath(out_dir), keep


def main():
    out_dir, keep = parse_args()
    os.makedirs(out_dir, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="pcfx_")
    stage = Stage(tmp)
    try:
        for name, fn in (("noise", make_noise), ("brush", make_brush), ("ramps", make_ramps),
                         ("hud", make_hud), ("matcap", make_matcap)):
            fn(stage, out_dir)
            print(f"[pcfx] wrote {os.path.join(out_dir, name + '.png')}")
    finally:
        if not keep:
            stage.cleanup()
        for f in os.listdir(tmp):
            try:
                os.remove(os.path.join(tmp, f))
            except OSError:
                pass
        try:
            os.rmdir(tmp)
        except OSError:
            pass


if __name__ == "__main__":
    main()
