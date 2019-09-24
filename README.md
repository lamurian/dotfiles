# Rice and stuffs

Realizing I spent most of my time working on terminal, I made several
customizations to suit my workflow. In this repository, I keep a backup for all
configurations needed to replicate my current workflow in a new system. I'm
aware github repository may not the appropriate place to keep my configuration,
and it's still work in progress to move all the config files into github gist.

Within `bin/` folder, being kept are bash scripts to invoke notification due to
volume, brightness and music playlist changes. I'm planning to build a script to
enable easy screencasting and later convert it into `*.gif` format, however
I haven't been able to figure out the cause of screen flickering when using
`ffmpeg` to grab my x11 session. I guess it has something to do with compton
(maybe?).

In `.config/` folder, I keep configuration file for music daemon, window
manager, compositor, pdf reader, file manager, as well as color theme generator
(adapted from [terminal.sexy](http://terminal.sexy)).

Depicted below is tmux + surf:

!["tmux 1"](https://i.imgur.com/SSQtrJG.png)

Floating more, transparency and notification:

!["scrot 1"](https://i.imgur.com/xdWv3wW.png)
