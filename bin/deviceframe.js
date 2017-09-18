#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const conf = require('conf');
const chalk = require('chalk');
const envPaths = require('env-paths');
const flatten = require('lodash/flatten');
const getStream = require('get-stream');
const globby = require('globby');
const got = require('got');
const inquirer = require('inquirer');
const isStream = require('isStream');
const isUrl = require('is-url-superb');
const Jimp = require('jimp');
const logSymbols = require('log-symbols');
const meow = require('meow');
const mkdirp = require('mkdirp');
const ProgressBar = require('progress');

const framesUrl = 'https://s3-us-west-1.amazonaws.com/fbdesignresources/Devices/Facebook+Devices.zip';

const paths = envPaths('deviceframe');
const frameCacheDir = path.join(paths.cache, 'frames');

/* ------ */

const cli = meow(`
	Usage
	  $ dframe <image>

	Options
    --delay             Delay webpage capturing in seconds
	  --output, -o        Output directory

  Examples
    $ dframe cat.png
    $ dframe cat.png dog.png horse.jpg
    $ dframe *.png cat-*.jpeg
    $ dframe http://localhost:8080 --delay 2
`, {
  alias: {
    o: 'output',
    h: 'help',
  },
});

init();

/* ------------------------------------------------------------------------- */

function init() {
  mkdirp(frameCacheDir, err => {
    if (err) console.error(chalk.red(err));

    const files = fs.readdirSync(frameCacheDir);
    if (!files || files.length === 0) {
      setup();
    }
  });

  const urls = cli.input.filter(f => isUrl(f));

  // Find image files to frame from input
  globImageFiles(cli.input.filter(f => !isUrl(f)))
  .then(files => {
    if (files.length === 0 && urls.length === 0) error('No image files or urls found');

    return [files, chooseFrames()];
  })
  .then(([files, frames]) => {
    return frameIt(files[0], 'foo');
  });

  urls.forEach(url => {
    frameIt(url, 'foo');
  });
}

function setup() {
  inquirer.prompt([{
    name: 'download',
    type: 'confirm',
    message: `Looks like we're running for the first time. deviceframe needs to download the frameset images. This is about 185MB. Sound good?`,
    default: true,
  }]).then(answers => {
    if (answers.download) downloadFrames();
  });
}

function globImageFiles(inputs) {
  if (!inputs || inputs.length === 0) return Promise.resolve([]);

  console.log('inputs', inputs, Array.isArray(inputs));

  const ps = inputs.map(file => {
    return globby(file);
  });

  return Promise.all(ps).then(results => flatten(results));
}

function downloadFrames() {
  const bar = new ProgressBar('  downloading [:bar] :rate/bps :percent :etas', {
    complete: '=',
    incomplete: ' ',
    width: 20,
    total: 100,
  });

  return got.stream(framesUrl)
  .on('response', response => {
    console.log(response);
  })
  .on('downloadProgress', progress => {
    console.log('progress.percent', progress.percent);
    bar.tick(progress.percent * 100);
  })
  .pipe(fs.createWriteStream(path.join(frameCacheDir, 'frames.zip')));
}

function chooseFrames() {

}

function frameIt(img, frameConf) {
  if (isStream(img)) {
    img = getStream.buffer(img);
  }

  // Read in image and frame
  return Promise.resolve(img)
  .then(imgData => {
    return Promise.all([
      Jimp.read(path.join(frameCacheDir, frameConf.relPath)),
      Jimp.read(imgData),
    ]);
  })
  // Resize largest image to fit the other
  .then(([frame, jimg]) => {
    const frameMax = Math.max(frameConf.height, frameConf.width);
    const jimgMax = Math.max(jimg.bitmap.height, jimg.bitmap.width);

    // Frame is bigger, size it down to source image
    if (frameMax > jimgMax) {
      // Resize frame so shortest dimension matches source image. Source image overflow will be clipped
      let rH = frame.bitmap.height;
      let rW = frame.bitmap.width;
      if (frameConf.height > frameConf.width) {
        const ratio = frame.bitmap.width / frameConf.width;
        rW = Math.ceil(jimg.bitmap.width * ratio);
        rH = Jimp.AUTO;
      } else {
        const ratio = frame.bitmap.height / frameConf.height;
        rH = Math.ceil(jimg.bitmap.height * ratio);
        rW = Jimp.AUTO;
      }

      frame = frame.resize(rW, rH);
    } else {
      // Source image is bigger, size it down to frame
      // Resize frame so shortest dimension matches
      let rH = jimg.bitmap.height;
      let rW = jimg.bitmap.width;
      if (rH > rW) {
        rW = frameConf.width;
        rH = Jimp.AUTO;
      } else {
        rH = frameConf.height;
        rW = Jimp.AUTO;
      }

      jimg = jimg.resize(rW, rH);
    }

    return [frame, img];
  })
  .then(([frame, jimg]) => {
    return frame.composite(jimg, frameConf.left, frameConf.top);
  })
  .then(composite => {
    let imgPath = '';

    if (typeof img === 'string') {
      const p = path.parse(img);
      imgPath = `${p.name}-${frameConf.name}${p.ext}`;
    } else {
      imgPath = `Frame-${frameConf.name}.png`;
    }

    composite.write(imgPath);
  });
}

function cacheSettings(settings) {
  // TODO: write settings to ~/.deviceframe/settings.json
}

function error(msg) {
  console.error(logSymbols.error + ' ' + chalk.red(msg));
  process.exit(1);
}
