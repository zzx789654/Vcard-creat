/*!
 * qrcode.js — 精簡 QR Code 編碼器（byte mode / UTF-8）
 * 基於 Kazuhiko Arase 的 qrcode-generator 演算法實作，MIT License。
 * 本檔為離線內嵌版本：無任何外部相依、無網路請求。
 *
 * 對外 API：
 *   QRCodeLib.make(text, eccLevel) -> { moduleCount, isDark(r,c), version }
 *   丟出 Error('DATA_TOO_LONG') 表示資料超出 QR 容量。
 */
(function (global) {
  'use strict';

  // ---- 錯誤修正等級（QR 規格的位元值，非序號）----
  var ECC = { L: 1, M: 0, Q: 3, H: 2 };

  // ---- 遮罩樣式 ----
  var MASK = { P000: 0, P001: 1, P010: 2, P011: 3, P100: 4, P101: 5, P110: 6, P111: 7 };

  // ---- Galois Field GF(256)：Reed-Solomon 糾錯所需 ----
  var EXP = [], LOG = [];
  (function initGF() {
    var i;
    for (i = 0; i < 8; i++) EXP[i] = 1 << i;
    for (i = 8; i < 256; i++) {
      EXP[i] = EXP[i - 4] ^ EXP[i - 5] ^ EXP[i - 6] ^ EXP[i - 8];
    }
    for (i = 0; i < 255; i++) LOG[EXP[i]] = i;
  })();

  function gexp(n) {
    while (n < 0) n += 255;
    while (n >= 256) n -= 255;
    return EXP[n];
  }
  function glog(n) {
    if (n < 1) throw new Error('glog(' + n + ')');
    return LOG[n];
  }

  // ---- 多項式（用於產生 RS 生成多項式）----
  function Poly(num, shift) {
    var offset = 0;
    while (offset < num.length && num[offset] === 0) offset++;
    this.num = new Array(num.length - offset + shift);
    for (var i = 0; i < num.length - offset; i++) this.num[i] = num[i + offset];
  }
  Poly.prototype = {
    get: function (i) { return this.num[i]; },
    getLength: function () { return this.num.length; },
    multiply: function (e) {
      var num = new Array(this.getLength() + e.getLength() - 1);
      var i, j;
      for (i = 0; i < num.length; i++) num[i] = 0;
      for (i = 0; i < this.getLength(); i++) {
        for (j = 0; j < e.getLength(); j++) {
          num[i + j] ^= gexp(glog(this.get(i)) + glog(e.get(j)));
        }
      }
      return new Poly(num, 0);
    },
    mod: function (e) {
      if (this.getLength() - e.getLength() < 0) return this;
      var ratio = glog(this.get(0)) - glog(e.get(0));
      var num = this.num.slice();
      for (var i = 0; i < e.getLength(); i++) {
        num[i] ^= gexp(glog(e.get(i)) + ratio);
      }
      return new Poly(num, 0).mod(e);
    }
  };

  function rsPoly(errorCorrectLength) {
    var a = new Poly([1], 0);
    for (var i = 0; i < errorCorrectLength; i++) {
      a = a.multiply(new Poly([1, gexp(i)], 0));
    }
    return a;
  }

  // ---- RS 區塊表：版本 1..40 × 4 種 ECC，每組 [區塊數, 總碼字數, 資料碼字數] ----
  var RS_BLOCK_TABLE = [
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
    [4,144,116,4,145,117],[17,68,42],[17,50,22,6,51,23],[19,46,16,6,47,17],
    [2,139,111,7,140,112],[17,74,46],[7,54,24,16,55,25],[34,37,13],
    [4,151,121,5,152,122],[4,75,47,14,76,48],[11,54,24,14,55,25],[16,45,15,14,46,16],
    [6,147,117,4,148,118],[6,73,45,14,74,46],[11,54,24,16,55,25],[30,46,16,2,47,17],
    [8,132,106,4,133,107],[8,75,47,13,76,48],[7,54,24,22,55,25],[22,45,15,13,46,16],
    [10,142,114,2,143,115],[19,74,46,4,75,47],[28,50,22,6,51,23],[33,46,16,4,47,17],
    [8,152,122,4,153,123],[22,73,45,3,74,46],[8,53,23,26,54,24],[12,45,15,28,46,16],
    [3,147,117,10,148,118],[3,73,45,23,74,46],[4,54,24,31,55,25],[11,45,15,31,46,16],
    [7,146,116,7,147,117],[21,73,45,7,74,46],[1,53,23,37,54,24],[19,45,15,26,46,16],
    [5,145,115,10,146,116],[19,75,47,10,76,48],[15,54,24,25,55,25],[23,45,15,25,46,16],
    [13,145,115,3,146,116],[2,74,46,29,75,47],[42,54,24,1,55,25],[23,45,15,28,46,16],
    [17,145,115],[10,74,46,23,75,47],[10,54,24,35,55,25],[19,45,15,35,46,16],
    [17,145,115,1,146,116],[14,74,46,21,75,47],[29,54,24,19,55,25],[11,45,15,46,46,16],
    [13,145,115,6,146,116],[14,74,46,23,75,47],[44,54,24,7,55,25],[59,46,16,1,47,17],
    [12,151,121,7,152,122],[12,75,47,26,76,48],[39,54,24,14,55,25],[22,45,15,41,46,16],
    [6,151,121,14,152,122],[6,76,47,34,77,48],[46,54,24,10,55,25],[2,45,15,64,46,16],
    [17,152,122,4,153,123],[29,74,46,14,75,47],[49,54,24,10,55,25],[24,45,15,46,46,16],
    [4,152,121,18,153,122],[13,74,46,32,75,47],[48,54,24,14,55,25],[42,45,15,32,46,16],
    [20,147,117,4,148,118],[40,75,47,7,76,48],[43,54,24,22,55,25],[10,45,15,67,46,16],
    [19,148,118,6,149,119],[18,75,47,31,76,48],[34,54,24,34,55,25],[20,45,15,61,46,16]
  ];

  function getRsBlocks(typeNumber, ecc) {
    var eccIdx = ecc === ECC.L ? 0 : ecc === ECC.M ? 1 : ecc === ECC.Q ? 2 : 3;
    var rsBlock = RS_BLOCK_TABLE[(typeNumber - 1) * 4 + eccIdx];
    if (!rsBlock) throw new Error('bad rs block @ type:' + typeNumber);
    var length = rsBlock.length / 3;
    var list = [];
    for (var i = 0; i < length; i++) {
      var count = rsBlock[i * 3 + 0];
      var totalCount = rsBlock[i * 3 + 1];
      var dataCount = rsBlock[i * 3 + 2];
      for (var j = 0; j < count; j++) {
        list.push({ totalCount: totalCount, dataCount: dataCount });
      }
    }
    return list;
  }

  // ---- 位元緩衝區 ----
  function BitBuffer() { this.buffer = []; this.length = 0; }
  BitBuffer.prototype = {
    put: function (num, length) {
      for (var i = 0; i < length; i++) {
        this.putBit(((num >>> (length - i - 1)) & 1) === 1);
      }
    },
    putBit: function (bit) {
      var bufIndex = Math.floor(this.length / 8);
      if (this.buffer.length <= bufIndex) this.buffer.push(0);
      if (bit) this.buffer[bufIndex] |= (0x80 >>> (this.length % 8));
      this.length++;
    }
  };

  // ---- UTF-8 編碼（vCard 常含中文，必須用 byte mode + UTF-8）----
  function toUtf8Bytes(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        bytes.push(c);
      } else if (c < 0x800) {
        bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        // surrogate pair（emoji 等 4-byte 字元）
        var c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          var cp = ((c - 0xd800) << 10) + (c2 - 0xdc00) + 0x10000;
          bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
                     0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
          i++;
        } else {
          bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        }
      } else {
        bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return bytes;
  }

  // ---- BCH 碼（格式資訊與版本資訊）----
  var G15 = (1<<10)|(1<<8)|(1<<5)|(1<<4)|(1<<2)|(1<<1)|(1<<0);
  var G18 = (1<<12)|(1<<11)|(1<<10)|(1<<9)|(1<<8)|(1<<5)|(1<<2)|(1<<0);
  var G15_MASK = (1<<14)|(1<<12)|(1<<10)|(1<<4)|(1<<1);

  function bchDigit(data) {
    var digit = 0;
    while (data !== 0) { digit++; data >>>= 1; }
    return digit;
  }
  function bchTypeInfo(data) {
    var d = data << 10;
    while (bchDigit(d) - bchDigit(G15) >= 0) {
      d ^= (G15 << (bchDigit(d) - bchDigit(G15)));
    }
    return ((data << 10) | d) ^ G15_MASK;
  }
  function bchTypeNumber(data) {
    var d = data << 12;
    while (bchDigit(d) - bchDigit(G18) >= 0) {
      d ^= (G18 << (bchDigit(d) - bchDigit(G18)));
    }
    return (data << 12) | d;
  }

  // ---- 校正圖樣位置表 ----
  var PATTERN_POSITION_TABLE = [
    [],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],
    [6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],
    [6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],
    [6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],
    [6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],
    [6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],
    [6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],
    [6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]
  ];

  function getMaskFn(maskPattern) {
    switch (maskPattern) {
      case MASK.P000: return function (i, j) { return (i + j) % 2 === 0; };
      case MASK.P001: return function (i) { return i % 2 === 0; };
      case MASK.P010: return function (i, j) { return j % 3 === 0; };
      case MASK.P011: return function (i, j) { return (i + j) % 3 === 0; };
      case MASK.P100: return function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; };
      case MASK.P101: return function (i, j) { return (i * j) % 2 + (i * j) % 3 === 0; };
      case MASK.P110: return function (i, j) { return ((i * j) % 2 + (i * j) % 3) % 2 === 0; };
      case MASK.P111: return function (i, j) { return ((i * j) % 3 + (i + j) % 2) % 2 === 0; };
      default: throw new Error('bad mask:' + maskPattern);
    }
  }

  // ---- 主體 ----
  function QRCode(typeNumber, ecc) {
    this.typeNumber = typeNumber;
    this.ecc = ecc;
    this.modules = null;
    this.moduleCount = 0;
    this.dataCache = null;
    this.dataList = [];
  }

  QRCode.prototype = {
    addData: function (data) {
      this.dataList.push({ mode: 4, data: data, bytes: toUtf8Bytes(data) });
      this.dataCache = null;
    },

    isDark: function (row, col) {
      if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) {
        throw new Error(row + ',' + col);
      }
      return this.modules[row][col];
    },

    getModuleCount: function () { return this.moduleCount; },

    make: function () { this.makeImpl(false, this.getBestMaskPattern()); },

    makeImpl: function (test, maskPattern) {
      this.moduleCount = this.typeNumber * 4 + 17;
      this.modules = [];
      for (var row = 0; row < this.moduleCount; row++) {
        this.modules[row] = new Array(this.moduleCount);
        for (var col = 0; col < this.moduleCount; col++) this.modules[row][col] = null;
      }
      this.setupPositionProbePattern(0, 0);
      this.setupPositionProbePattern(this.moduleCount - 7, 0);
      this.setupPositionProbePattern(0, this.moduleCount - 7);
      this.setupPositionAdjustPattern();
      this.setupTimingPattern();
      this.setupTypeInfo(test, maskPattern);
      if (this.typeNumber >= 7) this.setupTypeNumber(test);
      if (this.dataCache === null) {
        this.dataCache = QRCode.createData(this.typeNumber, this.ecc, this.dataList);
      }
      this.mapData(this.dataCache, maskPattern);
    },

    setupPositionProbePattern: function (row, col) {
      for (var r = -1; r <= 7; r++) {
        if (row + r <= -1 || this.moduleCount <= row + r) continue;
        for (var c = -1; c <= 7; c++) {
          if (col + c <= -1 || this.moduleCount <= col + c) continue;
          this.modules[row + r][col + c] =
            (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
            (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
            (2 <= r && r <= 4 && 2 <= c && c <= 4);
        }
      }
    },

    getBestMaskPattern: function () {
      var minLostPoint = 0, pattern = 0;
      for (var i = 0; i < 8; i++) {
        this.makeImpl(true, i);
        var lostPoint = QRCode.getLostPoint(this);
        if (i === 0 || minLostPoint > lostPoint) { minLostPoint = lostPoint; pattern = i; }
      }
      return pattern;
    },

    setupTimingPattern: function () {
      var r, c;
      for (r = 8; r < this.moduleCount - 8; r++) {
        if (this.modules[r][6] !== null) continue;
        this.modules[r][6] = (r % 2 === 0);
      }
      for (c = 8; c < this.moduleCount - 8; c++) {
        if (this.modules[6][c] !== null) continue;
        this.modules[6][c] = (c % 2 === 0);
      }
    },

    setupPositionAdjustPattern: function () {
      var pos = PATTERN_POSITION_TABLE[this.typeNumber - 1];
      for (var i = 0; i < pos.length; i++) {
        for (var j = 0; j < pos.length; j++) {
          var row = pos[i], col = pos[j];
          if (this.modules[row][col] !== null) continue;
          for (var r = -2; r <= 2; r++) {
            for (var c = -2; c <= 2; c++) {
              this.modules[row + r][col + c] =
                (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0));
            }
          }
        }
      }
    },

    setupTypeNumber: function (test) {
      var bits = bchTypeNumber(this.typeNumber);
      var i, mod;
      for (i = 0; i < 18; i++) {
        mod = (!test && ((bits >> i) & 1) === 1);
        this.modules[Math.floor(i / 3)][i % 3 + this.moduleCount - 8 - 3] = mod;
      }
      for (i = 0; i < 18; i++) {
        mod = (!test && ((bits >> i) & 1) === 1);
        this.modules[i % 3 + this.moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    },

    setupTypeInfo: function (test, maskPattern) {
      var data = (this.ecc << 3) | maskPattern;
      var bits = bchTypeInfo(data);
      var i, mod;
      for (i = 0; i < 15; i++) {
        mod = (!test && ((bits >> i) & 1) === 1);
        if (i < 6) this.modules[i][8] = mod;
        else if (i < 8) this.modules[i + 1][8] = mod;
        else this.modules[this.moduleCount - 15 + i][8] = mod;
      }
      for (i = 0; i < 15; i++) {
        mod = (!test && ((bits >> i) & 1) === 1);
        if (i < 8) this.modules[8][this.moduleCount - i - 1] = mod;
        else if (i < 9) this.modules[8][15 - i - 1 + 1] = mod;
        else this.modules[8][15 - i - 1] = mod;
      }
      this.modules[this.moduleCount - 8][8] = !test;
    },

    mapData: function (data, maskPattern) {
      var inc = -1, row = this.moduleCount - 1, bitIndex = 7, byteIndex = 0;
      var maskFn = getMaskFn(maskPattern);
      for (var col = this.moduleCount - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        while (true) {
          for (var c = 0; c < 2; c++) {
            if (this.modules[row][col - c] === null) {
              var dark = false;
              if (byteIndex < data.length) {
                dark = (((data[byteIndex] >>> bitIndex) & 1) === 1);
              }
              if (maskFn(row, col - c)) dark = !dark;
              this.modules[row][col - c] = dark;
              bitIndex--;
              if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
            }
          }
          row += inc;
          if (row < 0 || this.moduleCount <= row) { row -= inc; inc = -inc; break; }
        }
      }
    }
  };

  QRCode.PAD0 = 0xEC;
  QRCode.PAD1 = 0x11;

  QRCode.createData = function (typeNumber, ecc, dataList) {
    var rsBlocks = getRsBlocks(typeNumber, ecc);
    var buffer = new BitBuffer();
    var i, j;
    for (i = 0; i < dataList.length; i++) {
      var data = dataList[i];
      buffer.put(data.mode, 4);
      // byte mode 長度位元數：版本 1-9 用 8 bits，版本 10 以上用 16 bits
      buffer.put(data.bytes.length, typeNumber < 10 ? 8 : 16);
      for (j = 0; j < data.bytes.length; j++) buffer.put(data.bytes[j], 8);
    }
    var totalDataCount = 0;
    for (i = 0; i < rsBlocks.length; i++) totalDataCount += rsBlocks[i].dataCount;

    if (buffer.length > totalDataCount * 8) {
      throw new Error('DATA_TOO_LONG');
    }
    // 終止符
    if (buffer.length + 4 <= totalDataCount * 8) buffer.put(0, 4);
    // 補齊到位元組邊界
    while (buffer.length % 8 !== 0) buffer.putBit(false);
    // 填充碼字
    while (true) {
      if (buffer.length >= totalDataCount * 8) break;
      buffer.put(QRCode.PAD0, 8);
      if (buffer.length >= totalDataCount * 8) break;
      buffer.put(QRCode.PAD1, 8);
    }
    return QRCode.createBytes(buffer, rsBlocks);
  };

  QRCode.createBytes = function (buffer, rsBlocks) {
    var offset = 0, maxDcCount = 0, maxEcCount = 0;
    var dcdata = new Array(rsBlocks.length), ecdata = new Array(rsBlocks.length);
    var r, i;

    for (r = 0; r < rsBlocks.length; r++) {
      var dcCount = rsBlocks[r].dataCount;
      var ecCount = rsBlocks[r].totalCount - dcCount;
      maxDcCount = Math.max(maxDcCount, dcCount);
      maxEcCount = Math.max(maxEcCount, ecCount);
      dcdata[r] = new Array(dcCount);
      for (i = 0; i < dcdata[r].length; i++) dcdata[r][i] = 0xff & buffer.buffer[i + offset];
      offset += dcCount;

      var rsp = rsPoly(ecCount);
      var rawPoly = new Poly(dcdata[r], rsp.getLength() - 1);
      var modPoly = rawPoly.mod(rsp);
      ecdata[r] = new Array(rsp.getLength() - 1);
      for (i = 0; i < ecdata[r].length; i++) {
        var modIndex = i + modPoly.getLength() - ecdata[r].length;
        ecdata[r][i] = (modIndex >= 0) ? modPoly.get(modIndex) : 0;
      }
    }

    var totalCodeCount = 0;
    for (i = 0; i < rsBlocks.length; i++) totalCodeCount += rsBlocks[i].totalCount;
    var data = new Array(totalCodeCount);
    var index = 0;
    for (i = 0; i < maxDcCount; i++) {
      for (r = 0; r < rsBlocks.length; r++) {
        if (i < dcdata[r].length) data[index++] = dcdata[r][i];
      }
    }
    for (i = 0; i < maxEcCount; i++) {
      for (r = 0; r < rsBlocks.length; r++) {
        if (i < ecdata[r].length) data[index++] = ecdata[r][i];
      }
    }
    return data;
  };

  QRCode.getLostPoint = function (qr) {
    var moduleCount = qr.getModuleCount(), lostPoint = 0, row, col, r, c;

    // 規則 1：同色連續模組
    for (row = 0; row < moduleCount; row++) {
      for (col = 0; col < moduleCount; col++) {
        var sameCount = 0, dark = qr.isDark(row, col);
        for (r = -1; r <= 1; r++) {
          if (row + r < 0 || moduleCount <= row + r) continue;
          for (c = -1; c <= 1; c++) {
            if (col + c < 0 || moduleCount <= col + c) continue;
            if (r === 0 && c === 0) continue;
            if (dark === qr.isDark(row + r, col + c)) sameCount++;
          }
        }
        if (sameCount > 5) lostPoint += (3 + sameCount - 5);
      }
    }
    // 規則 2：2x2 同色區塊
    for (row = 0; row < moduleCount - 1; row++) {
      for (col = 0; col < moduleCount - 1; col++) {
        var count = 0;
        if (qr.isDark(row, col)) count++;
        if (qr.isDark(row + 1, col)) count++;
        if (qr.isDark(row, col + 1)) count++;
        if (qr.isDark(row + 1, col + 1)) count++;
        if (count === 0 || count === 4) lostPoint += 3;
      }
    }
    // 規則 3：類定位圖樣（1:1:3:1:1）
    for (row = 0; row < moduleCount; row++) {
      for (col = 0; col < moduleCount - 6; col++) {
        if (qr.isDark(row, col) && !qr.isDark(row, col + 1) && qr.isDark(row, col + 2) &&
            qr.isDark(row, col + 3) && qr.isDark(row, col + 4) && !qr.isDark(row, col + 5) &&
            qr.isDark(row, col + 6)) lostPoint += 40;
      }
    }
    for (col = 0; col < moduleCount; col++) {
      for (row = 0; row < moduleCount - 6; row++) {
        if (qr.isDark(row, col) && !qr.isDark(row + 1, col) && qr.isDark(row + 2, col) &&
            qr.isDark(row + 3, col) && qr.isDark(row + 4, col) && !qr.isDark(row + 5, col) &&
            qr.isDark(row + 6, col)) lostPoint += 40;
      }
    }
    // 規則 4：深色模組比例
    var darkCount = 0;
    for (col = 0; col < moduleCount; col++) {
      for (row = 0; row < moduleCount; row++) {
        if (qr.isDark(row, col)) darkCount++;
      }
    }
    var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
    lostPoint += ratio * 10;
    return lostPoint;
  };

  /**
   * 建立 QR Code，自動挑選最小可容納的版本。
   * @param {string} text 要編碼的文字（以 UTF-8 byte mode 編碼）
   * @param {string} eccLevel 'L' | 'M' | 'Q' | 'H'
   * @returns {{moduleCount:number, isDark:function, version:number}}
   * @throws {Error} DATA_TOO_LONG — 超出 QR 版本 40 容量；EMPTY_DATA — 空字串
   */
  function make(text, eccLevel) {
    var ecc = ECC[eccLevel] !== undefined ? ECC[eccLevel] : ECC.M;
    if (typeof text !== 'string' || text.length === 0) {
      throw new Error('EMPTY_DATA');
    }
    for (var typeNumber = 1; typeNumber <= 40; typeNumber++) {
      try {
        var qr = new QRCode(typeNumber, ecc);
        qr.addData(text);
        qr.make();
        return makeResult(qr, typeNumber);
      } catch (e) {
        if (e.message !== 'DATA_TOO_LONG') throw e;
        // 此版本容量不足 → 試下一個版本
      }
    }
    throw new Error('DATA_TOO_LONG');
  }

  // 獨立函式，避免在迴圈中建立閉包捕捉到錯誤的變數
  function makeResult(qr, typeNumber) {
    return {
      moduleCount: qr.getModuleCount(),
      isDark: function (r, c) { return qr.isDark(r, c); },
      version: typeNumber
    };
  }

  global.QRCodeLib = {
    make: make,
    utf8ByteLength: function (s) { return toUtf8Bytes(s).length; }
  };

})(typeof window !== 'undefined' ? window : this);
