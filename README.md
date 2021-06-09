# OBS Studio Cursor skin
Selected source will  follow mouse pointer.
Using [`obs_sceneitem_set_pos`](https://obsproject.com/docs/reference-scenes.html#c.obs_sceneitem_set_pos) 
# Installation 
- Make sure your OBS Studio supports [scripting](https://obsproject.com/docs/scripting.html)
- Install pynput package from [pypi](https://pypi.org/project/pynput/) 
`python -m pip install pynput`
# Limitations
- Multiple monitors setup will not work .
- If used in fullscreen apps, offset will appear.
# Usage
- Create a _source_ with desired cursor(e.g Image source or Media source).
- In scripts select _that_ source name.
- Make a group, add Display Capture, Window Capture

![img](https://i.imgur.com/CHuLwmp.png)

- To crop, crop the _group_, the size should still have the same ratio as your monitor even if you scale it
- To set offset, adjust it at Scripts (use Tab/Shift+tab to navigate). You have to do this every time you change the scale
- Test it: press Start, press Stop, tweak refresh rate.
# Crop auto update
Zoom or higlight.
- Create 2 display captures.
- Create crop filter with this name: `cropXY`.
- Check relative.
- Set Width and Height to relatively small numbers e.g : 64x64 .
- Image mask blend + color correction might be an option too.
- Run script,select this source as cursor source , check Update crop, click start.

# Zoom
> Have you ever needed to zoom in on your screen to show some fine detail work,
> or to make your large 4k/ultrawide monitor less daunting?
> Zoom and Follow for OBS Studio does exactly that, zooms in on your mouse and follows it around.
> Configurable and low-impact, you can now do old school Camtasia zoom ins live

See: [Zoom and Follow](https://obsproject.com/forum/resources/zoom-and-follow.1051/) , [source code ](https://github.com/tryptech/obs-zoom-and-follow)

# Example cursors
They all have some level of transparency.
- yellow circle 
![img](https://i.imgur.com/ruzF9HN.png)
- red circle 
![img](https://i.imgur.com/8qoRU3i.png)
- green circle
![Imgur](https://i.imgur.com/s3jvZP5.png) 
# Contribute
 [Forks](https://help.github.com/articles/fork-a-repo) are a great way to contribute to a repository.
After forking a repository, you can send the original author a [pull request](https://help.github.com/articles/using-pull-requests)
