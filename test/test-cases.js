/**
 * test-cases.js — 共用測試案例（唯一真相來源）。
 *
 * 由兩個 runner 載入執行，避免同一套案例維護兩份而失去同步：
 *   - test/run-tests.js      有安裝 Node.js 時（npm test）
 *   - test/run-tests-wsh.js  沒有 Node.js 時（Windows Script Host）
 *
 * 本檔不自帶測試框架，而是使用 runner 提供的全域函式：
 *   log / test / assert / assertEqual / assertContains / assertThrows / repeat
 *   以及待測目標 VCard / QRCodeLib。
 */
function defineTestCases(ctx) {
  var log = ctx.log, test = ctx.test;
  var assert = ctx.assert, assertEqual = ctx.assertEqual;
  var assertContains = ctx.assertContains, assertThrows = ctx.assertThrows;
  var repeat = ctx.repeat;
  var VCard = ctx.VCard, QRCodeLib = ctx.QRCodeLib;
  // =================================================================
  log('');
  log('--- TC-100 系列：vCard 3.0 結構（FR-03 / AC-03）---');

  test('TC-101 正常路徑：輸出含必要的 vCard 3.0 骨架', function () {
    var out = VCard.build({ lastName: '王', firstName: '小明' });
    assert(out.indexOf('BEGIN:VCARD\r\n') === 0, '應以 BEGIN:VCARD 開頭');
    assertContains(out, 'VERSION:3.0', '應宣告 3.0 版本');
    assertContains(out, 'END:VCARD', '應以 END:VCARD 結尾');
    assert(/END:VCARD\r\n$/.test(out), '應以 CRLF 結尾');
  });

  test('TC-102 N 欄位為五段結構化格式', function () {
    var out = VCard.build({ lastName: '王', firstName: '小明' });
    assertContains(out, 'N:王;小明;;;', 'N 應為 Family;Given;Additional;Prefix;Suffix');
  });

  test('TC-103 FN 留空時自動由姓名組合', function () {
    var out = VCard.build({ lastName: '王', firstName: '小明' });
    assertContains(out, 'FN:王小明', 'FN 應自動組合');
  });

  test('TC-104 FN 有填時以使用者輸入為準', function () {
    var out = VCard.build({ lastName: '王', firstName: '小明', fullName: 'Ming Wang' });
    assertContains(out, 'FN:Ming Wang', 'FN 應使用使用者輸入');
    assert(out.indexOf('FN:王小明') === -1, '不應同時輸出自動組合的 FN');
  });

  test('TC-105 各類欄位皆正確輸出', function () {
    var out = VCard.build({
      lastName: '王', firstName: '小明',
      cell: '0912345678', workTel: '0212345678', homeTel: '039876543',
      email: 'a@b.com', org: 'ACME', title: 'PM', url: 'https://x.com',
      street: 'Rd 1', city: 'Taipei', region: 'Xinyi', postalCode: '110', country: 'TW',
      note: 'hello'
    });
    assertContains(out, 'TEL;TYPE=CELL,VOICE:0912345678');
    assertContains(out, 'TEL;TYPE=WORK,VOICE:0212345678');
    assertContains(out, 'TEL;TYPE=HOME,VOICE:039876543');
    assertContains(out, 'EMAIL;TYPE=INTERNET,PREF:a@b.com');
    assertContains(out, 'ORG:ACME');
    assertContains(out, 'TITLE:PM');
    assertContains(out, 'URL:https://x.com');
    assertContains(out, 'ADR;TYPE=WORK:;;Rd 1;Taipei;Xinyi;110;TW');
    assertContains(out, 'NOTE:hello');
  });

  log('');
  log('--- TC-200 系列：邊界值與空值處理 ---');

  test('TC-201 空欄位不輸出對應屬性', function () {
    var out = VCard.build({ lastName: '王', firstName: '小明' });
    assert(out.indexOf('TEL') === -1, '未填電話不應出現 TEL');
    assert(out.indexOf('EMAIL') === -1, '未填 email 不應出現 EMAIL');
    assert(out.indexOf('ADR') === -1, '地址全空不應出現 ADR');
    assert(out.indexOf('NOTE') === -1, '未填備註不應出現 NOTE');
  });

  test('TC-202 全空輸入仍產生合法 vCard，不崩潰', function () {
    var out = VCard.build({});
    assertContains(out, 'BEGIN:VCARD');
    assertContains(out, 'END:VCARD');
  });

  test('TC-203 只填部分地址時 ADR 仍輸出且位置正確', function () {
    var out = VCard.build({ lastName: 'A', city: 'Taipei' });
    assertContains(out, 'ADR;TYPE=WORK:;;;Taipei;;;', '未填的地址元件應留空但保留分隔');
  });

  test('TC-204 只有空白字元的欄位視同未填', function () {
    var out = VCard.build({ lastName: 'A', cell: '   ', note: '\t' });
    assert(out.indexOf('TEL') === -1, '純空白的電話不應輸出');
    assert(out.indexOf('NOTE') === -1, '純空白的備註不應輸出');
  });

  test('TC-205 值前後空白會被修剪', function () {
    var out = VCard.build({ lastName: 'A', org: '  ACME  ' });
    assertContains(out, 'ORG:ACME', '應修剪前後空白');
  });

  test('TC-206 null / undefined 輸入不崩潰', function () {
    VCard.build(null);
    VCard.build(undefined);
    var out = VCard.build({ lastName: null, firstName: undefined, cell: null });
    assertContains(out, 'BEGIN:VCARD');
  });

  log('');
  log('--- TC-300 系列：RFC 2426 跳脫與折行（資安相關）---');

  test('TC-301 分號、逗號、反斜線正確跳脫', function () {
    assertEqual(VCard.escapeValue('a;b'), 'a\\;b', '分號應跳脫');
    assertEqual(VCard.escapeValue('a,b'), 'a\\,b', '逗號應跳脫');
    assertEqual(VCard.escapeValue('a\\b'), 'a\\\\b', '反斜線應跳脫');
  });

  test('TC-302 反斜線先跳脫，不重複跳脫（順序正確性）', function () {
    assertEqual(VCard.escapeValue('\\;'), '\\\\\\;', '跳脫順序應為先反斜線後分號');
  });

  test('TC-303 換行轉為 \\n 字面值，不破壞 vCard 行結構', function () {
    assertEqual(VCard.escapeValue('a\nb'), 'a\\nb', '換行應轉為字面 \\n');
    assertEqual(VCard.escapeValue('a\r\nb'), 'a\\nb', 'CRLF 應正規化');
  });

  test('TC-304 【注入防護】備註含換行不會插入偽造的 vCard 屬性', function () {
    var out = VCard.build({
      lastName: 'A',
      note: 'safe\r\nTEL;TYPE=CELL:0900000000\r\nX-EVIL:1'
    });
    var lines = out.split('\r\n');
    var forged = 0;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('TEL;TYPE=CELL:0900000000') === 0 || lines[i].indexOf('X-EVIL:') === 0) {
        forged++;
      }
    }
    assertEqual(forged, 0, '不應產生偽造的獨立屬性行');
    assertContains(out, 'NOTE:safe\\nTEL', '惡意內容應留在 NOTE 值內並被跳脫');
  });

  test('TC-305 結構化欄位的分隔符不被跳脫、但值內分號要跳脫', function () {
    var out = VCard.build({ lastName: 'a;b', firstName: 'c' });
    assertContains(out, 'N:a\\;b;c;;;', '值內分號跳脫、欄位分隔符保留');
  });

  test('TC-306 折行：超過 75 octets 的行會被折行且續行以空白開頭', function () {
    var longNote = repeat('x', 199);
    var out = VCard.build({ lastName: 'A', note: longNote });
    var lines = out.split('\r\n');
    var contCount = 0;
    for (var i = 0; i < lines.length; i++) {
      assert(VCard.utf8Len(lines[i]) <= 75,
        '每行不應超過 75 octets，實際 ' + VCard.utf8Len(lines[i]));
      if (lines[i].indexOf(' ') === 0) contCount++;
    }
    assert(contCount > 0, '應存在以空白開頭的續行');
  });

  test('TC-307 折行不切斷多位元組字元（中文）', function () {
    var longCJK = repeat('中文測試', 79);
    var out = VCard.build({ lastName: 'A', note: longCJK });
    var lines = out.split('\r\n');
    for (var i = 0; i < lines.length; i++) {
      assert(VCard.utf8Len(lines[i]) <= 75, '中文行也不應超過 75 octets');
      assert(lines[i].indexOf('\uFFFD') === -1, '不應出現壞掉的字元');
    }
  });

  log('');
  log('--- TC-400 系列：自訂欄位（FR-04）---');

  test('TC-401 自訂欄位正確輸出並自動加 X- 前綴', function () {
    var out = VCard.build({ lastName: 'A', custom: [{ key: 'LINE', value: 'my_line_id' }] });
    assertContains(out, 'X-LINE:my_line_id', '非標準鍵應加 X- 前綴');
  });

  test('TC-402 已有 X- 前綴時不重複添加', function () {
    var out = VCard.build({ lastName: 'A', custom: [{ key: 'X-WECHAT', value: 'w1' }] });
    assertContains(out, 'X-WECHAT:w1');
    assert(out.indexOf('X-X-WECHAT') === -1, '不應變成 X-X-');
  });

  test('TC-403 標準屬性名不加前綴', function () {
    var out = VCard.build({ lastName: 'A', custom: [{ key: 'NICKNAME', value: '阿明' }] });
    assertContains(out, 'NICKNAME:阿明', '標準鍵不應加前綴');
  });

  test('TC-404 【注入防護】自訂鍵名含冒號/換行被淨化', function () {
    var out = VCard.build({ lastName: 'A', custom: [{ key: 'EVIL:X\r\nTEL', value: 'v' }] });
    var lines = out.split('\r\n');
    var bad = 0;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('TEL:') === 0) bad++;
    }
    assertEqual(bad, 0, '淨化後不應產生額外的 TEL 屬性行');
    assertContains(out, 'X-EVIL-X-TEL:v', '非法字元應轉為連字號');
  });

  test('TC-405 鍵名或值為空時整條略過', function () {
    var out = VCard.build({
      lastName: 'A',
      custom: [{ key: '', value: 'v' }, { key: 'K', value: '' }, { key: '  ', value: '  ' }]
    });
    assert(out.indexOf('X-:') === -1, '空鍵不應輸出');
    assert(out.indexOf('X-K:') === -1, '空值不應輸出');
  });

  test('TC-406 sanitizeKey 收斂連續與頭尾連字號', function () {
    assertEqual(VCard.sanitizeKey('a  b'), 'X-A-B', '空白轉連字號並收斂');
    assertEqual(VCard.sanitizeKey('!!!'), '', '全為非法字元應回傳空字串');
  });

  test('TC-407 多個自訂欄位全部輸出', function () {
    var out = VCard.build({
      lastName: 'A',
      custom: [{ key: 'LINE', value: 'l1' }, { key: 'IG', value: 'i1' }, { key: 'SKYPE', value: 's1' }]
    });
    assertContains(out, 'X-LINE:l1');
    assertContains(out, 'X-IG:i1');
    assertContains(out, 'X-SKYPE:s1');
  });

  log('');
  log('--- TC-210 系列：FN 必填保證（RFC 2426 相容性）---');

  test('TC-211 只填 Email 未填姓名時，FN 以 Email 遞補', function () {
    var out = VCard.build({ email: 'ming@example.com' });
    assertContains(out, 'FN:ming@example.com', '缺姓名時 FN 應遞補，否則部分通訊錄會拒收');
  });

  test('TC-212 只填公司時，FN 以公司名遞補（優先於 Email）', function () {
    var out = VCard.build({ org: 'ACME', email: 'a@b.com' });
    assertContains(out, 'FN:ACME', '公司優先序應高於 Email');
  });

  test('TC-213 只填電話時，FN 以電話遞補', function () {
    var out = VCard.build({ cell: '0912345678' });
    assertContains(out, 'FN:0912345678', '僅有電話時仍應有 FN');
  });

  test('TC-214 有姓名時仍以姓名為準，不使用遞補值', function () {
    var out = VCard.build({ lastName: '王', firstName: '小明', org: 'ACME' });
    assertContains(out, 'FN:王小明', '有姓名就不該用公司名當 FN');
  });

  test('TC-215 完全空白的輸入不強造 FN（避免產生無意義屬性）', function () {
    var out = VCard.build({});
    assert(out.indexOf('FN:') === -1, '全空時不應輸出 FN');
  });

  log('');
  log('--- TC-450 系列：資安掃描 finding 的回歸測試 ---');

  test('TC-451 [FIND-001] 控制字元被移除，不寫入 .vcf', function () {
    // \x00 \x07 \x1F \x7F 等控制字元應被剝除
    var out = VCard.escapeValue('a\x00b\x07c\x1Fd\x7Fe');
    assertEqual(out, 'abcde', '控制字元應全部移除');
  });

  test('TC-452 [FIND-001] Unicode 行分隔符被移除', function () {
    assertEqual(VCard.escapeValue('a\u2028b\u2029c\u0085d'), 'abcd',
      'U+2028/U+2029/U+0085 應移除');
  });

  test('TC-453 [FIND-001] 移除控制字元不影響正常內容與既有跳脫', function () {
    assertEqual(VCard.escapeValue('正常;內容'), '正常\\;內容', '正常內容應保持跳脫行為');
    assertEqual(VCard.escapeValue('a\tb'), 'a\tb', 'Tab 為合法可見空白，應保留');
  });

  test('TC-454 [FIND-001] 含控制字元的整張名片仍結構完整', function () {
    var out = VCard.build({ lastName: 'A', note: 'x\x00y\x1Fz' });
    assertContains(out, 'NOTE:xyz', '控制字元移除後內容仍正確');
    assertContains(out, 'END:VCARD');
  });

  log('');
  log('--- TC-460 系列：下載檔名淨化（FIND-002 / 路徑穿越防護）---');

  test('TC-461 正常名稱原樣保留', function () {
    assertEqual(VCard.safeFileName('王小明'), '王小明', '正常中文名稱不應被改動');
    assertEqual(VCard.safeFileName('Ming Wang'), 'Ming Wang', '含空格的英文名應保留');
  });

  test('TC-462 【路徑穿越】相對路徑符號被中和', function () {
    var r1 = VCard.safeFileName('../../evil');
    assert(r1.indexOf('/') === -1 && r1.indexOf('\\') === -1, '不應殘留路徑分隔符：' + r1);
    var r2 = VCard.safeFileName('..\\..\\evil');
    assert(r2.indexOf('\\') === -1, '不應殘留反斜線：' + r2);
    var r3 = VCard.safeFileName('C:\\Windows\\System32\\evil');
    assert(r3.indexOf('\\') === -1 && r3.indexOf(':') === -1, '磁碟路徑應被中和：' + r3);
  });

  test('TC-463 【FIND-002】純點號名稱退回預設值', function () {
    assertEqual(VCard.safeFileName('.'), 'vcard', '單點應退回預設');
    assertEqual(VCard.safeFileName('..'), 'vcard', '雙點應退回預設');
    assertEqual(VCard.safeFileName('...'), 'vcard', '多點應退回預設');
  });

  test('TC-464 【FIND-002】Windows 保留裝置名稱加前綴避開', function () {
    assertEqual(VCard.safeFileName('CON'), '_CON', 'CON 應加前綴');
    assertEqual(VCard.safeFileName('PRN'), '_PRN', 'PRN 應加前綴');
    assertEqual(VCard.safeFileName('COM1'), '_COM1', 'COM1 應加前綴');
    assertEqual(VCard.safeFileName('LPT9'), '_LPT9', 'LPT9 應加前綴');
    assertEqual(VCard.safeFileName('nul'), '_nul', '小寫也應處理（大小寫不敏感）');
  });

  test('TC-465 保留名稱作為一般名稱的一部分時不加前綴', function () {
    assertEqual(VCard.safeFileName('CONNIE'), 'CONNIE', '只有完全相符才是保留名稱');
    assertEqual(VCard.safeFileName('CON2'), 'CON2', 'CON2 非保留名稱');
  });

  test('TC-466 Windows 非法字元被替換', function () {
    var r = VCard.safeFileName('a*b?c"d<e>f|g');
    assert(/^[^*?"<>|]+$/.test(r), '非法字元應全部被替換：' + r);
  });

  test('TC-467 控制字元被移除', function () {
    var r = VCard.safeFileName('a\x00b\x1fc');
    assert(r.indexOf('\x00') === -1 && r.indexOf('\x1f') === -1, '控制字元不應殘留');
  });

  test('TC-468 空值 / 全空白退回預設值', function () {
    assertEqual(VCard.safeFileName(''), 'vcard', '空字串應退回預設');
    assertEqual(VCard.safeFileName('   '), 'vcard', '全空白應退回預設');
    assertEqual(VCard.safeFileName(null), 'vcard', 'null 應退回預設');
    assertEqual(VCard.safeFileName(undefined), 'vcard', 'undefined 應退回預設');
  });

  test('TC-469 過長名稱被截斷至 60 字元內', function () {
    var r = VCard.safeFileName(repeat('A', 200));
    assert(r.length <= 60, '應截斷至 60 字元內，實際 ' + r.length);
  });

  test('TC-470 可自訂退回值', function () {
    assertEqual(VCard.safeFileName('', 'my-default'), 'my-default', '應使用指定的退回值');
  });

  log('');
  log('--- TC-500 系列：QRCode 編碼器 ---');

  test('TC-501 基本編碼成功並回傳合理結構', function () {
    var qr = QRCodeLib.make('HELLO WORLD', 'M');
    assert(qr.moduleCount > 0, 'moduleCount 應大於 0');
    assertEqual(qr.moduleCount, qr.version * 4 + 17, 'moduleCount 應符合 version*4+17');
    assertEqual(typeof qr.isDark(0, 0), 'boolean', 'isDark 應回傳布林值');
  });

  test('TC-502 定位圖樣正確（三個角落的 finder pattern）', function () {
    var qr = QRCodeLib.make('TEST', 'M');
    var n = qr.moduleCount;
    assert(qr.isDark(0, 0), '左上角應為深色');
    assert(!qr.isDark(1, 1), 'finder 第二圈應為淺色');
    assert(qr.isDark(2, 2), 'finder 內核應為深色');
    assert(qr.isDark(0, n - 1), '右上角應為深色');
    assert(qr.isDark(n - 1, 0), '左下角應為深色');
  });

  test('TC-503 時序圖樣（timing pattern）交替正確', function () {
    var qr = QRCodeLib.make('TEST', 'M');
    for (var i = 8; i < qr.moduleCount - 8; i++) {
      assertEqual(qr.isDark(6, i), i % 2 === 0, '水平時序圖樣位置 ' + i + ' 不正確');
      assertEqual(qr.isDark(i, 6), i % 2 === 0, '垂直時序圖樣位置 ' + i + ' 不正確');
    }
  });

  test('TC-504 資料越長，自動選用的版本越大', function () {
    var small = QRCodeLib.make('A', 'M');
    var large = QRCodeLib.make(repeat('A', 299), 'M');
    assert(large.version > small.version,
      '長資料版本應較大（small=' + small.version + ', large=' + large.version + '）');
  });

  test('TC-505 容錯等級越高，同樣資料所需版本不會變小', function () {
    var data = repeat('A', 149);
    var l = QRCodeLib.make(data, 'L');
    var h = QRCodeLib.make(data, 'H');
    assert(h.version >= l.version,
      'H 容錯需要的版本應 >= L（L=' + l.version + ', H=' + h.version + '）');
  });

  test('TC-506 UTF-8 中文與 emoji 可編碼（byte mode）', function () {
    var qr1 = QRCodeLib.make('姓名：王小明', 'M');
    assert(qr1.moduleCount > 0, '中文應可編碼');
    // 用跳脫序列表示 emoji（surrogate pair），避免 WSH 解析器問題
    var qr2 = QRCodeLib.make('emoji \uD83C\uDF89 test', 'M');
    assert(qr2.moduleCount > 0, 'emoji 應可編碼');
  });

  test('TC-507 utf8ByteLength 計算正確', function () {
    assertEqual(QRCodeLib.utf8ByteLength('abc'), 3, 'ASCII 每字 1 byte');
    assertEqual(QRCodeLib.utf8ByteLength('中'), 3, '中文每字 3 bytes');
    assertEqual(QRCodeLib.utf8ByteLength('\uD83C\uDF89'), 4, 'emoji 為 4 bytes');
  });

  test('TC-508 異常輸入：空字串丟出 EMPTY_DATA', function () {
    assertThrows(function () { QRCodeLib.make('', 'M'); }, 'EMPTY_DATA');
  });

  test('TC-509 異常輸入：超長資料丟出 DATA_TOO_LONG 而非崩潰（FR-08）', function () {
    var huge = repeat('X', 3999);
    assertThrows(function () { QRCodeLib.make(huge, 'H'); }, 'DATA_TOO_LONG');
  });

  test('TC-510 未知容錯等級回退為 M，不崩潰', function () {
    var qr = QRCodeLib.make('TEST', 'ZZZ');
    assert(qr.moduleCount > 0, '應回退為預設等級並成功');
  });

  log('');
  log('--- TC-550 系列：UI 容量提示與編碼器實際上限一致性 ---');

  // 與 renderer.js updateCapacity() 的 MAX_BY_ECC 必須一致，
  // 否則會出現「進度條顯示未滿、實際已 DATA_TOO_LONG」的落差。
  var UI_MAX_BY_ECC = { L: 2953, M: 2331, Q: 1663, H: 1273 };

  test('TC-551 UI 顯示的容量上限，編碼器確實還能編（不超前報滿）', function () {
    var levels = ['L', 'M', 'Q', 'H'];
    for (var i = 0; i < levels.length; i++) {
      var ecc = levels[i];
      var max = UI_MAX_BY_ECC[ecc];
      var data = repeat('A', max);   // 剛好等於宣告上限
      var ok = true;
      try { QRCodeLib.make(data, ecc); } catch (e) { ok = false; }
      assert(ok, ecc + ' 等級宣告上限 ' + max + ' bytes 應可編碼，實際失敗');
    }
  });

  test('TC-552 超過 UI 宣告上限 1 byte 即無法編碼（上限值精準）', function () {
    var levels = ['L', 'M', 'Q', 'H'];
    levels.forEach(function (ecc) {
      var data = repeat('A', UI_MAX_BY_ECC[ecc] + 1);
      assertThrows(function () { QRCodeLib.make(data, ecc); }, 'DATA_TOO_LONG');
    });
  });

  log('');
  log('--- TC-600 系列：整合（vCard → QR）---');

  test('TC-601 完整名片資料可成功產生 QRCode', function () {
    var vcard = VCard.build({
      lastName: '王', firstName: '小明', fullName: '王小明',
      cell: '0912-345-678', workTel: '02-1234-5678',
      email: 'ming@example.com', org: '範例科技股份有限公司',
      title: '產品經理', url: 'https://example.com',
      street: '信義路五段 7 號', city: '台北市', region: '信義區',
      postalCode: '110', country: '台灣', note: '週一至週五 09:00-18:00',
      custom: [{ key: 'LINE', value: 'ming_line' }]
    });
    var qr = QRCodeLib.make(vcard, 'M');
    assert(qr.version <= 40, '應在版本 40 內容納');
    log('          （名片大小 ' + QRCodeLib.utf8ByteLength(vcard) +
        ' bytes -> QR 版本 ' + qr.version + '）');
  });

  test('TC-602 典型精簡名片可用低版本容納（實用性檢查）', function () {
    var vcard = VCard.build({
      lastName: '王', firstName: '小明',
      cell: '0912345678', email: 'ming@example.com'
    });
    var qr = QRCodeLib.make(vcard, 'M');
    assert(qr.version <= 10,
      '精簡名片應在版本 10 內（實際 ' + qr.version + '），過大會難以掃描');
  });

  test('TC-603 極長輸入的 vCard 會被 QR 拒絕但不崩潰（錯誤路徑完整）', function () {
    var vcard = VCard.build({ lastName: 'A', note: repeat('長', 2999) });
    var threw = false;
    try { QRCodeLib.make(vcard, 'M'); } catch (e) {
      threw = true;
      assertEqual(e.message, 'DATA_TOO_LONG', '應為可辨識的錯誤碼供 UI 顯示提示');
    }
    assert(threw, '超長資料應丟出錯誤');
  });

  test('TC-604 特殊字元名片仍可完整編碼', function () {
    var vcard = VCard.build({
      lastName: "O'Brien;Jr", firstName: 'Anne,Marie',
      org: 'A\\B Corp', note: 'line1\nline2'
    });
    var qr = QRCodeLib.make(vcard, 'M');
    assert(qr.moduleCount > 0, '特殊字元名片應可編碼');
  });

  // =================================================================
  log('');

}

// 匯出方式依執行環境而定：
//   Node — module.exports，由 runner 以 require() 取用
//   WSH  — 掛到 global（eval 在函式內只會建立區域繫結，必須顯式外掛）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = defineTestCases;
} else if (typeof globalTestRegistry !== 'undefined' && globalTestRegistry) {
  globalTestRegistry.defineTestCases = defineTestCases;
}