-- The few libobs graphics functions the host calls through FFI (obslua's
-- SWIG objects cannot be mixed with FFI pointers, so drawing goes this way).

local ffi = require("ffi")

ffi.cdef[[
typedef struct gs_texture gs_texture_t;
typedef struct gs_effect gs_effect_t;
typedef struct gs_effect_param gs_eparam_t;
int gs_get_device_type(void);
void *gs_get_device_obj(void);
gs_texture_t *gs_texture_create(uint32_t width, uint32_t height, int format, uint32_t levels,
                                const uint8_t **data, uint32_t flags);
void gs_texture_destroy(gs_texture_t *tex);
void *gs_texture_get_obj(gs_texture_t *tex);
gs_effect_t *obs_get_base_effect(int effect);
gs_eparam_t *gs_effect_get_param_by_name(const gs_effect_t *effect, const char *name);
void gs_effect_set_texture(gs_eparam_t *param, gs_texture_t *val);
void gs_effect_set_float(gs_eparam_t *param, float val);
bool gs_effect_loop(gs_effect_t *effect, const char *name);
void gs_draw_sprite(gs_texture_t *tex, uint32_t flip, uint32_t width, uint32_t height);
void gs_blend_state_push(void);
void gs_blend_state_pop(void);
void gs_enable_blending(bool enable);
void gs_blend_function_separate(int src_c, int dest_c, int src_a, int dest_a);
bool gs_framebuffer_srgb_enabled(void);
void gs_enable_framebuffer_srgb(bool enable);
int gs_get_color_space(void);
float obs_get_video_sdr_white_level(void);
]]

return ffi.load("obs")
