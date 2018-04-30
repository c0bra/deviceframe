#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
// const conf = require('conf');
const chalk = require('chalk');
// const flatten = require('lodash/flatten');
const find = require('lodash/find');
const flatten = require('lodash/flatten');
const Fuse = require('fuse.js');
const globby = require('globby');
const inquirer = require('inquirer');
const logSymbols = require('log-symbols');
const meow = require('meow');
// const mkdirp = require('mkdirp');
const ora = require('ora');
const ProgressBar = require('progress');
const some = require('lodash/some');
const uniq = require('lodash/uniq');
// const frameData = require('./data/frames.json');

const deviceframe = require('./index');

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
  console.log(deviceframe.devices().join('\n'));
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
  const fuse = new Fuse(deviceframe.frames, {
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

  const results = [];
  cli.flags.frame.forEach(f => {
    // See if we can match exactly
    const exact = find(deviceframe.frames, { name: f });

    if (exact) {
      results.push(exact);
    } else {
      const res = fuse.search(f);
      if (res) results.push(res[0]);
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
  debug('Downloading frames');

  return new Promise((resolve, reject) => {
    // const bar = new ProgressBar(`Downloading frame ${chalk.green(frame.name)} [:bar] :rate/bps :percent :etas`, {
    const bar = new ProgressBar(`Downloading frame :frame [:bar] :rate/bps :percent :etas`, {
      complete: '=',
      incomplete: ' ',
      width: 20,
      total: 100,
    });

    bar.tick();

    deviceframe.downloadFrames(frames)
    .on('log', log => console.log(log))
    .on('progress', ([frame, progress]) => bar.tick(progress, { frame: chalk.green(frame.name) }))
    .on('error', err => reject(err))
    .on('end', results => resolve(results));
  })
  .then(frames => [files, urls, frames])
  .catch(err => error(err));
})
.then(([files, urls, frames]) => frameImages(files, urls, frames))
.catch(err => error(err));

/* ------------------------------------------------------------------------- */

function init() {
  debug('Init...');

  try {
    deviceframe.init();
  } catch (err) {
    console.error(chalk.red(err));
  }
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
            deviceframe.frames.map(f => f.name.toLowerCase()).filter(name => name.indexOf(input) !== -1)
          );
        },
      });

      prompt.then(answers => {
        const foundFrames = deviceframe.frames.filter(frame => some(answers, a => a === frame.name.toLowerCase()));
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
      return deviceframe.frame(file, frame)
      .then(buffer => {
        debug('Saving...');

        const f = filename(file, frame);
        const imgPath = path.join(cli.flags.output, f);
        fs.writeFileSync(imgPath, buffer);
      });
    });
  });

  promises = promises.concat(
    urls.map(url => {
      return frames.map(frame => {
        return deviceframe.frame(url, frame)
        .then(buffer => {
          debug('Saving...');

          const f = filename(url, frame);
          const imgPath = path.join(cli.flags.output, f);
          fs.writeFileSync(imgPath, buffer);
        });
      });
    })
  );

  return promises;
}

function filename(img, frame) {
  // TODO: use filenamify here?
  if (typeof img === 'string') {
    const p = path.parse(img);
    return `${p.name}-${frame.name}.png`;
  }

  return `Frame-${frame.name}.png`;
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

// function cacheSettings(settings) {
//   // TODO: write settings to ~/.deviceframe/settings.json
// }

function error(msg, usage) {
  if (usage) console.log(cli.help);
  console.error('\n' + logSymbols.error + ' ' + chalk.red(msg));
  process.exit(1);
}

function debug(...args) {
  if (cli.flags.debug) console.log(chalk.green(...args));
}
