import obspython as obs
from pynput.mouse import Controller  # python -m pip install pynput

c = Controller()
get_position = lambda: c.position


__version__ = "1.0.0"


def apply_scale(x, y, width, height):
    width = round(width * x)
    height = round(height * y)
    return width, height

def lerp(minVal, maxVal, k):
    val = minVal + ((maxVal - minVal)*k)
    return val

class CursorAsSource:
    source_name = None
    lock = True
    flag = True
    refresh_rate = 15

    def update_cursor(self):
        source = obs.obs_get_source_by_name(self.source_name)
        settings = obs.obs_data_create()
        if source is not None:
            scene_source = obs.obs_frontend_get_current_scene()
            scene_width = obs.obs_source_get_width(source)
            scene_height = obs.obs_source_get_height(source)
            scene = obs.obs_scene_from_source(scene_source)
            scene_item = obs.obs_scene_find_source(scene, self.source_name)
            target_item = obs.obs_scene_find_source(scene, self.target_name)
            if scene_item:
                scale = obs.vec2()
                obs.obs_sceneitem_get_scale(scene_item, scale)
                scene_width, scene_height = apply_scale(
                    scale.x, scale.y, scene_width, scene_height
                )
                
                next_pos = obs.vec2()
                next_pos.x, next_pos.y = get_position()
                next_pos.x -= self.offset_x
                next_pos.y -= self.offset_y
                ## base: 1920*1080, i should add something to make this automatically change based on the Desktop Capture used
                ## maybe make it able to use multiple monitors as well?
                ratio_x = next_pos.x/1920
                ratio_y = next_pos.y/1080
                
                target_scale = obs.vec2()
                target = obs.obs_get_source_by_name(self.target_name)
                obs.obs_sceneitem_get_scale(target_item, target_scale)
                target_x = obs.obs_source_get_width(target) * target_scale.x 
                target_y = obs.obs_source_get_height(target) * target_scale.y
                
                next_pos.x = lerp(0, target_x, ratio_x)
                next_pos.y = lerp(0, target_y, ratio_y)
                obs.obs_sceneitem_set_pos(scene_item, next_pos)

            obs.obs_data_release(settings)
            obs.obs_scene_release(scene)
            obs.obs_source_release(source)

    def update_crop(self):
        """
        Create 2 display captures.
        Create crop filter with this name: cropXY.
        Check relative.
        Set Width and Height to relatively small numbers e.g : 64x64 .
        Image mask blend + color correction might be an option too.
        Run script,select this source as cursor source , check Update crop, click start.
        """
        source = obs.obs_get_source_by_name(self.source_name)
        crop = obs.obs_source_get_filter_by_name(source, "cropXY")
        filter_settings = obs.obs_source_get_settings(crop)

        _x, _y = get_position()
        # https://github.com/obsproject/obs-studio/blob/79981889c6d87d6e371e9dc8fcaad36f06eb9c9e/plugins/obs-filters/crop-filter.c#L87-L93
        w = obs.obs_data_get_int(filter_settings, "cx")
        h = obs.obs_data_get_int(filter_settings, "cy")
        h, w = int(h / 2), int(w / 2)
        obs.obs_data_set_int(filter_settings, "left", _x - h)
        obs.obs_data_set_int(filter_settings, "top", _y - w)

        obs.obs_source_update(crop, filter_settings)

        obs.obs_data_release(filter_settings)
        obs.obs_source_release(source)
        obs.obs_source_release(crop)

    def ticker(self):
        """ how fast update.One callback at time with lock"""
        if self.lock:
            if self.update_xy:
                self.update_crop()
                self.update_cursor()
            else:
                self.update_cursor()

        if not self.lock:
            obs.remove_current_callback()


py_cursor = CursorAsSource()


def stop_pressed(props, prop):
    py_cursor.flag = True
    py_cursor.lock = False


def start_pressed(props, prop):
    if py_cursor.source_name != "" and py_cursor.flag:
        obs.timer_add(py_cursor.ticker, py_cursor.refresh_rate)
    py_cursor.lock = True
    py_cursor.flag = False  # to keep only one timer callback


def script_defaults(settings):
    obs.obs_data_set_default_int(settings, "_refresh_rate", py_cursor.refresh_rate)


def script_update(settings):
    py_cursor.update_xy = obs.obs_data_get_bool(settings, "bool_yn")
    py_cursor.source_name = obs.obs_data_get_string(settings, "source")
    py_cursor.target_name = obs.obs_data_get_string(settings, "target")
    py_cursor.refresh_rate = obs.obs_data_get_int(settings, "_refresh_rate")
    py_cursor.offset_x = obs.obs_data_get_int(settings, "_offset_x")
    py_cursor.offset_y = obs.obs_data_get_int(settings, "_offset_y")


def script_properties():
    props = obs.obs_properties_create()
    number = obs.obs_properties_add_int(
        props, "_refresh_rate", "Refresh rate (ms)", 15, 300, 5
    )
    ## i am only winging this so please forgive me
    offsetx = obs.obs_properties_add_int(
        props, "_offset_x", "Offset X", -5000, 5000, 1
    )
    offsety = obs.obs_properties_add_int(
        props, "_offset_y", "Offset Y", -5000, 5000, 1
    )
    
    p1 = obs.obs_properties_add_list(
        props,
        "source",
        "Select cursor source",
        obs.OBS_COMBO_TYPE_EDITABLE,
        obs.OBS_COMBO_FORMAT_STRING,
    )
    p2 = obs.obs_properties_add_list(
        props,
        "target",
        "Select target window",
        obs.OBS_COMBO_TYPE_EDITABLE,
        obs.OBS_COMBO_FORMAT_STRING,
    )
    sources = obs.obs_enum_sources()
    if sources is not None:
        ## property 1 for image source
        for source in sources:
            source_id = obs.obs_source_get_unversioned_id(source)
            name = obs.obs_source_get_name(source)
            obs.obs_property_list_add_string(p1, name, name)
        ## property 2 for target window    
        for target in sources:
            source_id = obs.obs_source_get_unversioned_id(target)
            name = obs.obs_source_get_name(target)
            obs.obs_property_list_add_string(p2, name, name)
            
        obs.source_list_release(sources)
    obs.obs_properties_add_button(props, "button", "Stop", stop_pressed)
    obs.obs_properties_add_button(props, "button2", "Start", start_pressed)
    obs.obs_properties_add_bool(props, "bool_yn", "Update crop")
    return props
