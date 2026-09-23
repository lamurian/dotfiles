#!/usr/bin/bash

play -qn synth .45 pluck G &
play -qn synth 2.2 pluck E3 pluck G3 pluck C & sleep .45
play -qn synth .25 pluck G & sleep .15
for i in A G C5; do play -qn synth .5 pluck $i; done
play -qn synth 1 pluck B &
play -qn synth 1.1 pluck D3 pluck G3 pluck B3

play -qn synth .45 pluck G &
play -qn synth 2.2 pluck D3 pluck G3 pluck B3 & sleep .45
play -qn synth .25 pluck G & sleep .15
for i in A G D5; do play -qn synth .5 pluck $i; done
play -qn synth 1 pluck C5 &
play -qn synth 1.1 pluck E3 pluck G3 pluck C4

play -qn synth .45 pluck G &
play -qn synth .7 pluck G3 pluck B3 pluck D & sleep .45
play -qn synth .25 pluck G & sleep .15

play -qn synth 1 pluck G3 pluck C pluck E &
for i in G5 E3; do play -qn synth .5 pluck $i; done

play -qn synth .45 pluck D5 &
play -qn synth .7 pluck E pluck G & sleep .25
play -qn synth .25 pluck C5

play -qn synth .65 pluck B &
play -qn synth 2.15 pluck C pluck F & sleep .55
play -qn synth 1.5 pluck A

for i in G B D5; do play -qn synth .55 pluck $i & sleep .06; done
play -qn synth .45 pluck F5
play -qn synth .25 pluck F5

i=0
arr_note=("E5 G B" "C5 D G" "D5 E G")
while [ $i -lt ${#arr_note[@]} ]; do
	set -- ${arr_note[$i]}
	play -qn synth .55 pluck $1 & play -qn synth .55 pluck $2 pluck $3
	i=$[$i+1]
done

for i in C E G C5; do play -qn synth 1.1 pluck $i & sleep .06; done
