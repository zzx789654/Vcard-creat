/**
 * batch.js — 批次匯入控制層：讀 CSV → 逐列組 vCard → 產生 QR → 排成可列印總表，
 * 並可把每筆存成單獨的 PNG（單張下載，或全部打包成一個 ZIP）。
 *
 * 沿用既有純函式模組（VCard / CSV / QRCodeLib / ZIP），本檔只負責 DOM 與流程。
 * 安全原則：使用者資料一律以 textContent / value 寫入 DOM，全檔不使用 innerHTML。
 * 完全離線：讀檔用 FileReader（本機），不發任何網路請求。
 */
(function () {
  'use strict';

  var QR_PIXEL_SIZE = 340;   // 每張 QR 的 canvas 內部解析度（列印才夠清晰）
  var QUIET_ZONE = 4;
  var MAX_ROWS = 500;        // 單次批次上限，避免一次算太多造成卡頓
  var MAX_FILE_BYTES = 5 * 1024 * 1024;  // 5 MB：500 列名片遠小於此，超過即拒絕，避免整份讀入卡死視窗

  // 匯出 PNG：QR 在上、姓名與公司／職稱在下
  var EXPORT_QR_SIZE = 640;  // 與單張模式下載的 PNG 同解析度
  var EXPORT_FONT = "'Microsoft JhengHei', 'PingFang TC', 'Noto Sans CJK TC', sans-serif";

  var els = {};
  // items：成功產生的每一筆 { seq, name, sub, qr }，供單張下載與 ZIP 打包使用；
  // itemsFileName：產生這批 items 時的 CSV 檔名（之後換選別的檔也不影響 ZIP 命名）
  var state = { ecc: 'M', csvText: '', fileName: '', items: [], itemsFileName: '', zipping: false };

  function init() {
    cache();
    bind();
  }

  function cache() {
    els.downloadTemplate = document.getElementById('download-template');
    els.csvFile      = document.getElementById('csv-file');
    els.generate     = document.getElementById('generate');
    els.printSheet   = document.getElementById('print-sheet');
    els.downloadZip  = document.getElementById('download-zip');
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
    els.downloadZip.addEventListener('click', downloadZip);

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
    // 大型 ZIP 交給下載程序需要時間，延後一分鐘再釋放
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  // ---------------------------------------------------------------
  // 選檔
  // ---------------------------------------------------------------
  function onFileChosen() {
    hideError();
    var file = els.csvFile.files && els.csvFile.files[0];
    if (!file) { els.generate.disabled = true; return; }
    if (file.size > MAX_FILE_BYTES) {
      state.csvText = '';
      els.generate.disabled = true;
      showError('檔案超過 5 MB，請分成較小的 CSV 再匯入（單次最多 ' + MAX_ROWS + ' 筆）。');
      return;
    }

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

    state.itemsFileName = state.fileName;
    var ok = 0, failed = 0;
    contacts.forEach(function (c, idx) {
      var card = renderCard(c, idx + 1);
      if (card.ok) ok++; else failed++;
    });

    els.sheetEmpty.hidden = true;
    els.printSheet.disabled = ok === 0;
    els.downloadZip.disabled = ok === 0;
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

    var sub = subtitle(contact);
    var subEl = document.createElement('div');
    subEl.className = 'qr-card-sub';
    subEl.textContent = errMsg ? errMsg : sub;
    card.appendChild(subEl);

    if (!errMsg) {
      var item = { seq: seq, name: name, sub: sub, qr: qr };
      state.items.push(item);

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary qr-card-download no-print';
      btn.textContent = '下載 PNG';
      btn.setAttribute('aria-label', '下載 ' + name + ' 的 PNG');
      btn.addEventListener('click', function () { downloadOnePng(item); });
      card.appendChild(btn);
    }

    els.sheetGrid.appendChild(card);
    return { ok: !errMsg };
  }

  /** 每個模組的像素大小：在 pixelSize 內放得下整張 QR（含留白）的最大整數 */
  function cellSize(qr, pixelSize) {
    return Math.max(1, Math.floor(pixelSize / (qr.moduleCount + QUIET_ZONE * 2)));
  }

  /** 從畫布左上角畫 QR 模組（底色由呼叫端先塗白） */
  function drawModules(ctx, qr, cell) {
    var count = qr.moduleCount;
    ctx.fillStyle = '#000000';
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect((c + QUIET_ZONE) * cell, (r + QUIET_ZONE) * cell, cell, cell);
        }
      }
    }
  }

  function drawQR(canvas, qr) {
    var cell = cellSize(qr, QR_PIXEL_SIZE);
    var size = cell * (qr.moduleCount + QUIET_ZONE * 2);
    canvas.width = size;
    canvas.height = size;

    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    drawModules(ctx, qr, cell);
  }

  // ---------------------------------------------------------------
  // 匯出 PNG（單張下載與 ZIP 共用同一張畫布）
  // ---------------------------------------------------------------

  /** 文字超過寬度時從尾端截斷並補「…」 */
  function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    var s = text;
    while (s.length > 0 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
    return s + '…';
  }

  function renderExportCanvas(item) {
    var cell = cellSize(item.qr, EXPORT_QR_SIZE);
    var width = cell * (item.qr.moduleCount + QUIET_ZONE * 2);
    var margin = cell * QUIET_ZONE;          // 文字左右與 QR 留白對齊
    var maxTextWidth = width - margin * 2;
    var nameFont = '600 ' + Math.round(width / 20) + 'px ' + EXPORT_FONT;
    var subFont = Math.round(width / 28) + 'px ' + EXPORT_FONT;
    var gap = Math.round(width / 50);

    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');

    // 先量字形實際的上下緣（中文字形會高出 em 框頂端），再決定畫布高度：
    // 文字從 QR 完整的 4 格留白之後才開始，留白不能被佔用，否則部分掃描器會找不到 QR
    var lines = [{ text: item.name, font: nameFont, color: '#000000' }];
    if (item.sub) lines.push({ text: item.sub, font: subFont, color: '#555555' });
    var y = width;
    lines.forEach(function (line, i) {
      ctx.font = line.font;
      line.text = fitText(ctx, line.text, maxTextWidth);
      var m = ctx.measureText(line.text);
      if (i > 0) y += gap;
      line.baseline = y + Math.ceil(m.actualBoundingBoxAscent);
      y = line.baseline + Math.ceil(m.actualBoundingBoxDescent);
    });

    canvas.width = width;                    // 設定尺寸會重設 ctx 狀態，因此量完才設
    canvas.height = y + Math.round(margin / 2);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawModules(ctx, item.qr, cell);

    // 使用者資料以 fillText 畫進點陣圖，不經 HTML 解析
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    lines.forEach(function (line) {
      ctx.font = line.font;
      ctx.fillStyle = line.color;
      ctx.fillText(line.text, width / 2, line.baseline);
    });
    return canvas;
  }

  /** 檔名：三位數序號（對應 CSV 第幾筆，也避免同名互相覆蓋）＋姓名 */
  function pngFileName(item) {
    var seq = ('00' + item.seq).slice(-3);
    return seq + '-' + VCard.safeFileName(item.name, 'vcard') + '.png';
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob); else reject(new Error('PNG_FAILED'));
      }, 'image/png');
    });
  }

  function downloadOnePng(item) {
    canvasToBlob(renderExportCanvas(item)).then(function (blob) {
      triggerDownload(blob, pngFileName(item));
    }, function () {
      showError('PNG 匯出失敗，請再試一次。');
    });
  }

  function downloadZip() {
    if (state.zipping || state.items.length === 0) return;
    state.zipping = true;
    // 打包期間鎖住重新產生與換檔，避免打包的是舊批次、進度蓋掉新摘要
    setBusy(true);
    hideError();

    var items = state.items.slice();
    var entries = [];
    var done = 0;

    // 一張一張依序轉 PNG，邊做邊更新進度，避免一次佔用大量記憶體
    var chain = Promise.resolve();
    items.forEach(function (item) {
      chain = chain.then(function () {
        return canvasToBlob(renderExportCanvas(item));
      }).then(function (blob) {
        return blob.arrayBuffer();
      }).then(function (buf) {
        entries.push({ name: pngFileName(item), data: new Uint8Array(buf) });
        done++;
        els.summary.textContent = '正在打包 PNG… ' + done + ' / ' + items.length;
      });
    });

    chain.then(function () {
      var zip = ZIP.build(entries);
      var base = VCard.safeFileName(state.itemsFileName.replace(/\.csv$/i, ''), 'vcard');
      triggerDownload(new Blob([zip], { type: 'application/zip' }), base + '-qrcode.zip');
      els.summary.textContent = '已打包 ' + entries.length + ' 張 PNG（失敗的資料列不含在內）。';
    }).catch(function () {
      showError('打包 PNG 失敗，請再試一次。');
    }).then(function () {
      state.zipping = false;
      setBusy(false);
    });
  }

  function setBusy(busy) {
    els.downloadZip.disabled = busy || state.items.length === 0;
    els.generate.disabled = busy || state.csvText === '';
    els.csvFile.disabled = busy;
  }

  function clearGrid() {
    while (els.sheetGrid.firstChild) els.sheetGrid.removeChild(els.sheetGrid.firstChild);
    state.items = [];
    els.printSheet.disabled = true;
    els.downloadZip.disabled = true;
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
