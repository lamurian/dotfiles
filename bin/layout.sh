#!/bin/bash

i3-msg "workspace 1:; append_layout ~/.config/i3/ws-1.json"

(termite -e "htop" -t "htop" &)
(termite &)
