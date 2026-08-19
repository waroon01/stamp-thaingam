/* ═══════════════════════════════════════════════════════════════════
   การ์ดเอกสารลงรับ — โค้ดกลางที่หน้าเว็บหลักและหน้าส่งต่อใช้ร่วมกัน

   หน้าที่ของไฟล์นี้
   ๑) ย่อข้อมูลจากฟอร์มให้เป็นก้อนเล็กที่สุด แล้วเข้ารหัสใส่ URL ได้
   ๒) แปลงก้อนนั้นกลับมาเป็นการ์ด ทั้งแบบ Flex Message และแบบ HTML
   ๓) สร้างลิงก์ LIFF สำหรับปุ่ม "ส่งต่อ" โดยคุมความยาวไม่ให้เกินที่ LINE รับ

   การ์ดมีสองโทน
   • origin  โทนหมึกน้ำเงิน — การ์ดต้นทางจากงานสารบรรณ มีปุ่มส่งต่อ
   • forward โทนเขียว — การ์ดที่ผู้รับส่งต่ออีกทอด ไม่มีปุ่มส่งต่อแล้ว
     ส่งต่อได้ทอดเดียวโดยตั้งใจ เอกสารจะได้ไม่กระจายต่อไปไม่รู้จบ

   ไม่พึ่งพา app.js เพื่อให้หน้า share.html ที่ไม่มีตัวแก้เอกสารเรียกใช้ได้ด้วย
   ═══════════════════════════════════════════════════════════════════ */

window.FlexDoc = (function () {
  'use strict';

  /* LINE จำกัด uri ของ action ไว้ที่ ๑๐๐๐ ตัวอักษร เผื่อไว้เล็กน้อยกันพลาด */
  const URI_LIMIT = 990;

  /* ความยาวข้อสั่งการที่ยอมให้พิมพ์ก่อนส่งต่อ */
  const NOTE_LIMIT = 300;

  const THAI_DIGITS = ['๐', '๑', '๒', '๓', '๔', '๕', '๖', '๗', '๘', '๙'];
  const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                             'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  /* ── โทนสีของการ์ดสองแบบ ───────────────────────────────────────── */
  const THEMES = {
    origin: {
      kicker: 'ลงรับหนังสือราชการ',
      header: '#12203D',
      headerSoft: '#1F3568',
      accent: '#93A9D5',
      label: '#8A97AE',
      value: '#12203D',
      strong: '#1F3568',
      tint: '#F2F5FB',
      noteTint: '#EAF0FA',
      primary: '#12203D',
      line: '#E4E8F1'
    },
    forward: {
      kicker: 'ส่งต่อเอกสารลงรับ',
      header: '#146049',
      headerSoft: '#1B7A5A',
      accent: '#A9D9C6',
      label: '#78968B',
      value: '#123D31',
      strong: '#146049',
      tint: '#EDF6F2',
      noteTint: '#DCEFE6',
      primary: '#146049',
      line: '#DCE8E3'
    }
  };

  const LINE_GREEN = '#06C755';

  /**
   * โลโก้เล็ก ๆ หน้าชื่อโรงเรียนบนหัวการ์ด
   *
   * ฝังเป็นค่าคงที่ ไม่ได้ส่งไปกับลิงก์ เพราะลิงก์ปุ่มส่งต่อมีเพดาน ๑๐๐๐ ตัวอักษร
   * ลิงก์โลโก้ตัวเดียวกินไปเกือบร้อยตัว เปลี่ยนโรงเรียนก็แก้บรรทัดนี้บรรทัดเดียว
   *
   * ไม่ใส่ f_auto เพราะ LINE รับเฉพาะ JPEG กับ PNG ปล่อยให้ Cloudinary
   * ส่ง PNG ตามต้นฉบับ แค่ย่อขนาดลงให้โหลดไว
   */
  const SCHOOL_LOGO = 'https://res.cloudinary.com/djkbdwnsc/image/upload/c_fit,h_96,w_96,q_auto/v1786978522/next-fullStack/Logo-thaingam_1_k2iec7.png';

  function themeOf(name) {
    return THEMES[name] || THEMES.origin;
  }

  /* ── ตัวช่วยทั่วไป ─────────────────────────────────────────────── */
  function thaiDigits(value) {
    return String(value == null ? '' : value).replace(/[0-9]/g, (d) => THAI_DIGITS[+d]);
  }

  function thaiDate(isoDate) {
    if (!isoDate) return '';
    const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
    if (!parts) return thaiDigits(isoDate);

    const monthName = THAI_MONTHS_SHORT[+parts[2] - 1];
    if (!monthName) return thaiDigits(isoDate);

    return `${thaiDigits(+parts[3])} ${monthName} ${thaiDigits(+parts[1] + 543)}`;
  }

  function cut(text, max) {
    const value = String(text == null ? '' : text).trim();
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  }

  function normalizeUrl(url) {
    const value = String(url == null ? '' : url).trim();
    if (!value) return '';
    if (/^(https?|line):\/\//i.test(value)) return value;
    return `https://${value.replace(/^\/+/, '')}`;
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const DRIVE_VIEW = /^https:\/\/drive\.google\.com\/file\/d\/([\w-]+)\//;

  function driveViewUrl(fileId) {
    return `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
  }

  /* ═══════════════════════════════════════════════════════════════
     ก้อนข้อมูลที่ฝากไปกับ URL

     ใช้คีย์สั้นเพราะทุกตัวอักษรมีราคา ภาษาไทยหนึ่งตัวกินสามไบต์
     n  เลขทะเบียนรับ    rd วันที่รับ        bn เลขที่หนังสือ
     bd หนังสือลงวันที่   f  จาก             t  ถึง
     s  เรื่อง            a  การปฏิบัติ       dp ฝ่ายที่รับผิดชอบ
     c  การสั่งการ        m  ข้อความเพิ่มเติม  sc ชื่อโรงเรียน
     fi รหัสไฟล์ใน Drive  u  ลิงก์ไฟล์ (กรณีไม่ใช่ Drive)
     at [[ชื่อ, ลิงก์], ...] สิ่งที่ส่งมาด้วย

     สองคีย์นี้เติมตอนส่งต่อ ไม่ต้องยัดกลับลงลิงก์อีก
     fn ข้อสั่งการที่ผู้ส่งต่อพิมพ์เพิ่ม   fb ชื่อผู้ส่งต่อ
     ═══════════════════════════════════════════════════════════════ */
  function payloadFromForm(data, options) {
    const opts = options || {};
    const payload = {};
    const put = (key, value) => {
      const text = String(value == null ? '' : value).trim();
      if (text) payload[key] = text;
    };

    put('n', data.receiveNumber);
    put('rd', data.receiveDate);
    put('bn', data.bookNumber);
    put('bd', data.bookDate);
    put('f', data.fromInp);
    put('t', data.to);
    put('s', data.subject);
    put('a', data.action);
    put('dp', data.department);
    put('c', data.commanded);
    put('m', data.msgCommand);
    put('sc', opts.school);

    // ไฟล์ใน Drive เก็บแค่รหัส สั้นกว่าลิงก์เต็มราวสี่สิบตัวอักษร
    const pdfUrl = String(opts.pdfUrl || '').trim();
    const drive = DRIVE_VIEW.exec(pdfUrl);
    if (drive) payload.fi = drive[1];
    else if (opts.fileId) payload.fi = opts.fileId;
    else if (pdfUrl) payload.u = pdfUrl;

    const attachments = (data.attachments || [])
      .map((item) => [String(item.label || '').trim(), normalizeUrl(item.url)])
      .filter((pair) => pair[1]);

    if (attachments.length) payload.at = attachments;

    return payload;
  }

  /**
   * เติมข้อสั่งการและชื่อผู้ส่งต่อลงในก้อนข้อมูลที่ถอดมาจากลิงก์
   * การ์ดทอดสองไม่มีปุ่มส่งต่อ จึงไม่ต้องเข้ารหัสกลับลง URL อีก
   * ข้อความตรงนี้จึงยาวได้เต็มที่ ไม่ติดเพดานความยาวลิงก์
   */
  function withForwardNote(payload, note, forwardedBy) {
    const copy = { ...payload };
    const text = cut(note, NOTE_LIMIT);
    const name = String(forwardedBy || '').trim();

    if (text) copy.fn = text; else delete copy.fn;
    if (name) copy.fb = name; else delete copy.fb;

    return copy;
  }

  /* ── เข้ารหัส/ถอดรหัสก้อนข้อมูล ────────────────────────────────── */
  function toBase64Url(bytes) {
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(text) {
    const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  /** บีบอัดด้วย deflate ถ้าเบราว์เซอร์รองรับ ข้อความไทยมักเล็กลงเกือบครึ่ง */
  async function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (err) {
      console.warn('บีบอัดไม่ได้ ใช้ข้อมูลดิบแทน', err);
      return null;
    }
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** ตัวอักษรแรกบอกวิธีเข้ารหัส z = บีบอัดแล้ว, p = ข้อมูลดิบ */
  async function encode(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const packed = await deflate(bytes);
    return (packed && packed.length < bytes.length)
      ? 'z' + toBase64Url(packed)
      : 'p' + toBase64Url(bytes);
  }

  async function decode(text) {
    const value = String(text || '').trim();
    if (!value) throw new Error('ไม่มีข้อมูลการ์ดมากับลิงก์');

    const kind = value.charAt(0);
    const bytes = fromBase64Url(value.slice(1));
    const raw = kind === 'z' ? await inflate(bytes) : bytes;

    if (!raw) throw new Error('เบราว์เซอร์นี้ยังคลายการบีบอัดข้อมูลไม่ได้');
    return JSON.parse(new TextDecoder().decode(raw));
  }

  /* ── ลิงก์ปุ่มส่งต่อ ───────────────────────────────────────────── */
  function withoutKeys(payload, keys) {
    const copy = { ...payload };
    keys.forEach((key) => delete copy[key]);
    return copy;
  }

  /**
   * สร้างลิงก์ LIFF สำหรับปุ่มส่งต่อ
   * ถ้ายาวเกินที่ LINE รับ จะค่อย ๆ ตัดข้อมูลรองออกตามลำดับความสำคัญ
   * คืน { url, trimmed } และ url เป็นค่าว่างเมื่อย่อแล้วยังไม่พอ
   */
  async function forwardUrl(payload, base) {
    const attempts = [
      payload,
      withoutKeys(payload, ['m']),
      withoutKeys(payload, ['m', 'a']),
      withoutKeys(payload, ['m', 'a', 'bn', 'bd']),
      withoutKeys(payload, ['m', 'a', 'bn', 'bd', 'f', 't', 'dp'])
    ];

    for (let i = 0; i < attempts.length; i++) {
      const url = `${base}?d=${await encode(attempts[i])}`;
      if (url.length <= URI_LIMIT) return { url, trimmed: i > 0 };
    }

    return { url: '', trimmed: true };
  }

  /* ── แปลงก้อนข้อมูลเป็นการ์ด ───────────────────────────────────── */
  function modelFrom(payload) {
    const p = payload || {};

    const rows = [];
    const add = (label, value) => {
      const text = String(value == null ? '' : value).trim();
      if (text) rows.push({ label, value: text });
    };

    add('เลขทะเบียนรับ', thaiDigits(p.n));
    add('วันที่รับ', thaiDate(p.rd));
    add('เลขที่หนังสือ', p.bn);
    add('หนังสือลงวันที่', thaiDate(p.bd));
    add('จาก', p.f);
    add('ถึง', p.t);
    add('ฝ่ายที่รับผิดชอบ', p.dp);
    add('การปฏิบัติ', p.a);

    const attachments = (p.at || [])
      .map((pair, index) => ({
        label: cut(pair[0] || `สิ่งที่ส่งมาด้วย ${thaiDigits(index + 1)}`, 38),
        url: normalizeUrl(pair[1])
      }))
      .filter((item) => item.url);

    return {
      school: String(p.sc || 'งานสารบรรณ').trim(),
      receiveNumber: thaiDigits(p.n || ''),
      subject: String(p.s || '').trim() || '(ไม่ได้ระบุเรื่อง)',
      rows,
      command: String(p.c || '').trim(),
      note: String(p.m || '').trim(),
      forwardNote: String(p.fn || '').trim(),
      forwardBy: String(p.fb || '').trim(),
      attachments,
      pdfUrl: p.fi ? driveViewUrl(p.fi) : normalizeUrl(p.u || '')
    };
  }

  /* ── Flex Message ──────────────────────────────────────────────── */
  function flexRow(row, t) {
    return {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: [
        { type: 'text', text: row.label, size: 'sm', color: t.label, flex: 4, wrap: true },
        { type: 'text', text: row.value, size: 'sm', color: t.value, flex: 7, wrap: true }
      ]
    };
  }

  /** หัวกล่องท้ายการ์ด บอกที่มาของข้อความชั้นที่ผู้ส่งต่อเติมเข้ามา */
  function relayHeading(model) {
    if (!model.forwardNote) return `ส่งต่อโดย ${cut(model.forwardBy, 40)}`;
    return model.forwardBy ? `ข้อสั่งการเพิ่มเติมจาก ${cut(model.forwardBy, 40)}` : 'ข้อสั่งการเพิ่มเติม';
  }

  function documentBubble(model, forwardLink, t) {
    const body = [
      { type: 'text', text: 'เรื่อง', size: 'xxs', color: t.label, weight: 'bold' },
      { type: 'text', text: cut(model.subject, 120), size: 'lg', weight: 'bold', color: t.value, wrap: true, margin: 'xs' },
      { type: 'separator', margin: 'lg', color: t.line }
    ];

    if (model.rows.length) {
      body.push({ type: 'box', layout: 'vertical', spacing: 'sm', margin: 'lg', contents: model.rows.map((row) => flexRow(row, t)) });
    }

    if (model.command || model.note) {
      const tint = [];
      if (model.command) {
        tint.push({ type: 'text', text: 'การสั่งการ', size: 'xxs', color: t.label, weight: 'bold' });
        tint.push({ type: 'text', text: cut(model.command, 90), size: 'sm', weight: 'bold', color: t.strong, wrap: true, margin: 'xs' });
      }
      if (model.note) {
        tint.push({ type: 'text', text: cut(model.note, 120), size: 'xs', color: t.value, wrap: true, margin: model.command ? 'sm' : 'none' });
      }
      body.push({
        type: 'box', layout: 'vertical', backgroundColor: t.tint, cornerRadius: '10px',
        paddingAll: '12px', margin: 'lg', contents: tint
      });
    }

    // กล่องข้อสั่งการของผู้ส่งต่อ วางไว้ล่างสุดให้เห็นว่าเป็นชั้นที่เพิ่มมาทีหลัง
    if (model.forwardNote || model.forwardBy) {
      const relay = [{
        type: 'text', text: relayHeading(model),
        size: 'xxs', color: t.strong, weight: 'bold', wrap: true
      }];

      if (model.forwardNote) {
        relay.push({ type: 'text', text: cut(model.forwardNote, NOTE_LIMIT), size: 'sm', color: t.value, wrap: true, margin: 'sm' });
      }

      body.push({
        type: 'box', layout: 'vertical', backgroundColor: t.noteTint, cornerRadius: '10px',
        paddingAll: '12px', margin: 'md', contents: relay
      });
    }

    const footer = [];

    if (model.pdfUrl) {
      footer.push({
        type: 'button', style: 'primary', color: t.primary, height: 'sm',
        action: { type: 'uri', label: 'เปิดเอกสาร PDF', uri: model.pdfUrl }
      });
    }

    if (model.attachments.length === 1) {
      footer.push({
        type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
        action: { type: 'uri', label: model.attachments[0].label, uri: model.attachments[0].url }
      });
    } else if (model.attachments.length > 1) {
      footer.push({
        type: 'text', align: 'center', size: 'xxs', color: t.label, wrap: true, margin: 'md',
        text: `เลื่อนไปทางขวา เพื่อดูสิ่งที่ส่งมาด้วย ${thaiDigits(model.attachments.length)} รายการ`
      });
    }

    if (forwardLink) {
      footer.push({
        type: 'button', style: 'primary', color: LINE_GREEN, height: 'sm', margin: 'sm',
        action: { type: 'uri', label: 'ส่งต่อเอกสารนี้', uri: forwardLink }
      });
    }

    const bubble = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: t.header, paddingAll: '16px', spacing: 'xs',
        contents: [
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: t.kicker, size: 'xxs', weight: 'bold', color: t.accent, flex: 1 },
              model.receiveNumber
                ? { type: 'text', text: `รับที่ ${model.receiveNumber}`, size: 'xxs', color: '#FFFFFF', align: 'end', flex: 0 }
                : { type: 'filler' }
            ]
          },
          {
            type: 'box', layout: 'horizontal', spacing: 'sm', alignItems: 'center', margin: 'xs',
            contents: [
              // กรอบขาวรองไว้ให้โลโก้เด่นทั้งบนหัวสีน้ำเงินและสีเขียว
              {
                type: 'box', layout: 'vertical', flex: 0,
                width: '30px', height: '30px', backgroundColor: '#FFFFFF',
                cornerRadius: '6px', paddingAll: '3px',
                contents: [{ type: 'image', url: SCHOOL_LOGO, size: 'full', aspectRatio: '1:1', aspectMode: 'fit' }]
              },
              { type: 'text', text: cut(model.school, 60), size: 'md', weight: 'bold', color: '#FFFFFF', wrap: true, flex: 1 }
            ]
          }
        ]
      },
      body: { type: 'box', layout: 'vertical', paddingAll: '16px', contents: body }
    };

    if (footer.length) {
      bubble.footer = { type: 'box', layout: 'vertical', paddingAll: '16px', paddingTop: '0px', contents: footer };
    }

    return bubble;
  }

  function attachmentBubble(model, t) {
    return {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: t.headerSoft, paddingAll: '16px', spacing: 'xs',
        contents: [
          { type: 'text', text: 'สิ่งที่ส่งมาด้วย', size: 'xxs', weight: 'bold', color: t.accent },
          { type: 'text', text: `${thaiDigits(model.attachments.length)} รายการ`, size: 'md', weight: 'bold', color: '#FFFFFF' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '16px',
        contents: [
          { type: 'text', text: cut(model.subject, 80), size: 'xs', color: t.label, wrap: true },
          { type: 'separator', margin: 'md', color: t.line },
          ...model.attachments.map((item, index) => ({
            type: 'button', style: 'secondary', height: 'sm', margin: index === 0 ? 'md' : 'sm',
            action: { type: 'uri', label: item.label, uri: item.url }
          }))
        ]
      }
    };
  }

  /** options: { forwardUrl, theme } — theme เป็น 'origin' (ค่าเริ่มต้น) หรือ 'forward' */
  function buildFlex(model, options) {
    const opts = options || {};
    const t = themeOf(opts.theme);

    const bubbles = [documentBubble(model, opts.forwardUrl, t)];
    if (model.attachments.length > 1) bubbles.push(attachmentBubble(model, t));

    const prefix = opts.theme === 'forward' ? '[ส่งต่อเอกสารลงรับ]' : '[ลงรับหนังสือ]';
    const altText = cut(
      `${prefix} ${model.receiveNumber ? `รับที่ ${model.receiveNumber} · ` : ''}${model.subject}`,
      300
    );

    return {
      type: 'flex',
      altText,
      contents: bubbles.length > 1 ? { type: 'carousel', contents: bubbles } : bubbles[0]
    };
  }

  /* ── การ์ดแบบ HTML สำหรับแสดงบนหน้าเว็บ ────────────────────────── */
  function cardHtml(model, options) {
    const opts = options || {};
    const t = themeOf(opts.theme);
    const pdfUrl = model.pdfUrl;

    const rows = model.rows.map((row) => `
      <div class="flex gap-2 text-[13px] leading-snug">
        <span class="w-[38%] shrink-0" style="color:${t.label}">${escapeHtml(row.label)}</span>
        <span class="flex-1 break-words" style="color:${t.value}">${escapeHtml(row.value)}</span>
      </div>`).join('');

    const tint = (model.command || model.note) ? `
      <div class="mt-4 rounded-xl px-3 py-2.5" style="background:${t.tint}">
        ${model.command ? `<p class="text-[10px] font-medium" style="color:${t.label}">การสั่งการ</p>
        <p class="text-[13px] font-semibold mt-0.5" style="color:${t.strong}">${escapeHtml(model.command)}</p>` : ''}
        ${model.note ? `<p class="text-[12px] mt-1" style="color:${t.value}">${escapeHtml(model.note)}</p>` : ''}
      </div>` : '';

    const relay = (model.forwardNote || model.forwardBy) ? `
      <div class="mt-3 rounded-xl px-3 py-2.5" style="background:${t.noteTint}">
        <p class="text-[10px] font-semibold" style="color:${t.strong}">${escapeHtml(relayHeading(model))}</p>
        ${model.forwardNote ? `<p class="text-[13px] mt-1.5 whitespace-pre-line" style="color:${t.value}">${escapeHtml(model.forwardNote)}</p>` : ''}
      </div>` : '';

    const pdfButton = pdfUrl
      ? `<a href="${escapeHtml(pdfUrl)}" target="_blank" rel="noopener noreferrer"
            class="block rounded-lg text-white text-center text-[13px] font-semibold py-2.5"
            style="background:${t.primary}">เปิดเอกสาร PDF</a>`
      : `<div class="rounded-lg bg-desk-200 text-ink-400 text-center text-[13px] font-medium py-2.5">${
          escapeHtml(opts.pendingLabel || 'กำลังเตรียมลิงก์ไฟล์…')}</div>`;

    const attachButton = model.attachments.length === 1
      ? `<a href="${escapeHtml(model.attachments[0].url)}" target="_blank" rel="noopener noreferrer"
            class="block rounded-lg border border-desk-300 text-ink-700 text-center text-[13px] font-medium py-2.5 mt-2">${escapeHtml(model.attachments[0].label)}</a>`
      : model.attachments.length > 1
        ? `<p class="text-[10px] text-center mt-3" style="color:${t.label}">เลื่อนไปทางขวา เพื่อดูสิ่งที่ส่งมาด้วย ${thaiDigits(model.attachments.length)} รายการ</p>`
        : '';

    const forwardHint = opts.forwardUrl
      ? `<p class="text-[10px] text-center mt-2" style="color:${LINE_GREEN}">มีปุ่ม “ส่งต่อเอกสารนี้” ติดไปกับการ์ดด้วย</p>`
      : '';

    const attachCard = model.attachments.length > 1 ? `
      <p class="text-[10px] font-medium text-ink-400 mt-4 mb-1.5">การ์ดใบที่ ๒ · สิ่งที่ส่งมาด้วย</p>
      <div class="rounded-2xl overflow-hidden bg-white shadow-page">
        <div class="px-4 py-3" style="background:${t.headerSoft}">
          <p class="text-[10px] font-semibold" style="color:${t.accent}">สิ่งที่ส่งมาด้วย</p>
          <p class="text-sm font-semibold text-white">${thaiDigits(model.attachments.length)} รายการ</p>
        </div>
        <div class="px-4 py-4">
          <p class="text-[11px]" style="color:${t.label}">${escapeHtml(cut(model.subject, 80))}</p>
          <div class="h-px my-3" style="background:${t.line}"></div>
          <div class="space-y-2">
            ${model.attachments.map((item) => `
              <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"
                 class="block rounded-lg border border-desk-300 text-ink-700 text-center text-[13px] font-medium py-2.5">${escapeHtml(item.label)}</a>`).join('')}
          </div>
        </div>
      </div>` : '';

    return `
      <div class="rounded-2xl overflow-hidden bg-white shadow-page">
        <div class="px-4 py-3" style="background:${t.header}">
          <div class="flex items-start gap-2">
            <p class="flex-1 text-[10px] font-semibold" style="color:${t.accent}">${escapeHtml(t.kicker)}</p>
            ${model.receiveNumber ? `<p class="text-[10px] text-white font-mono">รับที่ ${escapeHtml(model.receiveNumber)}</p>` : ''}
          </div>
          <div class="flex items-center gap-2 mt-1">
          <img src="${SCHOOL_LOGO}" alt="" class="w-[26px] h-[26px] shrink-0 rounded-md bg-white p-[2px] object-contain" />
          <p class="text-sm font-semibold text-white">${escapeHtml(cut(model.school, 60))}</p>
        </div>
        </div>

        <div class="px-4 py-4">
          <p class="text-[10px] font-medium" style="color:${t.label}">เรื่อง</p>
          <p class="text-base font-semibold leading-snug mt-0.5" style="color:${t.value}">${escapeHtml(cut(model.subject, 120))}</p>
          <div class="h-px my-3" style="background:${t.line}"></div>
          <div class="space-y-2">${rows || `<p class="text-[13px]" style="color:${t.label}">ยังไม่ได้กรอกข้อมูลลงรับ</p>`}</div>
          ${tint}
          ${relay}
        </div>

        <div class="px-4 pb-4">
          ${pdfButton}
          ${attachButton}
          ${forwardHint}
        </div>
      </div>
      ${attachCard}`;
  }

  return {
    URI_LIMIT,
    NOTE_LIMIT,
    thaiDigits,
    thaiDate,
    cut,
    normalizeUrl,
    escapeHtml,
    payloadFromForm,
    withForwardNote,
    encode,
    decode,
    forwardUrl,
    modelFrom,
    buildFlex,
    cardHtml
  };
})();
