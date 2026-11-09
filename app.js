/* Sổ điểm học sinh – lưu dữ liệu trong localStorage của trình duyệt */
(function () {
  'use strict';

  const STORAGE_KEY = 'so-diem-data-v1';
  const UI_KEY = 'so-diem-ui-v1';
  const DEFAULT_SESSIONS = 10;

  const CLASSES = [
    { id: '7', name: 'Lớp 7' },
    { id: '8', name: 'Lớp 8' },
    { id: '9.1', name: '9.1', group: 'Lớp 9' },
    { id: '9.2', name: '9.2', group: 'Lớp 9' },
    { id: '9.S', name: '9.S', group: 'Lớp 9' },
    { id: 'ielts', name: 'Lớp IELTS' },
  ];

  const SHEETS = [
    { id: 'trenlop', name: 'Điểm trên lớp', type: 'sessions' },
    { id: 'khaosat', name: 'Điểm khảo sát', type: 'sessions', target: true },
    { id: 'kehoach', name: 'Kế hoạch IELTS', type: 'plan' },
  ];

  // Các cột nhỏ mặc định trong mỗi buổi (có thể thêm / xoá trên giao diện)
  const DEFAULT_COLS = [
    { key: 'dd', label: 'Điểm danh', type: 'attend' },
    { key: 'btvn', label: 'BTVN', type: 'check' },
    { key: 'chepnghe', label: 'Chép nghe', type: 'check' },
    { key: 'chepphat', label: 'Chép phạt', type: 'check' },
    { key: 'nghe', label: 'Điểm nghe', type: 'score' },
    { key: 'tumoi', label: 'Điểm từ mới', type: 'score' },
    { key: 'kttt', label: 'Điểm kiến thức trọng tâm', type: 'score' },
    { key: 'ktdg', label: 'Điểm KT đầu giờ', type: 'score' },
  ];

  // Mỗi buổi một màu (sắc độ HSL)
  const SESSION_HUES = [262, 199, 152, 28, 330, 222, 174, 8, 290, 45, 110, 240];

  const FONTS = [
    { name: 'Be Vietnam Pro', css: "'Be Vietnam Pro', system-ui, sans-serif" },
    { name: 'Nunito', css: "'Nunito', system-ui, sans-serif" },
    { name: 'Quicksand', css: "'Quicksand', system-ui, sans-serif" },
    { name: 'Lexend', css: "'Lexend', system-ui, sans-serif" },
    { name: 'Montserrat', css: "'Montserrat', system-ui, sans-serif" },
    { name: 'Inter', css: "'Inter', system-ui, sans-serif" },
    { name: 'Roboto', css: "'Roboto', system-ui, sans-serif" },
    { name: 'Arial', css: 'Arial, Helvetica, sans-serif' },
    { name: 'Times New Roman', css: "'Times New Roman', Times, serif" },
  ];
  const SIZES = [12, 13, 14, 15, 16, 18, 20];

  const SKILLS = ['', 'Listening', 'Reading', 'Writing', 'Speaking', 'Vocabulary', 'Grammar', 'Mock test', 'Khác'];

  // ---------- State ----------
  let state = load(STORAGE_KEY) || { classes: {} };
  if (!state.classes) state.classes = {};
  const ui = Object.assign({ cls: '7', sheet: 'trenlop', session: 'all', font: FONTS[0].name, size: 14 }, load(UI_KEY) || {});
  if (!CLASSES.some(c => c.id === ui.cls)) ui.cls = '7';
  if (!SHEETS.some(s => s.id === ui.sheet)) ui.sheet = 'trenlop';

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  let saveTimer = null;
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 250); }
  function saveNow() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { alert('Không lưu được dữ liệu: ' + e.message); }
  }
  function saveUI() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* ignore */ } }
  window.addEventListener('beforeunload', () => { saveNow(); flush(); });

  // ---------- Đồng bộ chung qua Firebase (xem cloud.js) ----------
  // Firestore: collection "sodiem_classes" (doc = lớp, chứa danh sách HS)
  //            collection "sodiem_sheets"  (doc = "<lớp>__<sheet>", chứa điểm)
  const COL_CLASSES = 'sodiem_classes';
  const COL_SHEETS = 'sodiem_sheets';
  let cloud = null;
  const pending = {};      // thay đổi chưa gửi: "col\u0001id" -> [[path, value], ...]
  const remote = {};       // bản dữ liệu mới nhất từ máy chủ: "col\u0001id" -> object
  let flushTimer = null;
  let inflight = 0;

  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function sheetDocId(cid, sid) { return cid + '__' + sid; }
  function setPath(obj, path, value, del) {
    let o = obj;
    for (let i = 0; i < path.length - 1; i++) {
      if (!o[path[i]] || typeof o[path[i]] !== 'object' || Array.isArray(o[path[i]])) o[path[i]] = {};
      o = o[path[i]];
    }
    const last = path[path.length - 1];
    if (value === undefined && !del) delete o[last];
    else o[last] = value;
  }

  /** Ghi một thay đổi lên đám mây (value === undefined nghĩa là xoá) */
  function sync(col, id, path, value) {
    if (!cloud) return;
    const k = col + '\u0001' + id;
    (pending[k] = pending[k] || []).push([path, clone(value)]);
    setStatus('saving');
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 400);
  }

  function flush() {
    clearTimeout(flushTimer);
    if (!cloud) return;
    Object.keys(pending).forEach(k => {
      const ops = pending[k];
      delete pending[k];
      const [col, id] = k.split('\u0001');
      const patch = {};
      ops.forEach(([path, value]) => setPath(patch, path, value === undefined ? cloud.DELETE : value, true));
      inflight++;
      cloud.write(col, id, patch)
        .then(() => { inflight--; if (!inflight && !Object.keys(pending).length) setStatus('saved'); })
        .catch(err => { inflight--; setStatus('error', err); });
    });
  }

  /** Dữ liệu máy chủ + các thay đổi mình chưa kịp gửi */
  function withPending(col, id, data) {
    const d = clone(data) || {};
    (pending[col + '\u0001' + id] || []).forEach(([path, value]) => setPath(d, path, value));
    return d;
  }

  function studentsFromMap(map) {
    return Object.entries(map || {})
      .filter(([, v]) => v && typeof v === 'object')
      .sort((a, b) => (a[1].order || 0) - (b[1].order || 0) || a[0].localeCompare(b[0]))
      .map(([id, v]) => ({ id, name: v.name || '', order: v.order || 0 }));
  }

  function applyDoc(col, id, data) {
    remote[col + '\u0001' + id] = data;
    const d = withPending(col, id, data);
    if (col === COL_CLASSES) {
      if (!CLASSES.some(c => c.id === id)) return;
      classData(id).students = studentsFromMap(d.students);
    } else if (col === COL_SHEETS) {
      const i = id.lastIndexOf('__');
      const cid = id.slice(0, i), sid = id.slice(i + 2);
      if (!CLASSES.some(c => c.id === cid) || !sheetDef(sid)) return;
      classData(cid).sheets[sid] = d;
    }
  }

  function viewSnapshot() {
    return JSON.stringify([classData(ui.cls).students, sheetData(ui.cls, ui.sheet)]);
  }

  let remoteRenderTimer = null;
  function onRemoteDoc(col, id, data) {
    const before = viewSnapshot();
    applyDoc(col, id, data);
    save();
    if (viewSnapshot() === before) return;
    clearTimeout(remoteRenderTimer);
    remoteRenderTimer = setTimeout(() => renderKeepFocus(), 120);
  }

  function hasLocalData() {
    return Object.values(state.classes).some(c => (c.students && c.students.length) ||
      Object.values(c.sheets || {}).some(sh => sh.rows && sh.rows.length));
  }

  /** Đẩy toàn bộ dữ liệu trên máy này lên đám mây (lần đầu, hoặc khi khôi phục) */
  function uploadAll() {
    const jobs = [];
    Object.keys(state.classes).forEach(cid => {
      if (!CLASSES.some(c => c.id === cid)) return;
      const c = classData(cid);
      const map = {};
      c.students.forEach((s, i) => { map[s.id] = { name: s.name, order: s.order || i + 1 }; });
      jobs.push(cloud.replace(COL_CLASSES, cid, { students: map }));
      Object.keys(c.sheets).forEach(sid => {
        if (!sheetDef(sid)) return;
        jobs.push(cloud.replace(COL_SHEETS, sheetDocId(cid, sid), clone(sheetData(cid, sid))));
      });
    });
    setStatus('saving');
    return Promise.all(jobs).then(() => setStatus('saved'), err => setStatus('error', err));
  }

  function setStatus(kind, err) {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    const map = {
      local: ['💾 Chỉ lưu trên máy này', 'Chưa kết nối Firebase: điểm chỉ lưu trên trình duyệt này.'],
      loading: ['⏳ Đang tải dữ liệu chung…', ''],
      saving: ['⏳ Đang lưu…', ''],
      saved: ['☁️ Đã lưu chung', 'Mọi người mở link đều thấy và sửa được cùng một bảng điểm.'],
      error: ['⚠️ Lỗi đồng bộ', 'Không lưu được lên máy chủ: ' + (err && err.message ? err.message : err)],
    };
    const [text, title] = map[kind] || map.local;
    el.textContent = text;
    el.title = title;
    el.className = 'sync ' + kind;
    if (kind === 'error') console.error('Lỗi đồng bộ:', err);
  }

  /** cloud.js gọi hàm này khi đã kết nối Firebase */
  async function connectCloud(adapter) {
    cloud = adapter;
    setStatus('loading');
    try {
      const all = await adapter.loadAll([COL_CLASSES, COL_SHEETS]);
      const empty = !all[COL_CLASSES].length && !all[COL_SHEETS].length;
      if (empty && hasLocalData()) {
        await uploadAll();
      } else {
        state = { classes: {} };
        all[COL_CLASSES].forEach(d => applyDoc(COL_CLASSES, d.id, d.data));
        all[COL_SHEETS].forEach(d => applyDoc(COL_SHEETS, d.id, d.data));
        saveNow();
        renderAll();
      }
      setStatus('saved');
      adapter.subscribe([COL_CLASSES, COL_SHEETS], onRemoteDoc, err => setStatus('error', err));
    } catch (err) {
      setStatus('error', err);
    }
  }
  window.SoDiem = { connectCloud, setStatus };

  function classData(cid) {
    if (!state.classes[cid]) state.classes[cid] = { students: [], sheets: {} };
    const c = state.classes[cid];
    if (!c.students) c.students = [];
    if (!c.sheets) c.sheets = {};
    return c;
  }
  function sheetDef(sid) { return SHEETS.find(s => s.id === sid); }
  function sheetData(cid, sid) {
    const c = classData(cid);
    const type = sheetDef(sid).type;
    if (!c.sheets[sid]) c.sheets[sid] = type === 'plan' ? { rows: [] } : {};
    const sh = c.sheets[sid];
    if (type === 'sessions') {
      if (!sh.totals) sh.totals = {};
      if (!sh.data) sh.data = {};
      if (sheetDef(sid).target && !sh.targets) sh.targets = {};
      if (!Array.isArray(sh.sessions)) sh.sessions = Array.from({ length: DEFAULT_SESSIONS }, (_, i) => ({ id: String(i + 1) }));
      if (!Array.isArray(sh.cols)) sh.cols = DEFAULT_COLS.map(c => Object.assign({}, c));
    } else if (!sh.rows) sh.rows = [];
    return sh;
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ---------- Tính toán ----------
  function num(v) {
    if (v === '' || v === null || v === undefined || v === true || v === false) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  /** Quy đổi số câu đúng ra điểm /10 dựa trên tổng số câu của bài */
  function toTen(correct, total) {
    const c = num(correct), t = num(total);
    if (c === null || t === null || t <= 0) return null;
    return Math.round((c / t) * 10 * 100) / 100;
  }
  function fmt(n) {
    if (n === null || n === undefined) return '';
    return (Math.round(n * 100) / 100).toString().replace('.', ',');
  }
  function gradeClass(n) {
    if (n === null) return '';
    if (n >= 8) return 'good';
    if (n >= 6.5) return 'ok';
    if (n >= 5) return 'mid';
    return 'bad';
  }
  function getCell(sh, stId, sid, key) {
    return sh.data[stId] && sh.data[stId][sid] ? sh.data[stId][sid][key] : undefined;
  }
  function getTotal(sh, sid, key) { return sh.totals[sid] ? sh.totals[sid][key] : undefined; }
  function attendCol(sh) { return sh.cols.find(c => c.type === 'attend'); }
  function isPresent(v) { return v === true || v === 'v'; }
  function isAbsent(v) { return v === 'x'; }
  function sessionAbsent(sh, stId, sid) {
    return sh.cols.some(c => c.type === 'attend' && isAbsent(getCell(sh, stId, sid, c.key)));
  }
  function attendance(sh, stId) {
    const col = attendCol(sh);
    if (!col) return null;
    return sh.sessions.filter(s => isPresent(getCell(sh, stId, s.id, col.key))).length;
  }
  function absences(sh, stId) {
    return sh.sessions.filter(s => sessionAbsent(sh, stId, s.id)).length;
  }
  function studentAvg(sh, stId) {
    let sum = 0, cnt = 0;
    sh.sessions.forEach(s => sh.cols.forEach(c => {
      if (c.type !== 'score') return;
      const v = toTen(getCell(sh, stId, s.id, c.key), getTotal(sh, s.id, c.key));
      if (v !== null) { sum += v; cnt++; }
    }));
    return cnt ? sum / cnt : null;
  }
  function convInfo(correct, total) {
    const c = num(correct);
    if (c === null) return { text: '', cls: '' };
    const t = num(total);
    if (t === null || t <= 0) return { text: 'thiếu tổng', cls: 'warn' };
    const v = toTen(c, t);
    return { text: fmt(v) + '/10', cls: gradeClass(v) };
  }

  /** Điểm khảo sát: so với điểm mục tiêu – ≥ mục tiêu: xanh, < 5: đỏ, còn lại giữ nguyên */
  function targetClass(sh, stId, score, col) {
    if (!sh.targets || score === null || score === undefined) return '';
    const tg = num(sh.targets[stId]);
    if (tg !== null && score >= tg && !(col && col.noTarget)) return 'tgt-hit';
    if (score < 5) return 'tgt-low';
    return '';
  }

  // ---------- Helpers ----------
  const $ = sel => document.querySelector(sel);
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function className(cid) {
    const c = CLASSES.find(x => x.id === cid);
    return c.group ? 'Lớp ' + c.name : c.name;
  }
  function sessionLabel(sh, sid) {
    const i = sh.sessions.findIndex(s => s.id === sid);
    return (sh.sessions[i] && sh.sessions[i].name) || 'Buổi ' + (i + 1);
  }
  function hueOf(sh, sid) {
    const i = sh.sessions.findIndex(s => s.id === sid);
    return SESSION_HUES[(i < 0 ? 0 : i) % SESSION_HUES.length];
  }
  function visibleSessions(sh) {
    if (ui.session !== 'all') {
      const s = sh.sessions.find(x => x.id === String(ui.session));
      if (s) return [s];
      ui.session = 'all';
    }
    return sh.sessions;
  }

  // ---------- Font ----------
  function applyFont() {
    const f = FONTS.find(x => x.name === ui.font) || FONTS[0];
    document.documentElement.style.setProperty('--font', f.css);
    document.documentElement.style.setProperty('--fs', (Number(ui.size) || 14) + 'px');
  }
  function renderFontControls() {
    $('#fontSel').innerHTML = FONTS.map(f => `<option value="${esc(f.name)}" style="font-family:${esc(f.css)}">${esc(f.name)}</option>`).join('');
    $('#fontSel').value = ui.font;
    $('#sizeSel').innerHTML = SIZES.map(s => `<option value="${s}">${s}px</option>`).join('');
    $('#sizeSel').value = String(ui.size);
  }

  // ---------- Render ----------
  function renderClassTabs() {
    let html = '';
    let i = 0;
    while (i < CLASSES.length) {
      const c = CLASSES[i];
      if (c.group) {
        const g = c.group;
        html += `<div class="group"><span class="group-label">${esc(g)}</span>`;
        while (i < CLASSES.length && CLASSES[i].group === g) {
          const x = CLASSES[i];
          html += `<button data-cls="${esc(x.id)}" class="${x.id === ui.cls ? 'active' : ''}">${esc(x.name)}</button>`;
          i++;
        }
        html += '</div>';
      } else {
        html += `<button data-cls="${esc(c.id)}" class="${c.id === ui.cls ? 'active' : ''}">${esc(c.name)}</button>`;
        i++;
      }
    }
    $('#classTabs').innerHTML = html;
  }

  function renderSheetTabs() {
    $('#sheetTabs').innerHTML = SHEETS.map(s =>
      `<button data-sheet="${s.id}" class="${s.id === ui.sheet ? 'active' : ''}">${esc(s.name)}</button>`).join('');
  }

  function renderToolbar() {
    const def = sheetDef(ui.sheet);
    let html = '';
    if (def.type === 'sessions') {
      const sh = sheetData(ui.cls, ui.sheet);
      html += `<input type="text" id="newStudent" placeholder="Nhập họ tên học sinh rồi Enter">
        <button class="btn primary" id="addStudent">+ Thêm HS</button>
        <button class="btn" id="bulkAdd">Dán danh sách</button>
        <button class="btn soft" id="addCol">+ Thêm cột</button>
        <button class="btn soft" id="addSession">+ Thêm buổi</button>
        <select id="sessionFilter" title="Lọc buổi">
          <option value="all">Hiện tất cả ${sh.sessions.length} buổi</option>
          ${sh.sessions.map(s => `<option value="${esc(s.id)}">Chỉ ${esc(sessionLabel(sh, s.id))}</option>`).join('')}
        </select>`;
    } else {
      html += `<button class="btn primary" id="addPlan">+ Thêm dòng kế hoạch</button>`;
    }
    html += `<span class="spacer"></span>
      <button class="btn" id="exportCsv">Xuất Excel (CSV)</button>
      <button class="btn" id="printBtn">In</button>
      <button class="btn" id="backupBtn" title="Lấy toàn bộ dữ liệu (chép hoặc tải file)">Sao lưu</button>
      <button class="btn" id="restoreBtn" title="Dán hoặc chọn file sao lưu">Khôi phục</button>`;
    $('#toolbar').innerHTML = html;
    if (def.type === 'sessions') $('#sessionFilter').value = String(ui.session);

    $('#hint').innerHTML = def.type === 'sessions'
      ? `Hàng <b>“Tổng số câu”</b>: nhập tổng số câu của bài. Ô điểm: nhập <b>số câu đúng</b> → tự quy đổi <b>/10</b>.
         Điểm danh: bấm 1 lần = <b>✓ có mặt</b>, 2 lần = <b>✗ vắng</b> (cả dòng bôi đỏ), 3 lần = xoá.
         Bấm nút <b>×</b> trên tiêu đề để xoá cột / xoá buổi; bấm đúp tên cột để đổi tên.
         ${def.target ? 'Cột <b>Điểm mục tiêu</b>: ô điểm <b>≥ mục tiêu</b> bôi xanh, <b>dưới 5</b> bôi đỏ, còn lại giữ nguyên. ' : ''}
         <span class="legend">${def.target ? '<span class="hit">đạt mục tiêu</span><span class="low">dưới 5</span>' : ''}<span class="good">≥8</span><span class="ok">6,5–8</span><span class="mid">5–6,5</span><span class="bad">&lt;5</span><span class="abs">vắng</span></span>`
      : 'Lập kế hoạch học IELTS cho ' + esc(className(ui.cls)) + '. Dữ liệu tự lưu trên trình duyệt này.';
  }

  function renderContent() {
    const wrap = $('#content');
    const sl = wrap.scrollLeft, st = wrap.scrollTop;
    if (sheetDef(ui.sheet).type === 'sessions') renderSessions();
    else renderPlan();
    wrap.scrollLeft = sl;
    wrap.scrollTop = st;
  }

  function cellHTML(sh, stId, sid, c, extraCls, style) {
    const v = getCell(sh, stId, sid, c.key);
    const ref = `${sid}|${c.key}`;
    const title = `${esc(c.label)} – ${sessionLabel(sh, sid)}`;
    switch (c.type) {
      case 'attend': {
        const cls = isPresent(v) ? 'present' : isAbsent(v) ? 'absent' : '';
        const txt = isPresent(v) ? '✓' : isAbsent(v) ? '✗' : '';
        return `<td class="chk ${extraCls}" ${style}><button class="att-btn ${cls}" data-attcell="${ref}" title="${title}: bấm để đổi ✓ / ✗">${txt}</button></td>`;
      }
      case 'check':
        return `<td class="chk ${extraCls}" ${style}><input type="checkbox" data-cell="${ref}" ${v ? 'checked' : ''} title="${title}"></td>`;
      case 'text':
        return `<td class="text ${extraCls}" ${style}><input type="text" data-cell="${ref}" value="${esc(v ?? '')}" title="${title}"></td>`;
      default: {
        const t = getTotal(sh, sid, c.key);
        const cv = convInfo(v, t);
        const over = num(v) !== null && num(t) !== null && num(v) > num(t);
        const tc = targetClass(sh, stId, toTen(v, t), c);
        return `<td class="score ${extraCls} ${tc}" ${style}><div class="cell"><input type="number" min="0" step="any" data-cell="${ref}" value="${v ?? ''}" class="${over ? 'over' : ''}" placeholder="đúng" title="Số câu đúng – ${title}"><span class="conv ${cv.cls}" data-conv="${ref}">${cv.text}</span></div></td>`;
      }
    }
  }

  function renderSessions() {
    const sh = sheetData(ui.cls, ui.sheet);
    const students = classData(ui.cls).students;
    const sessions = visibleSessions(sh);
    const cols = sh.cols;
    const n = Math.max(cols.length, 1);
    const hasAttend = !!attendCol(sh);
    const st = s => `style="--h:${hueOf(sh, s.id)}"`;
    const hasTarget = !!sheetDef(ui.sheet).target;
    const lead = hasTarget ? 3 : 2;

    let h = `<h2 class="print-title">${esc(className(ui.cls))} – ${esc(sheetDef(ui.sheet).name)}</h2>`;
    h += '<table class="grid"><thead><tr>';
    h += '<th rowspan="2" class="sticky c-stt">STT</th><th rowspan="2" class="sticky c-name">Họ và tên</th>';
    if (hasTarget) h += '<th rowspan="2" class="sticky c-target">Điểm<br>mục tiêu<br>(/10)</th>';
    sessions.forEach(s => {
      h += `<th colspan="${n}" class="sh sess-start" ${st(s)}>${esc(sessionLabel(sh, s.id))} <button class="sess-del" data-delsess="${esc(s.id)}" title="Xoá ${esc(sessionLabel(sh, s.id))}">×</button>${s.name ? '' : `<div><input type="date" class="sdate" data-sdate="${esc(s.id)}" value="${esc(s.date || '')}" title="Ngày học"></div>`}</th>`;
    });
    h += '<th rowspan="3" class="sess-start">Tổng số<br>buổi đi học</th><th rowspan="3">Số buổi<br>vắng</th><th rowspan="3">Điểm TB<br>(/10)</th><th rowspan="3"></th></tr><tr>';
    sessions.forEach(s => {
      if (!cols.length) { h += `<th class="sub ss sess-start" ${st(s)}>(chưa có cột)</th>`; return; }
      cols.forEach((c, i) => {
        h += `<th class="sub ss ${i === 0 ? 'sess-start' : ''}" ${st(s)}><span class="lbl" data-rencol="${esc(c.key)}" title="Bấm đúp để đổi tên">${esc(c.label)}</span><button class="col-del" data-delcol="${esc(c.key)}" title="Xoá cột “${esc(c.label)}”">×</button></th>`;
      });
    });
    h += `</tr><tr class="totals-row"><th colspan="${lead}" class="sticky c-stt" style="text-align:right">Tổng số câu →</th>`;
    sessions.forEach(s => {
      if (!cols.length) { h += `<th class="sc sess-start" ${st(s)}></th>`; return; }
      cols.forEach((c, i) => {
        const cls = `sc ${i === 0 ? 'sess-start' : ''}`;
        if (c.type === 'score') {
          const t = getTotal(sh, s.id, c.key);
          h += `<th class="${cls}" ${st(s)}><input type="number" class="total" min="1" step="1" data-total="${esc(s.id)}|${esc(c.key)}" value="${t ?? ''}" placeholder="tổng" title="Tổng số câu – ${esc(c.label)} – ${sessionLabel(sh, s.id)}"></th>`;
        } else h += `<th class="${cls}" ${st(s)}></th>`;
      });
    });
    h += '</tr></thead><tbody>';

    if (!students.length) {
      h += `<tr><td class="empty" colspan="${lead + sessions.length * n + 4}">Chưa có học sinh. Hãy thêm học sinh ở thanh công cụ phía trên.</td></tr>`;
    }

    students.forEach((stu, idx) => {
      const absentVisible = sessions.some(s => sessionAbsent(sh, stu.id, s.id));
      const rowAbs = absentVisible ? 'absent' : '';
      h += `<tr data-st="${stu.id}"><td class="sticky c-stt ${rowAbs}">${idx + 1}</td>`;
      h += `<td class="sticky c-name ${rowAbs}"><input class="name" data-name="${stu.id}" value="${esc(stu.name)}"></td>`;
      if (hasTarget) h += `<td class="sticky c-target ${rowAbs}"><input type="number" class="target" min="0" max="10" step="0.1" data-target="${stu.id}" value="${sh.targets[stu.id] ?? ''}" placeholder="—" title="Điểm mục tiêu (/10)"></td>`;
      sessions.forEach(s => {
        const abs = sessionAbsent(sh, stu.id, s.id) ? 'absent' : '';
        if (!cols.length) { h += `<td class="sc sess-start ${abs}" ${st(s)}></td>`; return; }
        cols.forEach((c, i) => { h += cellHTML(sh, stu.id, s.id, c, `sc ${i === 0 ? 'sess-start' : ''} ${abs}`, st(s)); });
      });
      const avg = studentAvg(sh, stu.id);
      const att = attendance(sh, stu.id);
      h += `<td class="att sess-start ${rowAbs}" data-att>${hasAttend ? `${att}/${sh.sessions.length}` : '—'}</td>`;
      h += `<td class="att ${rowAbs}" style="color:var(--bad)">${absences(sh, stu.id) || ''}</td>`;
      h += `<td class="avg ${rowAbs}" data-avg><span class="conv ${gradeClass(avg)}">${fmt(avg)}</span></td>`;
      h += `<td class="${rowAbs}"><button class="del" data-del="${stu.id}" title="Xoá học sinh">×</button></td></tr>`;
    });
    h += '</tbody>';

    if (students.length) {
      h += `<tfoot><tr><td colspan="${lead}" class="sticky c-stt" style="text-align:right">TB lớp / Có mặt</td>`;
      sessions.forEach(s => {
        if (!cols.length) { h += `<td class="sc sess-start" ${st(s)}></td>`; return; }
        cols.forEach((c, i) => {
          h += `<td class="sc ${i === 0 ? 'sess-start' : ''}" ${st(s)} data-foot="${esc(s.id)}|${esc(c.key)}"></td>`;
        });
      });
      h += '<td class="sess-start" data-foot="att"></td><td></td><td data-foot="avg"></td><td></td></tr></tfoot>';
    }
    h += '</table>';
    $('#content').innerHTML = h;
    updateFooter();
    fixHeader();
  }

  // Cố định 3 hàng tiêu đề khi cuộn dọc
  const headObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => fixHeader()) : null;
  function fixHeader() {
    const thead = document.querySelector('#content thead');
    if (headObserver && thead && !thead.dataset.observed) {
      thead.dataset.observed = '1';
      headObserver.disconnect();
      thead.querySelectorAll('tr').forEach(tr => headObserver.observe(tr));
    }
    let top = 0;
    document.querySelectorAll('#content thead tr').forEach(tr => {
      tr.querySelectorAll('th').forEach(th => { if (th.rowSpan === 1 || top === 0) th.style.top = top + 'px'; });
      top += tr.getBoundingClientRect().height;
    });
  }

  function updateFooter() {
    const sh = sheetData(ui.cls, ui.sheet);
    const students = classData(ui.cls).students;
    document.querySelectorAll('#content [data-foot]').forEach(td => {
      const f = td.dataset.foot;
      if (f === 'att') {
        const vals = students.map(st => attendance(sh, st.id)).filter(v => v !== null);
        td.textContent = vals.length ? fmt(vals.reduce((a, b) => a + b, 0) / vals.length) + ' buổi' : '';
        return;
      }
      if (f === 'avg') {
        const avgs = students.map(st => studentAvg(sh, st.id)).filter(v => v !== null);
        const a = avgs.length ? avgs.reduce((x, y) => x + y, 0) / avgs.length : null;
        td.innerHTML = `<span class="conv ${gradeClass(a)}">${fmt(a)}</span>`;
        return;
      }
      const [sid, key] = f.split('|');
      const col = sh.cols.find(c => c.key === key);
      if (!col) return;
      if (col.type === 'attend') {
        const cnt = students.filter(st => isPresent(getCell(sh, st.id, sid, key))).length;
        const abs = students.filter(st => isAbsent(getCell(sh, st.id, sid, key))).length;
        td.innerHTML = (cnt || abs) ? `${cnt}/${students.length}${abs ? ` <span style="color:var(--bad)">✗${abs}</span>` : ''}` : '';
      } else if (col.type === 'check') {
        const cnt = students.filter(st => getCell(sh, st.id, sid, key)).length;
        td.textContent = cnt ? `${cnt}/${students.length}` : '';
      } else if (col.type === 'score') {
        const vals = students.map(st => toTen(getCell(sh, st.id, sid, key), getTotal(sh, sid, key))).filter(v => v !== null);
        const a = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
        td.innerHTML = `<span class="conv ${gradeClass(a)}">${fmt(a)}</span>`;
      }
    });
  }

  function updateRow(tr) {
    const sh = sheetData(ui.cls, ui.sheet);
    const stId = tr.dataset.st;
    const avg = studentAvg(sh, stId);
    const att = attendance(sh, stId);
    tr.querySelector('[data-att]').textContent = att === null ? '—' : `${att}/${sh.sessions.length}`;
    tr.querySelector('[data-avg]').innerHTML = `<span class="conv ${gradeClass(avg)}">${fmt(avg)}</span>`;
  }

  function updateScoreCell(tr, sid, key) {
    const sh = sheetData(ui.cls, ui.sheet);
    const v = getCell(sh, tr.dataset.st, sid, key);
    const t = getTotal(sh, sid, key);
    const span = tr.querySelector(`[data-conv="${CSS.escape(sid + '|' + key)}"]`);
    const input = tr.querySelector(`input[data-cell="${CSS.escape(sid + '|' + key)}"]`);
    if (!span || !input) return;
    const cv = convInfo(v, t);
    span.className = 'conv ' + cv.cls;
    span.textContent = cv.text;
    input.classList.toggle('over', num(v) !== null && num(t) !== null && num(v) > num(t));
    const td = input.closest('td');
    td.classList.remove('tgt-hit', 'tgt-low');
    const tc = targetClass(sh, tr.dataset.st, toTen(v, t), sh.cols.find(c => c.key === key));
    if (tc) td.classList.add(tc);
  }

  function renderPlan() {
    const sh = sheetData(ui.cls, ui.sheet);
    let h = `<h2 class="print-title">${esc(className(ui.cls))} – Kế hoạch IELTS</h2>`;
    h += `<table class="grid plan"><thead><tr>
      <th class="w-week">STT / Tuần</th><th class="w-date">Ngày</th><th class="w-skill">Kỹ năng</th>
      <th class="w-content">Nội dung bài học</th><th class="w-mat">Tài liệu</th><th class="w-target">Mục tiêu (band)</th>
      <th class="w-done">Hoàn thành</th><th class="w-note">Ghi chú</th><th></th></tr></thead><tbody>`;
    if (!sh.rows.length) h += '<tr><td class="empty" colspan="9">Chưa có kế hoạch. Bấm “+ Thêm dòng kế hoạch”.</td></tr>';
    sh.rows.forEach((r, i) => {
      h += `<tr class="${r.done ? 'done' : ''}" data-row="${i}">
        <td><input data-plan="week" value="${esc(r.week)}"></td>
        <td><input type="date" data-plan="date" value="${esc(r.date)}"></td>
        <td><select data-plan="skill">${SKILLS.map(sk => `<option ${r.skill === sk ? 'selected' : ''}>${sk}</option>`).join('')}</select></td>
        <td><textarea data-plan="content" rows="1">${esc(r.content)}</textarea></td>
        <td><textarea data-plan="material" rows="1">${esc(r.material)}</textarea></td>
        <td><input data-plan="target" value="${esc(r.target)}"></td>
        <td class="chk"><input type="checkbox" data-plan="done" ${r.done ? 'checked' : ''}></td>
        <td><textarea data-plan="note" rows="1">${esc(r.note)}</textarea></td>
        <td><button class="del" data-delrow="${i}" title="Xoá dòng">×</button></td></tr>`;
    });
    h += '</tbody></table>';
    $('#content').innerHTML = h;
  }

  function renderAll() {
    applyFont();
    renderClassTabs();
    renderSheetTabs();
    renderToolbar();
    renderContent();
  }

  /** Vẽ lại khi người khác sửa, giữ nguyên ô đang nhập của mình */
  const FOCUS_ATTRS = ['data-cell', 'data-total', 'data-name', 'data-target', 'data-plan', 'data-attcell', 'data-sdate'];
  function renderKeepFocus() {
    const a = document.activeElement;
    let keep = null;
    if (a && $('#content').contains(a)) {
      const attr = FOCUS_ATTRS.find(x => a.hasAttribute(x));
      const tr = a.closest('tr');
      if (attr) {
        keep = { attr, val: a.getAttribute(attr), st: tr && tr.dataset.st, row: tr && tr.dataset.row, value: a.value, type: a.type };
        try { keep.s = a.selectionStart; keep.e = a.selectionEnd; } catch (e) { /* number input */ }
      }
    }
    const sh = sheetData(ui.cls, ui.sheet);
    const sessCount = $('#sessionFilter') ? $('#sessionFilter').options.length : -1;
    if (sh.sessions && sessCount !== sh.sessions.length + 1 && !$('#toolbar').contains(a)) renderToolbar();
    renderContent();
    if (!keep) return;
    let scope = '#content ';
    if (keep.st) scope += `tr[data-st="${CSS.escape(keep.st)}"] `;
    else if (keep.row !== undefined) scope += `tr[data-row="${CSS.escape(keep.row)}"] `;
    const el = document.querySelector(`${scope}[${keep.attr}="${CSS.escape(keep.val)}"]`);
    if (!el) return;
    el.focus();
    if (keep.type !== 'checkbox' && el.tagName !== 'BUTTON' && el.tagName !== 'SELECT' && el.value !== keep.value) el.value = keep.value;
    if (keep.s != null) { try { el.setSelectionRange(keep.s, keep.e); } catch (e) { /* ignore */ } }
  }

  // ---------- Hành động ----------
  function addStudents(names) {
    const c = classData(ui.cls);
    const base = Math.max(Date.now(), ...c.students.map(s => (s.order || 0) + 1));
    names.map(x => x.trim()).filter(Boolean).forEach((name, i) => {
      const st = { id: uid(), name, order: base + i };
      c.students.push(st);
      sync(COL_CLASSES, ui.cls, ['students', st.id], { name, order: st.order });
    });
    save();
    renderContent();
  }

  function deleteStudent(id) {
    const c = classData(ui.cls);
    const st = c.students.find(s => s.id === id);
    if (!st) return;
    if (!confirm(`Xoá học sinh “${st.name}” và toàn bộ điểm của em ở tất cả các sheet?`)) return;
    c.students = c.students.filter(s => s.id !== id);
    Object.values(c.sheets).forEach(sh => { if (sh.data) delete sh.data[id]; if (sh.targets) delete sh.targets[id]; });
    sync(COL_CLASSES, ui.cls, ['students', id], undefined);
    SHEETS.filter(d => d.type === 'sessions').forEach(d => {
      sync(COL_SHEETS, sheetDocId(ui.cls, d.id), ['data', id], undefined);
      if (d.target) sync(COL_SHEETS, sheetDocId(ui.cls, d.id), ['targets', id], undefined);
    });
    save();
    renderContent();
  }

  function addColumn(label, type) {
    const sh = sheetData(ui.cls, ui.sheet);
    sh.cols.push({ key: 'c' + uid(), label, type });
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['cols'], sh.cols);
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['sessions'], sh.sessions);
    save();
    renderContent();
  }

  function deleteColumn(key) {
    const sh = sheetData(ui.cls, ui.sheet);
    const col = sh.cols.find(c => c.key === key);
    if (!col) return;
    if (!confirm(`Xoá cột “${col.label}” ở tất cả các buổi của ${className(ui.cls)} – ${sheetDef(ui.sheet).name}?\nDữ liệu trong cột này sẽ bị xoá.`)) return;
    sh.cols = sh.cols.filter(c => c.key !== key);
    Object.values(sh.data).forEach(byS => Object.values(byS).forEach(cells => { delete cells[key]; }));
    Object.values(sh.totals).forEach(t => { delete t[key]; });
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['cols'], sh.cols);
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['sessions'], sh.sessions);
    save();
    renderContent();
  }

  function renameColumn(key) {
    const sh = sheetData(ui.cls, ui.sheet);
    const col = sh.cols.find(c => c.key === key);
    if (!col) return;
    const name = prompt('Tên mới cho cột:', col.label);
    if (name && name.trim()) { col.label = name.trim(); sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['cols'], sh.cols); save(); renderContent(); }
  }

  function addSession() {
    const sh = sheetData(ui.cls, ui.sheet);
    sh.sessions.push({ id: 's' + uid() });
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['sessions'], sh.sessions);
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['cols'], sh.cols);
    save();
    renderToolbar();
    renderContent();
  }

  function deleteSession(sid) {
    const sh = sheetData(ui.cls, ui.sheet);
    const label = sessionLabel(sh, sid);
    if (!confirm(`Xoá ${label} và toàn bộ điểm của buổi này? Các buổi sau sẽ được đánh số lại.`)) return;
    sh.sessions = sh.sessions.filter(s => s.id !== sid);
    Object.values(sh.data).forEach(byS => { delete byS[sid]; });
    delete sh.totals[sid];
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['sessions'], sh.sessions);
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['cols'], sh.cols);
    if (String(ui.session) === sid) { ui.session = 'all'; saveUI(); }
    save();
    renderToolbar();
    renderContent();
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function exportCsv() {
    const def = sheetDef(ui.sheet);
    const sh = sheetData(ui.cls, ui.sheet);
    const rows = [];
    if (def.type === 'sessions') {
      const students = classData(ui.cls).students;
      const hasTarget = !!def.target;
      const head = ['STT', 'Họ và tên'].concat(hasTarget ? ['Điểm mục tiêu'] : []);
      const totalsRow = ['', 'Tổng số câu'].concat(hasTarget ? [''] : []);
      sh.sessions.forEach((s, i) => sh.cols.forEach(c => {
        head.push(`${sessionLabel(sh, s.id)}${s.date ? ' (' + s.date + ')' : ''} - ${c.label}${c.type === 'score' ? ' (/10)' : ''}`);
        totalsRow.push(c.type === 'score' ? (getTotal(sh, s.id, c.key) ?? '') : '');
      }));
      head.push('Tổng số buổi đi học', 'Số buổi vắng', 'Điểm TB (/10)');
      rows.push(head, totalsRow);
      students.forEach((st, i) => {
        const r = [i + 1, st.name].concat(hasTarget ? [fmt(num(sh.targets[st.id]))] : []);
        sh.sessions.forEach(s => sh.cols.forEach(c => {
          const v = getCell(sh, st.id, s.id, c.key);
          if (c.type === 'attend') r.push(isPresent(v) ? 'có mặt' : isAbsent(v) ? 'vắng' : '');
          else if (c.type === 'check') r.push(v ? 'x' : '');
          else if (c.type === 'text') r.push(v ?? '');
          else r.push(fmt(toTen(v, getTotal(sh, s.id, c.key))));
        }));
        const att = attendance(sh, st.id);
        r.push(att === null ? '' : att, absences(sh, st.id), fmt(studentAvg(sh, st.id)));
        rows.push(r);
      });
    } else {
      rows.push(['STT / Tuần', 'Ngày', 'Kỹ năng', 'Nội dung bài học', 'Tài liệu', 'Mục tiêu (band)', 'Hoàn thành', 'Ghi chú']);
      sh.rows.forEach(r => rows.push([r.week, r.date, r.skill, r.content, r.material, r.target, r.done ? 'x' : '', r.note]));
    }
    // Dấu ; để Excel (cài đặt Việt Nam, dấu phẩy thập phân) mở đúng cột
    const csv = '﻿' + 'sep=;\n' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
    download(`${className(ui.cls)} - ${def.name}.csv`, csv, 'text/csv;charset=utf-8');
  }

  function backupText() { saveNow(); return JSON.stringify(state); }

  function backupFile() {
    const d = new Date().toISOString().slice(0, 10);
    download(`so-diem-sao-luu-${d}.json`, backupText(), 'application/json');
  }

  function openBackup() {
    $('#backupText').value = backupText();
    $('#backupMsg').textContent = '';
    $('#backupDialog').showModal();
    $('#backupText').select();
  }

  async function copyBackup() {
    const ta = $('#backupText');
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    if (!ok && navigator.clipboard) {
      try { await navigator.clipboard.writeText(ta.value); ok = true; } catch (e) { ok = false; }
    }
    $('#backupMsg').textContent = ok ? '✅ Đã sao chép. Mở web mới → Khôi phục → dán vào.' : 'Không tự sao chép được: hãy bấm vào ô, nhấn Ctrl+A rồi Ctrl+C (điện thoại: giữ tay → Chọn tất cả → Sao chép).';
  }

  /** Nạp dữ liệu sao lưu (chuỗi JSON) – ghi đè dữ liệu hiện tại */
  function restoreText(text) {
    try {
      const data = JSON.parse(String(text).trim());
      if (!data || typeof data.classes !== 'object') throw new Error('Dữ liệu không đúng định dạng sổ điểm');
      if (!confirm('Khôi phục sẽ GHI ĐÈ toàn bộ dữ liệu hiện tại' + (cloud ? ' (bảng điểm chung của mọi người)' : '') + '. Tiếp tục?')) return false;
      state = data;
      saveNow();
      renderAll();
      if (cloud) uploadAll();
      alert('Đã khôi phục dữ liệu.');
      return true;
    } catch (e) {
      alert('Không đọc được dữ liệu: ' + e.message);
      return false;
    }
  }

  function restore(file) {
    const reader = new FileReader();
    reader.onload = () => { if (restoreText(reader.result)) $('#restoreDialog').close(); };
    reader.readAsText(file);
  }

  // ---------- Sự kiện ----------
  document.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (d.close) { t.closest('dialog').close(); return; }
    if (d.cls) { ui.cls = d.cls; ui.session = 'all'; saveUI(); renderAll(); return; }
    if (d.sheet) { ui.sheet = d.sheet; ui.session = 'all'; saveUI(); renderAll(); return; }
    if (d.del) { deleteStudent(d.del); return; }
    if (d.delcol) { deleteColumn(d.delcol); return; }
    if (d.delsess) { deleteSession(d.delsess); return; }
    if (d.attcell) {
      // Vòng: trống → ✓ có mặt → ✗ vắng → trống
      const tr = t.closest('tr[data-st]');
      const [sid, key] = d.attcell.split('|');
      const sh = sheetData(ui.cls, ui.sheet);
      const v = getCell(sh, tr.dataset.st, sid, key);
      const next = isPresent(v) ? 'x' : isAbsent(v) ? null : true;
      writeCell(tr.dataset.st, sid, key, next);
      renderContent();
      const again = document.querySelector(`tr[data-st="${CSS.escape(tr.dataset.st)}"] [data-attcell="${CSS.escape(d.attcell)}"]`);
      if (again) again.focus();
      return;
    }
    if (d.delrow !== undefined) {
      const sh = sheetData(ui.cls, ui.sheet);
      if (confirm('Xoá dòng kế hoạch này?')) { sh.rows.splice(Number(d.delrow), 1); sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['rows'], sh.rows); save(); renderContent(); }
      return;
    }
    switch (t.id) {
      case 'addStudent': {
        const inp = $('#newStudent');
        addStudents([inp.value]);
        inp.value = '';
        inp.focus();
        break;
      }
      case 'bulkAdd': $('#bulkNames').value = ''; $('#bulkDialog').showModal(); break;
      case 'addCol': $('#colName').value = ''; $('#colType').value = 'score'; $('#colDialog').showModal(); break;
      case 'addSession': addSession(); break;
      case 'addPlan': {
        const sh = sheetData(ui.cls, ui.sheet);
        sh.rows.push({ week: String(sh.rows.length + 1), date: '', skill: 'Listening', content: '', material: '', target: '', done: false, note: '' });
        sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['rows'], sh.rows);
        save();
        renderContent();
        break;
      }
      case 'exportCsv': exportCsv(); break;
      case 'printBtn': window.print(); break;
      case 'backupBtn': openBackup(); break;
      case 'copyBackup': copyBackup(); break;
      case 'fileBackup': backupFile(); break;
      case 'restoreBtn': $('#restoreText').value = ''; $('#restoreDialog').showModal(); break;
      case 'restorePasteOk': if (restoreText($('#restoreText').value)) $('#restoreDialog').close(); break;
      case 'restoreFile': $('#importFile').click(); break;
    }
  });

  document.addEventListener('dblclick', e => {
    const lbl = e.target.closest('[data-rencol]');
    if (lbl) renameColumn(lbl.dataset.rencol);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'newStudent') {
      e.preventDefault();
      $('#addStudent').click();
    }
  });

  $('#bulkDialog').addEventListener('close', () => {
    if ($('#bulkDialog').returnValue === 'ok') addStudents($('#bulkNames').value.split(/\r?\n/));
  });
  $('#colDialog').addEventListener('close', () => {
    const name = $('#colName').value.trim();
    if ($('#colDialog').returnValue === 'ok' && name) addColumn(name, $('#colType').value);
  });

  $('#importFile').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) restore(f);
    e.target.value = '';
  });

  $('#fontSel').addEventListener('change', e => { ui.font = e.target.value; saveUI(); applyFont(); fixHeader(); });
  $('#sizeSel').addEventListener('change', e => { ui.size = Number(e.target.value); saveUI(); applyFont(); fixHeader(); });
  window.addEventListener('resize', fixHeader);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fixHeader);

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'sessionFilter') { ui.session = t.value; saveUI(); renderContent(); return; }
    if (t.dataset.sdate) {
      const sh = sheetData(ui.cls, ui.sheet);
      const ses = sh.sessions.find(x => x.id === t.dataset.sdate);
      if (ses) {
        if (t.value) ses.date = t.value; else delete ses.date;
        sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['sessions'], sh.sessions);
        save();
      }
      return;
    }
    if (t.type === 'checkbox' && t.dataset.cell) { setCell(t, t.checked); return; }
    if (t.dataset.plan && (t.type === 'checkbox' || t.tagName === 'SELECT' || t.type === 'date')) setPlan(t);
  });

  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.target) {
      const sh = sheetData(ui.cls, ui.sheet);
      const v = num(t.value);
      if (v === null) delete sh.targets[t.dataset.target]; else sh.targets[t.dataset.target] = v;
      sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['targets', t.dataset.target], v === null ? undefined : v);
      save();
      const tr = t.closest('tr[data-st]');
      tr.querySelectorAll('input[data-cell][type=number]').forEach(inp => {
        const [sid, key] = inp.dataset.cell.split('|');
        updateScoreCell(tr, sid, key);
      });
      return;
    }
    if (t.dataset.name) {
      const st = classData(ui.cls).students.find(s => s.id === t.dataset.name);
      if (st) { st.name = t.value; sync(COL_CLASSES, ui.cls, ['students', st.id, 'name'], st.name); save(); }
      return;
    }
    if (t.dataset.total) {
      const [sid, key] = t.dataset.total.split('|');
      const sh = sheetData(ui.cls, ui.sheet);
      if (!sh.totals[sid]) sh.totals[sid] = {};
      const v = num(t.value);
      if (v === null) delete sh.totals[sid][key]; else sh.totals[sid][key] = v;
      sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['totals', sid, key], v === null ? undefined : v);
      save();
      document.querySelectorAll('#content tbody tr[data-st]').forEach(tr => { updateScoreCell(tr, sid, key); updateRow(tr); });
      updateFooter();
      return;
    }
    if (t.dataset.cell && t.type === 'number') { setCell(t, num(t.value)); return; }
    if (t.dataset.cell && t.type === 'text') { setCell(t, t.value === '' ? null : t.value); return; }
    if (t.dataset.plan && t.type !== 'checkbox' && t.tagName !== 'SELECT' && t.type !== 'date') setPlan(t);
  });

  function writeCell(stId, sid, key, value) {
    const sh = sheetData(ui.cls, ui.sheet);
    if (!sh.data[stId]) sh.data[stId] = {};
    if (!sh.data[stId][sid]) sh.data[stId][sid] = {};
    if (value === null || value === false) delete sh.data[stId][sid][key];
    else sh.data[stId][sid][key] = value;
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['data', stId, sid, key], value === null || value === false ? undefined : value);
    save();
  }

  function setCell(input, value) {
    const tr = input.closest('tr[data-st]');
    const [sid, key] = input.dataset.cell.split('|');
    writeCell(tr.dataset.st, sid, key, value);
    if (input.type === 'number') updateScoreCell(tr, sid, key);
    updateRow(tr);
    updateFooter();
  }

  function setPlan(input) {
    const tr = input.closest('tr[data-row]');
    const sh = sheetData(ui.cls, ui.sheet);
    const row = sh.rows[Number(tr.dataset.row)];
    const f = input.dataset.plan;
    row[f] = input.type === 'checkbox' ? input.checked : input.value;
    if (f === 'done') tr.classList.toggle('done', input.checked);
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['rows'], sh.rows);
    save();
  }

  renderFontControls();
  renderAll();
})();
