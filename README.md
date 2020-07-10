# OBS Studio Cursor skin
Selected source will  follow mouse pointer.
Using [`obs_sceneitem_set_pos`](https://obsproject.com/docs/reference-scenes.html#c.obs_sceneitem_set_pos) 
# Installation 
- Make sure your OBS Studio supports [scripting](https://obsproject.com/docs/scripting.html)
- Download [here](https://github.com/upgradeQ/OBS-Studio-Cursor-skin/releases/tag/0.2.0)
- You will need to install mouse package from [pypi](https://pypi.org/project/mouse/):  
`python -m pip install mouse`
# Usage
- Create _source_ with desired cursor(e.g Image source or Media source).
- In scripts select _that_ source name.
- Test it: press Start, press Stop, tweak refresh rate.
# Crop auto update
Shape of higlight , shape of zoom etc...
- Create 2 display captures.
- Create crop filter with this name: `cropXY`.
- Check relative.
- Set Width and Height to relatively small numbers e.g : 64x64 .
- Image mask blend + color correction might be an option too.
- Run script,select this source as cursor source , check Update crop, click start.

# Example cursors
They all have some level of transparency.
- yellow circle 
![img](https://i.imgur.com/ruzF9HN.png)
- red circle 
![img](https://i.imgur.com/8qoRU3i.png)
- spotlight circle
![img](https://i.imgur.com/XRvwuSf.png)
# Contribute
 [Forks](https://help.github.com/articles/fork-a-repo) are a great way to contribute to a repository.
After forking a repository, you can send the original author a [pull request](https://help.github.com/articles/using-pull-requests)
