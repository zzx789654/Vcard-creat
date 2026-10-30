/**
 * zip.js — 把多個檔案打包成一個 ZIP：純函式，不碰 DOM、零外部相依。
 * 與 UI 分離以便獨立測試。
 *
 * 只用「stored（不壓縮）」格式：裝的是 PNG，本身已壓縮，再壓幾乎沒有效益，
 * 也讓實作小到可以完整測試。檔名以 UTF-8 寫入並設定 bit 11，中文檔名不會亂碼。
 *
 * 對外 API：
 *   ZIP.build(entries, date) -> Uint8Array
 *     entries：[{ name: string, data: Uint8Array }, ...]，name 不可重複
 *     date   ：寫進每個檔案的修改時間（Date，選填，預設現在）
 *   ZIP.crc32(bytes)         -> 無號 32 位元整數
 *   ZIP.utf8(str)            -> Uint8Array（UTF-8 編碼）
 */
(function (global) {
  'use strict';

  // 未用 ZIP64：檔案數上限 65535，總大小上限 4 GB。
  // 批次模式單次最多 500 筆、每張 PNG 約數十 KB，遠低於大小上限，因此只檢查檔案數。
  var MAX_ENTRIES = 0xFFFF;
  var FLAG_UTF8 = 0x0800;          // general purpose bit 11：檔名為 UTF-8
  var VERSION = 20;                // 2.0：支援資料夾與 UTF-8 檔名旗標

  var CRC_TABLE = (function () {
    var table = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /** UTF-8 編碼；落單的代理字元以 U+FFFD 取代，避免寫出不合法的位元組 */
  function utf8(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
        var next = str.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          code = 0x10000 + ((code - 0xD800) << 10) + (next - 0xDC00);
          i++;
        }
      }
      if (code >= 0xD800 && code <= 0xDFFF) code = 0xFFFD;

      if (code < 0x80) {
        out.push(code);
      } else if (code < 0x800) {
        out.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
      } else if (code < 0x10000) {
        out.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      } else {
        out.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 0x3F),
                 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      }
    }
    return new Uint8Array(out);
  }

  /** ZIP 使用 MS-DOS 時間格式（本地時間，秒數精度 2 秒，年份從 1980 起） */
  function dosDateTime(date) {
    var year = date.getFullYear();
    // 早於 1980 或無效日期（NaN）一律寫 1980-01-01 00:00
    if (!(year >= 1980)) return { time: 0, date: (1 << 5) | 1 };
    if (year > 2107) year = 2107;                    // 年份欄位只有 7 位元
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  function validate(entries) {
    if (!Array.isArray(entries) || entries.length === 0) throw new Error('ZIP_EMPTY');
    if (entries.length > MAX_ENTRIES) throw new Error('ZIP_TOO_MANY');
    var seen = {};
    entries.forEach(function (e) {
      if (!e || typeof e.name !== 'string' || e.name === '') throw new Error('ZIP_BAD_NAME');
      // 以型別標籤判斷而非 instanceof：資料可能來自另一個 JS 環境（iframe／vm），instanceof 會誤判
      if (Object.prototype.toString.call(e.data) !== '[object Uint8Array]') throw new Error('ZIP_BAD_DATA');
      // 只接受單層檔名：不允許路徑分隔符，避免解壓時寫到資料夾外（Zip Slip，CWE-22）
      if (/[\\/]/.test(e.name)) throw new Error('ZIP_BAD_NAME');
      if (seen['$' + e.name]) throw new Error('ZIP_DUPLICATE_NAME');
      seen['$' + e.name] = true;
    });
  }

  function build(entries, date) {
    validate(entries);
    var isDate = Object.prototype.toString.call(date) === '[object Date]';   // 同上，不用 instanceof
    var dt = dosDateTime(isDate ? date : new Date());

    var files = entries.map(function (e) {
      return { name: utf8(e.name), data: e.data, crc: crc32(e.data) };
    });

    var localSize = 0, centralSize = 0;
    files.forEach(function (f) {
      localSize += 30 + f.name.length + f.data.length;
      centralSize += 46 + f.name.length;
    });
    var total = localSize + centralSize + 22;

    var out = new Uint8Array(total);
    var pos = 0;

    function u16(v) { out[pos++] = v & 0xFF; out[pos++] = (v >>> 8) & 0xFF; }
    function u32(v) { u16(v & 0xFFFF); u16((v >>> 16) & 0xFFFF); }
    function bytes(b) { out.set(b, pos); pos += b.length; }

    // 各檔案：local file header ＋ 原始資料
    files.forEach(function (f) {
      f.offset = pos;
      u32(0x04034B50);
      u16(VERSION); u16(FLAG_UTF8); u16(0);          // 需求版本、旗標、方法 0 = stored
      u16(dt.time); u16(dt.date);
      u32(f.crc); u32(f.data.length); u32(f.data.length);
      u16(f.name.length); u16(0);                    // 檔名長度、extra 長度
      bytes(f.name);
      bytes(f.data);
    });

    // central directory
    var centralStart = pos;
    files.forEach(function (f) {
      u32(0x02014B50);
      u16(VERSION); u16(VERSION); u16(FLAG_UTF8); u16(0);
      u16(dt.time); u16(dt.date);
      u32(f.crc); u32(f.data.length); u32(f.data.length);
      u16(f.name.length); u16(0); u16(0);            // 檔名、extra、comment 長度
      u16(0); u16(0); u32(0);                        // 磁碟編號、內部屬性、外部屬性
      u32(f.offset);
      bytes(f.name);
    });

    var centralLength = pos - centralStart;

    // end of central directory
    u32(0x06054B50);
    u16(0); u16(0);                                  // 磁碟編號
    u16(files.length); u16(files.length);
    u32(centralLength); u32(centralStart);
    u16(0);                                          // comment 長度

    return out;
  }

  global.ZIP = {
    build: build,
    crc32: crc32,
    utf8: utf8
  };

})(typeof window !== 'undefined' ? window : this);
