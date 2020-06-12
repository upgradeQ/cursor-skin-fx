import obspython as obs
from mouse import get_position  # python -m pip install mouse

__version__ = "0.1.0"
REFRESH_RATE = 150
FLAG = True


def get_scene_item_pos(scene_item):
    """source: https://github.com/insin/obs-bounce (lua script)"""
    pos = obs.vec2()
    obs.obs_sceneitem_get_pos(scene_item, pos)
    return pos


class CursorAsSource:
    def __init__(self, source_name=None):
        self.source_name = source_name
        self.lock = True

    def update_cursor(self):
        source = obs.obs_get_source_by_name(self.source_name)
        settings = obs.obs_data_create()
        if source is not None:
            scene_source = obs.obs_frontend_get_current_scene()
            scene_width = obs.obs_source_get_width(source)
            scene_height = obs.obs_source_get_height(source)
            scene = obs.obs_scene_from_source(scene_source)
            scene_item = obs.obs_scene_find_source(scene, self.source_name)
            if scene_item:
                original_pos = get_scene_item_pos(scene_item)
                next_pos = obs.vec2()
                next_pos.x, next_pos.y = get_position()
                next_pos.x -= scene_width / 2
                next_pos.y -= scene_height / 2
                # get new position and set it to center of source where cursor is
                obs.obs_sceneitem_set_pos(scene_item, next_pos)
            obs.obs_scene_release(scene)
            obs.obs_source_release(source)

    def ticker(self):
        """ how fast update.One callback at time with lock"""
        if self.lock:
            self.update_cursor()
        if not self.lock:
            obs.remove_current_callback()


py_cursor = CursorAsSource()  # class created ,obs part starts


def stop_pressed(props, prop):
    global FLAG
    FLAG = True
    py_cursor.lock = False


def start_pressed(props, prop):
    global FLAG #to keep only one timer callback
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
    py_cursor.source_name = obs.obs_data_get_string(settings, "source")
    REFRESH_RATE = obs.obs_data_get_int(settings, "refresh_rate")


def script_properties():  # ui
    props = obs.obs_properties_create()
    number = obs.obs_properties_add_int(
        props, "refresh_rate", "How fast update", 15, 999, 15
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
    return props
