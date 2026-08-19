/* ═══════════════════════════════════════════════════════════════════
   เข้าใช้งานผ่าน LINE (LIFF) และแชร์เอกสารด้วย Share Target Picker

   ไฟล์นี้ทำสามอย่าง
   ๑) กั้นหน้าเว็บไว้จนกว่า liff.init() และการล็อกอินจะเรียบร้อย
   ๒) ดึงโปรไฟล์ LINE มาแสดงบนหัวเว็บ
   ๓) อัปโหลด PDF ที่ประทับตราแล้วขึ้น Drive แล้วส่งเป็น Flex Message
      พร้อมปุ่มเปิดไฟล์ ปุ่มสิ่งที่ส่งมาด้วย และปุ่มส่งต่อไปหน้า share.html

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

const el = (id) => document.getElementById(id);

let lineProfile = null;
let liffReady = false;
let lastUpload = null;    // { fileId, fileUrl, viewUrl, filename, fingerprint, payload, forwardUrl, trimmed }
let preparing = null;     // งานสร้าง+อัปโหลดไฟล์ที่กำลังทำอยู่ กันกดซ้ำ

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

  const payload = upload
    ? upload.payload
    : FlexDoc.payloadFromForm(data, { school: currentSchool() });

  box.innerHTML = FlexDoc.cardHtml(FlexDoc.modelFrom(payload), {
    forwardUrl: upload ? upload.forwardUrl : ''
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
  showReuploadRow(Boolean(lastUpload));

  renderSharePreview(collectFormData(), null);
  openSheet(el('shareModal'));

  const blocked = shareBlockReason();
  if (blocked) {
    setShareWarning(blocked);
    setShareStatus('error', 'ยังแชร์เข้า LINE ไม่ได้');
    el('doShareBtn').disabled = true;
    return;
  }

  setShareWarning('');
  el('doShareBtn').disabled = false;
  ensureShareFile();
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

async function doShare() {
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
    forwardUrl: upload.forwardUrl
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
  if (e.target.checked) ensureShareFile({ force: true });
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
