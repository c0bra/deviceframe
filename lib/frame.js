const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const Emittery = require('emittery');
const flatten = require('lodash/flatten');
const got = require('got');
const mkdirp = require('mkdirp');
const pkg = require('../package.json');

const framesRepo = pkg.devDependencies['deviceframe-frames'];

const framesVersion = framesRepo.match(/#(.+)$/)[1];
const framesUrl = `https://cdn.rawgit.com/c0bra/deviceframe-frames/${framesVersion}/`;

export function download(frames, frameCacheDir) {
  const emitter = new Emittery();

  const promises = [];

  for (const frame of frames) {
    const frameCachePath = path.join(frameCacheDir, frame.relPath);

    if (fs.existsSync(frameCachePath) && fs.statSync(frameCachePath).size > 0) {
      emitter.emit('log', `Frame found at ${frameCachePath}`);
      frame.path = frameCachePath;
      promises.push(frame);
    } else {
      if (fs.existsSync(frameCachePath)) fs.unlink(frameCachePath);
      frame.url = framesUrl + frame.relPath; // encodeURIComponent(frame.relPath);
      promises.push(new Promise((resolve, reject) => {
        downloadOneFrame(frame)
        .on('progress', ([frame, progress]) => emitter.emit([frame, progress]))
        .on('error', error => reject(error))
        .on('end', frame => resolve(frame));
      }));
    }
  }

  Promise.all(promises).then(results => flatten(results))
  .then(results => emitter.emit('end', results));

  return emitter;
}

export function downloadOneFrame(frame, frameCacheDir) {
  const emitter = new EventEmitter();

  emitter.emit('log', `Downloading frame ${frame.url}`);

  frame.path = path.join(frameCacheDir, frame.relPath);

  const downloadDir = path.parse(frame.path).dir;
  mkdirp.sync(downloadDir);

  got.stream(frame.url, {
    headers: {
      'user-agent': `deviceframe/${pkg.version} (${pkg.repo})`,
    },
  })
  .on('end', () => {
    emitter.emit([frame, 100]);
    emitter.emit('end', frame);
  })
  .on('downloadProgress', progress => {
    console.log('progress.percent', progress.percent);
    emitter.emit(progress.percent * 100, { frame });
  })
  .on('error', error => {
    if (fs.existsSync(frame.path)) fs.unlink(frame.path);
    console.log(require('util').inspect(error, { depth: null }));
    emitter.emit('error', error);
  })
  .pipe(fs.createWriteStream(frame.path));

  return emitter;
}
