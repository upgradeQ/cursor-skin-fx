# cursor skin fx 

A collection of visual effects and custom cursors to make your mouse stand out during streams or recordings. 

Built with LuaJIT 5.2 and FFI for high performance. Currently supports **Windows only**.

## Installation 

- Move the files to a permanent location, then select and add the `.lua` files to OBS Studio (**Tools** > **Scripts**).
- New entries will appear in the context menu of your sources.

## Demo

https://github.com/user-attachments/assets/cc13334b-783d-430e-888b-0aacb5e83b38

- **On-click shader** - Shows up to 7 clicks simultaneously.
- **Motion blur cursor** - A new source that adds 360fps-like motion blur to the cursor. Locked to 60fps; requires Admin rights or running OBS on a second monitor (must not be minimized).
- **Raster particles** - A new source with 10k stateful unsorted particles. Originally developed for 2560x1440, but works on any 16:9 resolution. 
- **Ribbon trail** - Adds a simple trail to help track your cursor. Use **additive blending** with this source!

## Limitations

- Multi-monitor setups are currently not supported.

## Roadmap

- Implement a way to capture the cursor texture (including wait, text, and other states).

## Development

Run `~some/path/stylua.exe src/` from the current directory. Amalgamate separate Lua files into one for easier distribution.

## Spread the Word

Mention your usage of the program, share reviews, or post about the project on Reddit, X, and other social media.
