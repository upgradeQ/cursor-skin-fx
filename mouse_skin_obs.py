import obspython as obs
from mouse import get_position  # python -m pip install mouse

__version__ = "0.3.0-alpha"
REFRESH_RATE = 15
FLAG = True


def apply_scale(x, y, width, height):
    width = round(width * x)
    height = round(height * y)
    return width, height


class CursorAsSource:
    def __init__(self, source_name=None):
        self.source_name = source_name
        self.lock = True
        self.update_xy = False
        self.update_gs = False  # green screen
        self.update_cr = False

    def update_cursor(self):
        """ in script settings check update cursor"""

        source = obs.obs_get_source_by_name(self.source_name)
        settings = obs.obs_data_create()
        if source is not None:
            scene_source = obs.obs_frontend_get_current_scene()
            scene_width = obs.obs_source_get_width(source)
            scene_height = obs.obs_source_get_height(source)
            scene = obs.obs_scene_from_source(scene_source)
            scene_item = obs.obs_scene_find_source(scene, self.source_name)
            if scene_item:
                scale = obs.vec2()
                obs.obs_sceneitem_get_scale(scene_item, scale)
                scene_width, scene_height = apply_scale(
                    scale.x, scale.y, scene_width, scene_height
                )
                next_pos = obs.vec2()
                next_pos.x, next_pos.y = get_position()
                next_pos.x -= scene_width / 2
                next_pos.y -= scene_height / 2
                # set position to center of source where cursor is
                obs.obs_sceneitem_set_pos(scene_item, next_pos)

            obs.obs_data_release(settings)
            obs.obs_scene_release(scene)
            obs.obs_source_release(source)

    def update_green(self):
        """
        create new scene with name:__spotlight__
        add color source , add opacity(color correction) to that source
        add green circle 
        add that scene as source to ur current scene 
        apply chromakey filter to that source 
        in script settings check update green
        """
        source = obs.obs_get_source_by_name(self.source_name)
        settings = obs.obs_data_create()
        if source is not None:
            scene_width = obs.obs_source_get_width(source)
            scene_height = obs.obs_source_get_height(source)
            # get all scenes
            scenes = obs.obs_frontend_get_scenes()
            for sc in scenes:
                # select the one with chromakey cursor(green)
                name = obs.obs_source_get_name(sc)
                if name == "__spotlight__":
                    # assign it
                    _item = sc
                else:
                    obs.obs_source_release(sc)

            scene = obs.obs_scene_from_source(_item)
            scene_item = obs.obs_scene_find_source(scene, self.source_name)
            if scene_item:
                scale = obs.vec2()
                obs.obs_sceneitem_get_scale(scene_item, scale)
                scene_width, scene_height = apply_scale(
                    scale.x, scale.y, scene_width, scene_height
                )
                next_pos = obs.vec2()
                next_pos.x, next_pos.y = get_position()
                next_pos.x -= scene_width / 2
                next_pos.y -= scene_height / 2
                # set position to center of source where cursor is
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
        Run script,select this source as cursor source , check Update crop and updated cursor, click start.
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
            if self.update_gs:
                self.update_green()
            if self.update_cr:
                self.update_cursor()

        if not self.lock:
            obs.remove_current_callback()


py_cursor = CursorAsSource()  # class created ,obs part starts


def stop_pressed(props, prop):
    global FLAG
    FLAG = True
    py_cursor.lock = False


def start_pressed(props, prop):
    global FLAG  # to keep only one timer callback
    if py_cursor.source_name != "" and FLAG:
        obs.timer_add(py_cursor.ticker, REFRESH_RATE)
    py_cursor.lock = True
    FLAG = False


def script_description():
    return "USE SOURCE AS CURSOR"


def script_defaults(settings):
    global REFRESH_RATE
    obs.obs_data_set_default_int(settings, "refresh_rate", REFRESH_RATE)


def script_update(settings):
    global REFRESH_RATE
    py_cursor.update_xy = obs.obs_data_get_bool(settings, "bool_yn")
    py_cursor.update_xy = obs.obs_data_get_bool(settings, "bool_yn_cursor")
    py_cursor.update_gs = obs.obs_data_get_bool(settings, "bool_yn_green")
    py_cursor.source_name = obs.obs_data_get_string(settings, "source")
    REFRESH_RATE = obs.obs_data_get_int(settings, "refresh_rate")


def script_properties():  # ui
    props = obs.obs_properties_create()
    number = obs.obs_properties_add_int(
        props, "refresh_rate", "Refresh rate (ms)", 15, 300, 5
    )
    p = obs.obs_properties_add_list(
        props,
        "source",
        "Select cursor source",
        obs.OBS_COMBO_TYPE_EDITABLE,
        obs.OBS_COMBO_FORMAT_STRING,
    )
    sources = obs.obs_enum_sources()
    if sources is not None:
        for source in sources:
            source_id = obs.obs_source_get_unversioned_id(source)
            name = obs.obs_source_get_name(source)
            obs.obs_property_list_add_string(p, name, name)
        obs.source_list_release(sources)
    obs.obs_properties_add_button(props, "button", "Stop", stop_pressed)
    obs.obs_properties_add_button(props, "button2", "Start", start_pressed)
    obs.obs_properties_add_bool(props, "bool_yn", "Update crop")
    obs.obs_properties_add_bool(props, "bool_yn_green", "Update green circle")
    obs.obs_properties_add_bool(props, "bool_yn_cursor", "Update cursro ")
    return props
