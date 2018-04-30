const path = require('path');
const envPaths = require('env-paths');
const mkdirp = require('mkdirp');
const uniq = require('lodash/uniq');
const frameData = require('./data/frames.json');

const paths = envPaths('deviceframe');
const frameCacheDir = path.join(paths.cache, 'frames');
const webCacheDir = path.join(paths.cache, 'web');

// ------------
init();
// ------------

function init() {
  // Add shadow suffix on to frame name
  frameData.forEach(frame => {
    if (frame.shadow) frame.name = `${frame.name} [shadow]`;
  });

  makeCacheDirs();
}

function makeCacheDirs() {
  mkdirp(webCacheDir, err => {
    if (err) throw err;
  });

  mkdirp(frameCacheDir, err => {
    if (err) throw err;
  });
}

module.exports = class DeviceFrame {
  constructor(opts = opts) {
    this.opts = opts;
  }

  async devices() {
    return Promise.resolve(uniq(frameData.map(x => x.device)).sort());
  }

  async downloadFrames(...frames) {
    return frames.download(frames, frameCacheDir);
  }

  async frames() {
    return Promise.resolve(frameData);
  }
};
