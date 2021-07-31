@echo off


CALL docker restart blog
REM CALL docker run --name blog --volume="C:\Projects\developer-joon.github.io:/srv/jekyll" -p 4000:4000 -it jekyll/jekyll jekyll serve