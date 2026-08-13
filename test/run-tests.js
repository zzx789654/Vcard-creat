/**
 * run-tests.js — 單元測試 runner（Node.js 版）。
 *
 * 測試案例本身放在 test-cases.js（兩個 runner 共用，避免維護兩份）。
 * 本檔只負責：載入待測模組、提供測試框架、彙整統計。
 *
 * 執行：npm test   或   node test/run-tests.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

// ---- 載入待測模組到共用 sandbox（模擬瀏覽器 global）----
var sandbox = { window: {}, console: console };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);

function loadInto(file) {
  var full = path.join(__dirname, '..', 'src', file);
  var code = fs.readFileSync(full, 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
}

loadInto('lib/vcard.js');
loadInto('vendor/qrcode.js');

var VCard = sandbox.window.VCard;
var QRCodeLib = sandbox.window.QRCodeLib;

if (!VCard) throw new Error('VCard 未正確載入');
if (!QRCodeLib) throw new Error('QRCodeLib 未正確載入');

// ---- 極簡測試框架 ----
var pass = 0, fail = 0, failures = [];

function log(s) { console.log(s); }

function test(name, fn) {
  try {
    fn();
    pass++;
    log('  PASS  ' + name);
  } catch (e) {
    fail++;
    failures.push(name + ': ' + e.message);
    log('  FAIL  ' + name);
    log('          -> ' + e.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'not equal') +
      ' | expected: ' + expected + ' | actual: ' + actual);
  }
}

function assertContains(haystack, needle, msg) {
  if (haystack.indexOf(needle) === -1) {
    throw new Error((msg || 'missing substring') + ': ' + needle);
  }
}

function assertThrows(fn, expectedMsg) {
  var threw = false;
  try { fn(); } catch (e) {
    threw = true;
    if (expectedMsg && e.message !== expectedMsg) {
      throw new Error('threw wrong error: ' + e.message + ' (want ' + expectedMsg + ')');
    }
  }
  if (!threw) throw new Error('expected throw but none');
}

function repeat(s, n) {
  var out = '';
  for (var i = 0; i < n; i++) out += s;
  return out;
}

// ---- 執行共用測試案例 ----
var defineTestCases = require('./test-cases.js');

defineTestCases({
  log: log, test: test,
  assert: assert, assertEqual: assertEqual,
  assertContains: assertContains, assertThrows: assertThrows,
  repeat: repeat,
  VCard: VCard, QRCodeLib: QRCodeLib
});

// ---- 統計 ----
log('');
log('================ 測試結果 ================');
log('  通過 (Pass)  : ' + pass);
log('  失敗 (Fail)  : ' + fail);
log('  總計         : ' + (pass + fail));
log('  通過率       : ' + (pass + fail === 0 ? '0' : (pass / (pass + fail) * 100).toFixed(1)) + '%');
if (fail > 0) {
  log('');
  log('  失敗清單：');
  failures.forEach(function (f) { log('   - ' + f); });
}
log('==========================================');

process.exit(fail > 0 ? 1 : 0);
