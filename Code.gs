/**
 * ══════════════════════════════════════════════════════════════════════
 * ระบบลงรับหนังสือ · โรงเรียนชุมชนวัดไทยงาม
 * ฝั่งเซิร์ฟเวอร์: รับข้อมูลจากหน้าเว็บ บันทึกลงชีต และเก็บไฟล์ PDF ใน Drive
 *
 * วิธีติดตั้งอยู่ในไฟล์ SETUP.md
 * ══════════════════════════════════════════════════════════════════════
 */

const CONFIG = {
  // รหัสโฟลเดอร์ Drive ที่จะเก็บไฟล์ PDF (เอาจาก URL ของโฟลเดอร์)
  // https://drive.google.com/drive/folders/[ ส่วนนี้คือ FOLDER_ID ]
  FOLDER_ID: 'ใส่_FOLDER_ID_ที่นี่',

  // เว้นว่าง = ใช้สเปรดชีตที่ผูกกับสคริปต์นี้
  // หรือใส่รหัสสเปรดชีตแยก (เอาจาก URL ของชีต)
  SPREADSHEET_ID: '',

  SHEET_NAME: 'ทะเบียนรับ',

  // ชีตเก็บชื่อโรงเรียน ชื่อผู้บริหาร และโลโก้ ใช้ร่วมกันทุกเครื่อง
  SETTINGS_SHEET_NAME: 'ตั้งค่าหน่วยงาน',

  // ต้องตรงกับ CLOUD.apiKey ใน app.js — เปลี่ยนเป็นข้อความสุ่มยาว ๆ ของตัวเอง
  API_KEY: 'CHANGE-ME-PLEASE',

  // true = ให้ทุกคนที่มีลิงก์เปิดไฟล์ได้ (สะดวกเวลาส่งต่อ แต่ระวังเอกสารลับ)
  SHARE_WITH_ANYONE: false
};

const HEADERS = [
  'บันทึกเมื่อ', 'เลขที่รับ', 'วันที่รับ', 'เลขที่หนังสือ', 'หนังสือลงวันที่',
  'จาก', 'ถึง', 'เรื่อง', 'การปฏิบัติ', 'ฝ่าย', 'การสั่งการ',
  'ข้อความเพิ่มเติม', 'ลิงก์ไฟล์', 'สิ่งที่ส่งมาด้วย', 'ชื่อไฟล์'
];

const SETTINGS_HEADERS = ['คีย์', 'ค่า', 'คำอธิบาย', 'แก้ไขเมื่อ'];

/**
 * รายการค่าตั้งค่าที่ยอมให้บันทึกได้ คีย์อื่นที่ส่งเข้ามาจะถูกทิ้ง
 * แก้ค่าจากหน้าเว็บได้ที่เมนู "ตั้งค่า" หรือพิมพ์แก้ในชีตนี้ตรง ๆ ก็ได้
 */
const SETTINGS_FIELDS = [
  { key: 'schoolName',    label: 'ชื่อโรงเรียน' },
  { key: 'directorName',  label: 'ชื่อผู้อำนวยการ' },
  { key: 'directorTitle', label: 'ตำแหน่งผู้อำนวยการ' },
  { key: 'deputyName',    label: 'ชื่อรองผู้อำนวยการ' },
  { key: 'deputyTitle',   label: 'ตำแหน่งรองผู้อำนวยการ' },
  { key: 'logoUrl',       label: 'ลิงก์ภาพโลโก้โรงเรียน' },
  { key: 'logoOnStamp',   label: 'ใส่โลโก้บนตรารับหรือไม่ (TRUE / FALSE)' }
];

/* ══════════════════════════════════════════════════════════════════════
   จุดรับคำขอ
   ══════════════════════════════════════════════════════════════════════ */

/** คำขอแบบอ่านข้อมูล: ping / nextNumber / list / check */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    requireApiKey(params.apiKey);

    switch (params.action || 'ping') {
      case 'ping':
        return jsonOut({ ok: true, message: 'เชื่อมต่อได้', sheet: CONFIG.SHEET_NAME, folder: folderName() });

      case 'nextNumber':
        return jsonOut({ ok: true, number: nextReceiveNumber() });

      case 'list':
        return jsonOut({ ok: true, rows: listRecent(Number(params.limit) || 20) });

      case 'check':
        return jsonOut(Object.assign({ ok: true }, findByReceiveNumber(params.receiveNumber)));

      case 'settings':
        return jsonOut({ ok: true, settings: readSettings() });

      default:
        return jsonOut({ ok: false, error: 'ไม่รู้จักคำสั่ง: ' + params.action });
    }
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** คำขอแบบบันทึกข้อมูล: saveDocument / saveSettings */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    requireApiKey(body.apiKey);

    switch (body.action) {
      case 'saveDocument':
        return jsonOut(saveDocument(body));

      case 'saveSettings':
        return jsonOut(saveSettings(body.settings));

      default:
        return jsonOut({ ok: false, error: 'ไม่รู้จักคำสั่ง: ' + body.action });
    }
  } catch (err) {
    // ต้องคืน JSON เสมอ ถ้าปล่อยให้ error หลุดออกไป Apps Script จะตอบเป็นหน้า HTML
    // ซึ่งฝั่งเว็บจะอ่านไม่ออก
    return jsonOut({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/* ══════════════════════════════════════════════════════════════════════
   งานหลัก
   ══════════════════════════════════════════════════════════════════════ */

/**
 * บันทึกเอกสาร: อัปโหลด PDF ลง Drive และเขียนแถวลงทะเบียน
 * body = { data, pdfBase64, filename, saveToSheet }
 */
function saveDocument(body) {
  const data = body.data || {};

  // แชร์เข้า LINE จะอัปโหลดไฟล์ไปก่อนแล้ว รอบบันทึกลงทะเบียนจึงส่งมาแต่ลิงก์เดิม
  let fileUrl = body.fileUrl || '';
  let fileId = body.fileId || '';

  if (body.pdfBase64) {
    const filename = body.filename || ('รับหนังสือ_' + nowStamp() + '.pdf');
    const blob = Utilities.newBlob(Utilities.base64Decode(body.pdfBase64), 'application/pdf', filename);
    const file = getFolder().createFile(blob);

    if (CONFIG.SHARE_WITH_ANYONE) {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    }

    fileUrl = file.getUrl();
    fileId = file.getId();
  }

  let row = 0;

  if (body.saveToSheet !== false) {
    // ล็อกไว้กันสองเครื่องบันทึกพร้อมกันแล้วเลขทะเบียนชนกัน
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const sheet = getSheet();
      sheet.appendRow([
        new Date(),
        String(data.receiveNumber || ''),
        data.receiveDate || '',
        String(data.bookNumber || ''),
        data.bookDate || '',
        data.fromInp || '',
        data.to || '',
        data.subject || '',
        data.action || '',
        data.department || '',
        data.commanded || '',
        data.msgCommand || '',
        fileUrl,
        formatAttachments(data),
        body.filename || ''
      ]);
      row = sheet.getLastRow();
    } finally {
      lock.releaseLock();
    }
  }

  return { ok: true, fileUrl: fileUrl, fileId: fileId, row: row };
}

/** สิ่งที่ส่งมาด้วย เขียนเป็น "ชื่อรายการ · ลิงก์" บรรทัดละรายการ */
function formatAttachments(data) {
  const urls = data.atth_a || [];
  const labels = data.atth_labels || [];

  return urls.map(function (url, index) {
    const label = String(labels[index] || '').trim();
    return label ? (label + ' · ' + url) : url;
  }).join('\n');
}

/** เลขทะเบียนถัดไป โดยดูเลขสูงสุดที่มีอยู่ในชีต */
function nextReceiveNumber() {
  const sheet = getSheet();
  const last = sheet.getLastRow();
  if (last < 2) return '1';

  const values = sheet.getRange(2, 2, last - 1, 1).getValues();
  let max = 0;
  let width = 0;

  values.forEach(function (r) {
    const raw = toArabicDigits(r[0]).replace(/[^0-9]/g, '');
    if (!raw) return;
    const n = parseInt(raw, 10);
    if (isNaN(n)) return;
    if (n >= max) { max = n; width = Math.max(width, raw.length); }
  });

  const next = String(max + 1);
  // คงรูปแบบเลขศูนย์นำหน้าไว้ เช่น 0124 -> 0125
  return width > next.length ? next.padStart(width, '0') : next;
}

/** รายการล่าสุดสำหรับแสดงในหน้าเว็บ */
function listRecent(limit) {
  const sheet = getSheet();
  const last = sheet.getLastRow();
  if (last < 2) return [];

  const count = Math.min(limit, last - 1);
  const start = last - count + 1;
  const values = sheet.getRange(start, 1, count, HEADERS.length).getValues();

  return values.reverse().map(function (r) {
    return {
      savedAt: formatDate(r[0]),
      receiveNumber: String(r[1] || ''),
      receiveDate: formatDate(r[2]),
      bookNumber: String(r[3] || ''),
      bookDate: formatDate(r[4]),
      from: r[5] || '',
      to: r[6] || '',
      subject: r[7] || '',
      department: r[9] || '',
      commanded: r[10] || '',
      fileUrl: r[12] || ''
    };
  });
}

/** ตรวจว่าเลขทะเบียนนี้ถูกใช้แล้วหรือยัง */
function findByReceiveNumber(receiveNumber) {
  const target = toArabicDigits(receiveNumber).replace(/[^0-9]/g, '');
  if (!target) return { exists: false };

  const sheet = getSheet();
  const last = sheet.getLastRow();
  if (last < 2) return { exists: false };

  const values = sheet.getRange(2, 2, last - 1, 7).getValues();   // เลขที่รับ .. เรื่อง

  for (let i = values.length - 1; i >= 0; i--) {
    const cell = toArabicDigits(values[i][0]).replace(/[^0-9]/g, '');
    if (cell && cell === target) {
      return { exists: true, row: i + 2, subject: values[i][6] || '' };
    }
  }
  return { exists: false };
}

/* ══════════════════════════════════════════════════════════════════════
   ตั้งค่าหน่วยงาน (ชื่อโรงเรียน ผู้บริหาร โลโก้)

   เก็บเป็นคู่ คีย์–ค่า ในชีตแยก ทุกเครื่องที่เปิดหน้าเว็บจะดึงค่าชุดเดียวกัน
   ไม่ต้องไปตั้งทีละเครื่องอีก
   ══════════════════════════════════════════════════════════════════════ */

/** อ่านค่าตั้งค่าทั้งหมดออกมาเป็นออบเจ็กต์เดียว */
function readSettings() {
  const sheet = getSettingsSheet();
  const last = sheet.getLastRow();
  const out = {};
  if (last < 2) return out;

  const values = sheet.getRange(2, 1, last - 1, 2).getValues();

  values.forEach(function (r) {
    const key = String(r[0] || '').trim();
    if (!key || !isSettingKey(key)) return;
    out[key] = normalizeSettingValue(key, r[1]);
  });

  return out;
}

/** เขียนทับเฉพาะคีย์ที่ส่งมา คีย์ที่ไม่รู้จักจะถูกทิ้ง */
function saveSettings(settings) {
  if (!settings || typeof settings !== 'object') {
    throw new Error('ไม่มีข้อมูลตั้งค่าที่จะบันทึก');
  }

  // ล็อกไว้กันสองเครื่องกดบันทึกพร้อมกันแล้วแถวซ้อนกัน
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const sheet = getSettingsSheet();
    const last = sheet.getLastRow();
    const keys = last >= 2
      ? sheet.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0] || '').trim(); })
      : [];
    const now = new Date();

    SETTINGS_FIELDS.forEach(function (field) {
      if (!(field.key in settings)) return;

      const index = keys.indexOf(field.key);
      const row = index >= 0 ? index + 2 : sheet.getLastRow() + 1;
      if (index < 0) keys.push(field.key);

      sheet.getRange(row, 1, 1, SETTINGS_HEADERS.length)
        .setValues([[field.key, normalizeSettingValue(field.key, settings[field.key]), field.label, now]]);
    });
  } finally {
    lock.releaseLock();
  }

  return { ok: true, settings: readSettings() };
}

function isSettingKey(key) {
  for (let i = 0; i < SETTINGS_FIELDS.length; i++) {
    if (SETTINGS_FIELDS[i].key === key) return true;
  }
  return false;
}

/** ชีตอาจคืนค่ามาเป็น boolean หรือข้อความ ต้องปรับให้เป็นชนิดเดียวกันเสมอ */
function normalizeSettingValue(key, value) {
  if (key === 'logoOnStamp') {
    return value === true || String(value).trim().toLowerCase() === 'true';
  }
  return String(value === null || value === undefined ? '' : value).trim();
}

function getSettingsSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SETTINGS_SHEET_NAME);
  if (!sheet) sheet = createSettingsSheet(ss);
  return sheet;
}

function createSettingsSheet(ss) {
  const sheet = ss.insertSheet(CONFIG.SETTINGS_SHEET_NAME);
  sheet.getRange(1, 1, 1, SETTINGS_HEADERS.length).setValues([SETTINGS_HEADERS])
    .setFontWeight('bold').setBackground('#12203D').setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(2, 320);
  sheet.setColumnWidth(3, 280);
  sheet.setColumnWidth(4, 160);
  return sheet;
}

/* ══════════════════════════════════════════════════════════════════════
   ตัวช่วย
   ══════════════════════════════════════════════════════════════════════ */

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function requireApiKey(key) {
  if (!CONFIG.API_KEY || CONFIG.API_KEY === 'CHANGE-ME-PLEASE') {
    throw new Error('ยังไม่ได้ตั้งค่า API_KEY ใน Code.gs');
  }
  if (String(key || '') !== CONFIG.API_KEY) {
    throw new Error('API key ไม่ถูกต้อง');
  }
}

function getSpreadsheet() {
  if (CONFIG.SPREADSHEET_ID) return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  const bound = SpreadsheetApp.getActiveSpreadsheet();
  if (!bound) throw new Error('ยังไม่ได้ตั้งค่า SPREADSHEET_ID และสคริปต์ไม่ได้ผูกกับสเปรดชีต');
  return bound;
}

function getSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) sheet = createSheet(ss);
  return sheet;
}

function createSheet(ss) {
  const sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setBackground('#12203D').setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(8, 320);
  sheet.setColumnWidth(13, 240);
  return sheet;
}

function getFolder() {
  if (!CONFIG.FOLDER_ID || CONFIG.FOLDER_ID.indexOf('ใส่_FOLDER_ID') === 0) {
    throw new Error('ยังไม่ได้ตั้งค่า FOLDER_ID ใน Code.gs');
  }
  try {
    return DriveApp.getFolderById(CONFIG.FOLDER_ID);
  } catch (err) {
    throw new Error('เปิดโฟลเดอร์ไม่ได้ ตรวจ FOLDER_ID และสิทธิ์การเข้าถึง');
  }
}

function folderName() {
  try { return getFolder().getName(); } catch (err) { return '(ยังตั้งค่าไม่ครบ)'; }
}

/** เลขไทยที่ผู้ใช้อาจพิมพ์เข้ามา ต้องแปลงกลับเป็นอาราบิกก่อนคำนวณ */
function toArabicDigits(value) {
  const thai = '๐๑๒๓๔๕๖๗๘๙';
  return String(value === null || value === undefined ? '' : value)
    .replace(/[๐-๙]/g, function (d) { return String(thai.indexOf(d)); });
}

function formatDate(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value);
}

function nowStamp() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
}

/* ══════════════════════════════════════════════════════════════════════
   ฟังก์ชันสำหรับกดรันเองในตัวแก้ไข (ไม่ได้เรียกจากหน้าเว็บ)
   ══════════════════════════════════════════════════════════════════════ */

/** กดรันครั้งแรกเพื่อสร้างชีตและหัวตาราง */
function setupSheet() {
  const sheet = getSheet();
  Logger.log('พร้อมใช้งาน: ' + sheet.getName() + ' มีข้อมูล ' + Math.max(sheet.getLastRow() - 1, 0) + ' รายการ');

  const settings = getSettingsSheet();
  Logger.log('ชีตตั้งค่า: ' + settings.getName() + ' มีค่า ' + Math.max(settings.getLastRow() - 1, 0) + ' รายการ');
}

/** ตรวจว่าตั้งค่าครบและเข้าถึง Drive กับชีตได้จริง */
function testConfig() {
  Logger.log('ชีต: ' + getSheet().getName());
  Logger.log('โฟลเดอร์: ' + getFolder().getName());
  Logger.log('เลขทะเบียนถัดไป: ' + nextReceiveNumber());
  Logger.log('ค่าตั้งค่าหน่วยงาน: ' + JSON.stringify(readSettings()));
  Logger.log('ตั้งค่าครบแล้ว');
}
