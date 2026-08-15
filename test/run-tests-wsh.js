/**
 * run-tests-wsh.js — 單元測試 runner（Windows Script Host 版）。
 *
 * 用途：本機未安裝 Node.js 時（專案已知風險 R-01）仍能實際驗證核心邏輯。
 * 測試案例本身放在 test-cases.js，與 Node 版 runner 共用同一份。
 *
 * 執行：powershell -ExecutionPolicy Bypass -File test\run-tests.ps1
 *      （該腳本會先轉成 UTF-16 再交給 cscript，否則中文會損毀）
 */

var fso = new ActiveXObject('Scripting.FileSystemObject');
var scriptDir = fso.GetParentFolderName(WScript.ScriptFullName);
var projDir = fso.GetParentFolderName(scriptDir);
var srcDir = fso.BuildPath(projDir, 'src');

function log(s) { WScript.Echo(s); }

/** 以 UTF-8 讀取檔案（ADODB.Stream 才能正確處理中文）*/
function readUtf8(filePath) {
  var stream = new ActiveXObject('ADODB.Stream');
  stream.Type = 2;              // adTypeText
  stream.Charset = 'utf-8';
  stream.Open();
  stream.LoadFromFile(filePath);
  var text = stream.ReadText();
  stream.Close();
  return text;
}

// ---- ES5 shim ----
// WSH 的 JScript 是 ES3 引擎，缺少部分 ES5 方法。待測程式碼只依賴
// 「瀏覽器與 Electron 皆已內建」的標準方法，因此在測試環境補上即可，
// 不需要為了遷就測試工具而修改產品程式碼。
(function () {
  var ap = Array.prototype;
  if (!ap.forEach) {
    ap.forEach = function (fn, ctx) {
      for (var i = 0; i < this.length; i++) fn.call(ctx, this[i], i, this);
    };
  }
  if (!ap.map) {
    ap.map = function (fn, ctx) {
      var out = [];
      for (var i = 0; i < this.length; i++) out.push(fn.call(ctx, this[i], i, this));
      return out;
    };
  }
  if (!ap.filter) {
    ap.filter = function (fn, ctx) {
      var out = [];
      for (var i = 0; i < this.length; i++) {
        if (fn.call(ctx, this[i], i, this)) out.push(this[i]);
      }
      return out;
    };
  }
  if (!ap.every) {
    ap.every = function (fn, ctx) {
      for (var i = 0; i < this.length; i++) {
        if (!fn.call(ctx, this[i], i, this)) return false;
      }
      return true;
    };
  }
  if (!ap.some) {
    ap.some = function (fn, ctx) {
      for (var i = 0; i < this.length; i++) {
        if (fn.call(ctx, this[i], i, this)) return true;
      }
      return false;
    };
  }
  if (!ap.indexOf) {
    ap.indexOf = function (item) {
      for (var i = 0; i < this.length; i++) if (this[i] === item) return i;
      return -1;
    };
  }
  if (!Array.isArray) {
    Array.isArray = function (v) {
      return Object.prototype.toString.call(v) === '[object Array]';
    };
  }
  if (!String.prototype.trim) {
    String.prototype.trim = function () {
      return this.replace(/^\s+|\s+$/g, '');
    };
  }
})();

// WSH 沒有 window，建立一個讓待測模組掛載 global 物件
var window = {};
var module = undefined;   // 讓 test-cases.js 的 CommonJS 分支不會被觸發

function loadFile(fullPath) {
  if (!fso.FileExists(fullPath)) throw new Error('找不到檔案: ' + fullPath);
  eval(readUtf8(fullPath));
}

loadFile(fso.BuildPath(srcDir, 'lib\\vcard.js'));
loadFile(fso.BuildPath(srcDir, 'lib\\csv.js'));
loadFile(fso.BuildPath(srcDir, 'vendor\\qrcode.js'));

var VCard = window.VCard;
var QRCodeLib = window.QRCodeLib;
var CSV = window.CSV;

if (!VCard) throw new Error('VCard 未正確載入');
if (!QRCodeLib) throw new Error('QRCodeLib 未正確載入');
if (!CSV) throw new Error('CSV 未正確載入');

// ---- 極簡測試框架 ----
var pass = 0, fail = 0, failures = [];

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
// eval 在函式內只會建立區域繫結，因此讓 test-cases.js 把函式掛到這個註冊物件上
var globalTestRegistry = {};
loadFile(fso.BuildPath(scriptDir, 'test-cases.js'));

if (typeof globalTestRegistry.defineTestCases !== 'function') {
  throw new Error('test-cases.js 未正確匯出 defineTestCases');
}

globalTestRegistry.defineTestCases({
  log: log, test: test,
  assert: assert, assertEqual: assertEqual,
  assertContains: assertContains, assertThrows: assertThrows,
  repeat: repeat,
  VCard: VCard, QRCodeLib: QRCodeLib, CSV: CSV
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
  for (var i = 0; i < failures.length; i++) log('   - ' + failures[i]);
}
log('==========================================');

WScript.Quit(fail > 0 ? 1 : 0);
