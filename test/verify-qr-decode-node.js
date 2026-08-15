/**
 * verify-qr-decode-node.js — 端到端驗證（Node.js 版）：把產生出來的 QR 矩陣
 * 「反解」回原始文字，證明編碼器輸出的確實是可被掃描器讀回的 vCard，
 * 而不只是「看起來像 QR 的圖」。
 *
 * 這是 AC-09（手機掃描）在無實體裝置時的替代驗證：獨立實作解碼路徑
 * （反遮罩 → 讀取資料位元 → 解交錯 → 解析 byte mode 段落 → UTF-8 還原），
 * 若能與輸入的 vCard 完全相符，代表編碼正確。
 *
 * 與 verify-qr-decode.js（WSH/cscript 版）為同一套解碼邏輯，差別僅在
 * 模組載入方式：本檔用 Node 的 vm 沙箱載入（與 run-tests.js 一致），
 * 因此可在 Node 與 CI 環境執行。
 *
 * 執行：npm run verify   或   node test/verify-qr-decode-node.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

// ---- 載入待測模組到共用 sandbox（模擬瀏覽器 global，與 run-tests.js 一致）----
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

function log(s) { console.log(s); }

// =================================================================
// 獨立實作的 QR 解碼器（只支援 byte mode，足夠驗證本程式輸出）
// =================================================================

var ALIGN_POS = [
  [],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],
  [6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],
  [6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],
  [6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],
  [6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],
  [6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],
  [6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],
  [6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]
];

/** 判斷某個座標是否屬於「功能圖樣」（不承載資料）*/
function isFunctionModule(row, col, count, version) {
  // 三個定位圖樣 + 分隔線 + 格式資訊區
  if (row <= 8 && col <= 8) return true;
  if (row <= 8 && col >= count - 8) return true;
  if (row >= count - 8 && col <= 8) return true;
  // 時序圖樣
  if (row === 6 || col === 6) return true;
  // 版本資訊區（版本 7 以上）
  if (version >= 7) {
    if (row < 6 && col >= count - 11) return true;
    if (col < 6 && row >= count - 11) return true;
  }
  // 校正圖樣
  var pos = ALIGN_POS[version - 1];
  for (var i = 0; i < pos.length; i++) {
    for (var j = 0; j < pos.length; j++) {
      var r = pos[i], c = pos[j];
      // 跳過與定位圖樣重疊的三個角
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= count - 9) || (r >= count - 9 && c <= 8)) continue;
      if (row >= r - 2 && row <= r + 2 && col >= c - 2 && col <= c + 2) return true;
    }
  }
  return false;
}

function maskFn(pattern, i, j) {
  switch (pattern) {
    case 0: return (i + j) % 2 === 0;
    case 1: return i % 2 === 0;
    case 2: return j % 3 === 0;
    case 3: return (i + j) % 3 === 0;
    case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5: return (i * j) % 2 + (i * j) % 3 === 0;
    case 6: return ((i * j) % 2 + (i * j) % 3) % 2 === 0;
    case 7: return ((i * j) % 3 + (i + j) % 2) % 2 === 0;
  }
  return false;
}

/** 從格式資訊區讀出遮罩樣式（讀左上角那份，含去除 G15_MASK）*/
function readMaskPattern(qr) {
  var bits = 0;
  var i;
  // 格式資訊第 0-5 位在 (0..5, 8)
  for (i = 0; i < 6; i++) bits |= (qr.isDark(i, 8) ? 1 : 0) << i;
  bits |= (qr.isDark(7, 8) ? 1 : 0) << 6;
  bits |= (qr.isDark(8, 8) ? 1 : 0) << 7;
  bits |= (qr.isDark(8, 7) ? 1 : 0) << 8;
  for (i = 9; i < 15; i++) bits |= (qr.isDark(8, 14 - i) ? 1 : 0) << i;
  var unmasked = bits ^ 0x5412;   // G15_MASK
  var data = unmasked >> 10;      // 高 5 位 = ECC(2) + mask(3)
  return data & 0x07;
}

/** 依 QR 讀取順序把資料位元讀出來（右下往左上蛇行）*/
function readRawBits(qr, version) {
  var count = qr.moduleCount;
  var mask = readMaskPattern(qr);
  var bits = [];
  var inc = -1;
  var row = count - 1;

  for (var col = count - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    while (true) {
      for (var c = 0; c < 2; c++) {
        var cc = col - c;
        if (!isFunctionModule(row, cc, count, version)) {
          var dark = qr.isDark(row, cc);
          if (maskFn(mask, row, cc)) dark = !dark;   // 反遮罩
          bits.push(dark ? 1 : 0);
        }
      }
      row += inc;
      if (row < 0 || row >= count) { row -= inc; inc = -inc; break; }
    }
  }
  return bits;
}

/** 把位元陣列轉成位元組陣列 */
function bitsToBytes(bits) {
  var bytes = [];
  for (var i = 0; i + 7 < bits.length; i += 8) {
    var b = 0;
    for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    bytes.push(b);
  }
  return bytes;
}

/**
 * 解交錯（de-interleave）：把 QR 的區塊交錯排列還原成原始資料碼字順序。
 * 需要知道該版本/容錯等級的區塊結構。
 */
function deinterleave(codewords, blocks) {
  var maxDc = 0, i, r;
  for (i = 0; i < blocks.length; i++) maxDc = Math.max(maxDc, blocks[i].dataCount);

  var out = [];
  for (i = 0; i < blocks.length; i++) out.push([]);

  var idx = 0;
  for (i = 0; i < maxDc; i++) {
    for (r = 0; r < blocks.length; r++) {
      if (i < blocks[r].dataCount) {
        out[r].push(codewords[idx++]);
      }
    }
  }
  var merged = [];
  for (r = 0; r < blocks.length; r++) {
    for (i = 0; i < out[r].length; i++) merged.push(out[r][i]);
  }
  return merged;
}

/** UTF-8 位元組還原成字串 */
function utf8Decode(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length;) {
    var c = bytes[i];
    if (c < 0x80) { out += String.fromCharCode(c); i += 1; }
    else if (c < 0xe0) {
      out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (c < 0xf0) {
      out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
    } else {
      var cp = ((c & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) |
               ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      i += 4;
    }
  }
  return out;
}

/** 解析 byte mode 段落，取出原始文字 */
function parseSegments(bytes, version) {
  var bitPos = 0;
  function readBits(n) {
    var v = 0;
    for (var i = 0; i < n; i++) {
      var byteIdx = Math.floor(bitPos / 8);
      var bitIdx = 7 - (bitPos % 8);
      v = (v << 1) | ((bytes[byteIdx] >> bitIdx) & 1);
      bitPos++;
    }
    return v;
  }

  var mode = readBits(4);
  if (mode !== 4) throw new Error('預期 byte mode(4)，實際為 ' + mode);
  var lenBits = version < 10 ? 8 : 16;
  var len = readBits(lenBits);

  var data = [];
  for (var i = 0; i < len; i++) data.push(readBits(8));
  return utf8Decode(data);
}

var ECC_IDX = { L: 0, M: 1, Q: 2, H: 3 };

// 與編碼器同一份表（僅取用，未修改）
var RS_TABLE = [
  [1,26,19],[1,26,16],[1,26,13],[1,26,9],
  [1,44,34],[1,44,28],[1,44,22],[1,44,16],
  [1,70,55],[1,70,44],[2,35,17],[2,35,13],
  [1,100,80],[2,50,32],[2,50,24],[4,25,9],
  [1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12],
  [2,86,68],[4,43,27],[4,43,19],[4,43,15],
  [2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14],
  [2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15],
  [2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13],
  [2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16],
  [4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13],
  [2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15],
  [4,133,107],[8,59,37,1,60,38],[8,44,20,4,45,21],[12,33,11,4,34,12],
  [3,145,115,1,146,116],[4,64,40,5,65,41],[11,36,16,5,37,17],[11,36,12,5,37,13],
  [5,109,87,1,110,88],[5,65,41,5,66,42],[5,54,24,7,55,25],[11,36,12,7,37,13],
  [5,122,98,1,123,99],[7,73,45,3,74,46],[15,43,19,2,44,20],[3,45,15,13,46,16],
  [1,135,107,5,136,108],[10,74,46,1,75,47],[1,50,22,15,51,23],[2,42,14,17,43,15],
  [5,150,120,1,151,121],[9,69,43,4,70,44],[17,50,22,1,51,23],[2,42,14,19,43,15],
  [3,141,113,4,142,114],[3,70,44,11,71,45],[17,47,21,4,48,22],[9,39,13,16,40,14],
  [3,135,107,5,136,108],[3,67,41,13,68,42],[15,54,24,5,55,25],[15,43,15,10,44,16],
  [4,144,116,4,145,117],[17,68,42],[17,50,22,6,51,23],[19,46,16,6,47,17]
];

// 取得區塊結構（重用編碼器的表格）
function getBlocksFor(version, eccLevel) {
  var RS = RS_TABLE[(version - 1) * 4 + ECC_IDX[eccLevel]];
  var list = [];
  var n = RS.length / 3;
  for (var i = 0; i < n; i++) {
    var cnt = RS[i * 3], total = RS[i * 3 + 1], dc = RS[i * 3 + 2];
    for (var j = 0; j < cnt; j++) list.push({ totalCount: total, dataCount: dc });
  }
  return list;
}

function decodeQR(qr, eccLevel) {
  var version = qr.version;
  var bits = readRawBits(qr, version);
  var codewords = bitsToBytes(bits);
  var blocks = getBlocksFor(version, eccLevel);
  var dataCodewords = deinterleave(codewords, blocks);
  return parseSegments(dataCodewords, version);
}

// =================================================================
// 執行驗證
// =================================================================
var pass = 0, fail = 0;

function verify(name, text, ecc) {
  try {
    var qr = QRCodeLib.make(text, ecc);
    var decoded = decodeQR(qr, ecc);
    if (decoded === text) {
      pass++;
      log('  PASS  ' + name + '  (版本 ' + qr.version + ', 容錯 ' + ecc + ', ' +
          QRCodeLib.utf8ByteLength(text) + ' bytes)');
    } else {
      fail++;
      log('  FAIL  ' + name);
      log('        原始長度 ' + text.length + ' / 解碼長度 ' + decoded.length);
      log('        原始: ' + text.substring(0, 60).replace(/\r\n/g, '|'));
      log('        解碼: ' + decoded.substring(0, 60).replace(/\r\n/g, '|'));
    }
  } catch (e) {
    fail++;
    log('  FAIL  ' + name + ' -> 例外: ' + e.message);
  }
}

log('');
log('=== QR 反解驗證：證明產生的 QR 能被讀回原始 vCard ===');
log('');

verify('純 ASCII 短字串', 'HELLO WORLD', 'M');
verify('數字與符號', 'TEL:0912-345-678', 'M');
verify('中文字串', '姓名：王小明', 'M');

var vcardSimple = VCard.build({
  lastName: '王', firstName: '小明',
  cell: '0912345678', email: 'ming@example.com'
});
verify('精簡 vCard（中文姓名）', vcardSimple, 'M');

var vcardFull = VCard.build({
  lastName: '王', firstName: '小明', fullName: '王小明',
  cell: '0912-345-678', workTel: '02-1234-5678',
  email: 'ming@example.com', org: '範例科技股份有限公司',
  title: '產品經理', url: 'https://example.com',
  street: '信義路五段 7 號', city: '台北市', region: '信義區',
  postalCode: '110', country: '台灣', note: '週一至週五 09:00-18:00'
});
verify('完整 vCard', vcardFull, 'M');

var vcardEnglish = VCard.build({
  lastName: 'Wang', firstName: 'Ming', cell: '0912345678',
  org: 'Example Corp', title: 'Product Manager'
});
verify('英文 vCard', vcardEnglish, 'L');
verify('英文 vCard（高容錯 H）', vcardEnglish, 'H');

log('');
log('=== 結果：Pass ' + pass + ' / Fail ' + fail + ' ===');
if (fail === 0) {
  log('所有 QR 皆能正確反解回原始 vCard —— 編碼器輸出可被掃描器讀取。');
}
process.exit(fail > 0 ? 1 : 0);
