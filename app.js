/* Sổ điểm học sinh – lưu dữ liệu trong localStorage của trình duyệt */
(function () {
  'use strict';

  const STORAGE_KEY = 'so-diem-data-v1';
  const UI_KEY = 'so-diem-ui-v1';
  const NUM_SESSIONS = 10;

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
    { id: 'khaosat', name: 'Điểm khảo sát', type: 'sessions' },
    { id: 'kehoach', name: 'Kế hoạch IELTS', type: 'plan' },
  ];

  // Các cột nhỏ trong mỗi buổi
  const COLS = [
    { key: 'dd', label: 'Điểm danh', type: 'check' },
    { key: 'btvn', label: 'BTVN', type: 'check' },
    { key: 'chepnghe', label: 'Chép nghe', type: 'check' },
    { key: 'chepphat', label: 'Chép phạt', type: 'check' },
    { key: 'nghe', label: 'Điểm nghe', type: 'score' },
    { key: 'tumoi', label: 'Điểm từ mới', type: 'score' },
    { key: 'kttt', label: 'Điểm kiến thức trọng tâm', type: 'score' },
    { key: 'ktdg', label: 'Điểm KT đầu giờ', type: 'score' },
  ];
  const SCORE_COLS = COLS.filter(c => c.type === 'score');

  const SKILLS = ['Listening', 'Reading', 'Writing', 'Speaking', 'Vocabulary', 'Grammar', 'Mock test', 'Khác'];

  // ---------- State ----------
  let state = load(STORAGE_KEY) || { classes: {} };
  if (!state.classes) state.classes = {};
  const ui = Object.assign({ cls: '7', sheet: 'trenlop', session: 'all' }, load(UI_KEY) || {});
  if (!CLASSES.some(c => c.id === ui.cls)) ui.cls = '7';
  if (!SHEETS.some(s => s.id === ui.sheet)) ui.sheet = 'trenlop';

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { alert('Không lưu được dữ liệu: ' + e.message); }
  }
  function saveUI() {
    try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* ignore */ }
  }
  window.addEventListener('beforeunload', saveNow);

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
    if (!c.sheets[sid]) {
      c.sheets[sid] = sheetDef(sid).type === 'plan' ? { rows: [] } : { totals: {}, data: {} };
    }
    return c.sheets[sid];
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ---------- Tính toán ----------
  function num(v) {
    if (v === '' || v === null || v === undefined) return null;
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
  function getCell(sh, stId, s, key) {
    return sh.data[stId] && sh.data[stId][s] ? sh.data[stId][s][key] : undefined;
  }
  function getTotal(sh, s, key) {
    return sh.totals[s] ? sh.totals[s][key] : undefined;
  }
  function attendance(sh, stId) {
    let n = 0;
    for (let s = 1; s <= NUM_SESSIONS; s++) if (getCell(sh, stId, s, 'dd')) n++;
    return n;
  }
  function studentAvg(sh, stId) {
    let sum = 0, cnt = 0;
    for (let s = 1; s <= NUM_SESSIONS; s++) {
      SCORE_COLS.forEach(c => {
        const v = toTen(getCell(sh, stId, s, c.key), getTotal(sh, s, c.key));
        if (v !== null) { sum += v; cnt++; }
      });
    }
    return cnt ? sum / cnt : null;
  }
  function convHTML(correct, total) {
    const c = num(correct);
    if (c === null) return { text: '', cls: '' };
    const t = num(total);
    if (t === null || t <= 0) return { text: 'thiếu tổng', cls: 'warn' };
    const v = toTen(c, t);
    return { text: fmt(v) + '/10', cls: gradeClass(v) };
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
  function visibleSessions() {
    if (ui.session === 'all') return Array.from({ length: NUM_SESSIONS }, (_, i) => i + 1);
    return [Number(ui.session)];
  }

  // ---------- Render ----------
  function renderClassTabs() {
    const el = $('#classTabs');
    let html = '';
    let i = 0;
    while (i < CLASSES.length) {
      const c = CLASSES[i];
      if (c.group) {
        const g = c.group;
        html += `<div class="group"><span class="group-label">${esc(g)}:</span>`;
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
    el.innerHTML = html;
  }

  function renderSheetTabs() {
    $('#sheetTabs').innerHTML = SHEETS.map(s =>
      `<button data-sheet="${s.id}" class="${s.id === ui.sheet ? 'active' : ''}">${esc(s.name)}</button>`).join('');
  }

  function renderToolbar() {
    const def = sheetDef(ui.sheet);
    let html = '';
    if (def.type === 'sessions') {
      html += `<input type="text" id="newStudent" placeholder="Nhập họ và tên học sinh rồi Enter">
        <button class="btn primary" id="addStudent">+ Thêm HS</button>
        <button class="btn" id="bulkAdd">Dán danh sách</button>
        <select id="sessionFilter" title="Lọc buổi">
          <option value="all">Hiện tất cả 10 buổi</option>
          ${Array.from({ length: NUM_SESSIONS }, (_, i) => `<option value="${i + 1}" ${String(ui.session) === String(i + 1) ? 'selected' : ''}>Chỉ Buổi ${i + 1}</option>`).join('')}
        </select>
        <span class="legend"><span class="good">≥8</span><span class="ok">6,5–8</span><span class="mid">5–6,5</span><span class="bad">&lt;5</span></span>`;
    } else {
      html += `<button class="btn primary" id="addPlan">+ Thêm dòng kế hoạch</button>`;
    }
    html += `<span class="spacer"></span>
      <button class="btn" id="exportCsv">Xuất Excel (CSV)</button>
      <button class="btn" id="printBtn">In</button>
      <button class="btn" id="backupBtn" title="Tải toàn bộ dữ liệu về máy">Sao lưu</button>
      <button class="btn" id="restoreBtn" title="Khôi phục từ file sao lưu">Khôi phục</button>`;
    $('#toolbar').innerHTML = html;
    if (def.type === 'sessions') $('#sessionFilter').value = String(ui.session);

    $('#hint').innerHTML = def.type === 'sessions'
      ? 'Hàng <b>“Tổng số câu”</b> (nền vàng): nhập tổng số câu của từng bài. Ở mỗi ô điểm, nhập <b>số câu đúng</b> – hệ thống tự quy đổi ra <b>điểm /10</b>. Dữ liệu tự lưu trên trình duyệt này.'
      : 'Lập kế hoạch học IELTS cho ' + esc(className(ui.cls)) + '. Dữ liệu tự lưu trên trình duyệt này.';
  }

  function renderContent() {
    const def = sheetDef(ui.sheet);
    if (def.type === 'sessions') renderSessions();
    else renderPlan();
  }

  function renderSessions() {
    const sh = sheetData(ui.cls, ui.sheet);
    const students = classData(ui.cls).students;
    const sessions = visibleSessions();
    const n = COLS.length;
    const parity = s => (s % 2 ? 's-odd' : 's-even');

    let h = `<h2 class="print-title">${esc(className(ui.cls))} – ${esc(sheetDef(ui.sheet).name)}</h2>`;
    h += '<table class="grid"><thead><tr>';
    h += '<th rowspan="2" class="sticky c-stt">STT</th><th rowspan="2" class="sticky c-name">Họ và tên</th>';
    sessions.forEach(s => { h += `<th colspan="${n}" class="sess-head sess-start ${parity(s)}">Buổi ${s}</th>`; });
    h += '<th rowspan="3" class="sess-start">Tổng số<br>buổi đi học</th><th rowspan="3">Điểm TB<br>(/10)</th><th rowspan="3" class="no-print"></th></tr><tr>';
    sessions.forEach(s => COLS.forEach((c, i) => {
      h += `<th class="sub ${parity(s)} ${i === 0 ? 'sess-start' : ''}">${esc(c.label)}</th>`;
    }));
    h += '</tr><tr class="totals-row"><th colspan="2" class="sticky c-stt" style="text-align:right">Tổng số câu →</th>';
    sessions.forEach(s => COLS.forEach((c, i) => {
      const cls = i === 0 ? 'sess-start' : '';
      if (c.type === 'score') {
        const t = getTotal(sh, s, c.key);
        h += `<th class="${cls}"><input type="number" class="total" min="1" step="1" data-total="${s}|${c.key}" value="${t ?? ''}" placeholder="tổng" title="Tổng số câu – ${esc(c.label)} – Buổi ${s}"></th>`;
      } else {
        h += `<th class="${cls}"></th>`;
      }
    }));
    h += '</tr></thead><tbody>';

    if (!students.length) {
      h += `<tr><td class="empty" colspan="${2 + sessions.length * n + 3}">Chưa có học sinh. Hãy thêm học sinh ở thanh công cụ phía trên.</td></tr>`;
    }

    students.forEach((st, idx) => {
      h += `<tr data-st="${st.id}"><td class="sticky c-stt">${idx + 1}</td>`;
      h += `<td class="sticky c-name"><input class="name" data-name="${st.id}" value="${esc(st.name)}"></td>`;
      sessions.forEach(s => COLS.forEach((c, i) => {
        const v = getCell(sh, st.id, s, c.key);
        const cls = `${parity(s)} ${i === 0 ? 'sess-start' : ''}`;
        if (c.type === 'check') {
          h += `<td class="chk ${cls}"><input type="checkbox" data-cell="${s}|${c.key}" ${v ? 'checked' : ''} title="${esc(c.label)} – Buổi ${s}"></td>`;
        } else {
          const t = getTotal(sh, s, c.key);
          const cv = convHTML(v, t);
          const over = num(v) !== null && num(t) !== null && num(v) > num(t);
          h += `<td class="score ${cls}"><div class="cell"><input type="number" min="0" step="any" data-cell="${s}|${c.key}" value="${v ?? ''}" class="${over ? 'over' : ''}" placeholder="đúng" title="Số câu đúng – ${esc(c.label)} – Buổi ${s}"><span class="conv ${cv.cls}" data-conv="${s}|${c.key}">${cv.text}</span></div></td>`;
        }
      }));
      const avg = studentAvg(sh, st.id);
      h += `<td class="att sess-start" data-att>${attendance(sh, st.id)}/${NUM_SESSIONS}</td>`;
      h += `<td class="avg" data-avg><span class="conv ${gradeClass(avg)}">${fmt(avg)}</span></td>`;
      h += `<td><button class="del" data-del="${st.id}" title="Xoá học sinh">×</button></td></tr>`;
    });
    h += '</tbody>';

    if (students.length) {
      h += '<tfoot><tr><td colspan="2" class="sticky c-stt" style="text-align:right">TB lớp / Sĩ số có mặt</td>';
      sessions.forEach(s => COLS.forEach((c, i) => {
        h += `<td class="${parity(s)} ${i === 0 ? 'sess-start' : ''}" data-foot="${s}|${c.key}"></td>`;
      }));
      h += '<td class="sess-start" data-foot="att"></td><td data-foot="avg"></td><td></td></tr></tfoot>';
    }
    h += '</table>';
    $('#content').innerHTML = h;
    updateFooter();
  }

  function updateFooter() {
    const sh = sheetData(ui.cls, ui.sheet);
    const students = classData(ui.cls).students;
    document.querySelectorAll('#content [data-foot]').forEach(td => {
      const f = td.dataset.foot;
      if (f === 'att') {
        const tot = students.reduce((a, st) => a + attendance(sh, st.id), 0);
        td.textContent = students.length ? fmt(tot / students.length) + ' buổi' : '';
        return;
      }
      if (f === 'avg') {
        const avgs = students.map(st => studentAvg(sh, st.id)).filter(v => v !== null);
        const a = avgs.length ? avgs.reduce((x, y) => x + y, 0) / avgs.length : null;
        td.innerHTML = `<span class="conv ${gradeClass(a)}">${fmt(a)}</span>`;
        return;
      }
      const [s, key] = f.split('|');
      const col = COLS.find(c => c.key === key);
      if (col.type === 'check') {
        const cnt = students.filter(st => getCell(sh, st.id, s, key)).length;
        td.textContent = cnt ? `${cnt}/${students.length}` : '';
      } else {
        const vals = students.map(st => toTen(getCell(sh, st.id, s, key), getTotal(sh, s, key))).filter(v => v !== null);
        const a = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
        td.innerHTML = `<span class="conv ${gradeClass(a)}">${fmt(a)}</span>`;
      }
    });
  }

  function updateRow(tr) {
    const sh = sheetData(ui.cls, ui.sheet);
    const stId = tr.dataset.st;
    const avg = studentAvg(sh, stId);
    tr.querySelector('[data-att]').textContent = `${attendance(sh, stId)}/${NUM_SESSIONS}`;
    tr.querySelector('[data-avg]').innerHTML = `<span class="conv ${gradeClass(avg)}">${fmt(avg)}</span>`;
  }

  function updateScoreCell(tr, s, key) {
    const sh = sheetData(ui.cls, ui.sheet);
    const stId = tr.dataset.st;
    const v = getCell(sh, stId, s, key);
    const t = getTotal(sh, s, key);
    const span = tr.querySelector(`[data-conv="${s}|${key}"]`);
    const input = tr.querySelector(`input[data-cell="${s}|${key}"]`);
    if (!span || !input) return;
    const cv = convHTML(v, t);
    span.className = 'conv ' + cv.cls;
    span.textContent = cv.text;
    input.classList.toggle('over', num(v) !== null && num(t) !== null && num(v) > num(t));
  }

  function renderPlan() {
    const sh = sheetData(ui.cls, ui.sheet);
    let h = `<h2 class="print-title">${esc(className(ui.cls))} – Kế hoạch IELTS</h2>`;
    h += `<table class="grid plan"><thead><tr>
      <th class="w-week">STT / Tuần</th><th class="w-date">Ngày</th><th class="w-skill">Kỹ năng</th>
      <th class="w-content">Nội dung bài học</th><th class="w-mat">Tài liệu</th><th class="w-target">Mục tiêu (band)</th>
      <th class="w-done">Hoàn thành</th><th class="w-note">Ghi chú</th><th></th></tr></thead><tbody>`;
    if (!sh.rows.length) {
      h += '<tr><td class="empty" colspan="9">Chưa có kế hoạch. Bấm “+ Thêm dòng kế hoạch”.</td></tr>';
    }
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
    renderClassTabs();
    renderSheetTabs();
    renderToolbar();
    renderContent();
  }

  // ---------- Hành động ----------
  function addStudents(names) {
    const c = classData(ui.cls);
    names.map(x => x.trim()).filter(Boolean).forEach(name => c.students.push({ id: uid(), name }));
    save();
    renderContent();
  }

  function deleteStudent(id) {
    const c = classData(ui.cls);
    const st = c.students.find(s => s.id === id);
    if (!st) return;
    if (!confirm(`Xoá học sinh “${st.name}” và toàn bộ điểm của em ở tất cả các sheet?`)) return;
    c.students = c.students.filter(s => s.id !== id);
    Object.values(c.sheets).forEach(sh => { if (sh.data) delete sh.data[id]; });
    save();
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
      const head = ['STT', 'Họ và tên'];
      const totalsRow = ['', 'Tổng số câu'];
      for (let s = 1; s <= NUM_SESSIONS; s++) COLS.forEach(c => {
        head.push(`Buổi ${s} - ${c.label}${c.type === 'score' ? ' (/10)' : ''}`);
        totalsRow.push(c.type === 'score' ? (getTotal(sh, s, c.key) ?? '') : '');
      });
      head.push('Tổng số buổi đi học', 'Điểm TB (/10)');
      totalsRow.push('', '');
      rows.push(head, totalsRow);
      students.forEach((st, i) => {
        const r = [i + 1, st.name];
        for (let s = 1; s <= NUM_SESSIONS; s++) COLS.forEach(c => {
          const v = getCell(sh, st.id, s, c.key);
          if (c.type === 'check') r.push(v ? 'x' : '');
          else r.push(fmt(toTen(v, getTotal(sh, s, c.key))));
        });
        r.push(attendance(sh, st.id), fmt(studentAvg(sh, st.id)));
        rows.push(r);
      });
    } else {
      rows.push(['STT / Tuần', 'Ngày', 'Kỹ năng', 'Nội dung bài học', 'Tài liệu', 'Mục tiêu (band)', 'Hoàn thành', 'Ghi chú']);
      sh.rows.forEach(r => rows.push([r.week, r.date, r.skill, r.content, r.material, r.target, r.done ? 'x' : '', r.note]));
    }
    // Dùng dấu ; để Excel (cài đặt Việt Nam, dấu phẩy thập phân) mở đúng cột
    const csv = '﻿' + 'sep=;\n' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
    download(`${className(ui.cls)} - ${def.name}.csv`, csv, 'text/csv;charset=utf-8');
  }

  function backup() {
    saveNow();
    const d = new Date().toISOString().slice(0, 10);
    download(`so-diem-sao-luu-${d}.json`, JSON.stringify(state, null, 2), 'application/json');
  }

  function restore(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || typeof data.classes !== 'object') throw new Error('File không đúng định dạng');
        if (!confirm('Khôi phục sẽ GHI ĐÈ toàn bộ dữ liệu hiện tại. Tiếp tục?')) return;
        state = data;
        saveNow();
        renderAll();
        alert('Đã khôi phục dữ liệu.');
      } catch (e) {
        alert('Không đọc được file: ' + e.message);
      }
    };
    reader.readAsText(file);
  }

  // ---------- Sự kiện ----------
  document.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.cls) { ui.cls = t.dataset.cls; saveUI(); renderAll(); return; }
    if (t.dataset.sheet) { ui.sheet = t.dataset.sheet; saveUI(); renderAll(); return; }
    if (t.dataset.del) { deleteStudent(t.dataset.del); return; }
    if (t.dataset.delrow !== undefined) {
      const sh = sheetData(ui.cls, ui.sheet);
      if (confirm('Xoá dòng kế hoạch này?')) { sh.rows.splice(Number(t.dataset.delrow), 1); save(); renderContent(); }
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
      case 'bulkAdd':
        $('#bulkNames').value = '';
        $('#bulkDialog').showModal();
        break;
      case 'addPlan': {
        const sh = sheetData(ui.cls, ui.sheet);
        sh.rows.push({ week: String(sh.rows.length + 1), date: '', skill: 'Listening', content: '', material: '', target: '', done: false, note: '' });
        save();
        renderContent();
        break;
      }
      case 'exportCsv': exportCsv(); break;
      case 'printBtn': window.print(); break;
      case 'backupBtn': backup(); break;
      case 'restoreBtn': $('#importFile').click(); break;
    }
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

  $('#importFile').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) restore(f);
    e.target.value = '';
  });

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'sessionFilter') { ui.session = t.value; saveUI(); renderContent(); return; }
    if (t.type === 'checkbox' && t.dataset.cell) {
      setCell(t, t.checked);
      return;
    }
    if (t.dataset.plan && (t.type === 'checkbox' || t.tagName === 'SELECT' || t.type === 'date')) {
      setPlan(t);
    }
  });

  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.name) {
      const st = classData(ui.cls).students.find(s => s.id === t.dataset.name);
      if (st) { st.name = t.value; save(); }
      return;
    }
    if (t.dataset.total) {
      const [s, key] = t.dataset.total.split('|');
      const sh = sheetData(ui.cls, ui.sheet);
      if (!sh.totals[s]) sh.totals[s] = {};
      const v = num(t.value);
      if (v === null) delete sh.totals[s][key]; else sh.totals[s][key] = v;
      save();
      document.querySelectorAll('#content tbody tr[data-st]').forEach(tr => { updateScoreCell(tr, s, key); updateRow(tr); });
      updateFooter();
      return;
    }
    if (t.dataset.cell && t.type === 'number') {
      setCell(t, num(t.value));
      return;
    }
    if (t.dataset.plan && t.type !== 'checkbox' && t.tagName !== 'SELECT' && t.type !== 'date') {
      setPlan(t);
    }
  });

  function setCell(input, value) {
    const tr = input.closest('tr[data-st]');
    const stId = tr.dataset.st;
    const [s, key] = input.dataset.cell.split('|');
    const sh = sheetData(ui.cls, ui.sheet);
    if (!sh.data[stId]) sh.data[stId] = {};
    if (!sh.data[stId][s]) sh.data[stId][s] = {};
    if (value === null || value === false) delete sh.data[stId][s][key];
    else sh.data[stId][s][key] = value;
    save();
    if (input.type === 'number') updateScoreCell(tr, s, key);
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
    save();
  }

  renderAll();
})();
