# Lessons — 開發歷程與教訓

## [2026-08-12] 第 1 輪 — 離線 vCard 3.0 QRCode 產生器（v1.0.0）

### 本輪紀錄
- **PM**：主題確認為「完全離線、左填右看的 vCard 3.0 QRCode 產生器」，寫入 `CoreMain.md`。
  範圍明確排除雲端同步、批次匯入、多版本切換、PHOTO 內嵌（後者會使 QR 大到掃不動，列為本專案特有紅線）。
  Exit Criteria 三維度：功能 FR-01~08 全過、資安 Critical/High=0 且零網路請求、品質通過率 ≥95%。
- **DevSecOps**：Electron 三層架構（main / preload / renderer）；QR 編碼器與 vCard 產生器皆自行內嵌，零外部相依。
  安全左移：CSP `connect-src 'none'`、主行程 `webRequest` 攔截所有非本地請求、preload 不暴露任何 API、全檔零 `innerHTML`。
- **資安**：Critical=0 / High=0 / Medium=2 / Low=4；漏洞密度 5.9/KLOC。6 項 Medium/Low **全數修補完成**並補上回歸測試。
  無硬編碼密鑰。SCA（npm audit）因無 Node 與 lockfile 而 Blocked。
- **QA**：60 條單元測試 + 7 條 QR 反解端到端驗證，Pass 67 / Fail 0，通過率 100%。
  Critical/Major 缺陷 = 0。發現並修正 1 個 UI 缺陷（BUG-001，錯誤狀態疊在空狀態上）。
- **過關狀態**：G1 ✅ / G2 ✅ / G3 ✅（附條件）/ G4 ✅ / G5 ⏸ / G6 ⏸（皆因無 Node.js 而 Blocked）

### 教訓 / 準則

**1. 「有 QR 圖」不等於「掃得出來」——要驗證反解，不是只看圖**
- 情境：自行實作或內嵌 QR 編碼器時。
- 準則：**寫一支獨立的解碼器把產生的矩陣讀回原文，比對是否與輸入完全相同**。
  單看截圖有 QR 圖樣完全無法證明正確性——遮罩、格式資訊、交錯任一步錯了，圖看起來都還是「像 QR」。
  本輪這 7 條反解測試是整套測試中最有價值的部分，等效於無實體手機時的掃描驗證。

**2. `display:flex` 會蓋掉 `[hidden]`，造成狀態疊加**
- 情境：用 `hidden` 屬性切換多個絕對定位的狀態層（空狀態 / 錯誤 / 載入中）時。
- 準則：只要對某 class 設了 `display`，就**必須補一條 `.that-class[hidden] { display: none; }`**。
  否則 `hidden` 完全失效。本輪首次截圖就抓到「錯誤訊息蓋在空狀態上」，若只靠讀程式碼看不出來——
  **UI 一定要真的跑起來截圖看，不能只靠邏輯推理**。

**3. 沒有 Node 不等於不能測——先找環境裡既有的引擎**
- 情境：目標機器缺少預期的執行環境（本輪缺 Node.js）。
- 準則：**別直接把測試標記為 Blocked**。Windows 一定有 `cscript`（WSH），可當 JS 引擎跑純邏輯測試。
  代價是要處理兩個編碼陷阱：(a) cscript 以 ANSI 讀 `.js`，中文會壞掉 → 先轉 UTF-16LE；
  (b) PowerShell 5.1 以 ANSI 讀 `.ps1`，**中文註解會吃掉後面的程式行** → 輔助腳本的註解一律用純 ASCII。
  這比「等使用者裝好 Node」快得多，也讓核心邏輯在交付前就有真實驗證。

**4. 用舊引擎跑測試，會順便逼出真實的相容性 bug**
- 情境：在 ES3 引擎（JScript）上跑為現代瀏覽器寫的程式碼。
- 準則：真實收穫是抓到 `foldLine` 用了 `line[i]` 這種**字串索引存取**（ES5 才有），
  在舊 webview 上會回傳 undefined 而崩潰 → 已改為 `charAt()`。
  但要分清楚界線：**產品程式碼該修的才修（`charAt`），純屬測試環境缺失的（`Array.prototype.map`）用 shim 補在 runner 裡**，
  不要為了遷就測試工具而扭曲產品程式碼。

**5. 同一套測試案例不要維護兩份**
- 情境：為了相容兩種執行環境而寫了兩個 runner。
- 準則：**案例抽成共用檔（`test-cases.js`），runner 只負責載入模組、提供框架、彙整統計**。
  本輪一開始複製貼上兩份，立刻發現新增案例時會漏改另一份 → 中途重構為共用。
  注意 WSH 的 `eval` 在函式內只建立區域繫結，跨檔匯出要顯式掛到註冊物件上。

**6. RFC 的「必填欄位」要真的保證存在**
- 情境：產生有規格約束的格式（vCard、iCal 等）。
- 準則：vCard 3.0 規定 `FN` 必填。原本只在有姓名時才輸出 FN，
  **使用者若只填 Email 就會產出缺 FN 的 vCard，部分通訊錄軟體直接拒收**。
  已改為姓名 → 公司 → Email → 電話逐級遞補。
  這類問題單元測試不會自己浮現，要**回頭逐條對照規格的 MUST 條款**才抓得到。

**7. UI 顯示的容量上限要和編碼器實際上限交叉驗證**
- 情境：UI 用硬編碼的常數顯示進度／容量。
- 準則：兩邊的數字必須用測試釘住（本輪 TC-551/552 逐一驗證四種容錯等級的邊界值），
  否則會出現「進度條顯示 85%，實際卻已經產不出 QR」的體驗落差。

### 待辦（下一輪 / 使用者環境就緒後）
- ~~安裝 Node.js 後執行 `npm test`，補驗核心邏輯（G5）~~ ✅ 第 2 輪完成。
- ~~補跑 `npm audit` 並提交 `package-lock.json`，補上 SCA 這條 Exit Criteria~~ ✅ 第 2 輪完成。
- 以實體手機掃描實測（AC-09），確認各家通訊錄 App 的欄位相容性（需使用者持實機，環境無法代跑）。
- ~~補 safeFileName() 的單元測試~~ ✅ 第 1 輪已完成：抽到 VCard 模組並補 10 條測試（TC-461~470）。

---

## [2026-08-13] 第 2 輪 — 補完 CI/CD 交付（G5/G6），R-01 解除

### 本輪紀錄
- **現況**：已過 G1~G6；專案自 claudeskill- 遷入獨立 repo，執行環境備妥 Node v22.22.2。
- **PM**：範圍不變（沿用 CoreMain 主題）；本輪只補「持續驗證」缺口，不新增產品功能。驗證目標定為 **GitHub Actions**。
- **DevSecOps／Sec**：SCA 由 14 弱點（13 high + 1 critical，**全在 devDependencies**）→ **0 弱點**。
  修法＝升級建置工具鏈：electron `^32`→`^43.4.0`、electron-builder `^25`→`^26.15.3`（皆為已修補的安全版）。
  執行期相依（`npm audit --omit=dev`）本輪前後都是 **0**——產品出貨零 runtime 相依，這是離線設計的紅利。
  複核 G3 態勢仍成立：產品碼零 `innerHTML`、CSP `default-src 'none'`+`connect-src 'none'`、Electron 四項隔離全開、無硬編碼密鑰。
- **QA**：`npm test` 60/60；`npm run verify`（QR 反解）7/7；通過率 100%。升版未影響核心邏輯（測試不依賴 electron）。
- **CI/CD**：
  - CI（`ci.yml`／G5）：四 job = test(功能/品質) + sca(npm audit) + secret-scan(Gitleaks) + sast(Semgrep)，全部在本機能驗證的門檻皆已驗綠。
  - CD（`release.yml`／G6）：桌面 app 對應——tag `v*` → 煙霧測試 → windows-latest 打包 NSIS/portable → 發佈 GitHub Release。
- **過關狀態**：G1 ✅ / G2 ✅ / G3 ✅ / G4 ✅ / G5 ✅ / G6 ✅（release 待推 tag 時實跑打包）。

### 教訓 / 準則

**8. SCA 弱點先分「出貨的」還是「建置用的」，別看到數字就慌**
- 情境：`npm audit` 報一堆 high/critical，但專案是零 runtime 相依的離線 app。
- 準則：**先跑 `npm audit --omit=dev` 看執行期相依**。若那邊是 0，代表出貨產品本身乾淨，
  剩下的都在 devDependencies（建置工具鏈）。但別就此放行——其中 `electron` 本身雖列 devDependency
  卻是實際執行外殼，它的 advisory 對桌面 app 有實質意義，該升版就升版。**分類是為了對症，不是為了找藉口放水。**

**9. 為特定引擎寫的測試要進 CI，得先脫離該引擎的專屬 API**
- 情境：最有價值的 QR 反解驗證原本用 WSH（`ActiveXObject`/`WScript`）寫，只能在 Windows cscript 跑，進不了 Linux CI。
- 準則：**把「驗證邏輯」與「宿主 API」分開**。解碼邏輯是純 ES5、可攜；只有載入模組與輸出綁死 WSH。
  照 `run-tests.js` 既有的 `vm` 沙箱載入方式，複製一份 Node 版 runner（`verify-qr-decode-node.js`），
  邏輯不動、只換宿主層，最有價值的測試就能在 CI 每次自動重跑。原 WSH 版保留給無 Node 的環境。

**10. SAST 的掃描範圍要對齊「出貨的產品碼」，否則被測試/第三方碼誤擋**
- 情境：Semgrep owasp-top-ten 會把 test 裡的 `eval`（反解 runner 用來載模組）與 vendor 第三方碼一起掃，造成假性紅燈。
- 準則：資安 Exit Criteria 的對象是**出貨的產品程式碼**。SAST job 明確 `--exclude=test --exclude=src/vendor`，
  只掃 `src main.js preload.js`。範圍對齊語意，gate 才不會被非出貨碼的雜訊擋住而失去意義。

**15. 新功能與 CoreMain 衝突時，先回 PM 對齊、經使用者確認再擴張範圍**
- 情境：使用者要「Excel 批次匯入」，但 CoreMain 明訂「❌ 多筆批次匯入」、README 寫「不做批次」。
- 準則：不悶頭做、也不硬擋。先點出衝突，用選項讓使用者定調（範圍要不要擴、格式、輸出）。
  確認後才動工，並**同步更新 CoreMain/SRS/README** 讓北極星與實作一致。本輪定調＝獨立批次模式（不動單張）、
  CSV（守住零執行期相依）、可列印總表。

**17. 加第二資安引擎要處理各自的環境限制，不能照抄範本**
- 情境：在 Semgrep + npm audit 之外，再加 CodeQL（SAST②）與 OSV-Scanner（SCA②）做交叉驗證。
- 準則：
  - **CodeQL 於私有 repo**：上傳 code scanning 需 GitHub Advanced Security（GHAS）。未啟用時用
    `analyze` 的 `upload:false` + `output:` 產出 SARIF，再自行解析、有發現即 `exit 1`——CodeQL 引擎本身
    不需 GHAS，只有「上傳到 code scanning UI」才需要。範圍用 `config-file` 對齊 Semgrep（排除 test/vendor）。
  - **OSV-Scanner 需連 OSV.dev**：本機被 egress proxy 擋（api.osv.dev 403）時它仍 exit 0、印 0 弱點——
    是「查不到」不是「沒弱點」，別誤判。真正的掃描在 GitHub runner（可連外）才會發生。取二進位用
    GitHub API 動態解析最新 linux_amd64 資產名，避免猜錯資產名。
  - **驗證要足但認清界線**：本機能驗「叫用機制」（osv-scanner 正確解析 269 個套件），但拿不到「真實弱點結果」
    （proxy 擋 DB）；真實結果以 CI runner 為準，推後緊盯該次 run。

**16. 守住專案 DNA：用「自寫小解析器」換掉「大型第三方庫」**
- 情境：「Excel 匯入」直覺會想內嵌 SheetJS 讀 .xlsx，但那是上百 KB 的第三方相依，破壞本專案「零執行期相依、完全離線」的 DNA。
- 準則：先問「使用者真正要的是什麼」——是「大量匯入清單」，不是「一定要 .xlsx」。改用 CSV：自寫 ~150 行解析器
      （處理引號含逗號/換行、`""` 逸出、BOM、CRLF/LF），零相依、可獨立測試（TC-700 系列 8 條）。Excel 本就能另存 CSV。
      把解析邏輯抽成 `lib/csv.js` 純函式模組（比照 `vcard.js`），UI 只負責 DOM——邏輯才測得到、注入防護才守得住（CSV 換行不得偽造 vCard 屬性行，TC-708）。

**14. 移除功能要「連根拔」——UI、邏輯、產生器、測試、文件、匯出一起清**
- 情境：依需求移除「自訂欄位」功能。
- 準則：一個功能的足跡橫跨多層，只刪 UI 會留下死碼與失敗測試。系統化清點（grep 關鍵字）後，
  一次移除：index.html 區塊、renderer 的 state/事件/函式、vcard.js 的 build 分支與 `sanitizeKey`/`STANDARD_KEYS`
  及其模組匯出、styles.css 專屬樣式（含只此處用到的 `.btn-remove`/`.empty-note`/`.group-hint`）、
  相關測試（TC-400 系列 7 條 + 整合案例中的 custom）、以及文件（README/CoreMain/SRS/待修改）。
  移除後跑 `node --check` + 全測試確認無殘留參照與死碼。移除也縮小了攻擊面（少了一條使用者可控的 vCard 屬性注入路徑）。

**13. 未簽章桌面 app 的 Windows 告警是「發佈信任」問題，不是程式問題**
- 情境：electron-builder 產出的安裝檔在 Windows 首次執行跳 SmartScreen「Windows 已保護您的電腦」。
- 準則：這是**未做受信任程式碼簽章**造成，與程式安全無關。唯一能真正消除的方法是用受信任憑證簽章
  （EV 立即無告警、OV 靠信譽累積）。**自用情境**可用純 PowerShell（`New-SelfSignedCertificate` +
  匯入 CurrentUser Root/TrustedPublisher + `Set-AuthenticodeSignature` + `Unblock-File`）在自己機器上簽並信任，
  不需 Windows SDK、不需上傳私鑰到 CI——但只對「手動信任過的機器」有效，對外散佈仍需商業憑證。
  另注意（延續教訓 3）：**PowerShell 輔助腳本的註解與訊息一律純 ASCII**，中文說明放 README，避免 PS 5.1 ANSI 讀檔吃行。

**12. CI 紅燈先分「gate 判定紅」還是「基礎設施紅」——別把配額問題當成安全失敗**
- 情境：首次推送後 secret-scan（gitleaks-action@v2）紅燈，但 log 明寫 `no leaks found`。
- 準則：**看 log 找真正的退出原因**。本例 gitleaks 掃描本身是綠的（無密鑰），job 失敗在掃完後
  上傳 SARIF artifact 撞到帳號的 Actions 儲存配額（`Artifact storage quota has been hit`）——
  是基礎設施問題，不是安全回歸。修法＝**讓 gate 只綁「掃描結果」，剝離無關的副作用**：
  改用 `ghcr.io/gitleaks/gitleaks` 容器直接跑 `gitleaks dir . --exit-code=1`，不經 action 的 artifact 上傳。
  同理 release workflow 把 build 與 publish 合成單一 job、以「Release 資產」發佈安裝檔，
  不走 `upload/download-artifact`，同樣避開該配額。**不可為了讓 CI 變綠而放寬安全門檻，但可以移除與門檻無關的失敗源。**

**11. 桌面 app 的 CD 要誠實對應，不要硬套伺服器那套**
- 情境：cd-pipeline 預設 Staging→Smoke→E2E→部署→流量健康檢查，但這是離線桌面程式，沒有伺服器與線上流量。
- 準則：**保留 CD 的精神（打包前煙霧測試、人工放行、產物完整性），對應到桌面情境**：
  交付物＝安裝檔、「部署」＝發佈 GitHub Release、「人工審核 Gate」＝推版本 tag 這個動作本身、
  「健康檢查」＝打包成功且 artifact 完整。在 workflow 註解寫清楚對應關係，別讓後人以為漏做了 E2E。

## [2026-10-07] 第 3 輪靜態安全檢查 — 發佈後重掃（v1.2.0）

### 本輪檢測紀錄
- 範圍與工具：產品碼＋scripts＋workflows＋lockfile；Semgrep（7 規則集／400 條）、Bandit、detect-secrets＋git 歷史、npm audit、OSV.dev API；人工審 OWASP 10 類。
- 弱點統計：Critical 0／High 1／Medium 3／Low 3（共 7），明細見 `SAST.md`。
- 關鍵指標：漏洞密度 ≈ 3.7／KLOC（含腳本與設定）；Semgrep 誤報率 6.3%；出貨執行期 High CVE 1（Electron）。
- OWASP Top 10:2025 覆蓋：10／10（A07 不適用）。
- Exit Criteria：初掃**未達標**（High = 1）；修補 FIND-001／002 後回歸 npm audit／OSV 皆 0，**達標**。

### 教訓 / 準則
**18. 「上次掃過 0 弱點」會過期——相依套件要定期重掃，不只在改程式時掃**
- 情境：8 月 SCA 為 0 弱點，程式碼沒動，10 月重掃 Electron 與建置工具鏈卻冒出 15 則（High 7）。
- 準則：CI 加每週排程（`schedule:` cron）重跑 SCA；發佈前一定重跑 `npm audit`／OSV，不沿用舊結果。
  嚴重度要依「是否進安裝檔」調整：執行期相依照原級處理，建置期相依可下調一級，但仍要修，否則 CI gate 會擋。

**19. CI 本身也是供應鏈：下載的二進位要驗證、Action 要釘選**
- 情境：`ci.yml` 用 curl 下載 osv-scanner 後直接執行；所有 Action 以 `@v4` 這種可變 tag 參照。
- 準則：從網路取得的執行檔一律固定版本＋驗 SHA256；第三方 Action 以完整 commit SHA 釘選、容器以 digest 釘選；
  具 `contents: write` 權限的 workflow（release）優先處理。
  能用 API 直接查的就別下載二進位：OSV.dev 有公開 API，用標準函式庫查詢即可，連 checksum 都不必管。

**20. 掃描工具標出的問題要改寫法，不要加抑制註解**
- 情境：新寫的 `osv-check.py` 用 `urllib.request.urlopen`，Bandit B310 警告它可接受 `file:` 等協定。網址明明是常數，很想加 `# nosec`。
- 準則：換成語意上就只能做安全事情的 API（`http.client.HTTPSConnection` 只走 HTTPS），警告自然消失，日後改動也不會失去保護。

**21. 手動觸發 release 要防「選錯分支」：標籤釘在打包的 commit，並檢查版本號一致**
- 情境：repo 預設分支是舊的 `claude/...` 分支，「Run workflow」預設選它，連兩次從舊 commit 打包；
  action-gh-release 未指定 `target_commitish` 時標籤建在預設分支上，v1.2.1 標籤指向舊程式碼，Release 混入 1.0.0 與 1.2.1 兩套安裝檔。
- 準則：release workflow 一律設 `target_commitish: ${{ github.sha }}`，並在打包前檢查「輸入的版本 = package.json 版本」，不符即失敗；
  repo 預設分支保持為 main，用完的工作分支即刪。
