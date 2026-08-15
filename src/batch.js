/**
 * batch.js — 批次匯入控制層：讀 CSV → 逐列組 vCard → 產生 QR → 排成可列印總表。
 *
 * 沿用既有純函式模組（VCard / CSV / QRCodeLib），本檔只負責 DOM 與流程。
 * 安全原則：使用者資料一律以 textContent / value 寫入 DOM，全檔不使用 innerHTML。
 * 完全離線：讀檔用 FileReader（本機），不發任何網路請求。
 */
(function () {
  'use strict';

  var QR_PIXEL_SIZE = 340;   // 每張 QR 的 canvas 內部解析度（列印才夠清晰）
  var QUIET_ZONE = 4;
  var MAX_ROWS = 500;        // 單次批次上限，避免一次算太多造成卡頓

  var els = {};
  var state = { ecc: 'M', csvText: '', fileName: '' };

  function init() {
    cache();
    bind();
  }

  function cache() {
    els.downloadTemplate = document.getElementById('download-template');
    els.csvFile      = document.getElementById('csv-file');
    els.generate     = document.getElementById('generate');
    els.printSheet   = document.getElementById('print-sheet');
    els.summary      = document.getElementById('batch-summary');
    els.error        = document.getElementById('batch-error');
    els.sheetGrid    = document.getElementById('sheet-grid');
    els.sheetEmpty   = document.getElementById('sheet-empty');
  }

  function bind() {
    els.downloadTemplate.addEventListener('click', downloadTemplate);
    els.csvFile.addEventListener('change', onFileChosen);
    els.generate.addEventListener('click', generate);
    els.printSheet.addEventListener('click', function () { window.print(); });

    var segs = document.querySelectorAll('.seg');
    Array.prototype.forEach.call(segs, function (btn) {
      btn.addEventListener('click', function () {
        state.ecc = btn.getAttribute('data-ecc');
        Array.prototype.forEach.call(segs, function (b) {
          var active = (b === btn);
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-checked', active ? 'true' : 'false');
        });
      });
    });
  }

  // ---------------------------------------------------------------
  // 範本下載
  // ---------------------------------------------------------------
  function downloadTemplate() {
    // 加 BOM，讓 Excel 以 UTF-8 開啟中文不亂碼
    var blob = new Blob(['﻿' + CSV.template()], { type: 'text/csv;charset=utf-8' });
    triggerDownload(blob, 'vcard-批次範本.csv');
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ---------------------------------------------------------------
  // 選檔
  // ---------------------------------------------------------------
  function onFileChosen() {
    hideError();
    var file = els.csvFile.files && els.csvFile.files[0];
    if (!file) { els.generate.disabled = true; return; }

    var reader = new FileReader();
    reader.onload = function () {
      state.csvText = String(reader.result || '');
      state.fileName = file.name;
      els.generate.disabled = false;
      els.summary.textContent = '已載入「' + file.name + '」，按「產生 QRCode」開始。';
    };
    reader.onerror = function () {
      showError('讀取檔案失敗，請確認檔案未毀損。');
      els.generate.disabled = true;
    };
    reader.readAsText(file, 'utf-8');
  }

  // ---------------------------------------------------------------
  // 產生總表
  // ---------------------------------------------------------------
  function generate() {
    hideError();
    clearGrid();

    var parsed;
    try {
      parsed = CSV.toContacts(state.csvText);
    } catch (e) {
      showError('CSV 解析失敗，請確認格式與範本一致。');
      return;
    }

    if (parsed.fields.length === 0) {
      showError('找不到可辨識的欄位標題。請用「下載 CSV 範本」的標題列，或確認第一列是欄位名稱。');
      return;
    }
    if (parsed.contacts.length === 0) {
      showError('沒有可產生的資料列（可能整份只有標題或都是空列）。');
      return;
    }

    var contacts = parsed.contacts;
    var truncated = false;
    if (contacts.length > MAX_ROWS) {
      contacts = contacts.slice(0, MAX_ROWS);
      truncated = true;
    }

    var ok = 0, failed = 0;
    contacts.forEach(function (c, idx) {
      var card = renderCard(c, idx + 1);
      if (card.ok) ok++; else failed++;
    });

    els.sheetEmpty.hidden = true;
    els.printSheet.disabled = ok === 0;
    writeSummary(parsed, ok, failed, truncated);
  }

  function writeSummary(parsed, ok, failed, truncated) {
    var parts = ['成功產生 ' + ok + ' 張 QRCode'];
    if (failed > 0) parts.push('失敗 ' + failed + ' 筆（資料過長或無法編碼，見紅色卡片）');
    if (parsed.skipped > 0) parts.push('略過空白列 ' + parsed.skipped + ' 列');
    if (truncated) parts.push('超過單次上限 ' + MAX_ROWS + '，僅處理前 ' + MAX_ROWS + ' 筆');
    if (parsed.unknownHeaders.length > 0) {
      parts.push('未辨識的欄位標題（已忽略）：' + parsed.unknownHeaders.join('、'));
    }
    els.summary.textContent = parts.join('；') + '。';
  }

  // ---------------------------------------------------------------
  // 單張卡片
  // ---------------------------------------------------------------
  function displayName(c) {
    var fn = (c.fullName || '').replace(/^\s+|\s+$/g, '');
    if (fn) return fn;
    var combined = (c.lastName || '') + (c.firstName || '');
    combined = combined.replace(/^\s+|\s+$/g, '');
    if (combined) return combined;
    return c.org || c.email || c.cell || '(未命名)';
  }

  function subtitle(c) {
    var bits = [];
    if (c.org) bits.push(c.org);
    if (c.title) bits.push(c.title);
    if (bits.length === 0 && c.email) bits.push(c.email);
    return bits.join(' · ');
  }

  /** 建一張卡片並掛到 grid。回傳 { ok: boolean }。 */
  function renderCard(contact, seq) {
    var card = document.createElement('div');
    card.className = 'qr-card';

    var name = displayName(contact);
    var vcard, qr, errMsg = '';
    try {
      vcard = VCard.build(contact);
      qr = QRCodeLib.make(vcard, state.ecc);
    } catch (e) {
      errMsg = (e && e.message === 'DATA_TOO_LONG')
        ? '資料過長，無法編成 QRCode（請縮短備註或降低容錯等級）'
        : '無法產生（' + (e && e.message ? e.message : '未知錯誤') + '）';
    }

    if (errMsg) {
      card.classList.add('qr-card-error');
      var errCanvasBox = document.createElement('div');
      errCanvasBox.className = 'qr-card-canvas qr-card-canvas-empty';
      errCanvasBox.textContent = '⚠';
      card.appendChild(errCanvasBox);
    } else {
      var canvas = document.createElement('canvas');
      canvas.className = 'qr-card-canvas';
      drawQR(canvas, qr);
      card.appendChild(canvas);
    }

    var nameEl = document.createElement('div');
    nameEl.className = 'qr-card-name';
    nameEl.textContent = name;                 // textContent：不做 HTML 解析（防 XSS）
    card.appendChild(nameEl);

    var subEl = document.createElement('div');
    subEl.className = 'qr-card-sub';
    subEl.textContent = errMsg ? errMsg : subtitle(contact);
    card.appendChild(subEl);

    els.sheetGrid.appendChild(card);
    return { ok: !errMsg };
  }

  function drawQR(canvas, qr) {
    var ctx = canvas.getContext('2d');
    var count = qr.moduleCount;
    var total = count + QUIET_ZONE * 2;
    var cell = Math.max(1, Math.floor(QR_PIXEL_SIZE / total));
    var size = cell * total;

    canvas.width = size;
    canvas.height = size;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect((c + QUIET_ZONE) * cell, (r + QUIET_ZONE) * cell, cell, cell);
        }
      }
    }
  }

  function clearGrid() {
    while (els.sheetGrid.firstChild) els.sheetGrid.removeChild(els.sheetGrid.firstChild);
    els.printSheet.disabled = true;
  }

  function showError(msg) {
    els.error.textContent = msg;
    els.error.hidden = false;
  }
  function hideError() { els.error.hidden = true; els.error.textContent = ''; }

  // ---------------------------------------------------------------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
