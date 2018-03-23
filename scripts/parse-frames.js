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
