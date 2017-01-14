'use strict';

const path = require('path');

const srcPath = (name) => path.resolve(__dirname, '../src', name);

if(!global.srcPath) {
  global.srcPath = srcPath;
}

module.exports = srcPath;
