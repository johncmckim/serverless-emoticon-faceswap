'use strict';

const AWS = require('aws-sdk');
const BbPromise = require('bluebird');
const path = require('path');
const fs = require('fs');
const uuidV4 = require('uuid/v4');

const rekognition = new AWS.Rekognition();
const s3 = new AWS.S3();

// See https://github.com/aheckmann/gm
const gm = require('gm').subClass({
    imageMagick: true
}); // Enable ImageMagick integration.

const BUCKET_NAME = process.env.BUCKET_NAME;
const PROCESSED_DIR_NAME = process.env.PROCESSED_DIR_NAME;

const log = (msg, obj) => console.log(msg, JSON.stringify(obj, null, 2));

const getImagesFromEvent = (event) => event.Records.reduce((accum, r) => {
    if (r.s3.bucket.name === BUCKET_NAME) {
        accum.push(r.s3.object.key);
    }

    return accum;
}, []);

const detectFacesOnImages = (images) => BbPromise.reduce(images, (accum, i) => {
    const params = {
        Image: {
            S3Object: {
                Bucket: BUCKET_NAME,
                Name: i,
            }
        }
    };

    return new BbPromise((resolve, reject) => {
        rekognition.detectFaces(params, (err, data) => {
            if (err) reject(err);

            if (data.FaceDetails.length) {
                accum[i] = data;
            }

            resolve(accum);
        })
    });
}, {});

const downloadImage = (imagePath) => new BbPromise((resolve, reject) => {
    const params = {
        Bucket: BUCKET_NAME,
        Key: imagePath
    };

    s3.getObject(params, (err, data) => {
        if (err) reject(err);
        else resolve(data);
    });
});

const uploadImage = (imagePath, imageData) => new BbPromise((resolve, reject) => {
    const fileName = path.basename(imagePath);
    const params = {
        Bucket: BUCKET_NAME,
        Key: path.join(PROCESSED_DIR_NAME, fileName),
        Body: imageData,
    };

    s3.putObject(params, (err, data) => {
        if (err) reject(err);
        else resolve(data);
    });
});

const getImageSize = (image) => new BbPromise((resolve, reject) => {
    image.size({ bufferStream: true }, (err, result) => {
        if (err) {
            reject(err);
            return;
        }

        log('Found size info', result);
        resolve(result);
    });
})

const createTempEmoji = (emojiType, width, height) => new BbPromise((resolve, reject) => {
    const emojiPath = path.join(__dirname, 'emoji', emojiType + '.png');
    const tempPath = path.join('/tmp', uuidV4() + '.png');

    log('Creating tmp emoji image', { tempPath, width, height, emojiType });

    gm(emojiPath)
        .resize(width.toString(), height.toString())
        .write(tempPath, (err) => {
            if (err) reject(err);
            resolve(tempPath);
        });
});

const composeImageToBuffer = (image, compositePath, xy) => new BbPromise((resolve, reject) => {
    log('Composing image', { compositePath, xy });

    image
        .composite(compositePath)
        .geometry(xy)
        .toBuffer('jpg', (err, buffer) => {
            if(err) reject(err);
            else resolve(buffer);
        });
});

const overlayEmoji = BbPromise.coroutine(function* (imagePath, imageData, emojiType, faceDetails) {
    const image = gm(imageData);

    const sizeResult = yield getImageSize(image);
    const height = sizeResult.height;
    const width = sizeResult.width;
    // Get first face
    const boundingBox = faceDetails[0].BoundingBox;

    const emojiWidth = parseInt(boundingBox.Width * width, 10) + 10;
    const emojiHeight = parseInt(boundingBox.Height * height, 10) + 10;

    const emojiPath = yield createTempEmoji(emojiType, emojiWidth, emojiHeight);

    const xy = `+${boundingBox.Left * width}+${boundingBox.Top * height}`

    const newImageBuffer = yield composeImageToBuffer(image, emojiPath, xy);

    // Clean up! - this is important Lambda is not completely stateless
    fs.unlinkSync(emojiPath);

    yield uploadImage(imagePath, newImageBuffer)
});

const processImages = (imageFaces) => BbPromise.map(Object.keys(imageFaces), (imagePath) =>
    downloadImage(imagePath).then((response) => {
        const faceDetails = imageFaces[imagePath].FaceDetails;

        return overlayEmoji(imagePath, response.Body, 'smile', faceDetails);
    })
);

module.exports.handler = BbPromise.coroutine(function* (event, context, cb) {
    try {
        log('Recieved Event', event);

        const images = getImagesFromEvent(event);

        log('Found images on event', images);

        const imageFaces = yield detectFacesOnImages(images);

        log('Detected faces', imageFaces);

        yield processImages(imageFaces);

        cb(null);
    } catch (err) {
        log('Error', err);
        cb(err);
    }
});
