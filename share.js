/* ═══════════════════════════════════════════════════════════════════
   หน้าส่งต่อเอกสาร (share.html)

   ผู้รับกดปุ่ม "ส่งต่อเอกสารนี้" บนการ์ดต้นทางแล้วมาถึงหน้านี้
   ข้อมูลเอกสารทั้งหมดเดินทางมากับพารามิเตอร์ d ในลิงก์
   หน้านี้จึงไม่ต้องต่อฐานข้อมูลใด ๆ แค่ถอดรหัสแล้วประกอบการ์ดขึ้นมาใหม่

   การ์ดที่ส่งต่อออกไปเป็นโทนเขียวและ "ไม่มีปุ่มส่งต่อ" อีก
   เอกสารจึงเดินทางได้แค่ทอดเดียว ไม่กระจายต่อไปไม่รู้จบ
   ผลพลอยได้คือข้อสั่งการที่พิมพ์เพิ่มไม่ต้องยัดกลับลงลิงก์ จะยาวแค่ไหนก็ได้
   ═══════════════════════════════════════════════════════════════════ */

/** ต้องตรงกับค่าใน liff-share.js */
const MAIN_LIFF_ID = '1660731301-JRVEEAmW';
const PAGE_LIFF_ID = '';        // ใส่เมื่อสร้าง LIFF แยกให้หน้านี้โดยเฉพาะ

const LIFF_ID = PAGE_LIFF_ID || MAIN_LIFF_ID;

const el = (id) => document.getElementById(id);

let liffReady = false;
let basePayload = null;   // ข้อมูลเอกสารที่ถอดมาจากลิงก์
let forwarderName = '';   // ชื่อผู้ส่งต่อ ใช้กำกับข้อสั่งการที่พิมพ์เพิ่ม
let toastTimer = null;

/* ── แจ้งเตือนสั้น ─────────────────────────────────────────────── */
function toast(message, type = 'success') {
  const box = el('toast');
  el('toast-text').textContent = message;
  el('toast-icon').className = type === 'error'
    ? 'fa-solid fa-circle-exclamation text-seal-400'
    : type === 'info'
      ? 'fa-solid fa-circle-info text-ink-300'
      : 'fa-solid fa-circle-check text-leaf-500';

  box.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.add('hidden'), 3200);
}

/* ── หน้าจอกั้น ────────────────────────────────────────────────── */
function setGate(state, title, message) {
  const root = el('liffGate');
  if (!root) return;

  el('gate-title').textContent = title;
  el('gate-message').textContent = message;
  el('gate-spinner').classList.toggle('hidden', state !== 'loading');

  const isError = state === 'error';
  el('gate-icon').className = isError
    ? 'w-12 h-12 mx-auto rounded-2xl flex items-center justify-center text-xl bg-seal-500/10 text-seal-500'
    : 'hidden w-12 h-12 mx-auto rounded-2xl items-center justify-center text-xl';

  const showLogin = state === 'login';
  el('gate-login-btn').classList.toggle('hidden', !showLogin);
  el('gate-login-btn').classList.toggle('flex', showLogin);

  el('gate-retry-btn').classList.toggle('hidden', !isError);
}

function hideGate() {
  const root = el('liffGate');
  if (!root) return;
  root.style.transition = 'opacity .35s ease';
  root.style.opacity = '0';
  setTimeout(() => root.remove(), 350);
}

/* ── อ่านค่า d จากลิงก์ ────────────────────────────────────────── */

/**
 * เปิดจากแอป LINE จะได้ ?d=... มาตรง ๆ
 * ส่วนเบราว์เซอร์ภายนอก LINE อาจส่งมาในรูป ?liff.state=%2Fshare.html%3Fd%3D...
 * จึงต้องแกะทั้งสองแบบ และต้องอ่านหลัง liff.init() เพราะ SDK จัดการ liff.state ให้ก่อน
 */
function readDocParam() {
  const here = new URL(location.href);
  const direct = here.searchParams.get('d');
  if (direct) return direct;

  const state = here.searchParams.get('liff.state');
  if (!state) return '';

  try {
    const inner = new URL(state, location.origin);
    return inner.searchParams.get('d') || '';
  } catch (err) {
    console.warn('อ่าน liff.state ไม่ได้', err);
    return '';
  }
}

/* ── โปรไฟล์ ───────────────────────────────────────────────────── */
function avatarFallback(name) {
  const letter = FlexDoc.escapeHtml((String(name || '?').trim().charAt(0) || '?').toUpperCase());
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
    '<rect width="64" height="64" rx="32" fill="#1B7A5A"/>' +
    '<text x="32" y="43" text-anchor="middle" font-family="Sarabun,sans-serif" font-size="30" fill="#ffffff">' +
    letter + '</text></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function renderProfile(profile) {
  forwarderName = (profile && profile.displayName) || '';

  const name = forwarderName || 'ผู้ใช้ LINE';
  const img = el('profileAvatarTop');

  img.onerror = () => { img.onerror = null; img.src = avatarFallback(name); };
  img.src = (profile && profile.pictureUrl) || avatarFallback(name);
  img.alt = name;
  el('profileNameTop').textContent = name;

  const wrap = el('topbarProfile');
  wrap.classList.remove('hidden');
  wrap.classList.add('inline-flex');
}

/* ── การ์ดที่จะส่งต่อ ──────────────────────────────────────────── */

/** ข้อมูลเอกสารเดิม บวกข้อสั่งการที่กำลังพิมพ์อยู่ */
function currentPayload() {
  return FlexDoc.withForwardNote(basePayload, el('noteInput').value, forwarderName);
}

function renderCard() {
  // ไม่ส่ง forwardUrl การ์ดใบนี้จึงไม่มีปุ่มส่งต่ออีก จบที่ผู้รับปลายทาง
  el('cardBox').innerHTML = FlexDoc.cardHtml(FlexDoc.modelFrom(currentPayload()), { theme: 'forward' });

  const model = FlexDoc.modelFrom(basePayload);
  if (model.pdfUrl) {
    const link = el('openPdfBtn');
    link.href = model.pdfUrl;
    link.classList.remove('hidden');
    link.classList.add('inline-flex');
  }
}

function updateNoteCount() {
  const length = el('noteInput').value.length;
  el('noteCount').textContent = `${FlexDoc.thaiDigits(length)}/${FlexDoc.thaiDigits(FlexDoc.NOTE_LIMIT)}`;
}

function showCardError(message) {
  el('cardBox').classList.add('hidden');
  el('notePanel').classList.add('hidden');
  el('actionBar').classList.add('hidden');
  el('cardErrorText').textContent = message;
  el('cardError').classList.remove('hidden');
}

function canShare() {
  if (!liffReady) return false;
  try {
    return liff.isApiAvailable('shareTargetPicker');
  } catch (err) {
    return false;
  }
}

/* ── ส่งต่อ ────────────────────────────────────────────────────── */
async function forwardDocument() {
  if (!basePayload) return;

  if (!canShare()) {
    toast('เรียกหน้าต่างเลือกผู้รับไม่ได้ในสภาพแวดล้อมนี้', 'error');
    return;
  }

  const message = FlexDoc.buildFlex(FlexDoc.modelFrom(currentPayload()), { theme: 'forward' });

  try {
    const result = await liff.shareTargetPicker([message], { isMultiple: true });
    if (!result) {
      toast('ยกเลิกการส่งต่อ', 'info');
      return;
    }
    toast('ส่งต่อเอกสารแล้ว');
  } catch (err) {
    console.error('shareTargetPicker ไม่สำเร็จ', err);
    toast(`ส่งต่อไม่สำเร็จ: ${(err && err.message) || err}`, 'error');
  }
}

/* ── เริ่มทำงาน ────────────────────────────────────────────────── */
async function boot() {
  setGate('loading', 'กำลังเชื่อมต่อ LINE', 'กรุณารอสักครู่ ระบบกำลังอ่านข้อมูลการ์ด');

  if (!window.liff) {
    setGate('error', 'โหลดไลบรารีของ LINE ไม่สำเร็จ', 'ตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่');
    return;
  }

  try {
    await liff.init({ liffId: LIFF_ID });
  } catch (err) {
    console.error('liff.init ไม่สำเร็จ', err);
    setGate('error', 'เริ่มต้น LIFF ไม่สำเร็จ',
      `${(err && err.message) || err} · ตรวจ Endpoint URL และ LIFF ID ของหน้านี้`);
    return;
  }

  if (!liff.isLoggedIn()) {
    setGate('login', 'ต้องเข้าสู่ระบบก่อน', 'ส่งต่อเอกสารได้เมื่อยืนยันตัวตนด้วยบัญชี LINE แล้ว');
    try {
      liff.login({ redirectUri: location.href });
    } catch (err) {
      console.warn('พาไปหน้าเข้าสู่ระบบอัตโนมัติไม่ได้ ให้กดปุ่มเอง', err);
    }
    return;
  }

  liffReady = true;

  try {
    renderProfile(await liff.getProfile());
  } catch (err) {
    console.warn('ดึงโปรไฟล์ไม่สำเร็จ', err);
  }

  const param = readDocParam();

  if (!param) {
    hideGate();
    showCardError('ลิงก์นี้ไม่มีข้อมูลเอกสารติดมาด้วย ลองกดปุ่มส่งต่อจากการ์ดในแชทอีกครั้ง');
    return;
  }

  try {
    basePayload = await FlexDoc.decode(param);
  } catch (err) {
    console.error('ถอดรหัสข้อมูลการ์ดไม่สำเร็จ', err);
    hideGate();
    showCardError(`อ่านข้อมูลในลิงก์ไม่ได้ (${(err && err.message) || err})`);
    return;
  }

  el('noteBy').textContent = forwarderName ? `ส่งต่อในนาม ${forwarderName}` : '';
  updateNoteCount();
  renderCard();

  el('notePanel').classList.remove('hidden');
  el('actionBar').classList.remove('hidden');

  if (liff.isInClient && liff.isInClient()) {
    const button = el('closeWindowBtn');
    button.classList.remove('hidden');
    button.classList.add('inline-flex');
  }

  if (!canShare()) {
    const warn = el('forwardWarn');
    warn.textContent = 'อุปกรณ์นี้ยังเรียกหน้าต่างเลือกผู้รับของ LINE ไม่ได้ ลองเปิดลิงก์นี้ในแอป LINE';
    warn.classList.remove('hidden');
  }

  document.title = `ส่งต่อ · ${FlexDoc.cut(FlexDoc.modelFrom(basePayload).subject, 40)}`;
  hideGate();
}

/* ── ผูกปุ่ม ───────────────────────────────────────────────────── */
el('gate-login-btn').addEventListener('click', () => {
  if (window.liff && liff.login) liff.login({ redirectUri: location.href });
});

el('gate-retry-btn').addEventListener('click', () => location.reload());
el('forwardBtn').addEventListener('click', forwardDocument);

el('noteInput').addEventListener('input', () => {
  updateNoteCount();
  renderCard();
});

el('closeWindowBtn').addEventListener('click', () => {
  if (window.liff && liff.closeWindow) liff.closeWindow();
});

boot();
