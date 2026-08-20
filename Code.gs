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
  SHARE_WITH_ANYONE: false,

  // โฟลเดอร์ย่อยเก็บรูปหน้าเอกสารที่ส่งเข้า LINE แยกไว้ไม่ให้ปนกับ PDF
  IMAGE_FOLDER_NAME: 'ภาพแชร์เข้า LINE',

  // เก็บรูปที่ส่งไปแล้วไว้กี่วัน ใช้กับ cleanOldShareImages() ที่ตั้งทริกเกอร์รายวันได้
  // ตั้ง 0 = ไม่ลบเลย
  IMAGE_KEEP_DAYS: 30
};

const HEADERS = [
  'บันทึกเมื่อ', 'เลขที่รับ', 'วันที่รับ', 'เลขที่หนังสือ', 'หนังสือลงวันที่',
  'จาก', 'ถึง', 'เรื่อง', 'การปฏิบัติ', 'ฝ่าย', 'การสั่งการ',
  'ข้อความเพิ่มเติม', 'ลิงก์ไฟล์', 'สิ่งที่ส่งมาด้วย', 'ชื่อไฟล์',
  'รหัสเอกสาร', 'ข้อมูลดิบ'
];

/**
 * สองคอลัมน์ท้ายเพิ่มมาเพื่อรองรับปุ่ม "แก้ไข" ที่หน้าแรก
 *
 * รหัสเอกสาร (docId) เป็นรหัสสุ่มประจำแถว ใช้อ้างอิงแทนเลขแถว เพราะเลขแถว
 *   จะเลื่อนทันทีที่มีคนลบหรือเรียงแถวในชีต แล้วปุ่มแก้ไขจะไปทับผิดฉบับ
 *
 * ข้อมูลดิบ เก็บค่าที่กรอกในฟอร์มทั้งชุดเป็น JSON เพราะคอลัมน์ที่คนอ่าน
 *   ผ่านชีตถูกจัดรูปแบบไปแล้ว (เลขที่รับ 0124 โดน Sheets กินศูนย์นำหน้า
 *   สิ่งที่ส่งมาด้วยถูกยุบเป็นข้อความก้อนเดียว) ดึงกลับมาเติมฟอร์มจะเพี้ยน
 *   ตอนแก้ไขจึงอ่านจาก JSON ก้อนนี้เป็นหลัก แล้วค่อยถอยไปอ่านคอลัมน์
 *   สำหรับแถวเก่าที่บันทึกไว้ก่อนมีคอลัมน์นี้
 */
const COL_DOC_ID = 16;
const COL_PAYLOAD = 17;

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

/** คำขอแบบอ่านข้อมูล: ping / nextNumber / list / check / settings / document */
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
        return jsonOut(Object.assign({ ok: true },
          findByReceiveNumber(params.receiveNumber, params.excludeDocId)));

      case 'document':
        return jsonOut({ ok: true, doc: getDocumentById(params.docId) });

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

      case 'saveShareImages':
        return jsonOut(saveShareImages(body));

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
 * body = { data, pdfBase64, filename, saveToSheet, docId }
 *
 * ถ้าส่ง docId มาด้วย = กำลังแก้ไขเอกสารเดิม จะทับแถวเดิมแทนการเพิ่มแถวใหม่
 * และย้ายไฟล์ PDF ฉบับก่อนหน้าลงถังขยะ ไม่ให้เหลือไฟล์ค้างใน Drive
 */
function saveDocument(body) {
  const data = body.data || {};
  const docId = String(body.docId || '').trim();

  // แชร์เข้า LINE จะอัปโหลดไฟล์ไปก่อนแล้ว รอบบันทึกลงทะเบียนจึงส่งมาแต่ลิงก์เดิม
  let fileUrl = body.fileUrl || '';
  let fileId = body.fileId || '';

  // อัปโหลดก่อนแล้วค่อยจับล็อก การอัปไฟล์ใหญ่กินเวลาหลายวินาที
  // ถ้าถือล็อกคร่อมไว้ด้วย เครื่องอื่นที่รออยู่จะรอจนหมดเวลา 20 วินาที
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

  // อัปขึ้น Drive อย่างเดียว ไม่ต้องแตะชีตเลย
  if (body.saveToSheet === false) {
    return { ok: true, fileUrl: fileUrl, fileId: fileId, row: 0, docId: docId };
  }

  // ล็อกคร่อมทั้งอ่านและเขียน ไม่ใช่แค่ตอนเขียน มิฉะนั้นสองเครื่องที่แก้แถว
  // เดียวกันพร้อมกันจะอ่านของเก่าได้เหมือนกันแล้วเขียนทับกันเอง
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const sheet = getSheet();
    ensureColumns(sheet);

    const target = docId ? findRowByDocId(sheet, docId) : null;
    if (docId && !target) {
      throw new Error('ไม่พบเอกสารที่จะแก้ไข อาจถูกลบออกจากชีตไปแล้ว');
    }

    // แก้แต่ข้อมูลในฟอร์ม ไม่ได้สร้าง PDF ใหม่ ให้คงลิงก์ไฟล์เดิมไว้
    if (target && !fileUrl) {
      fileUrl = target.fileUrl;
      fileId = target.fileId;
    }

    const newDocId = docId || Utilities.getUuid();
    const values = documentRowValues(data, {
      docId: newDocId,
      fileUrl: fileUrl,
      fileId: fileId,
      filename: body.filename || (target ? target.filename : ''),
      savedAt: target ? target.savedAt : new Date()
    });

    let row;
    if (target) {
      row = target.row;
      sheet.getRange(row, 1, 1, HEADERS.length).setValues([values]);
    } else {
      sheet.appendRow(values);
      row = sheet.getLastRow();
    }

    // ทิ้งไฟล์เก่าหลังเขียนแถวสำเร็จเท่านั้น ถ้าทิ้งก่อนแล้วเขียนพลาด
    // จะเหลือแถวที่ชี้ไปไฟล์ที่ไม่มีอยู่จริง
    if (target && target.fileId && target.fileId !== fileId) {
      trashFile(target.fileId);
    }

    return { ok: true, fileUrl: fileUrl, fileId: fileId, row: row, docId: newDocId, updated: !!target };
  } finally {
    lock.releaseLock();
  }
}

/** ประกอบค่าหนึ่งแถวให้ครบ HEADERS พร้อมก้อน JSON ท้ายแถว */
function documentRowValues(data, meta) {
  const payload = {
    docId: meta.docId,
    fileUrl: meta.fileUrl || '',
    fileId: meta.fileId || '',
    filename: meta.filename || '',
    updatedAt: new Date().toISOString(),
    data: {
      receiveNumber: String(data.receiveNumber || ''),
      receiveDate: data.receiveDate || '',
      bookNumber: String(data.bookNumber || ''),
      bookDate: data.bookDate || '',
      fromInp: data.fromInp || '',
      to: data.to || '',
      subject: data.subject || '',
      action: data.action || '',
      department: data.department || '',
      commanded: data.commanded || '',
      msgCommand: data.msgCommand || '',
      attachments: normalizeAttachments(data)
    }
  };

  return [
    meta.savedAt || new Date(),
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
    meta.fileUrl || '',
    formatAttachments(data),
    meta.filename || '',
    meta.docId,
    JSON.stringify(payload)
  ];
}

/** ย้ายไฟล์เดิมลงถังขยะแบบไม่ให้ล้มทั้งคำขอ ถ้าไฟล์ถูกลบไปแล้วก็ปล่อยผ่าน */
function trashFile(fileId) {
  if (!fileId) return;
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (err) {
    console.warn('ลบไฟล์เดิมไม่สำเร็จ ' + fileId + ': ' + err);
  }
}

/**
 * รวมสิ่งที่ส่งมาด้วยให้เป็นรูปแบบเดียว [{ label, url }]
 * ฝั่งเว็บส่งมาได้สองแบบ: attachments (แบบใหม่) หรือ atth_a/atth_labels (แบบเดิม)
 */
function normalizeAttachments(data) {
  if (Array.isArray(data.attachments)) {
    return data.attachments
      .map(function (item) {
        return {
          label: String((item && item.label) || '').trim(),
          url: String((item && item.url) || '').trim()
        };
      })
      .filter(function (item) { return item.url; });
  }

  const urls = data.atth_a || [];
  const labels = data.atth_labels || [];
  return urls
    .map(function (url, index) {
      return { label: String(labels[index] || '').trim(), url: String(url || '').trim() };
    })
    .filter(function (item) { return item.url; });
}

/**
 * สิ่งที่ส่งมาด้วย เขียนเป็น "ชื่อรายการ · ลิงก์" บรรทัดละรายการ
 * คอลัมน์นี้มีไว้ให้คนอ่านในชีต ตอนดึงกลับมาแก้ไขระบบจะอ่านจากคอลัมน์
 * "ข้อมูลดิบ" แทน เพราะชื่อรายการที่มี " · " อยู่ในตัวจะแยกกลับไม่ถูก
 */
function formatAttachments(data) {
  return normalizeAttachments(data).map(function (item) {
    return item.label ? (item.label + ' · ' + item.url) : item.url;
  }).join('\n');
}

/** แยกข้อความในคอลัมน์ "สิ่งที่ส่งมาด้วย" กลับมา ใช้กับแถวเก่าที่ยังไม่มีข้อมูลดิบ */
function parseAttachments(text) {
  return String(text || '')
    .split('\n')
    .map(function (line) { return line.trim(); })
    .filter(Boolean)
    .map(function (line) {
      const at = line.lastIndexOf(' · ');
      if (at === -1) return { label: '', url: line };
      return { label: line.slice(0, at).trim(), url: line.slice(at + 3).trim() };
    })
    .filter(function (item) { return item.url; });
}

/* ══════════════════════════════════════════════════════════════════════
   รูปหน้าเอกสารสำหรับส่งเข้า LINE

   ข้อความรูปภาพของ LINE ไม่ได้แนบไฟล์ไปกับข้อความ แต่ส่งไปแค่ลิงก์
   แล้วเซิร์ฟเวอร์ของ LINE จะมาดึงรูปเอง ไฟล์จึงต้องเปิดให้ผู้ที่มีลิงก์
   เห็นได้เสมอ ไม่ว่า SHARE_WITH_ANYONE จะตั้งไว้อย่างไร มิฉะนั้นผู้รับ
   จะเห็นเป็นช่องว่าง

   ลิงก์ที่คืนกลับไปเป็นปลายทาง /thumbnail ซึ่งคืนไฟล์ภาพจริง
   ต่างจากลิงก์ /view ที่เป็นหน้าเว็บ ถ้าส่ง /view ไป LINE จะแสดงรูปไม่ขึ้น
   ══════════════════════════════════════════════════════════════════════ */

/**
 * อัปโหลดรูปหน้าเอกสาร แล้วคืนลิงก์ที่ LINE ดึงรูปไปแสดงได้
 * body = { images: [{ base64, filename, mime }] }
 */
function saveShareImages(body) {
  const images = (body && body.images) || [];

  if (!images.length) throw new Error('ไม่มีรูปที่จะอัปโหลด');
  if (images.length > 5) throw new Error('LINE ส่งได้ครั้งละไม่เกิน 5 ข้อความ จึงอัปโหลดเกิน 5 รูปไม่ได้');

  const folder = getImageFolder();

  const out = images.map(function (image, index) {
    if (!image || !image.base64) throw new Error('ข้อมูลรูปหน้าที่ ' + (index + 1) + ' ไม่ครบ');

    const mime = image.mime || 'image/jpeg';
    const name = image.filename || ('หน้า_' + (index + 1) + '_' + nowStamp() + '.jpg');
    const blob = Utilities.newBlob(Utilities.base64Decode(image.base64), mime, name);
    const file = folder.createFile(blob);

    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const id = file.getId();
    return {
      fileId: id,
      filename: name,
      originalUrl: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1600',
      previewUrl: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w480',
      viewUrl: 'https://drive.google.com/file/d/' + id + '/view?usp=sharing'
    };
  });

  return { ok: true, images: out };
}

/** โฟลเดอร์ย่อยของรูป สร้างให้อัตโนมัติในครั้งแรกที่มีการส่งรูป */
function getImageFolder() {
  const parent = getFolder();
  const name = CONFIG.IMAGE_FOLDER_NAME || 'ภาพแชร์เข้า LINE';

  const found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}

/**
 * ย้ายรูปเก่าที่ส่งไปแล้วลงถังขยะ กดรันเองหรือตั้งทริกเกอร์รายวันก็ได้
 *
 * ผู้รับที่ย้อนไปเปิดข้อความเก่าจะไม่เห็นรูปอีก เพราะ LINE ไปดึงจากลิงก์ทุกครั้ง
 * ถ้าต้องการให้รูปอยู่ถาวร ให้ตั้ง IMAGE_KEEP_DAYS เป็น 0
 */
function cleanOldShareImages() {
  const days = Number(CONFIG.IMAGE_KEEP_DAYS || 0);
  if (!days) {
    Logger.log('IMAGE_KEEP_DAYS เป็น 0 จึงไม่ลบรูปใด');
    return;
  }

  const deadline = new Date(new Date().getTime() - days * 24 * 60 * 60 * 1000);
  const files = getImageFolder().getFiles();
  let removed = 0;

  while (files.hasNext()) {
    const file = files.next();
    if (file.getDateCreated() < deadline) {
      file.setTrashed(true);
      removed++;
    }
  }

  Logger.log('ย้ายรูปที่เก่ากว่า ' + days + ' วันลงถังขยะแล้ว ' + removed + ' ไฟล์');
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

/** รายการล่าสุดสำหรับแสดงในหน้าเว็บ (หน้าแรกใช้ docId ในนี้ทำปุ่มแก้ไข) */
function listRecent(limit) {
  const sheet = getSheet();
  ensureColumns(sheet);
  backfillDocIds(sheet);

  const last = sheet.getLastRow();
  if (last < 2) return [];

  const count = Math.min(limit, last - 1);
  const start = last - count + 1;
  const values = sheet.getRange(start, 1, count, HEADERS.length).getValues();

  return values.map(function (r, i) {
    const doc = rowToDocument(r, start + i);
    return {
      docId: doc.docId,
      row: doc.row,
      savedAt: formatDate(r[0]),
      updatedAt: doc.updatedAt,
      receiveNumber: doc.data.receiveNumber,
      receiveDate: doc.data.receiveDate,
      bookNumber: doc.data.bookNumber,
      bookDate: doc.data.bookDate,
      from: doc.data.fromInp,
      to: doc.data.to,
      subject: doc.data.subject,
      department: doc.data.department,
      commanded: doc.data.commanded,
      fileUrl: doc.fileUrl
    };
  }).reverse();
}

/** ดึงเอกสารหนึ่งฉบับกลับมาเติมลงฟอร์ม */
function getDocumentById(docId) {
  const id = String(docId || '').trim();
  if (!id) throw new Error('ไม่ได้ระบุรหัสเอกสาร');

  const sheet = getSheet();
  ensureColumns(sheet);

  const found = findRowByDocId(sheet, id);
  if (!found) throw new Error('ไม่พบเอกสารนี้ในทะเบียน อาจถูกลบออกจากชีตไปแล้ว');
  return found;
}

/**
 * แปลงค่าหนึ่งแถวเป็นออบเจ็กต์เอกสาร
 *
 * อ่านจากคอลัมน์ "ข้อมูลดิบ" ก่อนเสมอ เพราะเป็นค่าที่ผู้ใช้พิมพ์จริง
 * ส่วนคอลัมน์อื่นผ่านการจัดรูปแบบของ Sheets มาแล้ว ใช้เป็นตัวสำรอง
 * สำหรับแถวเก่าที่บันทึกไว้ก่อนมีคอลัมน์นี้
 */
function rowToDocument(r, row) {
  let payload = null;
  try {
    const raw = r[COL_PAYLOAD - 1];
    if (raw) payload = JSON.parse(raw);
  } catch (err) {
    console.warn('อ่านข้อมูลดิบแถว ' + row + ' ไม่ได้: ' + err);
  }

  const saved = (payload && payload.data) || {};
  const pick = function (key, fallback) {
    return saved[key] !== undefined ? saved[key] : fallback;
  };

  return {
    row: row,
    docId: String(r[COL_DOC_ID - 1] || (payload && payload.docId) || ''),
    fileUrl: (payload && payload.fileUrl) || r[12] || '',
    fileId: (payload && payload.fileId) || '',
    filename: (payload && payload.filename) || r[14] || '',
    savedAt: r[0] || null,
    updatedAt: (payload && payload.updatedAt) || '',
    hasPayload: !!payload,
    data: {
      receiveNumber: String(pick('receiveNumber', r[1] || '')),
      receiveDate: pick('receiveDate', formatDate(r[2])),
      bookNumber: String(pick('bookNumber', r[3] || '')),
      bookDate: pick('bookDate', formatDate(r[4])),
      fromInp: pick('fromInp', r[5] || ''),
      to: pick('to', r[6] || ''),
      subject: pick('subject', r[7] || ''),
      action: pick('action', r[8] || ''),
      department: pick('department', r[9] || ''),
      commanded: pick('commanded', r[10] || ''),
      msgCommand: pick('msgCommand', r[11] || ''),
      attachments: Array.isArray(saved.attachments) ? saved.attachments : parseAttachments(r[13])
    }
  };
}

/** หาแถวจากรหัสเอกสาร คืน null ถ้าไม่เจอ */
function findRowByDocId(sheet, docId) {
  const id = String(docId || '').trim();
  const last = sheet.getLastRow();
  if (!id || last < 2) return null;

  const ids = sheet.getRange(2, COL_DOC_ID, last - 1, 1).getValues();

  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0] || '').trim() !== id) continue;
    const row = i + 2;
    return rowToDocument(sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0], row);
  }
  return null;
}

/**
 * ตรวจว่าเลขทะเบียนนี้ถูกใช้แล้วหรือยัง
 * excludeDocId ใช้ตอนแก้ไข ไม่อย่างนั้นระบบจะเจอแถวของตัวเองแล้วเตือนว่าเลขซ้ำ
 */
function findByReceiveNumber(receiveNumber, excludeDocId) {
  const target = toArabicDigits(receiveNumber).replace(/[^0-9]/g, '');
  if (!target) return { exists: false };

  const sheet = getSheet();
  ensureColumns(sheet);

  const last = sheet.getLastRow();
  if (last < 2) return { exists: false };

  const skip = String(excludeDocId || '').trim();
  const values = sheet.getRange(2, 2, last - 1, HEADERS.length - 1).getValues();  // เลขที่รับ .. ข้อมูลดิบ

  for (let i = values.length - 1; i >= 0; i--) {
    const cell = toArabicDigits(values[i][0]).replace(/[^0-9]/g, '');
    if (!cell || cell !== target) continue;
    if (skip && String(values[i][COL_DOC_ID - 2] || '').trim() === skip) continue;
    return { exists: true, row: i + 2, subject: values[i][6] || '' };
  }
  return { exists: false };
}

/* ══════════════════════════════════════════════════════════════════════
   ปรับโครงชีตให้ทันโค้ด

   ชีตที่ใช้อยู่เดิมมี 15 คอลัมน์และไม่มีรหัสเอกสาร สองฟังก์ชันข้างล่าง
   เติมคอลัมน์ที่ขาดและแจกรหัสให้แถวเก่าให้เอง ไม่ต้องไปแก้ในชีต
   ══════════════════════════════════════════════════════════════════════ */

/** เติมคอลัมน์และหัวตารางที่ขาด ทำงานจริงแค่ครั้งแรกครั้งเดียว */
function ensureColumns(sheet) {
  const width = sheet.getMaxColumns();
  if (width < HEADERS.length) sheet.insertColumnsAfter(width, HEADERS.length - width);

  const head = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const missing = HEADERS.some(function (h, i) { return String(head[i] || '') !== h; });
  if (!missing) return;

  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setBackground('#12203D').setFontColor('#FFFFFF');
  formatTextColumns(sheet);
}

/**
 * เลขที่รับ "0124" กับเลขที่หนังสือ ต้องเก็บเป็นข้อความ
 * ถ้าปล่อยให้เป็นตัวเลข Sheets จะกินศูนย์นำหน้า ดึงกลับมาแก้ไขจะเหลือ 124
 */
function formatTextColumns(sheet) {
  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, 2, rows, 1).setNumberFormat('@');
  sheet.getRange(2, 4, rows, 1).setNumberFormat('@');
  sheet.getRange(2, COL_PAYLOAD, rows, 1).setNumberFormat('@');
}

/** แจกรหัสเอกสารให้แถวที่ยังไม่มี เขียนกลับรวดเดียว */
function backfillDocIds(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return;

  const ids = sheet.getRange(2, COL_DOC_ID, last - 1, 1).getValues();
  let changed = false;

  ids.forEach(function (cell) {
    if (String(cell[0] || '').trim()) return;
    cell[0] = Utilities.getUuid();
    changed = true;
  });

  if (changed) sheet.getRange(2, COL_DOC_ID, last - 1, 1).setValues(ids);
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
  sheet.hideColumns(COL_PAYLOAD);   // ก้อน JSON ยาวมาก ซ่อนไว้ไม่ให้เกะกะเวลาคนเปิดชีตดู
  formatTextColumns(sheet);
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
  ensureColumns(sheet);
  backfillDocIds(sheet);
  Logger.log('พร้อมใช้งาน: ' + sheet.getName() + ' มีข้อมูล ' + Math.max(sheet.getLastRow() - 1, 0) + ' รายการ');

  const settings = getSettingsSheet();
  Logger.log('ชีตตั้งค่า: ' + settings.getName() + ' มีค่า ' + Math.max(settings.getLastRow() - 1, 0) + ' รายการ');
}

/** ตรวจว่าตั้งค่าครบและเข้าถึง Drive กับชีตได้จริง */
function testConfig() {
  Logger.log('ชีต: ' + getSheet().getName());
  Logger.log('โฟลเดอร์: ' + getFolder().getName());
  Logger.log('โฟลเดอร์รูปแชร์: ' + getImageFolder().getName());
  Logger.log('เลขทะเบียนถัดไป: ' + nextReceiveNumber());
  Logger.log('ค่าตั้งค่าหน่วยงาน: ' + JSON.stringify(readSettings()));
  Logger.log('ตั้งค่าครบแล้ว');
}
