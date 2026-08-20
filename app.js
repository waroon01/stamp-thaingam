/* ═══════════════════════════════════════════════════════════════════
   ระบบลงรับหนังสือ · โรงเรียนชุมชนวัดไทยงาม
   ทำงานในเบราว์เซอร์ทั้งหมด ไม่มีเซิร์ฟเวอร์ (เหมาะกับ GitHub Pages)
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

/* ── ค่าคงที่และสถานะ ──────────────────────────────────────────── */
const RENDER_SCALE = 2.0;
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3.0;
const MAX_ATTH_INPUTS = 5;

let pdfDoc = null;
let fabricCanvases = [];
let pageViewports = [];
let pageImages = [];
let currentPage = 1;
let zoomLevel = 1;
let isRendering = false;
let isHighlightDrawing = false;
let scrollTimeout;
let resizeTimer;
let toastTimer;
let lastWindowWidth = window.innerWidth;

/* ── element ที่ใช้บ่อย ────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

const startSection = $('startSection');
const previewSection = $('previewSection');
const receiveDrawer = $('receiveModal');
const receiveBackdrop = $('receiveBackdrop');
const toolPanel = $('toolPanel');
const toolBackdrop = $('toolBackdrop');
const loadingEl = $('loading');
const loadingText = $('loading-text');

const container = $('pdf-container');
const containerWrapper = $('container-warper');
const scrollIndicator = $('scroll-page-indicator');
const pageInput = $('page-input');
const totalPagesEl = $('total-pages');
const zoomPercentEl = $('zoom-percent');

/* ═══════════════════════════════════════════════════════════════════
   ตัวช่วยทั่วไป
   ═══════════════════════════════════════════════════════════════════ */
function toast(message, type = 'success') {
  const box = $('toast');
  const icon = $('toast-icon');
  $('toast-text').textContent = message;

  const styles = {
    success: ['fa-solid fa-circle-check', 'text-leaf-500'],
    error:   ['fa-solid fa-circle-exclamation', 'text-seal-400'],
    info:    ['fa-solid fa-circle-info', 'text-ink-300']
  };
  const [cls, color] = styles[type] || styles.info;
  icon.className = `${cls} ${color}`;

  box.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.add('hidden'), 3200);
}

function showLoading(text) {
  loadingText.textContent = text || 'กำลังประมวลผล...';
  loadingEl.classList.remove('hidden');
  loadingEl.classList.add('flex');
}

function hideLoading() {
  loadingEl.classList.add('hidden');
  loadingEl.classList.remove('flex');
}

function openSheet(el) { el.classList.remove('hidden'); el.classList.add('flex'); }
function closeSheet(el) { el.classList.add('hidden'); el.classList.remove('flex'); }

/** หน้าเอกสารที่กำลังทำงานอยู่ */
function getActiveCanvas() {
  const canvas = fabricCanvases[currentPage - 1];
  if (!canvas) {
    toast('ยังไม่มีเอกสาร เปิดไฟล์ PDF ก่อนนะครับ', 'error');
    return null;
  }
  return canvas;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function loadFabricImage(url) {
  return new Promise((resolve) => fabric.Image.fromURL(url, resolve));
}

/* ═══════════════════════════════════════════════════════════════════
   ตั้งค่าโรงเรียนและผู้บริหาร

   ที่เก็บหลักคือชีต "ตั้งค่าหน่วยงาน" ผ่าน Apps Script ตั้งครั้งเดียว
   ใช้ได้ทุกเครื่อง ส่วน localStorage เป็นเพียงสำเนาไว้ใช้ตอนออฟไลน์
   หรือตอนที่ยังไม่ได้เชื่อมระบบทะเบียน

   ทุกจุดที่แสดงชื่อโรงเรียน ชื่อ ผอ. รอง ผอ. และโลโก้ อ่านจากตัวแปร org
   ═══════════════════════════════════════════════════════════════════ */
const ORG_KEY = 'saraban.orgSettings.v1';

const ORG_DEFAULTS = {
  schoolName: 'โรงเรียนทดสอบวิทยา',
  directorName: 'นางสาวทดสอบ ชอบใจดี',
  directorTitle: 'ผู้อำนวยการ',
  deputyName: 'นายทดสอบ งานดีจัง',
  deputyTitle: 'รองผู้อำนวยการ',
  logoUrl: 'https://res.cloudinary.com/djkbdwnsc/image/upload/v1786978522/next-fullStack/Logo-thaingam_1_k2iec7.png',
  logoOnStamp: false
};

/**
 * ขอภาพขนาดพอดีจาก Cloudinary แทนที่จะปล่อยให้เบราว์เซอร์ย่อภาพต้นฉบับเอง
 *
 * ตราโรงเรียนต้นฉบับสูงราว 2800 px ถ้าเอามาแสดงในกรอบ 44 px ตรง ๆ
 * เบราว์เซอร์จะย่อรวดเดียวจนเส้นบางและตัวอักษรบนแพรแถบแตกเป็นจุด ๆ
 * ส่ง c_fit ไปด้วยเพื่อให้ภาพย่อทั้งใบ ไม่ถูกครอบตัด
 * ลิงก์ที่ไม่ใช่ Cloudinary คืนค่าเดิมไปตามปกติ
 */
function sizedLogoUrl(url, px) {
  if (!/^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(url)) return url;
  return url.replace('/image/upload/', `/image/upload/f_auto,q_auto,c_fit,h_${px},w_${px}/`);
}

let org = { ...ORG_DEFAULTS };
let stampLogoCache = null;      // { url, promise } กันโหลดภาพซ้ำทุกครั้งที่ประทับตรา

function loadOrgSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(ORG_KEY) || 'null');
    if (saved && typeof saved === 'object') org = { ...ORG_DEFAULTS, ...saved };
  } catch (err) {
    console.warn('อ่านค่าตั้งค่าเดิมไม่ได้ ใช้ค่าเริ่มต้นแทน', err);
  }
}

function persistOrgSettings() {
  try {
    localStorage.setItem(ORG_KEY, JSON.stringify(org));
    return true;
  } catch (err) {
    console.warn('บันทึกค่าตั้งค่าลงเครื่องไม่ได้', err);
    return false;
  }
}

/** คัดเฉพาะคีย์ที่รู้จักจากชีต และปรับชนิดข้อมูลให้ตรงกับค่าเริ่มต้น */
function pickOrgFields(values) {
  const picked = {};

  Object.keys(ORG_DEFAULTS).forEach((key) => {
    if (!(key in values)) return;

    if (key === 'logoOnStamp') {
      picked[key] = values[key] === true || String(values[key]).trim().toLowerCase() === 'true';
      return;
    }

    const text = String(values[key] === null || values[key] === undefined ? '' : values[key]).trim();
    // ช่องว่างในชีตแปลว่า "ไม่ตั้ง" เฉพาะกับโลโก้ ส่วนชื่อและตำแหน่งให้คงค่าเดิมไว้
    if (text || key === 'logoUrl') picked[key] = text;
  });

  return picked;
}

/** ดึงค่าจากชีตมาทับค่าในเครื่อง เรียกตอนเปิดหน้าเว็บและตอนกดปุ่มดึงค่า */
async function syncOrgSettingsFromCloud({ silent = true } = {}) {
  if (!cloudEnabled()) {
    if (!silent) toast('ยังไม่ได้เชื่อมระบบทะเบียน ค่าจึงเก็บไว้ในเครื่องนี้', 'info');
    return false;
  }

  try {
    const out = await cloudGet({ action: 'settings' });
    const fields = pickOrgFields(out.settings || {});

    if (!Object.keys(fields).length) {
      if (!silent) toast('ในชีตยังไม่มีค่าที่ตั้งไว้ กดบันทึกเพื่อส่งค่าชุดนี้ขึ้นไป', 'info');
      return false;
    }

    org = { ...ORG_DEFAULTS, ...org, ...fields };
    stampLogoCache = null;
    persistOrgSettings();
    applyOrgSettings();

    if (!silent) {
      fillSettingsForm(org);
      toast('ดึงค่าล่าสุดจากชีตแล้ว');
    }
    return true;
  } catch (err) {
    console.warn('ดึงค่าตั้งค่าจากชีตไม่สำเร็จ ใช้ค่าที่เก็บในเครื่องแทน', err);
    if (!silent) toast(cloudErrorMessage(err), 'error');
    return false;
  }
}

/** ชื่อบนตราลงนามต้องอยู่ในวงเล็บตามรูปแบบหนังสือราชการ */
function nameInParens(name) {
  const text = String(name || '').trim();
  if (!text) return '';
  return /^\(.*\)$/.test(text) ? text : `(${text})`;
}

const directorPosition = () => `${org.directorTitle || ''}${org.schoolName || ''}`.trim();
const deputyPosition   = () => `${org.deputyTitle || ''}${org.schoolName || ''}`.trim();

function setTextIfExists(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

/** เขียนค่าปัจจุบันลงทุกจุดในหน้าเว็บ */
function applyOrgSettings() {
  document.title = `ระบบลงรับหนังสือ · ${org.schoolName}`;
  setTextIfExists('brand-school', org.schoolName);
  setTextIfExists('gate-school', org.schoolName);

  // หัวเว็บและหน้าจอเข้าสู่ระบบใช้โลโก้ชุดเดียวกัน
  ['brand-logo', 'gate-logo'].forEach((id) => {
    const logo = $(id);
    if (!logo) return;

    if (org.logoUrl) {
      // ลิงก์เสียให้ซ่อนไปเลย ดีกว่าโชว์ไอคอนภาพแตกคาหัวเว็บ
      logo.onerror = () => logo.classList.add('hidden');
      logo.onload = () => logo.classList.remove('hidden');
      logo.src = sizedLogoUrl(org.logoUrl, 132);   // กรอบสูง 44 px เผื่อจอความละเอียดสูง 3 เท่า
      logo.classList.remove('hidden');
    } else {
      logo.removeAttribute('src');
      logo.classList.add('hidden');
    }
  });

  setTextIfExists('card-director-name', nameInParens(org.directorName) || '(ยังไม่ได้ตั้งชื่อ)');
  setTextIfExists('card-director-title', org.directorTitle);
  setTextIfExists('card-deputy-name', nameInParens(org.deputyName) || '(ยังไม่ได้ตั้งชื่อ)');
  setTextIfExists('card-deputy-title', org.deputyTitle);
}

/**
 * แปลงโลโก้เป็น data URL ก่อนนำไปวางบนตรายาง
 *
 * ภาพข้ามโดเมนที่ไม่ได้รับอนุญาต (CORS) จะทำให้ canvas ปนเปื้อน
 * แล้วสั่งออก PDF/JPG ไม่ได้ทั้งไฟล์ การแปลงเป็น data URL ตั้งแต่ต้น
 * จึงเป็นทั้งการตรวจสอบและการตัดปัญหาตอนบันทึกงานค้างแล้วเปิดกลับมา
 * คืนค่า null ถ้าใช้ไม่ได้
 */
function loadStampLogoDataUrl(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';

    image.onload = () => {
      try {
        const ratio = Math.min(1, 160 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        console.warn('โลโก้นี้ไม่อนุญาตให้ดึงข้ามเว็บ จึงใช้บนตรายางไม่ได้', err);
        resolve(null);
      }
    };

    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function getStampLogo() {
  if (!org.logoOnStamp || !org.logoUrl) return Promise.resolve(null);
  if (!stampLogoCache || stampLogoCache.url !== org.logoUrl) {
    // ย่อจาก Cloudinary มาที่ 320 px ก่อน แล้วค่อยย่อเหลือ 160 px บน canvas
    // จะได้ไม่ต้องย่อจาก 2800 px รวดเดียวจนตราเบลอ
    stampLogoCache = { url: org.logoUrl, promise: loadStampLogoDataUrl(sizedLogoUrl(org.logoUrl, 320)) };
  }
  return stampLogoCache.promise;
}

/* ── หน้าต่างตั้งค่า ───────────────────────────────────────────── */
function fillSettingsForm(values) {
  $('set-school-name').value = values.schoolName || '';
  $('set-director-name').value = values.directorName || '';
  $('set-director-title').value = values.directorTitle || '';
  $('set-deputy-name').value = values.deputyName || '';
  $('set-deputy-title').value = values.deputyTitle || '';
  $('set-logo-url').value = values.logoUrl || '';
  $('set-logo-on-stamp').checked = !!values.logoOnStamp;
  updateSettingsPreview();
}

function readSettingsForm() {
  return {
    schoolName: $('set-school-name').value.trim() || ORG_DEFAULTS.schoolName,
    directorName: $('set-director-name').value.trim(),
    directorTitle: $('set-director-title').value.trim() || ORG_DEFAULTS.directorTitle,
    deputyName: $('set-deputy-name').value.trim(),
    deputyTitle: $('set-deputy-title').value.trim() || ORG_DEFAULTS.deputyTitle,
    logoUrl: $('set-logo-url').value.trim(),
    logoOnStamp: $('set-logo-on-stamp').checked
  };
}

function updateSettingsPreview() {
  const draft = readSettingsForm();
  setTextIfExists('settings-preview-name', nameInParens(draft.directorName) || '(ยังไม่ได้กรอกชื่อ)');
  setTextIfExists('settings-preview-position', `${draft.directorTitle}${draft.schoolName}`);

  const preview = $('settings-logo-preview');
  if (draft.logoUrl) {
    preview.onerror = () => preview.classList.add('hidden');
    preview.onload = () => preview.classList.remove('hidden');
    const previewSrc = sizedLogoUrl(draft.logoUrl, 144);   // กรอบ 48 px เผื่อจอความละเอียดสูง 3 เท่า
    if (preview.getAttribute('src') !== previewSrc) preview.src = previewSrc;
    preview.classList.remove('hidden');
  } else {
    preview.removeAttribute('src');
    preview.classList.add('hidden');
  }
}

/** บอกให้ชัดว่าค่าที่กรอกจะไปอยู่ที่ไหน ชีตกลางหรือเครื่องนี้เท่านั้น */
function updateSettingsStorageNote() {
  setTextIfExists('settings-storage-note', cloudEnabled()
    ? 'ค่าเหล่านี้เก็บในชีต "ตั้งค่าหน่วยงาน" ทุกเครื่องที่เปิดระบบจะได้ค่าชุดเดียวกัน'
    : 'ยังไม่ได้เชื่อมระบบทะเบียน ค่าจึงเก็บไว้ในเบราว์เซอร์เครื่องนี้เท่านั้น');

  const pull = $('pullSettingsBtn');
  if (pull) pull.classList.toggle('hidden', !cloudEnabled());
}

function openSettings() {
  fillSettingsForm(org);
  updateSettingsStorageNote();
  openSheet($('settingsModal'));
}

$('openSettingsBtn').addEventListener('click', openSettings);
$('openSettingsBtnTool').addEventListener('click', openSettings);
$('closeSettingsModal').addEventListener('click', () => closeSheet($('settingsModal')));
$('cancelSettingsBtn').addEventListener('click', () => closeSheet($('settingsModal')));
$('settingsForm').addEventListener('input', updateSettingsPreview);

$('pullSettingsBtn').addEventListener('click', async () => {
  showLoading('กำลังดึงค่าจากชีต...');
  await syncOrgSettingsFromCloud({ silent: false });
  hideLoading();
});

$('resetSettingsBtn').addEventListener('click', () => {
  fillSettingsForm(ORG_DEFAULTS);
  toast('เติมค่าเริ่มต้นให้แล้ว กดบันทึกเพื่อยืนยัน', 'info');
});

$('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const next = readSettingsForm();

  if (next.logoUrl && !/^https?:\/\//i.test(next.logoUrl)) {
    toast('ลิงก์โลโก้ต้องขึ้นต้นด้วย http:// หรือ https://', 'error');
    return;
  }

  org = { ...ORG_DEFAULTS, ...next };
  stampLogoCache = null;

  // ตรวจโลโก้ก่อน ถ้าดึงข้ามเว็บไม่ได้จะทำให้สั่งออก PDF ไม่ได้ทั้งไฟล์
  let logoBlocked = false;
  if (org.logoOnStamp && org.logoUrl) {
    showLoading('กำลังตรวจสอบภาพโลโก้...');
    const usable = await getStampLogo();
    hideLoading();
    if (!usable) {
      org.logoOnStamp = false;
      stampLogoCache = null;
      $('set-logo-on-stamp').checked = false;
      logoBlocked = true;
    }
  }

  const stored = persistOrgSettings();   // สำเนาในเครื่อง ใช้ต่อได้แม้ชีตล่ม
  applyOrgSettings();

  // ที่เก็บจริงคือชีต ส่งขึ้นไปให้เครื่องอื่นเห็นค่าเดียวกัน
  let cloudError = '';
  if (cloudEnabled()) {
    showLoading('กำลังบันทึกลงชีตตั้งค่า...');
    try {
      const out = await cloudPost('saveSettings', { settings: org });
      const fields = pickOrgFields(out.settings || {});
      if (Object.keys(fields).length) {
        org = { ...ORG_DEFAULTS, ...org, ...fields };
        persistOrgSettings();
        applyOrgSettings();
      }
    } catch (err) {
      console.error(err);
      cloudError = cloudErrorMessage(err);
    } finally {
      hideLoading();
    }
  }

  closeSheet($('settingsModal'));

  if (cloudError) {
    toast(`บันทึกลงชีตไม่สำเร็จ: ${cloudError} (เก็บไว้ในเครื่องนี้แล้ว)`, 'error');
  } else if (logoBlocked) {
    toast('บันทึกแล้ว แต่ภาพนี้ใช้บนตรารับไม่ได้ (เว็บต้นทางไม่อนุญาต CORS)', 'info');
  } else if (!stored && !cloudEnabled()) {
    toast('บันทึกแล้ว แต่จำค่าไว้ในเครื่องไม่ได้ ค่าจะหายเมื่อปิดหน้านี้', 'info');
  } else {
    toast(cloudEnabled() ? 'บันทึกลงชีตตั้งค่าแล้ว' : 'บันทึกการตั้งค่าแล้ว');
  }
});

loadOrgSettings();
applyOrgSettings();

/* ═══════════════════════════════════════════════════════════════════
   แผงเครื่องมือ (บนมือถือเลื่อนขึ้นจากด้านล่าง)
   ═══════════════════════════════════════════════════════════════════ */
function openToolPanel() {
  toolPanel.classList.remove('translate-y-full');
  toolBackdrop.classList.remove('hidden');
}

function closeToolPanel() {
  if (window.innerWidth >= 768) return;   // เดสก์ท็อปแสดงค้างไว้เสมอ
  toolPanel.classList.add('translate-y-full');
  toolBackdrop.classList.add('hidden');
}

$('mobileToolBtn').addEventListener('click', openToolPanel);
$('closeToolPanel').addEventListener('click', closeToolPanel);
toolBackdrop.addEventListener('click', closeToolPanel);

// แตะเครื่องมือบนมือถือแล้วปิดแผงให้เห็นเอกสารทันที
toolPanel.querySelectorAll('button').forEach((btn) => {
  if (['closeToolPanel', 'highlight-text-btn'].includes(btn.id)) return;
  btn.addEventListener('click', () => setTimeout(closeToolPanel, 120));
});

/* ═══════════════════════════════════════════════════════════════════
   เปิดไฟล์ PDF
   ═══════════════════════════════════════════════════════════════════ */
const dropZone = $('dropStampZone');
const fileInput = $('stampFileInput');
const fileLabel = $('stampList');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('border-ink-400', 'bg-ink-50');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('border-ink-400', 'bg-ink-50');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('border-ink-400', 'bg-ink-50');
  handleFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', (e) => {
  handleFile(e.target.files[0]);
  e.target.value = '';
});

$('openImportJsonBtn').addEventListener('click', () => $('import-json').click());

function handleFile(file) {
  if (!file || file.type !== 'application/pdf') {
    if (fileLabel.dataset.pending === '1') delete fileLabel.dataset.pending;
    fileLabel.innerHTML =
      '<p class="text-sm text-seal-500">รองรับเฉพาะไฟล์ PDF เลือกไฟล์ใหม่อีกครั้งนะครับ</p>';
    return;
  }

  // ข้อความชวนเลือกไฟล์ถูกแทนที่ด้วยชื่อไฟล์แล้ว แต่ pendingEdit ยังต้องอยู่ต่อ
  // จนกว่าจะเรนเดอร์เสร็จ จึงปลดแค่ธงบนกล่องข้อความ
  delete fileLabel.dataset.pending;

  fileLabel.innerHTML = `
    <div class="flex items-center gap-3 rounded-xl bg-ink-50 px-4 py-3">
      <i class="fa-solid fa-file-pdf text-seal-500"></i>
      <span class="text-sm text-ink-700 truncate">${file.name}</span>
    </div>`;

  $('doc-title').textContent = file.name.replace(/\.pdf$/i, '');

  const reader = new FileReader();
  reader.onload = function () { loadPDFData(new Uint8Array(this.result)); };
  reader.onerror = () => toast('อ่านไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง', 'error');
  reader.readAsArrayBuffer(file);
}

async function loadPDFData(pdfData) {
  showLoading('กำลังเปิดเอกสาร...');
  try {
    pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;

    startSection.classList.add('hidden');
    previewSection.classList.remove('hidden');

    await renderPDF(pdfDoc);

    if (applyPendingEdit()) {
      toast('ดึงค่าเดิมมาลงฟอร์มแล้ว ประทับตราแล้วกดบันทึกทับรายการเดิมได้เลย');
    } else {
      toast('เปิดเอกสารแล้ว เลือกตรายางจากแผงเครื่องมือได้เลย');
    }
  } catch (err) {
    console.error(err);
    previewSection.classList.add('hidden');
    startSection.classList.remove('hidden');
    clearPendingEdit();
    toast('เปิดไฟล์นี้ไม่ได้ ไฟล์อาจเสียหายหรือมีรหัสผ่าน', 'error');
  } finally {
    hideLoading();
  }
}

$('back-to-upload-btn').addEventListener('click', () => {
  previewSection.classList.add('hidden');
  startSection.classList.remove('hidden');
  closeDrawer();

  // เผื่อเพิ่งบันทึกอะไรไป รายการหน้าแรกจะได้ไม่ค้างของเก่า
  if (cloudEnabled()) loadHomeRegistry();
});

/* ═══════════════════════════════════════════════════════════════════
   เรนเดอร์เอกสาร
   ═══════════════════════════════════════════════════════════════════ */
async function renderPDF(pdf) {
  if (isRendering) return;
  isRendering = true;

  container.innerHTML = '';
  fabricCanvases = [];
  pageViewports = [];
  pageImages = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    showLoading(`กำลังเตรียมหน้า ${pageNum} จาก ${pdf.numPages}`);

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    pageViewports.push({ width: viewport.width, height: viewport.height });

    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = viewport.width;
    renderCanvas.height = viewport.height;
    await page.render({ canvasContext: renderCanvas.getContext('2d'), viewport }).promise;

    const dataURL = renderCanvas.toDataURL('image/png');
    pageImages.push(dataURL);

    const canvas = await buildPageCanvas(pageNum, viewport.width, viewport.height, dataURL);
    fabricCanvases.push(canvas);
  }

  finishPagesSetup(pdf.numPages);
  isRendering = false;
}

/** สร้างกระดาษหนึ่งหน้าพร้อมภาพพื้นหลัง */
async function buildPageCanvas(pageNum, width, height, backgroundDataUrl) {
  const wrapper = document.createElement('div');
  wrapper.className = 'page-wrapper';
  wrapper.id = `page-${pageNum}`;

  const canvasEl = document.createElement('canvas');
  canvasEl.width = width;
  canvasEl.height = height;
  wrapper.appendChild(canvasEl);

  const badge = document.createElement('div');
  badge.className =
    'absolute -top-3 left-3 z-10 rounded-md bg-ink-900 text-white text-[10px] font-mono px-2 py-0.5 shadow';
  badge.textContent = `หน้า ${pageNum}`;
  wrapper.appendChild(badge);

  container.appendChild(wrapper);

  const fabricCanvas = new fabric.Canvas(canvasEl, { selection: true });
  fabricCanvas.setWidth(width);
  fabricCanvas.setHeight(height);

  if (backgroundDataUrl) {
    const bg = await loadFabricImage(backgroundDataUrl);
    bg.set({
      originX: 'left',
      originY: 'top',
      scaleX: width / bg.width,
      scaleY: height / bg.height,
      selectable: false
    });
    fabricCanvas.setBackgroundImage(bg, fabricCanvas.renderAll.bind(fabricCanvas));
  } else {
    fabricCanvas.setBackgroundColor('white', fabricCanvas.renderAll.bind(fabricCanvas));
  }

  // เลือกรูปทรงบนหน้า แล้วให้แผงเครื่องมือโชว์สีของรูปนั้น
  fabricCanvas.on('selection:created', (e) => syncShapeControls(e.selected?.[0]));
  fabricCanvas.on('selection:updated', (e) => syncShapeControls(e.selected?.[0]));

  return fabricCanvas;
}

function finishPagesSetup(numPages) {
  totalPagesEl.textContent = numPages;
  $('doc-pagecount').textContent = numPages;
  pageInput.value = 1;
  pageInput.max = numPages;
  currentPage = 1;
  applyDisplayScale();
}

/**
 * ย่อขยายด้วย CSS อย่างเดียว ไม่ต้องเรนเดอร์ PDF ใหม่
 * ทำให้ซูมลื่นและวัตถุที่วางไว้ไม่หาย
 */
function applyDisplayScale() {
  const available = Math.max(container.clientWidth - 32, 240);

  fabricCanvases.forEach((fabricCanvas, index) => {
    const vp = pageViewports[index];
    if (!vp) return;

    const displayScale = (available / vp.width) * zoomLevel;
    const canvasContainer = fabricCanvas.lowerCanvasEl.closest('.canvas-container');

    if (canvasContainer) {
      canvasContainer.style.transform = `scale(${displayScale})`;
      canvasContainer.style.transformOrigin = 'top left';
    }

    const wrapper = $(`page-${index + 1}`);
    if (wrapper) {
      wrapper.style.width = vp.width * displayScale + 'px';
      wrapper.style.height = vp.height * displayScale + 'px';
    }

    fabricCanvas.calcOffset();
  });

  zoomPercentEl.textContent = `${Math.round(zoomLevel * 100)}%`;
}

$('zoom-in').addEventListener('click', () => {
  zoomLevel = Math.min(ZOOM_MAX, +(zoomLevel + ZOOM_STEP).toFixed(2));
  applyDisplayScale();
});

$('zoom-out').addEventListener('click', () => {
  zoomLevel = Math.max(ZOOM_MIN, +(zoomLevel - ZOOM_STEP).toFixed(2));
  applyDisplayScale();
});

zoomPercentEl.addEventListener('click', () => {
  zoomLevel = 1;
  applyDisplayScale();
});

window.addEventListener('resize', () => {
  if (window.innerWidth === lastWindowWidth) return;
  lastWindowWidth = window.innerWidth;

  // ข้ามจอเล็กไปจอใหญ่ ต้องคืนแผงเครื่องมือให้อยู่กับที่
  if (window.innerWidth >= 768) {
    toolPanel.classList.remove('translate-y-full');
    toolBackdrop.classList.add('hidden');
  } else if (toolBackdrop.classList.contains('hidden')) {
    toolPanel.classList.add('translate-y-full');
  }

  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(applyDisplayScale, 200);
});

/* ═══════════════════════════════════════════════════════════════════
   เปลี่ยนหน้า
   ═══════════════════════════════════════════════════════════════════ */
function scrollToPage(pageNumber) {
  const target = $(`page-${pageNumber}`);
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  currentPage = pageNumber;
  pageInput.value = currentPage;
}

$('prev-page').addEventListener('click', () => {
  if (currentPage > 1) scrollToPage(currentPage - 1);
});

$('next-page').addEventListener('click', () => {
  if (currentPage < fabricCanvases.length) scrollToPage(currentPage + 1);
});

pageInput.addEventListener('change', () => {
  const target = parseInt(pageInput.value, 10);
  if (target >= 1 && target <= fabricCanvases.length) scrollToPage(target);
  else pageInput.value = currentPage;
});

containerWrapper.addEventListener('scroll', () => {
  const middle = containerWrapper.scrollTop + containerWrapper.clientHeight / 2;
  const pages = Array.from(container.children);

  for (let i = 0; i < pages.length; i++) {
    const top = pages[i].offsetTop;
    const bottom = top + pages[i].offsetHeight;

    if (middle >= top && middle < bottom) {
      if (i + 1 !== currentPage) {
        currentPage = i + 1;
        pageInput.value = currentPage;
        scrollIndicator.textContent = `หน้า ${currentPage}`;
        scrollIndicator.classList.remove('hidden');
      }
      break;
    }
  }

  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => scrollIndicator.classList.add('hidden'), 1600);
});

/* ═══════════════════════════════════════════════════════════════════
   ปุ่มคัดลอกวัตถุ
   ═══════════════════════════════════════════════════════════════════ */
fabric.Object.prototype.controls.copyControl = new fabric.Control({
  x: 0.5,
  y: -0.5,
  offsetY: -20,
  cursorStyle: 'pointer',
  mouseUpHandler: function (eventData, transform) {
    const target = transform.target;
    const canvas = target.canvas;
    target.clone((cloned) => {
      cloned.set({ left: target.left + 20, top: target.top + 20, evented: true });
      canvas.add(cloned);
      canvas.setActiveObject(cloned);
      canvas.requestRenderAll();
    });
    return true;
  },
  render: function (ctx, left, top) {
    const size = this.cornerSize;
    ctx.save();
    ctx.fillStyle = '#1B7A5A';
    ctx.beginPath();
    ctx.arc(left, top, size / 2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `${size - 4}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u29C9', left, top);
    ctx.restore();
  },
  cornerSize: 24
});

fabric.Object.prototype.set({
  borderColor: '#2A4787',
  cornerColor: '#2A4787',
  cornerStyle: 'circle',
  cornerSize: 12,
  transparentCorners: false,
  padding: 4
});

/* ═══════════════════════════════════════════════════════════════════
   ลบวัตถุ
   ═══════════════════════════════════════════════════════════════════ */
function deleteActiveObject() {
  const fabricCanvas = fabricCanvases[currentPage - 1];
  if (!fabricCanvas) return;

  const active = fabricCanvas.getActiveObjects();
  if (!active.length) {
    toast('ยังไม่ได้เลือกวัตถุ แตะที่ตราหรือข้อความก่อนนะครับ', 'info');
    return;
  }

  active.forEach((obj) => fabricCanvas.remove(obj));
  fabricCanvas.discardActiveObject();
  fabricCanvas.requestRenderAll();
}

$('delete-object-btn').addEventListener('click', deleteActiveObject);

document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

  if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) {
    const canvas = fabricCanvases[currentPage - 1];
    const active = canvas && canvas.getActiveObject();
    if (active && active.isEditing) return;
    deleteActiveObject();
  }

  if (e.key === 'Escape') {
    stopHighlightDrawing();
    closeDrawer();
    document.querySelectorAll('.modal-backdrop').forEach(closeSheet);
    closeToolPanel();
  }
});

/* ═══════════════════════════════════════════════════════════════════
   ไฮไลท์
   ═══════════════════════════════════════════════════════════════════ */
const highlightBtn = $('highlight-text-btn');
const highlightSettings = $('highlight-settings');
const highlightState = $('highlight-state');
const highlightSizeInput = $('highlight-size');
const highlightSizeValue = $('highlight-size-value');
const highlightColorInput = $('highlight-color');

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function updateHighlightBrush(canvas, color, width) {
  let brush = canvas.freeDrawingBrush;
  if (!brush || !(brush instanceof fabric.PencilBrush)) {
    brush = new fabric.PencilBrush(canvas);
    canvas.freeDrawingBrush = brush;
  }
  brush.color = color;
  brush.width = width;
}

function applyBrushToAllPages(color, width) {
  fabricCanvases.forEach((c) => {
    c.isDrawingMode = true;
    updateHighlightBrush(c, color, width);
  });
}

function startHighlightDrawing(color, width) {
  isHighlightDrawing = true;
  applyBrushToAllPages(color, width);
  highlightSettings.classList.remove('hidden');
  highlightBtn.classList.add('is-active');
  highlightState.textContent = 'เปิด';
  highlightState.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-ink-600 text-white';
}

function stopHighlightDrawing() {
  isHighlightDrawing = false;
  fabricCanvases.forEach((c) => (c.isDrawingMode = false));
  highlightSettings.classList.add('hidden');
  highlightBtn.classList.remove('is-active');
  highlightState.textContent = 'ปิด';
  highlightState.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-desk-200 text-ink-500';
}

highlightBtn.addEventListener('click', () => {
  if (!getActiveCanvas()) return;
  if (isHighlightDrawing) {
    stopHighlightDrawing();
  } else {
    startHighlightDrawing(hexToRgba(highlightColorInput.value, 0.3), parseInt(highlightSizeInput.value, 10));
    toast('ลากนิ้วหรือเมาส์บนเอกสารเพื่อไฮไลท์ · กด Esc เพื่อเลิก', 'info');
  }
});

highlightSizeInput.addEventListener('input', () => {
  highlightSizeValue.textContent = highlightSizeInput.value;
  if (isHighlightDrawing) {
    applyBrushToAllPages(hexToRgba(highlightColorInput.value, 0.3), parseInt(highlightSizeInput.value, 10));
  }
});

highlightColorInput.addEventListener('input', () => {
  if (isHighlightDrawing) {
    applyBrushToAllPages(hexToRgba(highlightColorInput.value, 0.3), parseInt(highlightSizeInput.value, 10));
  }
});

$('highlightgreen-text-btn').addEventListener('click', () => {
  if (!getActiveCanvas()) return;
  if (isHighlightDrawing) {
    stopHighlightDrawing();
  } else {
    startHighlightDrawing('rgba(27, 122, 90, 0.28)', 12);
    highlightColorInput.value = '#1B7A5A';
    toast('ไฮไลท์เขียวพร้อมใช้ · กด Esc เพื่อเลิก', 'info');
  }
});

$('highlightpink-text-btn').addEventListener('click', () => {
  const fabricCanvas = getActiveCanvas();
  if (!fabricCanvas) return;

  const rect = new fabric.Rect({
    left: 100,
    top: 100,
    width: 260,
    height: 34,
    fill: 'rgba(219, 111, 160, 0.28)',
    selectable: true,
    hasControls: true,
    hasBorders: false,
    objectCaching: false
  });

  fabricCanvas.add(rect);
  fabricCanvas.setActiveObject(rect);
  fabricCanvas.requestRenderAll();
});

/* ═══════════════════════════════════════════════════════════════════
   รูปทรงเรขาคณิต

   แทรกสี่เหลี่ยม วงกลม สามเหลี่ยม ลงหน้าที่กำลังเปิดอยู่
   เลือกสีพื้น สีเส้น ความหนาเส้น และความทึบได้

   ปรับค่าได้สองทาง คือปรับก่อนแล้วค่อยกดแทรก
   หรือคลิกรูปที่วางไว้แล้วบนเอกสารแล้วปรับ ค่าจะวิ่งเข้าหากันทั้งสองทาง
   ═══════════════════════════════════════════════════════════════════ */
const SHAPE_TYPES = new Set(['rect', 'circle', 'triangle']);

const shapeBtn = $('shape-btn');
const shapeSettings = $('shape-settings');
const shapeChevron = $('shape-chevron');
const shapeFillInput = $('shape-fill');
const shapeNoFillInput = $('shape-no-fill');
const shapeStrokeInput = $('shape-stroke');
const shapeStrokeWidthInput = $('shape-stroke-width');
const shapeStrokeWidthValue = $('shape-stroke-width-value');
const shapeOpacityInput = $('shape-opacity');
const shapeOpacityValue = $('shape-opacity-value');

/** ค่าที่ตั้งไว้ในแผง ใช้ทั้งตอนแทรกใหม่และตอนแก้รูปที่เลือกอยู่ */
function currentShapeStyle() {
  const noFill = shapeNoFillInput.checked;
  let strokeWidth = parseInt(shapeStrokeWidthInput.value, 10);

  // ไม่ใส่ทั้งสีพื้นและเส้นขอบ จะได้รูปที่มองไม่เห็นและกดเลือกยาก
  if (noFill && !strokeWidth) strokeWidth = 2;

  return {
    fill: noFill ? 'transparent' : shapeFillInput.value,
    stroke: shapeStrokeInput.value,
    strokeWidth,
    opacity: parseInt(shapeOpacityInput.value, 10) / 100
  };
}

/** ระบายสีตัวอย่างบนการ์ดให้ตรงกับค่าที่เลือกไว้ */
function refreshShapePreview() {
  const style = currentShapeStyle();
  shapeSettings.style.setProperty('--shape-fill', style.fill);
  shapeSettings.style.setProperty('--shape-stroke', style.stroke);
  shapeSettings.style.setProperty('--shape-opacity', style.opacity);
}

function addShape(kind) {
  const fabricCanvas = getActiveCanvas();
  if (!fabricCanvas) return;

  // ขนาดเริ่มต้นอิงความกว้างหน้ากระดาษ หน้า A4 หรือหน้าเล็กจะได้สัดส่วนพอกัน
  const unit = Math.max(48, Math.round(fabricCanvas.getWidth() * 0.18));

  const base = {
    ...currentShapeStyle(),
    originX: 'center',
    originY: 'center',
    left: fabricCanvas.getWidth() / 2,
    top: fabricCanvas.getHeight() / 2,
    strokeUniform: true,       // ย่อขยายแล้วเส้นขอบยังหนาเท่าเดิมทุกด้าน
    selectable: true,
    hasControls: true,
    objectCaching: false
  };

  let shape;
  if (kind === 'circle') {
    shape = new fabric.Circle({ ...base, radius: unit / 2 });
  } else if (kind === 'triangle') {
    shape = new fabric.Triangle({ ...base, width: unit * 1.2, height: unit });
  } else {
    shape = new fabric.Rect({ ...base, width: unit * 1.4, height: unit * 0.9 });
  }

  fabricCanvas.add(shape);
  fabricCanvas.setActiveObject(shape);
  fabricCanvas.requestRenderAll();
}

/** ปรับสีแล้วให้รูปที่เลือกอยู่เปลี่ยนตามทันที ไม่ต้องลบแล้วแทรกใหม่ */
function applyShapeStyleToSelection() {
  const fabricCanvas = getActiveCanvas();
  if (!fabricCanvas) return;

  const target = fabricCanvas.getActiveObject();
  if (!target || !SHAPE_TYPES.has(target.type)) return;

  target.set(currentShapeStyle());
  fabricCanvas.requestRenderAll();
}

/** คลิกรูปบนเอกสารแล้วดึงค่าของรูปนั้นกลับขึ้นมาโชว์ในแผง */
function syncShapeControls(target) {
  if (!target || !SHAPE_TYPES.has(target.type)) return;

  const noFill = !target.fill || target.fill === 'transparent';
  shapeNoFillInput.checked = noFill;
  if (!noFill && /^#[0-9a-f]{6}$/i.test(target.fill)) shapeFillInput.value = target.fill;
  if (/^#[0-9a-f]{6}$/i.test(target.stroke || '')) shapeStrokeInput.value = target.stroke;

  shapeStrokeWidthInput.value = Math.min(12, Math.round(target.strokeWidth || 0));
  shapeStrokeWidthValue.textContent = shapeStrokeWidthInput.value;

  shapeOpacityInput.value = Math.max(10, Math.round((target.opacity ?? 1) * 100));
  shapeOpacityValue.textContent = `${shapeOpacityInput.value}%`;

  refreshShapePreview();
}

shapeBtn.addEventListener('click', () => {
  const collapsed = shapeSettings.classList.toggle('hidden');
  shapeBtn.classList.toggle('is-active', !collapsed);
  shapeBtn.setAttribute('aria-expanded', String(!collapsed));
  shapeChevron.classList.toggle('rotate-180', !collapsed);
});

shapeSettings.querySelectorAll('[data-shape]').forEach((btn) => {
  btn.addEventListener('click', () => addShape(btn.dataset.shape));
});

[shapeFillInput, shapeStrokeInput].forEach((input) => {
  input.addEventListener('input', () => {
    refreshShapePreview();
    applyShapeStyleToSelection();
  });
});

shapeNoFillInput.addEventListener('change', () => {
  refreshShapePreview();
  applyShapeStyleToSelection();
});

shapeStrokeWidthInput.addEventListener('input', () => {
  shapeStrokeWidthValue.textContent = shapeStrokeWidthInput.value;
  refreshShapePreview();
  applyShapeStyleToSelection();
});

shapeOpacityInput.addEventListener('input', () => {
  shapeOpacityValue.textContent = `${shapeOpacityInput.value}%`;
  refreshShapePreview();
  applyShapeStyleToSelection();
});

refreshShapePreview();

/* ═══════════════════════════════════════════════════════════════════
   ตัวเลขไทยบนตรายาง

   หนังสือราชการใช้เลขไทย ทุกข้อความที่ประทับลงเอกสารจึงผ่าน stampText()
   ซึ่งแปลงเลขอาราบิกเป็นเลขไทยให้อัตโนมัติ ไม่ต้องจำแปลงทีละจุด
   ═══════════════════════════════════════════════════════════════════ */
const THAI_DIGITS = ['๐', '๑', '๒', '๓', '๔', '๕', '๖', '๗', '๘', '๙'];
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                           'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

// Sarabun มีสัญลักษณ์เลขไทยครบ ต่างจากฟอนต์เริ่มต้นของ canvas ที่อาจแสดงเป็นกล่องว่าง
const STAMP_FONT = 'Sarabun, Tahoma, sans-serif';

function toThaiDigits(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[0-9]/g, (d) => THAI_DIGITS[+d]);
}

/** แปลงค่าจากช่องวันที่ (2026-08-17) เป็น ๑๗ ส.ค. ๒๕๖๙ */
function formatThaiDate(isoDate) {
  if (!isoDate) return '';
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!parts) return toThaiDigits(isoDate);

  const [, year, month, day] = parts;
  const monthName = THAI_MONTHS_SHORT[+month - 1];
  if (!monthName) return toThaiDigits(isoDate);

  return `${toThaiDigits(+day)} ${monthName} ${toThaiDigits(+year + 543)}`;
}

function stampText(text, options = {}) {
  return new fabric.Text(toThaiDigits(text), { fontFamily: STAMP_FONT, ...options });
}

function stampTextbox(text, options = {}) {
  return new fabric.Textbox(toThaiDigits(text), { fontFamily: STAMP_FONT, ...options });
}

/* ═══════════════════════════════════════════════════════════════════
   ตรายาง
   ═══════════════════════════════════════════════════════════════════ */
function signatureBlock(nameLine, positionLine) {
  const gap = 20;
  return [
    stampText(nameLine, { top: 0, left: 0, fontSize: 18, fill: 'blue', originX: 'center' }),
    stampText(positionLine, { top: gap + 15, left: 0, fontSize: 18, fill: 'blue', originX: 'center' }),
    stampText('............/................/.............', {
      top: gap * 2 + 20, left: 0, fontSize: 18, fill: 'blue', originX: 'center'
    })
  ];
}

function addSignatureStamp(nameLine, positionLine) {
  const fabricCanvas = getActiveCanvas();
  if (!fabricCanvas) return;

  if (!nameInParens(nameLine)) {
    toast('ยังไม่ได้ตั้งชื่อผู้ลงนาม เปิดเมนูตั้งค่าก่อนนะครับ', 'error');
    openSettings();
    return;
  }

  const group = new fabric.Group(signatureBlock(nameInParens(nameLine), positionLine), {
    top: 250,
    left: fabricCanvas.getWidth() / 2,
    originX: 'center',
    selectable: true,
    hasControls: true,
    hasBorders: true
  });

  fabricCanvas.add(group);
  fabricCanvas.setActiveObject(group);
  fabricCanvas.requestRenderAll();
  toast('วางตราลงนามแล้ว ลากไปยังตำแหน่งที่ต้องการได้');
}

$('add-director-stamp-btn').addEventListener('click', () =>
  addSignatureStamp(org.directorName, directorPosition()));

$('add-predirector-stamp-btn').addEventListener('click', () =>
  addSignatureStamp(org.deputyName, deputyPosition()));

/** ตราลงรับหนังสือ วางที่มุมขวาบนของหน้า */
async function addReceiveStamp() {
  const fabricCanvas = getActiveCanvas();
  if (!fabricCanvas) return;

  const department = $('department').value;
  const receiveDate = $('receive-date').value;
  const receiveNumber = $('receive-number').value;
  const tick = (name) => (department === name ? '☑' : '☐');

  const gap = 25;
  const boxWidth = 260;

  // สร้างภาพใหม่ทุกครั้ง เพราะวัตถุภาพตัวเดียวกันวางในหลายกลุ่มพร้อมกันไม่ได้
  const logoDataUrl = await getStampLogo();
  const logo = logoDataUrl ? await loadFabricImage(logoDataUrl) : null;
  if (logo) {
    logo.set({ left: 12, top: 14 });
    logo.scaleToHeight(30);
  }

  const titleLeft = logo ? 50 : 16;
  const title = stampText(org.schoolName, { top: 20, left: titleLeft, fontSize: 16, fill: 'blue' });

  // ชื่อโรงเรียนยาวๆ ต้องย่อให้อยู่ในกรอบตรา ไม่ให้ล้นออกไปทับเส้นประ
  const maxTitleWidth = boxWidth - titleLeft - 10;
  if (title.width > maxTitleWidth) title.scale(maxTitleWidth / title.width);

  const line1 = stampText(
    `${tick('ฝ่ายงบประมาณ')} ฝ่ายงบประมาณ   ${tick('ฝ่ายบริหารทั่วไป')} ฝ่ายบริหารทั่วไป`,
    { top: gap + 20, left: 10, fontSize: 14, fill: 'blue' });

  const line2 = stampText(
    `${tick('ฝ่ายวิชาการ')} ฝ่ายวิชาการ         ${tick('ฝ่ายบุคลากร')} ฝ่ายบุคลากร`,
    { top: gap * 2 + 20, left: 10, fontSize: 14, fill: 'blue' });

  const label1 = stampText('เลขที่รับ ', { top: gap * 3 + 20, left: 10, fontSize: 14, fill: 'blue' });
  const value1 = stampText(receiveNumber || '', {
    top: gap * 3 + 20, left: label1.left + label1.width, fontSize: 16, fill: 'blue'
  });
  const underline1 = new fabric.Line([0, 0, boxWidth - value1.left - 10, 0], {
    top: value1.top + value1.height + 2, left: value1.left,
    stroke: 'blue', strokeWidth: 1, strokeDashArray: [2, 3]
  });

  const label2 = stampText('วันที่รับหนังสือ ', { top: gap * 4 + 20, left: 10, fontSize: 14, fill: 'blue' });
  const value2 = stampText(formatThaiDate(receiveDate), {
    top: gap * 4 + 20, left: label2.left + label2.width, fontSize: 16, fill: 'blue'
  });
  const underline2 = new fabric.Line([0, 0, boxWidth - value2.left - 10, 0], {
    top: value2.top + value2.height + 2, left: value2.left,
    stroke: 'blue', strokeWidth: 1, strokeDashArray: [2, 3]
  });

  const stampGroup = new fabric.Group(
    [logo, title, line1, line2, label1, value1, underline1, label2, value2, underline2].filter(Boolean),
    { left: 30, top: 30, selectable: true, hasControls: true, hasBorders: true });

  stampGroup.controls = { ...stampGroup.controls };
  delete stampGroup.controls.copyControl;

  fabricCanvas.add(stampGroup);
  fabricCanvas.setActiveObject(stampGroup);

  stampGroup.setCoords();
  stampGroup.left = Math.max(fabricCanvas.getWidth() - stampGroup.width - 30, 10);
  stampGroup.top = 30;
  stampGroup.setCoords();

  fabricCanvas.requestRenderAll();
  toast(receiveNumber ? 'ประทับตรารับแล้ว' : 'ประทับตรารับแล้ว (ยังไม่ได้กรอกเลขที่รับ)');
}

/** ตราสั่งการ */
function stampCommand() {
  const fabricCanvas = getActiveCanvas();
  if (!fabricCanvas) return;

  const commanded = $('commanded').value;
  const receiveDate = $('receive-date').value;
  const msgCommand = $('msgCommand').value;

  const gap = 20;
  const tick = (label) => (commanded === label ? '☑' : '☐');
  const dots = '..........................................................................';

  const texts = [
    stampText(`เรียน ${org.directorTitle}`, { top: 20, left: 10, fontSize: 14, fill: 'blue', fontWeight: 'bold' }),
    stampText(`${tick('เพื่อทราบ')} เพื่อทราบ`, { top: gap + 20, left: 10, fontSize: 14, fill: 'blue' }),
    stampText(`${tick('แจ้งบุคลากรให้ทราบ')} แจ้งบุคลากรให้ทราบ`, { top: gap * 2 + 20, left: 10, fontSize: 14, fill: 'blue' }),
    stampText(`${tick('เพื่อพิจารณาสั่งการ')} เพื่อพิจารณาสั่งการ`, { top: gap * 3 + 20, left: 10, fontSize: 14, fill: 'blue' }),
    stampTextbox(msgCommand || dots, {
      top: gap * 4 + 20, left: 10, fontSize: 14, fill: 'blue', width: 210, breakWords: true
    }),
    stampTextbox(dots, {
      top: gap * 5 + 20, left: 10, fontSize: 14, fill: 'blue', width: 210, breakWords: true
    }),
    stampText('ลงชื่อผู้รับ ........................................', { top: gap * 6 + 20, left: 10, fontSize: 14, fill: 'blue' }),
    stampText(`ลงวันที่ ${formatThaiDate(receiveDate) || '............................'}`, { top: gap * 7 + 20, left: 10, fontSize: 14, fill: 'blue' })
  ];

  const group = new fabric.Group(texts, {
    left: 100, top: 250, selectable: true, hasControls: true, hasBorders: true
  });

  group.controls = { ...group.controls };
  delete group.controls.copyControl;

  fabricCanvas.add(group);
  fabricCanvas.setActiveObject(group);
  fabricCanvas.requestRenderAll();
  toast('ประทับตราสั่งการแล้ว');
}

/** ตรารับต้องรอโหลดโลโก้ จึงห่อไว้เพื่อไม่ให้ error หลุดเป็น unhandled rejection */
const runReceiveStamp = () => addReceiveStamp().catch((err) => {
  console.error(err);
  hideLoading();
  toast('ประทับตรารับไม่สำเร็จ', 'error');
});

$('add-stamp-btn').addEventListener('click', runReceiveStamp);
$('stamp-command-btn').addEventListener('click', stampCommand);
$('form-stamp-receive-btn').addEventListener('click', runReceiveStamp);
$('form-stamp-command-btn').addEventListener('click', stampCommand);

/* ═══════════════════════════════════════════════════════════════════
   ลายเซ็น
   ═══════════════════════════════════════════════════════════════════ */
const canvasSig = $('signaturePad');
const signaturePad = new SignaturePad(canvasSig, { penColor: '#12203D' });

function resizeSignatureCanvas() {
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const rect = canvasSig.getBoundingClientRect();
  canvasSig.width = rect.width * ratio;
  canvasSig.height = rect.height * ratio;
  canvasSig.getContext('2d').scale(ratio, ratio);
  signaturePad.clear();
}

$('openModalBtn').addEventListener('click', () => {
  if (!getActiveCanvas()) return;
  openSheet($('signatureModal'));
  requestAnimationFrame(resizeSignatureCanvas);
});

$('closeSignatureModal').addEventListener('click', () => closeSheet($('signatureModal')));
$('clearSignature').addEventListener('click', () => signaturePad.clear());

$('saveSignature').addEventListener('click', async () => {
  if (signaturePad.isEmpty()) {
    toast('ยังไม่มีลายเซ็นในกรอบ', 'error');
    return;
  }

  const fabricCanvas = getActiveCanvas();
  if (!fabricCanvas) return;

  const img = await loadFabricImage(signaturePad.toDataURL('image/png'));
  img.set({
    left: 100, top: 100, scaleX: 0.5, scaleY: 0.5,
    selectable: true, hasControls: true, hasBorders: true, objectCaching: false
  });

  fabricCanvas.add(img);
  fabricCanvas.setActiveObject(img);
  fabricCanvas.requestRenderAll();

  closeSheet($('signatureModal'));
  toast('วางลายเซ็นแล้ว');
});

/* ═══════════════════════════════════════════════════════════════════
   ข้อความ
   ═══════════════════════════════════════════════════════════════════ */
const quill = new Quill('#quillEditor', {
  theme: 'snow',
  placeholder: 'พิมพ์ข้อความที่นี่...',
  modules: {
    toolbar: [
      ['bold', 'italic', 'underline', 'strike'],
      [{ color: [] }, { background: [] }],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ align: [] }],
      ['clean']
    ]
  }
});

/* ตัดบรรทัดว่างหัวท้ายที่ Quill ใส่มา ไม่ให้ภาพมีช่องว่างเกินจำเป็น */
function trimEmptyLines(html) {
  const empty = /^(?:<(?:p|div|h[1-6])[^>]*>(?:\s|<br\s*\/?>|&nbsp;)*<\/(?:p|div|h[1-6])>)+/i;
  const emptyEnd = /(?:<(?:p|div|h[1-6])[^>]*>(?:\s|<br\s*\/?>|&nbsp;)*<\/(?:p|div|h[1-6])>)+$/i;
  return html.replace(empty, '').replace(emptyEnd, '').trim();
}

$('openTextModalBtn').addEventListener('click', () => {
  if (!getActiveCanvas()) return;
  openSheet($('textModal'));
  quill.setText('');
});

$('closeTextModal').addEventListener('click', () => closeSheet($('textModal')));

$('insertTextBtn').addEventListener('click', async () => {
  const html = quill.root.innerHTML.trim();
  if (!quill.getText().trim()) {
    toast('ยังไม่มีข้อความ', 'error');
    return;
  }

  const fabricCanvas = getActiveCanvas();
  if (!fabricCanvas) return;

  const renderArea = $('renderArea');
  renderArea.innerHTML = `<div class="ql-editor" style="background:transparent">${trimEmptyLines(html)}</div>`;

  try {
    /* วัดขนาดจริงของข้อความ เพื่อไม่ให้ภาพมีขอบว่างกว้างเกินตัวอักษร */
    const box = renderArea.firstElementChild;
    const rect = box.getBoundingClientRect();
    const shot = await html2canvas(renderArea, {
      backgroundColor: null,
      scale: 2,
      width: Math.ceil(rect.width),
      height: Math.ceil(rect.height)
    });
    const img = await loadFabricImage(shot.toDataURL('image/png'));
    img.set({ left: 100, top: 100, scaleX: 0.5, scaleY: 0.5, selectable: true });

    fabricCanvas.add(img);
    fabricCanvas.setActiveObject(img);
    fabricCanvas.requestRenderAll();

    closeSheet($('textModal'));
    toast('วางข้อความแล้ว');
  } catch (err) {
    console.error(err);
    toast('แปลงข้อความเป็นภาพไม่สำเร็จ', 'error');
  } finally {
    renderArea.innerHTML = '';
  }
});

/* ═══════════════════════════════════════════════════════════════════
   รูปภาพ
   ═══════════════════════════════════════════════════════════════════ */
$('insert-imageF-btn').addEventListener('click', () => {
  const fabricCanvas = getActiveCanvas();
  if (!fabricCanvas) return;

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';

  input.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const img = await loadFabricImage(e.target.result);
      const maxWidth = fabricCanvas.getWidth() / 2;
      if (img.width > maxWidth) img.scale(maxWidth / img.width);
      img.set({ left: 60, top: 60, selectable: true });

      fabricCanvas.add(img);
      fabricCanvas.setActiveObject(img);
      fabricCanvas.requestRenderAll();
      toast('แทรกรูปแล้ว');
    };
    reader.readAsDataURL(file);
  });

  input.click();
});

/* ═══════════════════════════════════════════════════════════════════
   แผงข้อมูลลงรับ
   ═══════════════════════════════════════════════════════════════════ */
function openDrawer() {
  receiveDrawer.classList.remove('translate-x-full');
  receiveBackdrop.classList.remove('hidden');
}

function closeDrawer() {
  receiveDrawer.classList.add('translate-x-full');
  receiveBackdrop.classList.add('hidden');
}

$('openModalBtnFrm').addEventListener('click', openDrawer);
$('closeModalBtnFrm').addEventListener('click', closeDrawer);
receiveBackdrop.addEventListener('click', closeDrawer);

$('add-atth-btn').addEventListener('click', () => {
  const wrap = $('atthContainer');
  if (wrap.querySelectorAll('input[name="atth_a"]').length >= MAX_ATTH_INPUTS) {
    toast(`เพิ่มได้สูงสุด ${MAX_ATTH_INPUTS} ช่อง`, 'info');
    return;
  }
  const div = document.createElement('div');
  div.className = 'flex gap-2';
  div.innerHTML =
    '<input type="text" name="atth_label" placeholder="ชื่อรายการ" class="basis-[38%] shrink-0" />' +
    '<input type="text" name="atth_a" placeholder="https://" class="flex-1 min-w-0" />';
  wrap.appendChild(div);
});

$('remove-atth-btn').addEventListener('click', () => {
  const wrap = $('atthContainer');
  const rows = wrap.querySelectorAll('input[name="atth_a"]');
  if (rows.length > 1) wrap.removeChild(rows[rows.length - 1].parentElement);
});

function collectFormData() {
  // จับคู่ชื่อรายการกับลิงก์ตามลำดับช่อง แล้วตัดแถวที่ยังไม่ได้ใส่ลิงก์ทิ้ง
  const labelInputs = Array.from(document.querySelectorAll('input[name="atth_label"]'));
  const attachments = Array.from(document.querySelectorAll('input[name="atth_a"]'))
    .map((input, index) => ({
      label: (labelInputs[index] ? labelInputs[index].value : '').trim(),
      url: input.value.trim()
    }))
    .filter((item) => item.url);

  const atthUrls = attachments.map((item) => item.url);

  return {
    attachments,
    receiveNumber: $('receive-number').value,
    bookNumber: $('book-number').value,
    fromInp: $('fromInp').value,
    to: $('to').value,
    receiveDate: $('receive-date').value,
    bookDate: $('book-date').value,
    subject: $('subject').value,
    action: $('action').value,
    msgCommand: $('msgCommand').value,
    department: $('department').value,
    commanded: $('commanded').value,
    atth_a: atthUrls,
    atth_labels: attachments.map((item) => item.label),
    savedAt: new Date().toISOString()
  };
}

// เดิมส่งขึ้น Google Sheet และ Drive ตอนนี้บันทึกลงเครื่องแทน
$('receiveForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!fabricCanvases.length) {
    toast('ยังไม่มีเอกสาร', 'error');
    return;
  }

  const data = collectFormData();
  const name = `รับหนังสือ_${data.receiveNumber || timestamp()}`;

  showLoading('กำลังสร้างไฟล์...');
  try {
    const pdf = await buildPdf();
    pdf.save(`${name}.pdf`);
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${name}.json`);
    closeDrawer();
    toast('ดาวน์โหลด PDF และไฟล์ข้อมูลแล้ว');
  } catch (err) {
    console.error(err);
    toast('สร้างไฟล์ไม่สำเร็จ', 'error');
  } finally {
    hideLoading();
  }
});

/* ═══════════════════════════════════════════════════════════════════
   ส่งออก
   ═══════════════════════════════════════════════════════════════════ */
async function buildPdf() {
  const { jsPDF } = window.jspdf;
  let pdf = null;

  for (let i = 0; i < fabricCanvases.length; i++) {
    const fabricCanvas = fabricCanvases[i];
    fabricCanvas.discardActiveObject();
    fabricCanvas.renderAll();

    const dataURL = fabricCanvas.toDataURL({ format: 'jpeg', quality: 0.92 });
    const orientation = fabricCanvas.getWidth() > fabricCanvas.getHeight() ? 'landscape' : 'portrait';

    if (i === 0) pdf = new jsPDF({ orientation, unit: 'px', format: 'a4' });
    else pdf.addPage('a4', orientation);

    const props = pdf.getImageProperties(dataURL);
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const ratio = Math.min(pw / props.width, ph / props.height);
    const w = props.width * ratio;
    const h = props.height * ratio;

    pdf.addImage(dataURL, 'JPEG', (pw - w) / 2, (ph - h) / 2, w, h);
  }

  return pdf;
}

$('export-pdf-btn').addEventListener('click', async () => {
  if (!fabricCanvases.length) return toast('ยังไม่มีเอกสาร', 'error');
  showLoading('กำลังสร้าง PDF...');
  try {
    const pdf = await buildPdf();
    pdf.save(`${$('doc-title').textContent || 'เอกสาร'}_ลงรับ.pdf`);
    toast('ดาวน์โหลด PDF แล้ว');
  } catch (err) {
    console.error(err);
    toast('สร้าง PDF ไม่สำเร็จ', 'error');
  } finally {
    hideLoading();
  }
});

$('print-pdf-btn').addEventListener('click', async () => {
  if (!fabricCanvases.length) return toast('ยังไม่มีเอกสาร', 'error');
  showLoading('กำลังเตรียมไฟล์สำหรับพิมพ์...');
  try {
    const pdf = await buildPdf();
    const url = URL.createObjectURL(pdf.output('blob'));
    const win = window.open(url, '_blank');
    if (!win) toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาต pop-up', 'error');
  } catch (err) {
    console.error(err);
    toast('เตรียมไฟล์พิมพ์ไม่สำเร็จ', 'error');
  } finally {
    hideLoading();
  }
});

$('export-jpg-btn').addEventListener('click', () => {
  if (!fabricCanvases.length) return toast('ยังไม่มีเอกสาร', 'error');

  fabricCanvases.forEach((fabricCanvas, i) => {
    fabricCanvas.discardActiveObject();
    fabricCanvas.renderAll();

    const link = document.createElement('a');
    link.href = fabricCanvas.toDataURL({ format: 'jpeg', quality: 0.95 });
    link.download = `page-${i + 1}.jpg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  });

  toast(`บันทึกรูป ${fabricCanvases.length} หน้าแล้ว`);
});

/* ═══════════════════════════════════════════════════════════════════
   บันทึกงานค้างไว้ / เปิดกลับมาทำต่อ
   ═══════════════════════════════════════════════════════════════════ */
$('export-json').addEventListener('click', () => {
  if (!fabricCanvases.length) return toast('ยังไม่มีเอกสาร', 'error');

  const pages = fabricCanvases.map((canvas, index) => ({
    page: index + 1,
    width: canvas.getWidth(),
    height: canvas.getHeight(),
    title: $('doc-title').textContent,
    backgroundImage: pageImages[index] || null,
    objects: canvas.toJSON().objects || []
  }));

  downloadBlob(new Blob([JSON.stringify(pages)], { type: 'application/json' }),
    `งานค้าง_${timestamp()}.json`);
  toast('บันทึกงานแล้ว เปิดไฟล์นี้เพื่อทำต่อได้');
});

$('import-json').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const pages = JSON.parse(e.target.result);
      if (!Array.isArray(pages) || !pages.length) throw new Error('รูปแบบไม่ถูกต้อง');

      startSection.classList.add('hidden');
      previewSection.classList.remove('hidden');
      $('doc-title').textContent = pages[0].title || file.name.replace(/\.json$/i, '');

      await createCanvasesFromJSON(pages);
      toast('เปิดงานที่บันทึกไว้แล้ว');
    } catch (err) {
      console.error(err);
      toast('ไฟล์นี้ไม่ใช่งานที่บันทึกจากระบบนี้', 'error');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
});

async function createCanvasesFromJSON(pages) {
  showLoading('กำลังเปิดงานที่บันทึกไว้...');

  container.innerHTML = '';
  fabricCanvases = [];
  pageViewports = [];
  pageImages = [];
  pdfDoc = null;

  for (let index = 0; index < pages.length; index++) {
    const data = pages[index];
    const width = data.width || 800;
    const height = data.height || 1131;

    pageViewports.push({ width, height });
    pageImages.push(data.backgroundImage || null);

    const canvas = await buildPageCanvas(index + 1, width, height, data.backgroundImage);
    fabricCanvases.push(canvas);

    // รองรับทั้งไฟล์รูปแบบใหม่ (array) และไฟล์เก่าที่เก็บทั้งก้อน
    const raw = Array.isArray(data.objects) ? data.objects : data.objects?.objects || [];

    await new Promise((resolve) => {
      fabric.util.enlivenObjects(raw, (objects) => {
        objects.forEach((obj) => canvas.add(obj));
        canvas.renderAll();
        resolve();
      });
    });
  }

  finishPagesSetup(pages.length);
  hideLoading();
}

/* ═══════════════════════════════════════════════════════════════════
   อ่าน QR ในเอกสาร

   QR ในหนังสือราชการมักกว้างเพียง 1.5–2 ซม. เมื่อเรนเดอร์ที่ความละเอียด
   ปกติของหน้าจอจะเหลือราว 2 พิกเซลต่อหนึ่งช่องข้อมูล ซึ่งน้อยเกินกว่าที่
   ตัวถอดรหัสจะอ่านออก จึงต้องเรนเดอร์หน้านั้นใหม่ที่ความละเอียดสูงกว่า
   เฉพาะตอนสแกน แล้วลองถอดรหัสหลายระดับการย่อและหลายบริเวณ
   ═══════════════════════════════════════════════════════════════════ */
const QR_SCAN_SCALE = 4.0;   // ~288 dpi สำหรับหน้า A4
const QR_MAX_CODES = 6;

/** ยืดช่วงความสว่างให้ขาวจัดดำจัด ช่วยกรณีเอกสารสแกนมาจาง */
function boostContrast(data) {
  let min = 255, max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const v = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    data[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = Math.max(max - min, 1);
  for (let i = 0; i < data.length; i += 4) {
    const v = ((data[i] - min) * 255 / range) | 0;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
}

function decodeImageData(imageData) {
  boostContrast(imageData.data);
  for (const inversionAttempts of ['dontInvert', 'attemptBoth']) {
    const result = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts });
    if (result && result.data) return result;
  }
  return null;
}

/** ถอดรหัสจาก canvas โดยย่อภาพลงตามอัตราที่กำหนด */
function decodeCanvas(sourceCanvas, factor) {
  const w = Math.max(1, Math.round(sourceCanvas.width * factor));
  const h = Math.max(1, Math.round(sourceCanvas.height * factor));

  let target = sourceCanvas;
  if (factor !== 1) {
    target = document.createElement('canvas');
    target.width = w;
    target.height = h;
    const tctx = target.getContext('2d', { willReadFrequently: true });
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(sourceCanvas, 0, 0, w, h);
  }

  const ctx = target.getContext('2d', { willReadFrequently: true });
  return decodeImageData(ctx.getImageData(0, 0, w, h));
}

/** ถอดรหัสจากบางส่วนของภาพ ช่วยกรณี QR เล็กมากเทียบกับทั้งหน้า */
function decodeRegion(sourceCanvas, x, y, w, h) {
  const tile = document.createElement('canvas');
  tile.width = w;
  tile.height = h;
  const ctx = tile.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(sourceCanvas, x, y, w, h, 0, 0, w, h);
  return decodeImageData(ctx.getImageData(0, 0, w, h));
}

function boundsOf(location, factor) {
  const xs = [location.topLeftCorner.x, location.topRightCorner.x,
              location.bottomLeftCorner.x, location.bottomRightCorner.x];
  const ys = [location.topLeftCorner.y, location.topRightCorner.y,
              location.bottomLeftCorner.y, location.bottomRightCorner.y];
  return {
    x: Math.min(...xs) / factor,
    y: Math.min(...ys) / factor,
    w: (Math.max(...xs) - Math.min(...xs)) / factor,
    h: (Math.max(...ys) - Math.min(...ys)) / factor
  };
}

/** สแกนหา QR ทุกตัวใน canvas หนึ่งหน้า */
function scanCanvasForQR(canvas) {
  const found = [];
  const seen = new Set();
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  for (let pass = 0; pass < QR_MAX_CODES; pass++) {
    let hit = null;
    let usedFactor = 1;

    // รอบแรกไล่ให้ครบทุกระดับ รอบถัดไปใช้เฉพาะระดับที่เร็วเพื่อไม่ให้ช้าเกินไป
    const factors = pass === 0 ? [0.5, 1, 0.75, 0.35] : [0.5, 1];

    for (const factor of factors) {
      const result = decodeCanvas(canvas, factor);
      if (result) { hit = result; usedFactor = factor; break; }
    }
    if (!hit) break;

    if (!seen.has(hit.data)) {
      seen.add(hit.data);
      found.push(hit.data);
    }

    // ลบบริเวณที่อ่านได้แล้วออก เพื่อให้รอบถัดไปเจอ QR ตัวอื่น
    const b = boundsOf(hit.location, usedFactor);
    if (!(b.w > 0 && b.h > 0)) break;
    ctx.fillStyle = '#fff';
    ctx.fillRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
  }

  // ยังไม่เจอเลย ลองแบ่งเป็น 9 ส่วนซ้อนทับกัน
  if (!found.length) {
    const cols = 3, rows = 3, overlap = 0.25;
    const tw = Math.ceil((canvas.width / cols) * (1 + overlap));
    const th = Math.ceil((canvas.height / rows) * (1 + overlap));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = Math.floor((c * canvas.width) / cols);
        const y = Math.floor((r * canvas.height) / rows);
        const result = decodeRegion(canvas, x, y, Math.min(tw, canvas.width - x), Math.min(th, canvas.height - y));
        if (result && result.data && !seen.has(result.data)) {
          seen.add(result.data);
          found.push(result.data);
        }
      }
    }
  }

  return found;
}

/** เตรียมภาพหน้าที่ต้องการสแกนด้วยความละเอียดสูงสุดเท่าที่ทำได้ */
async function buildScanCanvas(pageIndex) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (pdfDoc) {
    const page = await pdfDoc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: QR_SCAN_SCALE });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  }

  // เปิดงานจากไฟล์ที่บันทึกไว้ ใช้ภาพเท่าที่มี
  const src = pageImages[pageIndex];
  if (!src) return null;

  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });

  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);
  return canvas;
}

function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

$('detect-qr-btn').addEventListener('click', async () => {
  if (!fabricCanvases.length) return toast('ยังไม่มีเอกสาร', 'error');

  const results = $('qrResults');
  results.innerHTML = '';
  let total = 0;

  showLoading('กำลังค้นหา QR...');

  try {
    for (let i = 0; i < fabricCanvases.length; i++) {
      showLoading(`กำลังค้นหา QR หน้า ${i + 1} จาก ${fabricCanvases.length}`);
      await new Promise((r) => setTimeout(r, 0));   // ให้หน้าจออัปเดตข้อความก่อน

      const scanCanvas = await buildScanCanvas(i);
      if (!scanCanvas) continue;

      const codes = scanCanvasForQR(scanCanvas);
      releaseCanvas(scanCanvas);

      codes.forEach((code) => {
        total++;
        results.appendChild(buildQRResultRow(code, i + 1));
      });
    }

    if (!total) {
      results.innerHTML = `
        <p class="text-sm text-ink-500">ไม่พบ QR Code ในเอกสารนี้</p>
        <p class="text-xs text-ink-400 mt-2 leading-relaxed">
          หาก QR ในเอกสารเล็กหรือจางมาก อาจอ่านไม่ออก
          ลองใช้ไฟล์ PDF ต้นฉบับที่ยังไม่ผ่านการสแกนหรือบีบอัด
        </p>`;
    }

    openSheet($('qrModal'));
    if (total) toast(`พบ QR ${total} รายการ`);
  } catch (err) {
    console.error(err);
    toast('ค้นหา QR ไม่สำเร็จ', 'error');
  } finally {
    hideLoading();
  }
});

function buildQRResultRow(code, pageNo) {
  const isUrl = /^https?:\/\//i.test(code);

  const row = document.createElement('div');
  row.className = 'rounded-xl border border-desk-300 px-3 py-2.5 hover:border-ink-300 transition-colors';
  row.innerHTML = `
    <div class="flex items-start gap-3">
      <i class="fa-solid fa-qrcode text-ink-400 mt-1"></i>
      <div class="min-w-0 flex-1">
        <span class="block text-[11px] font-mono text-ink-400">หน้า ${pageNo}</span>
        <span class="block text-sm text-ink-700 break-all mt-0.5"></span>
        <div class="flex gap-3 mt-2">
          ${isUrl ? '<a class="text-xs font-medium text-ink-600 hover:text-ink-900" target="_blank" rel="noopener noreferrer">เปิดลิงก์</a>' : ''}
          <button class="text-xs font-medium text-ink-600 hover:text-ink-900" type="button">คัดลอก</button>
        </div>
      </div>
    </div>`;

  row.querySelector('span.text-sm').textContent = code;

  const link = row.querySelector('a');
  if (link) link.href = code;

  row.querySelector('button').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast('คัดลอกแล้ว');
    } catch {
      toast('เบราว์เซอร์ไม่อนุญาตให้คัดลอก', 'error');
    }
  });

  return row;
}

$('closeQrModal').addEventListener('click', () => closeSheet($('qrModal')));

document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeSheet(backdrop);
  });
});

/* ═══════════════════════════════════════════════════════════════════
   สแกนหัวเรื่องจากหน้าแรก
   ═══════════════════════════════════════════════════════════════════ */
$('ocr-button').addEventListener('click', async () => {
  const button = $('ocr-button');
  const original = button.innerHTML;
  const source = pageImages[0];

  if (!source) {
    toast('ยังไม่มีหน้าเอกสารให้สแกน', 'error');
    return;
  }

  button.disabled = true;
  button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังสแกน อาจใช้เวลาสักครู่...';

  try {
    const { data: { text } } = await Tesseract.recognize(source, 'tha');
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    let subject = '';

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/เรื่อง\s*[:\-]?\s*(.+)/);
      if (match && match[1]) {
        subject = match[1].trim();
        const next = lines[i + 1];
        if (next && !next.startsWith('เรียน')) subject += ' ' + next.trim();
        break;
      }
    }

    if (subject) {
      $('subject').value = subject;
      toast('สแกนหัวเรื่องได้แล้ว ตรวจทานอีกครั้งนะครับ');
    } else {
      toast('ไม่พบคำว่า "เรื่อง" ในหน้าแรก กรุณาพิมพ์เอง', 'info');
    }
  } catch (err) {
    console.error(err);
    toast('สแกนไม่สำเร็จ กรุณาพิมพ์หัวเรื่องเอง', 'error');
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
});

/* ═══════════════════════════════════════════════════════════════════
   เชื่อมต่อระบบทะเบียน (Google Sheet + Google Drive)

   ตั้งค่าสองบรรทัดข้างล่างให้ตรงกับ Web App ที่ deploy จาก Code.gs
   ถ้าเว้นว่างไว้ ปุ่มที่เกี่ยวกับระบบทะเบียนจะถูกซ่อน และโปรแกรมยังใช้
   บันทึกลงเครื่องได้เหมือนเดิมทุกอย่าง
   ═══════════════════════════════════════════════════════════════════ */
const CLOUD = {
  webAppUrl: 'https://script.google.com/macros/s/AKfycbyzowR_RBRXb8XT0GKVaBg8pXwmHwDOTHpm4dLZfefzJhHgewbTFaqJCyaGKKTASveI/exec',                 // ← วาง URL ที่ลงท้ายด้วย /exec
  apiKey: 'thaigham-2569-x8k2m9'     // ← ต้องตรงกับ API_KEY ใน Code.gs
};

const cloudEnabled = () => /^https:\/\/script\.google\.com\/.+\/exec$/.test(CLOUD.webAppUrl.trim());

/**
 * ส่งข้อมูลด้วย Content-Type แบบ text/plain โดยตั้งใจ
 * เพราะ Apps Script ไม่ตอบ preflight ของ CORS ถ้าใช้ application/json
 * คำขอจะถูกบล็อกก่อนถึงเซิร์ฟเวอร์
 */
async function cloudPost(action, payload = {}) {
  const res = await fetch(CLOUD.webAppUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, apiKey: CLOUD.apiKey, ...payload })
  });

  const out = await res.json();
  if (!out.ok) throw new Error(out.error || 'ระบบปลายทางแจ้งข้อผิดพลาด');
  return out;
}

async function cloudGet(params = {}) {
  const url = new URL(CLOUD.webAppUrl);
  Object.entries({ apiKey: CLOUD.apiKey, ...params })
    .forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString());
  const out = await res.json();
  if (!out.ok) throw new Error(out.error || 'ระบบปลายทางแจ้งข้อผิดพลาด');
  return out;
}

/* ═══════════════════════════════════════════════════════════════════
   แก้ไขรายการที่เคยลงทะเบียนไว้

   ชีตเก็บแต่ "ค่าที่กรอกในฟอร์ม" กับลิงก์ไฟล์ PDF ไม่ได้เก็บตัวเอกสาร
   ที่ขยับตราได้ ปุ่มแก้ไขจึงดึงค่ากลับมาลงฟอร์มให้ แล้วให้ผู้ใช้เปิดไฟล์
   PDF ต้นฉบับมาประทับใหม่ พอกดบันทึกจะทับแถวเดิมในชีตด้วย docId
   ไม่ใช่เพิ่มแถวใหม่
   ═══════════════════════════════════════════════════════════════════ */

/** เอกสารที่กำลังแก้ไขอยู่ตอนนี้ null = กำลังลงรับฉบับใหม่ */
let editingDoc = null;

/** เอกสารที่ดึงค่ามาแล้วแต่ยังรอผู้ใช้เลือกไฟล์ PDF */
let pendingEdit = null;

/** เติมค่าจากชีตกลับลงฟอร์มทุกช่อง รวมถึงสร้างช่องสิ่งที่ส่งมาด้วยใหม่ให้พอดี */
function applyFormData(data = {}) {
  const set = (id, value) => { $(id).value = value == null ? '' : String(value); };

  set('receive-number', data.receiveNumber);
  set('receive-date', data.receiveDate);
  set('book-number', data.bookNumber);
  set('book-date', data.bookDate);
  set('fromInp', data.fromInp);
  set('to', data.to);
  set('subject', data.subject);
  set('action', data.action);
  set('msgCommand', data.msgCommand);

  // ฝ่ายกับการสั่งการเป็น select ถ้าค่าเดิมไม่มีในตัวเลือก ต้องเพิ่มเข้าไปเอง
  // ไม่อย่างนั้นเบราว์เซอร์จะเด้งกลับไปตัวเลือกแรกแบบเงียบ ๆ แล้วค่าเดิมหาย
  selectOrAddOption('department', data.department);
  selectOrAddOption('commanded', data.commanded);

  applyAttachments(data.attachments || []);
}

function selectOrAddOption(id, value) {
  const select = $(id);
  const text = value == null ? '' : String(value);

  if (text && !Array.from(select.options).some((o) => o.value === text)) {
    select.add(new Option(text, text));
  }
  select.value = text;
}

/** สร้างช่องสิ่งที่ส่งมาด้วยให้ครบตามจำนวนรายการเดิม อย่างน้อยหนึ่งช่องเสมอ */
function applyAttachments(items) {
  const wrap = $('atthContainer');
  const list = items.slice(0, MAX_ATTH_INPUTS);

  wrap.innerHTML = '';
  const rows = Math.max(list.length, 1);

  for (let i = 0; i < rows; i++) {
    const item = list[i] || { label: '', url: '' };
    const div = document.createElement('div');
    div.className = 'flex gap-2';
    div.innerHTML =
      '<input type="text" name="atth_label" placeholder="ชื่อรายการ" class="basis-[38%] shrink-0" />' +
      '<input type="text" name="atth_a" placeholder="https://" class="flex-1 min-w-0" />';
    div.querySelector('input[name="atth_label"]').value = item.label || '';
    div.querySelector('input[name="atth_a"]').value = item.url || '';
    wrap.appendChild(div);
  }

  if (items.length > MAX_ATTH_INPUTS) {
    toast(`สิ่งที่ส่งมาด้วยมี ${items.length} รายการ แสดงได้ ${MAX_ATTH_INPUTS} รายการแรก`, 'info');
  }
}

function enterEditMode(doc) {
  editingDoc = doc;

  const label = doc.data.receiveNumber
    ? `เลขที่รับ ${toThaiDigits(doc.data.receiveNumber)}`
    : (doc.data.subject || 'รายการเดิม');

  $('editBannerLabel').textContent = label;
  $('editBanner').classList.remove('hidden');
  $('cloud-save-btn').innerHTML =
    '<i class="fa-solid fa-cloud-arrow-up"></i> บันทึกทับรายการเดิม';
}

function exitEditMode() {
  editingDoc = null;
  $('editBanner').classList.add('hidden');
  $('cloud-save-btn').innerHTML =
    '<i class="fa-solid fa-cloud-arrow-up"></i> บันทึกลงทะเบียน';
}

/** ยกเลิกสถานะ "รอเลือกไฟล์" แล้วเก็บข้อความชวนเลือกไฟล์ออกจากหน้าแรก */
function clearPendingEdit() {
  pendingEdit = null;
  if (fileLabel.dataset.pending === '1') {
    fileLabel.innerHTML = '';
    delete fileLabel.dataset.pending;
  }
}

/** กดปุ่มแก้ไขจากรายการทะเบียน */
async function beginEdit(docId) {
  let doc;

  showLoading('กำลังดึงข้อมูลเดิม...');
  try {
    doc = (await cloudGet({ action: 'document', docId })).doc;
  } catch (err) {
    console.error(err);
    toast(cloudErrorMessage(err), 'error');
    return;
  } finally {
    hideLoading();
  }

  closeSheet($('registryModal'));

  // มีเอกสารเปิดค้างอยู่แล้ว ถามก่อนว่าจะประทับบนฉบับนี้ต่อหรือเปิดไฟล์ใหม่
  if (fabricCanvases.length) {
    const useOpen = confirm(
      'มีเอกสารเปิดค้างอยู่ในหน้าทำงาน\n\n' +
      'ตกลง = ใช้เอกสารที่เปิดอยู่ แล้วเติมค่าเดิมลงฟอร์ม\n' +
      'ยกเลิก = เลือกไฟล์ PDF ของหนังสือฉบับนี้ใหม่'
    );

    if (useOpen) {
      clearPendingEdit();
      startSection.classList.add('hidden');
      previewSection.classList.remove('hidden');
      applyFormData(doc.data);
      enterEditMode(doc);
      openDrawer();
      toast('ดึงค่าเดิมมาลงฟอร์มแล้ว');
      return;
    }
  }

  pendingEdit = doc;
  fileLabel.dataset.pending = '1';
  fileLabel.innerHTML = `
    <div class="flex items-start gap-3 rounded-xl border border-seal-500/30 bg-seal-500/5 px-4 py-3">
      <i class="fa-solid fa-pen-to-square text-seal-500 mt-0.5"></i>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-ink-900">
          กำลังแก้ไข ${doc.data.receiveNumber ? `เลขที่รับ ${toThaiDigits(doc.data.receiveNumber)}` : 'รายการเดิม'}
        </p>
        <p class="text-xs text-ink-500 mt-0.5 truncate">${escapeHtml(doc.data.subject) || '(ไม่ระบุเรื่อง)'}</p>
        <p class="text-xs text-ink-500 mt-1">เลือกไฟล์ PDF ของหนังสือฉบับนี้ แล้วระบบจะเติมค่าเดิมให้</p>
      </div>
      <button type="button" id="cancelPendingEditBtn"
              class="shrink-0 text-xs font-medium text-seal-500 hover:text-seal-600">ยกเลิก</button>
    </div>`;

  $('cancelPendingEditBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    clearPendingEdit();
    toast('ยกเลิกการแก้ไขแล้ว', 'info');
  });

  dropZone.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // เบราว์เซอร์บางตัวไม่ยอมให้เปิดกล่องเลือกไฟล์หลังรอผลจากเซิร์ฟเวอร์
  // เพราะถือว่าหลุดจากการกดของผู้ใช้แล้ว ถ้าถูกบล็อกก็ยังกดที่กล่องลากไฟล์ได้เอง
  fileInput.click();
}

/** เรียกหลังเรนเดอร์ PDF เสร็จ คืนค่า true ถ้าไฟล์นี้เปิดมาเพื่อแก้ไขรายการเดิม */
function applyPendingEdit() {
  if (!pendingEdit) return false;

  const doc = pendingEdit;
  clearPendingEdit();

  applyFormData(doc.data);
  enterEditMode(doc);
  openDrawer();
  return true;
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ── รายการทะเบียน ─────────────────────────────────────────── */

/** วาดรายการทะเบียนหนึ่งชุด ใช้ร่วมกันทั้งหน้าแรกและกล่องในหน้าทำงาน */
function renderRegistryRows(rows, target) {
  target.innerHTML = '';

  rows.forEach((row) => {
    const item = document.createElement('div');
    item.className = 'rounded-xl border border-desk-300 px-4 py-3 hover:border-ink-300 transition-colors';
    item.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="font-mono text-xs text-ink-500">
            เลขที่รับ ${toThaiDigits(row.receiveNumber) || '-'} · รับเมื่อ ${formatThaiDate(row.receiveDate) || '-'}
          </p>
          <p class="text-sm text-ink-900 font-medium mt-0.5 truncate">${escapeHtml(row.subject) || '(ไม่ระบุเรื่อง)'}</p>
          <p class="text-xs text-ink-500 mt-0.5 truncate">จาก ${escapeHtml(row.from) || '-'} · ${escapeHtml(row.department) || '-'}</p>
        </div>
        <div class="shrink-0 flex items-center gap-1">
          ${row.fileUrl ? `<a href="${escapeHtml(row.fileUrl)}" target="_blank" rel="noopener noreferrer"
              class="w-8 h-8 rounded-lg inline-flex items-center justify-center text-ink-500 hover:bg-ink-50 hover:text-ink-900"
              title="เปิดไฟล์ PDF"><i class="fa-solid fa-file-pdf"></i></a>` : ''}
          ${row.docId ? `<button type="button" data-edit-doc="${escapeHtml(row.docId)}"
              class="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium
                     text-ink-700 hover:bg-ink-50 hover:border-ink-300 transition-colors">
              <i class="fa-solid fa-pen-to-square text-[11px]"></i> แก้ไข</button>` : ''}
        </div>
      </div>`;
    target.appendChild(item);
  });
}

/** คลิกปุ่มแก้ไขในรายการ ผูกครั้งเดียวที่ตัวคอนเทนเนอร์ ไม่ต้องผูกทีละปุ่ม */
function bindRegistryEditClicks(target) {
  target.addEventListener('click', (e) => {
    const button = e.target.closest('[data-edit-doc]');
    if (button) beginEdit(button.dataset.editDoc);
  });
}

/** โหลดทะเบียนล่าสุดมาแสดงที่หน้าแรก */
async function loadHomeRegistry() {
  const list = $('homeRegistryList');
  const refresh = $('homeRegistryRefresh');

  list.innerHTML = '<p class="text-sm text-ink-500">กำลังโหลด...</p>';
  refresh.disabled = true;

  try {
    const out = await cloudGet({ action: 'list', limit: 20 });

    if (!out.rows.length) {
      list.innerHTML = '<p class="text-sm text-ink-500">ยังไม่มีรายการในทะเบียน</p>';
      return;
    }
    renderRegistryRows(out.rows, list);
  } catch (err) {
    console.error(err);
    list.innerHTML = `<p class="text-sm text-seal-500">${escapeHtml(cloudErrorMessage(err))}</p>`;
  } finally {
    refresh.disabled = false;
  }
}

function pdfToBase64(pdf) {
  return pdf.output('datauristring').split(',')[1];
}

function cloudErrorMessage(err) {
  const msg = String(err && err.message ? err.message : err);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return 'ติดต่อระบบทะเบียนไม่ได้ ตรวจ URL และการ deploy (ต้องเป็น Anyone)';
  }
  if (/Unexpected token|JSON/i.test(msg)) {
    return 'ระบบทะเบียนตอบกลับไม่ถูกรูปแบบ ลอง deploy เวอร์ชันใหม่อีกครั้ง';
  }
  return msg;
}

/** บันทึกเอกสารขึ้น Drive และลงทะเบียนในชีต */
async function saveToCloud({ saveToSheet }) {
  if (!fabricCanvases.length) return toast('ยังไม่มีเอกสาร', 'error');

  const data = collectFormData();

  if (saveToSheet && !data.receiveNumber.trim()) {
    toast('กรอกเลขทะเบียนรับก่อนบันทึกลงทะเบียน', 'error');
    openDrawer();
    $('receive-number').focus();
    return;
  }

  // เตือนถ้าเลขนี้มีในทะเบียนแล้ว แต่ยังให้ตัดสินใจเองได้
  if (saveToSheet) {
    try {
      showLoading('กำลังตรวจเลขทะเบียน...');
      const dup = await cloudGet({
        action: 'check',
        receiveNumber: data.receiveNumber,
        excludeDocId: editingDoc ? editingDoc.docId : ''
      });
      hideLoading();
      if (dup.exists && !confirm(`เลขที่รับ ${data.receiveNumber} มีอยู่แล้วในทะเบียน (เรื่อง: ${dup.subject || '-'})\n\nต้องการบันทึกเพิ่มอีกรายการหรือไม่?`)) {
        return;
      }
    } catch (err) {
      hideLoading();
      console.warn('ตรวจเลขซ้ำไม่สำเร็จ ข้ามขั้นตอนนี้', err);
    }
  }

  const baseName = data.receiveNumber
    ? `รับ ${data.receiveNumber} ${data.subject || ''}`.trim()
    : `เอกสาร_${timestamp()}`;

  showLoading('กำลังสร้างไฟล์ PDF...');

  try {
    const pdf = await buildPdf();
    const pdfBase64 = pdfToBase64(pdf);

    showLoading(saveToSheet ? 'กำลังบันทึกลงทะเบียนและ Drive...' : 'กำลังอัปโหลดขึ้น Drive...');

    const out = await cloudPost('saveDocument', {
      data,
      saveToSheet,
      pdfBase64,
      filename: `${baseName}.pdf`.replace(/[\\/:*?"<>|]/g, '-'),
      // ส่ง docId เฉพาะรอบที่ลงทะเบียนจริง ปุ่ม "อัปโหลดขึ้น Drive" อย่างเดียว
      // ไม่ควรไปแตะแถวเดิมในชีต
      docId: saveToSheet && editingDoc ? editingDoc.docId : ''
    });

    toast(out.updated ? 'แก้ไขรายการเดิมแล้ว'
      : (saveToSheet ? 'บันทึกลงทะเบียนและ Drive แล้ว' : 'อัปโหลดขึ้น Drive แล้ว'));

    if (out.updated) {
      exitEditMode();
      if (!startSection.classList.contains('hidden')) loadHomeRegistry();
    }

    if (out.fileUrl) showCloudResult(out, saveToSheet);
  } catch (err) {
    console.error(err);
    toast(cloudErrorMessage(err), 'error');
  } finally {
    hideLoading();
  }
}

/** แสดงผลลัพธ์พร้อมลิงก์ไฟล์ เพราะการเปิดแท็บอัตโนมัติมักถูกบล็อก */
function showCloudResult(out, savedToSheet) {
  const results = $('registryList');
  results.innerHTML = `
    <div class="rounded-xl border border-leaf-500/40 bg-leaf-500/5 px-4 py-3">
      <p class="text-sm font-medium text-ink-900">
        ${out.updated ? 'แก้ไขรายการเดิมเรียบร้อย'
          : (savedToSheet ? 'บันทึกลงทะเบียนเรียบร้อย' : 'อัปโหลดไฟล์เรียบร้อย')}
      </p>
      ${savedToSheet && out.row ? `<p class="text-xs text-ink-500 mt-1 font-mono">บันทึกที่แถว ${out.row} ของชีต</p>` : ''}
      <a href="${out.fileUrl}" target="_blank" rel="noopener noreferrer"
         class="inline-flex items-center gap-2 text-sm font-medium text-ink-600 hover:text-ink-900 mt-2">
        <i class="fab fa-google-drive"></i> เปิดไฟล์ใน Google Drive
      </a>
    </div>`;
  openSheet($('registryModal'));
}

/** ขอเลขทะเบียนถัดไปจากชีต */
async function fetchNextReceiveNumber() {
  const button = $('next-number-btn');
  button.disabled = true;

  try {
    const out = await cloudGet({ action: 'nextNumber' });
    $('receive-number').value = out.number;
    toast(`ได้เลขทะเบียนถัดไป: ${out.number}`);
  } catch (err) {
    console.error(err);
    toast(cloudErrorMessage(err), 'error');
  } finally {
    button.disabled = false;
  }
}

/** ดูรายการที่ลงรับไว้แล้ว (กล่องในหน้าทำงาน) */
async function showRegistry() {
  const list = $('registryList');
  list.innerHTML = '<p class="text-sm text-ink-500">กำลังโหลด...</p>';
  openSheet($('registryModal'));

  try {
    const out = await cloudGet({ action: 'list', limit: 20 });

    if (!out.rows.length) {
      list.innerHTML = '<p class="text-sm text-ink-500">ยังไม่มีรายการในทะเบียน</p>';
      return;
    }
    renderRegistryRows(out.rows, list);
  } catch (err) {
    console.error(err);
    list.innerHTML = `<p class="text-sm text-seal-500">${escapeHtml(cloudErrorMessage(err))}</p>`;
  }
}

$('upload-drive-btn').addEventListener('click', () => saveToCloud({ saveToSheet: false }));
$('cloud-save-btn').addEventListener('click', () => saveToCloud({ saveToSheet: true }));
$('next-number-btn').addEventListener('click', fetchNextReceiveNumber);
$('registry-btn').addEventListener('click', showRegistry);
$('closeRegistryModal').addEventListener('click', () => closeSheet($('registryModal')));
$('homeRegistryRefresh').addEventListener('click', loadHomeRegistry);
$('cancelEditBtn').addEventListener('click', () => {
  exitEditMode();
  toast('ออกจากโหมดแก้ไขแล้ว บันทึกครั้งต่อไปจะเป็นรายการใหม่', 'info');
});

bindRegistryEditClicks($('homeRegistryList'));
bindRegistryEditClicks($('registryList'));

function initCloud() {
  if (!cloudEnabled()) return;

  ['upload-drive-btn', 'cloud-save-btn', 'next-number-btn', 'registry-btn']
    .forEach((id) => $(id).classList.remove('hidden'));

  $('homeRegistry').classList.remove('hidden');
  loadHomeRegistry();

  // เมื่อมีระบบทะเบียนแล้ว ให้ปุ่มบันทึกลงเครื่องเป็นตัวเลือกรอง
  $('local-save-btn').classList.remove('btn-primary');
  $('local-save-btn').classList.add('btn-secondary');
}

/* ═══════════════════════════════════════════════════════════════════
   ค่าเริ่มต้น
   ═══════════════════════════════════════════════════════════════════ */
(function init() {
  const today = new Date().toISOString().slice(0, 10);
  $('receive-date').value = today;

  // รอให้ Sarabun พร้อมก่อน ไม่ให้เลขไทยบนตรากลายเป็นกล่องว่างหรือวัดความกว้างเพี้ยน
  if (document.fonts && document.fonts.load) {
    document.fonts.load('14px Sarabun')
      .then(() => fabricCanvases.forEach((c) => c.requestRenderAll()))
      .catch(() => {});
  }

  if (window.innerWidth >= 768) toolPanel.classList.remove('translate-y-full');

  initCloud();
  updateSettingsStorageNote();

  // ค่าในเครื่องแสดงไปก่อนแล้ว ค่าจากชีตจะมาทับเมื่อโหลดเสร็จ ไม่ต้องรอ
  syncOrgSettingsFromCloud();
})();
