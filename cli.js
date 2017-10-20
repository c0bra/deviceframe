#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
// const conf = require('conf');
const chalk = require('chalk');
const envPaths = require('env-paths');
const flatten = require('lodash/flatten');
const find = require('lodash/find');
const Fuse = require('fuse.js');
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
const ora = require('ora');
const ProgressBar = require('progress');
const screenshot = require('screenshot-stream');
const some = require('lodash/some');
const typeis = require('type-is');
const uniq = require('lodash/uniq');
const frameData = require('./data/frames.json');

// const framesUrl = 'https://gitcdn.xyz/repo/c0bra/deviceframe-frames/1.0.0/';
const framesUrl = 'https://cdn.rawgit.com/c0bra/deviceframe-frames/1.0.0/';

const paths = envPaths('deviceframe');
const frameCacheDir = path.join(paths.cache, 'frames');
const webCacheDir = path.join(paths.cache, 'web');

readline.emitKeypressEvents(process.stdin);

/* ------ */

// Help text
const cli = meow(`
    Usage
      # Pass in any number of image files (globs allows), image urls, or website urls:
      $ dframe <image>
      $ dframe <url
      $ dframe <ul> <image> <url> <image url> <image>

    Options
      --delay             Delay webpage capturing in seconds
      --output, -o        Output directory (default: current working directory)
      --debug, -d         Log debug info
      --devices           List all available devices
      --frame             Supply a frame to use. Fuzzy matches. Use multiple --frame switches for multiple frames or use commas. See below for examples.

    Examples
      $ dframe cat.png
      $ dframe cat.png dog.png horse.jpg
      $ dframe *.png cat-*.jpeg
      $ dframe https://github.com/c0bra/deviceframe --delay 2
      $ dframe cat.png https://github.com/c0bra/deviceframe *.bmp https://i.imgur.com/aw2bc01.jpg
      $ dframe cat.png --frame "iPhone 7"
      $ dframe cat.png --frame "iPhone 6" --frame "iPhone 7"
      $ dframe cat.png --frame "iphone 6","iphone 7"
  `,
  {
    flags: {
      help: {
        alias: 'h',
      },
      delay: {
        default: 0,
      },
      devices: {
        default: false,
      },
      output: {
        type: 'string',
        alias: 'o',
        default: '.',
      },
      debug: {
        type: 'boolean',
        alias: 'd',
        default: false,
      },
    },
  }
);

// Log out list of devices
if (cli.flags.devices) {
  console.log(
    uniq(frameData.map(x => x.device)).sort().join('\n')
  );
  process.exit(0);
}

// Parse frames args
if (cli.flags.frame && typeof cli.flags.frame === 'string') {
  cli.flags.frame = [].concat(cli.flags.frame.split(/,/).map(f => f.trim()));
}

// console.log('frames', cli.flags.frame); process.exit(0);

// Find matching frames
let frames = null;
if (cli.flags.frame) {
  const fuse = new Fuse(frameData, {
    shouldSort: true,
    tokenize: true,
    matchAllTokens: true,
    threshold: 0,
    location: 0,
    distance: 100,
    maxPatternLength: 32,
    minMatchCharLength: 1,
    keys: ['name'],
  });

  let results = [];
  cli.flags.frame.forEach(f => {
    // See if we can match exactly
    const exact = find(frameData, { name: f });

    if (exact) {
      results.push(exact);
    } else {
      const res = fuse.search(f);
      if (res) results = results.concat(res);
    }
  });

  frames = uniq(results);

  if (!frames) error('Could not find any matching frames');
}

/*
  1. Init (read in cache dir and conf)
  2. Process image paths, urls and confirm w/ user
  3. Prompt user for frames
  4. Process each image through each frame, writing each out
*/

Promise.resolve()
.then(init)
.then(confirmInputs)
.then(([files, urls]) => {
  return chooseFrames()
  .then(frames => [files, urls, frames]);
})
.then(([files, urls, frames]) => {
  return downloadFrames(frames)
  .then(frames => [files, urls, frames])
  .catch(err => error(err));
})
.then(([files, urls, frames]) => frameImages(files, urls, frames))
.catch(err => error(err));

/* ------------------------------------------------------------------------- */

function init() {
  debug('Init...');
  // Add shadow suffix on to frame name
  frameData.forEach(frame => {
    if (frame.shadow) frame.name = `${frame.name} [shadow]`;
  });

  mkdirp(frameCacheDir, err => {
    if (err) console.error(chalk.red(err));

    // NOTE: not used
    // const files = fs.readdirSync(frameCacheDir);
    // return files;
  });

  mkdirp(webCacheDir, err => {
    if (err) console.error(chalk.red(err));
  });
}

function confirmInputs() {
  const urls = cli.input.filter(f => isUrl(f));

  // Find image files to frame from input
  return globImageFiles(cli.input.filter(f => !isUrl(f)))
  .then(files => {
    if (files.length === 0 && urls.length === 0) error('No image files or urls specified', true);

    return [files, urls];
  });
}

function chooseFrames() {
  if (frames) return Promise.resolve(frames);

  debug('Choosing frames');

  inquirer.registerPrompt('autocomplete', require('inquirer-autocomplete-prompt'));

  return new Promise(resolve => {
    const ui = new inquirer.ui.BottomBar();

    let frames = [];
    let prompt = null;

    function prompter() {
      prompt = inquirer.prompt({
        type: 'autocomplete',
        name: 'frames',
        message: 'Add the frames you want to use (ESC to complete)',
        source: (answers, input) => {
          input = input || '';
          input = input.toLowerCase();
          return Promise.resolve(
            frameData.map(f => f.name.toLowerCase()).filter(name => name.indexOf(input) !== -1)
          );
        },
      });

      prompt.then(answers => {
        const foundFrames = frameData.filter(frame => some(answers, a => a === frame.name.toLowerCase()));
        frames = uniq(frames.concat(foundFrames));
        ui.log.write(chalk.magenta(`\nFrames: [${frames.map(f => chalk.bold(f.name)).join(', ')}]\n`));
        prompter();
      });
    }

    prompter();

    // Resolve promise on ESC key
    process.stdin.on('keypress', (ch, key) => {
      if (key && key.name === 'escape') {
        prompt.ui.close();
        console.log('\n');
        resolve(frames);
      }
    });
  });
}

function frameImages(files, urls, frames) {
  let promises = files.map(file => {
    return frames.map(frame => {
      return frameIt(file, frame);
    });
  });

  promises = promises.concat(
    urls.map(url => {
      return frames.map(frame => frameIt(url, frame));
    })
  );

  return promises;
}

// function setup() {
//   inquirer.prompt([{
//     name: 'download',
//     type: 'confirm',
//     message: `Looks like we're running for the first time. deviceframe needs to download the frameset images. This is about 185MB. Sound good?`,
//     default: true,
//   }]).then(answers => {
//     if (answers.download) downloadFrames();
//   });
// }

function globImageFiles(inputs) {
  if (!inputs || inputs.length === 0) return Promise.resolve([]);

  const ps = inputs.map(file => {
    return globby(file);
  });

  return Promise.all(ps).then(results => flatten(results));
}

function downloadFrames(frames) {
  debug('Downloading frames');
  // console.log('frames', frames);
  const promises = [];

  for (const frame of frames) {
    const frameCachePath = path.join(frameCacheDir, frame.relPath);

    if (fs.existsSync(frameCachePath) && fs.statSync(frameCachePath).size > 0) {
      frame.path = frameCachePath;
      promises.push(frame);
    } else {
      if (fs.existsSync(frameCachePath)) fs.unlink(frameCachePath);
      frame.url = framesUrl + frame.relPath; // encodeURIComponent(frame.relPath);
      promises.push(downloadFrame(frame));
    }
  }

  return Promise.all(promises).then(results => flatten(results));
}

function downloadFrame(frame) {
  debug(`Downloading frame ${frame.url}`);

  const bar = new ProgressBar('Downloading frame [:bar] :rate/bps :percent :etas', {
    complete: '=',
    incomplete: ' ',
    width: 20,
    total: 100,
  });

  bar.tick();

  frame.path = path.join(frameCacheDir, frame.relPath);

  const downloadDir = path.parse(frame.path).dir;
  mkdirp.sync(downloadDir);

  return new Promise((resolve, reject) => {
    got.stream(frame.url, {
      headers: {
        'user-agent': `deviceframe/${cli.pkg.version} (${cli.pkg.repo})`,
      },
    })
    .on('end', () => {
      bar.tick(100);
      resolve(frame);
    })
    .on('downloadProgress', progress => {
      console.log('progress.percent', progress.percent);
      bar.tick(progress.percent * 100);
    })
    .on('error', error => {
      if (fs.existsSync(frame.path)) fs.unlink(frame.path);
      console.log(require('util').inspect(error, { depth: null }));
      reject(error);
    })
    .pipe(fs.createWriteStream(frame.path));
  });
}

function frameIt(img, frameConf) {
  debug('Framing images');

  // TODO: use filenamify here?
  // Get the writeable file name for the image
  let imgName = '';
  if (typeof img === 'string') {
    const p = path.parse(img);
    imgName = `${p.name}-${frameConf.name}.png`;
  } else {
    imgName = `Frame-${frameConf.name}.png`;
  }

  const imgPath = path.join(cli.flags.output, imgName);

  if (isStream(img)) {
    img = getStream.buffer(img);
  } else if (isUrl(img)) {
    // Check if url is for an image or for a webpage
    // NOTE: for urls we need to cache them
    const imgUrl = img;
    debug(`Checking for image: ${imgUrl}`);
    img = got(img, { encoding: null })
    .then(response => {
      if (typeis(response, ['image/*'])) return response.body;

      // Scale image size for device pixel density
      const w = Math.floor(frameConf.frame.width / (frameConf.pixelRatio || 1));
      const h = Math.floor(frameConf.frame.height / (frameConf.pixelRatio || 1));
      const dim = [w, h].join('x');

      const spinner = ora(`Screenshotting ${imgUrl} at ${dim}`).start();

      // TODO: need to dynamically choose device user-agent from a list, or store them with the frames
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1';
      const stream = screenshot(imgUrl, dim, { crop: true, userAgent: ua, delay: cli.flags.delay })
        .on('error', err => {
          spinner.fail();
          error(err);
        })
        .on('end', () => spinner.succeed());

      const bufPromise = getStream.buffer(stream);
      // bufPromise.then(buf => {
      //   fs.writeFileSync('test.png', buf, { encoding: 'binary' });
      // });

      return bufPromise;
    })
    .catch(err => error(err));
  }

  // Read in image and frame
  return Promise.resolve(img)
  .then(imgData => {
    const framePath = path.join(frameCacheDir, frameConf.relPath);

    debug(`Reading in frame from ${framePath}`);

    return Promise.all([
      Jimp.read(framePath),
      Jimp.read(imgData),
    ]);
  })
  // Resize largest image to fit the other
  .then(([frame, jimg]) => {
    debug('Resizing frame/image');

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
        rW = Math.ceil(rW * ratio);
        rH = Jimp.AUTO;
      } else {
        const ratio = jimg.bitmap.height / frameConf.frame.height;
        rH = Math.ceil(rH * ratio);
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
    debug('Compositing...');
    return frame.composite(jimg, compPos.left, compPos.top);
  })
  .then(composite => {
    debug('Saving...');
    composite.write(imgPath);
    console.log(chalk.bold('> ') + chalk.green('Wrote: ') + imgPath);
  })
  .catch(err => error(err));
}

function cacheSettings(settings) {
  // TODO: write settings to ~/.deviceframe/settings.json
}

function error(msg, usage) {
  if (usage) console.log(cli.help);
  console.error('\n' + logSymbols.error + ' ' + chalk.red(msg));
  process.exit(1);
}

function debug(...args) {
  if (cli.flags.debug) console.log(chalk.green(...args));
}
