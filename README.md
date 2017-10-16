<h1 align="center">
	<br>
	<br>
	<img width="400" src="logo.png" alt="deviceframe">
	<br>
	<br>
	<br>
</h1>

>  Put device frames around your mobile/web/progressive app screenshots.

![example](example.png)

# Get it

    npm install -g deviceframe

# Use it

Pass in filenames, file globs, URLs to websites or URLs to images.

For website URLs

```
$ dframe cat.jpeg
$ dframe http://github.com
$ dframe http://githbub.com dog.png https://i.imgur.com/aw2bc01.jpg *.bmp
```

deviceframe will prompt you for the frames you want to use. You can select multiple frames and search by typing. Once you have selected all the frames you want to use, hit ESC.

For website URLs, deviceframe will load the page with the aspect ratio and pixel density of selected device(s).


# TODO

[ ] - Thunderbolt Display is duplicated

# Attributions

Logo icon created by Vallone Design from the Noun Project
