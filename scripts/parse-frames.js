#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const Jimp = require('jimp');
const recursive = require('recursive-readdir');

// const framePath = path.join(__dirname, '..', 'Facebook Devices');
const framePath = path.join(__dirname, '../node_modules/deviceframe-frames');

const px = require('../data/pixel-ratios.json');

readFrames()
.then(frames => {
  const content = JSON.stringify(frames, null, 4);
  fs.writeFileSync(path.join(__dirname, '../data/frames.json'), content);
});

function readFrames() {
  return recursive(framePath)
  .then(files => files.filter(path => /\.png$/.test(path)))
  .then(files => files.sort())
  .then(files => Promise.all(files.map(file => getFrameDetails(file))));
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
