/**
 * preload.js — 在 contextIsolation 下執行的橋接層。
 *
 * 本程式的 renderer 完全不需要 Node 或 IPC 能力（QR 產生、檔案下載都用
 * 瀏覽器原生 API 完成），因此這裡刻意「不暴露任何東西」——
 * 最小權限原則：沒有橋接面，就沒有透過橋接面被利用的可能。
 */
'use strict';

// 目前不需要暴露任何 API 給 renderer。
// 若日後真的需要（例如原生「另存新檔」對話框），請用：
//   const { contextBridge, ipcRenderer } = require('electron');
//   contextBridge.exposeInMainWorld('api', { saveFile: (...) => ipcRenderer.invoke(...) });
// 並且只暴露具體、受限的函式，切勿直接暴露 ipcRenderer 本身。
