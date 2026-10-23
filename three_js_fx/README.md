# browser_cursor

An OBS Studio Lua script (Windows) that sends your mouse into a **Browser
source**, plus eight transparent cursor-effect pages built with vanilla JS
and three.js (WebGL). The browser source
sits on top of a Display Capture; the page draws a themed cursor and effects
exactly where your real mouse is.

| Page | What it does |
| --- | --- |
| `pages/frost` — **Frost** | A cut-ice cursor. Hoarfrost crystals grow along the path and sublimate into powder snow. Clicks fire a snowflake shockwave with ice shards, holding spreads a frost ring, and right click starts a blizzard vortex. |
| `pages/bubbles` — **Bubbles** | A glossy aqua gel cursor that sheds soap bubbles, simulated with buoyancy, drift and cursor pushes, and shaded with swirling thin-film colour and a sky reflection. Fast flicks spray fizz, clicks pop nearby bubbles, holding inflates a big bubble from a wand that floats off on release, and right click pulls bubbles into a vortex. |
| `pages/aquarium` — **Aquarium** | A clear cursor filled with sloshing water, followed by a procedurally animated goldfish. Motion leaves a glassy ripple wake from a GPU height-field simulation and fast flicks fling droplets. Clicks splash and startle the fish, holding grows a water globe the fish swims into that bursts on release, and right click sends out a school of fish. |
| `pages/eden` — **Eden** | A glass cursor that is a window onto a green hill under a blue sky, trailing a Vista-style aurora ribbon with sparkles and leaves. Clicks fire a sun flare and a ring of petals, holding grows a ray-traced glass orb with a tree on a hill inside that floats away on release, and right click fans out a sunburst. |
| `pages/pixel` — **Arcade** | Low-res pixel art in a strict palette with dithered fades. Shows afterimages, a dash trail on fast flicks, 8-bit explosions with `+100` popups and combos, a charge-up shot on hold and fireworks on right click. |
| `pages/voltage` — **Voltage** | The cursor is a live conductor: a dark body outlined by a jittering white-hot filament with arcs crawling over it. Motion leaves an ionised trail that tears off side arcs on fast flicks. Clicks call forked lightning down from the top of the screen, holding charges a plasma globe that discharges in every direction on release, and right click strings chain lightning between five nodes around the cursor. |
| `pages/ferrofluid` — **Ferrofluid** | Raymarched black liquid metal that follows the cursor. Droplets break off on fast flicks and merge back, clicks raise magnetic spikes, and right click splits the blob into orbiting droplets. Only the area around the blob is shaded. |
| `pages/bloom` — **Bloom** | A puffy pink pearl jewel with glitter in its finish and a light sweep across it, orbited by two gold stars and dripping glitter. Motion draws a colour-cycling ribbon of light and sheds clouds of glitter that flare into sparkles as they catch the light, with bokeh, sakura petals and leaves; fast moves pop blossoms open along the path and whip-fast flicks throw gold stars and gem hearts. Clicks burst into blossoms, petals and gem hearts with shockwaves and a lens flare (a heart fountain over links), and quick combos grow the bursts and rain petals from the top of the page. Holding grows a rose inside a glitter vortex that blows apart on release, and right click calls a swirl of butterflies that scatter when let go. Models, matcaps and textures are made in Blender (`pages/bloom/assets`). |

Every page draws its own cursor (arrow, link hand, text I-beam, busy) and morphs
between shapes as the Windows cursor changes. The cursor fades out when it is hidden
or leaves the monitor. Everything works over both light and dark content.

## Setup

1. In OBS: **Tools → Scripts → +** and pick `browser_cursor.lua`.
2. Add a **Browser** source above your **Display Capture** (any URL for now).
3. In the Display Capture properties, **uncheck "Capture Cursor"**. The page
   draws the cursor.
4. In the script settings:
   - **Browser source**: pick the source from step 2 (*Refresh source list* if
     you just created it).
   - **Captured monitor**: the monitor your Display Capture shows.
   - **Page**: pick one, then click **Load page into browser source**. This
     points the source at the page and sizes it to the monitor.
5. Give the browser source the same transform as the Display Capture
   (right-click the capture → *Transform → Copy Transform*, then right-click the
   browser source → *Transform → Paste Transform*).

The page background stays fully transparent; only the cursor and its effects
are drawn.

## What the script sends

Every frame the mouse changes (and at least every 0.5 s) the script dispatches
an `obs-cursor` event on the page's `window`:

```js
window.addEventListener('obs-cursor', (e) => {
	const { x, y, nx, ny, buttons, cursor, visible, t } = e.detail;
});
```

| Field | Meaning |
| --- | --- |
| `x`, `y` | Position in source pixels (the monitor mapped onto the source's width/height) |
| `nx`, `ny` | Position normalised to the captured monitor, 0..1 |
| `buttons` | Bitmask like `MouseEvent.buttons`: 1 left, 2 right, 4 middle, 8 back, 16 forward |
| `cursor` | CSS keyword of the system cursor: `default`, `pointer`, `text`, `wait`, `progress`, `crosshair`, `move`, `help`, `not-allowed`, `ew-resize`, `ns-resize`, `nwse-resize`, `nesw-resize` |
| `visible` | `false` while the cursor is hidden (for over 150 ms, since some apps clear it every frame) or off the captured monitor |
| `t` | OBS clock in milliseconds |

`shared/cursor-feed.js` wraps this for the pages: velocity, press/hold timing,
history for trails, `down`/`up`/`shape`/`show`/`hide` events, a pointer-event
fallback outside OBS and a scripted autopilot (`?demo`).

## Viewing the pages in a browser

ES modules don't load from `file://`, so serve the folder:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/> for the showreel (autopilot cycles through
the pages; **Live mouse** or `L` lets you drive them yourself; `1`–`8` switch).
Individual pages work too: `pages/<name>/index.html`, with `?demo` for the
autopilot and `?bg=0` to drop the mock desktop behind the effect.

## Adding a page

Create `pages/<name>/index.html` with a `<title>Name — tagline</title>`; the
script lists every folder under `pages/` that has an `index.html` (folders
starting with `_` are skipped). Use `shared/cursor-feed.js` and
`shared/preview.js` and `shared/stage.js` (copy the importmap from another
page). Pages drawn entirely in their own shaders can build on
`shared/gl-layers.js`: premultiplied materials, instanced layers and the
signed-distance atlas of every cursor silhouette from `shared/cursor-sdf.js`.

## Notes

- Requires OBS Studio 30 or newer (tested with 33). Windows only: the mouse is
  read through `user32` via LuaJIT FFI.
- One browser source at a time. The mouse wheel is not sent (it can't be polled
  without a system hook).
- Nothing is sent while the browser source isn't shown anywhere (program,
  preview or a projector).
- The monitor is remembered by its device name and re-read when the display
  layout or resolution changes. A cursor hidden by a game or video player is
  reported as hidden.
- three.js r186 is vendored in `vendor/three` (`build/`); the bloom page carries
  its glTF loader in `pages/bloom/three`.
- The pages need OBS's browser source hardware acceleration (on by default:
  **Settings → Advanced → Sources**).
- Editing the script while OBS is running? Click the reload button in
  **Tools → Scripts**.
