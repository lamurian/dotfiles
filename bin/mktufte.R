#!/usr/bin/Rscript
library(rmarkdown)

# Read given argument and parse it into R
rmdfile = commandArgs(trailingOnly=T)
rmarkdown::render(rmdfile)
