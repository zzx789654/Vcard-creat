/**
 * vcard.js — vCard 3.0（RFC 2426）產生器：純函式，不碰 DOM。
 * 與 UI 分離以便獨立測試（NFR-06）。
 *
 * 對外 API：
 *   VCard.build(data)        -> vCard 3.0 字串
 *   VCard.escapeValue(str)   -> 依 RFC 2426 跳脫特殊字元
 *   VCard.foldLine(str)      -> 依 RFC 2426 folding 折行（75 octets）
 */
(function (global) {
  'use strict';

  var CRLF = '\r\n';

  // --- 相容性輔助 ---
  // 本檔以 ES5 為基準（Electron 與現行瀏覽器皆完整支援）。
  // isArray / trim 另做保險，是為了在極舊的內嵌 webview 上也能安全降級。
  var isArray = Array.isArray || function (v) {
    return Object.prototype.toString.call(v) === '[object Array]';
  };

  function trim(s) {
    return String(s).replace(/^[\s﻿\xA0]+|[\s﻿\xA0]+$/g, '');
  }

  /**
   * 移除會破壞下游解析器的控制字元。
   * CR/LF 由 escapeValue 另行處理（轉為字面 \n），這裡處理其餘 C0 控制字元
   * 與 Unicode 行分隔符，避免它們原樣寫進 .vcf 造成各家通訊錄軟體行為不一致。
   */
  function stripControlChars(str) {
    return String(str).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u0085\u2028\u2029]/g, '');
  }

  /**
   * RFC 2426 §5：值中的反斜線、分號、逗號、換行必須跳脫。
   * 順序重要——反斜線必須先跳脫，否則會重複跳脫後面補上的反斜線。
   */
  function escapeValue(str) {
    if (str === null || str === undefined) return '';
    // 先移除控制字元（CR/LF 除外，下一步另行處理），再依規範跳脫
    return stripControlChars(str)
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,');
  }

  /**
   * RFC 2426 折行：單行不得超過 75 octets（不含 CRLF），
   * 續行以單一空白開頭。以 UTF-8 位元組計算，且不切斷多位元組字元。
   */
  function foldLine(line) {
    var MAX = 75;
    var out = [];
    var current = '';
    var currentBytes = 0;
    var limit = MAX;

    for (var i = 0; i < line.length; i++) {
      // 用 charAt 而非 line[i]：字串索引存取在舊版 JS 引擎（ES3）不支援
      var ch = line.charAt(i);
      // 處理 surrogate pair，避免把一個 emoji 從中間切開
      if (ch.charCodeAt(0) >= 0xd800 && ch.charCodeAt(0) <= 0xdbff && i + 1 < line.length) {
        ch += line.charAt(i + 1);
        i++;
      }
      var chBytes = utf8Len(ch);
      if (currentBytes + chBytes > limit) {
        out.push(current);
        current = ' ' + ch;      // 續行前置空白
        currentBytes = 1 + chBytes;
        limit = MAX;
      } else {
        current += ch;
        currentBytes += chBytes;
      }
    }
    if (current.length > 0) out.push(current);
    return out.join(CRLF);
  }

  function utf8Len(str) {
    var n = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }

  /** 判斷字串是否為空（null/undefined/全空白皆視為空）*/
  function isBlank(v) {
    return v === null || v === undefined || trim(v) === '';
  }

  /**
   * 建立一行 vCard 屬性。值為空時回傳 null（呼叫端過濾掉，不輸出空屬性）。
   * @param {string} name 屬性名（含參數，如 'TEL;TYPE=CELL'）
   * @param {string|string[]} value 值；陣列代表結構化欄位（以 ; 分隔各元件）
   */
  function makeLine(name, value) {
    var val;
    if (isArray(value)) {
      // 結構化欄位（N、ADR）：各元件分別跳脫後以未跳脫的 ; 連接
      if (value.every(isBlank)) return null;
      val = value.map(function (v) { return escapeValue(isBlank(v) ? '' : trim(v)); }).join(';');
    } else {
      if (isBlank(value)) return null;
      val = escapeValue(trim(value));
    }
    return foldLine(name + ':' + val);
  }

  /**
   * 依輸入資料組出 vCard 3.0 文字。
   *
   * @param {Object} data
   * @param {string} data.lastName   姓
   * @param {string} data.firstName  名
   * @param {string} data.fullName   顯示名（留空則自動由姓名組合）
   * @param {string} data.cell       手機
   * @param {string} data.workTel    公司電話
   * @param {string} data.homeTel    住家電話
   * @param {string} data.email      電子郵件
   * @param {string} data.org        公司／組織
   * @param {string} data.title      職稱
   * @param {string} data.url        網站
   * @param {string} data.street     街道
   * @param {string} data.city       城市
   * @param {string} data.region     縣市／州
   * @param {string} data.postalCode 郵遞區號
   * @param {string} data.country    國家
   * @param {string} data.note       備註
   * @param {Array<{key:string, value:string}>} data.custom 自訂欄位
   * @returns {string} vCard 3.0 字串（以 CRLF 分行）
   */
  function build(data) {
    data = data || {};
    var lines = [];

    lines.push('BEGIN:VCARD');
    lines.push('VERSION:3.0');

    // N（必填）：Family;Given;Additional;Prefix;Suffix
    var nLine = makeLine('N', [data.lastName, data.firstName, '', '', '']);
    if (nLine) lines.push(nLine);

    // FN（RFC 2426 必填）：留空時由姓名自動組合。
    // 若連姓名都沒填，改用其他有填的欄位遞補（公司 → Email → 電話），
    // 確保 FN 一定存在——缺少 FN 的 vCard 會被部分通訊錄軟體拒收。
    var fn = data.fullName;
    if (isBlank(fn)) {
      fn = [data.lastName, data.firstName]
        .filter(function (p) { return !isBlank(p); })
        .map(function (p) { return trim(p); })
        .join('');
    }
    if (isBlank(fn)) {
      var fallbacks = [data.org, data.email, data.cell, data.workTel, data.homeTel];
      for (var i = 0; i < fallbacks.length; i++) {
        if (!isBlank(fallbacks[i])) { fn = trim(fallbacks[i]); break; }
      }
    }
    var fnLine = makeLine('FN', fn);
    if (fnLine) lines.push(fnLine);

    // 組織與職稱
    var orgLine = makeLine('ORG', data.org);
    if (orgLine) lines.push(orgLine);
    var titleLine = makeLine('TITLE', data.title);
    if (titleLine) lines.push(titleLine);

    // 電話
    var telDefs = [
      ['TEL;TYPE=CELL,VOICE', data.cell],
      ['TEL;TYPE=WORK,VOICE', data.workTel],
      ['TEL;TYPE=HOME,VOICE', data.homeTel]
    ];
    telDefs.forEach(function (def) {
      var l = makeLine(def[0], def[1]);
      if (l) lines.push(l);
    });

    // 電子郵件
    var emailLine = makeLine('EMAIL;TYPE=INTERNET,PREF', data.email);
    if (emailLine) lines.push(emailLine);

    // 網站
    var urlLine = makeLine('URL', data.url);
    if (urlLine) lines.push(urlLine);

    // 地址 ADR：PO Box;Extended;Street;City;Region;Postal;Country
    var adrLine = makeLine('ADR;TYPE=WORK', [
      '', '', data.street, data.city, data.region, data.postalCode, data.country
    ]);
    if (adrLine) lines.push(adrLine);

    // 備註
    var noteLine = makeLine('NOTE', data.note);
    if (noteLine) lines.push(noteLine);

    // 自訂欄位：鍵名淨化後輸出；非標準鍵自動加 X- 前綴（RFC 2426 §3.8 擴充機制）
    if (isArray(data.custom)) {
      data.custom.forEach(function (f) {
        if (!f || isBlank(f.key) || isBlank(f.value)) return;
        var key = sanitizeKey(f.key);
        if (!key) return;
        var l = makeLine(key, f.value);
        if (l) lines.push(l);
      });
    }

    lines.push('END:VCARD');
    return lines.join(CRLF) + CRLF;
  }

  // vCard 3.0 已知的標準屬性名（自訂欄位若用這些名稱就不加 X- 前綴）
  var STANDARD_KEYS = [
    'NICKNAME', 'BDAY', 'ANNIVERSARY', 'GENDER', 'CATEGORIES', 'ROLE',
    'TEL', 'EMAIL', 'URL', 'NOTE', 'ORG', 'TITLE', 'ADR', 'GEO', 'TZ', 'LANG'
  ];

  /**
   * 淨化自訂欄位鍵名：只允許英數與連字號（RFC 2426 屬性名規則），
   * 避免使用者輸入 `:`、換行等字元破壞 vCard 結構（注入防護）。
   */
  function sanitizeKey(rawKey) {
    var key = trim(rawKey).toUpperCase()
      .replace(/[^A-Z0-9-]/g, '-')   // 非法字元一律轉為連字號
      .replace(/-+/g, '-')            // 收斂連續連字號
      .replace(/^-+|-+$/g, '');       // 去除頭尾連字號
    if (!key) return '';
    if (key.indexOf('X-') === 0) return key;
    if (STANDARD_KEYS.indexOf(key) !== -1) return key;
    return 'X-' + key;
  }

  // Windows 保留裝置名稱：直接拿來當檔名會存檔失敗
  var RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

  /**
   * 把使用者輸入淨化成安全的檔名。
   * 抽到這裡（而非留在 renderer）是因為它承擔路徑穿越防護，屬安全相關邏輯，
   * 必須能被獨立測試——留在 renderer 裡會因相依 DOM 而無法測。
   *
   * @param {string} raw 使用者輸入的名稱
   * @param {string} fallback 淨化後為空時使用的預設檔名
   * @returns {string} 可安全用於下載的檔名（不含副檔名）
   */
  function safeFileName(raw, fallback) {
    fallback = fallback || 'vcard';
    var base = isBlank(raw) ? '' : trim(raw);
    if (!base) return fallback;

    // 去除路徑分隔符、Windows 非法字元與控制字元（路徑穿越防護）
    base = base.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 60);
    // 去除頭尾的點與空白：Windows 不允許，也可避免 "." / ".." 這類名稱
    base = base.replace(/^[.\s]+|[.\s]+$/g, '');

    if (!base) return fallback;
    if (RESERVED_NAMES.test(base)) return '_' + base;
    return base;
  }

  global.VCard = {
    build: build,
    escapeValue: escapeValue,
    foldLine: foldLine,
    sanitizeKey: sanitizeKey,
    safeFileName: safeFileName,
    utf8Len: utf8Len
  };

})(typeof window !== 'undefined' ? window : this);
