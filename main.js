/**
 * main.js — Electron 主行程。
 *
 * 安全設定（NFR-02，對照 Electron 官方 Security Checklist）：
 *   - nodeIntegration: false      renderer 不得存取 Node API
 *   - contextIsolation: true      隔離 preload 與頁面的 JS 環境
 *   - sandbox: true               renderer 在 OS 沙箱中執行
 *   - 攔截所有導覽與開新視窗      防止載入外部內容
 *   - 攔截所有網路請求            確保「完全離線」為技術上的保證而非承諾
 */
'use strict';

const { app, BrowserWindow, shell, session } = require('electron');
const path = require('path');
const { fileURLToPath } = require('url');

/** 允許載入的本地檔案根目錄 */
const APP_ROOT = path.join(__dirname, 'src');

/** url 是否為 APP_ROOT 底下的 file:// 位址 */
function isInsideAppRoot(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;
    const rel = path.relative(APP_ROOT, fileURLToPath(parsed));
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  } catch (e) {
    return false;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 600,
    title: 'vCard QRCode 產生器',
    backgroundColor: '#f4f6f9',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    }
  });

  // 視窗準備好才顯示，避免白畫面閃爍
  win.once('ready-to-show', () => win.show());

  win.loadFile(path.join(APP_ROOT, 'index.html'));

  // 只允許在 src/ 底下的本地頁面之間導覽（index.html ↔ batch.html）。
  // 外部位址、src/ 以外的本機檔案一律擋下；解析失敗一律視為不安全（fail-closed）。
  win.webContents.on('will-navigate', (event, url) => {
    if (!isInsideAppRoot(url)) {
      event.preventDefault();
    }
  });

  // 禁止開新視窗；若真有外部連結需求，交給系統瀏覽器處理。
  // 以解析後的 protocol 嚴格比對，不用字串前綴判斷（防開放重新導向）。
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).protocol === 'https:') {
        shell.openExternal(url);
      }
    } catch (e) {
      // 無法解析的 URL 一律忽略
    }
    return { action: 'deny' };
  });

  // 禁止 webview 附加（攻擊面收斂）
  win.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  return win;
}

/**
 * 攔截所有非 file:// 的請求。
 * 這是「離線運作」的技術保證——即使日後有人不慎加入外部資源，也會被擋下。
 */
function enforceOffline() {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const isLocal = details.url.startsWith('file://') ||
                    details.url.startsWith('devtools://') ||
                    details.url.startsWith('blob:') ||
                    details.url.startsWith('data:');
    if (!isLocal) {
      console.warn('[offline-guard] 已封鎖對外請求：', details.url);
      return callback({ cancel: true });
    }
    callback({ cancel: false });
  });

  // 一律拒絕所有權限請求（相機、地理位置、通知等，本程式皆不需要）
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
}

app.whenReady().then(() => {
  enforceOffline();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
