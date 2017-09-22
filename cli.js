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
const isStream = require('is-stream');
const isUrl = require('is-url-superb');
const Jimp = require('jimp');
const logSymbols = require('log-symbols');
const meow = require('meow');
const mkdirp = require('mkdirp');
const ProgressBar = require('progress');

const framesUrl = 'https://gitcdn.xyz/repo/c0bra/deviceframe-frames/master/';

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
    if (files.length === 0 && urls.length === 0) error('No image files or urls specified');

    return [files, chooseFrames()];
  })
  .then(([files, frames]) => {
    return frameIt(files[0], {
      relPath: 'Phones/Apple iPhone 6s/Device/Apple iPhone 6s Gold.png',
      category: 'Phones',
      device: 'Apple iPhone 6s',
      frame: {
        top: 299,
        left: 119,
        bottom: 1634,
        right: 870,
        width: 751,
        height: 1335,
      },
      name: 'Apple iPhone 6s Gold',
      shadow: false,
      tags: [
        'apple',
        'iphone',
        '6s',
        'gold',
      ],
    });
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
    const frameImageWidth = frame.bitmap.width;
    const frameImageHeight = frame.bitmap.height;

    const compLeftRatio = frameConf.frame.left / frameImageWidth;
    const compTopRatio = frameConf.frame.top / frameImageHeight;

    let compLeft = frameConf.frame.left;
    let compTop = frameConf.frame.top;

    const frameMax = Math.max(frameConf.frame.height, frameConf.frame.width);
    const jimgMax = Math.max(jimg.bitmap.height, jimg.bitmap.width);

    // Frame is bigger, size it down to source image
    if (frameMax > jimgMax) {
      // Resize frame so shortest dimension matches source image. Source image overflow will be clipped
      let rH = frame.bitmap.height;
      let rW = frame.bitmap.width;
      if (frameConf.frame.height > frameConf.frame.width) {
        const ratio = jimg.bitmap.width / frameConf.frame.width;
        console.log('w ratio', ratio);
        rW = Math.ceil(jimg.bitmap.width * ratio);
        rH = Jimp.AUTO;
      } else {
        const ratio = jimg.bitmap.height / frameConf.frame.height;
        console.log('h ratio', ratio);
        rH = Math.ceil(jimg.bitmap.height * ratio);
        rW = Jimp.AUTO;
      }

      frame.resize(rW, rH);

      // We resized the frame so there's a new compositing location on it
      compLeft = Math.ceil(frame.bitmap.width * compLeftRatio);
      compTop = Math.ceil(frame.bitmap.height * compTopRatio);

      // Resize source image to fit new frame size
      const newFrameWidth = frameConf.frame.width * (frame.bitmap.width / frameImageWidth);
      const newFrameHeight = frameConf.frame.height * (frame.bitmap.height / frameImageHeight);

      jimg.cover(newFrameWidth, newFrameHeight);
    } else {
      // Source image is bigger, size it down to frame
      // Resize frame so shortest dimension matches
      let rH = jimg.bitmap.height;
      let rW = jimg.bitmap.width;
      if (rH > rW) {
        rW = frameConf.frame.width;
        rH = Jimp.AUTO;
      } else {
        rH = frameConf.frame.height;
        rW = Jimp.AUTO;
      }

      // jimg = jimg.resize(rW, rH);
      jimg.cover(frameConf.frame.width, frameConf.frame.height);
    }

    return [frame, jimg, { left: compLeft, top: compTop }];
  })
  .then(([frame, jimg, compPos]) => {
    return frame.composite(jimg, compPos.left, compPos.top);
  })
  .then(composite => {
    let imgPath = '';

    if (typeof img === 'string') {
      const p = path.parse(img);
      imgPath = `${p.name}-${frameConf.name}.png`;
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
