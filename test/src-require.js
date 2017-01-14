'use strict';

const srcPath = require('./src-path');

const srcRequire = (name) => require(srcPath(name))

if(!global.srcRequire) {
  global.srcRequire = srcRequire;
}

module.exports = srcRequire;
