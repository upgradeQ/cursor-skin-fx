import obspython as S  # studio
from contextlib import contextmanager, ExitStack
from types import SimpleNamespace as dot
from pynput.mouse import Controller  # python -m pip install pynput

__version__ = "2.0.0"
c = Controller()
get_position = lambda: c.position


@contextmanager
def source_auto_release(source_name):
    source = S.obs_get_source_by_name(source_name)
    try:
        yield source
    finally:
        S.obs_source_release(source)


@contextmanager
def data_ar(source_settings=None):
    if source_settings is not None:
        settings = S.obs_data_create()
    else:
        settings = S.obs_source_get_settings(source_settings)
    try:
        yield settings
    finally:
        S.obs_data_release(settings)


@contextmanager
def scene_from_source_ar(source):
    source = S.obs_scene_from_source(source)
    try:
        yield source
    finally:
        S.obs_scene_release(source)


def get_modifiers(key_modifiers):
    if key_modifiers:
        shift = key_modifiers.get("shift")
        control = key_modifiers.get("control")
        alt = key_modifiers.get("alt")
        command = key_modifiers.get("command")
    else:
        shift = control = alt = command = 0
    modifiers = 0

    if shift:
        modifiers |= S.INTERACT_SHIFT_KEY
    if control:
        modifiers |= S.INTERACT_CONTROL_KEY
    if alt:
        modifiers |= S.INTERACT_ALT_KEY
    if command:
        modifiers |= S.INTERACT_COMMAND_KEY
    return modifiers


def send_mouse_click_to_browser(
    source,
    x=0,
    y=0,
    button_type=S.MOUSE_LEFT,
    mouse_up=False,
    click_count=1,
    key_modifiers=None,
):
    event = S.obs_mouse_event()
    event.modifiers = get_modifiers(key_modifiers)
    event.x = x
    event.y = y
    S.obs_source_send_mouse_click(source, event, button_type, mouse_up, click_count)


def send_mouse_move_to_browser(
    source,
    x=0,
    y=0,
    key_modifiers=None,
):
    event = S.obs_mouse_event()
    event.modifiers = get_modifiers(key_modifiers)
    event.x = x
    event.y = y
    S.obs_source_send_mouse_move(source, event, False)  # do not leave


G = dot()

G.LMB = G.RMB = G.MOUSE_HOOKED = False


def HTK_1_CB(pressed):
    G.LMB = pressed


def HTK_2_CB(pressed):
    G.RMB = pressed


def hook_mouse_buttons():
    if G.MOUSE_HOOKED:
        raise RuntimeError("already hooked mouse")
    key_1 = '{"htk_1_mouse": [ { "key": "OBS_KEY_MOUSE1" } ], '
    key_2 = '"htk_2_mouse": [ { "key": "OBS_KEY_MOUSE2" } ]}'
    json_s = key_1 + key_2
    default_hotkeys = [
        dot(id="htk_1_mouse", des="LMB state", callback=HTK_1_CB),
        dot(id="htk_2_mouse", des="RMB state", callback=HTK_2_CB),
    ]
    settings = S.obs_data_create_from_json(json_s)
    for k in default_hotkeys:
        a = S.obs_data_get_array(settings, k.id)
        h = S.obs_hotkey_register_frontend(k.id, k.des, k.callback)
        S.obs_hotkey_load(h, a)
        S.obs_data_array_release(a)
    S.obs_data_release(settings)
    G.MOUSE_HOOKED = True


def apply_scale(x, y, width, height):
    width = round(width * x)
    height = round(height * y)
    return width, height


def lerp(minVal, maxVal, k):
    val = minVal + ((maxVal - minVal) * k)
    return val


class CursorAsSource:
    source_name = None
    target_name = None
    browser_source_name = None
    lock = True
    flag = True
    refresh_rate = 15
    width = 1920
    height = 1080
    is_update_browser = False

    def update_cursor_on_scene(self):
        ctx = ExitStack().enter_context
        source = ctx(source_auto_release(self.source_name))
        settings = ctx(data_ar())
        if source is not None:
            scene_width = S.obs_source_get_width(source)
            scene_height = S.obs_source_get_height(source)

            scene_source = S.obs_frontend_get_current_scene()
            scene = ctx(scene_from_source_ar(scene_source))
            scene_item = S.obs_scene_find_source_recursive(scene, self.source_name)
            target_item = S.obs_scene_find_source_recursive(scene, self.target_name)
            if scene_item:
                scale = S.vec2()
                S.obs_sceneitem_get_scale(scene_item, scale)
                scene_width, scene_height = apply_scale(
                    scale.x, scale.y, scene_width, scene_height
                )

                next_pos = S.vec2()
                next_pos.x, next_pos.y = get_position()
                next_pos.x -= self.offset_x
                next_pos.y -= self.offset_y
                ## TODO maybe make it able to use multiple monitors as well?
                ratio_x = next_pos.x / self.width
                ratio_y = next_pos.y / self.height

                target_scale = S.vec2()
                target = ctx(source_auto_release(self.target_name))
                S.obs_sceneitem_get_scale(target_item, target_scale)
                target_x = S.obs_source_get_width(target) * target_scale.x
                target_y = S.obs_source_get_height(target) * target_scale.y

                next_pos.x = lerp(0, target_x, ratio_x)
                next_pos.y = lerp(0, target_y, ratio_y)
                S.obs_sceneitem_set_pos(scene_item, next_pos)

    def update_cursor_inside_browser_source(self):
        with source_auto_release(self.browser_source_name) as source:
            send_mouse_move_to_browser(source, *get_position())

    def ticker(self):  # it is not a thread because obs might not close properly
        """how fast update.One callback at time with lock"""
        if self.lock:
            if self.is_update_browser:
                self.update_cursor_inside_browser_source()
                return
            self.update_cursor_on_scene()
        else:
            S.remove_current_callback()


py_cursor = CursorAsSource()
hook_mouse_buttons()
###############               ###############               ###############


def stop_pressed(props, prop):
    py_cursor.flag = True
    py_cursor.lock = False


def start_pressed(props, prop):
    if py_cursor.flag:
        S.timer_add(py_cursor.ticker, py_cursor.refresh_rate)
    py_cursor.lock = True
    py_cursor.flag = False  # to keep only one timer callback


def script_defaults(settings):
    S.obs_data_set_default_int(settings, "_refresh_rate", py_cursor.refresh_rate)
    S.obs_data_set_default_int(settings, "_width", py_cursor.width)
    S.obs_data_set_default_int(settings, "_height", py_cursor.height)


def script_update(settings):
    py_cursor.source_name = S.obs_data_get_string(settings, "source")
    py_cursor.target_name = S.obs_data_get_string(settings, "target")
    py_cursor.refresh_rate = S.obs_data_get_int(settings, "_refresh_rate")
    py_cursor.offset_x = S.obs_data_get_int(settings, "_offset_x")
    py_cursor.offset_y = S.obs_data_get_int(settings, "_offset_y")

    py_cursor.width = S.obs_data_get_int(settings, "_width")
    py_cursor.width = S.obs_data_get_int(settings, "_height")
    py_cursor.browser_source_name = S.obs_data_get_string(settings, "browser")
    py_cursor.is_update_browser = S.obs_data_get_bool(settings, "_is_update_browser")


def script_properties():
    props = S.obs_properties_create()
    number = S.obs_properties_add_int(
        props, "_refresh_rate", "Refresh rate (ms)", 15, 300, 5
    )
    ## i am only winging this so please forgive me
    S.obs_properties_add_int(props, "_offset_x", "Offset X", -5000, 5000, 1)
    S.obs_properties_add_int(props, "_offset_y", "Offset Y", -5000, 5000, 1)

    S.obs_properties_add_int(props, "_width", "base width", 1, 99999, 1)
    S.obs_properties_add_int(props, "_height", "base height", 1, 99999, 1)

    p1 = S.obs_properties_add_list(
        props,
        "source",
        "Select cursor source",
        S.OBS_COMBO_TYPE_EDITABLE,
        S.OBS_COMBO_FORMAT_STRING,
    )
    p2 = S.obs_properties_add_list(
        props,
        "target",
        "Select target window",
        S.OBS_COMBO_TYPE_EDITABLE,
        S.OBS_COMBO_FORMAT_STRING,
    )

    S.obs_properties_add_bool(props, "_is_update_browser", "Use browser source")
    p3 = S.obs_properties_add_list(
        props,
        "browser",
        "Select browser source",
        S.OBS_COMBO_TYPE_EDITABLE,
        S.OBS_COMBO_FORMAT_STRING,
    )

    sources = S.obs_enum_sources()
    if sources is not None:
        for source in sources:
            source_id = S.obs_source_get_unversioned_id(source)
            name = S.obs_source_get_name(source)
            S.obs_property_list_add_string(p1, name, name)
        for target in sources:
            source_id = S.obs_source_get_unversioned_id(target)
            name = S.obs_source_get_name(target)
            S.obs_property_list_add_string(p2, name, name)
        for b in sources:
            source_id = S.obs_source_get_unversioned_id(b)
            if source_id == "browser_source":
                name = S.obs_source_get_name(b)
                S.obs_property_list_add_string(p3, name, name)

        S.source_list_release(sources)
    S.obs_properties_add_button(props, "button", "Stop", stop_pressed)
    S.obs_properties_add_button(props, "button2", "Start", start_pressed)
    return props
