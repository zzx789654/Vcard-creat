# vCard QRCode 產生器

完全離線的 vCard 3.0 電子名片 QRCode 產生器。左邊填聯絡資料，右邊即時看到 QRCode，手機掃描即可存入通訊錄。

**全程不連網**：沒有任何 CDN、沒有任何 API 呼叫、個資不離開你的電腦。

---

## 快速開始

### 方式一：直接開啟（不需安裝任何東西）

用瀏覽器開啟 `src/index.html` 即可使用，所有功能完整可用。

```
雙擊 src\index.html
```

### 方式二：Electron 桌面程式（需要 Node.js）

```bash
npm install
npm start
```

打包成 Windows 安裝檔／免安裝版：

```bash
npm run build            # 產生安裝檔 (NSIS) 與 portable 版
npm run build:portable   # 只產生免安裝版
```

> Windows 安裝檔／免安裝版也會在推送版本 tag（`v*`）時，由 GitHub Actions 的 `release` workflow 自動打包並發佈到 GitHub Release（見下方「持續整合／交付」）。

---

## 功能

- **即時預覽**：打字的同時右欄 QRCode 就更新，不需要按「產生」按鈕。
- **vCard 3.0（RFC 2426）**：符合規範的跳脫、折行與結構化欄位，手機通訊錄可正確辨識。
- **預設欄位齊備**：姓名、手機、公司電話、住家電話、Email、公司、職稱、網站、地址、備註。
- **自訂欄位**：規格外的資料（LINE ID、社群帳號等）可自行新增，非標準名稱會自動加上 `X-` 前綴以符合規範。
- **容錯等級可調**：L / M / Q / H，資料量與抗污損程度的取捨。
- **容量提示**：即時顯示資料佔用的位元組與百分比，接近上限會變色警示。
- **下載**：QRCode 存成 PNG、名片存成 `.vcf`。
- **無障礙**：符合 WCAG 2.1 AA（對比、鍵盤操作、螢幕閱讀器標籤、觸控目標 ≥44px）。
- **深色模式**：跟隨系統主題自動切換。

---

## 專案結構

```
Vcard-creat/
├── main.js              Electron 主行程（含離線強制攔截）
├── preload.js           橋接層（刻意不暴露任何 API，最小權限）
├── package.json
├── src/
│   ├── index.html       UI 結構（含 CSP）
│   ├── styles.css       設計系統與響應式
│   ├── renderer.js      UI 控制邏輯
│   ├── lib/vcard.js     vCard 3.0 產生器（純函式，可獨立測試）
│   └── vendor/qrcode.js 內嵌 QR 編碼器（MIT，無外部相依）
├── test/
│   ├── test-cases.js        測試案例（兩個 runner 共用）
│   ├── run-tests.js         單元測試 runner（Node 版）
│   ├── run-tests-wsh.js     單元測試 runner（無 Node 時的 Windows 版）
│   ├── run-tests.ps1             無 Node 環境的測試啟動器
│   ├── verify-qr-decode.js       QR 反解端到端驗證（Windows / cscript 版）
│   └── verify-qr-decode-node.js  QR 反解端到端驗證（Node / CI 版）
├── .github/workflows/
│   ├── ci.yml           持續整合：測試 + SCA + 密鑰掃描 + SAST
│   └── release.yml      持續交付：打包 Windows 安裝檔並發佈 Release
├── CoreMain.md          專案中心思想
├── SRS.md               需求規格
└── 待修改.md            開發計畫與關卡狀態
```

---

## 測試

### 有安裝 Node.js

```bash
npm test         # 60 條單元測試
npm run verify   # 7 條 QR 反解端到端驗證
```

### 沒有安裝 Node.js（Windows）

```powershell
powershell -ExecutionPolicy Bypass -File test\run-tests.ps1
```

> 主控台顯示的中文可能是亂碼，這是 `cscript` 的輸出編碼限制，不影響測試結果。
> 請以 `PASS`/`FAIL` 標記與結尾統計為準。

**目前測試狀態**：60 條單元測試全數通過（100%），另有 7 條 QR 反解端到端驗證全數通過。

反解驗證會把產生出來的 QR 矩陣用獨立實作的解碼器讀回文字，證明輸出確實是可被掃描器讀取的 vCard，而不只是「看起來像 QR 的圖」。

---

## 安全設計

這個程式會處理個人聯絡資料，因此安全性是核心需求而非附加項：

| 面向 | 做法 |
|---|---|
| **離線保證** | Electron 主行程以 `webRequest` 攔截所有非本地請求；CSP 設定 `connect-src 'none'`。即使日後有人不慎加入外部資源也會被擋下。 |
| **XSS 防護** | 全專案不使用 `innerHTML`／`eval`；使用者輸入一律以 `textContent` 或 `value` 寫入 DOM。 |
| **vCard 注入防護** | 值中的 CRLF、控制字元會被剝除或跳脫，無法偽造出額外的 vCard 屬性行；自訂欄位鍵名採白名單淨化（只允許 `A-Z0-9-`）。 |
| **Electron 隔離** | `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`；preload 不暴露任何 API。 |
| **檔名安全** | 下載檔名過濾路徑分隔符、控制字元與 Windows 保留裝置名稱。 |

已通過靜態安全檢查：**Critical = 0、High = 0、無硬編碼密鑰**。

相依套件 CVE 掃描（SCA）：已提交 `package-lock.json`，`npm audit` 為 **0 弱點**。
產品執行期零相依（QR 編碼器與 vCard 產生器皆自行內嵌），`npm audit --omit=dev` 亦為 0；
建置工具鏈（electron / electron-builder）已升級至已修補的安全版本。

---

## 持續整合／交付（CI/CD）

以 GitHub Actions 把品質與安全門檻自動化，每次 push / PR 都重新驗證：

| Workflow | 觸發 | 內容 |
|---|---|---|
| **`ci.yml`（G5）** | push / PR | 功能+品質：`npm test` + `npm run verify` + 語法檢查；資安：`npm audit`（SCA）、Gitleaks（密鑰）、Semgrep（SAST，僅掃產品碼）。任一未達標即擋 build。 |
| **`release.yml`（G6）** | 推送 `v*` tag | 打包前重跑測試 → 於 Windows runner 以 electron-builder 產出 NSIS 安裝檔與 portable 版 → 發佈 GitHub Release。 |

發佈新版本：

```bash
git tag v1.0.0 && git push origin v1.0.0
```

---

## 已知限制

- **不內嵌大頭照（PHOTO）**：會使 QR 資料量暴增到難以掃描，違反核心價值。
- **只支援 vCard 3.0**：不做 2.1 / 4.0 版本切換（專案主題明訂以 3.0 為主）。
- **不做批次處理**：一次一張名片，保持簡單。
- **資料量上限**：QR 規格上限約 2331 位元組（容錯 M）。備註過長時會顯示明確提示，並建議降低容錯等級或縮短內容。

---

## 授權

MIT。內嵌的 QR 編碼器基於 Kazuhiko Arase 的 qrcode-generator 演算法實作，同為 MIT 授權。
