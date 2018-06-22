#!/usr/bin/env node
const fs = require('fs');
const cluster = require('cluster');
const os = require('os');
const path = require('path');
const _ = require('lodash');
const chalk = require('chalk');
const Jimp = require('jimp');
const meow = require('meow');
const recursive = require('recursive-readdir');

const cli = meow(`
  Usage
    # Run a test
    $ node scripts/parse-frames.js
    # Run and write out results to ../data/frames.json
    $ node scripts/parse-frames.js -w

  Options
    --write, -w     Write out results to ../data/frames.json
    --count, -c     Run on limited number of frames. Ex: '-c 5' will do 5 frames then stop
    --parallel, -p  Run N multiple workers at once. Ex: '-p 4' if you have 4 cores
`,
{
  flags: {
    help: {
      alias: 'h',
    },
    write: {
      alias: 'w',
      default: false,
    },
    count: {
      type: 'number',
      alias: 'c',
      default: 0,
    },
    parallel: {
      alias: 'p',
      default: false,
    },
    output: {
      type: 'string',
      alias: 'o',
      default: '.',
    },
    // debug: {
    //   type: 'boolean',
    //   alias: 'd',
    //   default: false,
    // }
  },
});

const start = new Date().getTime();

const framePath = path.join(__dirname, '../node_modules/deviceframe-frames');
const px = require('../data/pixel-ratios.json');

// Only spin up things if you're the master
if (cluster.isMaster) {
  readFrames()
    .then(frames => {
      console.log(chalk.green(`Processed ${frames.length} frames with ${cli.flags.p} workers`));
      const end = new Date().getTime();
      const took = ((end - start) / 1000).toFixed(1);
      console.log(chalk.magenta(`Took ${took}s`));

      const content = JSON.stringify(frames, null, 4);

      if (cli.flags.write) fs.writeFileSync(path.join(__dirname, '../data/frames.json'), content);
    });
} else {
  // Worker
  process.on('message', message => {
    Promise.all(message.data.map(file => getFrameDetails(file)))
      .then(result => {
        process.send({ result });
      });
  });
}

function readFrames() {
  return recursive(framePath)
    .then(files => files.filter(path => /\.png$/.test(path)))
    .then(files => files.sort())
    .then(files => {
      if (cli.flags.count > 0) return files.slice(0, cli.flags.count);
      return files;
    })
    .then(files => {
      if (cli.flags.p) {
        let workerCount = parseInt(cli.flags.p, 10);
        if (isNaN(workerCount) || !workerCount) workerCount = os.cpus().length;

        if (cluster.isMaster) {
          const chunks = [];
          const chunkSize = Math.ceil(files.length / workerCount);
          for (let i = 0; i < workerCount; i++) {
            cluster.fork();
            chunks.push(files.slice(i * chunkSize, (i * chunkSize) + chunkSize));
          }

          let results = [];
          for (const id in cluster.workers) { /* eslint guard-for-in: 0 */
            cluster.workers[id].on('message', message => {
              if (message.result) {
                results = results.concat(message.result);
                cluster.workers[id].kill();
              }
            });

            cluster.workers[id].send({ data: chunks.shift() });
          }

          return new Promise(resolve => {
            cluster.on('exit', () => {
              if (Object.keys(cluster.workers).length === 0) resolve(results);
            });
          });
        }
      } else {
        return Promise.all(files.map(file => getFrameDetails(file)));
      }
    });
}

function getFrameDetails(framePath) {
  const relPath = framePath.replace(/.+?deviceframe-frames\//, '');
  const { dir, name } = path.parse(relPath);
  const [category, device] = dir.split(/\//);
  const shadow = /shadow/i.test(relPath);

  return pathToFrame(framePath)
    .then(frame => {
      console.log([category, device, name, shadow ? 'Shadow' : 'No Shadow'].join(' | '));

      let pixelRatio = null;
      const p = _.find(px, { name: device });
      if (p) pixelRatio = p.pixelRatio;

      return {
        relPath,
        category,
        device,
        frame,
        name,
        pixelRatio,
        shadow,
        tags: name.split(/\s+/).map(tag => tag.toLowerCase()),
      };
    });
}

function pathToFrame(framePath) {
  return Jimp.read(framePath).then(image => findFrame(image));
}

function findFrame(image) {
  const { width, height } = image.bitmap;

  const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  const s = 12;
  const mask = (1 << s) - 1;
  const xyToPosition = (x, y) => ((x & mask) << s) + (y & mask);
  const positionToXy = p => {
    const y = p & mask;
    const x = p >> s;
    return [x, y];
  };

  const middleX = Math.floor(width / 2);
  const middleY = Math.floor(height / 2);

  let top = middleY;
  let left = middleX;
  let bottom = middleY;
  let right = middleX;

  const floodFill = new Set([xyToPosition(middleX, middleY)]);

  for (const p of floodFill) {
    const [px, py] = positionToXy(p);
    for (const [dx, dy] of offsets) {
      const x = px + dx;
      const y = py + dy;

      if (!(x >= 0 && y >= 0 && x <= width && y <= height)) continue;

      const index = image.getPixelIndex(x, y);
      const alpha = image.bitmap.data[index + 3];

      if (alpha === 255) continue;

      floodFill.add(xyToPosition(x, y));
      top = Math.min(y, top);
      left = Math.min(x, left);
      bottom = Math.max(y + 1, bottom);
      right = Math.max(x + 1, right);
    }
  }

  return {
    top,
    left,
    bottom,
    right,
    width: right - left,
    height: bottom - top,
  };
}
