# SAST — 安全掃描稽核紀錄

> 每次安全掃描追加一則，**最新在上、不覆蓋**。密鑰命中只記「位置＋類型＋是否已輪替」，絕不寫入原文。
> 原始報表存於 `reports/sast-<日期>/`。

---

## [2026-10-07] 第 1 次獨立 SAST — v1.2.0（commit `38a72f7`）

### 範圍與標準
- **範圍**：產品碼 `main.js`、`preload.js`、`src/*.js`、`src/lib/*.js`、`src/*.html`；
  輔助腳本 `scripts/*.py`、`scripts/*.ps1`；CI/CD `.github/workflows/*.yml`；相依套件 `package-lock.json`（284 個）。
- **不掃**：`src/vendor/qrcode.js`（第三方 MIT 內嵌碼）、`test/`（不出貨）、`node_modules/`。
- **對照**：OWASP Top 10:2025、CWE、ASVS L1（離線單機桌面程式，無帳號、無伺服器）。
- **Exit Criteria**（沿用 `待修改.md`）：Critical/High = 0；無硬編碼密鑰；零對外網路請求；Electron 隔離設定齊備。

### 工具與指令（可重現）
| 類別 | 工具 | 指令摘要 | 結果 |
|---|---|---|---|
| SAST | Semgrep 1.179.0 | `semgrep --config=p/owasp-top-ten,p/javascript,p/nodejsscan,p/xss,p/secrets,p/python,p/github-actions --exclude=test --exclude=src/vendor src main.js preload.js scripts .github` | 400 條規則／15 檔：產品碼 **0**；workflow 16（15 真陽性、1 誤報） |
| SAST（Python） | Bandit 1.9.4 | `bandit -r scripts` | 0 |
| 資料流／注入 | 人工審查 | 追蹤使用者輸入 → DOM／vCard／CSV／檔名 | 見下方 A05 |
| Secret | detect-secrets＋git 全歷史 grep | `detect-secrets scan --all-files`；`git log --all -p \| grep` 金鑰樣式 | **0**（歷史命中皆為 workflow 的 `secrets.GITHUB_TOKEN` 參照或文件文字） |
| SCA① | npm audit | `npm audit --json` | High 7、Moderate 8、Critical 0 |
| SCA② | OSV.dev API | `POST api.osv.dev/v1/querybatch`（284 套件） | 14 個套件版本命中，與 npm audit 一致 |

> 本機無法取得 gitleaks／osv-scanner 二進位（GitHub API 被 egress proxy 擋 403），改以 detect-secrets 與 OSV API 直查代替；CI 仍有 gitleaks／osv-scanner。

### 弱點清單（依嚴重度）
| 編號 | 嚴重度 | 位置 | CWE／OWASP | 說明 | 修補方向 | 狀態 |
|---|---|---|---|---|---|---|
| FIND-001 | **High** | `package.json` electron `^43.4.0`（鎖 43.4.0） | CWE-1395／A03 | **出貨執行期**的 Electron 有 4 則 High：GHSA-gr2m-v5gq-v685、GHSA-j84w-jfhq-vhvj、GHSA-9qh4-3jw8-366w、GHSA-qmv3-fv6v-rmhq。本程式已關 webview、拒絕開新視窗、開 sandbox、CSP `connect-src 'none'`，實際可利用性低，但仍屬已知漏洞版本 | 升級至 43.4.1 以上（同 major 最新 43.7.8） | 待修補 |
| FIND-002 | Medium（工具報 High） | `package-lock.json` 建置工具鏈遞移相依：@xmldom/xmldom、brace-expansion、fast-uri、undici、js-yaml、http-cache-semantics（High）；sprintf-js、global-agent、roarr 等（Moderate） | CWE-1395／A03 | 只在 electron-builder 打包時使用，**不進安裝檔**，故下調一級。但 CI 的 `npm audit --audit-level=high` 會因此**轉紅**，G5 失守 | `npm audit fix`（不加 `--force`，不降級 electron-builder） | 待修補 |
| FIND-003 | Medium | `.github/workflows/ci.yml:129-142` | CWE-494／A08 | 從 GitHub Release 下載 osv-scanner 二進位後**未驗 SHA256** 即執行；若下載來源或傳輸被竄改，會在 CI runner 執行任意程式 | 固定版本號，並以官方 `osv-scanner_SHA256SUMS` 驗 checksum；或改用官方 `google/osv-scanner-action`（以 commit SHA 釘選） | 待修補 |
| FIND-004 | Medium | `scripts/trust-and-sign.ps1:54-62、70` | CWE-321／A04 | 自簽碼簽憑證的私鑰設成 `-KeyExportPolicy Exportable` 且有效 5 年，憑證又被加入 CurrentUser 的 Root＋TrustedPublisher。同使用者權限的惡意程式可以匯出或直接使用該私鑰，簽出本機會信任的程式 | 改 `NonExportable`；效期縮短（例如 1 年）；文件提醒「只在自己電腦用、用完可從 Root 移除」 | 待修補 |
| FIND-005 | Low | `ci.yml`、`release.yml` 共 15 處 `uses: …@v4`；容器 `gitleaks:latest`、`semgrep/semgrep` | CWE-829／A03 | Action 與容器以可變 tag 參照，上游被入侵時會自動帶進 CI。`release.yml` 擁有 `contents: write` 權限，影響較大 | 以完整 commit SHA 釘選（註解標版本），容器用 digest | 待修補 |
| FIND-006 | Low | `main.js:47-58`（`will-navigate`） | CWE-284／A01 | 只要是 `file:` 就允許導覽，未限制在 `src/` 底下。目前沒有 XSS 入口（CSP＋全程 textContent），屬縱深防禦缺口 | 解析路徑後確認位於 `APP_ROOT` 內才放行 | 待修補 |
| FIND-007 | Low | `src/batch.js:76-93` | CWE-400／A06 | CSV 整份讀入並解析後才截到 500 列，未限制檔案大小；選到超大檔會讓視窗卡死（僅影響本機自身） | 讀檔前檢查 `file.size`（例如 > 5 MB 即拒絕並提示） | 待修補 |

**誤報（不開單）**
- Semgrep `gha-curl-pipe-shell`（`ci.yml:134`）：`curl … | python3 -c` 是把 JSON 交給 Python 解析取下載網址，**不是把下載內容當 shell 執行**。真正的風險是下載後未驗證，已由 FIND-003 涵蓋。

### 人工審查：OWASP Top 10:2025 逐類
| 類別 | 結論 |
|---|---|
| A01 權限控制 | 無帳號／伺服器；導覽限制見 FIND-006；權限請求一律拒絕（`main.js:93`） ✅ |
| A02 安全設定 | `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`、`webSecurity:true`；preload 不暴露任何 API；CSP `default-src 'none'` ✅ |
| A03 供應鏈 | FIND-001、FIND-002、FIND-005 |
| A04 加密失效 | 程式本身不涉加密；簽章腳本見 FIND-004 |
| A05 注入 | DOM 全程 `textContent`（無 innerHTML／eval）；vCard 值依 RFC 2426 跳脫並移除控制字元，防止偽造屬性行（TC-708）；下載檔名經 `safeFileName` 清洗；只**匯出範本**、不匯出使用者資料，無 CSV 公式注入面 ✅ |
| A06 不安全設計 | 單次 500 列上限；檔案大小未設限見 FIND-007 |
| A07 認證失效 | 不適用（無登入） |
| A08 完整性失效 | CI 下載未驗證見 FIND-003；不做自動更新 ✅ |
| A09 日誌監控 | 僅記錄被封鎖的對外 URL，不記錄聯絡人資料 ✅ |
| A10 例外處理 | URL 解析失敗即拒絕（fail-closed）；CSV 解析失敗只顯示通用訊息 ✅ |

### 指標
- 嚴重度分佈：Critical 0／High 1／Medium 3／Low 3（共 7）
- 漏洞密度：7 ÷ 1.87 KLOC（產品碼＋腳本，不含 vendor／test）≈ **3.7／KLOC**；只算出貨產品碼的程式邏輯弱點：2 ÷ 1.45 KLOC ≈ 1.4／KLOC
- 誤報率（Semgrep）：1 ÷ 16 = 6.3%
- 相依套件：出貨執行期 High 1（Electron）；建置期 High 6 個套件、Moderate 8
- OWASP 覆蓋：10／10 類已審（A07 不適用）

### 判定
**未達標**：Exit Criteria「High = 0」不成立（FIND-001），且 CI 的 SCA gate 目前會失敗（FIND-002）。修補 FIND-001、FIND-002 後重跑 SCA 即可回到達標；FIND-003～007 為建議修補。
