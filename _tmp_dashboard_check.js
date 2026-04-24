
// 저장된 설문 대시보드 목록을 브라우저 저장소에서 읽고 쓰는 유틸리티입니다.
const STORAGE_KEY = 'p6s.surveys';

function loadSurveys() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function saveSurveys(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch (_) {
    alert('저장 공간이 부족해 대시보드를 브라우저에 저장할 수 없습니다.');
    return false;
  }
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch (_) {
    return iso;
  }
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file, 'UTF-8');
  });
}

function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

function arrayBufferToBase64(buf) {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// 코드북/응답 데이터 파일을 읽고 파싱하기 위한 공통 유틸리티입니다.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function normalizeHeader(s) {
  return String(s || '').replace(/^\uFEFF/, '').trim().toLowerCase();
}

async function loadCodebookRows(fileRec) {
  if (!fileRec) return null;
  if (fileRec.contentType === 'csv-text') {
    return parseCSV(fileRec.content);
  }
  if (fileRec.contentType === 'xlsx-base64') {
    const buf = base64ToArrayBuffer(fileRec.content);
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: true });
    return rows.map(r => (r || []).map(v => v == null ? '' : String(v)));
  }
  return null;
}

// 코드북을 category_1 > category_2 > question 구조로 변환하고 화면에 렌더링합니다.
function buildQuestionTree(rows) {
  if (!rows || rows.length < 2) return [];
  const header = (rows[0] || []).map(normalizeHeader);
  const col = name => header.indexOf(name);
  const iCat1 = col('category_1');
  const iCat2 = col('category_2');
  const iLabel = col('question_label');
  const iFull = col('question_full');
  const iNo = col('question_no');
  const iRole = col('data_column_role');
  const iType = col('response_type');

  const cat1Order = [];
  const map = new Map();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const label = iLabel >= 0 ? String(row[iLabel] || '').trim() : '';
    if (!label) continue;

    const c1 = (iCat1 >= 0 ? String(row[iCat1] || '').trim() : '') || '기타';
    const c2 = (iCat2 >= 0 ? String(row[iCat2] || '').trim() : '') || '기타';
    const full = iFull >= 0 ? String(row[iFull] || '').trim() : '';
    const qno = iNo >= 0 ? String(row[iNo] || '').trim() : '';
    const role = iRole >= 0 ? String(row[iRole] || '').trim() : '';
    const rtype = iType >= 0 ? String(row[iType] || '').trim() : '';

    // expanded 행은 계산 편의를 위한 내부 컬럼이므로 사용자용 문항 리스트에서 제외합니다.
    if (role.toLowerCase() === 'expanded') continue;

    if (!map.has(c1)) { map.set(c1, new Map()); cat1Order.push(c1); }
    const c1m = map.get(c1);
    if (!c1m.has(c2)) c1m.set(c2, []);
    c1m.get(c2).push({ qno, label, full, role, rtype });
  }

  return cat1Order.map(c1 => ({
    name: c1,
    children: Array.from(map.get(c1).entries()).map(([c2, items]) => ({ name: c2, items }))
  }));
}

function renderTree(tree) {
  const host = document.getElementById('question-tree');
  host.innerHTML = '';

  if (!tree || tree.length === 0) {
    host.innerHTML = '<div class="question-list-empty">표시할 문항이 없습니다.</div>';
    return;
  }

  const chevron = 'assets/icons/arrow_forward_ios_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24.png';

  tree.forEach((cat1, i1) => {
    const cat = document.createElement('div');
    cat.className = 'accordion-category';
    cat.dataset.cat1 = cat1.name;

    const head = document.createElement('button');
    head.className = 'accordion-header';
    head.type = 'button';
    head.innerHTML = `
      <span class="accordion-label">${escapeHtml(cat1.name)}</span>
      <img class="accordion-chev" src="${chevron}" alt="">
    `;
    cat.appendChild(head);

    const list = document.createElement('div');
    list.className = 'accordion-list';

    cat1.children.forEach((cat2, i2) => {
      const sub = document.createElement('div');
      sub.className = 'accordion-subcategory';
      sub.dataset.cat2 = cat2.name;

      const subHead = document.createElement('button');
      subHead.className = 'sub-accordion-header';
      subHead.type = 'button';
      subHead.innerHTML = `
        <span class="sub-accordion-label">${escapeHtml(cat2.name)}</span>
        <img class="sub-accordion-chev" src="${chevron}" alt="">
      `;
      sub.appendChild(subHead);

      const subList = document.createElement('div');
      subList.className = 'sub-accordion-list';

      cat2.items.forEach(item => {
        const card = document.createElement('div');
        const hasFull = item.full && item.full.trim() !== '';
        card.className = 'question-item' + (hasFull ? ' has-full' : '');
        card.draggable = true;
        card.dataset.label = item.label;
        card.dataset.qno = item.qno;
        card.dataset.cat1 = cat1.name;
        card.dataset.cat2 = cat2.name;
        card.dataset.full = item.full;
        card.innerHTML = `
          <span class="question-item-label">${escapeHtml(item.label)}</span>
          ${hasFull ? `<span class="question-item-full">Q. ${escapeHtml(item.full)}</span>` : ''}
        `;
        subList.appendChild(card);
      });

      sub.appendChild(subList);
      list.appendChild(sub);
    });

    cat.appendChild(list);
    host.appendChild(cat);
  });
}

// 좌측 문항 패널의 아코디언 열기/닫기와 검색 동작을 담당합니다.
function setupAccordion() {
  const host = document.getElementById('question-tree');
  host.addEventListener('click', e => {
    const h1 = e.target.closest('.accordion-header');
    if (h1) {
      h1.parentElement.classList.toggle('open');
      return;
    }
    const h2 = e.target.closest('.sub-accordion-header');
    if (h2) {
      h2.parentElement.classList.toggle('open');
    }
  });
}

function setupSearch() {
  const input = document.getElementById('panel-search');
  const host = document.getElementById('question-tree');

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    const cats = host.querySelectorAll('.accordion-category');

    if (q === '') {
      cats.forEach(cat => {
        cat.style.display = '';
        cat.classList.remove('open');
        cat.querySelectorAll('.accordion-subcategory').forEach(sub => {
          sub.style.display = '';
          sub.classList.remove('open');
          sub.querySelectorAll('.question-item').forEach(item => item.style.display = '');
        });
      });
      removeEmptyMsg();
      return;
    }

    let anyMatch = false;
    cats.forEach(cat => {
      let catMatch = false;
      const cat1Name = cat.dataset.cat1 || '';
      const cat1Hit = cat1Name.toLowerCase().includes(q);
      cat.querySelectorAll('.accordion-subcategory').forEach(sub => {
        let subMatch = false;
        const cat2Name = sub.dataset.cat2 || '';
        const cat2Hit = cat2Name.toLowerCase().includes(q);
        sub.querySelectorAll('.question-item').forEach(item => {
          const hay = [
            item.dataset.label || '',
            item.dataset.full || '',
            item.dataset.qno || '',
            cat1Name,
            cat2Name
          ].join(' ').toLowerCase();
          const hit = cat1Hit || cat2Hit || hay.includes(q);
          item.style.display = hit ? '' : 'none';
          if (hit) subMatch = true;
        });
        const visible = subMatch || cat2Hit;
        sub.style.display = visible ? '' : 'none';
        if (visible) sub.classList.add('open');
        if (visible) catMatch = true;
      });
      const visibleCat = catMatch || cat1Hit;
      cat.style.display = visibleCat ? '' : 'none';
      if (visibleCat) cat.classList.add('open');
      if (visibleCat) anyMatch = true;
    });

    if (!anyMatch) showEmptyMsg();
    else removeEmptyMsg();
  });

  function showEmptyMsg() {
    removeEmptyMsg();
    const msg = document.createElement('div');
    msg.className = 'question-list-empty';
    msg.id = 'search-empty-msg';
    msg.textContent = '검색 결과가 없습니다.';
    host.appendChild(msg);
  }
  function removeEmptyMsg() {
    const existing = document.getElementById('search-empty-msg');
    if (existing) existing.remove();
  }
}

// 좌측 패널 확장/축소와 문항 다중선택, 드래그앤드롭을 처리합니다.
function setupPanelToggle() {
  const btn = document.getElementById('panel-toggle');
  const page = document.querySelector('.page');
  btn.addEventListener('click', () => {
    page.classList.toggle('panel-expanded');
    btn.setAttribute('aria-label', page.classList.contains('panel-expanded') ? '패널 접기' : '패널 확장');
  });
}

function setupSelectionAndDragDrop() {
  const host = document.getElementById('question-tree');
  const zones = document.querySelectorAll('.drop-area');
  const statusEl = document.getElementById('selection-status');
  const countEl = document.getElementById('selection-count');
  const clearBtn = document.getElementById('selection-clear-btn');
  const targetClearBtn = document.getElementById('target-clear-btn');

  function selectedItems() {
    return Array.from(host.querySelectorAll('.question-item.selected'));
  }

  function refreshStatus() {
    const n = selectedItems().length;
    countEl.textContent = String(n);
    statusEl.classList.toggle('show', n > 0);
  }

  function clearSelection() {
    host.querySelectorAll('.question-item.selected').forEach(el => el.classList.remove('selected'));
    refreshStatus();
  }

  host.addEventListener('click', e => {
    const item = e.target.closest('.question-item');
    if (!item) return;
    item.classList.toggle('selected');
    refreshStatus();
  });

  clearBtn.addEventListener('click', clearSelection);
  if (targetClearBtn) {
    targetClearBtn.addEventListener('click', () => clearDropZone('drop-target'));
  }

  host.addEventListener('dragstart', e => {
    const item = e.target.closest('.question-item');
    if (!item) return;

    let payload;
    if (item.classList.contains('selected')) {
      payload = selectedItems().map(el => ({
        label: el.dataset.label,
        qno: el.dataset.qno || ''
      }));
    } else {
      payload = [{ label: item.dataset.label, qno: item.dataset.qno || '' }];
    }

    e.dataTransfer.setData('text/plain', JSON.stringify({ items: payload }));
    e.dataTransfer.effectAllowed = 'copy';
  });

  zones.forEach(zone => {
    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');

      let data;
      try { data = JSON.parse(e.dataTransfer.getData('text/plain') || '{}'); } catch (_) { return; }
      const items = Array.isArray(data.items) ? data.items : (data.label ? [data] : []);
      if (items.length === 0) return;

      const limit = parseInt(zone.dataset.limit, 10) || 10;
      const zoneName = zone.dataset.zone === 'target' ? '분석 대상' : '분석 기준';
      const existingLabels = new Set(
        Array.from(zone.querySelectorAll('.chip')).map(c => c.dataset.label)
      );

      let added = 0;
      let blockedByLimit = false;
      for (const data of items) {
        if (!data || !data.label) continue;
        if (existingLabels.has(data.label)) continue;
        const current = zone.querySelectorAll('.chip').length;
        if (current >= limit) { blockedByLimit = true; break; }
        addChip(zone, data);
        existingLabels.add(data.label);
        added++;
      }

      if (blockedByLimit) {
        const remaining = items.length - added;
        alert(`${zoneName} 문항은 최대 ${limit}개까지 추가할 수 있습니다. (추가됨 ${added}개, 제외됨 ${remaining}개)`);
      }

      clearSelection();
    });
  });

  function addChip(zone, data) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.dataset.label = data.label;
    chip.dataset.qno = data.qno || '';
    chip.innerHTML = `
      <span>${escapeHtml(data.label)}</span>
      <button type="button" class="remove-btn" aria-label="제거">×</button>
    `;
    chip.querySelector('.remove-btn').addEventListener('click', () => {
      chip.remove();
      refreshZoneState(zone);
    });
    zone.appendChild(chip);
    refreshZoneState(zone);
  }

  function refreshZoneState(zone) {
    const chips = zone.querySelectorAll('.chip');
    zone.classList.toggle('has-chip', chips.length > 0);
    const cEl = document.getElementById(zone.dataset.zone === 'target' ? 'target-count' : 'criterion-count');
    if (cEl) cEl.textContent = String(chips.length);
  }
}

// 코드북과 라벨형 응답 데이터를 기준으로 동적 필터를 구성합니다.
const filterState = {
  candidates: [],
  activeKeys: [],
  selectedMap: new Map(),
  defaultKeys: [],
  rows: [],
  headerMap: new Map(),
  draggingKey: null
};

function buildFilterCandidates(codebookRows, labelRows) {
  const header = (labelRows && labelRows[0] || []).map(cleanCell);
  const headerMap = new Map();
  header.forEach((name, idx) => headerMap.set(name, idx));

  const candidates = [];
  if (headerMap.has('survey_year')) {
    const yearIdx = headerMap.get('survey_year');
    const yearOptions = [];
    const yearSeen = new Set();
    for (let i = 1; i < (labelRows || []).length; i++) {
      const value = cleanCell((labelRows[i] || [])[yearIdx]);
      if (!value || yearSeen.has(value)) continue;
      yearSeen.add(value);
      yearOptions.push(value);
    }
    if (yearOptions.length > 1) {
      candidates.push({
        key: 'survey_year',
        label: '조사 연도',
        category1: 'system',
        options: yearOptions,
        priority: 3,
        fixed: true
      });
    }
  }

  const codebookHeader = (codebookRows && codebookRows[0] || []).map(normalizeHeader);
  const col = name => codebookHeader.indexOf(name);
  const iCat1 = col('category_1');
  const iLabel = col('question_label');
  const iRole = col('data_column_role');
  const iType = col('response_type');
  const iOptions = col('response_options');

  const seen = new Set();
  for (let r = 1; r < (codebookRows || []).length; r++) {
    const row = codebookRows[r] || [];
    const label = cleanCell(row[iLabel]);
    const cat1 = cleanCell(row[iCat1]);
    const role = cleanCell(row[iRole]).toLowerCase();
    const type = cleanCell(row[iType]);
    if (!label || seen.has(label)) continue;
    if (role !== 'raw') continue;
    if (!type.includes('객관식 단일')) continue;
    if (!headerMap.has(label)) continue;

    const idx = headerMap.get(label);
    const options = [];
    const optionSeen = new Set();

    const responseOptions = cleanCell(row[iOptions]);
    if (responseOptions) {
      responseOptions.split('|').map(cleanCell).forEach(option => {
        if (!option || optionSeen.has(option)) return;
        optionSeen.add(option);
        options.push(option);
      });
    }

    // 코드북 옵션이 비어 있거나 불완전한 경우에만 실제 라벨 데이터 값을 보조로 사용합니다.
    if (options.length === 0) {
      for (let i = 1; i < (labelRows || []).length; i++) {
        const value = cleanCell((labelRows[i] || [])[idx]);
        if (!value || optionSeen.has(value)) continue;
        optionSeen.add(value);
        options.push(value);
      }
    }

    if (options.length < 2 || options.length > 20) continue;

    seen.add(label);
    candidates.push({
      key: label,
      label,
      category1: cat1,
      options,
      priority: cat1 === '응답자 정보' ? 2 : 1,
      fixed: false
    });
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return { candidates, headerMap };
}

function getDefaultFilterKeys(candidates) {
  const fixed = candidates.filter(item => item.fixed).map(item => item.key);
  const respondentSingles = candidates
    .filter(item => item.category1 === '응답자 정보' && !item.fixed)
    .slice(0, 5)
    .map(item => item.key);

  if (respondentSingles.length > 0) return [...fixed, ...respondentSingles];
  return [...fixed, ...candidates.filter(item => !item.fixed).slice(0, 4).map(item => item.key)];
}

function getActiveFilterItems() {
  return filterState.activeKeys
    .map(key => filterState.candidates.find(item => item.key === key))
    .filter(Boolean);
}

function getSelectedValues(key) {
  return filterState.selectedMap.get(key) || new Set();
}

function getFilteredRowCount() {
  const rows = filterState.rows || [];
  if (rows.length === 0) return 0;

  return rows.slice(1).filter(row => {
    return getActiveFilterItems().every(item => {
      const selected = getSelectedValues(item.key);
      if (!selected || selected.size === 0) return true;
      const idx = filterState.headerMap.get(item.key);
      const value = cleanCell((row || [])[idx]);
      return selected.has(value);
    });
  }).length;
}

function updateFilterCount() {
  const nEl = document.getElementById('n-count');
  if (!nEl) return;
  const n = getFilteredRowCount();
  nEl.textContent = n.toLocaleString();
}

function renderFilterSummary(item) {
  const selected = getSelectedValues(item.key);
  if (!selected || selected.size === 0) return '전체';
  if (selected.size === 1) return Array.from(selected)[0];
  return `${selected.size}개 선택`;
}

function renderFilters() {
  const listEl = document.getElementById('filter-list');
  const addWrap = document.getElementById('filter-add');
  const addMenu = document.getElementById('filter-add-menu');
  if (!listEl || !addWrap || !addMenu) return;

  listEl.innerHTML = '';
  getActiveFilterItems().forEach(item => {
    const selected = getSelectedValues(item.key);
    const wrap = document.createElement('div');
    wrap.className = 'filter-control' + (item.fixed ? '' : ' draggable');
    wrap.dataset.key = item.key;
    wrap.draggable = !item.fixed;
    wrap.innerHTML = `
      <button type="button" class="filter-control-btn">
        <span class="filter-control-title">${escapeHtml(item.label)}</span>
        <span class="filter-control-summary">${escapeHtml(renderFilterSummary(item))}</span>
        ${selected.size > 0 ? `<span class="filter-control-count">${selected.size}</span>` : ''}
        ${item.fixed ? '' : '<span class="filter-remove-mark">×</span>'}
      </button>
      <div class="filter-menu"></div>
    `;
    const menu = wrap.querySelector('.filter-menu');
    item.options.forEach(option => {
      const checked = selected.has(option) ? 'checked' : '';
      const row = document.createElement('label');
      row.className = 'filter-option';
      row.innerHTML = `
        <input type="checkbox" value="${escapeHtml(option)}" ${checked}>
        <span class="filter-option-label">${escapeHtml(option)}</span>
      `;
      menu.appendChild(row);
    });

    if (!item.fixed) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'filter-add-item';
      removeBtn.textContent = '필터 제거';
      removeBtn.addEventListener('click', e => {
        e.stopPropagation();
        filterState.activeKeys = filterState.activeKeys.filter(key => key !== item.key);
        filterState.selectedMap.delete(item.key);
        renderFilters();
        updateFilterCount();
      });
      menu.appendChild(removeBtn);
    }

    const btn = wrap.querySelector('.filter-control-btn');
    btn.addEventListener('click', e => {
      const removeClick = !item.fixed && e.target && e.target.closest('.filter-remove-mark');
      if (removeClick) {
        filterState.activeKeys = filterState.activeKeys.filter(key => key !== item.key);
        filterState.selectedMap.delete(item.key);
        renderFilters();
        updateFilterCount();
        return;
      }
      document.querySelectorAll('.filter-control.open').forEach(el => {
        if (el !== wrap) el.classList.remove('open');
      });
      addWrap.classList.remove('open');
      wrap.classList.toggle('open');
      requestAnimationFrame(() => positionPopupWithinMainArea(wrap, wrap.querySelector('.filter-menu')));
    });

    if (!item.fixed) {
      wrap.addEventListener('dragstart', e => {
        filterState.draggingKey = item.key;
        wrap.classList.add('dragging');
        document.body.classList.add('filter-dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', item.key);
        }
      });
      wrap.addEventListener('dragend', () => {
        filterState.draggingKey = null;
        document.body.classList.remove('filter-dragging');
        document.querySelectorAll('.filter-control.drag-over, .filter-control.drop-before, .filter-control.drop-after')
          .forEach(el => el.classList.remove('drag-over', 'drop-before', 'drop-after'));
        wrap.classList.remove('dragging');
      });
      wrap.addEventListener('dragover', e => {
        if (!filterState.draggingKey || filterState.draggingKey === item.key) return;
        e.preventDefault();
        const rect = wrap.getBoundingClientRect();
        const before = e.clientX < rect.left + rect.width / 2;
        wrap.classList.toggle('drop-before', before);
        wrap.classList.toggle('drop-after', !before);
        wrap.classList.add('drag-over');
      });
      wrap.addEventListener('dragleave', () => {
        wrap.classList.remove('drag-over');
        wrap.classList.remove('drop-before', 'drop-after');
      });
      wrap.addEventListener('drop', e => {
        if (!filterState.draggingKey || filterState.draggingKey === item.key) return;
        e.preventDefault();
        const rect = wrap.getBoundingClientRect();
        const before = e.clientX < rect.left + rect.width / 2;
        wrap.classList.remove('drag-over');
        wrap.classList.remove('drop-before', 'drop-after');
        moveActiveFilter(filterState.draggingKey, item.key, before);
      });
    }

    wrap.querySelectorAll('input[type="checkbox"]').forEach(input => {
      input.addEventListener('change', () => {
        const next = new Set(
          Array.from(wrap.querySelectorAll('input[type="checkbox"]:checked')).map(el => el.value)
        );
        filterState.selectedMap.set(item.key, next);
        renderFilters();
        updateFilterCount();
      });
    });

    listEl.appendChild(wrap);
  });

  const remaining = filterState.candidates.filter(item => !filterState.activeKeys.includes(item.key));
  addMenu.innerHTML = '';
  if (remaining.length === 0) {
    addMenu.innerHTML = '<div class="filter-add-empty">추가할 수 있는 필터가 없습니다.</div>';
  } else {
    remaining.forEach(item => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filter-add-item';
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        filterState.activeKeys.push(item.key);
        filterState.selectedMap.set(item.key, new Set());
        addWrap.classList.remove('open');
        renderFilters();
        updateFilterCount();
      });
      addMenu.appendChild(btn);
    });
  }

  const addBtn = document.getElementById('filter-add-btn');
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = '1';
    addBtn.addEventListener('click', () => {
      document.querySelectorAll('.filter-control.open').forEach(el => el.classList.remove('open'));
      addWrap.classList.toggle('open');
      requestAnimationFrame(() => positionPopupWithinMainArea(addWrap, addMenu));
    });
  }

  if (!document.body.dataset.filterCloseBound) {
    document.body.dataset.filterCloseBound = '1';
    document.addEventListener('click', e => {
      if (!e.target.closest('.filter-control')) {
        document.querySelectorAll('.filter-control.open').forEach(el => el.classList.remove('open'));
      }
      if (!e.target.closest('.filter-add')) {
        const add = document.getElementById('filter-add');
        if (add) add.classList.remove('open');
      }
    });
  }
}

function moveActiveFilter(sourceKey, targetKey, beforeTarget = true) {
  const sourceIndex = filterState.activeKeys.indexOf(sourceKey);
  const targetIndex = filterState.activeKeys.indexOf(targetKey);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;

  const sourceItem = filterState.candidates.find(item => item.key === sourceKey);
  const targetItem = filterState.candidates.find(item => item.key === targetKey);
  if (!sourceItem || !targetItem) return;
  if (sourceItem.fixed || targetItem.fixed) return;

  const fixedKeys = filterState.activeKeys.filter(key => {
    const item = filterState.candidates.find(candidate => candidate.key === key);
    return item && item.fixed;
  });
  const movableKeys = filterState.activeKeys.filter(key => {
    const item = filterState.candidates.find(candidate => candidate.key === key);
    return !item || !item.fixed;
  });

  const from = movableKeys.indexOf(sourceKey);
  const to = movableKeys.indexOf(targetKey);
  if (from < 0 || to < 0) return;

  const [moved] = movableKeys.splice(from, 1);
  let insertIndex = to;
  if (!beforeTarget && from < to) insertIndex = to;
  else if (!beforeTarget && from > to) insertIndex = to + 1;
  else if (beforeTarget && from < to) insertIndex = Math.max(0, to - 1);
  movableKeys.splice(insertIndex, 0, moved);
  filterState.activeKeys = [...fixedKeys, ...movableKeys];
  renderFilters();
}

function positionPopupWithinMainArea(anchorEl, menuEl) {
  if (!anchorEl || !menuEl) return;
  const mainArea = document.querySelector('.main-area');
  if (!mainArea) return;

  menuEl.style.left = '0';
  menuEl.style.right = 'auto';

  const anchorRect = anchorEl.getBoundingClientRect();
  const menuRect = menuEl.getBoundingClientRect();
  const mainRect = mainArea.getBoundingClientRect();
  const desiredLeft = Math.min(
    Math.max(anchorRect.left, mainRect.left + 8),
    Math.max(mainRect.left + 8, mainRect.right - menuRect.width - 8)
  );
  menuEl.style.left = `${desiredLeft - anchorRect.left}px`;
}

async function setupFilters() {
  const currentId = sessionStorage.getItem('survey.currentId');
  const nEl = document.getElementById('n-count');
  if (!currentId || !nEl) return;

  const surveys = loadSurveys();
  const cur = surveys.find(s => s.id === currentId);
  if (!cur || !cur.files || !cur.files.codebook || !cur.files.label) {
    filterState.candidates = [];
    filterState.activeKeys = [];
    filterState.selectedMap = new Map();
    filterState.rows = [];
    filterState.headerMap = new Map();
    renderFilters();
    nEl.textContent = '0';
    return;
  }

  const codebookRows = await loadRowsFromStoredFile(cur.files.codebook);
  const labelRows = await loadRowsFromStoredFile(cur.files.label);
  const { candidates, headerMap } = buildFilterCandidates(codebookRows || [], labelRows || []);

  filterState.candidates = candidates;
  filterState.defaultKeys = getDefaultFilterKeys(candidates);
  const fixedKeys = candidates.filter(item => item.fixed).map(item => item.key);
  filterState.activeKeys = filterState.activeKeys.length
    ? filterState.activeKeys.filter(key => candidates.some(item => item.key === key))
    : [...filterState.defaultKeys];
  fixedKeys.forEach(key => {
    if (!filterState.activeKeys.includes(key)) filterState.activeKeys.unshift(key);
  });
  filterState.rows = labelRows || [];
  filterState.headerMap = headerMap;

  const nextSelectedMap = new Map();
  filterState.activeKeys.forEach(key => {
    const prev = filterState.selectedMap.get(key);
    nextSelectedMap.set(key, prev instanceof Set ? prev : new Set());
  });
  filterState.selectedMap = nextSelectedMap;

  renderFilters();
  updateFilterCount();
}

function renameSurvey(id, newTitle) {
  const clean = String(newTitle || '').trim().slice(0, 50);
  if (!clean) return false;
  const list = loadSurveys();
  const idx = list.findIndex(s => s.id === id);
  if (idx < 0) return false;
  list[idx].title = clean;
  list[idx].updatedAt = new Date().toISOString();
  saveSurveys(list);
  if (sessionStorage.getItem('survey.currentId') === id) {
    try { sessionStorage.setItem('survey.title', clean); } catch (_) {}
    const el = document.getElementById('project-title');
    if (el) el.textContent = clean;
  }
  return true;
}

// 설문 제목 수정, 저장된 대시보드 목록 모달, 저장 버튼 동작을 연결합니다.
function setupTitleRename() {
  const titleEl = document.getElementById('project-title');
  const inputEl = document.getElementById('project-title-input');
  const editBtn = document.getElementById('title-edit-btn');
  if (!titleEl || !inputEl || !editBtn) return;

  function startEdit() {
    inputEl.value = titleEl.textContent;
    titleEl.hidden = true;
    editBtn.hidden = true;
    inputEl.hidden = false;
    inputEl.focus();
    inputEl.select();
  }

  function commit() {
    const next = inputEl.value.trim().slice(0, 50);
    const prev = titleEl.textContent;
    if (next && next !== prev) {
      const currentId = sessionStorage.getItem('survey.currentId');
      if (currentId) {
        renameSurvey(currentId, next);
      } else {
        titleEl.textContent = next;
        try { sessionStorage.setItem('survey.title', next); } catch (_) {}
      }
    }
    titleEl.hidden = false;
    editBtn.hidden = false;
    inputEl.hidden = true;
  }

  function cancel() {
    titleEl.hidden = false;
    editBtn.hidden = false;
    inputEl.hidden = true;
  }

  editBtn.addEventListener('click', startEdit);
  titleEl.addEventListener('dblclick', startEdit);
  inputEl.addEventListener('blur', commit);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); inputEl.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); inputEl.value = titleEl.textContent; cancel(); }
  });
}

function setupSavedModal() {
  const listModal = document.getElementById('list-modal');
  const openListBtn = document.getElementById('dashboard-list-btn');
  const closeListBtn = document.getElementById('close-list-btn');
  const savedList = document.getElementById('saved-list');
  const savedCountBadge = document.getElementById('saved-count');
  const saveBtn = document.getElementById('dashboard-save-btn');
  const newBtn = document.getElementById('new-analysis-btn');
  const dataUpdateBtn = document.getElementById('dashboard-data-update-btn');
  const dataUpdateModal = document.getElementById('data-update-modal');
  const closeDataUpdateBtn = document.getElementById('close-data-update-btn');
  const dataUpdateList = document.getElementById('data-update-list');
  const dataUpdateFileInput = document.getElementById('data-update-file-input');

  function refreshCount() {
    if (savedCountBadge) savedCountBadge.textContent = loadSurveys().length;
  }

  function getCurrentSurvey() {
    const currentId = sessionStorage.getItem('survey.currentId');
    const surveys = loadSurveys();
    return {
      currentId,
      surveys,
      current: surveys.find(s => s.id === currentId)
    };
  }

  function openSurvey(id) {
    const found = loadSurveys().find(s => s.id === id);
    if (!found) return;
    try {
      sessionStorage.setItem('survey.currentId', id);
      sessionStorage.setItem('survey.title', found.title);
    } catch (_) {}
    window.location.href = 'dashboard.html';
  }

  function renderList() {
    if (!savedList) return;
    const items = loadSurveys();
    savedList.innerHTML = '';

    if (items.length === 0) {
      savedList.innerHTML = '<div class="saved-empty">아직 저장된 대시보드가 없습니다.<br>대시보드를 저장하면 여기에 쌓입니다.</div>';
      return;
    }

    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'saved-item';
      row.dataset.id = item.id;
      row.innerHTML = `
        <div class="saved-main" data-id="${item.id}">
          <div class="saved-title" data-id="${item.id}">${escapeHtml(item.title)}</div>
          <input type="text" class="saved-title-input" maxlength="50" hidden>
          <div class="saved-meta">저장일 ${formatDate(item.updatedAt || item.createdAt)}</div>
        </div>
        <div class="saved-actions">
          <button type="button" class="saved-rename" data-rename="${item.id}">이름 바꾸기</button>
          <button type="button" class="saved-delete" data-del="${item.id}">삭제</button>
        </div>
      `;
      savedList.appendChild(row);
    });

    savedList.querySelectorAll('.saved-main').forEach(main => {
      main.addEventListener('click', () => {
        const input = main.querySelector('.saved-title-input');
        if (input && !input.hidden) return;
        openSurvey(main.dataset.id);
      });
    });

    savedList.querySelectorAll('.saved-rename').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const row = btn.closest('.saved-item');
        const id = btn.dataset.rename;
        const titleEl = row.querySelector('.saved-title');
        const inputEl = row.querySelector('.saved-title-input');

        inputEl.value = titleEl.textContent;
        titleEl.hidden = true;
        inputEl.hidden = false;
        inputEl.focus();
        inputEl.select();

        function commit() {
          inputEl.removeEventListener('blur', commit);
          inputEl.removeEventListener('keydown', onKey);
          const next = inputEl.value.trim().slice(0, 50);
          if (next && next !== titleEl.textContent) renameSurvey(id, next);
          renderList();
          refreshCount();
        }
        function cancel() {
          inputEl.removeEventListener('blur', commit);
          inputEl.removeEventListener('keydown', onKey);
          titleEl.hidden = false;
          inputEl.hidden = true;
        }
        function onKey(ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); inputEl.blur(); }
          else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
        }
        inputEl.addEventListener('blur', commit);
        inputEl.addEventListener('keydown', onKey);
      });
    });

    savedList.querySelectorAll('[data-del]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm('이 대시보드를 삭제하시겠습니까?')) return;
        const id = el.dataset.del;
        const next = loadSurveys().filter(s => s.id !== id);
        saveSurveys(next);
        if (sessionStorage.getItem('survey.currentId') === id) {
          try {
            sessionStorage.removeItem('survey.currentId');
            sessionStorage.removeItem('survey.title');
          } catch (_) {}
        }
        renderList();
        refreshCount();
      });
    });
  }

  function saveCurrentSurvey() {
    const currentId = sessionStorage.getItem('survey.currentId');
    const title = (document.getElementById('project-title')?.textContent || '새 대시보드').trim();
    const surveys = loadSurveys();
    const now = new Date().toISOString();
    const idx = surveys.findIndex(s => s.id === currentId);

    if (idx >= 0) {
      surveys[idx].title = title || surveys[idx].title;
      surveys[idx].updatedAt = now;
      if (saveSurveys(surveys)) {
        refreshCount();
        alert('현재 대시보드를 저장했습니다.');
      }
      return;
    }

    const id = 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const current = getCurrentSurvey().current;
    if (!current || !current.files) {
      alert('저장할 데이터가 아직 준비되지 않았습니다.');
      return;
    }
    surveys.unshift({
      id,
      title: title || '새 대시보드',
      createdAt: now,
      updatedAt: now,
      files: current.files
    });
    if (saveSurveys(surveys)) {
      try {
        sessionStorage.setItem('survey.currentId', id);
        sessionStorage.setItem('survey.title', title || '새 대시보드');
      } catch (_) {}
      refreshCount();
      alert('현재 대시보드를 저장했습니다.');
    }
  }

  function renderDataUpdateList() {
    if (!dataUpdateList) return;
    const { current } = getCurrentSurvey();
    if (!current || !current.files) {
      dataUpdateList.innerHTML = '<div class="saved-empty">현재 연결된 데이터가 없습니다.</div>';
      return;
    }
    const items = [
      { key: 'codebook', label: '문항 코드북', file: current.files.codebook },
      { key: 'value', label: '응답 데이터셋_숫자형', file: current.files.value },
      { key: 'label', label: '응답 데이터셋_라벨형', file: current.files.label }
    ];
    dataUpdateList.innerHTML = items.map(item => `
      <div class="saved-item">
        <div class="saved-main">
          <div class="saved-title">${escapeHtml(item.label)}</div>
          <div class="saved-meta">${escapeHtml(item.file?.name || '파일 없음')}</div>
        </div>
        <div class="saved-actions">
          <button type="button" class="saved-rename" data-file-update="${item.key}">교체하기</button>
        </div>
      </div>
    `).join('');

    dataUpdateList.querySelectorAll('[data-file-update]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!dataUpdateFileInput) return;
        dataUpdateFileInput.dataset.targetKey = btn.dataset.fileUpdate;
        dataUpdateFileInput.click();
      });
    });
  }

  async function convertFileToStoredRec(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'csv') {
      return {
        name: file.name,
        size: file.size,
        contentType: 'csv-text',
        content: await readAsText(file)
      };
    }
    if (ext === 'xlsx') {
      return {
        name: file.name,
        size: file.size,
        contentType: 'xlsx-base64',
        content: arrayBufferToBase64(await readAsArrayBuffer(file))
      };
    }
    throw new Error('unsupported');
  }

  async function handleDataFileReplace(file, key) {
    if (!file || !key) return;
    const { currentId, surveys, current } = getCurrentSurvey();
    if (!currentId || !current) {
      alert('현재 대시보드를 찾을 수 없습니다.');
      return;
    }
    const idx = surveys.findIndex(s => s.id === currentId);
    if (idx < 0) return;

    const nextFile = await convertFileToStoredRec(file);
    surveys[idx].files = { ...(surveys[idx].files || {}), [key]: nextFile };
    surveys[idx].updatedAt = new Date().toISOString();
    if (!saveSurveys(surveys)) return;

    if (key === 'codebook') resultState.codebookByLabel = new Map();
    await setupFilters();
    try {
      const rows = await loadCodebookRows(surveys[idx].files.codebook);
      if (rows) {
        resultState.codebookByLabel = buildCodebookIndex(rows);
        renderTree(buildQuestionTree(rows));
      }
    } catch (_) {}
    renderDataUpdateList();
    renderResults();
    alert('데이터 파일을 교체했습니다.');
  }

  refreshCount();

  if (saveBtn) saveBtn.addEventListener('click', saveCurrentSurvey);
  if (newBtn) newBtn.addEventListener('click', () => { window.location.href = 'home.html'; });
  if (openListBtn && listModal) {
    openListBtn.addEventListener('click', () => {
      renderList();
      listModal.classList.add('show');
    });
  }
  if (closeListBtn && listModal) {
    closeListBtn.addEventListener('click', () => listModal.classList.remove('show'));
    listModal.addEventListener('click', e => {
      if (e.target === listModal) listModal.classList.remove('show');
    });
  }

  if (dataUpdateBtn && dataUpdateModal) {
    dataUpdateBtn.addEventListener('click', () => {
      renderDataUpdateList();
      dataUpdateModal.classList.add('show');
    });
  }
  if (closeDataUpdateBtn && dataUpdateModal) {
    closeDataUpdateBtn.addEventListener('click', () => dataUpdateModal.classList.remove('show'));
    dataUpdateModal.addEventListener('click', e => {
      if (e.target === dataUpdateModal) dataUpdateModal.classList.remove('show');
    });
  }

  if (dataUpdateFileInput) {
    dataUpdateFileInput.addEventListener('change', async () => {
      const file = dataUpdateFileInput.files && dataUpdateFileInput.files[0];
      const key = dataUpdateFileInput.dataset.targetKey;
      try {
        await handleDataFileReplace(file, key);
      } catch (_) {
        alert('파일 교체 중 오류가 발생했습니다. CSV/XLSX 파일인지 확인해 주세요.');
      } finally {
        dataUpdateFileInput.value = '';
      }
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (listModal) listModal.classList.remove('show');
    if (dataUpdateModal) dataUpdateModal.classList.remove('show');
  });
}

/* =====================================================================
   [객관식 단일] 분석 결과 렌더링
   - data_visualization.md 의 2-1 규칙을 따릅니다.
   - 기본 차트: 가로 막대 그래프, 데이터 레이블 = 비율(%)
   - 그룹별 비교 차트: 전체 결과는 연한 회색 막대, 그룹 결과는 꺾은선
   - 데이터 테이블: 보기별 비율(%) 과 응답자 수(N)
   - 툴팁/범례는 스펙에 맞춰 구성
   ===================================================================== */

// 보조 헬퍼: 기존 코드가 참조하지만 정의되지 않은 함수들을 최소 보완합니다.
if (typeof cleanCell !== 'function') {
  window.cleanCell = function cleanCell(v) {
    return String(v == null ? '' : v).replace(/^\uFEFF/, '').trim();
  };
}
if (typeof loadRowsFromStoredFile !== 'function') {
  window.loadRowsFromStoredFile = function loadRowsFromStoredFile(fileRec) {
    return loadCodebookRows(fileRec);
  };
}

const GROUP_PALETTE = [
  '#5b7a9a', '#c67b7b', '#7ba87a', '#c6a77b',
  '#a77bc6', '#7bbfb8', '#c67bad', '#9ba07b'
];
const SINGLE_BAR_COLOR = '#5a6674';
const COMPARE_BAR_COLOR = '#e4e4e4';

const resultState = {
  codebookByLabel: new Map(),
  hiddenGroupKeys: new Map(), // targetLabel -> Set of hidden group values
  tooltipEl: null,
  initialized: false
};

function buildCodebookIndex(codebookRows) {
  const map = new Map();
  if (!codebookRows || codebookRows.length < 2) return map;
  const header = (codebookRows[0] || []).map(normalizeHeader);
  const col = name => header.indexOf(name);
  const iLabel = col('question_label');
  const iFull = col('question_full');
  const iType = col('response_type');
  const iRole = col('data_column_role');
  const iOptions = col('response_options');
  const iOther = col('other_input_expected');

  for (let r = 1; r < codebookRows.length; r++) {
    const row = codebookRows[r] || [];
    const label = cleanCell(row[iLabel]);
    if (!label || map.has(label)) continue;
    const opts = cleanCell(row[iOptions])
      .split('|').map(cleanCell).filter(Boolean);
    map.set(label, {
      label,
      full: cleanCell(row[iFull]),
      type: cleanCell(row[iType]),
      role: cleanCell(row[iRole]),
      options: opts,
      otherInput: cleanCell(row[iOther]).toUpperCase() === 'Y'
    });
  }
  return map;
}

function getTargetChipLabels() {
  return Array.from(document.querySelectorAll('#drop-target .chip'))
    .map(c => c.dataset.label)
    .filter(Boolean);
}
function getCriterionChipLabel() {
  const chip = document.querySelector('#drop-criterion .chip');
  return chip ? chip.dataset.label : null;
}

function clearDropZone(zoneId) {
  const zone = document.getElementById(zoneId);
  if (!zone) return;
  zone.querySelectorAll('.chip').forEach(chip => chip.remove());
  zone.classList.remove('has-chip');
  const countId = zone.dataset.zone === 'target' ? 'target-count' : 'criterion-count';
  const countEl = document.getElementById(countId);
  if (countEl) countEl.textContent = '0';
}

function getFilteredLabelDataRows() {
  const rows = filterState.rows || [];
  if (rows.length < 2) return [];
  return rows.slice(1).filter(row => {
    return getActiveFilterItems().every(item => {
      const selected = getSelectedValues(item.key);
      if (!selected || selected.size === 0) return true;
      const idx = filterState.headerMap.get(item.key);
      const value = cleanCell((row || [])[idx]);
      return selected.has(value);
    });
  });
}

function aggregateSingle(targetLabel, criterionLabel, rows) {
  const entry = resultState.codebookByLabel.get(targetLabel);
  if (!entry) return null;
  const tIdx = filterState.headerMap ? filterState.headerMap.get(targetLabel) : undefined;
  if (tIdx === undefined) return null;

  // 보기 목록: 코드북 기준 우선, 데이터에만 존재하는 값은 뒤에 보충
  const optionOrder = [...entry.options];
  const optionSet = new Set(optionOrder);
  const totalCount = {};
  optionOrder.forEach(o => totalCount[o] = 0);
  let totalN = 0;

  rows.forEach(row => {
    const v = cleanCell(row[tIdx]);
    if (v === '') return;
    if (!optionSet.has(v)) {
      optionSet.add(v);
      optionOrder.push(v);
      totalCount[v] = 0;
    }
    totalCount[v] = (totalCount[v] || 0) + 1;
    totalN += 1;
  });

  const totalResults = optionOrder.map(o => ({
    option: o,
    count: totalCount[o] || 0,
    pct: totalN > 0 ? ((totalCount[o] || 0) / totalN) * 100 : 0
  }));

  // 응답이 0건인 보기는 차트/테이블에서 모두 제외
  const visibleOptionOrder = optionOrder.filter(o => (totalCount[o] || 0) > 0);
  const visibleOptionSet = new Set(visibleOptionOrder);
  const visibleTotalResults = totalResults.filter(r => visibleOptionSet.has(r.option));

  let groupResults = null;
  if (criterionLabel) {
    const critEntry = resultState.codebookByLabel.get(criterionLabel);
    const cIdx = filterState.headerMap.get(criterionLabel);
    if (critEntry && cIdx !== undefined) {
      const groupOrder = [...critEntry.options];
      const groupSet = new Set(groupOrder);
      const byGroup = new Map();
      groupOrder.forEach(gv => {
        byGroup.set(gv, { n: 0, count: Object.fromEntries(optionOrder.map(o => [o, 0])) });
      });

      rows.forEach(row => {
        const gv = cleanCell(row[cIdx]);
        const v = cleanCell(row[tIdx]);
        if (gv === '' || v === '') return;
        if (!groupSet.has(gv)) {
          groupSet.add(gv);
          groupOrder.push(gv);
          byGroup.set(gv, { n: 0, count: Object.fromEntries(optionOrder.map(o => [o, 0])) });
        }
        if (!optionSet.has(v)) {
          optionSet.add(v);
          optionOrder.push(v);
          byGroup.forEach(g => { if (g.count[v] === undefined) g.count[v] = 0; });
          totalResults.push({ option: v, count: 0, pct: 0 });
        }
        const g = byGroup.get(gv);
        g.count[v] = (g.count[v] || 0) + 1;
        g.n += 1;
      });

      groupResults = groupOrder.map(gv => {
        const g = byGroup.get(gv);
        return {
          value: gv,
          label: `${criterionLabel}: ${gv}`,
          n: g.n,
          results: visibleOptionOrder.map(o => ({
            option: o,
            count: g.count[o] || 0,
            pct: g.n > 0 ? ((g.count[o] || 0) / g.n) * 100 : 0
          }))
        };
      });
    }
  }

  return {
    targetLabel,
    codebookEntry: entry,
    totalN,
    optionOrder: visibleOptionOrder,
    totalResults: visibleTotalResults,
    criterionLabel: groupResults ? criterionLabel : null,
    groupResults
  };
}

function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0.0%';
  return `${(Math.round((num + 1e-10) * 10) / 10).toFixed(1)}%`;
}

function buildBasicChartHtml(data) {
  const rows = data.totalResults;
  const rowHtml = rows.map(r => {
    const widthStr = `${Math.max(0, Math.min(100, r.pct))}%`;
    const tip = encodeURIComponent(JSON.stringify({
      kind: 'basic-bar',
      option: r.option,
      pct: r.pct,
      count: r.count
    }));
    return `
      <div class="hbar-row">
        <div class="hbar-label" title="${escapeHtml(r.option)}">${escapeHtml(r.option)}</div>
        <div class="hbar-track">
          <div class="hbar-fill"
               style="width:${widthStr}; background:${SINGLE_BAR_COLOR};"
               data-tip="${tip}"></div>
        </div>
        <div class="hbar-value">${formatPercent(r.pct)}</div>
      </div>
    `;
  }).join('');
  return `<div class="hbar-chart">${rowHtml}</div>`;
}

function buildGroupCompareChartHtml(data, hidden) {
  const rows = data.totalResults;
  const rowHtml = rows.map(r => {
    const widthStr = `${Math.max(0, Math.min(100, r.pct))}%`;
    const tip = encodeURIComponent(JSON.stringify({
      kind: 'compare-bar',
      option: r.option,
      pct: r.pct,
      count: r.count
    }));
    return `
      <div class="hbar-row">
        <div class="hbar-label" title="${escapeHtml(r.option)}">${escapeHtml(r.option)}</div>
        <div class="hbar-track">
          <div class="hbar-fill"
               style="width:${widthStr}; background:${COMPARE_BAR_COLOR};"
               data-tip="${tip}"></div>
        </div>
        <div class="hbar-value">${formatPercent(r.pct)}</div>
      </div>
    `;
  }).join('');

  const numRows = rows.length || 1;
  const rowHeight = 22;
  const rowGap = 8;
  const totalHeight = (numRows * rowHeight) + ((numRows - 1) * rowGap);
  const centerPct = (i) => {
    const px = (i * (rowHeight + rowGap)) + (rowHeight / 2);
    return totalHeight > 0 ? (px / totalHeight) * 100 : 50;
  };

  const pathsHtml = data.groupResults.map((g) => {
    if (hidden.has(g.value)) return '';
    const idx = data.groupResults.indexOf(g);
    const color = GROUP_PALETTE[idx % GROUP_PALETTE.length];
    const pts = rows.map((r, i) => {
      const gr = g.results.find(x => x.option === r.option) || { pct: 0, count: 0 };
      const cx = Math.max(0, Math.min(100, gr.pct));
      const cy = centerPct(i);
      return { cx, cy };
    });
    const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.cx} ${p.cy}`).join(' ');
    return `<path class="group-path" d="${path}" stroke="${color}" vector-effect="non-scaling-stroke" />`;
  }).join('');

  const dotsHtml = data.groupResults.map((g) => {
    if (hidden.has(g.value)) return '';
    const idx = data.groupResults.indexOf(g);
    const color = GROUP_PALETTE[idx % GROUP_PALETTE.length];
    return rows.map((r, i) => {
      const gr = g.results.find(x => x.option === r.option) || { pct: 0, count: 0 };
      const left = Math.max(0, Math.min(100, gr.pct));
      const top = centerPct(i);
      const tip = encodeURIComponent(JSON.stringify({
        kind: 'group-dot',
        groupLabel: g.label,
        option: r.option,
        pct: gr.pct,
        count: gr.count
      }));
      return `<div class="group-dot"
                   style="left:${left}%; top:${top}%; background:${color};"
                   data-tip="${tip}"></div>`;
    }).join('');
  }).join('');

  return `
    <div class="hbar-chart group-compare">
      ${rowHtml}
      <div class="hbar-group-overlay">
        <svg class="group-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          ${pathsHtml}
        </svg>
        ${dotsHtml}
      </div>
    </div>
  `;
}

function buildLegendHtml(data, hidden) {
  if (!data.groupResults) return '';
  const items = data.groupResults.map((g, i) => {
    const color = GROUP_PALETTE[i % GROUP_PALETTE.length];
    const isHidden = hidden.has(g.value);
    return `
      <label class="legend-item ${isHidden ? 'disabled' : ''}" data-group="${escapeHtml(g.value)}">
        <input type="checkbox" ${isHidden ? '' : 'checked'}>
        <span class="legend-swatch" style="background:${color}"></span>
        <span>${escapeHtml(g.label)} · N=${g.n.toLocaleString()}</span>
      </label>
    `;
  }).join('');
  return `
    <aside class="legend-panel">
      <div class="legend-title">범례</div>
      <div class="legend" data-target="${escapeHtml(data.targetLabel)}">${items}</div>
    </aside>
  `;
}

function buildDataTableHtml(data) {
  const { totalResults, groupResults, totalN } = data;
  if (!groupResults) {
    const sumPct = totalResults.reduce((s, r) => s + r.pct, 0);
    return `
      <div class="result-table-wrap">
        <table class="result-table">
          <thead>
            <tr>
              <th>응답 보기</th>
              <th class="num">비율(%)</th>
              <th class="num">응답자 수 (N)</th>
            </tr>
          </thead>
          <tbody>
            ${totalResults.map(r => `
              <tr>
                <td>${escapeHtml(r.option)}</td>
                <td class="num">${formatPercent(r.pct)}</td>
                <td class="num">${r.count.toLocaleString()}</td>
              </tr>
            `).join('')}
            <tr class="total-row">
              <td>합계</td>
              <td class="num">${formatPercent(sumPct)}</td>
              <td class="num">${totalN.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  const topRow1 = [
    `<th rowspan="2">응답 보기</th>`,
    `<th colspan="2" class="group-head">응답자 전체<br><span style="font-weight:500;color:var(--text-3);">N=${totalN.toLocaleString()}</span></th>`,
    ...groupResults.map(g => `<th colspan="2" class="group-head">${escapeHtml(g.label)}<br><span style="font-weight:500;color:var(--text-3);">N=${g.n.toLocaleString()}</span></th>`)
  ].join('');
  const topRow2 = [
    `<th class="num group-col">비율(%)</th><th class="num">N</th>`,
    ...groupResults.map(() => `<th class="num group-col">비율(%)</th><th class="num">N</th>`)
  ].join('');

  const bodyRows = totalResults.map(r => {
    const groupCells = groupResults.map(g => {
      const gr = g.results.find(x => x.option === r.option) || { pct: 0, count: 0 };
      return `<td class="num group-col">${formatPercent(gr.pct)}</td><td class="num">${gr.count.toLocaleString()}</td>`;
    }).join('');
    return `
      <tr>
        <td>${escapeHtml(r.option)}</td>
        <td class="num group-col">${formatPercent(r.pct)}</td>
        <td class="num">${r.count.toLocaleString()}</td>
        ${groupCells}
      </tr>
    `;
  }).join('');

  return `
    <div class="result-table-wrap">
      <table class="result-table">
        <thead>
          <tr>${topRow1}</tr>
          <tr>${topRow2}</tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;
}

function findOtherTextColumnIndex(targetLabel) {
  const header = filterState.rows && filterState.rows[0] ? filterState.rows[0] : [];
  if (!Array.isArray(header) || header.length === 0) return undefined;

  const exactCandidates = [
    `${targetLabel}__기타_텍스트`,
    `${targetLabel}__기타 텍스트`,
    `${targetLabel}_기타_텍스트`,
    `${targetLabel}_텍스트`
  ];
  for (const name of exactCandidates) {
    const idx = filterState.headerMap.get(name);
    if (idx !== undefined) return idx;
  }

  for (let i = 0; i < header.length; i++) {
    const name = cleanCell(header[i]);
    if (!name.startsWith(`${targetLabel}__`) && !name.startsWith(`${targetLabel}_`)) continue;
    if (!name.includes('기타') || !name.includes('텍스트')) continue;
    return i;
  }
  return undefined;
}

function buildOtherResponsesHtml(targetLabel, rows) {
  const entry = resultState.codebookByLabel.get(targetLabel);
  if (!entry || !entry.otherInput) return '';

  const textIdx = findOtherTextColumnIndex(targetLabel);
  if (textIdx === undefined) return '';

  const textSet = new Set();
  rows.forEach(row => {
    const text = cleanCell((row || [])[textIdx]);
    if (text) textSet.add(text);
  });

  const texts = [...textSet];
  if (texts.length === 0) return '';

  const listHtml = texts.map(text => `<li>${escapeHtml(text)}</li>`).join('');
  return `
    <div class="other-response-box">
      <div class="other-response-title">기타 응답<span class="other-response-count">${texts.length}건</span></div>
      <ul class="other-response-list">${listHtml}</ul>
    </div>
  `;
}

function buildSectionHtml(data, rows) {
  if (!data) return '';
  const { codebookEntry, targetLabel, totalN, groupResults } = data;
  const hidden = resultState.hiddenGroupKeys.get(targetLabel) || new Set();

  const chartHtml = groupResults
    ? buildGroupCompareChartHtml(data, hidden)
    : buildBasicChartHtml(data);

  const legendHtml = groupResults ? buildLegendHtml(data, hidden) : '';
  const tableHtml = buildDataTableHtml(data);
  const otherHtml = buildOtherResponsesHtml(targetLabel, rows);
  const fullText = codebookEntry.full
    ? `<div class="result-sub">Q. ${escapeHtml(codebookEntry.full)}</div>`
    : '';
  const visualClass = groupResults ? 'result-visual has-legend' : 'result-visual';

  return `
    <section class="result-section" data-target="${escapeHtml(targetLabel)}">
      <div class="result-header">
        <div class="result-title">
          ${escapeHtml(targetLabel)}
          <span class="result-n">N=${totalN.toLocaleString()}</span>
        </div>
        ${fullText}
      </div>
      <div class="${visualClass}">
        <div class="result-chart-col">${chartHtml}</div>
        ${legendHtml}
      </div>
      ${tableHtml}
      ${otherHtml}
    </section>
  `;
}

function buildUnsupportedSection(label, entry) {
  const fullText = entry && entry.full
    ? `<div class="result-sub">Q. ${escapeHtml(entry.full)}</div>`
    : '';
  const typeText = entry ? entry.type : '알 수 없음';
  return `
    <section class="result-section" data-target="${escapeHtml(label)}">
      <div class="result-header">
        <div class="result-title">${escapeHtml(label)}</div>
        ${fullText}
      </div>
      <div class="result-unsupported">
        이 문항 유형(<strong>${escapeHtml(typeText)}</strong>)의 시각화는 아직 준비 중이에요. 현재는 <strong>객관식 단일</strong> 문항만 지원합니다.
      </div>
    </section>
  `;
}

async function ensureCodebookIndexLoaded() {
  if (resultState.codebookByLabel && resultState.codebookByLabel.size > 0) return;
  const currentId = sessionStorage.getItem('survey.currentId');
  if (!currentId) return;
  const surveys = loadSurveys();
  const cur = surveys.find(s => s.id === currentId);
  if (!cur || !cur.files || !cur.files.codebook) return;
  try {
    const rows = await loadCodebookRows(cur.files.codebook);
    if (rows) resultState.codebookByLabel = buildCodebookIndex(rows);
  } catch (_) {}
}

async function renderResults() {
  const container = document.getElementById('result-container');
  if (!container) return;

  const targetLabels = getTargetChipLabels();
  if (targetLabels.length === 0) {
    container.innerHTML = '<div class="result-empty">분석 대상 문항을 좌측에서 드래그해 주세요.</div>';
    return;
  }

  await ensureCodebookIndexLoaded();

  if (!filterState.rows || filterState.rows.length < 2) {
    container.innerHTML = '<div class="result-empty">응답 데이터가 아직 준비되지 않아 결과를 표시할 수 없어요.</div>';
    return;
  }

  const criterionLabel = getCriterionChipLabel();
  const filteredRows = getFilteredLabelDataRows();

  const sections = targetLabels.map(label => {
    const entry = resultState.codebookByLabel.get(label);
    if (!entry) return buildUnsupportedSection(label, null);
    if (entry.type !== '객관식 단일') return buildUnsupportedSection(label, entry);
    const data = aggregateSingle(label, criterionLabel, filteredRows);
    if (!data) return buildUnsupportedSection(label, entry);
    return buildSectionHtml(data, filteredRows);
  }).join('');

  container.innerHTML = sections;
  attachResultEventListeners(container);
}

function attachResultEventListeners(container) {
  ensureTooltip();
  container.querySelectorAll('[data-tip]').forEach(el => {
    el.addEventListener('mouseenter', onTipEnter);
    el.addEventListener('mousemove', onTipMove);
    el.addEventListener('mouseleave', onTipLeave);
  });
  container.querySelectorAll('.legend').forEach(legend => {
    const targetLabel = legend.dataset.target;
    legend.querySelectorAll('.legend-item').forEach(item => {
      const cb = item.querySelector('input[type="checkbox"]');
      if (!cb) return;
      cb.addEventListener('change', () => {
        const hidden = resultState.hiddenGroupKeys.get(targetLabel) || new Set();
        if (cb.checked) hidden.delete(item.dataset.group);
        else hidden.add(item.dataset.group);
        resultState.hiddenGroupKeys.set(targetLabel, hidden);
        renderResults();
      });
    });
  });
}

function ensureTooltip() {
  if (resultState.tooltipEl && document.body.contains(resultState.tooltipEl)) {
    return resultState.tooltipEl;
  }
  const el = document.createElement('div');
  el.className = 'result-tooltip';
  document.body.appendChild(el);
  resultState.tooltipEl = el;
  return el;
}

function onTipEnter(e) {
  const tip = ensureTooltip();
  const raw = e.currentTarget.dataset.tip;
  if (!raw) return;
  let data;
  try { data = JSON.parse(decodeURIComponent(raw)); } catch (_) { return; }
  tip.innerHTML = formatTooltipHtml(data);
  tip.style.display = 'block';
  positionTooltip(tip, e);
}
function onTipMove(e) {
  const tip = resultState.tooltipEl;
  if (!tip || tip.style.display === 'none') return;
  positionTooltip(tip, e);
}
function onTipLeave() {
  const tip = resultState.tooltipEl;
  if (tip) tip.style.display = 'none';
}
function positionTooltip(tip, e) {
  const pad = 12;
  const rect = tip.getBoundingClientRect();
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + rect.width > window.innerWidth - 4) x = e.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 4) y = e.clientY - rect.height - pad;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}

function formatTooltipHtml(d) {
  const pct = (v) => formatPercent(v);
  const n = (v) => 'N=' + Number(v || 0).toLocaleString();
  const line = (s) => `<div>${s}</div>`;
  switch (d.kind) {
    case 'basic-bar':
      return [
        line(escapeHtml(d.option)),
        line(pct(d.pct)),
        line(n(d.count))
      ].join('');
    case 'compare-bar':
      return [
        '<div>응답자 전체</div>',
        line(escapeHtml(d.option)),
        line(pct(d.pct)),
        line(n(d.count))
      ].join('');
    case 'group-dot':
      return [
        line(escapeHtml(d.groupLabel)),
        line(escapeHtml(d.option)),
        line(pct(d.pct)),
        line(n(d.count))
      ].join('');
    default:
      return '';
  }
}

// 드롭존 변경 감지 (chip 추가/제거)
function observeDropZones() {
  ['drop-target', 'drop-criterion'].forEach(id => {
    const zone = document.getElementById(id);
    if (!zone) return;
    const obs = new MutationObserver(() => {
      // 드롭존의 자식이 바뀌면 결과 재렌더링
      renderResults();
    });
    obs.observe(zone, { childList: true, subtree: false });
  });
}

// 필터 변경 감지: updateFilterCount 를 래핑해서 결과 재렌더링
function hookFilterUpdates() {
  if (typeof updateFilterCount !== 'function') return;
  const original = updateFilterCount;
  window.updateFilterCount = function() {
    let ret;
    try { ret = original.apply(this, arguments); }
    finally { renderResults(); }
    return ret;
  };
}

// 초기화
async function initResultFeature() {
  if (resultState.initialized) return;
  resultState.initialized = true;

  // 좌측 패널/드래그/필터 등 기존 셋업을 순차 실행 (일부 이미 호출되었어도 안전하게 try)
  const currentId = sessionStorage.getItem('survey.currentId');
  if (currentId) {
    const surveys = loadSurveys();
    const cur = surveys.find(s => s.id === currentId);
    if (cur && cur.files && cur.files.codebook) {
      try {
        const rows = await loadCodebookRows(cur.files.codebook);
        if (rows) {
          resultState.codebookByLabel = buildCodebookIndex(rows);
          try { renderTree(buildQuestionTree(rows)); } catch (_) {}
        }
      } catch (_) {}
    }
    // 설문 제목 초기 세팅
    const titleEl = document.getElementById('project-title');
    if (titleEl && cur && cur.title) {
      try { titleEl.textContent = cur.title; } catch (_) {}
    }
  }

  try { setupAccordion && setupAccordion(); } catch (_) {}
  try { setupSearch && setupSearch(); } catch (_) {}
  try { setupPanelToggle && setupPanelToggle(); } catch (_) {}
  try { setupSelectionAndDragDrop && setupSelectionAndDragDrop(); } catch (_) {}
  try { setupTitleRename && setupTitleRename(); } catch (_) {}
  try { setupSavedModal && setupSavedModal(); } catch (_) {}
  try { await setupFilters(); } catch (_) {}

  hookFilterUpdates();
  observeDropZones();
  renderResults();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { initResultFeature(); });
} else {
  setTimeout(() => { initResultFeature(); }, 0);
}
