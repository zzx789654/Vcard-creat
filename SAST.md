# SAST — 安全掃描稽核紀錄

> 每次安全掃描追加一則，**最新在上、不覆蓋**。密鑰命中只記「位置＋類型＋是否已輪替」，絕不寫入原文。
> 原始報表存於 `reports/sast-<日期>/`。

---

## [2026-10-09] 第 2 次獨立 SAST — v1.2.1（commit `a8656a2`，main）

### 範圍與標準
- **範圍**：同上次（產品碼、`scripts/`、`.github/workflows/`、`package-lock.json`）。人工審查聚焦上次掃描後的變更（`0eca8a2..a8656a2`）：
  `main.js`（`isInsideAppRoot`）、`src/batch.js`（檔案大小上限）、`scripts/osv-check.py`（新增）、`scripts/trust-and-sign.ps1`、`ci.yml`、`release.yml`（版本一致性檢查、`target_commitish`）。
- **對照**：OWASP Top 10:2025、CWE；Exit Criteria 沿用 `待修改.md`。

### 工具與指令（可重現）
| 類別 | 工具 | 指令摘要 | 結果 |
|---|---|---|---|
| SCA① | npm audit（npm 10.9.8） | `npm audit --json` | **0**（Critical 0／High 0／Moderate 0／Low 0） |
| SCA② | OSV.dev API | `py -I scripts/osv-check.py package-lock.json` | 261 個套件版本，命中 **0**（exit 0） |
| SAST | — | **未跑**：本機沒有 Semgrep／Bandit；使用者指定的 sast-studio MCP（上傳 ZIP、掃 repo URL）兩種方式都被本機權限設定擋下 | 改用人工審查（見下） |
| 資料流 | 人工審查 | 追蹤 URL → `will-navigate`／`setWindowOpenHandler`／`openExternal`；CSV 檔 → `FileReader` | 沒有 High 以上的 source→sink 路徑 |
| Secret | git grep 金鑰樣式（工作樹＋`git log --all -p`） | AWS／GitHub PAT／Slack／Google API key／私鑰標頭／`password=` 類樣式 | **0**；**未跑 gitleaks**，只是粗篩 |
| 其他 | grep | 危險 sink（innerHTML、eval、child_process…）、抑制註解 | 產品碼 0；抑制註解 0（`lessons.md` 只有文字提到） |

原始報表：`reports/sast-2026-10-09/`（`npm-audit.json`、`osv.txt`）。

### 人工審查重點
- `isInsideAppRoot()`：先 `fileURLToPath` 再 `path.relative`，擋 `..`、跨磁碟（會得到絕對路徑）與 `src` 本身；解析失敗會回 false（fail-closed）✅
- `setWindowOpenHandler`：只把 `https:` 交給 `shell.openExternal`，開新視窗一律 `deny` ✅
- `release.yml`：`inputs.version` 先放進 `env: TAG`，再在 shell 用 `$TAG` 讀取，沒有直接把 `${{ }}` 內插進 `run:`，不會有 script injection（CWE-78）✅
- `osv-check.py`：只用 `HTTPSConnection` 連固定主機，任何錯誤都 exit 1 ✅
- `batch.js`：讀檔前就先檢查 5 MB 上限 ✅

### 弱點清單
| 編號 | 嚴重度 | 位置 | CWE／OWASP | 說明 | 狀態 |
|---|---|---|---|---|---|
| FIND-005 | Low | `ci.yml` 12 處、`release.yml` 5 處 `uses:@vN`；容器 `gitleaks:latest`、`semgrep/semgrep` | CWE-829／A03 | 沿用上次：以可變 tag 參照 | ⏸ 仍保留 |

本輪沒有新增 finding。

### 指標
- 嚴重度分佈（未關閉）：Critical 0／High 0／Medium 0／Low 1
- 相依套件：0 個已知漏洞（雙來源結果一致）

### 判定（初掃）
**資安指標達標，但 G3 證據不完整**：Critical/High = 0、SCA = 0、人工審查沒有新弱點；不過 SAST 工具（Semgrep）與 gitleaks 本輪沒有在本機跑。

### SAST Studio 報告分析（使用者於 2026-10-09 20:01 提供，`git: https://github.com/zzx789654/Vcard-creat`）
- 報告：semgrep／bearer／trivy／npm_audit／osv_scanner／gitleaks；高 53、中 48、低 9，共 110；判定「阻擋」。
- **掃到的不是 main**：repo 的預設分支（HEAD）仍是舊的 `claude/vcard-create-migration-xr6nb5`。報告中 electron 43.4.0、@xmldom/xmldom 0.8.14、fast-uri 3.1.5、
  `ci.yml:133` 的 curl|shell，都是舊分支的內容；main 是 electron 43.7.8、xmldom 0.8.15、fast-uri 3.1.8，curl 早已移除（FIND-001～003）。
- 逐項對照 main：
  | 報告項目 | 筆數 | 在 main 上 |
  |---|---|---|
  | npm_audit／osv_scanner：electron、xmldom、brace-expansion、fast-uri、undici、js-yaml、http-cache-semantics、sprintf-js、global-agent、roarr 等 | 93 | 不存在（npm audit 0、OSV 0，見上表） |
  | semgrep `gha-curl-pipe-shell`（ci.yml:133） | 1 | 不存在（FIND-003 已改用 `osv-check.py`） |
  | semgrep `github-actions-mutable-action-tag` | 15 | **存在** → FIND-005，本輪修補 |
  | bearer `javascript_lang_logger_leak`（main.js:91） | 1 | **存在** → FIND-008，本輪修補 |
  | semgrep PartialParsing（ci.yml） | — | 掃的是舊分支的 ci.yml；main 版待下次以工具重掃確認 |

### 新增 finding
| 編號 | 嚴重度 | 位置 | CWE／OWASP | 說明 | 修補方向 | 狀態 |
|---|---|---|---|---|---|---|
| FIND-008 | Low | `main.js` `enforceOffline()` | CWE-532／A09 | 被封鎖的對外請求會把**完整 URL** 寫進 console；若日後有程式錯誤把聯絡人資料放進網址，資料會留在日誌 | 只記錄「協定//主機」 | ✅ 已修補（回歸③） |

### 回歸③（2026-10-09，修補 FIND-005、FIND-008）
- FIND-005：`ci.yml`（12 處）、`release.yml`（5 處）全部改成完整 commit SHA／映像 digest，行尾註明原版本，大版本不變：
  checkout v4.4.0 `11d5960a…`、setup-node v4.4.0 `49933ea5…`、codeql-action v3.38.3 `9f759ee6…`、action-gh-release v2.6.2 `3bb12739…`；
  gitleaks、semgrep 映像改成 `@sha256:` digest（2026-10-09 的 latest）。SHA 以 `git ls-remote --tags` 查各上游 repo 取得（annotated tag 取 `^{}` 指向的 commit），
  digest 以 `docker buildx imagetools inspect` 取得。檢查：`uses:`／`image:` 沒有釘選的剩 **0** 處。
- FIND-008：新增 `blockedTarget()`，只輸出 `protocol//host`，無法解析時輸出固定字樣。實測：`https://evil.example.com/a?name=…&tel=…` → `https://evil.example.com`；無效網址 → `(無法解析的網址)`。
- 回歸：`node --check main.js` OK；`npm test` 61／61；`npm run verify` 7／7。
- **尚未以工具重掃**：sast-studio MCP 在本機被擋；而且 repo 預設分支沒改回 main 之前，用 URL 掃描仍會掃到舊分支。

### 判定（回歸後）
main 上已知 finding 全部關閉（Critical 0／High 0／Medium 0／Low 0）。G3 的工具證據要等推送後 CI 綠燈（Semgrep＋Gitleaks＋CodeQL＋SCA 雙來源），
或預設分支改回 main 之後，再跑一次 SAST Studio 補上。

### G3 工具證據（2026-10-09）
- GitHub Actions `ci` run 37927940196（push）、37927947658（pull_request），commit `868fc8d`：Semgrep、CodeQL（JS/TS＋Python＋Actions）、Gitleaks、npm audit、OSV.dev、測試與反解 **全數 success**，Gate G5 job success。
- 這兩次 run 用的就是本次釘選的 SHA／digest，同時證明釘選後的 workflow 可正常執行。
- repo 預設分支已改回 `main`（`gh repo edit --default-branch main`）。
- **判定：G3 達標。**

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
| FIND-001 | **High** | `package.json` electron `^43.4.0`（鎖 43.4.0） | CWE-1395／A03 | **出貨執行期**的 Electron 有 4 則 High：GHSA-gr2m-v5gq-v685、GHSA-j84w-jfhq-vhvj、GHSA-9qh4-3jw8-366w、GHSA-qmv3-fv6v-rmhq。本程式已關 webview、拒絕開新視窗、開 sandbox、CSP `connect-src 'none'`，實際可利用性低，但仍屬已知漏洞版本 | 升級至 43.4.1 以上（同 major 最新 43.7.8） | ✅ 已修補（見回歸） |
| FIND-002 | Medium（工具報 High） | `package-lock.json` 建置工具鏈遞移相依：@xmldom/xmldom、brace-expansion、fast-uri、undici、js-yaml、http-cache-semantics（High）；sprintf-js、global-agent、roarr 等（Moderate） | CWE-1395／A03 | 只在 electron-builder 打包時使用，**不進安裝檔**，故下調一級。但 CI 的 `npm audit --audit-level=high` 會因此**轉紅**，G5 失守 | `npm audit fix`（不加 `--force`，不降級 electron-builder） | ✅ 已修補（見回歸） |
| FIND-003 | Medium | `.github/workflows/ci.yml:129-142` | CWE-494／A08 | 從 GitHub Release 下載 osv-scanner 二進位後**未驗 SHA256** 即執行；若下載來源或傳輸被竄改，會在 CI runner 執行任意程式 | 固定版本號，並以官方 `osv-scanner_SHA256SUMS` 驗 checksum；或改用官方 `google/osv-scanner-action`（以 commit SHA 釘選） | ✅ 已修補（回歸②） |
| FIND-004 | Medium | `scripts/trust-and-sign.ps1:54-62、70` | CWE-321／A04 | 自簽碼簽憑證的私鑰設成 `-KeyExportPolicy Exportable` 且有效 5 年，憑證又被加入 CurrentUser 的 Root＋TrustedPublisher。同使用者權限的惡意程式可以匯出或直接使用該私鑰，簽出本機會信任的程式 | 改 `NonExportable`；效期縮短（例如 1 年）；文件提醒「只在自己電腦用、用完可從 Root 移除」 | ✅ 已修補（回歸②） |
| FIND-005 | Low | `ci.yml`、`release.yml` 共 15 處 `uses: …@v4`；容器 `gitleaks:latest`、`semgrep/semgrep` | CWE-829／A03 | Action 與容器以可變 tag 參照，上游被入侵時會自動帶進 CI。`release.yml` 擁有 `contents: write` 權限，影響較大 | 以完整 commit SHA 釘選（註解標版本），容器用 digest | ⏸ 保留（需查第三方 repo 的 commit SHA，超出本 session 權限） |
| FIND-006 | Low | `main.js:47-58`（`will-navigate`） | CWE-284／A01 | 只要是 `file:` 就允許導覽，未限制在 `src/` 底下。目前沒有 XSS 入口（CSP＋全程 textContent），屬縱深防禦缺口 | 解析路徑後確認位於 `APP_ROOT` 內才放行 | ✅ 已修補（回歸②） |
| FIND-007 | Low | `src/batch.js:76-93` | CWE-400／A06 | CSV 整份讀入並解析後才截到 500 列，未限制檔案大小；選到超大檔會讓視窗卡死（僅影響本機自身） | 讀檔前檢查 `file.size`（例如 > 5 MB 即拒絕並提示） | ✅ 已修補（回歸②） |

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

### 回歸掃描②（2026-10-07，修補 FIND-003／004／006／007，v1.2.1）
- FIND-003：`ci.yml` 的 osv job 改為執行 `scripts/osv-check.py`，用 Python 標準函式庫直接查 OSV.dev API，**不再下載、執行外部二進位**；
  查詢失敗也 exit 1（fail-closed）。以已知有漏洞的 `sprintf-js@1.1.3` 做反向測試，確認會 exit 1。
  首版用 `urllib.request.urlopen` 被 Bandit B310 標出（可接受非 https 協定），改用只支援 HTTPS 的 `http.client.HTTPSConnection`，未加抑制註解。
- FIND-004：`trust-and-sign.ps1` 改 `-KeyExportPolicy NonExportable`、效期 1 年；README 補充舊憑證的移除方式。
- FIND-006：`main.js` 新增 `isInsideAppRoot()`，`will-navigate` 只放行 `src/` 底下的 `file:` 頁面。
  實測：`src/index.html`、`src/batch.html?x#y` 放行；`/etc/passwd`、`src/../main.js`、`srcevil/a.html`、https、無效 URL、`src` 目錄本身皆擋下。
- FIND-007：`batch.js` 讀檔前檢查 `file.size > 5 MB` 即拒絕。Playwright 實測：5.6 MB 檔顯示錯誤且「產生」鈕停用；正常小檔可產生。
- 結果：Semgrep 15（全為 FIND-005）、`gha-curl-pipe-shell` 消失；Bandit 0；npm audit 0；OSV 0；`npm test` 61／61；`npm run verify` 7／7。
- 剩餘：FIND-005（Low）。釘選 Action 需查 actions/checkout 等第三方 repo 的 commit SHA，本 session 的 GitHub 權限僅限本 repo，留待手動處理或用 Dependabot 自動釘選。

### 回歸掃描①（2026-10-07，修補 FIND-001／002 後）
- 觸發：CI run #23 的 `npm audit`（SCA①）與 OSV-Scanner（SCA②）兩個 job 失敗，原因即 FIND-001／002。
- 修補：
  - `electron` `^43.4.0` → `^43.7.8`、`electron-builder` `^26.15.3` → `^26.17.0`，並執行 `npm audit fix`（未加 `--force`）。
  - `sprintf-js` 所有版本都有 GHSA-hp3w-g68c-fv3c，沒有修正版。它的引入路徑是 electron-builder → app-builder-lib → @electron/get → global-agent 3 → roarr，
    而 global-agent 4.x 已不依賴 roarr，因此在 `package.json` 加 `overrides: { "global-agent": "^4.1.3" }` 讓整條鏈消失。
    @electron/get 只在設定 `ELECTRON_GET_USE_PROXY` 時呼叫 `require('global-agent').bootstrap()`，4.x 仍提供此 API（已驗證為 function）。
- 結果：`npm audit` **0**；OSV.dev 查詢 276 套件 **0** 命中；`npm test` 61／61；`npm run verify` 7／7。
- 限制：本機無法下載 Electron 主程式（proxy TLS 錯誤），打包只驗證到 electron-builder 載入設定與原生相依安裝；完整 Windows 打包以 release workflow 為準。
- 判定：High = 0，**Exit Criteria 達標**。FIND-003～007（Medium 2／Low 3）仍為建議修補。

### 判定（初掃）
**未達標**：Exit Criteria「High = 0」不成立（FIND-001），且 CI 的 SCA gate 目前會失敗（FIND-002）。修補 FIND-001、FIND-002 後重跑 SCA 即可回到達標；FIND-003～007 為建議修補。
