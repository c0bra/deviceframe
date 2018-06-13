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
  // console.log(`Worker ${process.pid} is running`);
  // Worker
  process.on('message', message => {
    // console.log(`Worker #${cluster.worker.id}`, message);

    Promise.all(message.data.map(file => getFrameDetails(file)))
      .then(result => {
        process.send({ result });
        process.exit(0);
      });
  });

  // process.exit(0);
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
              // console.log(`Master ${process.pid}`, message);
              if (message.result) results = results.concat(message.result);
            });

            cluster.workers[id].send({ data: chunks.shift() });
          }

          return new Promise(resolve => {
            cluster.on('exit', () => {
              // console.log('workers', Object.keys(cluster.workers).length);

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
  const middleX = parseInt(image.bitmap.width / 2, 10);
  const middleY = parseInt(image.bitmap.height / 2, 10);

  let left;
  let right;
  let top;
  let bottom;

  // Scan left
  for (let i = middleX; i >= 0; i--) {
    const idx = image.getPixelIndex(i, middleY);
    const alpha = image.bitmap.data[idx + 3];
    // console.log('i', i, middleY, alpha);
    if (alpha === 255) {
      left = i;
      break;
    }
  }

  // Scan right
  for (let i = middleX; i <= image.bitmap.width; i++) {
    const idx = image.getPixelIndex(i, middleY);
    const alpha = image.bitmap.data[idx + 3];
    if (alpha === 255) {
      right = i;
      break;
    }
  }

  // Scan top
  for (let i = middleY; i >= 0; i--) {
    const idx = image.getPixelIndex(middleX, i);
    const alpha = image.bitmap.data[idx + 3];
    if (alpha === 255) {
      top = i;
      break;
    }
  }

  // Scan bottom
  for (let i = middleY; i <= image.bitmap.height; i++) {
    const idx = image.getPixelIndex(middleX, i);
    const alpha = image.bitmap.data[idx + 3];
    if (alpha === 255) {
      bottom = i;
      break;
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
