# OBS Studio Cursor skin
Selected source will  follow mouse pointer.
Using [`obs_sceneitem_set_pos`](https://obsproject.com/docs/reference-scenes.html#c.obs_sceneitem_set_pos) 
# Installation 
- Install pynput package from [pypi](https://pypi.org/project/pynput/) 
- Make sure your OBS Studio supports [scripting](https://obsproject.com/docs/scripting.html)
`python -m pip install pynput`
- `cursor_shader.lua` - Standalone shader based Windows only 3D cursor skin.
# Limitations
- Multiple monitors setup currently not working .
- If used in fullscreen apps, offset might appear.
# Usage
- Create a _source_ with desired cursor(e.g Image source or Media source).
- In scripts select _that_ source name.
- To center source (scene item ) go to:  Transform > Edit Transform > Positional Alignment > Center

## Advanced usage
- Make a group, add Display Capture, Window Capture.

![img](https://i.imgur.com/CHuLwmp.png)

- To crop, crop the _group_, the size should still have the same ratio as your monitor even if you scale it
- To set offset/calibrate, use the Display Capture to see mouse and adjust it at Scripts (or use Tab/Shift+tab to navigate, if in Window Capture, to not move mouse). You have to do this every time you change the Group scale/move it

![img](https://user-images.githubusercontent.com/66927691/121442471-56133280-c9be-11eb-9bb4-ad12b2e4ebfb.jpg)

![img](https://user-images.githubusercontent.com/66927691/121442809-f23d3980-c9be-11eb-954f-c0e635e95d88.jpg)


- Test it: press Start, press Stop, tweak refresh rate.

# Web rendered mouse cursor trails
- Add browser source with mouse tracking local or online web page.
- Make sure to set resolution as your monitor (base)
- Fill all entries, check `Use browser source`

# Zoom
> Have you ever needed to zoom in on your screen to show some fine detail work,
> or to make your large 4k/ultrawide monitor less daunting?
> Zoom and Follow for OBS Studio does exactly that, zooms in on your mouse and follows it around.
> Configurable and low-impact, you can now do old school zoom ins live

See: [Zoom and Follow](https://obsproject.com/forum/resources/zoom-and-follow.1051/) , [source code ](https://github.com/tryptech/obs-zoom-and-follow)

# Example cursors
They all have some level of transparency.
- yellow circle 
![img](https://i.imgur.com/ruzF9HN.png)
- red circle 
![img](https://i.imgur.com/8qoRU3i.png)
- green circle
![Imgur](https://i.imgur.com/s3jvZP5.png) 

# On the Roadmap
- Lua based shaders rendering (trails, new shaders)
- GNU/Linux support (porting HLSL shaders)
- [`Multi monitors setup`](https://github.com/upgradeQ/OBS-Studio-Cursor-skin/issues/9)

# Acknowledgments
- [`3_4_700`](https://github.com/34700) - added offsets functionality for precise custom cursor(like a hand drawn arm holding a pen for artists)
- [`tholman/cursor-effects`](https://github.com/tholman/cursor-effects) - stock cursor trails
- [`inspirnathan`](https://github.com/inspirnathan) - SDF shaders implementation tutorial [series](https://inspirnathan.com/posts/53-shadertoy-tutorial-part-7/)

# Contribute
You are welcome to contribute. Help is needed.
## Developing
There are roadmap items to choose, you are also free to suggest ideas to add and implement. There are forums and GitHub Issues check them out for suggestions or bug reports.
 [Forks](https://help.github.com/articles/fork-a-repo) are a great way to contribute to a repository.
After forking a repository, you can send the original author a [pull request](https://help.github.com/articles/using-pull-requests)
## Marketing 
Write articles, reviews or tell your friends about it. The more users we have, the more people we have testing and the better we can become.
## Design 
Come up with some new good skins or interactive web skins, Lua shaders, and add them.
## Voting
In order to improve this scripting functionality and integrate it into OBS Studio, you are encouraged to vote for this feature:
https://ideas.obsproject.com/posts/71/option-to-highlight-mouse-cursor-and-mouse-clicks
Currently the program lacks a way to get the position of the cursor in the texture(includes cursor wait, text, states) and is not available in the OBS Studio shader language. 
