/* ═══════════════════════════════════════════════════════════════════
   เข้าใช้งานผ่าน LINE (LIFF) และแชร์เอกสารด้วย Share Target Picker

   ไฟล์นี้ทำสามอย่าง
   ๑) กั้นหน้าเว็บไว้จนกว่า liff.init() และการล็อกอินจะเรียบร้อย
   ๒) ดึงโปรไฟล์ LINE มาแสดงบนหัวเว็บ
   ๓) ส่งเอกสารเข้า LINE ด้วย share target picker ได้สองแบบ
      · การ์ดข้อมูล — อัปโหลด PDF ขึ้น Drive แล้วส่งเป็น Flex Message
        พร้อมปุ่มเปิดไฟล์ ปุ่มสิ่งที่ส่งมาด้วย และปุ่มส่งต่อไปหน้า share.html
      · รูปหน้าเอกสาร — แปลงหน้าที่เลือกเป็นรูป อัปโหลดขึ้น Drive
        แล้วส่งเป็นข้อความรูปภาพ นำหน้าด้วยข้อความที่ผู้ส่งพิมพ์เอง

   หน้าตาการ์ดและการเข้ารหัสข้อมูลอยู่ใน flex-doc.js ใช้ร่วมกับ share.html
   ═══════════════════════════════════════════════════════════════════ */

const LIFF_ID = '1660731301-JRVEEAmW';

/**
 * ปกติปุ่มส่งต่อจะชี้ไปที่ https://liff.line.me/{LIFF_ID}/share.html
 * ซึ่งใช้ได้เมื่อ Endpoint URL ของ LIFF เป็นรากของเว็บ (ลงท้ายด้วย /)
 * ถ้าสร้าง LIFF แยกอีกตัวให้ share.html โดยเฉพาะ ให้ใส่ LIFF ID ของตัวนั้นตรงนี้
 */
const SHARE_PAGE_LIFF_ID = '';

const FORWARD_BASE = SHARE_PAGE_LIFF_ID
  ? `https://liff.line.me/${SHARE_PAGE_LIFF_ID}`
  : `https://liff.line.me/${LIFF_ID}/share.html`;

/** โทนสีการ์ดที่ผู้ส่งเลือกไว้ครั้งก่อน จำไว้ในเครื่อง ไม่ต้องเลือกใหม่ทุกครั้ง */
const THEME_KEY = 'saraban.shareTheme.v1';

/** รูปแบบที่เลือกส่งครั้งก่อน 'card' หรือ 'image' */
const MODE_KEY = 'saraban.shareMode.v1';

/** LINE ส่งได้ครั้งละไม่เกินห้าข้อความ ข้อความนำหนึ่งกล่องก็นับรวมด้วย */
const MESSAGE_MAX = 5;

/** ด้านยาวของรูปที่อัปโหลด พอให้อ่านตัวหนังสือออกโดยไฟล์ไม่อ้วนเกินไป */
const IMAGE_LONG_EDGE = 1600;

/** ความยาวข้อความนำที่ยอมให้พิมพ์ ต้องตรงกับ maxlength ของ textarea */
const MESSAGE_LIMIT = 1000;

const el = (id) => document.getElementById(id);

let lineProfile = null;
let liffReady = false;
let lastUpload = null;    // { fileId, fileUrl, viewUrl, filename, fingerprint, payload, forwardUrl, trimmed }
let preparing = null;     // งานสร้าง+อัปโหลดไฟล์ที่กำลังทำอยู่ กันกดซ้ำ
let shareTheme = loadShareTheme();   // โทนสีของการ์ดที่จะส่งออกไป
let previewUpload = null;            // ไฟล์ที่ตัวอย่างการ์ดบนจอกำลังอ้างถึง

let shareMode = loadShareMode();     // 'card' = การ์ดข้อมูล  'image' = รูปหน้าเอกสาร
let selectedPages = [];              // ลำดับหน้าที่ติ๊กไว้ นับจาก 0 เรียงจากน้อยไปมาก
let messageTouched = false;          // ผู้ส่งแก้ข้อความนำเองแล้วหรือยัง ถ้าแก้แล้วจะไม่เขียนทับ
let lastImages = null;               // { fingerprint, images: [{ originalUrl, previewUrl, ... }] }
let preparingImages = null;          // งานอัปโหลดรูปที่กำลังทำอยู่ กันกดซ้ำ
let imagePrepTimer = 0;              // หน่วงไว้ครู่หนึ่งระหว่างผู้ส่งไล่ติ๊กหน้า

/* ═══════════════════════════════════════════════════════════════════
   โทนสีการ์ด

   โทนไม่ได้เดินทางไปกับลิงก์ปุ่มส่งต่อ เป็นแค่สีของการ์ดใบที่ส่งครั้งแรก
   การ์ดทอดสองยังเป็นโทนเขียวเหมือนเดิม ผู้รับจะได้แยกออกว่าเป็นของส่งต่อ
   ═══════════════════════════════════════════════════════════════════ */
function loadShareTheme() {
  try {
    return FlexDoc.originTheme(localStorage.getItem(THEME_KEY));
  } catch (err) {
    console.warn('อ่านโทนสีที่เลือกไว้ไม่ได้ ใช้โทนเริ่มต้นแทน', err);
    return FlexDoc.DEFAULT_THEME;
  }
}

function loadShareMode() {
  try {
    return localStorage.getItem(MODE_KEY) === 'image' ? 'image' : 'card';
  } catch (err) {
    console.warn('อ่านรูปแบบการแชร์ที่เลือกไว้ไม่ได้ ใช้การ์ดข้อมูลแทน', err);
    return 'card';
  }
}

function rememberShareMode(mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch (err) {
    console.warn('จำรูปแบบการแชร์ไว้ในเครื่องไม่ได้', err);
  }
}

function rememberShareTheme(key) {
  try {
    localStorage.setItem(THEME_KEY, key);
  } catch (err) {
    console.warn('จำโทนสีที่เลือกไว้ในเครื่องไม่ได้', err);
  }
}

/** ปรับหน้าตาปุ่มให้ปุ่มของโทนที่เลือกอยู่เด่นขึ้นมาใบเดียว */
function syncThemeButtons() {
  const picker = el('share-theme-picker');
  if (!picker) return;

  picker.querySelectorAll('button[data-theme]').forEach((button) => {
    const active = button.dataset.theme === shareTheme;
    button.setAttribute('aria-checked', String(active));
    button.className = `flex items-center gap-2 rounded-xl border px-2.5 py-2 text-xs font-medium transition-colors ${
      active ? 'border-ink-600 bg-ink-50 text-ink-800' : 'border-desk-300 text-ink-500 hover:border-ink-300'}`;
  });
}

function renderThemePicker() {
  const picker = el('share-theme-picker');
  if (!picker || picker.dataset.ready === '1') {
    syncThemeButtons();
    return;
  }

  picker.innerHTML = FlexDoc.ORIGIN_THEMES.map((theme) => `
    <button type="button" role="radio" data-theme="${theme.key}" aria-checked="false">
      <span class="w-4 h-4 rounded-full shrink-0" style="background:${theme.swatch}"></span>
      <span class="truncate">${FlexDoc.escapeHtml(theme.label)}</span>
    </button>`).join('');

  picker.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-theme]');
    if (!button) return;

    shareTheme = FlexDoc.originTheme(button.dataset.theme);
    rememberShareTheme(shareTheme);
    syncThemeButtons();
    renderSharePreview(collectFormData(), previewUpload);   // วาดใบเดิมด้วยสีใหม่
  });

  picker.dataset.ready = '1';
  syncThemeButtons();
}

/* ═══════════════════════════════════════════════════════════════════
   หน้าจอกั้นก่อนเข้าใช้งาน
   ═══════════════════════════════════════════════════════════════════ */
function gateEls() {
  return {
    root: el('liffGate'),
    spinner: el('gate-spinner'),
    icon: el('gate-icon'),
    title: el('gate-title'),
    message: el('gate-message'),
    login: el('gate-login-btn'),
    retry: el('gate-retry-btn'),
    skip: el('gate-skip-btn')
  };
}

/**
 * ปรับหน้าจอกั้นให้ตรงกับสถานะ
 * state: 'loading' | 'login' | 'error'
 */
function setGate(state, title, message) {
  const g = gateEls();
  if (!g.root) return;

  g.title.textContent = title;
  g.message.textContent = message;

  g.spinner.classList.toggle('hidden', state !== 'loading');

  const isError = state === 'error';
  g.icon.className = isError
    ? 'w-12 h-12 mx-auto rounded-2xl flex items-center justify-center text-xl bg-seal-500/10 text-seal-500'
    : 'hidden w-12 h-12 mx-auto rounded-2xl items-center justify-center text-xl';

  const showLogin = state === 'login';
  g.login.classList.toggle('hidden', !showLogin);
  g.login.classList.toggle('flex', showLogin);

  g.retry.classList.toggle('hidden', !isError);
  g.skip.classList.toggle('hidden', !isError);
}

function hideGate() {
  const root = el('liffGate');
  if (!root) return;
  root.style.transition = 'opacity .35s ease';
  root.style.opacity = '0';
  setTimeout(() => root.remove(), 350);
}

/* ═══════════════════════════════════════════════════════════════════
   โปรไฟล์บนหัวเว็บ
   ═══════════════════════════════════════════════════════════════════ */

/** ไม่มีรูปโปรไฟล์ก็ใช้วงกลมตัวอักษรแรกแทน จะได้ไม่เห็นไอคอนภาพแตก */
function avatarFallback(name) {
  const letter = FlexDoc.escapeHtml((String(name || '?').trim().charAt(0) || '?').toUpperCase());
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
    '<rect width="64" height="64" rx="32" fill="#2A4787"/>' +
    '<text x="32" y="43" text-anchor="middle" font-family="Sarabun,sans-serif" font-size="30" fill="#ffffff">' +
    letter + '</text></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function renderProfile() {
  const name = (lineProfile && lineProfile.displayName) || 'ผู้ใช้ LINE';
  const status = (lineProfile && lineProfile.statusMessage) || 'เข้าใช้งานผ่าน LINE แล้ว';
  const picture = (lineProfile && lineProfile.pictureUrl) || avatarFallback(name);

  ['profileAvatar', 'profileMenuAvatar', 'profileAvatarTop'].forEach((id) => {
    const img = el(id);
    if (!img) return;
    img.onerror = () => { img.onerror = null; img.src = avatarFallback(name); };
    img.src = picture;
    img.alt = name;
  });

  ['profileName', 'profileMenuName', 'profileNameTop'].forEach((id) => {
    const node = el(id);
    if (node) node.textContent = name;
  });

  const statusNode = el('profileMenuStatus');
  if (statusNode) statusNode.textContent = status;

  const chip = el('profileChip');
  if (chip) chip.classList.remove('hidden');

  const topbar = el('topbarProfile');
  if (topbar) {
    topbar.classList.remove('hidden');
    topbar.classList.add('inline-flex');
  }
}

function toggleProfileMenu(force) {
  const menu = el('profileMenu');
  const button = el('profileBtn');
  if (!menu || !button) return;

  const show = typeof force === 'boolean' ? force : menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !show);
  button.setAttribute('aria-expanded', String(show));
}

/* ═══════════════════════════════════════════════════════════════════
   เริ่มต้น LIFF
   ═══════════════════════════════════════════════════════════════════ */
async function bootLiff() {
  setGate('loading', 'กำลังเชื่อมต่อ LINE', 'กรุณารอสักครู่ ระบบกำลังตรวจสอบการเข้าสู่ระบบ');

  if (!window.liff) {
    setGate('error', 'โหลดไลบรารีของ LINE ไม่สำเร็จ',
      'ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต แล้วกดลองเชื่อมต่อใหม่อีกครั้ง');
    return;
  }

  try {
    await liff.init({ liffId: LIFF_ID });
  } catch (err) {
    console.error('liff.init ไม่สำเร็จ', err);
    setGate('error', 'เริ่มต้น LIFF ไม่สำเร็จ',
      `${(err && err.message) || err} · ตรวจว่า Endpoint URL ใน LINE Developers Console ตรงกับที่อยู่ของหน้านี้`);
    return;
  }

  if (!liff.isLoggedIn()) {
    setGate('login', 'ต้องเข้าสู่ระบบก่อนใช้งาน',
      'ระบบลงรับหนังสือนี้ใช้บัญชี LINE ยืนยันตัวตน กำลังพาไปหน้าเข้าสู่ระบบ');
    try {
      liff.login({ redirectUri: location.href });
    } catch (err) {
      console.warn('พาไปหน้าเข้าสู่ระบบอัตโนมัติไม่ได้ ให้กดปุ่มเอง', err);
    }
    return;
  }

  liffReady = true;

  try {
    lineProfile = await liff.getProfile();
  } catch (err) {
    console.warn('ดึงโปรไฟล์ไม่สำเร็จ ใช้ชื่อทั่วไปแทน', err);
  }

  renderProfile();
  hideGate();
}

/* ═══════════════════════════════════════════════════════════════════
   เตรียมไฟล์สำหรับแชร์
   ═══════════════════════════════════════════════════════════════════ */

/**
 * ลายนิ้วมือของงานปัจจุบัน ใช้ดูว่าตั้งแต่อัปโหลดครั้งก่อนมีอะไรเปลี่ยนไหม
 * ถ้าไม่เปลี่ยนก็ใช้ลิงก์เดิม ไม่ต้องอัปไฟล์ซ้ำให้ Drive รก
 */
function docFingerprint(data) {
  const form = { ...data };
  delete form.savedAt;              // เวลาที่บันทึกเปลี่ยนทุกครั้ง ไม่ใช้เทียบ

  const objects = (typeof fabricCanvases !== 'undefined' ? fabricCanvases : []).map((canvas) =>
    canvas.getObjects().map((obj) => [
      obj.type,
      Math.round(obj.left || 0),
      Math.round(obj.top || 0),
      Math.round(obj.getScaledWidth ? obj.getScaledWidth() : 0),
      Math.round(obj.getScaledHeight ? obj.getScaledHeight() : 0),
      Math.round(obj.angle || 0)
    ].join(',')).join(';')
  ).join('|');

  return JSON.stringify({ objects, form });
}

function shareFilename(data) {
  const base = data.receiveNumber
    ? `รับ ${data.receiveNumber} ${data.subject || ''}`.trim()
    : `เอกสาร_${timestamp()}`;
  return `${base}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
}

function currentSchool() {
  return (typeof org !== 'undefined' && org.schoolName) || 'งานสารบรรณ';
}

async function uploadForShare(data) {
  const filename = shareFilename(data);
  const pdf = await buildPdf();

  const out = await cloudPost('saveDocument', {
    data,
    saveToSheet: false,
    pdfBase64: pdfToBase64(pdf),
    filename
  });

  // ลิงก์แบบ /view เปิดดูได้ทันทีในเบราว์เซอร์ในแอป LINE
  const viewUrl = out.fileId
    ? `https://drive.google.com/file/d/${out.fileId}/view?usp=sharing`
    : (out.fileUrl || '');

  const payload = FlexDoc.payloadFromForm(data, {
    school: currentSchool(),
    pdfUrl: viewUrl,
    fileId: out.fileId || ''
  });

  const forward = await FlexDoc.forwardUrl(payload, FORWARD_BASE);

  return {
    fileId: out.fileId || '',
    fileUrl: out.fileUrl || '',
    viewUrl,
    filename,
    fingerprint: docFingerprint(data),
    payload,
    forwardUrl: forward.url,
    trimmed: forward.trimmed
  };
}

function setShareStatus(state, text) {
  const spinner = el('share-status-spinner');
  const icon = el('share-status-icon');
  const label = el('share-status-text');
  if (!label) return;

  label.textContent = text;
  spinner.classList.toggle('hidden', state !== 'busy');

  icon.className = state === 'busy'
    ? 'hidden shrink-0 fa-solid fa-circle-check'
    : state === 'error'
      ? 'shrink-0 fa-solid fa-circle-exclamation text-seal-500'
      : 'shrink-0 fa-solid fa-circle-check text-leaf-500';
}

function setShareWarning(text) {
  const node = el('share-warning');
  if (!node) return;
  node.textContent = text || '';
  node.classList.toggle('hidden', !text);
}

function showReuploadRow(show) {
  const row = el('share-reupload-row');
  if (!row) return;
  row.classList.toggle('hidden', !show);
  row.classList.toggle('flex', show);
}

/** วาดตัวอย่างการ์ดจากข้อมูลในฟอร์ม ใช้เส้นทางเดียวกับที่ผู้รับจะเห็นจริง */
function renderSharePreview(data, upload) {
  const box = el('sharePreview');
  if (!box) return;

  previewUpload = upload || null;

  const payload = upload
    ? upload.payload
    : FlexDoc.payloadFromForm(data, { school: currentSchool() });

  box.innerHTML = FlexDoc.cardHtml(FlexDoc.modelFrom(payload), {
    forwardUrl: upload ? upload.forwardUrl : '',
    theme: shareTheme
  });
}

/** เตือนเรื่องปุ่มส่งต่อ เมื่อข้อมูลยาวจนต้องย่อหรือใส่ปุ่มไม่ได้ */
function forwardNotice(upload) {
  if (!upload.forwardUrl) {
    return 'ข้อมูลยาวเกินกว่าที่ LINE ยอมให้ฝากไปกับลิงก์ การ์ดนี้จะไม่มีปุ่มส่งต่อ (ปุ่มเปิด PDF ยังใช้ได้)';
  }
  if (upload.trimmed) {
    return 'ข้อมูลค่อนข้างยาว การ์ดที่ผู้รับกดส่งต่อจะแสดงรายละเอียดไม่ครบทุกช่อง';
  }
  return '';
}

/** สร้างและอัปโหลดไฟล์ถ้าจำเป็น คืนค่า null เมื่อทำไม่สำเร็จ */
function ensureShareFile({ force = false } = {}) {
  if (preparing) return preparing;

  const data = collectFormData();
  const fingerprint = docFingerprint(data);

  if (!force && lastUpload && lastUpload.fingerprint === fingerprint) {
    setShareStatus('ok', `พร้อมแชร์ · ใช้ไฟล์ ${lastUpload.filename}`);
    setShareWarning(forwardNotice(lastUpload));
    showReuploadRow(true);
    return Promise.resolve(lastUpload);
  }

  const shareBtn = el('doShareBtn');
  shareBtn.disabled = true;
  setShareStatus('busy', 'กำลังสร้างไฟล์ PDF และอัปโหลดขึ้น Drive...');

  preparing = uploadForShare(data)
    .then((upload) => {
      lastUpload = upload;
      setShareStatus('ok', `พร้อมแชร์ · ${upload.filename}`);
      setShareWarning(forwardNotice(upload));
      showReuploadRow(true);
      renderSharePreview(data, upload);   // ปุ่มเปิด PDF ในตัวอย่างจะใช้งานได้แล้ว
      return upload;
    })
    .catch((err) => {
      console.error('อัปโหลดไฟล์เพื่อแชร์ไม่สำเร็จ', err);
      setShareStatus('error', cloudErrorMessage(err));
      setShareWarning('อัปโหลดไฟล์ไม่สำเร็จ จึงยังไม่มีลิงก์ให้ผู้รับกดเปิด');
      return null;
    })
    .then((upload) => {
      preparing = null;
      shareBtn.disabled = !liffReady;
      return upload;
    });

  return preparing;
}

/* ═══════════════════════════════════════════════════════════════════
   โหมดรูปหน้าเอกสาร

   ข้อความรูปภาพของ LINE ไม่ได้แนบไฟล์ไปด้วย ส่งไปแค่ลิงก์ แล้วเซิร์ฟเวอร์
   ของ LINE จะมาดึงรูปเอง จึงต้องอัปโหลดรูปขึ้น Drive ให้เสร็จเสียก่อน
   แล้วค่อยเปิดหน้าต่างเลือกผู้รับ
   ═══════════════════════════════════════════════════════════════════ */

function pageTotal() {
  return (typeof fabricCanvases !== 'undefined' && fabricCanvases) ? fabricCanvases.length : 0;
}

/** เลขไทยสำหรับข้อความบนหน้าจอ */
function thai(value) {
  return FlexDoc.thaiDigits(String(value));
}

function shareMessageText() {
  const box = el('share-message');
  return box ? box.value.trim() : '';
}

/** เหลือที่ให้รูปกี่หน้า ข้อความนำหนึ่งกล่องก็กินโควตาไปหนึ่งเหมือนกัน */
function maxSharePages() {
  return MESSAGE_MAX - (shareMessageText() ? 1 : 0);
}

/* ── ข้อความนำ ─────────────────────────────────────────────────── */

/** ร่างข้อความจากช่องในฟอร์ม ผู้ส่งแก้ต่อได้ตามใจ */
function defaultShareMessage(data) {
  const lines = [];
  const school = currentSchool();

  if (school) lines.push(school);
  if (data.receiveNumber) lines.push(`หนังสือรับเลขที่ ${thai(data.receiveNumber)}`);
  if (data.subject) lines.push(`เรื่อง ${data.subject}`);
  if (data.commanded) lines.push(`การสั่งการ ${data.commanded}`);
  if (data.msgCommand) lines.push(data.msgCommand);

  return lines.join('\n').slice(0, MESSAGE_LIMIT);
}

/**
 * เติมข้อความร่างให้ ยกเว้นผู้ส่งพิมพ์แก้เองไว้แล้ว
 * รวมถึงกรณีลบทิ้งจนว่างเพราะตั้งใจส่งแต่รูป ก็ไม่เขียนทับให้เหมือนกัน
 */
function fillShareMessage(force) {
  const box = el('share-message');
  if (!box) return;
  if (!force && messageTouched) return;

  box.value = defaultShareMessage(collectFormData());
  messageTouched = false;      // ตรงกับร่างจากฟอร์มแล้ว เปิดครั้งหน้าจึงร่างใหม่ได้
  syncMessageCount();
}

function syncMessageCount() {
  const box = el('share-message');
  const count = el('share-message-count');
  if (box && count) count.textContent = thai(box.value.length);
}

/* ── ปุ่มเลือกหน้า ─────────────────────────────────────────────── */

/** ค่าเริ่มต้น เลือกทุกหน้าเท่าที่ LINE ยอมให้ส่งในครั้งเดียว */
function resetPageSelection() {
  const limit = Math.max(Math.min(pageTotal(), maxSharePages()), 0);
  selectedPages = Array.from({ length: limit }, (_, i) => i);
}

function syncPageButtons() {
  const picker = el('share-page-picker');
  if (!picker) return;

  picker.querySelectorAll('button[data-page]').forEach((button) => {
    const active = selectedPages.includes(Number(button.dataset.page));
    button.setAttribute('aria-pressed', String(active));
    button.className = `rounded-lg border py-2 text-xs font-medium transition-colors ${
      active ? 'border-ink-600 bg-ink-50 text-ink-800' : 'border-desk-300 text-ink-500 hover:border-ink-300'}`;
  });

  const hint = el('share-page-hint');
  if (hint) {
    hint.textContent = `เลือกแล้ว ${thai(selectedPages.length)} จากที่ส่งได้ ${thai(maxSharePages())} หน้า`;
  }
}

/** สร้างปุ่มใหม่ทุกครั้งที่เปิดกล่อง เพราะจำนวนหน้าเปลี่ยนได้ */
function renderPagePicker() {
  const picker = el('share-page-picker');
  if (!picker) return;

  picker.innerHTML = Array.from({ length: pageTotal() }, (_, i) => `
    <button type="button" data-page="${i}" aria-pressed="false">${thai(i + 1)}</button>`).join('');

  syncPageButtons();
}

/**
 * ตัดหน้าที่เกินโควตาออกจากท้ายรายการ
 * เกิดตอนผู้ส่งเริ่มพิมพ์ข้อความนำทั้งที่ติ๊กหน้าไว้เต็มโควตาแล้ว
 */
function enforcePageLimit() {
  const limit = maxSharePages();
  if (selectedPages.length <= limit) return false;

  const dropped = selectedPages.slice(limit);
  selectedPages = selectedPages.slice(0, limit);

  syncPageButtons();
  renderImagePreview();
  toast(`มีข้อความนำแล้ว จึงเอาหน้า ${thai(dropped.map((i) => i + 1).join(' '))} ออก`, 'info');
  return true;
}

/* ── รูปของแต่ละหน้า ───────────────────────────────────────────── */

/** วาดหน้าเอกสารออกมาเป็นรูป ย่อให้ด้านยาวไม่เกินที่กำหนด */
function pageImageDataUrl(index, longEdge, quality) {
  const canvas = (typeof fabricCanvases !== 'undefined' && fabricCanvases[index]) || null;
  if (!canvas) return '';

  canvas.discardActiveObject();
  canvas.renderAll();

  const edge = Math.max(canvas.getWidth(), canvas.getHeight()) || 1;
  return canvas.toDataURL({
    format: 'jpeg',
    quality,
    multiplier: Math.min(1, longEdge / edge)
  });
}

function renderImagePreview() {
  const box = el('share-image-preview');
  if (!box) return;

  if (!selectedPages.length) {
    box.innerHTML = '<p class="py-6 text-xs text-ink-400">ยังไม่ได้เลือกหน้าที่จะส่ง</p>';
    return;
  }

  box.innerHTML = selectedPages.map((index) => `
    <figure class="w-24">
      <img src="${pageImageDataUrl(index, 320, 0.7)}" alt="หน้า ${thai(index + 1)}"
           class="w-full rounded-lg border border-desk-300 bg-white" />
      <figcaption class="mt-1 text-center text-[11px] text-ink-400">หน้า ${thai(index + 1)}</figcaption>
    </figure>`).join('');
}

function shareImageName(data, index) {
  const base = data.receiveNumber ? `รับ ${data.receiveNumber}` : 'เอกสาร';
  return `${base} หน้า ${index + 1} ${timestamp()}.jpg`.replace(/[\\/:*?"<>|]/g, '-');
}

/** ลายนิ้วมือของชุดรูป เปลี่ยนหน้าที่เลือกหรือแก้เอกสารก็ต้องอัปใหม่ */
function imageFingerprint(data) {
  return `${docFingerprint(data)}|${selectedPages.join(',')}`;
}

async function uploadShareImages(data) {
  const images = selectedPages.map((index) => ({
    base64: pageImageDataUrl(index, IMAGE_LONG_EDGE, 0.9).split(',')[1],
    filename: shareImageName(data, index),
    mime: 'image/jpeg'
  }));

  const out = await cloudPost('saveShareImages', { images });

  return {
    fingerprint: imageFingerprint(data),
    images: out.images || []
  };
}

/** อัปโหลดรูปถ้าจำเป็น คืนค่า null เมื่อทำไม่สำเร็จ */
function ensureShareImages({ force = false } = {}) {
  if (preparingImages) return preparingImages;

  const shareBtn = el('doShareBtn');

  if (!selectedPages.length) {
    setShareStatus('error', 'ยังไม่ได้เลือกหน้าที่จะส่ง');
    showReuploadRow(false);
    shareBtn.disabled = true;
    return Promise.resolve(null);
  }

  const data = collectFormData();
  const fingerprint = imageFingerprint(data);

  if (!force && lastImages && lastImages.fingerprint === fingerprint) {
    setShareStatus('ok', `พร้อมส่ง · รูป ${thai(lastImages.images.length)} หน้า`);
    setShareWarning('');
    showReuploadRow(true);
    shareBtn.disabled = false;
    return Promise.resolve(lastImages);
  }

  shareBtn.disabled = true;
  setShareStatus('busy', `กำลังแปลง ${thai(selectedPages.length)} หน้าเป็นรูปและอัปโหลดขึ้น Drive...`);

  preparingImages = uploadShareImages(data)
    .then((prepared) => {
      lastImages = prepared;
      setShareStatus('ok', `พร้อมส่ง · รูป ${thai(prepared.images.length)} หน้า`);
      setShareWarning('');
      showReuploadRow(true);
      return prepared;
    })
    .catch((err) => {
      console.error('อัปโหลดรูปเพื่อแชร์ไม่สำเร็จ', err);
      setShareStatus('error', cloudErrorMessage(err));
      setShareWarning('อัปโหลดรูปไม่สำเร็จ จึงยังไม่มีลิงก์ให้ LINE ไปดึงรูปมาแสดง');
      return null;
    })
    .then((prepared) => {
      preparingImages = null;
      el('doShareBtn').disabled = !liffReady;
      return prepared;
    });

  return preparingImages;
}

/** ผู้ส่งไล่ติ๊กหน้าทีละใบ รอให้นิ่งสักครู่ค่อยอัปโหลด จะได้ไม่อัปทิ้งอัปขว้าง */
function scheduleImagePrep() {
  clearTimeout(imagePrepTimer);
  if (shareMode !== 'image') return;
  if (shareBlockReason()) return;        // แชร์ไม่ได้อยู่แล้ว ไม่ต้องอัปรูปทิ้งเปล่า

  el('doShareBtn').disabled = true;
  setShareStatus('busy', 'กำลังเตรียมรูป...');
  imagePrepTimer = setTimeout(() => ensureShareImages(), 600);
}

/* ── สลับโหมด ──────────────────────────────────────────────────── */

function syncModeButtons() {
  const picker = el('share-mode-picker');
  if (!picker) return;

  picker.querySelectorAll('button[data-mode]').forEach((button) => {
    const active = button.dataset.mode === shareMode;
    button.setAttribute('aria-checked', String(active));
    button.className = `inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      active ? 'bg-white text-ink-800 shadow-sm' : 'text-ink-500 hover:text-ink-700'}`;
  });
}

/** ซ่อนหรือแสดงส่วนที่เป็นของแต่ละโหมด ยังไม่แตะการเตรียมไฟล์ */
function applyShareMode() {
  const image = shareMode === 'image';

  syncModeButtons();

  el('share-card-pane').classList.toggle('hidden', image);
  el('share-image-pane').classList.toggle('hidden', !image);
  el('share-card-note').classList.toggle('hidden', image);
  el('share-image-note').classList.toggle('hidden', !image);

  const sheetRow = el('share-sheet-row');
  sheetRow.classList.toggle('hidden', image);
  sheetRow.classList.toggle('flex', !image);

  el('share-subtitle').textContent = image
    ? 'ระบบจะแปลงหน้าที่เลือกเป็นรูป อัปโหลดขึ้น Drive แล้วส่งพร้อมข้อความที่พิมพ์ไว้'
    : 'ระบบจะอัปโหลด PDF ที่ประทับตราแล้วขึ้น Drive แล้วส่งเป็นการ์ดข้อมูลลงรับ';

  el('share-submit-label').textContent = image ? 'ส่งรูปเข้า LINE' : 'เลือกผู้รับใน LINE';

  // วาดรูปตัวอย่างเฉพาะตอนที่พาเนลรูปโผล่ขึ้นมา วาดทุกครั้งที่เปิดกล่องจะหน่วงเปล่า ๆ
  if (image) renderImagePreview();

  showReuploadRow(Boolean(image ? lastImages : lastUpload));
}

/** เตรียมของให้พร้อมส่งตามโหมดที่เปิดอยู่ */
function prepareCurrentMode() {
  const blocked = shareBlockReason();

  if (blocked) {
    setShareWarning(blocked);
    setShareStatus('error', 'ยังแชร์เข้า LINE ไม่ได้');
    el('doShareBtn').disabled = true;
    return;
  }

  setShareWarning('');
  el('doShareBtn').disabled = false;

  if (shareMode === 'image') ensureShareImages();
  else ensureShareFile();
}

/* ═══════════════════════════════════════════════════════════════════
   กล่องแชร์
   ═══════════════════════════════════════════════════════════════════ */
function shareBlockReason() {
  if (!liffReady) {
    return 'ยังไม่ได้เข้าสู่ระบบ LINE จึงแชร์ไม่ได้ กรุณารีเฟรชหน้าเว็บแล้วเข้าสู่ระบบก่อน';
  }
  if (typeof cloudEnabled === 'function' && !cloudEnabled()) {
    return 'ยังไม่ได้ตั้งค่าเชื่อมต่อ Google Drive จึงไม่มีลิงก์ไฟล์ให้ผู้รับเปิดดู';
  }
  try {
    if (!liff.isApiAvailable('shareTargetPicker')) {
      return 'LIFF นี้ยังไม่ได้เปิด share target picker กรุณาเปิดใน LINE Developers Console';
    }
  } catch (err) {
    return 'เรียกใช้ share target picker ในสภาพแวดล้อมนี้ไม่ได้';
  }
  return '';
}

function openShareModal() {
  if (typeof fabricCanvases === 'undefined' || !fabricCanvases.length) {
    toast('ยังไม่มีเอกสาร', 'error');
    return;
  }

  el('share-reupload').checked = false;
  el('share-save-sheet').checked = false;

  renderThemePicker();
  renderSharePreview(collectFormData(), null);

  // จำนวนหน้าเปลี่ยนได้ระหว่างทาง จึงตั้งหน้าที่เลือกใหม่ทุกครั้งที่เปิด
  fillShareMessage(false);
  resetPageSelection();
  renderPagePicker();

  applyShareMode();
  openSheet(el('shareModal'));
  prepareCurrentMode();
}

function closeShareModal() {
  closeSheet(el('shareModal'));
}

/** เขียนแถวลงทะเบียนโดยใช้ลิงก์ไฟล์ที่อัปโหลดไปแล้ว ไม่ต้องอัปไฟล์ซ้ำ */
async function saveShareToSheet(data, upload) {
  showLoading('กำลังบันทึกลงทะเบียน...');
  try {
    const out = await cloudPost('saveDocument', {
      data,
      saveToSheet: true,
      fileUrl: upload.fileUrl,
      fileId: upload.fileId,
      filename: upload.filename
    });
    toast(out.row ? `บันทึกลงทะเบียนที่แถว ${out.row} แล้ว` : 'บันทึกลงทะเบียนแล้ว');
  } catch (err) {
    console.error(err);
    toast(cloudErrorMessage(err), 'error');
  } finally {
    hideLoading();
  }
}

function doShare() {
  return shareMode === 'image' ? doShareImages() : doShareCard();
}

/**
 * ส่งรูปหน้าเอกสาร นำหน้าด้วยข้อความที่ผู้ส่งพิมพ์ไว้ถ้ามี
 * รูปต้องอัปโหลดขึ้น Drive ให้เสร็จก่อน เพราะ LINE จะไปดึงรูปจากลิงก์เอง
 */
async function doShareImages() {
  const blocked = shareBlockReason();
  if (blocked) {
    setShareWarning(blocked);
    return;
  }

  if (!selectedPages.length) {
    toast('เลือกหน้าที่จะส่งก่อน', 'error');
    return;
  }

  clearTimeout(imagePrepTimer);          // กดส่งระหว่างรอหน่วง ให้อัปเดี๋ยวนี้เลย
  const prepared = await ensureShareImages();
  if (!prepared || !prepared.images.length) return;

  const text = shareMessageText();
  const messages = text ? [{ type: 'text', text: text.slice(0, MESSAGE_LIMIT) }] : [];

  prepared.images.forEach((image) => messages.push({
    type: 'image',
    originalContentUrl: image.originalUrl,
    previewImageUrl: image.previewUrl
  }));

  // กันไว้อีกชั้น เผื่อจำนวนหน้าที่เลือกกับข้อความนำรวมกันเกินโควตา
  messages.length = Math.min(messages.length, MESSAGE_MAX);

  try {
    const result = await liff.shareTargetPicker(messages, { isMultiple: true });

    if (!result) {
      toast('ยกเลิกการแชร์', 'info');
      return;
    }

    toast(`ส่งรูป ${thai(prepared.images.length)} หน้าเข้า LINE แล้ว`);
    closeShareModal();
  } catch (err) {
    console.error('shareTargetPicker ไม่สำเร็จ', err);
    toast(`แชร์ไม่สำเร็จ: ${(err && err.message) || err}`, 'error');
  }
}

async function doShareCard() {
  const blocked = shareBlockReason();
  if (blocked) {
    setShareWarning(blocked);
    return;
  }

  const data = collectFormData();
  const fingerprint = docFingerprint(data);

  // ถ้าไฟล์ที่อัปโหลดไว้ยังตรงกับงานปัจจุบัน ให้เรียกหน้าต่างเลือกผู้รับทันที
  // ในจังหวะที่ผู้ใช้กดปุ่ม เพราะบางเบราว์เซอร์บล็อกหน้าต่างที่เปิดหลังรอโหลดข้อมูล
  let upload = (lastUpload && lastUpload.fingerprint === fingerprint) ? lastUpload : null;

  if (!upload) {
    upload = await ensureShareFile({ force: true });
    if (!upload) return;
  }

  const message = FlexDoc.buildFlex(FlexDoc.modelFrom(upload.payload), {
    forwardUrl: upload.forwardUrl,
    theme: shareTheme
  });

  try {
    const result = await liff.shareTargetPicker([message], { isMultiple: true });

    if (!result) {
      toast('ยกเลิกการแชร์', 'info');
      return;
    }

    toast('ส่งเอกสารเข้า LINE แล้ว');
    closeShareModal();

    if (el('share-save-sheet').checked) await saveShareToSheet(data, upload);
  } catch (err) {
    console.error('shareTargetPicker ไม่สำเร็จ', err);
    toast(`แชร์ไม่สำเร็จ: ${(err && err.message) || err}`, 'error');
  }
}

/* ═══════════════════════════════════════════════════════════════════
   ผูกปุ่ม
   ═══════════════════════════════════════════════════════════════════ */
el('gate-login-btn').addEventListener('click', () => {
  if (window.liff && liff.login) liff.login({ redirectUri: location.href });
});

el('gate-retry-btn').addEventListener('click', () => location.reload());

el('gate-skip-btn').addEventListener('click', () => {
  hideGate();
  toast('เข้าใช้งานแบบไม่ผ่าน LINE ปุ่มแชร์จะยังใช้ไม่ได้', 'info');
});

el('profileBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleProfileMenu();
});

el('profileLogoutBtn').addEventListener('click', () => {
  if (!window.liff || !liffReady) return;
  if (!confirm('ต้องการออกจากระบบ LINE ใช่หรือไม่')) return;
  liff.logout();
  location.reload();
});

document.addEventListener('click', (e) => {
  const chip = el('profileChip');
  if (chip && !chip.contains(e.target)) toggleProfileMenu(false);
});

el('share-line-btn').addEventListener('click', openShareModal);

el('share-line-form-btn').addEventListener('click', () => {
  closeDrawer();
  openShareModal();
});

el('closeShareModal').addEventListener('click', closeShareModal);
el('cancelShareBtn').addEventListener('click', closeShareModal);
el('doShareBtn').addEventListener('click', doShare);

el('share-reupload').addEventListener('change', (e) => {
  if (!e.target.checked) return;
  if (shareMode === 'image') ensureShareImages({ force: true });
  else ensureShareFile({ force: true });
});

el('share-mode-picker').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-mode]');
  if (!button || button.dataset.mode === shareMode) return;

  shareMode = button.dataset.mode === 'image' ? 'image' : 'card';
  rememberShareMode(shareMode);

  clearTimeout(imagePrepTimer);
  applyShareMode();
  prepareCurrentMode();
});

el('share-page-picker').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-page]');
  if (!button) return;

  const page = Number(button.dataset.page);
  const at = selectedPages.indexOf(page);

  if (at >= 0) {
    selectedPages.splice(at, 1);
  } else {
    if (selectedPages.length >= maxSharePages()) {
      toast(`ส่งได้ครั้งละไม่เกิน ${thai(maxSharePages())} หน้า`, 'error');
      return;
    }
    selectedPages.push(page);
    selectedPages.sort((a, b) => a - b);
  }

  syncPageButtons();
  renderImagePreview();
  scheduleImagePrep();
});

el('share-message').addEventListener('input', () => {
  messageTouched = true;
  syncMessageCount();
  syncPageButtons();
  if (enforcePageLimit()) scheduleImagePrep();   // ตัดหน้าออกแล้วต้องอัปรูปชุดใหม่
});

el('share-message-fill').addEventListener('click', () => {
  fillShareMessage(true);
  syncPageButtons();
  if (enforcePageLimit()) scheduleImagePrep();
});

el('shareModal').addEventListener('click', (e) => {
  if (e.target === el('shareModal')) closeShareModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!el('shareModal').classList.contains('hidden')) closeShareModal();
  toggleProfileMenu(false);
});

/* ═══════════════════════════════════════════════════════════════════
   เริ่มทำงาน
   ═══════════════════════════════════════════════════════════════════ */
bootLiff();
