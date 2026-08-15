/**
 * renderer.js — UI 控制層：蒐集輸入 → 產生 vCard → 繪製 QRCode。
 *
 * 安全原則（NFR-03）：
 *   使用者輸入一律以 textContent / value 寫入 DOM，全檔不使用 innerHTML，
 *   避免 XSS（CWE-79）。
 */
(function () {
  'use strict';

  var DEBOUNCE_MS = 120;      // 打字停止後多久重繪（NFR-01 總計 ≤300ms）
  var QR_PIXEL_SIZE = 640;    // canvas 內部解析度，下載的 PNG 才夠清晰
  var QUIET_ZONE = 4;         // QR 規格要求四周留 4 個模組的靜區

  // 標準欄位 id 清單——蒐集表單資料時逐一讀取
  var FIELD_IDS = [
    'lastName', 'firstName', 'fullName',
    'cell', 'workTel', 'homeTel', 'email',
    'org', 'title', 'url',
    'street', 'city', 'region', 'postalCode', 'country',
    'note'
  ];

  var els = {};
  var state = {
    ecc: 'M',
    lastVCard: '',
    hasQR: false
  };
  var debounceTimer = null;

  // ---------------------------------------------------------------
  // 初始化
  // ---------------------------------------------------------------
  function init() {
    cacheElements();
    bindFormEvents();
    bindEccEvents();
    bindDownloadEvents();
    bindUtilityEvents();
    render();   // 首次繪製 → 進入空狀態
  }

  function cacheElements() {
    FIELD_IDS.forEach(function (id) { els[id] = document.getElementById(id); });
    els.form          = document.getElementById('vcard-form');
    els.canvas        = document.getElementById('qr-canvas');
    els.empty         = document.getElementById('qr-empty');
    els.error         = document.getElementById('qr-error');
    els.errorMsg      = document.getElementById('qr-error-msg');
    els.status        = document.getElementById('qr-status');
    els.metaVersion   = document.getElementById('meta-version');
    els.metaBytes     = document.getElementById('meta-bytes');
    els.capacityFill  = document.getElementById('capacity-fill');
    els.capacityText  = document.getElementById('capacity-text');
    els.downloadPng   = document.getElementById('download-png');
    els.downloadVcf   = document.getElementById('download-vcf');
    els.rawVcard      = document.getElementById('raw-vcard');
    els.emailError    = document.getElementById('email-error');
    els.loadSample    = document.getElementById('load-sample');
    els.clearAll      = document.getElementById('clear-all');
  }

  function bindFormEvents() {
    // 事件委派：輸入任一欄位就排程重繪（Nielsen #1 系統狀態可見）
    els.form.addEventListener('input', scheduleRender);
    // 避免表單意外送出（本程式無後端）
    els.form.addEventListener('submit', function (e) { e.preventDefault(); });
    els.email.addEventListener('blur', validateEmail);
  }

  function bindEccEvents() {
    var segs = document.querySelectorAll('.seg');
    Array.prototype.forEach.call(segs, function (btn) {
      btn.addEventListener('click', function () {
        state.ecc = btn.getAttribute('data-ecc');
        Array.prototype.forEach.call(segs, function (b) {
          var active = (b === btn);
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        render();
      });
    });
  }

  function bindDownloadEvents() {
    els.downloadPng.addEventListener('click', downloadPNG);
    els.downloadVcf.addEventListener('click', downloadVCF);
  }

  function bindUtilityEvents() {
    els.loadSample.addEventListener('click', loadSample);
    els.clearAll.addEventListener('click', clearAll);
  }

  // ---------------------------------------------------------------
  // 資料蒐集與驗證
  // ---------------------------------------------------------------
  function collectData() {
    var data = {};
    FIELD_IDS.forEach(function (id) {
      data[id] = els[id] ? els[id].value : '';
    });
    return data;
  }

  /** 判斷是否有任何實質輸入——全空時顯示空狀態而非產生只有骨架的 QR */
  function hasAnyInput(data) {
    return FIELD_IDS.some(function (id) {
      return String(data[id] || '').trim() !== '';
    });
  }

  /** Email 為軟性驗證：格式不對只提示，不阻擋產生（使用者可能有特殊用法）*/
  function validateEmail() {
    var v = els.email.value.trim();
    var ok = v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    els.emailError.hidden = ok;
    els.email.setAttribute('aria-invalid', ok ? 'false' : 'true');
    if (!ok) els.emailError.textContent = 'Email 格式看起來不正確，仍會寫入 vCard。';
  }

  // ---------------------------------------------------------------
  // 繪製流程
  // ---------------------------------------------------------------
  function scheduleRender() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, DEBOUNCE_MS);
  }

  function render() {
    var data = collectData();

    if (!hasAnyInput(data)) {
      showEmptyState();
      return;
    }

    var vcard;
    try {
      vcard = VCard.build(data);
    } catch (e) {
      showErrorState('組合 vCard 時發生錯誤，請檢查輸入內容。');
      return;
    }

    state.lastVCard = vcard;
    els.rawVcard.textContent = vcard;   // textContent：不做 HTML 解析（防 XSS）

    var byteLen = QRCodeLib.utf8ByteLength(vcard);
    updateCapacity(byteLen);

    var qr;
    try {
      qr = QRCodeLib.make(vcard, state.ecc);
    } catch (e) {
      if (e.message === 'DATA_TOO_LONG') {
        showErrorState(
          '資料量 ' + byteLen + ' 位元組，已超過 QRCode 可容納的上限。' +
          '請縮短備註或減少欄位，或把容錯等級調低（H → M → L）。'
        );
      } else {
        showErrorState('產生 QRCode 失敗：' + e.message);
      }
      return;
    }

    drawQR(qr);
    showQRState(qr, byteLen);
  }

  function drawQR(qr) {
    var canvas = els.canvas;
    var ctx = canvas.getContext('2d');
    var count = qr.moduleCount;
    var total = count + QUIET_ZONE * 2;

    // 讓每個模組為整數像素，避免模糊造成掃描失敗
    var cell = Math.max(1, Math.floor(QR_PIXEL_SIZE / total));
    var size = cell * total;

    canvas.width = size;
    canvas.height = size;

    // 白底（含靜區）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    // 深色模組
    ctx.fillStyle = '#000000';
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(
            (c + QUIET_ZONE) * cell,
            (r + QUIET_ZONE) * cell,
            cell, cell
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------
  // 三種畫面狀態
  // ---------------------------------------------------------------
  function showEmptyState() {
    state.hasQR = false;
    state.lastVCard = '';
    els.empty.hidden = false;
    els.error.hidden = true;
    els.canvas.style.visibility = 'hidden';
    els.metaVersion.textContent = '—';
    els.metaBytes.textContent = '—';
    els.rawVcard.textContent = '';
    els.downloadPng.disabled = true;
    els.downloadVcf.disabled = true;
    updateCapacity(0);
    els.status.textContent = '尚未輸入資料';
  }

  function showErrorState(message) {
    state.hasQR = false;
    els.empty.hidden = true;
    els.error.hidden = false;
    els.errorMsg.textContent = message;
    els.canvas.style.visibility = 'hidden';
    els.metaVersion.textContent = '—';
    els.downloadPng.disabled = true;
    els.downloadVcf.disabled = state.lastVCard === '';   // vCard 仍可下載
    els.status.textContent = '無法產生 QRCode：' + message;
  }

  function showQRState(qr, byteLen) {
    state.hasQR = true;
    els.empty.hidden = true;
    els.error.hidden = true;
    els.canvas.style.visibility = 'visible';
    els.metaVersion.textContent = '版本 ' + qr.version + '（' + qr.moduleCount + '×' + qr.moduleCount + '）';
    els.metaBytes.textContent = '容錯 ' + state.ecc;
    els.downloadPng.disabled = false;
    els.downloadVcf.disabled = false;
    els.status.textContent = 'QRCode 已更新，資料量 ' + byteLen + ' 位元組';
  }

  function updateCapacity(byteLen) {
    // QR 版本 40 在各容錯等級下的位元組上限（byte mode）
    var MAX_BY_ECC = { L: 2953, M: 2331, Q: 1663, H: 1273 };
    var max = MAX_BY_ECC[state.ecc] || 2331;
    var pct = Math.min(100, Math.round(byteLen / max * 100));

    els.capacityFill.style.width = pct + '%';
    els.capacityFill.classList.toggle('is-warn', pct >= 70 && pct < 90);
    els.capacityFill.classList.toggle('is-danger', pct >= 90);
    els.capacityText.textContent =
      '資料量：' + byteLen + ' / ' + max + ' 位元組（' + pct + '%）';
  }

  // ---------------------------------------------------------------
  // 下載
  // ---------------------------------------------------------------
  function safeFileName() {
    var base = els.fullName.value || '';
    if (!base.trim()) {
      base = (els.lastName.value || '') + (els.firstName.value || '');
    }
    // 淨化邏輯放在 VCard 模組，以便獨立測試（見 lib/vcard.js）
    return VCard.safeFileName(base, 'vcard');
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 延遲釋放，確保下載已開始
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function downloadPNG() {
    if (!state.hasQR) return;
    els.canvas.toBlob(function (blob) {
      if (!blob) {
        els.status.textContent = 'PNG 匯出失敗';
        return;
      }
      triggerDownload(blob, safeFileName() + '-qrcode.png');
      els.status.textContent = 'PNG 已下載';
    }, 'image/png');
  }

  function downloadVCF() {
    if (!state.lastVCard) return;
    // 加上 BOM，讓 Windows 通訊錄軟體正確辨識 UTF-8 中文
    var blob = new Blob(['﻿' + state.lastVCard], { type: 'text/vcard;charset=utf-8' });
    triggerDownload(blob, safeFileName() + '.vcf');
    els.status.textContent = 'vCard 檔案已下載';
  }

  // ---------------------------------------------------------------
  // 範例與清空
  // ---------------------------------------------------------------
  function loadSample() {
    var sample = {
      lastName: '王', firstName: '小明', fullName: '王小明',
      cell: '0912-345-678', workTel: '02-1234-5678', homeTel: '',
      email: 'ming@example.com',
      org: '範例科技股份有限公司', title: '產品經理', url: 'https://example.com',
      street: '信義路五段 7 號', city: '台北市', region: '信義區',
      postalCode: '110', country: '台灣',
      note: '週一至週五 09:00-18:00'
    };
    Object.keys(sample).forEach(function (k) {
      if (els[k]) els[k].value = sample[k];
    });
    render();
    els.status.textContent = '已填入範例資料';
  }

  function clearAll() {
    FIELD_IDS.forEach(function (id) {
      if (els[id]) els[id].value = '';
    });
    els.emailError.hidden = true;
    els.email.setAttribute('aria-invalid', 'false');
    render();
    els.status.textContent = '已清空全部欄位';
  }

  // ---------------------------------------------------------------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
