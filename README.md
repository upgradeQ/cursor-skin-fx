# cursor skin fx 
Those scripts adds a pack of various cursors for OBS Studio.
Written in LuaJIT 5.2 language version, heavily utilises FFI, currently Windows only.

## Installation 
- Move files to some permanent location, select and add .lua files to OBS Studio (Tools > Scripts)
- You will see new entries in the context menu of sources.

## Demo

- On click shader  - show up to 7 clicks at the same time.

- Motion blur cursor - A new source, adds 360fps like motion blur cursor. Locked to 60fps, requires Admin or running OBS on second monitor/not minimized!

- Raster particles - A new source with 10k stateful unsorted particles, originally developed for a max 2560x1440 resolution, but works on 16:9. 

- Ribbon trail - Adds a simple trail so you can track your cursor. Use additive blending with that source!

# Limitations
- Multiple monitors setup currently not working.

# On the Roadmap
- Currently the program lacks a way to get the cursor texture(includes cursor wait, text, states)

# Developing 

Run ~some/path/stylua.exe src/ from current directory. Amalgamate separate Lua files into one for easier distribution.

# Spread the Word

Mention your usage of the program, share reviews, or post about the project on Reddit, X, and other social media.