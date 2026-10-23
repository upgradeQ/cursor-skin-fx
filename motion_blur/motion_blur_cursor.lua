--[[
  Motion Blur Cursor — OBS Studio Lua script (Windows)

  Registers a "Motion Blur Cursor" source that draws a vector cursor
  (arrow / text I-beam / wait spinner / link hand) following the system mouse, with
  spring-smoothed movement and true motion blur along the curved path the
  cursor travelled during the shutter interval.

  Cursor shapes are signed distance fields evaluated in a pixel shader, so
  they stay crisp at any scale. Motion blur is computed in the same shader by
  integrating the cursor over a quadratic Bezier fitted to the simulated path.
]]

local obs = obslua
local ffi = require("ffi")
local bit = require("bit")

pcall(ffi.cdef, [[
typedef struct { int32_t x; int32_t y; } MBC_POINT;
typedef struct { int32_t left; int32_t top; int32_t right; int32_t bottom; } MBC_RECT;
typedef struct { uint32_t cbSize; uint32_t flags; void *hCursor; MBC_POINT ptScreenPos; } MBC_CURSORINFO;
typedef struct { uint32_t cbSize; MBC_RECT rcMonitor; MBC_RECT rcWork; uint32_t dwFlags; } MBC_MONITORINFO;
typedef int (__stdcall *MBC_MONITORENUMPROC)(void *, void *, MBC_RECT *, intptr_t);
int   __stdcall GetCursorInfo(MBC_CURSORINFO *pci);
void *__stdcall LoadCursorW(void *hInstance, const void *lpCursorName);
short __stdcall GetAsyncKeyState(int vKey);
int   __stdcall EnumDisplayMonitors(void *hdc, const MBC_RECT *lprcClip, MBC_MONITORENUMPROC lpfnEnum, intptr_t dwData);
int   __stdcall GetMonitorInfoW(void *hMonitor, MBC_MONITORINFO *lpmi);
int   __stdcall GetSystemMetrics(int nIndex);
]])

local user32 = ffi.load("user32")

local SOURCE_ID = "motion_blur_cursor"

local SHAPE_AUTO, SHAPE_ARROW, SHAPE_TEXT, SHAPE_WAIT, SHAPE_HAND = -1, 0, 1, 2, 3

local MONITOR_CUSTOM, MONITOR_PRIMARY = -1, -2

local HISTORY_SIZE = 512   -- ring buffer of simulated positions (~1 s at 2 ms substeps)
local SUBSTEP = 0.002      -- simulation substep in seconds
local MAX_SHADER_SAMPLES = 128

---------------------------------------------------------------------------
-- Shader
---------------------------------------------------------------------------

local EFFECT_SRC = [[
uniform float4x4 ViewProj;

uniform float2 box_origin;
uniform float2 box_size;
uniform float2 p0;
uniform float2 p1;
uniform float2 p2;
uniform float  sample_count;
uniform float  trail_falloff;
uniform float  cur_scale;
uniform float2 tilt_cs;
uniform float  shape_a;
uniform float  shape_b;
uniform float  morph;
uniform float  anim_time;
uniform float4 fill_color;
uniform float4 outline_color;
uniform float4 shadow_color;
uniform float  outline_width;
uniform float  shadow_blur;
uniform float2 shadow_offset;
uniform float  opacity;

struct VertData {
	float4 pos : POSITION;
	float2 uv  : TEXCOORD0;
};

VertData VSDefault(VertData v_in)
{
	VertData vert_out;
	vert_out.pos = mul(float4(v_in.pos.xyz, 1.0), ViewProj);
	vert_out.uv  = v_in.uv;
	return vert_out;
}

// One edge of the polygon SDF (Inigo Quilez). ds = (min squared distance, sign).
float2 poly_edge(float2 ds, float2 p, float2 a, float2 b)
{
	float2 e = b - a;
	float2 w = p - a;
	float2 q = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
	ds.x = min(ds.x, dot(q, q));
	bool c1 = p.y >= a.y;
	bool c2 = p.y < b.y;
	bool c3 = e.x * w.y > e.y * w.x;
	if ((c1 && c2 && c3) || (!c1 && !c2 && !c3))
		ds.y = -ds.y;
	return ds;
}

// Classic pointer, hotspot (tip) at the origin, y pointing down.
float sd_arrow(float2 p)
{
	float2 v0 = float2(0.0, 0.0);
	float2 v1 = float2(0.0, 16.0);
	float2 v2 = float2(3.8, 12.4);
	float2 v3 = float2(6.3, 18.2);
	float2 v4 = float2(8.9, 17.1);
	float2 v5 = float2(6.5, 11.4);
	float2 v6 = float2(11.4, 11.4);
	float2 ds = float2(dot(p - v0, p - v0), 1.0);
	ds = poly_edge(ds, p, v0, v6);
	ds = poly_edge(ds, p, v1, v0);
	ds = poly_edge(ds, p, v2, v1);
	ds = poly_edge(ds, p, v3, v2);
	ds = poly_edge(ds, p, v4, v3);
	ds = poly_edge(ds, p, v5, v4);
	ds = poly_edge(ds, p, v6, v5);
	return ds.y * sqrt(ds.x) - 0.6;
}

float sd_segment(float2 p, float2 a, float2 b)
{
	float2 pa = p - a;
	float2 ba = b - a;
	float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
	return length(pa - ba * h);
}

float smin(float a, float b, float k)
{
	float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
	return lerp(b, a, h) - k * h * (1.0 - h);
}

// Text I-beam with flared serifs, hotspot at the centre.
float sd_ibeam(float2 p)
{
	float2 q = abs(p);
	float stem  = sd_segment(q, float2(0.0, 0.0), float2(0.0, 8.0));
	float serif = sd_segment(q, float2(0.0, 8.7), float2(3.4, 9.6));
	return smin(stem, serif, 1.4) - 0.8;
}

// Link-select hand pointing up, hotspot at the index fingertip.
float sd_hand(float2 p)
{
	float fingers = sd_segment(p, float2(0.0, 1.7), float2(0.0, 11.0)) - 1.7;
	fingers = min(fingers, sd_segment(p, float2(3.4, 8.2), float2(3.4, 12.0)) - 1.7);
	fingers = min(fingers, sd_segment(p, float2(6.8, 9.2), float2(6.8, 12.0)) - 1.7);
	fingers = min(fingers, sd_segment(p, float2(10.0, 10.4), float2(10.0, 12.5)) - 1.5);

	float2 v0 = float2(-1.0, 10.5);
	float2 v1 = float2(10.9, 10.5);
	float2 v2 = float2(10.9, 15.2);
	float2 v3 = float2(8.4, 19.4);
	float2 v4 = float2(1.2, 19.4);
	float2 v5 = float2(-1.0, 16.6);
	float2 ds = float2(dot(p - v0, p - v0), 1.0);
	ds = poly_edge(ds, p, v5, v0);
	ds = poly_edge(ds, p, v0, v1);
	ds = poly_edge(ds, p, v1, v2);
	ds = poly_edge(ds, p, v2, v3);
	ds = poly_edge(ds, p, v3, v4);
	ds = poly_edge(ds, p, v4, v5);
	float palm = ds.y * sqrt(ds.x) - 0.6;

	float thumb = sd_segment(p, float2(0.0, 15.6), float2(-4.2, 11.6)) - 1.6;
	float d = smin(min(fingers, palm), thumb, 1.2);

	// Creases between the curled fingers, drawn in the outline colour.
	float g = min(sd_segment(p, float2(1.7, 7.0), float2(1.7, 12.2)),
	              sd_segment(p, float2(5.1, 8.5), float2(5.1, 12.6)));
	g = min(g, sd_segment(p, float2(8.5, 9.6), float2(8.5, 12.9)));
	return max(d, 0.35 - g);
}

// Busy spinner: a ring with a rotating comet. Returns (distance, fill alpha).
float2 sd_spinner(float2 p)
{
	float d = abs(length(p) - 7.0) - 2.2;
	float a = atan2(p.y, p.x) * 0.15915494;
	float f = frac(a - anim_time * 1.25);
	return float2(d, lerp(0.1, 1.0, f * f));
}

float2 shape_eval(float id, float2 p)
{
	float2 r;
	if (id < 0.5)
		r = float2(sd_arrow(p), 1.0);
	else if (id < 1.5)
		r = float2(sd_ibeam(p), 1.0);
	else if (id < 2.5)
		r = sd_spinner(p);
	else
		r = float2(sd_hand(p), 1.0);
	return r;
}

// Morphs between two shapes by blending their distance fields.
float2 shape_mix(float2 p)
{
	float2 b = shape_eval(shape_b, p);
	if (morph < 0.999)
		b = lerp(shape_eval(shape_a, p), b, morph);
	return b;
}

// Premultiplied colour of the cursor (with shadow) placed at pos.
// k converts local distance units to output pixels.
float4 cursor_at(float2 px, float2 pos, float k)
{
	float2 d  = px - pos;
	float2 lp = float2(tilt_cs.x * d.x + tilt_cs.y * d.y,
	                   -tilt_cs.y * d.x + tilt_cs.x * d.y) / cur_scale;

	float2 s     = shape_mix(lp);
	float  outer = saturate(0.5 - (s.x - outline_width) * k);
	float  inner = saturate(0.5 - s.x * k) * s.y;

	float4 col = outline_color * outer;
	col = fill_color * inner + col * (1.0 - fill_color.a * inner);

	if (shadow_color.a > 0.0) {
		float  sd = shape_mix(lp - shadow_offset).x - outline_width;
		float  sb = max(shadow_blur, 1.0 / k);
		float  sh = 1.0 - smoothstep(-sb, sb, sd);
		col = col + shadow_color * sh * (1.0 - col.a);
	}
	return col;
}

float4 PSCursor(VertData v_in) : TARGET
{
	float2 px = box_origin + v_in.uv * box_size;
	float2 fw = abs(ddx(px)) + abs(ddy(px));
	float  k  = cur_scale / max(max(fw.x, fw.y), 0.0001);

	int n = int(min(sample_count, 128.0));
	float jitter = frac(sin(dot(floor(px), float2(12.9898, 78.233))) * 43758.5453);

	float4 acc  = float4(0.0, 0.0, 0.0, 0.0);
	float  wsum = 0.0;
	for (int i = 0; i < n; i++) {
		float t = (n > 1) ? (float(i) + jitter) / float(n) : 1.0;
		float u = 1.0 - t;
		float2 pos = u * u * p0 + 2.0 * u * t * p1 + t * t * p2;
		float w = lerp(1.0, 0.1 + 0.9 * t, trail_falloff);
		acc  += cursor_at(px, pos, k) * w;
		wsum += w;
	}

	float4 c = acc / max(wsum, 0.0001) * opacity;
	if (c.a < 0.0001)
		return float4(0.0, 0.0, 0.0, 0.0);
	return float4(c.rgb / c.a, c.a);
}

technique Draw
{
	pass
	{
		vertex_shader = VSDefault(v_in);
		pixel_shader  = PSCursor(v_in);
	}
}
]]

---------------------------------------------------------------------------
-- Win32 helpers
---------------------------------------------------------------------------

local function load_cursor_handles()
	local function load(id) return user32.LoadCursorW(nil, ffi.cast("const void *", id)) end
	return {
		ibeam       = load(32513),
		wait        = load(32514),
		appstarting = load(32650),
		hand        = load(32649),
	}
end

local function enum_monitors()
	local list = {}
	local cb = ffi.cast("MBC_MONITORENUMPROC", function(hmon)
		local mi = ffi.new("MBC_MONITORINFO")
		mi.cbSize = ffi.sizeof("MBC_MONITORINFO")
		if user32.GetMonitorInfoW(hmon, mi) ~= 0 then
			local r = mi.rcMonitor
			list[#list + 1] = {
				x = r.left, y = r.top,
				w = r.right - r.left, h = r.bottom - r.top,
				primary = bit.band(mi.dwFlags, 1) ~= 0,
			}
		end
		return 1
	end)
	user32.EnumDisplayMonitors(nil, nil, cb, 0)
	cb:free()
	if #list == 0 then
		list[1] = { x = 0, y = 0, w = user32.GetSystemMetrics(0), h = user32.GetSystemMetrics(1), primary = true }
	end
	return list
end

local function resolve_region(settings)
	local mode = obs.obs_data_get_int(settings, "monitor")
	if mode == MONITOR_CUSTOM then
		return {
			x = obs.obs_data_get_int(settings, "custom_x"),
			y = obs.obs_data_get_int(settings, "custom_y"),
			w = math.max(1, obs.obs_data_get_int(settings, "custom_w")),
			h = math.max(1, obs.obs_data_get_int(settings, "custom_h")),
		}
	end
	local mons = enum_monitors()
	if mode >= 0 and mons[mode + 1] then
		return mons[mode + 1]
	end
	for _, m in ipairs(mons) do
		if m.primary then return m end
	end
	return mons[1]
end

-- OBS colours are 0xAABBGGRR; returns premultiplied r, g, b, a.
local function unpack_color(c)
	local a = bit.band(bit.rshift(c, 24), 0xff) / 255
	return bit.band(c, 0xff) / 255 * a,
	       bit.band(bit.rshift(c, 8), 0xff) / 255 * a,
	       bit.band(bit.rshift(c, 16), 0xff) / 255 * a,
	       a
end

---------------------------------------------------------------------------
-- Position history (ring buffer of simulated positions)
---------------------------------------------------------------------------

local function hist_reset(d)
	d.hn, d.hi = 0, 0
end

local function hist_push(d, t, x, y)
	d.hi = d.hi % HISTORY_SIZE + 1
	d.ht[d.hi], d.hx[d.hi], d.hy[d.hi] = t, x, y
	if d.hn < HISTORY_SIZE then d.hn = d.hn + 1 end
end

-- Position at time t, linearly interpolated between recorded substeps.
local function hist_at(d, t)
	local i = d.hi
	local nt, nx, ny = d.ht[i], d.hx[i], d.hy[i]
	if t >= nt then return nx, ny end
	for _ = 2, d.hn do
		local j = (i - 2) % HISTORY_SIZE + 1
		local pt, px, py = d.ht[j], d.hx[j], d.hy[j]
		if t >= pt then
			local f = (nt > pt) and (t - pt) / (nt - pt) or 1
			return px + (nx - px) * f, py + (ny - py) * f
		end
		i, nt, nx, ny = j, pt, px, py
	end
	return nx, ny
end

---------------------------------------------------------------------------
-- Simulation
---------------------------------------------------------------------------

local function detect_shape(d, ci)
	if d.style ~= SHAPE_AUTO then return d.style end
	local h = ci.hCursor
	if h == d.cursors.ibeam then return SHAPE_TEXT end
	if h == d.cursors.wait or h == d.cursors.appstarting then return SHAPE_WAIT end
	if h == d.cursors.hand then return SHAPE_HAND end
	return SHAPE_ARROW
end

local function tick(d, seconds)
	local dt = math.min(math.max(seconds, 0), 0.1)
	if dt <= 0 then return end

	local ci = d.ci
	ci.cbSize = ffi.sizeof("MBC_CURSORINFO")
	local ok = user32.GetCursorInfo(ci) ~= 0
	local showing = ok and bit.band(ci.flags, 1) ~= 0

	local r = d.region
	local rx, ry = d.prev_rx, d.prev_ry
	if ok then
		rx, ry = ci.ptScreenPos.x - r.x, ci.ptScreenPos.y - r.y
	end
	local inside = rx >= 0 and ry >= 0 and rx < r.w and ry < r.h

	if rx ~= d.prev_rx or ry ~= d.prev_ry then
		d.last_move = d.time
	end

	local want = showing and inside
	if d.idle_hide > 0 and d.time - d.last_move > d.idle_hide then
		want = false
	end

	-- Coming back from fully hidden: jump straight to the cursor instead of
	-- flying in from wherever it was last seen.
	if want and (d.opacity <= 0.001 or d.hn == 0) then
		d.x, d.y, d.vx, d.vy = rx, ry, 0, 0
		d.prev_rx, d.prev_ry = rx, ry
		d.tilt = 0
		hist_reset(d)
		hist_push(d, d.time, rx, ry)
	end

	local fade = dt / 0.12
	d.opacity = want and math.min(1, d.opacity + fade) or math.max(0, d.opacity - fade)

	-- Cursor shape with morph transition.
	if showing then
		local shape = detect_shape(d, ci)
		if shape ~= d.shape_b then
			if d.morph >= 0.5 then d.shape_a = d.shape_b end
			d.shape_b = shape
			d.morph = 0
		end
	end
	d.morph = d.morph_time > 0 and math.min(1, d.morph + dt / d.morph_time) or 1

	-- Click squish.
	local pressed = bit.band(user32.GetAsyncKeyState(0x01), 0x8000) ~= 0
	             or bit.band(user32.GetAsyncKeyState(0x02), 0x8000) ~= 0
	local click_target = pressed and d.click_scale or 1

	local n = math.max(1, math.ceil(dt / SUBSTEP))
	local h = dt / n
	local w, z = d.omega, d.zeta
	for i = 1, n do
		local f = i / n
		local tx = d.prev_rx + (rx - d.prev_rx) * f
		local ty = d.prev_ry + (ry - d.prev_ry) * f
		if w <= 0 then
			d.vx, d.vy = (tx - d.x) / h, (ty - d.y) / h
			d.x, d.y = tx, ty
		else
			local ax = w * w * (tx - d.x) - 2 * z * w * d.vx
			local ay = w * w * (ty - d.y) - 2 * z * w * d.vy
			d.vx, d.vy = d.vx + ax * h, d.vy + ay * h
			d.x, d.y = d.x + d.vx * h, d.y + d.vy * h
		end

		-- Underdamped spring so the release has a little bounce.
		local ca = 1600 * (click_target - d.click) - 36 * d.click_v
		d.click_v = d.click_v + ca * h
		d.click = d.click + d.click_v * h

		d.time = d.time + h
		hist_push(d, d.time, d.x, d.y)
	end
	d.prev_rx, d.prev_ry = rx, ry

	-- Lean into horizontal movement.
	local max_tilt = math.rad(30)
	local tilt_target = math.max(-max_tilt, math.min(max_tilt, d.vx / 1000 * d.tilt_amount))
	d.tilt = d.tilt + (tilt_target - d.tilt) * (1 - math.exp(-dt * 14))

	d.anim = d.anim + dt
end

---------------------------------------------------------------------------
-- Rendering
---------------------------------------------------------------------------

local function set_vec2(d, param, x, y)
	local v = d.v2
	v.x, v.y = x, y
	obs.gs_effect_set_vec2(param, v)
end

local function set_vec4(d, param, x, y, z, w)
	local v = d.v4
	v.x, v.y, v.z, v.w = x, y, z, w
	obs.gs_effect_set_vec4(param, v)
end

local function render(d)
	if d.effect == nil or d.opacity <= 0.002 or d.hn == 0 then return end

	local x2, y2 = d.x, d.y
	local x0, y0, xm, ym = x2, y2, x2, y2
	if d.shutter_s > 0 then
		x0, y0 = hist_at(d, d.time - d.shutter_s)
		xm, ym = hist_at(d, d.time - d.shutter_s * 0.5)
	end
	-- Quadratic Bezier through start, middle and end of the shutter interval.
	local x1 = 2 * xm - 0.5 * (x0 + x2)
	local y1 = 2 * ym - 0.5 * (y0 + y2)

	local len = math.sqrt((xm - x0) ^ 2 + (ym - y0) ^ 2) + math.sqrt((x2 - xm) ^ 2 + (y2 - ym) ^ 2)
	local samples = 1
	if len >= 0.5 then
		samples = math.max(2, math.min(d.max_samples, math.ceil(len)))
	end

	local scale = d.size * d.click
	local margin = (26 + d.outline_w + math.abs(d.shadow_x) + math.abs(d.shadow_y) + d.shadow_blur * 2) * scale + 2
	local bx0 = math.max(0, math.floor(math.min(x0, x1, x2) - margin))
	local by0 = math.max(0, math.floor(math.min(y0, y1, y2) - margin))
	local bx1 = math.min(d.region.w, math.ceil(math.max(x0, x1, x2) + margin))
	local by1 = math.min(d.region.h, math.ceil(math.max(y0, y1, y2) + margin))
	if bx1 <= bx0 or by1 <= by0 then return end

	local p = d.params
	set_vec2(d, p.box_origin, bx0, by0)
	set_vec2(d, p.box_size, bx1 - bx0, by1 - by0)
	set_vec2(d, p.p0, x0, y0)
	set_vec2(d, p.p1, x1, y1)
	set_vec2(d, p.p2, x2, y2)
	obs.gs_effect_set_float(p.sample_count, samples)
	obs.gs_effect_set_float(p.trail_falloff, d.trail_falloff)
	obs.gs_effect_set_float(p.cur_scale, scale)
	set_vec2(d, p.tilt_cs, math.cos(d.tilt), math.sin(d.tilt))
	obs.gs_effect_set_float(p.shape_a, d.shape_a)
	obs.gs_effect_set_float(p.shape_b, d.shape_b)
	local m = d.morph
	obs.gs_effect_set_float(p.morph, m * m * (3 - 2 * m))
	obs.gs_effect_set_float(p.anim_time, d.anim)
	set_vec4(d, p.fill_color, unpack_color(d.fill_color))
	set_vec4(d, p.outline_color, unpack_color(d.outline_color))
	set_vec4(d, p.shadow_color, unpack_color(d.shadow_color))
	obs.gs_effect_set_float(p.outline_width, d.outline_w)
	obs.gs_effect_set_float(p.shadow_blur, d.shadow_blur)
	set_vec2(d, p.shadow_offset, d.shadow_x, d.shadow_y)
	obs.gs_effect_set_float(p.opacity, d.opacity)

	while obs.gs_effect_loop(d.effect, "Draw") do
		obs.gs_matrix_push()
		obs.gs_matrix_translate3f(bx0, by0, 0)
		obs.gs_draw_sprite(nil, 0, bx1 - bx0, by1 - by0)
		obs.gs_matrix_pop()
	end
end

---------------------------------------------------------------------------
-- Source definition
---------------------------------------------------------------------------

local PARAM_NAMES = {
	"box_origin", "box_size", "p0", "p1", "p2", "sample_count", "trail_falloff",
	"cur_scale", "tilt_cs", "shape_a", "shape_b", "morph", "anim_time",
	"fill_color", "outline_color", "shadow_color", "outline_width",
	"shadow_blur", "shadow_offset", "opacity",
}

local function update(d, settings)
	d.region = resolve_region(settings)

	d.style = obs.obs_data_get_int(settings, "style")
	d.size = obs.obs_data_get_double(settings, "scale")

	local smoothing_ms = obs.obs_data_get_int(settings, "smoothing")
	d.omega = smoothing_ms > 0 and 4 / (math.max(smoothing_ms, 10) / 1000) or 0
	d.zeta = obs.obs_data_get_double(settings, "damping")

	local fps = 60
	local ovi = obs.obs_video_info()
	if obs.obs_get_video_info(ovi) and ovi.fps_den > 0 then
		fps = ovi.fps_num / ovi.fps_den
	end
	d.shutter_s = obs.obs_data_get_int(settings, "shutter") / 360 / fps
	d.trail_falloff = obs.obs_data_get_double(settings, "trail_falloff")
	d.max_samples = math.min(MAX_SHADER_SAMPLES, obs.obs_data_get_int(settings, "max_samples"))

	d.tilt_amount = math.rad(obs.obs_data_get_double(settings, "tilt"))
	d.click_scale = obs.obs_data_get_double(settings, "click_scale")
	d.idle_hide = obs.obs_data_get_double(settings, "idle_hide")
	d.morph_time = obs.obs_data_get_int(settings, "morph_time") / 1000

	d.fill_color = obs.obs_data_get_int(settings, "fill_color")
	d.outline_color = obs.obs_data_get_int(settings, "outline_color")
	d.shadow_color = obs.obs_data_get_int(settings, "shadow_color")
	d.outline_w = obs.obs_data_get_double(settings, "outline_width")
	d.shadow_blur = obs.obs_data_get_double(settings, "shadow_blur")
	d.shadow_x = obs.obs_data_get_double(settings, "shadow_x")
	d.shadow_y = obs.obs_data_get_double(settings, "shadow_y")
end

local function create(settings, source)
	local d = {
		source = source,
		ci = ffi.new("MBC_CURSORINFO"),
		cursors = load_cursor_handles(),
		ht = {}, hx = {}, hy = {}, hn = 0, hi = 0,
		x = 0, y = 0, vx = 0, vy = 0,
		prev_rx = 0, prev_ry = 0,
		time = 0, anim = 0, last_move = 0,
		opacity = 0, tilt = 0,
		click = 1, click_v = 0,
		shape_a = SHAPE_ARROW, shape_b = SHAPE_ARROW, morph = 1,
		v2 = obs.vec2(), v4 = obs.vec4(),
		params = {},
	}

	obs.obs_enter_graphics()
	d.effect = obs.gs_effect_create(EFFECT_SRC, "motion_blur_cursor.effect", nil)
	if d.effect ~= nil then
		for _, name in ipairs(PARAM_NAMES) do
			d.params[name] = obs.gs_effect_get_param_by_name(d.effect, name)
		end
	end
	obs.obs_leave_graphics()

	if d.effect == nil then
		obs.script_log(obs.LOG_ERROR, "Motion Blur Cursor: failed to compile effect")
	end

	update(d, settings)
	return d
end

local function destroy(d)
	if d.effect ~= nil then
		obs.obs_enter_graphics()
		obs.gs_effect_destroy(d.effect)
		obs.obs_leave_graphics()
		d.effect = nil
	end
end

local function get_defaults(settings)
	obs.obs_data_set_default_int(settings, "monitor", MONITOR_PRIMARY)
	obs.obs_data_set_default_int(settings, "custom_x", 0)
	obs.obs_data_set_default_int(settings, "custom_y", 0)
	obs.obs_data_set_default_int(settings, "custom_w", 1920)
	obs.obs_data_set_default_int(settings, "custom_h", 1080)

	obs.obs_data_set_default_int(settings, "style", SHAPE_AUTO)
	obs.obs_data_set_default_double(settings, "scale", 1.6)

	obs.obs_data_set_default_int(settings, "smoothing", 140)
	obs.obs_data_set_default_double(settings, "damping", 0.85)
	obs.obs_data_set_default_int(settings, "shutter", 270)
	obs.obs_data_set_default_double(settings, "trail_falloff", 0.6)
	obs.obs_data_set_default_int(settings, "max_samples", 64)
	obs.obs_data_set_default_double(settings, "tilt", 4)

	obs.obs_data_set_default_double(settings, "click_scale", 0.85)
	obs.obs_data_set_default_double(settings, "idle_hide", 0)
	obs.obs_data_set_default_int(settings, "morph_time", 140)

	obs.obs_data_set_default_int(settings, "fill_color", 0xFF000000)
	obs.obs_data_set_default_int(settings, "outline_color", 0xFFFFFFFF)
	obs.obs_data_set_default_int(settings, "shadow_color", 0x66000000)
	obs.obs_data_set_default_double(settings, "outline_width", 1.4)
	obs.obs_data_set_default_double(settings, "shadow_blur", 2.5)
	obs.obs_data_set_default_double(settings, "shadow_x", 0)
	obs.obs_data_set_default_double(settings, "shadow_y", 1.5)
end

local CUSTOM_KEYS = { "custom_x", "custom_y", "custom_w", "custom_h" }

local function on_monitor_changed(props, _, settings)
	local custom = obs.obs_data_get_int(settings, "monitor") == MONITOR_CUSTOM
	for _, key in ipairs(CUSTOM_KEYS) do
		obs.obs_property_set_visible(obs.obs_properties_get(props, key), custom)
	end
	return true
end

local function get_properties()
	local props = obs.obs_properties_create()

	-- Capture area
	local area = obs.obs_properties_create()
	local mon = obs.obs_properties_add_list(area, "monitor", "Monitor",
		obs.OBS_COMBO_TYPE_LIST, obs.OBS_COMBO_FORMAT_INT)
	obs.obs_property_list_add_int(mon, "Primary monitor", MONITOR_PRIMARY)
	for i, m in ipairs(enum_monitors()) do
		local label = string.format("Monitor %d: %dx%d at (%d, %d)%s",
			i, m.w, m.h, m.x, m.y, m.primary and " [primary]" or "")
		obs.obs_property_list_add_int(mon, label, i - 1)
	end
	obs.obs_property_list_add_int(mon, "Custom region", MONITOR_CUSTOM)
	obs.obs_property_set_modified_callback(mon, on_monitor_changed)
	obs.obs_properties_add_int(area, "custom_x", "Region X", -32768, 32768, 1)
	obs.obs_properties_add_int(area, "custom_y", "Region Y", -32768, 32768, 1)
	obs.obs_properties_add_int(area, "custom_w", "Region width", 1, 32768, 1)
	obs.obs_properties_add_int(area, "custom_h", "Region height", 1, 32768, 1)
	obs.obs_properties_add_group(props, "grp_area", "Capture area", obs.OBS_GROUP_NORMAL, area)

	-- Motion
	local motion = obs.obs_properties_create()
	obs.obs_properties_add_int_slider(motion, "smoothing", "Smoothing (ms, 0 = raw)", 0, 500, 5)
	obs.obs_properties_add_float_slider(motion, "damping", "Damping (1 = no overshoot)", 0.3, 1.5, 0.01)
	obs.obs_properties_add_int_slider(motion, "shutter", "Motion blur (shutter angle °)", 0, 720, 15)
	obs.obs_properties_add_float_slider(motion, "trail_falloff", "Trail falloff", 0, 1, 0.01)
	obs.obs_properties_add_int_slider(motion, "max_samples", "Blur quality (max samples)", 4, MAX_SHADER_SAMPLES, 1)
	obs.obs_properties_add_float_slider(motion, "tilt", "Tilt while moving (°)", 0, 20, 0.5)
	obs.obs_properties_add_float_slider(motion, "click_scale", "Click squish scale", 0.5, 1, 0.01)
	obs.obs_properties_add_group(props, "grp_motion", "Motion", obs.OBS_GROUP_NORMAL, motion)

	-- Appearance
	local look = obs.obs_properties_create()
	local style = obs.obs_properties_add_list(look, "style", "Cursor",
		obs.OBS_COMBO_TYPE_LIST, obs.OBS_COMBO_FORMAT_INT)
	obs.obs_property_list_add_int(style, "Auto (follow system cursor)", SHAPE_AUTO)
	obs.obs_property_list_add_int(style, "Arrow", SHAPE_ARROW)
	obs.obs_property_list_add_int(style, "Text", SHAPE_TEXT)
	obs.obs_property_list_add_int(style, "Wait", SHAPE_WAIT)
	obs.obs_property_list_add_int(style, "Hand", SHAPE_HAND)
	obs.obs_properties_add_float_slider(look, "scale", "Scale", 0.5, 6, 0.05)
	obs.obs_properties_add_color_alpha(look, "fill_color", "Fill colour")
	obs.obs_properties_add_color_alpha(look, "outline_color", "Outline colour")
	obs.obs_properties_add_float_slider(look, "outline_width", "Outline width", 0, 4, 0.1)
	obs.obs_properties_add_color_alpha(look, "shadow_color", "Shadow colour")
	obs.obs_properties_add_float_slider(look, "shadow_blur", "Shadow softness", 0, 10, 0.1)
	obs.obs_properties_add_float_slider(look, "shadow_x", "Shadow offset X", -10, 10, 0.1)
	obs.obs_properties_add_float_slider(look, "shadow_y", "Shadow offset Y", -10, 10, 0.1)
	obs.obs_properties_add_int_slider(look, "morph_time", "Shape morph time (ms)", 0, 500, 10)
	obs.obs_properties_add_float_slider(look, "idle_hide", "Hide when idle (s, 0 = never)", 0, 30, 0.5)
	obs.obs_properties_add_group(props, "grp_look", "Appearance", obs.OBS_GROUP_NORMAL, look)

	return props
end

local source_def = {
	id = SOURCE_ID,
	type = obs.OBS_SOURCE_TYPE_INPUT,
	output_flags = bit.bor(obs.OBS_SOURCE_VIDEO, obs.OBS_SOURCE_CUSTOM_DRAW),
	get_name = function() return "Motion Blur Cursor" end,
	create = create,
	destroy = destroy,
	update = update,
	get_defaults = get_defaults,
	get_properties = get_properties,
	get_width = function(d) return d.region.w end,
	get_height = function(d) return d.region.h end,
	video_tick = tick,
	video_render = render,
}

function script_description()
	return [[<h3>Motion Blur Cursor</h3>
<p>Adds a <b>Motion Blur Cursor</b> source: a vector cursor (arrow, text, wait, hand)
with spring-smoothed movement and real motion blur.</p>
<p>Put it above your Display Capture with the same position and size, and
turn off <i>Capture Cursor</i> on the Display Capture.</p>]]
end

function script_load()
	obs.obs_register_source(source_def)
end
