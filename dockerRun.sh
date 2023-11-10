#!/bin/sh


nerdctl run --rm --name jekyll-server -v $PWD:/srv/jekyll -p 4000:4000 -it jekyll/jekyll:4.2.0 jekyll serve 

#--force_polling 

#--no-watch