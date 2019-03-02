#!/bin/bash

# Using pre-defined layout in i3

i3-msg "workspace 1:; append_layout ~/.config/i3/ws-1.json"

(termite -e "htop" -t "htop" &)
(termite &)
