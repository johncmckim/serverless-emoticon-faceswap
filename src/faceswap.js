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
const ALLOWED_EXTENSIONS = process.env.ALLOWED_EXTENSIONS.split('|');
const PROCESSED_DIR_NAME = process.env.PROCESSED_DIR_NAME;

const unlinkAsync = BbPromise.promisify(fs.unlink);

const log = (msg, obj) => obj ?
    console.log(msg, JSON.stringify(obj, null, 2)) :
    console.log(msg);

const getImagesFromEvent = (event) => event.Records.reduce((accum, r) => {
    if (r.s3.bucket.name === BUCKET_NAME) {
        const key = r.s3.object.key;
        const extension = path.extname(key).toLowerCase();

        if (ALLOWED_EXTENSIONS.indexOf(extension) !== -1) {
            accum.push(key);
        }
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
        },
        Attributes: [
            'ALL',
        ]
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

const getImageSize = (image, bufferStream) => new BbPromise((resolve, reject) => {
    image.size({
        bufferStream: bufferStream
    }, (err, result) => {
        if (err) {
            reject(err);
            return;
        }

        log('Found size info', result);
        resolve(result);
    });
});

const getTmpPath = (imageName) => path.join('/tmp', uuidV4() + path.extname(imageName));

const createTempEmoji = (emojiType, width, height) => new BbPromise((resolve, reject) => {
    const emojiPath = path.join(__dirname, 'emoji', emojiType + '.png');
    const tempPath = getTmpPath('emoji.png');

    log('Creating tmp emoji image', {
        tempPath,
        width,
        height,
        emojiType
    });

    gm(emojiPath)
        .resize(width.toString(), height.toString())
        .write(tempPath, (err) => {
            if (err) reject(err);
            resolve(tempPath);
        });
});

const imageToDisk = (image, path) => new BbPromise((resolve, reject) => {
    image.write(path, (err) => {
        if (err) reject(err);
        else resolve(path);
    });
});

const imageToBuffer = (image) => new BbPromise((resolve, reject) => {
    image.toBuffer('jpg', (err, buffer) => {
        if (err) reject(err);
        else resolve(buffer);
    });
});

const getEmojiType = (faceDetails) => {
    if (!faceDetails.Emotions) return 'unknown'

    const emotion = faceDetails.Emotions.reduce((mostLikely, e) => {
        if (mostLikely.Confidence < e.Confidence) {
            mostLikely = e;
        }
        return mostLikely;
    });

    switch (emotion.Type) {
        case 'HAPPY':
        case 'SAD':
        case 'ANGRY':
        case 'CONFUSED':
        case 'DISGUSTED':
        case 'SURPRISED':
        case 'CALM':
            return emotion.Type.toLowerCase();
        case 'UNKNOWN':
        default:
            return 'unknown';
    }
}

const overlayEmoji = BbPromise.coroutine(function* (image, imageHeight, imageWidth, face, tmpEmojis) {
    const boundingBox = face.BoundingBox;

    const emojiWidth = parseInt(boundingBox.Width * imageWidth, 10) + 10;
    const emojiHeight = parseInt(boundingBox.Height * imageHeight, 10) + 10;
    const emojiType = getEmojiType(face);

    const emojiPath = yield createTempEmoji(emojiType, emojiWidth, emojiHeight);

    tmpEmojis.push(emojiPath);

    const xy = `+${boundingBox.Left * imageWidth}+${boundingBox.Top * imageHeight}`

    log('Composing image', { emojiPath, xy });

    return image.in('-page', xy, emojiPath);
});

const overlayFacesWithEmoji = BbPromise.coroutine(function* (imagePath, imageData, faceDetails) {
    const tmpEmojis = [];

    try {
        const image = gm(imageData);

        const sizeResult = yield getImageSize(image, true);
        const tempImagePath = yield imageToDisk(image, getTmpPath(imagePath));

        tmpEmojis.push(tempImagePath);

        const height = sizeResult.height;
        const width = sizeResult.width;

        const composedImage = yield BbPromise.reduce(faceDetails, (i, face) =>
            overlayEmoji(i, height, width, face, tmpEmojis),
            gm().in('-page', '+0+0', tempImagePath) // init with image
        );

        log('Composed image');

        const newImageBuffer = yield imageToBuffer(composedImage.mosaic());

        yield uploadImage(imagePath, newImageBuffer);
    } catch (e) {
        throw e;
    } finally {
        log('Cleaning up tmp images ', tmpEmojis);

        if (tmpEmojis.length) {
            // Clean up! - this is important Lambda is not completely stateless
            yield BbPromise.all(tmpEmojis, (p) => unlinkAsync(p));
        }
    }
});

const processImages = (imageFaces) => BbPromise.map(Object.keys(imageFaces), (imagePath) =>
    downloadImage(imagePath).then((response) => {
        const faceDetails = imageFaces[imagePath].FaceDetails;

        return overlayFacesWithEmoji(imagePath, response.Body, faceDetails);
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
