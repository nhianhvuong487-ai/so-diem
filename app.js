/* Sổ điểm học sinh – lưu dữ liệu trong localStorage của trình duyệt */
(function () {
  'use strict';

  const STORAGE_KEY = 'so-diem-data-v1';
  const UI_KEY = 'so-diem-ui-v1';
  const DEFAULT_SESSIONS = 10;

  const DEFAULT_CLASSES = [
    { id: '7', name: 'Lớp 7' },
    { id: '8', name: 'Lớp 8' },
    { id: '9.1', name: '9.1', group: 'Lớp 9' },
    { id: '9.2', name: '9.2', group: 'Lớp 9' },
    { id: '9.S', name: '9.S', group: 'Lớp 9' },
    { id: 'ielts', name: 'Lớp IELTS', notes: [
      { key: 'btvn', label: 'Ghi chú kiểm tra BTVN' },
      { key: 'ktdg', label: 'Nội dung bài KT đầu giờ' },
    ] },
  ];
  // Danh sách lớp có thể thêm / xoá (lưu trong state.config, đồng bộ qua doc "_config")
  let CLASSES = DEFAULT_CLASSES.map(c => Object.assign({}, c));
  let TRASH = [];   // lớp đã xoá – vẫn giữ dữ liệu, khôi phục được
  const CONFIG_DOC = '_config';

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
  applyConfig(state.config);
  if (!CLASSES.some(c => c.id === ui.cls)) ui.cls = CLASSES.length ? CLASSES[0].id : '7';

  function applyConfig(cfg) {
    if (cfg && Array.isArray(cfg.classes)) {
      CLASSES = cfg.classes.map(c => Object.assign({}, c));
      TRASH = Array.isArray(cfg.trash) ? cfg.trash.map(c => Object.assign({}, c)) : [];
    } else {
      CLASSES = DEFAULT_CLASSES.map(c => Object.assign({}, c));
      TRASH = [];
    }
  }
  function configObj() { return { classes: clone(CLASSES), trash: clone(TRASH) }; }
  function saveConfig() {
    state.config = configObj();
    sync(COL_CLASSES, CONFIG_DOC, ['classes'], state.config.classes);
    sync(COL_CLASSES, CONFIG_DOC, ['trash'], state.config.trash);
    save();
  }
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
      if (id === CONFIG_DOC) {
        state.config = d && Array.isArray(d.classes) ? d : undefined;
        applyConfig(state.config);
        return;
      }
      classData(id).students = studentsFromMap(d.students);
    } else if (col === COL_SHEETS) {
      const i = id.lastIndexOf('__');
      if (i <= 0) return;
      const cid = id.slice(0, i), sid = id.slice(i + 2);
      if (!sheetDef(sid)) return;
      classData(cid).sheets[sid] = d;
    }
  }

  function viewSnapshot() {
    return JSON.stringify([classData(ui.cls).students, sheetData(ui.cls, ui.sheet)]);
  }
  function configSnapshot() { return JSON.stringify([CLASSES, TRASH]); }

  let remoteRenderTimer = null;
  function onRemoteDoc(col, id, data) {
    const cfgBefore = configSnapshot();
    const before = viewSnapshot();
    applyDoc(col, id, data);
    save();
    if (configSnapshot() !== cfgBefore) {
      if (!CLASSES.some(c => c.id === ui.cls)) { ui.cls = CLASSES.length ? CLASSES[0].id : ui.cls; ui.session = 'all'; }
      renderClassTabs();
      if ($('#classDialog').open) renderClassManager();
    }
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
    jobs.push(cloud.replace(COL_CLASSES, CONFIG_DOC, configObj()));
    Object.keys(state.classes).forEach(cid => {
      if (!CLASSES.some(c => c.id === cid) && !TRASH.some(c => c.id === cid)) return;
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
        applyConfig(undefined);
        all[COL_CLASSES].forEach(d => applyDoc(COL_CLASSES, d.id, d.data));
        if (!CLASSES.some(c => c.id === ui.cls)) { ui.cls = CLASSES.length ? CLASSES[0].id : ui.cls; ui.session = 'all'; }
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
    const n = Number(typeof v === 'string' ? v.trim().replace(',', '.') : v);
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
  /** Các cột hiển thị trong một buổi (cột có thể chỉ áp dụng / bị xoá ở một số buổi) */
  function colsFor(sh, sid) {
    return sh.cols.filter(c => (!c.only || c.only.includes(sid)) && !(c.skip || []).includes(sid));
  }
  function isMark(c) { return c.type === 'attend' || c.type === 'check'; }
  function attendCol(sh) { return sh.cols.find(c => c.type === 'attend'); }
  function isPresent(v) { return v === true || v === 'v'; }
  function isAbsent(v) { return v === 'x'; }
  function sessionAbsent(sh, stId, sid) {
    return colsFor(sh, sid).some(c => c.type === 'attend' && isAbsent(getCell(sh, stId, sid, c.key)));
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
    sh.sessions.forEach(s => colsFor(sh, s.id).forEach(c => {
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

  /** Màu ô điểm.
   *  Sheet có điểm mục tiêu (khảo sát): ≥ mục tiêu xanh, < 5 đỏ, còn lại giữ nguyên.
   *  Sheet khác: ≥ 5 xanh, < 5 đỏ. */
  function targetClass(sh, stId, score, col) {
    if (score === null || score === undefined) return '';
    if (!sh.targets) return score >= 5 ? 'tgt-hit' : 'tgt-low';
    const tg = num(sh.targets[stId]);
    if (tg !== null && score >= tg && !(col && col.noTarget)) return 'tgt-hit';
    if (score < 5) return 'tgt-low';
    return '';
  }
  /** Nội dung hiển thị trong ô điểm khi không gõ: điểm /10 (hoặc số câu đúng nếu chưa có tổng) */
  function scoreDisplay(v, t) {
    const sc = toTen(v, t);
    if (sc !== null) return fmt(sc);
    return num(v) === null ? '' : fmt(num(v));
  }
  function scoreTitle(v, t, label) {
    const c = num(v), tt = num(t);
    if (c === null) return `${label}: nhập số câu đúng`;
    if (tt === null || tt <= 0) return `${label}: ${fmt(c)} câu đúng – chưa nhập tổng số câu`;
    return `${label}: ${fmt(c)}/${fmt(tt)} câu đúng = ${fmt(toTen(c, tt))} điểm`;
  }

  // ---------- Helpers ----------
  const $ = sel => document.querySelector(sel);
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function className(cid) {
    const c = CLASSES.find(x => x.id === cid) || TRASH.find(x => x.id === cid);
    if (!c) return 'Lớp';
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
          html += `<button data-cls="${esc(x.id)}" class="${x.id === ui.cls ? 'active' : ''}">${esc(x.name)} <span class="cnt" data-cnt="${esc(x.id)}"></span></button>`;
          i++;
        }
        html += '</div>';
      } else {
        html += `<button data-cls="${esc(c.id)}" class="${c.id === ui.cls ? 'active' : ''}">${esc(c.name)} <span class="cnt" data-cnt="${esc(c.id)}"></span></button>`;
        i++;
      }
    }
    html += `<button class="cls-manage" id="manageClasses" title="Thêm, đổi tên, xoá hoặc khôi phục lớp">⚙ Lớp</button>`;
    $('#classTabs').innerHTML = html;
    updateCounts();
  }

  /** Sĩ số từng lớp: số trên nút lớp + dòng tổng */
  function updateCounts() {
    let all = 0;
    CLASSES.forEach(c => {
      const n = classData(c.id).students.length;
      all += n;
      const el = document.querySelector(`[data-cnt="${CSS.escape(c.id)}"]`);
      if (el) el.textContent = n;
    });
    const stat = document.getElementById('classStat');
    if (stat) stat.innerHTML = `${esc(className(ui.cls))}: <b>${classData(ui.cls).students.length}</b> học sinh · Tất cả các lớp: <b>${all}</b> học sinh`;
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
        <button class="btn" id="sortNames" title="Sắp xếp theo tên (chữ cuối của họ tên), ví dụ “Thu An” xếp theo “An”">↕ Sắp xếp A→Z</button>
        <button class="btn soft" id="addCol">+ Thêm cột</button>
        <button class="btn soft" id="delCol">− Xoá cột</button>
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
      ? `Hàng <b>“Tổng số câu”</b>: nhập tổng số câu của bài. Ô điểm: nhập <b>số câu đúng</b> → khi rời ô sẽ tự hiện <b>điểm /10</b> (bấm lại vào ô để xem/sửa số câu đúng).
         Điểm danh, BTVN, chép nghe, chép phạt: bấm 1 lần = <b>✓</b>, 2 lần = <b>✗</b>, 3 lần = xoá. Vắng (✗ điểm danh) thì chỉ các ô của buổi đó bôi đỏ. Nút <b>↕ Sắp xếp A→Z</b> xếp theo tên (chữ cuối của họ tên). Dùng phím <b>← → ↑ ↓</b> để di chuyển giữa các ô, <b>Enter</b> để xuống ô dưới.
         ${def.target ? 'Cột <b>Điểm mục tiêu</b>: ô điểm <b>≥ mục tiêu</b> bôi xanh, <b>dưới 5</b> bôi đỏ, còn lại giữ nguyên.' : 'Điểm <b>từ 5 trở lên</b> bôi xanh, <b>dưới 5</b> bôi đỏ.'}
         <span class="legend"><span class="hit">${def.target ? 'đạt mục tiêu' : '≥ 5'}</span><span class="low">dưới 5</span><span class="abs">vắng</span></span>`
      : 'Lập kế hoạch học IELTS cho ' + esc(className(ui.cls)) + '. Dữ liệu tự lưu trên trình duyệt này.';
  }

  function renderContent() {
    const wrap = $('#content');
    const sl = wrap.scrollLeft, st = wrap.scrollTop;
    updateCounts();
    if (sheetDef(ui.sheet).type === 'sessions') renderSessions();
    else renderPlan();
    wrap.scrollLeft = sl;
    wrap.scrollTop = st;
  }

  function cellHTML(sh, stId, sid, c, extraCls, style) {
    const v = getCell(sh, stId, sid, c.key);
    const ref = `${sid}|${c.key}`;
    const title = `${esc(c.label)} – ${esc(sessionLabel(sh, sid))}`;
    if (isMark(c)) {
      const cls = isPresent(v) ? 'present' : isAbsent(v) ? 'absent' : '';
      const txt = isPresent(v) ? '✓' : isAbsent(v) ? '✗' : '';
      const tint = c.type === 'check' ? (isPresent(v) ? 'mark-yes' : isAbsent(v) ? 'mark-no' : '') : '';
      return `<td class="chk ${extraCls} ${tint}" ${style}><button class="att-btn ${cls}" data-attcell="${ref}" title="${title}: bấm để đổi ✓ / ✗">${txt}</button></td>`;
    }
    if (c.type === 'text') {
      return `<td class="text ${extraCls}" ${style}><input type="text" data-cell="${ref}" value="${esc(v ?? '')}" title="${title}"></td>`;
    }
    const t = getTotal(sh, sid, c.key);
    const over = num(v) !== null && num(t) !== null && num(v) > num(t);
    const noTotal = num(v) !== null && (num(t) === null || num(t) <= 0);
    const tc = targetClass(sh, stId, toTen(v, t), c);
    return `<td class="score ${extraCls} ${tc}" ${style}><input type="text" inputmode="decimal" class="score-in ${over ? 'over' : ''} ${noTotal ? 'nototal' : ''}" data-cell="${ref}" data-kind="score" value="${esc(scoreDisplay(v, t))}" placeholder="–" title="${esc(scoreTitle(v, t, c.label + ' – ' + sessionLabel(sh, sid)))}"></td>`;
  }

  function renderSessions() {
    const sh = sheetData(ui.cls, ui.sheet);
    const students = classData(ui.cls).students;
    const sessions = visibleSessions(sh);
    const hasAttend = !!attendCol(sh);
    const st = s => `style="--h:${hueOf(sh, s.id)}"`;
    const hasTarget = !!sheetDef(ui.sheet).target;
    const lead = hasTarget ? 3 : 2;
    const cf = {};
    sessions.forEach(s => { cf[s.id] = colsFor(sh, s.id); });
    const width = sessions.reduce((a, s) => a + Math.max(cf[s.id].length, 1), 0);
    const notes = ui.sheet === 'trenlop' ? ((CLASSES.find(c => c.id === ui.cls) || {}).notes || []) : [];

    let h = `<h2 class="print-title">${esc(className(ui.cls))} – ${esc(sheetDef(ui.sheet).name)}</h2>`;
    h += '<table class="grid"><thead><tr>';
    h += '<th rowspan="2" class="sticky c-stt">STT</th><th rowspan="2" class="sticky c-name">Họ và tên</th>';
    if (hasTarget) h += '<th rowspan="2" class="sticky c-target">Điểm<br>mục tiêu<br>(/10)</th>';
    sessions.forEach(s => {
      h += `<th colspan="${Math.max(cf[s.id].length, 1)}" class="sh sess-start" ${st(s)}>${esc(sessionLabel(sh, s.id))} <button class="sess-del" data-delsess="${esc(s.id)}" title="Xoá ${esc(sessionLabel(sh, s.id))}">×</button>${s.name ? '' : `<div><input type="date" class="sdate" data-sdate="${esc(s.id)}" value="${esc(s.date || '')}" title="Ngày học"></div>`}</th>`;
    });
    h += '<th rowspan="3" class="sess-start">Tổng số<br>buổi đi học</th><th rowspan="3">Số buổi<br>vắng</th><th rowspan="3">Điểm TB<br>(/10)</th><th rowspan="3"></th></tr><tr>';
    sessions.forEach(s => {
      if (!cf[s.id].length) { h += `<th class="sub ss sess-start" ${st(s)}>(chưa có cột)</th>`; return; }
      cf[s.id].forEach((c, i) => {
        h += `<th class="sub ss ${i === 0 ? 'sess-start' : ''}" ${st(s)}><span class="lbl" data-rencol="${esc(c.key)}" title="Bấm đúp để đổi tên">${esc(c.label)}</span><button class="col-del" data-delcol="${esc(c.key)}" data-delcolsess="${esc(s.id)}" title="Xoá cột “${esc(c.label)}”">×</button></th>`;
      });
    });
    h += `</tr><tr class="totals-row"><th colspan="${lead}" class="sticky c-stt" style="text-align:right">Tổng số câu →</th>`;
    sessions.forEach(s => {
      if (!cf[s.id].length) { h += `<th class="sc sess-start" ${st(s)}></th>`; return; }
      cf[s.id].forEach((c, i) => {
        const cls = `sc ${i === 0 ? 'sess-start' : ''}`;
        if (c.type === 'score') {
          const t = getTotal(sh, s.id, c.key);
          h += `<th class="${cls}" ${st(s)}><input type="text" inputmode="decimal" class="total" data-total="${esc(s.id)}|${esc(c.key)}" value="${esc(t ?? '')}" placeholder="tổng" title="Tổng số câu – ${esc(c.label)} – ${esc(sessionLabel(sh, s.id))}"></th>`;
        } else h += `<th class="${cls}" ${st(s)}></th>`;
      });
    });
    h += '</tr></thead><tbody>';

    if (!students.length) {
      h += `<tr><td class="empty" colspan="${lead + width + 4}">Chưa có học sinh. Hãy thêm học sinh ở thanh công cụ phía trên.</td></tr>`;
    }

    students.forEach((stu, idx) => {
      h += `<tr data-st="${stu.id}"><td class="sticky c-stt">${idx + 1}</td>`;
      h += `<td class="sticky c-name"><input class="name" data-name="${stu.id}" value="${esc(stu.name)}"></td>`;
      if (hasTarget) h += `<td class="sticky c-target"><input type="text" inputmode="decimal" class="target" data-target="${stu.id}" value="${esc(sh.targets[stu.id] ?? '')}" placeholder="—" title="Điểm mục tiêu (/10)"></td>`;
      sessions.forEach(s => {
        const abs = sessionAbsent(sh, stu.id, s.id) ? 'absent' : '';
        if (!cf[s.id].length) { h += `<td class="sc sess-start ${abs}" ${st(s)}></td>`; return; }
        cf[s.id].forEach((c, i) => { h += cellHTML(sh, stu.id, s.id, c, `sc ${i === 0 ? 'sess-start' : ''} ${abs}`, st(s)); });
      });
      const avg = studentAvg(sh, stu.id);
      const att = attendance(sh, stu.id);
      h += `<td class="att sess-start" data-att>${hasAttend ? `${att}/${sh.sessions.length}` : '—'}</td>`;
      h += `<td class="att" style="color:var(--bad)">${absences(sh, stu.id) || ''}</td>`;
      h += `<td class="avg" data-avg><span class="conv ${gradeClass(avg)}">${fmt(avg)}</span></td>`;
      h += `<td><button class="del" data-del="${stu.id}" title="Xoá học sinh">×</button></td></tr>`;
    });

    // Dòng ghi chú theo buổi (lớp IELTS)
    notes.forEach(nt => {
      h += `<tr class="note-row"><td colspan="${lead}" class="sticky c-stt note-lbl">${esc(nt.label)}</td>`;
      sessions.forEach(s => {
        const val = sh.notes && sh.notes[s.id] ? sh.notes[s.id][nt.key] : '';
        h += `<td colspan="${Math.max(cf[s.id].length, 1)}" class="sc sess-start note-cell" ${st(s)}><textarea data-note="${esc(s.id)}|${esc(nt.key)}" rows="3" placeholder="${esc(nt.label)} – ${esc(sessionLabel(sh, s.id))}">${esc(val || '')}</textarea></td>`;
      });
      h += '<td colspan="4" class="sess-start"></td></tr>';
    });
    h += '</tbody>';

    if (students.length) {
      h += `<tfoot><tr><td colspan="${lead}" class="sticky c-stt" style="text-align:right">TB lớp / Có mặt</td>`;
      sessions.forEach(s => {
        if (!cf[s.id].length) { h += `<td class="sc sess-start" ${st(s)}></td>`; return; }
        cf[s.id].forEach((c, i) => {
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
    // Cột cố định bên trái: đo độ rộng thật để cột điểm mục tiêu luôn nằm sát cột tên
    const table = document.querySelector('#content table.grid');
    const stt = document.querySelector('#content thead th.c-stt');
    const name = document.querySelector('#content thead th.c-name');
    if (table && stt && name) {
      table.style.setProperty('--left-name', stt.getBoundingClientRect().width + 'px');
      table.style.setProperty('--left-target', (stt.getBoundingClientRect().width + name.getBoundingClientRect().width) + 'px');
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
        const yes = students.filter(st => isPresent(getCell(sh, st.id, sid, key))).length;
        const no = students.filter(st => isAbsent(getCell(sh, st.id, sid, key))).length;
        td.innerHTML = (yes || no) ? `✓${yes}${no ? ` <span style="color:var(--bad)">✗${no}</span>` : ''}` : '';
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
    const input = tr.querySelector(`input[data-cell="${CSS.escape(sid + '|' + key)}"]`);
    if (!input) return;
    const col = sh.cols.find(c => c.key === key);
    if (document.activeElement !== input) input.value = scoreDisplay(v, t);
    input.title = scoreTitle(v, t, (col ? col.label : '') + ' – ' + sessionLabel(sh, sid));
    input.classList.toggle('over', num(v) !== null && num(t) !== null && num(v) > num(t));
    input.classList.toggle('nototal', num(v) !== null && (num(t) === null || num(t) <= 0));
    const td = input.closest('td');
    td.classList.remove('tgt-hit', 'tgt-low');
    const tc = targetClass(sh, tr.dataset.st, toTen(v, t), col);
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
  const FOCUS_ATTRS = ['data-cell', 'data-total', 'data-name', 'data-target', 'data-plan', 'data-attcell', 'data-sdate', 'data-note'];
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

  // ---------- Quản lý lớp: thêm / đổi tên / xoá (vào thùng rác) / khôi phục ----------
  function fullClassName(c) { return c.group ? c.group + ' – ' + c.name : c.name; }
  function renderClassManager() {
    $('#classList').innerHTML = CLASSES.map((c, i) => `
      <li><span class="cl-name">${esc(fullClassName(c))}</span>
        <span class="muted">${classData(c.id).students.length} HS</span>
        <span class="cl-actions">
          <button type="button" class="btn" data-clsup="${i}" ${i === 0 ? 'disabled' : ''} title="Lên">↑</button>
          <button type="button" class="btn" data-clsdown="${i}" ${i === CLASSES.length - 1 ? 'disabled' : ''} title="Xuống">↓</button>
          <button type="button" class="btn" data-clsren="${esc(c.id)}">Đổi tên</button>
          <button type="button" class="btn danger-soft" data-clsdel="${esc(c.id)}">Xoá</button>
        </span></li>`).join('');
    $('#trashBox').hidden = !TRASH.length;
    $('#trashList').innerHTML = TRASH.map(c => `
      <li><span class="cl-name">${esc(fullClassName(c))}</span>
        <span class="muted">${classData(c.id).students.length} HS · xoá lúc ${esc(new Date(c.deletedAt || 0).toLocaleString('vi-VN'))}</span>
        <span class="cl-actions"><button type="button" class="btn primary" data-clsrestore="${esc(c.id)}">↺ Khôi phục</button></span></li>`).join('');
  }
  function openClassManager() {
    $('#newClassName').value = '';
    renderClassManager();
    $('#classDialog').showModal();
  }
  function afterClassChange() {
    saveConfig();
    renderClassManager();
    renderClassTabs();
    renderToolbar();
    renderContent();
  }
  function addClass() {
    const name = $('#newClassName').value.trim();
    if (!name) { $('#newClassName').focus(); return; }
    if ([...CLASSES, ...TRASH].some(c => fullClassName(c).toLowerCase() === name.toLowerCase() || c.name.toLowerCase() === name.toLowerCase())) {
      if (!confirm(`Đã có lớp tên “${name}” (hoặc trong mục Lớp đã xoá). Vẫn tạo lớp mới trùng tên?`)) return;
    }
    const c = { id: 'c' + uid(), name };
    CLASSES.push(c);
    $('#newClassName').value = '';
    ui.cls = c.id; ui.session = 'all'; saveUI();
    afterClassChange();
  }
  function renameClass(id) {
    const c = CLASSES.find(x => x.id === id);
    if (!c) return;
    const name = prompt('Tên mới cho lớp:', c.name);
    if (!name || !name.trim()) return;
    c.name = name.trim();
    afterClassChange();
  }
  function deleteClass(id) {
    const c = CLASSES.find(x => x.id === id);
    if (!c) return;
    const n = classData(id).students.length;
    if (!confirm(`Xoá lớp “${fullClassName(c)}” (${n} học sinh)?\n\nLớp sẽ được chuyển vào mục “Lớp đã xoá”. Học sinh và điểm vẫn được giữ nguyên, bạn có thể KHÔI PHỤC lại bất cứ lúc nào.`)) return;
    const pos = CLASSES.findIndex(x => x.id === id);
    CLASSES = CLASSES.filter(x => x.id !== id);
    TRASH.unshift(Object.assign({}, c, { deletedAt: Date.now(), pos }));
    if (ui.cls === id) { ui.cls = CLASSES.length ? CLASSES[0].id : ui.cls; ui.session = 'all'; saveUI(); }
    afterClassChange();
  }
  function restoreClass(id) {
    const c = TRASH.find(x => x.id === id);
    if (!c) return;
    TRASH = TRASH.filter(x => x.id !== id);
    const back = Object.assign({}, c);
    delete back.deletedAt;
    delete back.pos;
    const pos = Number.isInteger(c.pos) ? Math.min(Math.max(c.pos, 0), CLASSES.length) : CLASSES.length;
    CLASSES.splice(pos, 0, back);
    ui.cls = id; ui.session = 'all'; saveUI();
    afterClassChange();
  }
  function moveClass(i, d) {
    const j = i + d;
    if (j < 0 || j >= CLASSES.length) return;
    [CLASSES[i], CLASSES[j]] = [CLASSES[j], CLASSES[i]];
    afterClassChange();
  }

  /** Sắp xếp học sinh theo tên (chữ cuối), rồi đến họ và tên đệm – theo bảng chữ cái tiếng Việt */
  const viCollator = new Intl.Collator('vi', { sensitivity: 'base', numeric: true });
  function nameKey(full) {
    const w = String(full || '').trim().split(/\s+/);
    return { given: w[w.length - 1] || '', rest: w.slice(0, -1).join(' ') };
  }
  function sortStudents() {
    const c = classData(ui.cls);
    if (c.students.length < 2) return;
    if (!confirm(`Sắp xếp ${c.students.length} học sinh của ${className(ui.cls)} theo tên A→Z?\n(Ví dụ “Thu An” xếp theo chữ “An”.)`)) return;
    c.students.sort((a, b) => {
      const x = nameKey(a.name), y = nameKey(b.name);
      return viCollator.compare(x.given, y.given) || viCollator.compare(x.rest, y.rest) || viCollator.compare(a.name, b.name);
    });
    c.students.forEach((st, i) => {
      st.order = i + 1;
      sync(COL_CLASSES, ui.cls, ['students', st.id, 'order'], st.order);
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

  function syncColsSessions(sh) {
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['cols'], sh.cols);
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['sessions'], sh.sessions);
  }

  /** Ô chọn buổi trong hộp thoại thêm / xoá cột */
  function sessionPicker(box, checkedIds) {
    const sh = sheetData(ui.cls, ui.sheet);
    box.innerHTML = sh.sessions.map(s => `<label class="pick" style="--h:${hueOf(sh, s.id)}"><input type="checkbox" value="${esc(s.id)}" ${checkedIds.includes(s.id) ? 'checked' : ''}> ${esc(sessionLabel(sh, s.id))}</label>`).join('') +
      '<span class="pick-all"><button type="button" class="btn" data-pickall="1">Chọn tất cả</button><button type="button" class="btn" data-pickall="0">Bỏ chọn</button></span>';
  }
  function pickedSessions(box) { return [...box.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value); }

  function openAddColumn() {
    const sh = sheetData(ui.cls, ui.sheet);
    $('#colName').value = '';
    $('#colType').value = 'score';
    sessionPicker($('#colSessions'), sh.sessions.map(s => s.id));
    $('#colDialog').showModal();
  }

  function addColumn(label, type, sids) {
    const sh = sheetData(ui.cls, ui.sheet);
    if (!sids.length) { alert('Hãy chọn ít nhất một buổi.'); return; }
    const col = { key: 'c' + uid(), label, type };
    if (sids.length < sh.sessions.length) col.only = sids;
    sh.cols.push(col);
    syncColsSessions(sh);
    save();
    renderContent();
  }

  function openDeleteColumn(key, sid) {
    const sh = sheetData(ui.cls, ui.sheet);
    if (!sh.cols.length) { alert('Không còn cột nào để xoá.'); return; }
    $('#delColSel').innerHTML = sh.cols.map(c => `<option value="${esc(c.key)}">${esc(c.label)}</option>`).join('');
    if (key) $('#delColSel').value = key;
    sessionPicker($('#delColSessions'), sid ? [sid] : sh.sessions.map(s => s.id));
    $('#delColDialog').showModal();
  }

  /** Xoá cột khỏi các buổi đã chọn; chọn tất cả các buổi thì xoá hẳn cột */
  function deleteColumn(key, sids) {
    const sh = sheetData(ui.cls, ui.sheet);
    const col = sh.cols.find(c => c.key === key);
    if (!col || !sids.length) return;
    const shown = sh.sessions.map(s => s.id).filter(id => colsFor(sh, id).includes(col));
    const remain = shown.filter(id => !sids.includes(id));
    const names = sids.length === sh.sessions.length ? 'tất cả các buổi' : sids.map(id => sessionLabel(sh, id)).join(', ');
    if (!confirm(`Xoá cột “${col.label}” khỏi ${names}?\nĐiểm trong cột ở các buổi này sẽ bị xoá.`)) return;
    if (!remain.length) {
      sh.cols = sh.cols.filter(c => c.key !== key);
    } else {
      col.skip = [...new Set([...(col.skip || []), ...sids])];
    }
    Object.entries(sh.data).forEach(([stId, byS]) => sids.forEach(sid => {
      if (byS[sid] && key in byS[sid]) {
        delete byS[sid][key];
        sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['data', stId, sid, key], undefined);
      }
    }));
    sids.forEach(sid => {
      if (sh.totals[sid] && key in sh.totals[sid]) {
        delete sh.totals[sid][key];
        sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['totals', sid, key], undefined);
      }
    });
    syncColsSessions(sh);
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
      sh.sessions.forEach(s => colsFor(sh, s.id).forEach(c => {
        head.push(`${sessionLabel(sh, s.id)}${s.date ? ' (' + s.date + ')' : ''} - ${c.label}${c.type === 'score' ? ' (/10)' : ''}`);
        totalsRow.push(c.type === 'score' ? (getTotal(sh, s.id, c.key) ?? '') : '');
      }));
      head.push('Tổng số buổi đi học', 'Số buổi vắng', 'Điểm TB (/10)');
      rows.push(head, totalsRow);
      students.forEach((st, i) => {
        const r = [i + 1, st.name].concat(hasTarget ? [fmt(num(sh.targets[st.id]))] : []);
        sh.sessions.forEach(s => colsFor(sh, s.id).forEach(c => {
          const v = getCell(sh, st.id, s.id, c.key);
          if (c.type === 'attend') r.push(isPresent(v) ? 'có mặt' : isAbsent(v) ? 'vắng' : '');
          else if (c.type === 'check') r.push(isPresent(v) ? '✓' : isAbsent(v) ? '✗' : '');
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
      applyConfig(state.config);
      if (!CLASSES.some(c => c.id === ui.cls)) ui.cls = CLASSES.length ? CLASSES[0].id : ui.cls;
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
    if (d.clsdel) { deleteClass(d.clsdel); return; }
    if (d.clsren) { renameClass(d.clsren); return; }
    if (d.clsrestore) { restoreClass(d.clsrestore); return; }
    if (d.clsup) { moveClass(Number(d.clsup), -1); return; }
    if (d.clsdown) { moveClass(Number(d.clsdown), 1); return; }
    if (d.delcol) { openDeleteColumn(d.delcol, d.delcolsess); return; }
    if (d.pickall) { t.closest('dialog').querySelectorAll('.pick input').forEach(i => { i.checked = d.pickall === '1'; }); return; }
    if (d.delsess) { deleteSession(d.delsess); return; }
    if (d.attcell) {
      // Vòng: trống → ✓ → ✗ → trống (điểm danh, BTVN, chép nghe, chép phạt…)
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
      case 'sortNames': sortStudents(); break;
      case 'manageClasses': openClassManager(); break;
      case 'addClassBtn': addClass(); break;
      case 'bulkAdd': $('#bulkNames').value = ''; $('#bulkDialog').showModal(); break;
      case 'addCol': openAddColumn(); break;
      case 'delCol': openDeleteColumn(); break;
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

  // Ô điểm: khi bấm vào thì hiện số câu đúng để sửa, khi rời ô thì hiện điểm /10
  document.addEventListener('focusin', e => {
    const t = e.target;
    if (t.dataset && t.dataset.kind === 'score') {
      const tr = t.closest('tr[data-st]');
      const [sid, key] = t.dataset.cell.split('|');
      const v = getCell(sheetData(ui.cls, ui.sheet), tr.dataset.st, sid, key);
      t.value = num(v) === null ? '' : fmt(num(v));
      t.select();
    }
  });
  document.addEventListener('focusout', e => {
    const t = e.target;
    if (t.dataset && t.dataset.kind === 'score') {
      const tr = t.closest('tr[data-st]');
      const [sid, key] = t.dataset.cell.split('|');
      setTimeout(() => updateScoreCell(tr, sid, key), 0);
    }
  });

  document.addEventListener('dblclick', e => {
    const lbl = e.target.closest('[data-rencol]');
    if (lbl) renameColumn(lbl.dataset.rencol);
  });

  // ---------- Di chuyển giữa các ô bằng phím mũi tên (như Excel) ----------
  const NAV_SEL = 'input:not([type=hidden]):not([type=date]):not([type=checkbox]), textarea, select, button.att-btn, input[type=checkbox]';
  function navCells(tr) {
    return [...tr.querySelectorAll(NAV_SEL)].filter(el => !el.disabled && el.offsetParent !== null);
  }
  function navRows() {
    return [...document.querySelectorAll('#content thead tr.totals-row, #content tbody tr')].filter(tr => navCells(tr).length);
  }
  function centerX(el) { const r = (el.closest('td,th') || el).getBoundingClientRect(); return r.left + r.width / 2; }
  /** Cuộn để ô không bị cột cố định bên trái / hàng tiêu đề che mất */
  function ensureVisible(el) {
    const wrap = $('#content');
    const cell = el.closest('td,th') || el;
    const r = cell.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    let leftEdge = w.left;
    wrap.querySelectorAll('thead tr:first-child th.sticky').forEach(th => { leftEdge = Math.max(leftEdge, th.getBoundingClientRect().right); });
    const head = wrap.querySelector('thead');
    const topEdge = head && !cell.closest('thead') ? head.getBoundingClientRect().bottom : w.top;
    const isSticky = cell.classList.contains('sticky');
    if (!isSticky && r.left < leftEdge) wrap.scrollLeft -= (leftEdge - r.left) + 4;
    else if (r.right > w.right) wrap.scrollLeft += (r.right - w.right) + 4;
    if (r.top < topEdge) wrap.scrollTop -= (topEdge - r.top) + 4;
    else if (r.bottom > w.bottom) wrap.scrollTop += (r.bottom - w.bottom) + 4;
  }
  function goTo(el) {
    if (!el) return false;
    el.focus({ preventScroll: true });
    ensureVisible(el);
    if (el.tagName === 'INPUT' && el.type === 'text' && el.select) { try { el.select(); } catch (err) { /* ignore */ } }
    return true;
  }
  function moveFrom(el, dir) {
    const tr = el.closest('tr');
    if (!tr) return false;
    if (dir === 'left' || dir === 'right') {
      const cells = navCells(tr);
      const i = cells.indexOf(el);
      return goTo(cells[i + (dir === 'right' ? 1 : -1)]);
    }
    const rows = navRows();
    let i = rows.indexOf(tr);
    const x = centerX(el);
    while (true) {
      i += dir === 'down' ? 1 : -1;
      if (i < 0 || i >= rows.length) return false;
      const cells = navCells(rows[i]);
      // ô trong dòng kia nằm thẳng cột nhất (kể cả ô gộp nhiều cột như dòng ghi chú)
      let best = null, bestD = Infinity;
      cells.forEach(c => {
        const box = (c.closest('td,th') || c).getBoundingClientRect();
        const d = x >= box.left && x <= box.right ? 0 : Math.min(Math.abs(x - box.left), Math.abs(x - box.right));
        if (d < bestD) { bestD = d; best = c; }
      });
      if (best) return goTo(best);
    }
  }
  /** Ô chữ dài (tên, ghi chú): chỉ nhảy ô khi con trỏ đã ở đầu / cuối */
  function caretAllows(el, dir) {
    const isLongText = el.tagName === 'TEXTAREA' || el.classList.contains('name') || (el.dataset.plan && el.tagName === 'INPUT');
    if (!isLongText) return true;
    let a, b;
    try { a = el.selectionStart; b = el.selectionEnd; } catch (err) { return true; }
    if (a == null) return true;
    const len = el.value.length;
    if (dir === 'left') return a === 0 && b === 0;
    if (dir === 'right') return a === len && b === len;
    if (el.tagName !== 'TEXTAREA') return true;
    if (dir === 'up') return el.value.lastIndexOf('\n', a - 1) === -1;
    return el.value.indexOf('\n', b) === -1;
  }
  $('#content').addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    const el = e.target;
    if (!el.matches || !el.matches(NAV_SEL)) return;
    const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    let dir = map[e.key];
    // Enter ở ô nhập (không phải ô ghi chú / nút) = xuống ô dưới, Shift+Enter = lên
    if (e.key === 'Enter' && el.tagName === 'INPUT') dir = e.shiftKey ? 'up' : 'down';
    if (!dir) return;
    if (e.shiftKey && e.key !== 'Enter') return;           // Shift+mũi tên: để chọn chữ
    if (el.tagName === 'SELECT' && (dir === 'up' || dir === 'down')) return;
    if (!caretAllows(el, dir)) return;
    if (moveFrom(el, dir)) e.preventDefault();
    else if (e.key === 'Enter') e.preventDefault();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'newClassName') { e.preventDefault(); addClass(); return; }
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
    if ($('#colDialog').returnValue === 'ok' && name) addColumn(name, $('#colType').value, pickedSessions($('#colSessions')));
  });
  $('#delColDialog').addEventListener('close', () => {
    if ($('#delColDialog').returnValue !== 'ok') return;
    const sids = pickedSessions($('#delColSessions'));
    if (!sids.length) { alert('Hãy chọn ít nhất một buổi.'); return; }
    deleteColumn($('#delColSel').value, sids);
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
      tr.querySelectorAll('input[data-kind="score"]').forEach(inp => {
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
    if (t.dataset.note) {
      const [sid, key] = t.dataset.note.split('|');
      const sh = sheetData(ui.cls, ui.sheet);
      if (!sh.notes) sh.notes = {};
      if (!sh.notes[sid]) sh.notes[sid] = {};
      if (t.value) sh.notes[sid][key] = t.value; else delete sh.notes[sid][key];
      sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['notes', sid, key], t.value || undefined);
      save();
      return;
    }
    if (t.dataset.kind === 'score') { setCell(t, num(t.value)); return; }
    if (t.dataset.cell && t.type === 'text' && !t.dataset.kind) { setCell(t, t.value === '' ? null : t.value); return; }
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
    if (input.dataset.kind === 'score') updateScoreCell(tr, sid, key);
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
