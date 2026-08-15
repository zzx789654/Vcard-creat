/**
 * csv.js — 批次匯入用的 CSV 解析與欄位對應：純函式，不碰 DOM、零外部相依。
 * 與 UI 分離以便獨立測試。
 *
 * 對外 API：
 *   CSV.parse(text)      -> 二維陣列（每列一個字串陣列），支援引號、逸出、CRLF/LF
 *   CSV.toContacts(text) -> { fields, contacts, skipped, unknownHeaders }
 *                           依標題列把每列對應到 vCard 欄位物件（沿用既有欄位）
 *   CSV.template()       -> 範本 CSV 字串（含中文標題與一列範例）
 *   CSV.FIELD_LABELS     -> 欄位鍵 -> 中文標題（範本與說明用）
 */
(function (global) {
  'use strict';

  // 沿用主程式的標準欄位（順序即範本欄位順序）
  var FIELD_ORDER = [
    'lastName', 'firstName', 'fullName',
    'cell', 'workTel', 'homeTel', 'email',
    'org', 'title', 'url',
    'street', 'city', 'region', 'postalCode', 'country',
    'note'
  ];

  var FIELD_LABELS = {
    lastName: '姓', firstName: '名', fullName: '顯示名',
    cell: '手機', workTel: '公司電話', homeTel: '住家電話', email: 'Email',
    org: '公司', title: '職稱', url: '網站',
    street: '街道', city: '城市', region: '縣市', postalCode: '郵遞區號', country: '國家',
    note: '備註'
  };

  // 標題別名 -> 欄位鍵。key 一律以「去空白 + 轉小寫」正規化後比對，
  // 因此這裡的英文別名用小寫即可；中文別名大小寫無影響。
  var HEADER_ALIASES = {
    lastName:   ['姓', '姓氏', 'lastname', 'last name', 'surname', 'family name'],
    firstName:  ['名', '名字', 'firstname', 'first name', 'given name'],
    fullName:   ['顯示名', '全名', '姓名', 'fullname', 'full name', 'name', 'fn'],
    cell:       ['手機', '行動電話', '手機號碼', 'cell', 'mobile', 'cellphone'],
    workTel:    ['公司電話', '工作電話', '市話', 'worktel', 'work', 'tel', 'phone'],
    homeTel:    ['住家電話', '家用電話', 'hometel', 'home'],
    email:      ['email', '電子郵件', '郵件', 'mail', 'e-mail'],
    org:        ['公司', '組織', '公司名稱', 'org', 'organization', 'company'],
    title:      ['職稱', '頭銜', 'title', 'job title'],
    url:        ['網站', '網址', 'url', 'website', 'web'],
    street:     ['街道', '地址', '街道地址', 'street', 'address'],
    city:       ['城市', 'city'],
    region:     ['縣市', '州', 'region', 'state', 'province'],
    postalCode: ['郵遞區號', '郵編', 'postalcode', 'postal code', 'zip', 'zipcode'],
    country:    ['國家', 'country'],
    note:       ['備註', '註記', 'note', 'remark', 'notes']
  };

  function normalizeHeader(s) {
    return String(s).replace(/^[\s﻿\xA0]+|[\s﻿\xA0]+$/g, '').toLowerCase();
  }

  // 建立「正規化別名 -> 欄位鍵」查找表
  var ALIAS_LOOKUP = (function () {
    var map = {};
    for (var field in HEADER_ALIASES) {
      if (!HEADER_ALIASES.hasOwnProperty(field)) continue;
      var list = HEADER_ALIASES[field];
      for (var i = 0; i < list.length; i++) {
        map[normalizeHeader(list[i])] = field;
      }
    }
    return map;
  })();

  /**
   * 解析 CSV 文字為二維陣列。
   * 支援：雙引號包住的欄位（內部可含逗號、換行）、"" 逸出雙引號、CRLF 或 LF、
   * 開頭 UTF-8 BOM。空白列（僅有換行）不產生列。
   */
  function parse(text) {
    var s = String(text);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);   // 去除 BOM

    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;
    var n = s.length;
    var started = false;   // 這一列是否已有任何字元（用來判斷是否為空列）

    function endField() { row.push(field); field = ''; }
    function endRow() {
      endField();
      // 略過完全空白的列（只有一個空欄位且整列無內容）
      var empty = row.length === 1 && row[0] === '';
      if (!empty) rows.push(row);
      row = [];
      started = false;
    }

    while (i < n) {
      var c = s.charAt(i);

      if (inQuotes) {
        if (c === '"') {
          if (s.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }

      if (c === '"') { inQuotes = true; started = true; i++; continue; }
      if (c === ',') { endField(); started = true; i++; continue; }
      if (c === '\r') { i++; continue; }        // CR 一律忽略（CRLF/CR 都以 LF 為準）
      if (c === '\n') { endRow(); i++; continue; }

      field += c; started = true; i++;
    }

    // 收尾：若最後仍有未結束的內容
    if (started || field !== '' || row.length > 0) endRow();
    return rows;
  }

  /**
   * 解析 CSV 並依標題列對應到 vCard 欄位。
   * @returns {{fields:string[], contacts:Object[], skipped:number, unknownHeaders:string[]}}
   *   fields         實際對應到的欄位鍵（依標題出現順序）
   *   contacts       每列一個物件，鍵為欄位鍵、值為字串
   *   skipped        因整列無任何實質內容而略過的資料列數
   *   unknownHeaders 無法對應到任何欄位的標題（原樣保留，供提示）
   */
  function toContacts(text) {
    var rows = parse(text);
    if (rows.length === 0) {
      return { fields: [], contacts: [], skipped: 0, unknownHeaders: [] };
    }

    var header = rows[0];
    var colField = [];          // 欄索引 -> 欄位鍵（或 null）
    var fields = [];
    var unknownHeaders = [];
    for (var c = 0; c < header.length; c++) {
      var key = ALIAS_LOOKUP[normalizeHeader(header[c])];
      if (key) { colField.push(key); fields.push(key); }
      else { colField.push(null); if (normalizeHeader(header[c]) !== '') unknownHeaders.push(header[c]); }
    }

    var contacts = [];
    var skipped = 0;
    for (var r = 1; r < rows.length; r++) {
      var cells = rows[r];
      var obj = {};
      var hasValue = false;
      for (var j = 0; j < cells.length; j++) {
        var f = colField[j];
        if (!f) continue;
        var v = cells[j];
        if (v != null && normalizeHeader(v) !== '') hasValue = true;   // 去空白後非空才算有值
        // 同一欄位若重複出現，保留第一個非空值
        if (obj[f] === undefined || obj[f] === '') obj[f] = v;
      }
      if (!hasValue) { skipped++; continue; }
      contacts.push(obj);
    }

    return { fields: fields, contacts: contacts, skipped: skipped, unknownHeaders: unknownHeaders };
  }

  /** 產生範本 CSV（標題列 + 一列範例），欄位需以雙引號包住含逗號者。 */
  function template() {
    var headers = FIELD_ORDER.map(function (k) { return FIELD_LABELS[k]; });
    var sample = {
      lastName: '王', firstName: '小明', fullName: '王小明',
      cell: '0912-345-678', workTel: '02-1234-5678', homeTel: '',
      email: 'ming@example.com', org: '範例科技股份有限公司', title: '產品經理',
      url: 'https://example.com', street: '信義路五段 7 號', city: '台北市',
      region: '信義區', postalCode: '110', country: '台灣', note: '週一至週五 09:00-18:00'
    };
    var sampleRow = FIELD_ORDER.map(function (k) { return sample[k] || ''; });
    return toCsvLine(headers) + '\r\n' + toCsvLine(sampleRow) + '\r\n';
  }

  /** 將一列字串陣列組成 CSV 行：含逗號/引號/換行者以雙引號包住並逸出。 */
  function toCsvLine(cells) {
    return cells.map(function (v) {
      var s = String(v == null ? '' : v);
      if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }).join(',');
  }

  global.CSV = {
    parse: parse,
    toContacts: toContacts,
    template: template,
    toCsvLine: toCsvLine,
    FIELD_ORDER: FIELD_ORDER,
    FIELD_LABELS: FIELD_LABELS
  };

})(typeof window !== 'undefined' ? window : this);
