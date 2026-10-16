# motion_blur_cursor_script

An OBS Studio Lua script (Windows) that adds a **Motion Blur Cursor** source: a
vector cursor that follows your mouse with smooth, spring-based movement and
real motion blur, like the cursor in polished product launch videos.

## Features

- **Motion blur along the actual path.** Each frame, the shader integrates the
  cursor over the curve it travelled during the shutter interval, so quick
  arcs blur along the arc instead of a straight line.
- **Spring smoothing.** Shaky hand movement becomes smooth glides, with
  optional slight overshoot.
- **Shader-drawn cursors** (signed distance fields): arrow, text I-beam, and an
  animated wait spinner. They stay sharp at any scale.
- **Auto shape detection.** The cursor follows the Windows cursor (arrow / text
  / busy) and morphs smoothly between shapes.
- Tilt in the direction of movement, a squish on click, a soft drop shadow,
  custom colours, and an optional hide-when-idle.

## Setup

1. In OBS: **Tools → Scripts → +** and pick `motion_blur_cursor.lua`.
2. In your scene, add a **Motion Blur Cursor** source above your
   **Display Capture**.
3. In the Display Capture properties, **uncheck "Capture Cursor"**.
4. Give the cursor source the same transform as the Display Capture
   (right-click the Display Capture → *Transform → Copy Transform*, then
   right-click the cursor → *Transform → Paste Transform*).
5. In the cursor source properties, choose the same monitor as the capture.

The source is the size of the chosen monitor (in physical pixels), so the
cursor lines up as long as both sources share the same transform.

## Settings

| Setting | What it does |
| --- | --- |
| Monitor / Custom region | Which screen area the source maps to |
| Smoothing (ms) | Spring response time; 0 = raw cursor position |
| Damping | 1 = no overshoot; lower values add a bit of bounce |
| Motion blur (shutter angle °) | 180° is natural film blur, 360°+ is exaggerated; 0 turns blur off |
| Trail falloff | 0 = even smear, 1 = the trail fades out behind the cursor |
| Blur quality | Maximum samples per pixel on very fast moves |
| Tilt while moving | Lean angle per 1000 px/s of horizontal speed |
| Click squish scale | Size while a mouse button is held |
| Cursor | Auto, or force Arrow / Text / Wait |
| Scale, colours, outline, shadow | Look of the cursor |
| Shape morph time | Duration of the transition between shapes |
| Hide when idle | Fade the cursor out after N seconds without movement |

## Notes

- Requires OBS Studio 28 or newer.
- Windows only: it reads the cursor through `user32` via LuaJIT FFI.
- Hand, resize and other system cursors are drawn as the arrow.
- The cursor fades out when it leaves the selected monitor or when an app hides
  the system cursor.
- Editing the script while OBS is running? Click the reload button in
  **Tools → Scripts** to apply the changes.
