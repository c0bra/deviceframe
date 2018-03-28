// NOTE: this should not be needed anymore since we use the rawgit CDN

const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');

const s3 = new AWS.S3();
const framesJson = path.join(__dirname, '../data/frames.json');
const content = fs.readFileSync(framesJson, 'utf-8');
const frames = JSON.parse(content);

for (const frame of frames) {
  console.log(frame);

  s3.upload({
    Bucket: 'deviceframe',
    Key: frame.relPath,
    Body: fs.createReadStream(path.join(__dirname, '../node_modules/deviceframe-frames', frame.relPath)),
    ContentType: 'image/png',
    ACL: 'public-read',
  }, (err, data) => {
    if (err) return console.error(err);

    console.log('Successfully uploaded ' + frame.relPath);
    console.log(data);
  });
}
