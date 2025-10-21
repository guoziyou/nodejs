/*
 * 这是新的 index.js (加载器)
 */
const bytenode = require('bytenode');
const path = require('path');

// 构造指向 main.jsc 的路径
const compiledScript = path.join(__dirname, 'main.jsc');

// 加载并运行编译后的字节码
require(compiledScript);