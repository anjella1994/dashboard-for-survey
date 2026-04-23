// 저장된 설문 대시보드 목록을 브라우저 저장소에서 읽고 쓰는 유틸리티입니다.
const STORAGE_KEY = 'p6s.surveys';
const FILE_DB_NAME = 'p6s.surveyFiles';
const FILE_DB_VERSION = 1;
const FILE_STORE_NAME = 'files';

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

function openFileDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FILE_DB_NAME, FILE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FILE_STORE_NAME)) {
        db.createObjectStore(FILE_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(id) {
  return openFileDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_STORE_NAME, 'readonly');
    const req = tx.objectStore(FILE_STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  }));
}

function idbPut(record) {
  return openFileDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_STORE_NAME, 'readwrite');
    tx.objectStore(FILE_STORE_NAME).put(record);
    tx.oncomplete = () => {
      db.close();
      resolve(record);
    };
    tx.onerror = () => reject(tx.error);
  }));
}

function idbDelete(id) {
  return openFileDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_STORE_NAME, 'readwrite');
    tx.objectStore(FILE_STORE_NAME).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  }));
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

async function makeFileStorageKey(fileRec) {
  const signature = [
    fileRec.name || '',
    fileRec.size || 0,
    fileRec.contentType || '',
    fileRec.content || ''
  ].join('::');
  return `file:${await sha256(signature)}`;
}

function isFileReferencedElsewhere(fileId, surveys, excludeSurveyId) {
  return surveys.some(survey => {
    if (!survey || survey.id === excludeSurveyId || !survey.files) return false;
    return ['codebook', 'value', 'label'].some(key => {
      const fileRec = survey.files[key];
      return fileRec && fileRec.idbKey === fileId;
    });
  });
}

async function deleteSurveyFiles(surveyId, files, surveys) {
  const tasks = [];
  ['codebook', 'value', 'label'].forEach(key => {
    const fileRec = files && files[key];
    const id = fileRec && fileRec.idbKey ? fileRec.idbKey : `${surveyId}:${key}`;
    if (id && !isFileReferencedElsewhere(id, surveys || [], surveyId)) {
      tasks.push(idbDelete(id).catch(() => {}));
    }
  });
  await Promise.all(tasks);
}

async function persistStoredFile(surveyId, key, fileRec) {
  if (!fileRec) return null;
  const idbKey = await makeFileStorageKey(fileRec);
  await idbPut({
    id: idbKey,
    surveyId,
    key,
    name: fileRec.name,
    size: fileRec.size || 0,
    contentType: fileRec.contentType,
    content: fileRec.content
  });
  return {
    name: fileRec.name,
    size: fileRec.size || 0,
    contentType: fileRec.contentType,
    idbKey
  };
}

async function getStoredFilePayload(fileRec) {
  if (!fileRec) return null;
  if (fileRec.content) return fileRec;
  if (!fileRec.idbKey) return fileRec;
  const stored = await idbGet(fileRec.idbKey).catch(() => null);
  if (!stored) return null;
  return {
    name: stored.name,
    size: stored.size,
    contentType: stored.contentType,
    content: stored.content
  };
}

async function migrateLegacySurveyStorage() {
  const surveys = loadSurveys();
  let changed = false;
  for (const survey of surveys) {
    if (!survey || !survey.files) continue;
    for (const key of ['codebook', 'value', 'label']) {
      const fileRec = survey.files[key];
      if (!fileRec || !fileRec.content || fileRec.idbKey) continue;
      const idbKey = await makeFileStorageKey(fileRec);
      const existing = await idbGet(idbKey).catch(() => null);
      if (!existing) {
        await idbPut({
          id: idbKey,
          surveyId: survey.id,
          key,
          name: fileRec.name,
          size: fileRec.size || 0,
          contentType: fileRec.contentType,
          content: fileRec.content
        });
      }
      delete fileRec.content;
      fileRec.idbKey = idbKey;
      changed = true;
    }
  }
  if (changed) saveSurveys(surveys);
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

async function readTabularFile(file, maxRows = null) {
  const ext = (file && file.name ? file.name.split('.').pop() : '').toLowerCase();
  if (ext === 'csv') {
    const text = await readAsText(file);
    const rows = parseCSV(text);
    return {
      rows: maxRows ? rows.slice(0, maxRows) : rows,
      contentType: 'csv-text',
      content: text
    };
  }
  if (ext === 'xlsx') {
    const buf = await readAsArrayBuffer(file);
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: true })
      .map(r => (r || []).map(v => v == null ? '' : String(v)));
    return {
      rows: maxRows ? rows.slice(0, maxRows) : rows,
      contentType: 'xlsx-base64',
      content: arrayBufferToBase64(buf)
    };
  }
  throw new Error('unsupported');
}

function normalizeHeader(s) {
  return String(s || '').replace(/^\uFEFF/, '').trim().toLowerCase();
}

function isFreeTextHeaderName(headerName) {
  const normalized = normalizeHeader(headerName);
  return normalized.includes('기타_텍스트')
    || normalized.includes('기타 텍스트')
    || normalized.includes('other_text')
    || normalized.endsWith('__기타')
    || normalized.endsWith('__other');
}

function isNumericLikeResponseValue(value) {
  const normalized = cleanCell(value);
  if (!normalized) return false;
  return /^-?\d+(\.\d+)?(\|-?\d+(\.\d+)?)*$/.test(normalized);
}

const REQUIRED_CODEBOOK = ['question_no', 'question_label', 'response_type', 'data_column_role'];
const REQUIRED_RESPONSE = ['survey_year', 'respondent_no'];

function checkColumns(headerRow, required) {
  const headerSet = new Set((headerRow || []).map(normalizeHeader));
  const missing = required.filter(c => !headerSet.has(c.toLowerCase()));
  return { ok: missing.length === 0, missing };
}

function detectResponseType(rows) {
  if (!rows || rows.length < 2) return { type: 'unknown', sampleSize: 0 };
  const header = rows[0] || [];
  const skipCols = Math.min(4, header.length);
  let numeric = 0;
  let textLike = 0;
  let samples = 0;
  const dataRows = rows.slice(1, 31);
  dataRows.forEach(r => {
    for (let c = skipCols; c < (r || []).length; c++) {
      if (isFreeTextHeaderName(header[c])) continue;
      const v = String(r[c] == null ? '' : r[c]).trim();
      if (!v) continue;
      samples += 1;
      if (isNumericLikeResponseValue(v)) numeric += 1;
      else textLike += 1;
    }
  });
  if (samples === 0) return { type: 'unknown', sampleSize: 0 };
  const textRatio = textLike / samples;
  let type = 'ambiguous';
  if (textRatio < 0.02) type = 'numeric';
  else if (textRatio >= 0.05) type = 'label';
  return { type, sampleSize: samples };
}

function validateFileForKey(key, rows) {
  if (!rows || rows.length === 0) {
    return { ok: false, error: '파일이 비어 있습니다.' };
  }
  const header = rows[0] || [];
  if (key === 'codebook') {
    const chk = checkColumns(header, REQUIRED_CODEBOOK);
    if (!chk.ok) {
      return { ok: false, error: `문항 코드북 형식이 올바르지 않습니다. 누락된 컬럼: ${chk.missing.join(', ')}` };
    }
    return { ok: true };
  }
  if (key === 'value' || key === 'label') {
    const chk = checkColumns(header, REQUIRED_RESPONSE);
    if (!chk.ok) {
      return { ok: false, error: `응답 데이터셋 형식이 올바르지 않습니다. 누락된 컬럼: ${chk.missing.join(', ')}` };
    }
    const det = detectResponseType(rows);
    if (det.type === 'unknown') {
      return { ok: false, error: '데이터 열을 찾을 수 없어 형식을 판별할 수 없습니다.' };
    }
    if (key === 'value' && det.type === 'label') {
      return { ok: false, error: '라벨형 데이터로 보입니다. 숫자 코드가 담긴 숫자형 파일을 업로드해 주세요.' };
    }
    if (key === 'label' && det.type === 'numeric') {
      return { ok: false, error: '숫자형 데이터로 보입니다. 라벨이 담긴 라벨형 파일을 업로드해 주세요.' };
    }
  }
  return { ok: true };
}

function getCodebookQuestionLabels(rows) {
  if (!rows || rows.length < 2) return [];
  const header = (rows[0] || []).map(normalizeHeader);
  const iLabel = header.indexOf('question_label');
  if (iLabel < 0) return [];
  const labels = [];
  for (let r = 1; r < rows.length; r++) {
    const label = cleanCell((rows[r] || [])[iLabel]);
    if (label) labels.push(label);
  }
  return labels;
}

function getResponseQuestionHeaders(rows) {
  if (!rows || rows.length === 0) return [];
  return (rows[0] || []).slice(2).map(cleanCell);
}

function arraysEqualNormalized(a, b) {
  if ((a || []).length !== (b || []).length) return false;
  for (let i = 0; i < a.length; i++) {
    if (cleanCell(a[i]) !== cleanCell(b[i])) return false;
  }
  return true;
}

function findFirstHeaderMismatch(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (cleanCell(a[i]) !== cleanCell(b[i])) {
      return { index: i, left: cleanCell(a[i]), right: cleanCell(b[i]) };
    }
  }
  return null;
}

function validateCodebookAgainstResponse(codebookRows, responseRows, responseLabel) {
  const codebookLabels = getCodebookQuestionLabels(codebookRows);
  const responseHeaders = getResponseQuestionHeaders(responseRows);
  if (codebookLabels.length === 0 || responseHeaders.length === 0) return { ok: true };
  if (arraysEqualNormalized(codebookLabels, responseHeaders)) return { ok: true };
  if (codebookLabels.length !== responseHeaders.length) {
    return {
      ok: false,
      error: `문항 코드북과 ${responseLabel}의 문항 수가 다릅니다. 코드북 ${codebookLabels.length}개, 데이터셋 ${responseHeaders.length}개입니다.`
    };
  }
  const mismatch = findFirstHeaderMismatch(codebookLabels, responseHeaders);
  if (mismatch) {
    return {
      ok: false,
      error: `문항 코드북과 ${responseLabel}의 문항 순서 또는 이름이 다릅니다. ${mismatch.index + 3}번째 응답 데이터 컬럼을 확인해 주세요.`
    };
  }
  return { ok: true };
}

function validateResponsePair(valueRows, labelRows) {
  if (!valueRows || !labelRows) return { ok: true };
  const valueHeader = (valueRows[0] || []).map(cleanCell);
  const labelHeader = (labelRows[0] || []).map(cleanCell);
  if (!arraysEqualNormalized(valueHeader, labelHeader)) {
    return { ok: false, error: '응답 데이터셋 숫자형과 라벨형의 가로 첫행 구조가 서로 다릅니다.' };
  }
  if (valueRows.length !== labelRows.length) {
    return { ok: false, error: `응답 데이터셋 숫자형과 라벨형의 행 수가 다릅니다. 숫자형 ${valueRows.length - 1}행, 라벨형 ${labelRows.length - 1}행입니다.` };
  }
  for (let r = 1; r < valueRows.length; r++) {
    const vRow = valueRows[r] || [];
    const lRow = labelRows[r] || [];
    if (cleanCell(vRow[0]) !== cleanCell(lRow[0]) || cleanCell(vRow[1]) !== cleanCell(lRow[1])) {
      return { ok: false, error: `응답 데이터셋 숫자형과 라벨형의 세로 첫행 기준값이 ${r + 1}번째 행에서 다릅니다.` };
    }
    const maxCols = Math.max(vRow.length, lRow.length);
    for (let c = 2; c < maxCols; c++) {
      const vFilled = cleanCell(vRow[c]) !== '';
      const lFilled = cleanCell(lRow[c]) !== '';
      if (vFilled !== lFilled) {
        const headerName = valueHeader[c] || `${c + 1}번째 컬럼`;
        return { ok: false, error: `응답 데이터셋 숫자형과 라벨형의 값 위치 구조가 다릅니다. ${r + 1}번째 행 / ${headerName} 컬럼을 확인해 주세요.` };
      }
    }
  }
  return { ok: true };
}

function validateBundleConsistency(rowsByKey) {
  const { codebook, value, label } = rowsByKey;
  if (codebook && value) {
    const result = validateCodebookAgainstResponse(codebook, value, '응답 데이터셋_숫자형');
    if (!result.ok) return result;
  }
  if (codebook && label) {
    const result = validateCodebookAgainstResponse(codebook, label, '응답 데이터셋_라벨형');
    if (!result.ok) return result;
  }
  if (value && label) {
    const result = validateResponsePair(value, label);
    if (!result.ok) return result;
  }
  return { ok: true };
}

async function loadCodebookRows(fileRec) {
  if (!fileRec) return null;
  const payload = await getStoredFilePayload(fileRec);
  if (!payload) return null;
  if (payload.contentType === 'csv-text') {
    return parseCSV(payload.content);
  }
  if (payload.contentType === 'xlsx-base64') {
    const buf = base64ToArrayBuffer(payload.content);
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: true });
    return rows.map(r => (r || []).map(v => v == null ? '' : String(v)));
  }
  return null;
}

function cleanCell(v) {
  return String(v == null ? '' : v).replace(/^\uFEFF/, '').trim();
}

// 코드북을 category_1 > question 또는 category_1 > category_2 > question 구조로 변환합니다.
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
    const c2 = iCat2 >= 0 ? String(row[iCat2] || '').trim() : '';
    const full = iFull >= 0 ? String(row[iFull] || '').trim() : '';
    const qno = iNo >= 0 ? String(row[iNo] || '').trim() : '';
    const role = iRole >= 0 ? String(row[iRole] || '').trim() : '';
    const rtype = iType >= 0 ? String(row[iType] || '').trim() : '';
    const item = { qno, label, full, role, rtype };

    // expanded 행은 계산 편의를 위한 내부 컬럼이므로 사용자용 문항 리스트에서 제외합니다.
    if (role.toLowerCase() === 'expanded') continue;

    if (!map.has(c1)) {
      map.set(c1, { items: [], children: new Map() });
      cat1Order.push(c1);
    }
    const c1m = map.get(c1);
    if (!c2) {
      c1m.items.push(item);
      continue;
    }
    if (!c1m.children.has(c2)) c1m.children.set(c2, []);
    c1m.children.get(c2).push(item);
  }

  return cat1Order.map(c1 => ({
    name: c1,
    items: map.get(c1).items,
    children: Array.from(map.get(c1).children.entries()).map(([c2, items]) => ({ name: c2, items }))
  }));
}

function renderTree(tree) {
  const host = document.getElementById('question-tree');
  host.innerHTML = '';

  if (!tree || tree.length === 0) {
    host.innerHTML = '<div class="question-list-empty">표시할 문항이 없습니다.</div>';
    return;
  }

  const chevron = 'arrow_forward_ios_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24.png';
  function appendQuestionCard(parent, item, cat1Name, cat2Name) {
    const card = document.createElement('div');
    const hasFull = item.full && item.full.trim() !== '';
    card.className = 'question-item' + (hasFull ? ' has-full' : '');
    card.draggable = true;
    card.dataset.label = item.label;
    card.dataset.qno = item.qno;
    card.dataset.cat1 = cat1Name;
    card.dataset.cat2 = cat2Name || '';
    card.dataset.full = item.full;
    card.innerHTML = `
      <span class="question-item-label">${escapeHtml(item.label)}</span>
      ${hasFull ? `<span class="question-item-full">Q. ${escapeHtml(item.full)}</span>` : ''}
    `;
    parent.appendChild(card);
  }

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

    if (Array.isArray(cat1.items) && cat1.items.length > 0) {
      const directList = document.createElement('div');
      directList.className = 'accordion-direct-list';
      cat1.items.forEach(item => appendQuestionCard(directList, item, cat1.name, ''));
      list.appendChild(directList);
    }

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
        appendQuestionCard(subList, item, cat1.name, cat2.name);
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
        cat.querySelectorAll('.accordion-direct-list').forEach(list => list.style.display = '');
        cat.querySelectorAll('.accordion-direct-list .question-item').forEach(item => item.style.display = '');
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
      cat.querySelectorAll('.accordion-direct-list').forEach(list => {
        let directMatch = false;
        list.querySelectorAll('.question-item').forEach(item => {
          const hay = [
            item.dataset.label || '',
            item.dataset.full || '',
            item.dataset.qno || '',
            cat1Name
          ].join(' ').toLowerCase();
          const hit = cat1Hit || hay.includes(q);
          item.style.display = hit ? '' : 'none';
          if (hit) directMatch = true;
        });
        list.style.display = directMatch ? '' : 'none';
        if (directMatch) catMatch = true;
      });
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
  const zones = document.querySelectorAll('#drop-target.drop-area, #drop-criterion.drop-area');
  const statusEl = document.getElementById('selection-status');
  const countEl = document.getElementById('selection-count');
  const clearBtn = document.getElementById('selection-clear-btn');
  const targetClearBtn = document.getElementById('target-clear-btn');
  const targetScaleCompareBtn = document.getElementById('target-scale-compare-btn');
  const criterionClearBtn = document.getElementById('criterion-clear-btn');
  const criterionYearBtn = document.getElementById('criterion-year-btn');
  const criterionZone = document.getElementById('drop-criterion');

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
  if (targetScaleCompareBtn) {
    targetScaleCompareBtn.addEventListener('click', () => {
      if (targetScaleCompareBtn.disabled) return;
      resultState.targetScaleCompareMode = !resultState.targetScaleCompareMode;
      refreshTargetScaleCompareControl();
      renderResults();
    });
  }
  if (criterionClearBtn) {
    criterionClearBtn.addEventListener('click', () => clearDropZone('drop-criterion'));
  }
  if (criterionYearBtn && criterionZone) {
    criterionYearBtn.addEventListener('click', () => {
      const yearCandidate = getCandidateByKey('survey_year');
      if (!yearCandidate || !Array.isArray(yearCandidate.options) || yearCandidate.options.length < 2) {
        alert('연도별 비교에 사용할 조사 연도 데이터가 없습니다.');
        return;
      }
      clearDropZone('drop-criterion');
      addChip(criterionZone, { label: '조사 연도', key: 'survey_year', qno: 'SYS_YEAR' });
    });
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
      const zoneName = zone.dataset.zone === 'target' ? '보고 싶은 문항' : '그룹별 비교';
      const existingLabels = new Set(
        Array.from(zone.querySelectorAll('.chip')).map(c => c.dataset.label)
      );

      let added = 0;
      let blockedByLimit = false;
      let blockedTextOpen = false;
      for (const data of items) {
        if (!data || !data.label) continue;
        const entry = resultState.codebookByLabel.get(data.label);
        if (zone.dataset.zone === 'target' && entry && isTextOpenType(entry.type)) {
          blockedTextOpen = true;
          continue;
        }
        if (zone.dataset.zone === 'criterion') {
          if (!entry || entry.role !== 'raw' || !isSingleChoiceType(entry.type)) continue;
        }
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
      if (blockedTextOpen) {
        alert('주관식 문자는 별도의 시각화를 제공하지 않습니다.');
      }

      clearSelection();
    });
  });

  function addChip(zone, data) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.dataset.label = data.label;
    chip.dataset.key = data.key || data.label;
    chip.dataset.qno = data.qno || '';
    chip.innerHTML = `
      <span class="chip-label">${escapeHtml(data.label)}</span>
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
    if (zone.dataset.zone === 'target') refreshTargetScaleCompareControl();
  }
}

// 코드북과 라벨형 응답 데이터를 기준으로 동적 필터를 구성합니다.
const filterState = {
  candidates: [],
  activeKeys: [],
  selectedMap: new Map(),
  defaultKeys: [],
  rows: [],
  valueRows: [],
  headerMap: new Map(),
  valueHeaderMap: new Map(),
  draggingKey: null,
  openKey: null
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

function getCandidateByKey(key) {
  return (filterState.candidates || []).find(item => item.key === key) || null;
}

function getFilteredRowIndexes() {
  const rows = filterState.rows || [];
  if (rows.length < 2) return [];
  const indexes = [];
  rows.slice(1).forEach((row, offset) => {
    const matched = getActiveFilterItems().every(item => {
      const selected = getSelectedValues(item.key);
      if (!selected || selected.size === 0) return true;
      const idx = filterState.headerMap.get(item.key);
      const value = cleanCell((row || [])[idx]);
      return selected.has(value);
    });
    if (matched) indexes.push(offset + 1);
  });
  return indexes;
}

function getFilteredRowCount() {
  return getFilteredRowIndexes().length;
}

function getRowsByIndexes(rows, indexes) {
  if (!Array.isArray(rows) || !Array.isArray(indexes)) return [];
  return indexes.map(index => rows[index]).filter(Boolean);
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
    wrap.className = 'filter-control' + (selected.size > 0 ? ' active' : '') + (item.fixed ? '' : ' draggable');
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
      filterState.openKey = wrap.classList.contains('open') ? item.key : null;
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

    if (filterState.openKey === item.key) {
      wrap.classList.add('open');
      requestAnimationFrame(() => positionPopupWithinMainArea(wrap, menu));
    }
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
      filterState.openKey = null;
      addWrap.classList.toggle('open');
      requestAnimationFrame(() => positionPopupWithinMainArea(addWrap, addMenu));
    });
  }

  if (!document.body.dataset.filterCloseBound) {
    document.body.dataset.filterCloseBound = '1';
    document.addEventListener('click', e => {
      if (!e.target.closest('.filter-control')) {
        document.querySelectorAll('.filter-control.open').forEach(el => el.classList.remove('open'));
        filterState.openKey = null;
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

function updateCriterionYearButtonVisibility() {
  const criterionYearBtn = document.getElementById('criterion-year-btn');
  if (!criterionYearBtn) return;
  const yearCandidate = getCandidateByKey('survey_year');
  const isVisible = !!(yearCandidate && Array.isArray(yearCandidate.options) && yearCandidate.options.length > 1);
  criterionYearBtn.hidden = !isVisible;
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
    filterState.valueRows = [];
    filterState.headerMap = new Map();
    filterState.valueHeaderMap = new Map();
    renderFilters();
    nEl.textContent = '0';
    return;
  }

  const codebookRows = await loadCodebookRows(cur.files.codebook);
  const labelRows = await loadCodebookRows(cur.files.label);
  const valueRows = cur.files.value ? await loadCodebookRows(cur.files.value) : [];
  const { candidates, headerMap } = buildFilterCandidates(codebookRows || [], labelRows || []);
  const safeValueRows = (valueRows && valueRows.length >= 2) ? valueRows : (labelRows || []);
  const valueHeader = (safeValueRows && safeValueRows[0] || []).map(cleanCell);
  const valueHeaderMap = new Map();
  valueHeader.forEach((name, idx) => valueHeaderMap.set(name, idx));

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
  filterState.valueRows = safeValueRows || [];
  filterState.headerMap = headerMap;
  filterState.valueHeaderMap = valueHeaderMap;

  const nextSelectedMap = new Map();
  filterState.activeKeys.forEach(key => {
    const prev = filterState.selectedMap.get(key);
    nextSelectedMap.set(key, prev instanceof Set ? prev : new Set());
  });
  filterState.selectedMap = nextSelectedMap;

  renderFilters();
  updateCriterionYearButtonVisibility();
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
  let lastReplacedDataKey = '';

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
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('이 대시보드를 삭제하시겠습니까?')) return;

        const id = el.dataset.del;
        const currentSurveys = loadSurveys();
        const target = currentSurveys.find(s => s.id === id);
        const next = currentSurveys.filter(s => s.id !== id);
        saveSurveys(next);
        if (target) {
          try { await deleteSurveyFiles(id, target.files || {}, next); } catch (_) {}
        }
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

  async function saveCurrentSurvey() {
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
    const { current } = getCurrentSurvey();
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
          <div class="saved-meta">${escapeHtml((item.file && item.file.name) || '파일 없음')}</div>
          ${lastReplacedDataKey === item.key ? '<div class="saved-meta">교체하였습니다.</div>' : ''}
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

    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['csv', 'xlsx'].includes(ext)) {
      throw new Error('지원하지 않는 파일 형식입니다. .csv 또는 .xlsx 파일만 업로드할 수 있습니다.');
    }
    const parsedUpload = await readTabularFile(file);
    const fileResult = validateFileForKey(key, parsedUpload.rows);
    if (!fileResult.ok) throw new Error(fileResult.error);

    const currentFiles = surveys[idx].files || {};
    const rowsByKey = {
      codebook: key === 'codebook' ? parsedUpload.rows : await loadCodebookRows(currentFiles.codebook),
      value: key === 'value' ? parsedUpload.rows : await loadCodebookRows(currentFiles.value),
      label: key === 'label' ? parsedUpload.rows : await loadCodebookRows(currentFiles.label)
    };
    const bundleResult = validateBundleConsistency(rowsByKey);
    if (!bundleResult.ok) throw new Error(bundleResult.error);

    const rawFile = {
      name: file.name,
      size: file.size,
      contentType: parsedUpload.contentType,
      content: parsedUpload.content
    };
    let storedRef = rawFile;
    try {
      const persisted = await persistStoredFile(currentId, key, rawFile);
      if (persisted) storedRef = persisted;
    } catch (_) {}
    surveys[idx].files = { ...(surveys[idx].files || {}), [key]: storedRef };
    surveys[idx].updatedAt = new Date().toISOString();
    if (!saveSurveys(surveys)) return;

    if (key === 'codebook') resultState.codebookByLabel = new Map();
    try { await setupFilters(); } catch (_) {}
    try {
      const rows = await loadCodebookRows(surveys[idx].files.codebook);
      if (rows) {
        resultState.codebookByLabel = buildCodebookIndex(rows);
        renderTree(buildQuestionTree(rows));
      }
    } catch (_) {}
    lastReplacedDataKey = key;
    renderDataUpdateList();
    renderResults();
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
      } catch (err) {
        alert((err && err.message) || '파일 교체 중 오류가 발생했습니다. 업로드 파일과 연결된 데이터 구조를 확인해 주세요.');
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
   [분석 결과 렌더링]
   - data_visualization.md 의 2-1(객관식 단일), 2-3(객관식 순위) 규칙을 따릅니다.
   ===================================================================== */

const GROUP_PALETTE = [
  '#5b7a9a', '#c67b7b', '#7ba87a', '#c6a77b',
  '#a77bc6', '#7bbfb8', '#c67bad', '#9ba07b'
];
const SINGLE_BAR_COLOR = '#4a4a4a';
const COMPARE_BAR_COLOR = '#d9d9d9';

// 객관식 순위: 무채색 계열 안에서 순위별 차이를 조금 더 크게 둡니다.
const RANK_PALETTE = [
  '#1f1f1f', '#555555', '#8b8b8b', '#b1b1b1', '#c7c7c7', '#d9d9d9', '#e6e6e6', '#f0f0f0'
];
function rankColor(idx) {
  if (idx < RANK_PALETTE.length) return RANK_PALETTE[idx];
  return RANK_PALETTE[RANK_PALETTE.length - 1];
}

const SCALE_DIVERGING_PALETTE = [
  '#8e4c4c', '#bb7474', '#d8a5a5', '#dddddd', '#a9bfd4', '#7598b8', '#4c7398'
];
function getScaleColor(score, maxScore) {
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 1) return '#d9d9d9';
  const idx = Math.round(((score - 1) * (SCALE_DIVERGING_PALETTE.length - 1)) / (maxScore - 1));
  return SCALE_DIVERGING_PALETTE[Math.max(0, Math.min(SCALE_DIVERGING_PALETTE.length - 1, idx))];
}

const resultState = {
  codebookByLabel: new Map(),
  codebookRowsByLabel: new Map(),
  hiddenGroupKeys: new Map(),
  hiddenRankKeys: new Map(),
  numericHistogramConfigs: new Map(),
  numericOpenViewModes: new Map(),
  scaleViewModes: new Map(),
  scaleMidpointHidden: new Map(),
  scaleCompareSelections: new Map(),
  targetScaleCompareMode: false,
  otherResponseTexts: new Map(),
  tooltipEl: null,
  initialized: false
};

const TARGET_SCALE_COMPARE_VIEW_KEY = '__target_scale_compare__';

function parseValueCodeMap(text) {
  const map = new Map();
  String(text || '').split('|').forEach(part => {
    const [rawKey, ...rest] = part.split('=');
    if (!rawKey || rest.length === 0) return;
    const key = cleanCell(rawKey);
    const value = cleanCell(rest.join('='));
    if (!key) return;
    map.set(key, value);
  });
  return map;
}

function buildCodebookIndex(codebookRows) {
  const map = new Map();
  const rowsByLabel = new Map();
  if (!codebookRows || codebookRows.length < 2) {
    resultState.codebookRowsByLabel = rowsByLabel;
    return map;
  }
  const header = (codebookRows[0] || []).map(normalizeHeader);
  const col = name => header.indexOf(name);
  const iLabel = col('question_label');
  const iFull = col('question_full');
  const iType = col('response_type');
  const iRole = col('data_column_role');
  const iOptions = col('response_options');
  const iOther = col('other_input_expected');
  const iValueCount = col('value_count');
  const iValueCodeMap = col('value_code_map');
  const iNumberUnit = col('number_unit');

  for (let r = 1; r < codebookRows.length; r++) {
    const row = codebookRows[r] || [];
    const label = cleanCell(row[iLabel]);
    if (!label) continue;
    if (!rowsByLabel.has(label)) rowsByLabel.set(label, []);
    rowsByLabel.get(label).push(row);
    if (map.has(label)) continue;
    const opts = cleanCell(row[iOptions])
      .split('|').map(cleanCell).filter(Boolean);
    const vcRaw = iValueCount >= 0 ? cleanCell(row[iValueCount]) : '';
    const valueCount = vcRaw ? Number(vcRaw) : null;
    const valueCodeMap = iValueCodeMap >= 0 ? parseValueCodeMap(row[iValueCodeMap]) : new Map();
    map.set(label, {
      label,
      full: cleanCell(row[iFull]),
      type: cleanCell(row[iType]),
      role: cleanCell(row[iRole]),
      options: opts,
      otherInput: cleanCell(row[iOther]).toUpperCase() === 'Y',
      valueCount: Number.isFinite(valueCount) ? valueCount : null,
      valueCodeMap,
      numberUnit: iNumberUnit >= 0 ? cleanCell(row[iNumberUnit]) : ''
    });
  }
  resultState.codebookRowsByLabel = rowsByLabel;
  return map;
}

function getTargetChipLabels() {
  return Array.from(document.querySelectorAll('#drop-target .chip'))
    .map(c => c.dataset.label)
    .filter(Boolean);
}
function getCriterionChipLabel() {
  const chip = document.querySelector('#drop-criterion .chip');
  return chip ? (chip.dataset.key || chip.dataset.label) : null;
}

function getScaleCompareGroupKey(entry) {
  if (!entry || !isScaleChoiceType(entry.type)) return '';
  const valueCount = Number(entry.valueCount);
  if (!Number.isFinite(valueCount)) return '';
  return String(Math.round(valueCount));
}

function getTargetScaleCompareLabels(targetLabels = getTargetChipLabels()) {
  const scaleItems = targetLabels.map(label => {
    const entry = resultState.codebookByLabel.get(label);
    return { label, entry };
  }).filter(item => item.entry && isScaleChoiceType(item.entry.type));
  if (scaleItems.length !== targetLabels.length || scaleItems.length < 2) return [];

  const groups = new Map();
  scaleItems.forEach(({ label, entry }) => {
    const key = getScaleCompareGroupKey(entry);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(label);
  });
  if (groups.size !== 1) return [];
  const labels = Array.from(groups.values())[0] || [];
  return labels.length >= 2 ? labels : [];
}

function refreshTargetScaleCompareControl() {
  const btn = document.getElementById('target-scale-compare-btn');
  if (!btn) return;
  const labels = getTargetScaleCompareLabels();
  const enabled = labels.length >= 2;
  btn.disabled = !enabled;
  btn.classList.toggle('is-active', enabled);
  btn.textContent = resultState.targetScaleCompareMode ? '개별 문항 보기' : '여러 문항 한 번에 비교하기';
  if (!enabled) {
    resultState.targetScaleCompareMode = false;
    btn.classList.remove('is-active');
    btn.textContent = '여러 문항 한 번에 비교하기';
  }
}

function clearDropZone(zoneId) {
  const zone = document.getElementById(zoneId);
  if (!zone) return;
  zone.querySelectorAll('.chip').forEach(chip => chip.remove());
  zone.classList.remove('has-chip');
  if (zoneId === 'drop-target') refreshTargetScaleCompareControl();
}

function getFilteredLabelDataRows() {
  return getRowsByIndexes(filterState.rows || [], getFilteredRowIndexes());
}

function getFilteredValueDataRows() {
  const valueRows = filterState.valueRows || [];
  if ((filterState.rows || []).length < 2) return [];
  if (valueRows.length < 2) return getFilteredLabelDataRows();
  return getRowsByIndexes(valueRows, getFilteredRowIndexes());
}

function isSingleChoiceType(type) {
  return cleanCell(type).includes('객관식 단일');
}

function isMultiChoiceType(type) {
  return cleanCell(type).includes('객관식 중복');
}

function isRankChoiceType(type) {
  return cleanCell(type).includes('객관식 순위');
}

function isScaleChoiceType(type) {
  return cleanCell(type).includes('객관식 척도');
}

function isNumericOpenType(type) {
  return cleanCell(type).includes('주관식 숫자');
}

function isTextOpenType(type) {
  return cleanCell(type).includes('주관식 문자');
}

function supportsResultType(type) {
  return isSingleChoiceType(type)
    || isMultiChoiceType(type)
    || isRankChoiceType(type)
    || isScaleChoiceType(type)
    || isNumericOpenType(type);
}

function getCriterionEntry(criterionLabel) {
  return resultState.codebookByLabel.get(criterionLabel) || (() => {
    const candidate = getCandidateByKey(criterionLabel);
    if (!candidate) return null;
    return {
      label: candidate.label,
      type: '객관식 단일',
      role: 'raw',
      options: candidate.options || []
    };
  })();
}

function getExpandedMultiOptionItems(targetLabel, entry) {
  if (!entry || !isMultiChoiceType(entry.type)) return [];

  const items = [];
  const usedLabels = new Set();
  const headerMap = filterState.headerMap || new Map();

  (entry.options || []).forEach(option => {
    const expandedLabel = `${targetLabel}__${option}`;
    if (!headerMap.has(expandedLabel)) return;
    items.push({ option, label: expandedLabel });
    usedLabels.add(expandedLabel);
  });

  resultState.codebookByLabel.forEach((candidate, label) => {
    if (!candidate || cleanCell(candidate.role).toLowerCase() !== 'expanded') return;
    if (!isMultiChoiceType(candidate.type)) return;
    if (!label.startsWith(`${targetLabel}__`)) return;
    if (!headerMap.has(label) || usedLabels.has(label)) return;

    const option = cleanCell(label.slice(targetLabel.length + 2));
    if (!option || option.includes('기타_텍스트') || option.includes('기타 텍스트')) return;
    items.push({ option, label });
    usedLabels.add(label);
  });

  return items;
}

function isMarkedMultiSelected(value) {
  const normalized = cleanCell(value).toLowerCase();
  return normalized === '선택'
    || normalized === '1'
    || normalized === 'y'
    || normalized === 'yes'
    || normalized === 'true'
    || normalized === 'selected';
}

function getMultiSelectionsFromRow(row, rawIdx, expandedItems) {
  const selected = [];
  const seen = new Set();

  (expandedItems || []).forEach(item => {
    const idx = filterState.headerMap.get(item.label);
    if (idx === undefined) return;
    if (!isMarkedMultiSelected((row || [])[idx])) return;
    if (seen.has(item.option)) return;
    seen.add(item.option);
    selected.push(item.option);
  });

  if (rawIdx === undefined) return selected;

  const rawValue = cleanCell((row || [])[rawIdx]);
  if (!rawValue) return selected;

  rawValue.split('|').map(cleanCell).filter(Boolean).forEach(option => {
    if (seen.has(option)) return;
    seen.add(option);
    selected.push(option);
  });

  return selected;
}

/* ---------- 공통 포맷 ---------- */
function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0.0%';
  return `${(Math.round((num + 1e-10) * 10) / 10).toFixed(1)}%`;
}

function isOtherOption(option) {
  return cleanCell(option).includes('기타');
}

/* =========================================================
   [객관식 단일] 집계 / 렌더
   ========================================================= */
function aggregateSingle(targetLabel, criterionLabel, rows) {
  const entry = resultState.codebookByLabel.get(targetLabel);
  if (!entry) return null;
  const tIdx = filterState.headerMap ? filterState.headerMap.get(targetLabel) : undefined;
  if (tIdx === undefined) return null;

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
    const critEntry = getCriterionEntry(criterionLabel);
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
          label: `${critEntry.label}: ${gv}`,
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
    visualType: 'choice',
    criterionLabel: groupResults ? criterionLabel : null,
    groupResults,
    isMulti: false
  };
}

function aggregateMulti(targetLabel, criterionLabel, rows) {
  const entry = resultState.codebookByLabel.get(targetLabel);
  if (!entry) return null;

  const tIdx = filterState.headerMap ? filterState.headerMap.get(targetLabel) : undefined;
  const expandedItems = getExpandedMultiOptionItems(targetLabel, entry);
  if (tIdx === undefined && expandedItems.length === 0) return null;

  const optionOrder = [...entry.options];
  const optionSet = new Set(optionOrder);
  const totalCount = {};
  optionOrder.forEach(o => totalCount[o] = 0);
  let totalN = 0;

  rows.forEach(row => {
    const selectedOptions = getMultiSelectionsFromRow(row, tIdx, expandedItems);
    if (selectedOptions.length === 0) return;

    selectedOptions.forEach(option => {
      if (!optionSet.has(option)) {
        optionSet.add(option);
        optionOrder.push(option);
        totalCount[option] = 0;
      }
      totalCount[option] = (totalCount[option] || 0) + 1;
    });
    totalN += 1;
  });

  const totalResults = optionOrder.map(option => ({
    option,
    count: totalCount[option] || 0,
    pct: totalN > 0 ? ((totalCount[option] || 0) / totalN) * 100 : 0
  }));

  const visibleOptionOrder = optionOrder.filter(option => (totalCount[option] || 0) > 0);
  const visibleOptionSet = new Set(visibleOptionOrder);
  const visibleTotalResults = totalResults.filter(result => visibleOptionSet.has(result.option));

  let groupResults = null;
  if (criterionLabel) {
    const critEntry = getCriterionEntry(criterionLabel);
    const cIdx = filterState.headerMap.get(criterionLabel);
    if (critEntry && cIdx !== undefined) {
      const groupOrder = [...critEntry.options];
      const groupSet = new Set(groupOrder);
      const byGroup = new Map();
      const createGroupState = () => ({
        n: 0,
        count: Object.fromEntries(optionOrder.map(option => [option, 0]))
      });

      groupOrder.forEach(groupValue => {
        byGroup.set(groupValue, createGroupState());
      });

      rows.forEach(row => {
        const groupValue = cleanCell((row || [])[cIdx]);
        const selectedOptions = getMultiSelectionsFromRow(row, tIdx, expandedItems);
        if (groupValue === '' || selectedOptions.length === 0) return;

        if (!groupSet.has(groupValue)) {
          groupSet.add(groupValue);
          groupOrder.push(groupValue);
          byGroup.set(groupValue, createGroupState());
        }

        const group = byGroup.get(groupValue);
        group.n += 1;

        selectedOptions.forEach(option => {
          if (group.count[option] === undefined) group.count[option] = 0;
          group.count[option] += 1;
        });
      });

      groupResults = groupOrder.map(groupValue => {
        const group = byGroup.get(groupValue);
        return {
          value: groupValue,
          label: `${critEntry.label}: ${groupValue}`,
          n: group.n,
          results: visibleOptionOrder.map(option => ({
            option,
            count: group.count[option] || 0,
            pct: group.n > 0 ? ((group.count[option] || 0) / group.n) * 100 : 0
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
    visualType: 'choice',
    criterionLabel: groupResults ? criterionLabel : null,
    groupResults,
    isMulti: true
  };
}

function aggregateResultQuestion(targetLabel, criterionLabel, rows, valueRows = [], rowIndexes = []) {
  const entry = resultState.codebookByLabel.get(targetLabel);
  if (!entry) return null;
  if (isSingleChoiceType(entry.type)) return aggregateSingle(targetLabel, criterionLabel, rows);
  if (isMultiChoiceType(entry.type)) return aggregateMulti(targetLabel, criterionLabel, rows);
  if (isRankChoiceType(entry.type)) return aggregateRank(targetLabel, criterionLabel, rows);
  if (isScaleChoiceType(entry.type)) return aggregateScale(targetLabel, criterionLabel, rows);
  if (isNumericOpenType(entry.type)) return aggregateNumericOpen(targetLabel, criterionLabel, rowIndexes);
  return null;
}

function getScaleScoreRange(entry) {
  const maxScore = Number(entry && entry.valueCount);
  const safeMax = Number.isFinite(maxScore) && maxScore >= 2 ? Math.round(maxScore) : 5;
  return Array.from({ length: safeMax }, (_, i) => i + 1);
}

function getScaleScoreLabel(entry, score) {
  const mapped = cleanCell(entry && entry.valueCodeMap ? entry.valueCodeMap.get(String(score)) : '');
  return mapped || `${score}점`;
}

function isDerivedScaleEntry(entry) {
  return !!(entry && isScaleChoiceType(entry.type) && cleanCell(entry.role) === 'derived');
}

function getScaleMeanLeftPct(mean, maxScore) {
  if (!Number.isFinite(mean) || mean <= 0) return null;
  if (!Number.isFinite(maxScore) || maxScore <= 1) return 50;
  return Math.max(0, Math.min(100, ((mean - 1) / (maxScore - 1)) * 100));
}

function formatScaleCompareMean(mean) {
  return Number.isFinite(mean) && mean > 0 ? mean.toFixed(2) : '';
}

function getScalePolaritySummary(scoreResults) {
  const mid = (Array.isArray(scoreResults) ? scoreResults.length : 0) > 0
    ? ((scoreResults.length + 1) / 2)
    : 0;
  return (scoreResults || []).reduce((acc, result) => {
    const pctValue = result.pct || 0;
    if (result.score < mid) {
      acc.negativePct += pctValue;
      acc.negativeCount += result.count || 0;
    } else if (result.score > mid) {
      acc.positivePct += pctValue;
      acc.positiveCount += result.count || 0;
    } else {
      acc.neutralPct += pctValue;
      acc.neutralCount += result.count || 0;
    }
    return acc;
  }, {
    negativePct: 0,
    negativeCount: 0,
    positivePct: 0,
    positiveCount: 0,
    neutralPct: 0,
    neutralCount: 0
  });
}

function getScaleValueStats(values) {
  const nums = (Array.isArray(values) ? values : []).filter(Number.isFinite);
  const n = nums.length;
  if (n === 0) return { n: 0, mean: 0, min: 0, q1: 0, median: 0, q3: 0, max: 0 };
  const initial = { sum: 0, min: nums[0], max: nums[0] };
  const summary = nums.reduce((acc, value) => ({
    sum: acc.sum + value,
    min: Math.min(acc.min, value),
    max: Math.max(acc.max, value)
  }), initial);
  const sorted = [...nums].sort((a, b) => a - b);
  const quantile = p => {
    if (sorted.length === 1) return sorted[0];
    const pos = (sorted.length - 1) * p;
    const base = Math.floor(pos);
    const rest = pos - base;
    const next = sorted[Math.min(base + 1, sorted.length - 1)];
    return sorted[base] + ((next - sorted[base]) * rest);
  };
  return {
    n,
    mean: summary.sum / n,
    min: summary.min,
    q1: quantile(0.25),
    median: quantile(0.5),
    q3: quantile(0.75),
    max: summary.max
  };
}

function buildDerivedScaleResult(values, scoreRange) {
  const stats = getScaleValueStats(values);
  return {
    values,
    n: stats.n,
    mean: stats.mean,
    min: stats.min,
    q1: stats.q1,
    median: stats.median,
    q3: stats.q3,
    max: stats.max,
    scoreRange
  };
}

function clampNumericHistogramStep(value) {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return 5;
  return Math.max(1, Math.min(1000000, num));
}

function normalizeNumericHistogramStart(value) {
  const num = Math.round(Number(value));
  return Number.isFinite(num) ? num : 0;
}

function getDefaultNumericHistogramStep(values) {
  const nums = (Array.isArray(values) ? values : []).filter(Number.isFinite);
  if (nums.length <= 1) return 1;
  const sorted = [...nums].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const span = Math.max(1, max - min);
  const roughStep = Math.ceil(span / 10);
  return clampNumericHistogramStep(roughStep);
}

function getDefaultNumericHistogramStart(values, step = null) {
  const nums = (Array.isArray(values) ? values : []).filter(Number.isFinite);
  if (nums.length === 0) return 0;
  const min = Math.min(...nums);
  const safeStep = clampNumericHistogramStep(step || getDefaultNumericHistogramStep(nums));
  return Math.floor(min / safeStep) * safeStep;
}

function formatNumericValue(value, digits = 2) {
  if (!Number.isFinite(value)) return '-';
  const rounded = Number(value.toFixed(digits));
  return rounded.toLocaleString('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
}

function formatNumericMeanDisplay(value, unit = '') {
  const num = Number(value);
  const base = Number.isFinite(num)
    ? num.toLocaleString('ko-KR', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      })
    : '-';
  return unit ? `${base}${unit}` : base;
}

function formatNumericValueWithUnit(value, unit = '', digits = 2) {
  const base = formatNumericValue(value, digits);
  return base === '-' ? base : (unit ? `${base}${unit}` : base);
}

function getNumericHistogramDomain(values) {
  const nums = (Array.isArray(values) ? values : []).filter(Number.isFinite);
  if (nums.length === 0) return { min: 0, max: 0 };
  const sorted = [...nums].sort((a, b) => a - b);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1]
  };
}

function getNumericYAxisConfig(maxCount) {
  const safeMax = Math.max(0, Math.ceil(Number(maxCount) || 0));
  const candidates = [5, 10];
  let scale = 1;
  while ((scale * 10) < Math.max(safeMax, 10)) {
    scale *= 10;
  }
  const steps = [];
  for (let s = Math.max(1, scale / 10); s <= scale * 10; s *= 10) {
    candidates.forEach(multiplier => steps.push(multiplier * s));
  }
  const uniqueSteps = Array.from(new Set(steps)).sort((a, b) => a - b);
  const tickStep = uniqueSteps.find(step => Math.ceil(Math.max(safeMax, 1) / step) <= 6) || uniqueSteps[uniqueSteps.length - 1] || 5;
  const axisMax = Math.max(tickStep, Math.ceil(Math.max(safeMax, 1) / tickStep) * tickStep);
  const ticks = [];
  for (let value = 0; value <= axisMax; value += tickStep) ticks.push(value);
  return { tickStep, axisMax, ticks };
}

function getNumericValueLeftPct(value, axisMin, axisMax) {
  if (!Number.isFinite(value)) return null;
  if (!Number.isFinite(axisMin) || !Number.isFinite(axisMax)) return null;
  if (axisMin === axisMax) return 50;
  return Math.max(0, Math.min(100, ((value - axisMin) / (axisMax - axisMin)) * 100));
}

function buildNumericHistogram(values, config = {}, domain = null) {
  const nums = (Array.isArray(values) ? values : []).filter(Number.isFinite);
  const stats = getScaleValueStats(nums);
  const domainInfo = domain && Number.isFinite(domain.min) && Number.isFinite(domain.max)
    ? domain
    : getNumericHistogramDomain(nums);
  const domainMin = Number(domainInfo.min);
  const domainMax = Number(domainInfo.max);
  const safeStep = clampNumericHistogramStep(config.interval || getDefaultNumericHistogramStep(nums));
  const safeStart = normalizeNumericHistogramStart(
    config.start != null ? config.start : getDefaultNumericHistogramStart(nums, safeStep)
  );

  if (nums.length === 0) {
    return {
      n: 0,
      mean: 0,
      min: 0,
      q1: 0,
      median: 0,
      q3: 0,
      max: 0,
      interval: safeStep,
      start: safeStart,
      domainMin,
      domainMax,
      bins: [],
      maxBinCount: 0,
      meanLeftPct: null,
      q1LeftPct: null,
      medianLeftPct: null,
      q3LeftPct: null
    };
  }

  if (domainMin === domainMax) {
    return {
      n: stats.n,
      mean: stats.mean,
      min: stats.min,
      q1: stats.q1,
      median: stats.median,
      q3: stats.q3,
      max: stats.max,
      interval: safeStep,
      start: safeStart,
      domainMin,
      domainMax,
      bins: [{
        start: safeStart,
        end: safeStart + safeStep,
        count: nums.length,
        pct: 100,
        leftPct: 0,
        widthPct: 100
      }],
      maxBinCount: nums.length,
      meanLeftPct: 50,
      q1LeftPct: 50,
      medianLeftPct: 50,
      q3LeftPct: 50
    };
  }

  let firstStart = safeStart;
  while (domainMin < firstStart) firstStart -= safeStep;
  while (domainMin >= firstStart + safeStep) firstStart += safeStep;

  let lastEnd = safeStart + safeStep;
  while (domainMax > lastEnd) lastEnd += safeStep;

  const binCount = Math.max(1, Math.round((lastEnd - firstStart) / safeStep));
  const bins = Array.from({ length: binCount }, (_, idx) => ({
    start: firstStart + (safeStep * idx),
    end: firstStart + (safeStep * (idx + 1)),
    count: 0
  }));

  nums.forEach(value => {
    const rawIndex = Math.floor((value - firstStart) / safeStep);
    const index = Math.max(0, Math.min(binCount - 1, rawIndex));
    bins[index].count += 1;
  });

  const maxBinCount = bins.reduce((maxCount, bin) => Math.max(maxCount, bin.count || 0), 0);
  const decoratedBins = bins.map((bin, idx) => ({
    ...bin,
    pct: stats.n > 0 ? (bin.count / stats.n) * 100 : 0,
    leftPct: (idx / binCount) * 100,
    widthPct: 100 / binCount
  }));
  const axisMin = firstStart;
  const axisMax = lastEnd;
  const meanLeftPct = getNumericValueLeftPct(stats.mean, axisMin, axisMax);
  const q1LeftPct = getNumericValueLeftPct(stats.q1, axisMin, axisMax);
  const medianLeftPct = getNumericValueLeftPct(stats.median, axisMin, axisMax);
  const q3LeftPct = getNumericValueLeftPct(stats.q3, axisMin, axisMax);
  return {
    n: stats.n,
    mean: stats.mean,
    min: stats.min,
    q1: stats.q1,
    median: stats.median,
    q3: stats.q3,
    max: stats.max,
    interval: safeStep,
    start: safeStart,
    domainMin: axisMin,
    domainMax: axisMax,
    bins: decoratedBins,
    maxBinCount,
    meanLeftPct,
    q1LeftPct,
    medianLeftPct,
    q3LeftPct
  };
}

function collectFiniteNumericValues(rows, columnIndex) {
  if (!Array.isArray(rows) || columnIndex === undefined) return [];
  const values = [];
  rows.forEach(row => {
    const raw = cleanCell((row || [])[columnIndex]);
    if (!raw) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    values.push(value);
  });
  return values;
}

function aggregateNumericOpen(targetLabel, criterionLabel, rowIndexes = []) {
  const entry = resultState.codebookByLabel.get(targetLabel);
  if (!entry) return null;
  const effectiveIndexes = Array.isArray(rowIndexes) && rowIndexes.length > 0
    ? rowIndexes
    : getFilteredRowIndexes();
  if (effectiveIndexes.length === 0) return null;

  const numericRows = Array.isArray(filterState.valueRows) && filterState.valueRows.length >= 2
    ? filterState.valueRows
    : filterState.rows;
  const numericHeaderMap = Array.isArray(filterState.valueRows) && filterState.valueRows.length >= 2
    ? filterState.valueHeaderMap
    : filterState.headerMap;
  const tIdx = numericHeaderMap ? numericHeaderMap.get(targetLabel) : undefined;
  if (tIdx === undefined) return null;

  const activeRows = getRowsByIndexes(numericRows || [], effectiveIndexes);
  const activeLabelRows = getRowsByIndexes(filterState.rows || [], effectiveIndexes);
  const values = collectFiniteNumericValues(activeRows, tIdx);
  if (values.length === 0) return null;

  const defaultInterval = getDefaultNumericHistogramStep(values);
  const defaultStart = getDefaultNumericHistogramStart(values, defaultInterval);
  const savedConfig = resultState.numericHistogramConfigs.get(targetLabel) || {};
  const histogramConfig = {
    interval: clampNumericHistogramStep(savedConfig.interval || defaultInterval),
    start: normalizeNumericHistogramStart(savedConfig.start != null ? savedConfig.start : defaultStart)
  };
  if (!resultState.numericHistogramConfigs.has(targetLabel)) {
    resultState.numericHistogramConfigs.set(targetLabel, histogramConfig);
  }
  const domain = getNumericHistogramDomain(values);
  const overall = buildNumericHistogram(values, histogramConfig, domain);

  let groupResults = null;
  let groupMaxBinCount = overall.maxBinCount;
  if (criterionLabel) {
    const critEntry = getCriterionEntry(criterionLabel);
    const cIdx = filterState.headerMap.get(criterionLabel);
    if (critEntry && cIdx !== undefined) {
      const groupOrder = [...critEntry.options];
      const groupSet = new Set(groupOrder);
      const byGroup = new Map();
      groupOrder.forEach(groupValue => byGroup.set(groupValue, []));

      activeRows.forEach((valueRow, index) => {
        const labelRow = activeLabelRows[index] || [];
        const groupValue = cleanCell(labelRow[cIdx]);
        const raw = cleanCell((valueRow || [])[tIdx]);
        if (!groupValue || !raw) return;
        const value = Number(raw);
        if (!Number.isFinite(value)) return;
        if (!groupSet.has(groupValue)) {
          groupSet.add(groupValue);
          groupOrder.push(groupValue);
          byGroup.set(groupValue, []);
        }
        byGroup.get(groupValue).push(value);
      });

      groupResults = groupOrder.map(groupValue => {
        const groupValues = byGroup.get(groupValue) || [];
        const histogram = buildNumericHistogram(groupValues, histogramConfig, domain);
        groupMaxBinCount = Math.max(groupMaxBinCount, histogram.maxBinCount || 0);
        return {
          value: groupValue,
          label: `${critEntry.label}: ${groupValue}`,
          ...histogram,
          values: groupValues
        };
      });
    }
  }

  return {
    targetLabel,
    codebookEntry: entry,
    n: overall.n,
    totalN: overall.n,
    mean: overall.mean,
    min: overall.min,
    q1: overall.q1,
    median: overall.median,
    q3: overall.q3,
    max: overall.max,
    values,
    interval: histogramConfig.interval,
    start: histogramConfig.start,
    defaultInterval,
    defaultStart,
    domainMin: overall.domainMin,
    domainMax: overall.domainMax,
    bins: overall.bins,
    maxBinCount: groupResults ? groupMaxBinCount : overall.maxBinCount,
    meanLeftPct: overall.meanLeftPct,
    q1LeftPct: overall.q1LeftPct,
    medianLeftPct: overall.medianLeftPct,
    q3LeftPct: overall.q3LeftPct,
    visualType: 'numeric-open',
    criterionLabel: groupResults ? criterionLabel : null,
    groupResults
  };
}

function aggregateScale(targetLabel, criterionLabel, rows) {
  const entry = resultState.codebookByLabel.get(targetLabel);
  if (!entry) return null;
  const tIdx = filterState.headerMap ? filterState.headerMap.get(targetLabel) : undefined;
  if (tIdx === undefined) return null;

  const scoreRange = getScaleScoreRange(entry);
  const isDerived = isDerivedScaleEntry(entry);
  if (isDerived) {
    const maxScore = scoreRange.length;
    const values = [];

    rows.forEach(row => {
      const raw = cleanCell((row || [])[tIdx]);
      if (!raw) return;
      const value = Number(raw);
      if (!Number.isFinite(value)) return;
      if (value < 1 || value > maxScore) return;
      values.push(value);
    });

    const overall = buildDerivedScaleResult(values, scoreRange);
    let groupResults = null;
    if (criterionLabel) {
      const critEntry = getCriterionEntry(criterionLabel);
      const cIdx = filterState.headerMap.get(criterionLabel);
      if (critEntry && cIdx !== undefined) {
        const groupOrder = [...critEntry.options];
        const groupSet = new Set(groupOrder);
        const byGroup = new Map();
        groupOrder.forEach(groupValue => byGroup.set(groupValue, []));

        rows.forEach(row => {
          const groupValue = cleanCell((row || [])[cIdx]);
          const raw = cleanCell((row || [])[tIdx]);
          if (!groupValue || !raw) return;
          const value = Number(raw);
          if (!Number.isFinite(value)) return;
          if (value < 1 || value > maxScore) return;

          if (!groupSet.has(groupValue)) {
            groupSet.add(groupValue);
            groupOrder.push(groupValue);
            byGroup.set(groupValue, []);
          }
          byGroup.get(groupValue).push(value);
        });

        groupResults = groupOrder.map(groupValue => {
          const groupValues = byGroup.get(groupValue) || [];
          const result = buildDerivedScaleResult(groupValues, scoreRange);
          return {
            value: groupValue,
            label: `${critEntry.label}: ${groupValue}`,
            n: result.n,
            mean: result.mean,
            min: result.min,
            q1: result.q1,
            median: result.median,
            q3: result.q3,
            max: result.max,
            values: result.values
          };
        });
      }
    }

    return {
      targetLabel,
      codebookEntry: entry,
      totalN: overall.n,
      mean: overall.mean,
      min: overall.min,
      q1: overall.q1,
      median: overall.median,
      q3: overall.q3,
      max: overall.max,
      values: overall.values,
      scoreRange,
      scoreResults: [],
      visualType: 'scale',
      isDerivedScale: true,
      criterionLabel: groupResults ? criterionLabel : null,
      groupResults
    };
  }

  const scoreCounts = Object.fromEntries(scoreRange.map(score => [score, 0]));
  let totalN = 0;
  let totalSum = 0;

  rows.forEach(row => {
    const raw = cleanCell((row || [])[tIdx]);
    if (!raw) return;
    const score = Number(raw);
    if (!Number.isFinite(score)) return;
    if (!Object.prototype.hasOwnProperty.call(scoreCounts, score)) return;
    scoreCounts[score] += 1;
    totalN += 1;
    totalSum += score;
  });

  const scoreResults = scoreRange.map(score => ({
    score,
    label: getScaleScoreLabel(entry, score),
    count: scoreCounts[score] || 0,
    pct: totalN > 0 ? ((scoreCounts[score] || 0) / totalN) * 100 : 0
  }));
  const mean = totalN > 0 ? totalSum / totalN : 0;

  let groupResults = null;
  if (criterionLabel) {
    const critEntry = getCriterionEntry(criterionLabel);
    const cIdx = filterState.headerMap.get(criterionLabel);
    if (critEntry && cIdx !== undefined) {
      const groupOrder = [...critEntry.options];
      const groupSet = new Set(groupOrder);
      const byGroup = new Map();
      const createBucket = () => ({
        n: 0,
        sum: 0,
        counts: Object.fromEntries(scoreRange.map(score => [score, 0]))
      });
      groupOrder.forEach(groupValue => byGroup.set(groupValue, createBucket()));

      rows.forEach(row => {
        const groupValue = cleanCell((row || [])[cIdx]);
        const raw = cleanCell((row || [])[tIdx]);
        if (!groupValue || !raw) return;
        const score = Number(raw);
        if (!Number.isFinite(score)) return;
        if (!Object.prototype.hasOwnProperty.call(scoreCounts, score)) return;

        if (!groupSet.has(groupValue)) {
          groupSet.add(groupValue);
          groupOrder.push(groupValue);
          byGroup.set(groupValue, createBucket());
        }
        const bucket = byGroup.get(groupValue);
        bucket.n += 1;
        bucket.sum += score;
        bucket.counts[score] = (bucket.counts[score] || 0) + 1;
      });

      groupResults = groupOrder.map(groupValue => {
        const bucket = byGroup.get(groupValue);
        return {
          value: groupValue,
          label: `${critEntry.label}: ${groupValue}`,
          n: bucket.n,
          mean: bucket.n > 0 ? bucket.sum / bucket.n : 0,
          scoreResults: scoreRange.map(score => ({
            score,
            label: getScaleScoreLabel(entry, score),
            count: bucket.counts[score] || 0,
            pct: bucket.n > 0 ? ((bucket.counts[score] || 0) / bucket.n) * 100 : 0
          }))
        };
      });
    }
  }

  return {
    targetLabel,
    codebookEntry: entry,
    totalN,
    mean,
    scoreRange,
    scoreResults,
    visualType: 'scale',
    criterionLabel: groupResults ? criterionLabel : null,
    groupResults
  };
}

function isSelectedBinaryValue(value) {
  const normalized = cleanCell(value).toLowerCase();
  return normalized === '1'
    || normalized === 'y'
    || normalized === 'yes'
    || normalized === 'true'
    || normalized === '선택';
}

function getExpandedBinaryOptionEntries(targetLabel, entry) {
  const codebookMap = resultState.codebookByLabel || new Map();
  return (entry.options || []).map(option => {
    const expandedLabel = `${targetLabel}__${option}`;
    const expandedEntry = codebookMap.get(expandedLabel);
    if (!expandedEntry || expandedEntry.role !== 'expanded') return null;
    return { option, expandedLabel, expandedEntry };
  }).filter(Boolean);
}

function aggregateMultiple(targetLabel, criterionLabel, rows) {
  const entry = resultState.codebookByLabel.get(targetLabel);
  if (!entry) return null;

  const optionEntries = getExpandedBinaryOptionEntries(targetLabel, entry);
  if (optionEntries.length === 0) return null;

  const totalN = rows.length;
  const totalResults = optionEntries.map(({ option, expandedLabel }) => {
    const idx = filterState.headerMap ? filterState.headerMap.get(expandedLabel) : undefined;
    const count = idx === undefined
      ? 0
      : rows.reduce((sum, row) => sum + (isSelectedBinaryValue((row || [])[idx]) ? 1 : 0), 0);
    return {
      option,
      count,
      pct: totalN > 0 ? (count / totalN) * 100 : 0
    };
  });
  const visibleTotalResults = totalResults.filter(result => result.count > 0);

  let groupResults = null;
  if (criterionLabel) {
    const critEntry = resultState.codebookByLabel.get(criterionLabel) || (() => {
      const candidate = getCandidateByKey(criterionLabel);
      if (!candidate) return null;
      return {
        label: candidate.label,
        type: '객관식 단일',
        role: 'raw',
        options: candidate.options || []
      };
    })();
    const cIdx = filterState.headerMap.get(criterionLabel);
    if (critEntry && cIdx !== undefined) {
      const groupOrder = [...critEntry.options];
      const groupSet = new Set(groupOrder);
      const byGroup = new Map();
      groupOrder.forEach(groupValue => {
        byGroup.set(groupValue, {
          n: 0,
          count: Object.fromEntries(optionEntries.map(({ option }) => [option, 0]))
        });
      });

      rows.forEach(row => {
        const groupValue = cleanCell((row || [])[cIdx]);
        if (groupValue === '') return;
        if (!groupSet.has(groupValue)) {
          groupSet.add(groupValue);
          groupOrder.push(groupValue);
          byGroup.set(groupValue, {
            n: 0,
            count: Object.fromEntries(optionEntries.map(({ option }) => [option, 0]))
          });
        }
        const group = byGroup.get(groupValue);
        group.n += 1;
        optionEntries.forEach(({ option, expandedLabel }) => {
          const idx = filterState.headerMap ? filterState.headerMap.get(expandedLabel) : undefined;
          if (idx === undefined) return;
          if (isSelectedBinaryValue((row || [])[idx])) {
            group.count[option] = (group.count[option] || 0) + 1;
          }
        });
      });

      groupResults = groupOrder.map(groupValue => {
        const group = byGroup.get(groupValue);
        return {
          value: groupValue,
          label: `${critEntry.label}: ${groupValue}`,
          n: group.n,
          results: visibleTotalResults.map(result => ({
            option: result.option,
            count: group.count[result.option] || 0,
            pct: group.n > 0 ? ((group.count[result.option] || 0) / group.n) * 100 : 0
          }))
        };
      });
    }
  }

  return {
    targetLabel,
    codebookEntry: entry,
    totalN,
    optionOrder: visibleTotalResults.map(result => result.option),
    totalResults: visibleTotalResults,
    visualType: 'choice',
    criterionLabel: groupResults ? criterionLabel : null,
    groupResults
  };
}

function buildBasicChartHtml(data) {
  const rows = data.totalResults;
  const rowHtml = rows.map(r => {
    const widthStr = `${Math.max(0, Math.min(100, r.pct))}%`;
    const labelTip = encodeURIComponent(JSON.stringify({
      kind: 'option-label',
      option: r.option
    }));
    const tip = encodeURIComponent(JSON.stringify({
      kind: 'basic-bar',
      option: r.option,
      pct: r.pct,
      count: r.count
    }));
    return `
      <div class="hbar-row">
        <div class="hbar-label" title="${escapeHtml(r.option)}" data-tip="${labelTip}">${escapeHtml(r.option)}</div>
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
  const displayGroups = getDisplayGroupResults(data.groupResults, hidden);
  const rowHtml = rows.map(r => {
    const widthStr = `${Math.max(0, Math.min(100, r.pct))}%`;
    const labelTip = encodeURIComponent(JSON.stringify({
      kind: 'option-label',
      option: r.option
    }));
    const tip = encodeURIComponent(JSON.stringify({
      kind: 'compare-bar',
      option: r.option,
      pct: r.pct,
      count: r.count
    }));
    return `
      <div class="hbar-row">
        <div class="hbar-label" title="${escapeHtml(r.option)}" data-tip="${labelTip}">${escapeHtml(r.option)}</div>
        <div class="hbar-track">
          <div class="hbar-fill"
               style="width:${widthStr}; background:${COMPARE_BAR_COLOR};"
               data-tip="${tip}"></div>
        </div>
        <div class="hbar-value">${formatPercent(r.pct)}</div>
      </div>
    `;
  }).join('');

  const pathsHtml = displayGroups.map((g) => {
    const color = getGroupColor(data.groupResults, g.value);
    const pcts = rows.map((r) => {
      const gr = g.results.find(x => x.option === r.option) || { pct: 0, count: 0 };
      return Math.max(0, Math.min(100, gr.pct)).toFixed(4);
    }).join(',');
    return `<path class="group-path" d="" stroke="${color}" vector-effect="non-scaling-stroke" data-pcts="${pcts}" />`;
  }).join('');

  const dotsHtml = displayGroups.map((g) => {
    const color = getGroupColor(data.groupResults, g.value);
    return rows.map((r, i) => {
      const gr = g.results.find(x => x.option === r.option) || { pct: 0, count: 0 };
      const left = Math.max(0, Math.min(100, gr.pct));
      const tip = encodeURIComponent(JSON.stringify({
        kind: 'group-dot',
        groupLabel: g.label,
        option: r.option,
        pct: gr.pct,
        count: gr.count
      }));
      return `<div class="group-dot"
                   style="left:${left}%; background:${color};"
                   data-row-index="${i}"
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

function getDisplayGroupResults(groupResults, hidden) {
  if (!Array.isArray(groupResults)) return [];
  return groupResults.filter(group => {
    const hasResponse = Array.isArray(group.results)
      ? group.results.some(r => (r.count || 0) > 0)
      : Array.isArray(group.perOption)
        ? group.perOption.some(r => {
            const totalCount = r.totalCount || 0;
            const perRankCount = Array.isArray(r.perRank)
              ? r.perRank.reduce((sum, pr) => sum + (pr.count || 0), 0)
              : 0;
            return totalCount > 0 || perRankCount > 0;
          })
        : ((group.n || 0) > 0);
    if (!hasResponse) return false;
    if (hidden && hidden.has(group.value)) return false;
    return true;
  });
}

function getGroupColor(groupResults, groupValue) {
  const baseGroups = getDisplayGroupResults(groupResults);
  const idx = baseGroups.findIndex(group => group.value === groupValue);
  return GROUP_PALETTE[(idx < 0 ? 0 : idx) % GROUP_PALETTE.length];
}

function buildLegendHtml(data, hidden) {
  if (!data.groupResults) return '';
  const displayGroups = getDisplayGroupResults(data.groupResults);
  if (displayGroups.length === 0) return '';
  const items = displayGroups.map((g) => {
    const color = getGroupColor(data.groupResults, g.value);
    const isHidden = hidden.has(g.value);
    return `
      <label class="legend-item ${isHidden ? 'disabled' : ''}" data-group="${escapeHtml(g.value)}">
        <input type="checkbox" ${isHidden ? '' : 'checked'}>
        <span class="legend-swatch" style="background:${color}"></span>
        <span>${escapeHtml(g.label)}</span>
      </label>
    `;
  }).join('');
  return `
    <aside class="legend-panel">
      <div class="legend" data-target="${escapeHtml(data.targetLabel)}" data-mode="group">${items}</div>
      <div class="legend-actions" data-target="${escapeHtml(data.targetLabel)}" data-mode="group">
        <button type="button" class="legend-action-btn" data-legend-action="all-on">전체 선택</button>
        <button type="button" class="legend-action-btn" data-legend-action="all-off">전체 해제</button>
      </div>
    </aside>
  `;
}

function renderTableOptionLabel(option, targetLabel) {
  const safeOption = escapeHtml(option);
  if (!isOtherOption(option)) return safeOption;
  return `${safeOption}<button type="button" class="other-response-open-btn" data-open-other="${escapeHtml(targetLabel)}">응답 보기</button>`;
}

function buildQuestionFullHtml(entry) {
  return entry && entry.full
    ? `<div class="result-sub">Q. ${escapeHtml(entry.full)}</div>`
    : '';
}

function getResultVisualClass(hasLegend) {
  return hasLegend ? 'result-visual has-legend' : 'result-visual';
}

function buildGroupedCountHeader(label, count, colspan) {
  return `<th colspan="${colspan}" class="group-head">${escapeHtml(label)}<br><span style="font-weight:500;color:var(--text-3);">N=${Number(count || 0).toLocaleString()}</span></th>`;
}

function wrapResultTable(tableHtml, noteHtml = '') {
  return `
    <div class="result-table-wrap">
      ${tableHtml}
    </div>
    ${noteHtml}
  `;
}

function buildChoiceDataTableHtml(data) {
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
              <th class="num">빈도수 (명)</th>
            </tr>
          </thead>
          <tbody>
            ${totalResults.map(r => `
              <tr>
                <td>${renderTableOptionLabel(r.option, data.targetLabel)}</td>
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
    return wrapResultTable(tableHtml, helperText);
  }

  const hidden = resultState.hiddenGroupKeys.get(data.targetLabel) || new Set();
  const displayGroups = getDisplayGroupResults(groupResults, hidden);
  const topRow1 = [
    `<th rowspan="2">응답 보기</th>`,
    buildGroupedCountHeader('응답자 전체', totalN, 2),
    ...displayGroups.map(g => buildGroupedCountHeader(g.label, g.n, 2))
  ].join('');
  const topRow2 = [
    `<th class="num group-col">비율(%)</th><th class="num">빈도수 (명)</th>`,
    ...displayGroups.map(() => `<th class="num group-col">비율(%)</th><th class="num">빈도수 (명)</th>`)
  ].join('');

  const bodyRows = totalResults.map(r => {
    const groupCells = displayGroups.map(g => {
      const gr = g.results.find(x => x.option === r.option) || { pct: 0, count: 0 };
      return `<td class="num group-col">${formatPercent(gr.pct)}</td><td class="num">${gr.count.toLocaleString()}</td>`;
    }).join('');
    return `
      <tr>
        <td>${renderTableOptionLabel(r.option, data.targetLabel)}</td>
        <td class="num group-col">${formatPercent(r.pct)}</td>
        <td class="num">${r.count.toLocaleString()}</td>
        ${groupCells}
      </tr>
    `;
  }).join('');
  const totalGroupCells = displayGroups.map(g => {
    const totalCount = totalResults.reduce((sum, result) => {
      const gr = g.results.find(x => x.option === result.option);
      return sum + ((gr && gr.count) || 0);
    }, 0);
    const totalPct = g.n > 0 ? (totalCount / g.n) * 100 : 0;
    return `<td class="num group-col">${formatPercent(totalPct)}</td><td class="num">${totalCount.toLocaleString()}</td>`;
  }).join('');

  const tableHtml = `
    <table class="result-table">
      <thead>
        <tr>${topRow1}</tr>
        <tr>${topRow2}</tr>
      </thead>
      <tbody>
        ${bodyRows}
        <tr class="total-row">
          <td>합계</td>
          <td class="num group-col">${formatPercent(totalResults.reduce((sum, result) => sum + (result.pct || 0), 0))}</td>
          <td class="num">${totalN.toLocaleString()}</td>
          ${totalGroupCells}
        </tr>
      </tbody>
    </table>
  `;
  return wrapResultTable(tableHtml);
}

function getScaleViewMode(targetLabel) {
  return resultState.scaleViewModes.get(targetLabel) || 'distribution';
}

function canHideScaleMidpoint(data) {
  return !!(data && Array.isArray(data.scoreRange) && data.scoreRange.length >= 3 && (data.scoreRange.length % 2 === 1));
}

function isScaleMidpointHidden(targetLabel) {
  return !!resultState.scaleMidpointHidden.get(targetLabel);
}

function buildScaleToggleHtml(targetLabel, activeMode, options = {}) {
  const { showMidpointOption = false, hideMidpoint = false, disabledModes = [] } = options;
  const buttons = [
    { mode: 'distribution', label: '분포 보기' },
    { mode: 'mean', label: '평균 보기' }
  ].map(item => {
    const disabled = disabledModes.includes(item.mode);
    return `
    <button type="button"
            class="result-view-btn ${activeMode === item.mode ? 'active' : ''}"
            data-scale-mode="${item.mode}"
            data-target="${escapeHtml(targetLabel)}"
            ${disabled ? 'aria-disabled="true" data-scale-mode-disabled="true"' : ''}>
      ${escapeHtml(item.label)}
    </button>
  `;
  }).join('');
  const midpointOption = showMidpointOption ? `
    <label class="scale-view-option">
      <input type="checkbox" data-scale-hide-midpoint="true" data-target="${escapeHtml(targetLabel)}" ${hideMidpoint ? 'checked' : ''}>
      <span>중간값 제외 보기</span>
    </label>
  ` : '';
  return `
    <div class="scale-view-controls">
      <div class="result-view-toggle">${buttons}</div>
      ${midpointOption}
    </div>
  `;
}

function buildScaleAxisHtml(maxScore, options = {}) {
  const { centered = false, showLabels = false } = options;
  return `
    <div class="scale-axis ${centered ? 'axis-centered' : ''}">
      ${Array.from({ length: maxScore }, (_, i) => {
        const score = i + 1;
        const left = maxScore === 1 ? 50 : (i / (maxScore - 1)) * 100;
        return `
          <span class="scale-axis-point" style="left:${left}%;">
            <span class="scale-axis-tick"></span>
          </span>
          ${showLabels ? `<span class="scale-axis-label" style="left:${left}%;">${score}</span>` : ''}
        `;
      }).join('')}
    </div>
  `;
}

function buildScaleMeanHtml(mean, maxScore, tipData, options = {}) {
  const { centered = false } = options;
  if (!Number.isFinite(mean) || mean <= 0) return '<div class="scale-mean-row"></div>';
  const left = getScaleMeanLeftPct(mean, maxScore);
  return `
    <div class="scale-mean-row ${centered ? 'centered' : ''}">
      <div class="scale-mean ${centered ? 'centered' : ''}" style="left:${left}%;" data-tip="${encodeURIComponent(JSON.stringify(tipData))}">
        <div class="scale-mean-label">평균</div>
        <div class="scale-mean-dot">${mean.toFixed(2)}</div>
      </div>
    </div>
  `;
}

function getScaleDisplayResults(scoreResults, options = {}) {
  const { hideMidpoint = false } = options;
  const source = Array.isArray(scoreResults) ? scoreResults : [];
  if (!hideMidpoint || source.length === 0 || (source.length % 2) !== 1) {
    return source.map(result => ({
      ...result,
      displayPct: result.pct || 0
    }));
  }
  const midpoint = (source.length + 1) / 2;
  const filtered = source.filter(result => result.score !== midpoint);
  const visibleTotalPct = filtered.reduce((sum, result) => sum + (result.pct || 0), 0);
  return filtered.map(result => ({
    ...result,
    displayPct: visibleTotalPct > 0 ? ((result.pct || 0) / visibleTotalPct) * 100 : 0
  }));
}

function buildScaleTrackHtml(scoreResults, maxScore, options = {}) {
  const { muted = false, interactive = true, hideMidpoint = false } = options;
  const displayResults = getScaleDisplayResults(scoreResults, { hideMidpoint });
  const segments = displayResults.map(result => {
    const width = Math.max(0, Math.min(100, result.displayPct || 0));
    const tip = encodeURIComponent(JSON.stringify({
      kind: 'scale-segment',
      score: result.score,
      scoreLabel: result.label,
      pct: result.pct,
      count: result.count
    }));
    return `
      <div class="scale-segment"
           style="width:${width}%; background:${getScaleColor(result.score, maxScore)};"
           ${interactive ? `data-tip="${tip}"` : ''}></div>
    `;
  }).join('');
  return `
    <div class="scale-bar ${muted ? 'is-muted' : ''}">
      <div class="scale-track ${muted ? 'is-muted' : ''}">${segments}</div>
    </div>
  `;
}

function buildScaleDistributionSummaryHtml(scoreResults) {
  const summary = getScalePolaritySummary(scoreResults);
  return `
    <div class="scale-summary">
      <div class="scale-summary-item"><span class="label">하위 척도 응답 합계</span><span class="value">${formatPercent(summary.negativePct)}</span></div>
      <div class="scale-summary-item is-positive"><span class="label">상위 척도 응답 합계</span><span class="value">${formatPercent(summary.positivePct)}</span></div>
    </div>
  `;
}

function buildScaleDistributionBarHtml(scoreResults, maxScore, options = {}) {
  const { hideMidpoint = false } = options;
  return `
    <div class="scale-bar-wrap">
      ${buildScaleTrackHtml(scoreResults, maxScore, { hideMidpoint })}
      ${buildScaleDistributionSummaryHtml(scoreResults)}
    </div>
  `;
}

function buildScaleMeanOnlyHtml(mean, maxScore, meanTipData, scoreResults, options = {}) {
  const { hideMidpoint = false } = options;
  return `
    <div class="scale-mean-only">
      <div class="scale-mean-background">
        ${buildScaleTrackHtml(scoreResults, maxScore, { muted: true, interactive: false, hideMidpoint })}
      </div>
      ${buildScaleAxisHtml(maxScore, { centered: true, showLabels: true })}
      ${buildScaleMeanHtml(mean, maxScore, meanTipData, { centered: true })}
    </div>
  `;
}

function buildDerivedScaleBins(values, maxScore) {
  const binCount = 37;
  const minScore = 1;
  const safeMax = Number.isFinite(maxScore) && maxScore > minScore ? maxScore : 7;
  const counts = Array.from({ length: binCount }, () => 0);
  const nums = (Array.isArray(values) ? values : []).filter(Number.isFinite);
  nums.forEach(value => {
    if (value < minScore || value > safeMax) return;
    const idx = Math.max(0, Math.min(binCount - 1, Math.round(((value - minScore) / (safeMax - minScore)) * (binCount - 1))));
    counts[idx] += 1;
  });
  let smooth = counts;
  for (let pass = 0; pass < 2; pass++) {
    smooth = smooth.map((count, idx) => {
      const prev = smooth[Math.max(0, idx - 1)];
      const next = smooth[Math.min(smooth.length - 1, idx + 1)];
      return (prev + (count * 2) + next) / 4;
    });
  }
  const maxDensity = Math.max(...smooth, 0);
  return smooth.map((density, idx) => ({
    x: binCount === 1 ? 50 : (idx / (binCount - 1)) * 100,
    density,
    width: maxDensity > 0 ? (density / maxDensity) * 28 : 0
  }));
}

function buildDerivedScaleViolinPath(values, maxScore) {
  const bins = buildDerivedScaleBins(values, maxScore);
  if (!bins.some(bin => bin.density > 0)) return '';
  const centerY = 42;
  const topPoints = bins.map(bin => `${bin.x.toFixed(2)},${(centerY - bin.width).toFixed(2)}`);
  const bottomPoints = [...bins].reverse().map(bin => `${bin.x.toFixed(2)},${(centerY + bin.width).toFixed(2)}`);
  return `M ${topPoints.join(' L ')} L ${bottomPoints.join(' L ')} Z`;
}

function buildDerivedScaleQuartileMarkersHtml(data, maxScore, options = {}) {
  const { muted = false } = options;
  const items = [
    { key: 'q1', label: 'Q1', fullLabel: 'Q1(하위 25%)', value: data.q1 },
    { key: 'median', label: 'Q2', fullLabel: 'Q2(중앙값)', value: data.median },
    { key: 'q3', label: 'Q3', fullLabel: 'Q3(상위 25%)', value: data.q3 }
  ];
  return items.map(item => {
    const left = getScaleMeanLeftPct(item.value, maxScore);
    if (left === null) return '';
    const tip = encodeURIComponent(JSON.stringify({
      kind: 'derived-scale-quartile',
      label: item.fullLabel,
      value: item.value
    }));
    return `
      <div class="derived-scale-quartile ${muted ? 'is-muted' : ''}"
           style="left:${left}%;"
           data-label="${item.label}"
           data-tip="${tip}"></div>
    `;
  }).join('');
}

function buildDerivedScaleViolinHtml(data, viewMode) {
  const maxScore = data.scoreRange.length;
  const path = buildDerivedScaleViolinPath(data.values, maxScore);
  const meanLeft = getScaleMeanLeftPct(data.mean, maxScore);
  const muted = viewMode === 'mean';
  const showMeanMarker = viewMode === 'mean';
  const gradientId = `derived-scale-gradient-${Math.random().toString(36).slice(2, 10)}`;
  const meanTip = encodeURIComponent(JSON.stringify({
    kind: 'scale-mean',
    mean: data.mean,
    totalN: data.totalN
  }));
  const violinTip = encodeURIComponent(JSON.stringify({
    kind: 'derived-scale-violin',
    totalN: data.totalN,
    min: data.min,
    max: data.max
  }));
  return `
    <div class="derived-scale-chart">
      <div class="derived-scale-violin-wrap" data-tip="${violinTip}">
        <svg class="derived-scale-violin" viewBox="0 0 100 84" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="0%">
              ${SCALE_DIVERGING_PALETTE.map((color, idx) => {
                const offset = SCALE_DIVERGING_PALETTE.length === 1 ? 0 : (idx / (SCALE_DIVERGING_PALETTE.length - 1)) * 100;
                return `<stop offset="${offset.toFixed(2)}%" stop-color="${color}"></stop>`;
              }).join('')}
            </linearGradient>
          </defs>
          <line class="derived-scale-centerline" x1="0" y1="42" x2="100" y2="42"></line>
          ${path ? `<path class="derived-scale-violin-shape ${muted ? 'is-muted' : ''}" style="fill:url(#${gradientId});" d="${path}"></path>` : ''}
        </svg>
        ${buildScaleAxisHtml(maxScore, { centered: true, showLabels: true })}
        ${buildDerivedScaleQuartileMarkersHtml(data, maxScore, { muted })}
        ${!showMeanMarker || meanLeft === null ? '' : `
          <div class="derived-scale-mean-marker" style="left:${meanLeft}%;" data-tip="${meanTip}">
            <div class="derived-scale-mean-line"></div>
            <div class="derived-scale-mean-label">평균</div>
            <div class="derived-scale-mean-dot">${Number(data.mean || 0).toFixed(2)}</div>
          </div>
        `}
      </div>
    </div>
  `;
}

function formatScaleScoreLabel(result) {
  if (!result) return '';
  const baseLabel = `${result.score}점`;
  return result.label !== baseLabel
    ? `${baseLabel} - ${escapeHtml(result.label)}`
    : baseLabel;
}

function buildScaleLegendItemsHtml(data) {
  const maxScore = data.scoreRange.length;
  const items = data.scoreResults.map(result => `
    <div class="scale-score-item">
      <span class="scale-score-swatch" style="background:${getScaleColor(result.score, maxScore)}"></span>
      <div class="scale-score-copy">
        <span class="scale-score-key">${result.score}점</span>${result.label !== `${result.score}점` ? ` - <span class="scale-score-text">${escapeHtml(result.label)}</span>` : ''}
      </div>
    </div>
  `).join('');
  return `<div class="scale-score-legend">${items}</div>`;
}

function buildScaleLegendItemsByScoreRangeHtml(scoreRange) {
  const scores = Array.isArray(scoreRange) ? scoreRange : [];
  const maxScore = scores.length;
  const items = scores.map(score => `
    <div class="scale-score-item">
      <span class="scale-score-swatch" style="background:${getScaleColor(score, maxScore)}"></span>
      <div class="scale-score-copy">
        <span class="scale-score-key">${score}점</span>
      </div>
    </div>
  `).join('');
  return `<div class="scale-score-legend">${items}</div>`;
}

function buildScaleScoreOnlyLegendHtml(scoreRange) {
  return `
    <aside class="legend-panel">
      ${buildScaleLegendItemsByScoreRangeHtml(scoreRange)}
    </aside>
  `;
}

function buildScaleLegendHtml(data) {
  return `
    <aside class="legend-panel">
      ${buildScaleLegendItemsHtml(data)}
    </aside>
  `;
}

function getScaleCompareCandidateEntries(targetLabel) {
  const baseEntry = resultState.codebookByLabel.get(targetLabel);
  if (!baseEntry || !isScaleChoiceType(baseEntry.type)) return [];
  const targetValueCount = Number(baseEntry.valueCount);
  const baseIsDerived = isDerivedScaleEntry(baseEntry);
  return Array.from(resultState.codebookByLabel.values()).filter(entry => {
    if (!entry || entry.label === targetLabel) return false;
    if (!isScaleChoiceType(entry.type)) return false;
    if (isDerivedScaleEntry(entry) !== baseIsDerived) return false;
    if (!baseIsDerived && entry.role !== 'raw') return false;
    return Number(entry.valueCount) === targetValueCount;
  });
}

function getScaleCompareSelectedLabels(targetLabel) {
  const allowed = new Set(getScaleCompareCandidateEntries(targetLabel).map(entry => entry.label));
  const current = Array.isArray(resultState.scaleCompareSelections.get(targetLabel))
    ? resultState.scaleCompareSelections.get(targetLabel)
    : [];
  const next = current.filter(label => allowed.has(label));
  if (next.length !== current.length) {
    if (next.length > 0) resultState.scaleCompareSelections.set(targetLabel, next);
    else resultState.scaleCompareSelections.delete(targetLabel);
  }
  return next;
}

function aggregateTargetScaleCompareData(targetLabels, criterionLabel, rows) {
  const compareLabels = getTargetScaleCompareLabels(targetLabels);
  if (compareLabels.length < 2) return null;
  const compared = compareLabels.map(label => aggregateScale(label, criterionLabel, rows))
    .filter(item => item && item.visualType === 'scale');
  if (compared.length < 2) return null;

  const baseData = compared[0];
  const questions = compared.map(item => ({
    value: item.targetLabel,
    label: item.targetLabel,
    full: item.codebookEntry && item.codebookEntry.full ? item.codebookEntry.full : '',
    mean: item.mean,
    totalN: item.totalN,
    data: item
  }));

  let groups = null;
  if (baseData.groupResults) {
    const baseGroups = Array.isArray(baseData.groupResults) ? baseData.groupResults : [];
    groups = baseGroups.map(group => {
      const points = compared.map(item => {
        const found = Array.isArray(item.groupResults)
          ? item.groupResults.find(candidate => candidate.value === group.value)
          : null;
        return {
          questionLabel: item.targetLabel,
          mean: found ? found.mean : 0,
          n: found ? found.n : 0
        };
      });
      return {
        value: group.value,
        label: group.label,
        color: getGroupColor(baseGroups, group.value),
        points
      };
    }).filter(group => group.points.some(point => point.n > 0));
  }

  return {
    targetLabel: baseData.targetLabel,
    baseData,
    maxScore: baseData.scoreRange.length,
    criterionLabel: baseData.criterionLabel,
    questions,
    groups
  };
}

function getDisplayScaleCompareGroups(groups, hiddenGroups) {
  if (!Array.isArray(groups)) return [];
  return groups.filter(group => {
    if (hiddenGroups && hiddenGroups.has(group.value)) return false;
    return Array.isArray(group.points) && group.points.some(point => point.n > 0);
  });
}

function buildScaleCompareOverallDotHtml(question, maxScore, compact = false) {
  const left = getScaleMeanLeftPct(question.mean, maxScore);
  if (left === null) return '';
  const tip = encodeURIComponent(JSON.stringify({
    kind: 'scale-mean',
    questionLabel: question.label,
    groupLabel: '응답자 전체',
    mean: question.mean,
    totalN: question.totalN
  }));
  return `
    <div class="scale-compare-dot is-overall ${compact ? 'is-compact' : ''}" style="left:${left}%;" data-tip="${tip}">
      ${compact ? '' : `<span>${formatScaleCompareMean(question.mean)}</span>`}
    </div>
  `;
}

function buildScaleCompareGroupDotHtml(group, point, maxScore, withOverall, compact = false) {
  if (!point || point.n <= 0) return '';
  const left = getScaleMeanLeftPct(point.mean, maxScore);
  if (left === null) return '';
  const tip = encodeURIComponent(JSON.stringify({
    kind: 'scale-compare-group-dot',
    groupLabel: group.label,
    questionLabel: point.questionLabel,
    mean: point.mean,
    totalN: point.n
  }));
  return `
    <div class="scale-compare-dot is-group ${withOverall ? 'has-overall' : ''} ${compact ? 'is-compact' : ''}"
         style="left:${left}%; background:${group.color};"
         data-tip="${tip}">
      ${compact ? '' : `<span>${formatScaleCompareMean(point.mean)}</span>`}
    </div>
  `;
}

function buildScaleCompareLegendHtml(groups, hiddenGroups = new Set(), targetLabel = '') {
  if (!Array.isArray(groups) || groups.length === 0) return '';
  const items = [
    `<div class="scale-compare-legend-item"><span class="scale-compare-legend-dot is-overall"></span><span>응답자 전체 평균</span></div>`,
    ...groups.map(group => {
      const isHidden = hiddenGroups && hiddenGroups.has(group.value);
      return `
      <label class="scale-compare-legend-item ${isHidden ? 'disabled' : ''}" data-group="${escapeHtml(group.value)}">
        <input type="checkbox"
               data-scale-group-toggle="true"
               data-target="${escapeHtml(targetLabel)}"
               data-group="${escapeHtml(group.value)}"
               ${isHidden ? '' : 'checked'}>
        <span class="scale-compare-legend-dot" style="background:${group.color};"></span>
        <span>${escapeHtml(group.label)}</span>
      </label>
    `;
    })
  ].join('');
  return `
    <aside class="legend-panel">
      <div class="scale-compare-legend legend" data-target="${escapeHtml(targetLabel)}" data-mode="group">${items}</div>
      <div class="legend-actions" data-target="${escapeHtml(targetLabel)}" data-mode="group">
        <button type="button" class="legend-action-btn" data-legend-action="all-on">전체 선택</button>
        <button type="button" class="legend-action-btn" data-legend-action="all-off">전체 해제</button>
      </div>
    </aside>
  `;
}

function buildScaleCompareRowAxisHtml(maxScore, item = null) {
  const safeMaxScore = Number.isFinite(Number(maxScore)) && Number(maxScore) >= 2 ? Math.round(Number(maxScore)) : 5;
  return `
    <div class="scale-compare-row-axis">
      ${Array.from({ length: safeMaxScore }, (_, i) => {
        const score = i + 1;
        const left = i / (safeMaxScore - 1) * 100;
        return `
          <span class="scale-compare-row-axis-point" style="left:${left}%;"></span>
          <span class="scale-compare-row-axis-label" style="left:${left}%;">
            <span class="scale-compare-row-axis-score">${score}</span>
          </span>
        `;
      }).join('')}
      ${[0, safeMaxScore - 1].map((edgeIndex) => {
        const score = edgeIndex + 1;
        const isLeft = edgeIndex === 0;
        const left = edgeIndex / (safeMaxScore - 1) * 100;
        const edgeLabel = item && item.codebookEntry
          ? getScaleScoreLabel(item.codebookEntry, score)
          : String(score);
        const label = edgeLabel && edgeLabel !== `${score}점` ? edgeLabel : '';
        if (!label) return '';
        return `<span class="scale-compare-row-axis-copy ${isLeft ? 'is-left' : 'is-right'}">${escapeHtml(label)}</span>`;
      }).join('')}
    </div>
  `;
}

function buildScaleCompareQuestionLabelHtml(question) {
  const tip = encodeURIComponent(JSON.stringify({
    kind: 'question-full',
    label: question.label,
    full: question.full
  }));
  return `<div class="scale-compare-label" data-tip="${tip}">${escapeHtml(question.label)}</div>`;
}

function buildScaleCompareDistributionBackgroundHtml(item) {
  if (!item) return '';
  const hideMidpoint = isScaleMidpointHidden(TARGET_SCALE_COMPARE_VIEW_KEY);
  if (item.isDerivedScale) {
    const path = buildDerivedScaleViolinPath(item.values, item.scoreRange.length);
    if (!path) return '';
    const gradientId = `derived-scale-compare-bg-${Math.random().toString(36).slice(2, 10)}`;
    return `
      <div class="scale-compare-distribution-bg" aria-hidden="true">
        <svg class="derived-scale-violin" viewBox="0 0 100 84" preserveAspectRatio="none">
          <defs>
            <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="0%">
              ${SCALE_DIVERGING_PALETTE.map((color, idx) => {
                const offset = SCALE_DIVERGING_PALETTE.length === 1 ? 0 : (idx / (SCALE_DIVERGING_PALETTE.length - 1)) * 100;
                return `<stop offset="${offset.toFixed(2)}%" stop-color="${color}"></stop>`;
              }).join('')}
            </linearGradient>
          </defs>
          <path class="derived-scale-violin-shape is-muted" style="fill:url(#${gradientId});" d="${path}"></path>
        </svg>
      </div>
    `;
  }
  return `
    <div class="scale-compare-distribution-bg" aria-hidden="true">
      ${buildScaleTrackHtml(item.scoreResults, item.scoreRange.length, { muted: true, interactive: false, hideMidpoint })}
    </div>
  `;
}

function buildScaleCompareDistributionSectionHtml(compareData) {
  if (!compareData) return '';
  const scoreRange = compareData.baseData && Array.isArray(compareData.baseData.scoreRange)
    ? compareData.baseData.scoreRange
    : Array.from({ length: compareData.maxScore || 0 }, (_, i) => i + 1);
  const visualClass = getResultVisualClass(true);
  const rowsHtml = compareData.questions.map(question => {
    const item = question.data;
    if (!item) return '';
    const hideMidpoint = isScaleMidpointHidden(TARGET_SCALE_COMPARE_VIEW_KEY);
    const chartHtml = item.isDerivedScale
      ? buildDerivedScaleViolinHtml(item, 'distribution')
      : `<div class="scale-chart">${buildScaleDistributionBarHtml(item.scoreResults, item.scoreRange.length, { hideMidpoint })}</div>`;
    return `
      <div class="scale-compare-row scale-compare-distribution-row">
        ${buildScaleCompareQuestionLabelHtml(question)}
        <div class="scale-compare-distribution-cell">${chartHtml}</div>
      </div>
    `;
  }).join('');
  return `
    <div class="scale-compare-section is-flush">
      <div class="${visualClass} scale-compare-card">
        <div class="result-chart-col">
          <div class="scale-compare-chart">${rowsHtml}</div>
        </div>
        ${buildScaleScoreOnlyLegendHtml(scoreRange)}
      </div>
    </div>
  `;
}

function buildScaleCompareScoreHeaders(scoreRange) {
  return (scoreRange || []).map(score => `
    <th class="num group-head" colspan="2">${Number(score).toLocaleString()}점</th>
  `).join('');
}

function buildScaleCompareScoreSubHeaders(scoreRange) {
  return (scoreRange || []).map(() => `
    <th class="num group-col">비율(%)</th><th class="num">빈도수 (명)</th>
  `).join('');
}

function buildScaleCompareScoreCells(scoreResults, scoreRange) {
  const results = Array.isArray(scoreResults) ? scoreResults : [];
  return (scoreRange || []).map(score => {
    const result = results.find(item => Number(item.score) === Number(score));
    if (!result) return '<td class="num group-col">-</td><td class="num">-</td>';
    return `<td class="num group-col">${formatPercent(result.pct)}</td><td class="num">${Number(result.count || 0).toLocaleString()}</td>`;
  }).join('');
}

function buildScaleCompareDataTableHtml(compareData, hiddenGroups = new Set()) {
  if (!compareData || !Array.isArray(compareData.questions)) return '';
  const hasGroups = !!compareData.criterionLabel;
  const displayGroups = getDisplayScaleCompareGroups(compareData.groups, hiddenGroups);
  if (hasGroups) {
    const topRow = [
      `<th rowspan="2">문항</th>`,
      `<th colspan="2" class="group-head">응답자 전체</th>`,
      ...displayGroups.map(group => `<th colspan="2" class="group-head">${escapeHtml(group.label)}</th>`)
    ].join('');
    const subRow = [
      `<th class="num group-col">평균</th><th class="num">응답자 수 (명)</th>`,
      ...displayGroups.map(() => `<th class="num group-col">평균</th><th class="num">응답자 수 (명)</th>`)
    ].join('');
    const bodyRows = compareData.questions.map((question, questionIndex) => {
      const groupCells = displayGroups.map(group => {
        const point = group.points[questionIndex] || { mean: 0, n: 0 };
        return `<td class="num group-col mean-value">${Number(point.mean || 0).toFixed(2)}점</td><td class="num">${Number(point.n || 0).toLocaleString()}</td>`;
      }).join('');
      return `
        <tr>
          <td>${escapeHtml(question.label)}</td>
          <td class="num group-col mean-value">${Number(question.mean || 0).toFixed(2)}점</td>
          <td class="num">${Number(question.totalN || 0).toLocaleString()}</td>
          ${groupCells}
        </tr>
      `;
    }).join('');
    return wrapResultTable(`
      <table class="result-table">
        <thead>
          <tr>${topRow}</tr>
          <tr>${subRow}</tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    `);
  }

  const scoreRange = compareData.baseData && Array.isArray(compareData.baseData.scoreRange)
    ? compareData.baseData.scoreRange
    : Array.from({ length: compareData.maxScore || 0 }, (_, i) => i + 1);
  const bodyRows = compareData.questions.map(question => `
    <tr>
      <td>${escapeHtml(question.label)}</td>
      <td class="num mean-value">${Number(question.mean || 0).toFixed(2)}점</td>
      ${buildScaleCompareScoreCells(question.data && question.data.scoreResults, scoreRange)}
      <td class="num">${Number(question.totalN || 0).toLocaleString()}</td>
    </tr>
  `).join('');
  const tableHtml = `
    <table class="result-table">
      <thead>
        <tr>
          <th rowspan="2">문항</th>
          <th rowspan="2" class="num">평균</th>
          ${buildScaleCompareScoreHeaders(scoreRange)}
          <th rowspan="2" class="num">응답자 수 (명)</th>
        </tr>
        <tr>
          ${buildScaleCompareScoreSubHeaders(scoreRange)}
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
  return wrapResultTable(tableHtml);
}

function buildScaleCompareSectionHtml(compareData, hiddenGroups, options = {}) {
  if (!compareData) return '';
  const { showHeader = true, flush = false } = options;
  const visibleGroups = getDisplayScaleCompareGroups(compareData.groups, hiddenGroups);
  const hasGroups = visibleGroups.length > 0;
  const hasLegendGroups = Array.isArray(compareData.groups) && compareData.groups.length > 0;
  const compactMarkers = hasGroups;
  const rowHtml = compareData.questions.map((question, questionIndex) => {
    const overallDotHtml = buildScaleCompareOverallDotHtml(question, compareData.maxScore, compactMarkers);
    const groupDotHtml = hasGroups
      ? visibleGroups.map(group => buildScaleCompareGroupDotHtml(group, group.points[questionIndex], compareData.maxScore, !!overallDotHtml, compactMarkers)).join('')
      : '';
    return `
      <div class="scale-compare-row">
        ${buildScaleCompareQuestionLabelHtml(question)}
        <div class="scale-compare-plot">
          <div class="scale-compare-track"></div>
          ${buildScaleCompareDistributionBackgroundHtml(question.data)}
          ${buildScaleCompareRowAxisHtml(compareData.maxScore, question.data)}
          ${overallDotHtml}
          ${groupDotHtml}
        </div>
      </div>
    `;
  }).join('');
  const linePaths = hasGroups
    ? [
      `<path class="scale-compare-line is-overall"
            data-means="${compareData.questions.map(question => (question.totalN > 0 && Number.isFinite(question.mean) ? question.mean.toFixed(4) : '')).join('|')}"></path>`,
      ...visibleGroups.map(group => `
      <path class="scale-compare-line"
            stroke="${group.color}"
            data-means="${group.points.map(point => (point && point.n > 0 && Number.isFinite(point.mean) ? point.mean.toFixed(4) : '')).join('|')}"></path>
    `)
    ].join('')
    : '';
  const chartHtml = `
    <div class="scale-compare-chart ${hasGroups ? 'is-group' : ''}" data-scale-compare-chart="true" data-max-score="${compareData.maxScore}">
      <div class="scale-compare-rows-wrap">
        ${hasGroups ? `<div class="scale-compare-overlay"><svg class="scale-compare-line-svg">${linePaths}</svg></div>` : ''}
        ${rowHtml}
      </div>
    </div>
  `;
  const visualClass = getResultVisualClass(hasLegendGroups);
  const legendHtml = hasLegendGroups ? buildScaleCompareLegendHtml(compareData.groups, hiddenGroups, compareData.targetLabel) : '';
  return `
    <div class="scale-compare-section ${flush ? 'is-flush' : ''}">
      ${showHeader ? `<div class="scale-compare-header">
        <div class="scale-compare-title">다중 문항 비교</div>
        <div class="scale-compare-sub">
          ${hasGroups ? '연한 회색 점은 전체 평균이고, 그룹 점은 같은 그룹끼리 점선으로 연결됩니다.' : '선택한 문항들의 평균값을 한 화면에서 비교합니다.'}
        </div>
      </div>` : ''}
      <div class="${visualClass} scale-compare-card">
        <div class="result-chart-col">${chartHtml}</div>
        ${legendHtml}
      </div>
    </div>
  `;
}

function buildScaleGroupControlsHtml(data, hiddenGroups) {
  const allGroups = getDisplayGroupResults(data.groupResults);
  if (allGroups.length === 0) return '';
  const items = allGroups.map(group => {
    const color = getGroupColor(data.groupResults, group.value);
    const isHidden = hiddenGroups.has(group.value);
    return `
      <label class="legend-item ${isHidden ? 'disabled' : ''}" data-group="${escapeHtml(group.value)}">
        <input type="checkbox"
               data-scale-group-toggle="true"
               data-target="${escapeHtml(data.targetLabel)}"
               data-group="${escapeHtml(group.value)}"
               ${isHidden ? '' : 'checked'}>
        <span class="legend-swatch" style="background:${color}"></span>
        <span>${escapeHtml(group.label)}</span>
      </label>
    `;
  }).join('');
  return `
    <div class="scale-group-controls-bar">
      <span class="scale-group-controls-title">그룹 표시</span>
      ${items}
    </div>
  `;
}

function buildNumericOpenControlsHtml(targetLabel, interval, start, disabled = false, viewMode = 'histogram') {
  const safeMode = viewMode === 'box' ? 'box' : 'histogram';
  const inputDisabled = disabled || safeMode === 'box';
  const disabledAttr = inputDisabled ? ' disabled' : '';
  const noteText = disabled
    ? '그룹별 비교에서는 전체 기준 축을 유지하기 위해 구간 시작값과 간격을 조정할 수 없습니다.'
    : safeMode === 'box'
      ? '박스수염 보기에서는 전체 기준 축을 유지하기 위해 구간 시작값과 간격을 조정할 수 없습니다.'
      : '구간 시작값과 간격을 조정해 분포를 원하는 기준으로 확인할 수 있습니다.';
  return `
    <div class="numeric-open-controls">
      <div class="numeric-open-view-toggle" role="group" aria-label="주관식 숫자 차트 유형">
        <button type="button"
                class="numeric-open-view-btn ${safeMode === 'histogram' ? 'active' : ''}"
                data-numeric-view="histogram"
                data-target="${escapeHtml(targetLabel)}"
                data-numeric-view-locked="${disabled ? 'true' : 'false'}">히스토그램</button>
        <button type="button"
                class="numeric-open-view-btn ${safeMode === 'box' ? 'active' : ''}"
                data-numeric-view="box"
                data-target="${escapeHtml(targetLabel)}"
                data-numeric-view-locked="${disabled ? 'true' : 'false'}">박스수염</button>
      </div>
      <label class="numeric-open-bin-control">
        <span>구간 시작값</span>
        <input type="number"
               step="1"
               class="numeric-open-bin-input"
               data-numeric-start="true"
               data-target="${escapeHtml(targetLabel)}"
               value="${normalizeNumericHistogramStart(start)}"${disabledAttr}>
      </label>
      <label class="numeric-open-bin-control">
        <span>구간 간격</span>
        <input type="number"
               min="1"
               step="1"
               class="numeric-open-bin-input"
               data-numeric-interval="true"
               data-target="${escapeHtml(targetLabel)}"
               value="${clampNumericHistogramStep(interval)}"${disabledAttr}>
      </label>
      <div class="numeric-open-controls-note">${noteText}</div>
    </div>
  `;
}

function buildNumericWhiskerTrackHtml(item, axisMin, axisMax, numberUnit = '', groupLabel = '', options = {}) {
  const { boxColor = '#b8b8b8' } = options;
  const minLeft = getNumericValueLeftPct(item.min, axisMin, axisMax);
  const q1Left = getNumericValueLeftPct(item.q1, axisMin, axisMax);
  const medianLeft = getNumericValueLeftPct(item.median, axisMin, axisMax);
  const q3Left = getNumericValueLeftPct(item.q3, axisMin, axisMax);
  const maxLeft = getNumericValueLeftPct(item.max, axisMin, axisMax);
  const meanLeft = getNumericValueLeftPct(item.mean, axisMin, axisMax);
  const rangeLeft = Math.min(minLeft ?? 0, maxLeft ?? 0);
  const rangeWidth = Math.max(0.8, Math.abs((maxLeft ?? 0) - (minLeft ?? 0)));
  const boxLeft = Math.min(q1Left ?? 0, q3Left ?? 0);
  const boxWidth = Math.max(0.8, Math.abs((q3Left ?? 0) - (q1Left ?? 0)));
  const rangeTip = encodeURIComponent(JSON.stringify({
    kind: 'numeric-whisker-range',
    groupLabel,
    min: item.min,
    max: item.max,
    totalN: item.n,
    unit: numberUnit
  }));
  const boxTip = encodeURIComponent(JSON.stringify({
    kind: 'numeric-whisker-box',
    groupLabel,
    q1: item.q1,
    median: item.median,
    q3: item.q3,
    totalN: item.n,
    unit: numberUnit
  }));
  const medianTip = encodeURIComponent(JSON.stringify({
    kind: 'numeric-quartile',
    groupLabel,
    label: 'Q2 (중앙값)',
    tooltipLabel: 'Q2 (중앙값)',
    value: item.median,
    unit: numberUnit
  }));
  const meanTip = encodeURIComponent(JSON.stringify({
    kind: 'numeric-mean',
    groupLabel,
    mean: item.mean,
    totalN: item.n,
    unit: numberUnit
  }));
  const meanLabel = Number.isFinite(Number(item.mean))
    ? Number(item.mean).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : '-';
  return `
    <div class="numeric-whisker-track-wrap">
      <div class="numeric-whisker-track">
        <div class="numeric-whisker-track-base"></div>
        <div class="numeric-whisker-range" style="left:${rangeLeft}%; width:${rangeWidth}%;" data-tip="${rangeTip}"></div>
        <div class="numeric-whisker-cap" style="left:${minLeft}%;"></div>
        <div class="numeric-whisker-cap" style="left:${maxLeft}%;"></div>
        <div class="numeric-whisker-box" style="left:${boxLeft}%; width:${boxWidth}%; background:${boxColor};" data-tip="${boxTip}"></div>
        <div class="numeric-whisker-median" style="left:${medianLeft}%;" data-tip="${medianTip}"></div>
        <div class="numeric-whisker-mean" style="left:${meanLeft}%;" data-tip="${meanTip}">
          <div class="numeric-whisker-mean-label">평균</div>
          ${escapeHtml(meanLabel)}
        </div>
      </div>
    </div>
  `;
}

function buildNumericQuartileMarkersHtml(item, numberUnit = '', groupLabel = '') {
  const statMarkers = [
    { key: 'q1', label: 'Q1', tooltipLabel: 'Q1 (하위 25%)', value: item.q1, leftPct: getNumericValueLeftPct(item.q1, item.domainMin, item.domainMax) },
    { key: 'median', label: 'Q2', tooltipLabel: 'Q2 (중앙값)', value: item.median, leftPct: getNumericValueLeftPct(item.median, item.domainMin, item.domainMax) },
    { key: 'q3', label: 'Q3', tooltipLabel: 'Q3 (상위 25%)', value: item.q3, leftPct: getNumericValueLeftPct(item.q3, item.domainMin, item.domainMax) }
  ];
  return statMarkers.map(stat => {
    if (stat.leftPct === null) return '';
    const tip = encodeURIComponent(JSON.stringify({
      kind: 'numeric-quartile',
      groupLabel,
      label: stat.label,
      tooltipLabel: stat.tooltipLabel,
      value: stat.value,
      unit: numberUnit
    }));
    return `
      <div class="numeric-open-stat-marker" style="left:${stat.leftPct}%;">
        <div class="numeric-open-stat-label" data-tip="${tip}">${stat.label}</div>
      </div>
    `;
  }).join('');
}

function buildNumericBoundaryAxisLabelsHtml(bins, domainMax, className) {
  const safeBins = Array.isArray(bins) ? bins : [];
  const boundaryValues = safeBins.map(bin => bin.start).concat([domainMax]);
  return boundaryValues.map((value, index) => {
    const left = safeBins.length === 0 ? 0 : (index / safeBins.length) * 100;
    const edgeClass = index === 0
      ? ' is-start'
      : index === boundaryValues.length - 1
        ? ' is-end'
        : '';
    return `<span class="${className}${edgeClass}" style="left:${left}%;">${formatNumericValue(value)}</span>`;
  }).join('');
}

function buildNumericHistogramChartHtml(histogram, options = {}) {
  const {
    maxBinCount = histogram.maxBinCount || 0,
    groupLabel = '',
    numberUnit = ''
  } = options;
  const hasValues = Array.isArray(histogram.bins) && histogram.bins.length > 0 && histogram.n > 0;
  if (!hasValues) {
    return '<div class="result-empty">표시할 수치 응답이 없습니다.</div>';
  }
  const yAxisConfig = getNumericYAxisConfig(maxBinCount || 0);
  const axisMaxCount = yAxisConfig.axisMax || 1;
  const gridLinesHtml = yAxisConfig.ticks
    .filter(value => value > 0 && value <= axisMaxCount)
    .map(value => {
      const rawY = 100 - ((value / axisMaxCount) * 100);
      const y = value === axisMaxCount ? 0.5 : rawY;
      return `<line class="numeric-open-gridline" x1="0" y1="${y}" x2="100" y2="${y}"></line>`;
    }).join('');
  const binWidth = 100 / histogram.bins.length;
  const gap = Math.min(0.18, binWidth * 0.06);
  const barWidth = Math.max(0.2, binWidth - gap);
  const barsHtml = histogram.bins.map((bin, index) => {
    const heightPct = axisMaxCount > 0 ? Math.max(0, Math.min(100, (bin.count / axisMaxCount) * 100)) : 0;
    const visibleHeight = bin.count > 0 ? Math.max(1.2, heightPct) : 0.6;
    const x = (index * binWidth) + (gap / 2);
    const tip = encodeURIComponent(JSON.stringify({
      kind: 'numeric-hist-bin',
      groupLabel,
      rangeLabel: bin.start === bin.end
        ? `${formatNumericValue(bin.start)}`
        : `${formatNumericValue(bin.start)} - ${formatNumericValue(bin.end)}`,
      pct: bin.pct,
      count: bin.count
    }));
    return `
      <div class="numeric-open-bar ${bin.count > 0 ? '' : 'is-empty'}"
           style="left:${x.toFixed(3)}%; width:${barWidth.toFixed(3)}%; height:${visibleHeight.toFixed(3)}%; background:${SINGLE_BAR_COLOR};"
           data-tip="${tip}"
           aria-label="구간 ${index + 1}"></div>
    `;
  }).join('');
  const axisLabelsHtml = buildNumericBoundaryAxisLabelsHtml(histogram.bins, histogram.domainMax, 'numeric-open-axis-label');
  const yAxisLabelsHtml = yAxisConfig.ticks.map(value => {
    const bottom = axisMaxCount > 0 ? (value / axisMaxCount) * 100 : 0;
    return `<span class="numeric-open-y-axis-label" style="bottom:${bottom}%;">${value.toLocaleString()}</span>`;
  }).join('');
  const meanTip = encodeURIComponent(JSON.stringify({
    kind: 'numeric-mean',
    groupLabel,
    mean: histogram.mean,
    totalN: histogram.n,
    unit: numberUnit
  }));
  const statMarkersHtml = buildNumericQuartileMarkersHtml(histogram, numberUnit, groupLabel);
  const footerHtml = `
    <div class="numeric-open-footer">
      <div class="numeric-open-note">구간 기준: 시작값 이상, 다음 경계값 미만입니다. 마지막 구간은 최댓값을 포함합니다.</div>
      <div class="numeric-open-unit">${numberUnit ? `단위 : ${escapeHtml(numberUnit)}` : ''}</div>
    </div>
  `;
  return `
    <div class="numeric-open-chart">
      <div class="numeric-open-plot">
        <svg class="numeric-open-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          ${gridLinesHtml}
          <line class="numeric-open-baseline" x1="0" y1="100" x2="100" y2="100"></line>
        </svg>
        <div class="numeric-open-y-axis">${yAxisLabelsHtml}</div>
        <div class="numeric-open-bars">${barsHtml}</div>
        <div class="numeric-open-stat-layer">${statMarkersHtml}</div>
        <div class="numeric-open-mean-layer">
          ${histogram.meanLeftPct === null ? '' : `
          <div class="numeric-open-mean-marker" style="left:${histogram.meanLeftPct}%;">
            <div class="numeric-open-mean-pill" data-tip="${meanTip}">평균 ${formatNumericMeanDisplay(histogram.mean, numberUnit)}</div>
            <div class="numeric-open-mean-line"></div>
          </div>
        `}
        </div>
        <div class="numeric-open-axis">${axisLabelsHtml}</div>
      </div>
      ${footerHtml}
    </div>
  `;
}

function buildNumericOpenBoxChartHtml(data) {
  const numberUnit = data.codebookEntry && data.codebookEntry.numberUnit ? data.codebookEntry.numberUnit : '';
  const axisLabelsHtml = buildNumericBoundaryAxisLabelsHtml(data.bins, data.domainMax, 'numeric-whisker-axis-label');
  const footerHtml = `
    <div class="numeric-open-footer">
      <div class="numeric-open-note">수염은 최소~최대, 박스는 Q1~Q3, 세로선은 중앙값, 점은 평균입니다.</div>
      <div class="numeric-open-unit">${numberUnit ? `단위 : ${escapeHtml(numberUnit)}` : ''}</div>
    </div>
  `;
  return `
    <div class="numeric-open-summary-whisker">
      <div class="numeric-open-summary-body">
        ${buildNumericWhiskerTrackHtml(data, data.domainMin, data.domainMax, numberUnit, '응답자 전체')}
        <div class="numeric-whisker-axis">${axisLabelsHtml}</div>
        <div class="numeric-open-stat-layer">${buildNumericQuartileMarkersHtml(data, numberUnit, '응답자 전체')}</div>
      </div>
      ${footerHtml}
    </div>
  `;
}

function buildNumericOpenGroupChartHtml(data, hiddenGroups) {
  const displayGroups = getDisplayGroupResults(data.groupResults, hiddenGroups);
  if (displayGroups.length === 0) {
    return '<div class="result-empty">표시할 그룹이 없습니다.</div>';
  }
  const numberUnit = data.codebookEntry && data.codebookEntry.numberUnit ? data.codebookEntry.numberUnit : '';
  const criterionLabel = data.criterionLabel || '';
  const overallTrackHtml = buildNumericWhiskerTrackHtml(data, data.domainMin, data.domainMax, numberUnit, '응답자 전체');
  const overallRowHtml = `
    <div class="numeric-whisker-row total-row">
      <div class="numeric-whisker-label">응답자 전체</div>
      <div class="numeric-whisker-main">
        ${overallTrackHtml}
      </div>
    </div>
  `;
  const groupRowsHtml = displayGroups.map(group => {
    const groupLabel = criterionLabel ? `${criterionLabel}: ${group.value}` : group.label;
    const color = getGroupColor(data.groupResults, group.value);
    const trackHtml = buildNumericWhiskerTrackHtml(group, data.domainMin, data.domainMax, numberUnit, groupLabel, { boxColor: color });
    return `
      <div class="numeric-whisker-row">
        <div class="numeric-whisker-label">${escapeHtml(groupLabel)}</div>
        <div class="numeric-whisker-main">
          ${trackHtml}
        </div>
      </div>
    `;
  }).join('');
  const rowHtml = overallRowHtml + groupRowsHtml;
  const axisLabelsHtml = buildNumericBoundaryAxisLabelsHtml(data.bins, data.domainMax, 'numeric-whisker-axis-label');
  const footerHtml = `
    <div class="numeric-open-footer">
      <div class="numeric-open-note">수염은 최소~최대, 박스는 Q1~Q3, 세로선은 중앙값, 점은 평균입니다.</div>
      <div class="numeric-open-unit">${numberUnit ? `단위 : ${escapeHtml(numberUnit)}` : ''}</div>
    </div>
  `;
  return `
    <div class="numeric-whisker-chart">
      <div class="numeric-whisker-rows">${rowHtml}</div>
      <div class="numeric-whisker-axis">${axisLabelsHtml}</div>
      ${footerHtml}
    </div>
  `;
}

function buildNumericOpenSection(data) {
  if (!data) return '';
  const { codebookEntry, targetLabel, groupResults } = data;
  const hiddenGroups = resultState.hiddenGroupKeys.get(targetLabel) || new Set();
  const viewMode = groupResults ? 'box' : (resultState.numericOpenViewModes.get(targetLabel) || 'histogram');
  const chartHtml = groupResults
    ? buildNumericOpenGroupChartHtml(data, hiddenGroups)
    : viewMode === 'box'
      ? buildNumericOpenBoxChartHtml(data)
      : buildNumericHistogramChartHtml(data, {
          maxBinCount: data.maxBinCount,
          numberUnit: codebookEntry && codebookEntry.numberUnit
        });
  const tableHtml = buildDataTableHtml(data, hiddenGroups);
  const fullText = buildQuestionFullHtml(codebookEntry);
  const controlsHtml = buildNumericOpenControlsHtml(targetLabel, data.interval, data.start, !!groupResults, viewMode);
  const legendHtml = groupResults ? buildLegendHtml(data, hiddenGroups) : '<aside class="legend-panel" aria-hidden="true"></aside>';
  return `
    <section class="result-section" data-target="${escapeHtml(targetLabel)}" data-type="numeric-open">
      <div class="result-header">
        <div class="result-title">${escapeHtml(targetLabel)}</div>
        ${fullText}
        ${controlsHtml}
      </div>
      <div class="result-visual has-legend numeric-open-visual">
        <div class="result-chart-col">${chartHtml}</div>
        ${legendHtml}
      </div>
      ${tableHtml}
    </section>
  `;
}

function buildScaleGroupRowHtml(group, maxScore, viewMode, hideMidpoint) {
  const meanTip = {
    kind: 'scale-mean',
    mean: group.mean,
    totalN: group.n,
    groupLabel: group.label
  };
  const chartHtml = viewMode === 'mean'
    ? buildScaleMeanOnlyHtml(group.mean, maxScore, meanTip, group.scoreResults, { hideMidpoint })
    : buildScaleDistributionBarHtml(group.scoreResults, maxScore, { hideMidpoint });
  return `
    <div class="scale-group-row">
      <div class="scale-group-label">
        <strong>${escapeHtml(group.label)}</strong>
      </div>
      <div class="scale-group-chart-cell">
        ${chartHtml}
      </div>
    </div>
  `;
}

function buildDerivedScaleGroupRowHtml(group, scoreRange, viewMode) {
  const chartData = {
    values: group.values || [],
    totalN: group.n,
    n: group.n,
    mean: group.mean,
    min: group.min,
    q1: group.q1,
    median: group.median,
    q3: group.q3,
    max: group.max,
    scoreRange
  };
  return `
    <div class="scale-group-row">
      <div class="scale-group-label">
        <strong>${escapeHtml(group.label)}</strong>
      </div>
      <div class="scale-group-chart-cell">
        ${buildDerivedScaleViolinHtml(chartData, viewMode)}
      </div>
    </div>
  `;
}

function buildScaleGroupChartHtml(data, hiddenGroups, viewMode) {
  const displayGroups = getDisplayGroupResults(data.groupResults, hiddenGroups);
  const maxScore = data.scoreRange.length;
  const hideMidpoint = isScaleMidpointHidden(data.targetLabel);
  if (data.isDerivedScale) {
    return `
      <div class="scale-group-chart">
        ${displayGroups.length === 0 ? '<div class="result-empty">표시할 그룹이 없습니다.</div>' : displayGroups.map(group => buildDerivedScaleGroupRowHtml(group, data.scoreRange, viewMode)).join('')}
      </div>
    `;
  }
  return `
    <div class="scale-group-chart">
      ${displayGroups.length === 0 ? '<div class="result-empty">표시할 그룹이 없습니다.</div>' : displayGroups.map(group => buildScaleGroupRowHtml(group, maxScore, viewMode, hideMidpoint)).join('')}
    </div>
  `;
}

function buildScaleChartHtml(data, hiddenGroups, viewMode) {
  const maxScore = data.scoreRange.length;
  const hideMidpoint = isScaleMidpointHidden(data.targetLabel);
  if (data.groupResults) return buildScaleGroupChartHtml(data, hiddenGroups, viewMode);
  if (data.isDerivedScale) return buildDerivedScaleViolinHtml(data, viewMode);
  const meanTip = {
    kind: 'scale-mean',
    mean: data.mean,
    totalN: data.totalN
  };
  const chartHtml = viewMode === 'mean'
    ? buildScaleMeanOnlyHtml(data.mean, maxScore, meanTip, data.scoreResults, { hideMidpoint })
    : buildScaleDistributionBarHtml(data.scoreResults, maxScore, { hideMidpoint });
  return `<div class="scale-chart">${chartHtml}</div>`;
}

function buildDerivedScaleDataTableHtml(data, hiddenGroups = new Set()) {
  if (!data.groupResults) {
    const tableHtml = `
      <table class="result-table derived-scale-table">
        <thead>
          <tr>
            <th>구분</th>
            <th class="num metric">평균</th>
            <th class="num metric">최소</th>
            <th class="num metric">Q1(하위 25%)</th>
            <th class="num metric">Q2(중앙값)</th>
            <th class="num metric">Q3(상위 25%)</th>
            <th class="num metric">최대</th>
            <th class="num respondents">응답자 수 (명)</th>
          </tr>
        </thead>
        <tbody>
          <tr class="total-row">
            <td>응답자 전체</td>
            <td class="num metric mean-value">${data.mean.toFixed(2)}점</td>
            <td class="num metric">${data.min.toFixed(2)}</td>
            <td class="num metric">${data.q1.toFixed(2)}</td>
            <td class="num metric">${data.median.toFixed(2)}</td>
            <td class="num metric">${data.q3.toFixed(2)}</td>
            <td class="num metric">${data.max.toFixed(2)}</td>
            <td class="num respondents">${data.totalN.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
    `;
    return wrapResultTable(tableHtml);
  }

  const displayGroups = getDisplayGroupResults(data.groupResults, hiddenGroups);
  const rowsHtml = [
    {
      label: '응답자 전체',
      n: data.totalN,
      mean: data.mean,
      min: data.min,
      q1: data.q1,
      median: data.median,
      q3: data.q3,
      max: data.max,
      total: true
    },
    ...displayGroups.map(group => ({
      label: group.label,
      n: group.n,
      mean: group.mean,
      min: group.min,
      q1: group.q1,
      median: group.median,
      q3: group.q3,
      max: group.max
    }))
  ].map(row => `
    <tr class="${row.total ? 'total-row' : ''}">
      <td>${escapeHtml(row.label)}</td>
      <td class="num metric mean-value">${Number(row.mean || 0).toFixed(2)}점</td>
      <td class="num metric">${Number(row.min || 0).toFixed(2)}</td>
      <td class="num metric">${Number(row.q1 || 0).toFixed(2)}</td>
      <td class="num metric">${Number(row.median || 0).toFixed(2)}</td>
      <td class="num metric">${Number(row.q3 || 0).toFixed(2)}</td>
      <td class="num metric">${Number(row.max || 0).toFixed(2)}</td>
      <td class="num respondents">${Number(row.n || 0).toLocaleString()}</td>
    </tr>
  `).join('');
  const tableHtml = `
    <table class="result-table derived-scale-table">
      <thead>
        <tr>
          <th>구분</th>
          <th class="num metric">평균</th>
          <th class="num metric">최소</th>
          <th class="num metric">Q1(하위 25%)</th>
          <th class="num metric">Q2(중앙값)</th>
          <th class="num metric">Q3(상위 25%)</th>
          <th class="num metric">최대</th>
          <th class="num respondents">응답자 수 (명)</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  return wrapResultTable(tableHtml);
}

function buildScaleDataTableHtml(data, hiddenGroups = new Set()) {
  if (data.isDerivedScale) return buildDerivedScaleDataTableHtml(data, hiddenGroups);
  if (!data.groupResults) {
    const rowsHtml = data.scoreResults.map(result => `
      <tr>
        <td>${formatScaleScoreLabel(result)}</td>
        <td class="num">${formatPercent(result.pct)}</td>
        <td class="num">${result.count.toLocaleString()}</td>
        <td class="num">-</td>
      </tr>
    `).join('');
    const tableHtml = `
      <table class="result-table">
        <thead>
          <tr>
            <th>점수 / 라벨</th>
            <th class="num">비율(%)</th>
            <th class="num">빈도수 (명)</th>
            <th class="num">평균</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr class="total-row">
            <td>합계</td>
            <td class="num">${formatPercent(100)}</td>
            <td class="num">${data.totalN.toLocaleString()}</td>
            <td class="num">${data.mean.toFixed(2)}점</td>
          </tr>
        </tbody>
      </table>
    `;
    return wrapResultTable(tableHtml);
  }

  const displayGroups = getDisplayGroupResults(data.groupResults, hiddenGroups);
  const topRow = [
    `<th rowspan="2">점수 / 라벨</th>`,
    buildGroupedCountHeader('응답자 전체', data.totalN, 3),
    ...displayGroups.map(group => buildGroupedCountHeader(group.label, group.n, 3))
  ].join('');
  const subRow = [
    `<th class="num group-col">비율(%)</th><th class="num">빈도수 (명)</th><th class="num">평균</th>`,
    ...displayGroups.map(() => `<th class="num group-col">비율(%)</th><th class="num">빈도수 (명)</th><th class="num">평균</th>`)
  ].join('');
    const bodyRows = data.scoreResults.map(result => {
      const groupCells = displayGroups.map(group => {
        const groupResult = group.scoreResults.find(item => item.score === result.score) || { pct: 0, count: 0 };
        return `<td class="num group-col">${formatPercent(groupResult.pct)}</td><td class="num">${groupResult.count.toLocaleString()}</td><td class="num">-</td>`;
      }).join('');
      return `
        <tr>
        <td>${formatScaleScoreLabel(result)}</td>
        <td class="num group-col">${formatPercent(result.pct)}</td>
        <td class="num">${result.count.toLocaleString()}</td>
        <td class="num">-</td>
        ${groupCells}
      </tr>
    `;
  }).join('');
  const totalCells = displayGroups.map(group => `<td class="num group-col">${formatPercent(100)}</td><td class="num">${group.n.toLocaleString()}</td><td class="num">${group.mean.toFixed(2)}점</td>`).join('');
  const tableHtml = `
    <table class="result-table">
      <thead>
        <tr>${topRow}</tr>
        <tr>${subRow}</tr>
      </thead>
      <tbody>
        ${bodyRows}
        <tr class="total-row">
          <td>합계</td>
          <td class="num group-col">${formatPercent(100)}</td>
          <td class="num">${data.totalN.toLocaleString()}</td>
          <td class="num">${data.mean.toFixed(2)}점</td>
          ${totalCells}
        </tr>
      </tbody>
    </table>
  `;
  return wrapResultTable(tableHtml);
}

function buildNumericOpenDataTableHtml(data, hiddenGroups = new Set()) {
  const unit = data.codebookEntry && data.codebookEntry.numberUnit ? data.codebookEntry.numberUnit : '';
  const rows = data.groupResults
    ? [
        {
          label: '응답자 전체',
          total: true,
          n: data.totalN,
          mean: data.mean,
          min: data.min,
          q1: data.q1,
          median: data.median,
          q3: data.q3,
          max: data.max
        },
        ...getDisplayGroupResults(data.groupResults, hiddenGroups).map(group => ({
          label: group.label,
          n: group.n,
          mean: group.mean,
          min: group.min,
          q1: group.q1,
          median: group.median,
          q3: group.q3,
          max: group.max
        }))
      ]
    : [{
        label: '응답자 전체',
        total: true,
        n: data.totalN,
        mean: data.mean,
        min: data.min,
        q1: data.q1,
        median: data.median,
        q3: data.q3,
        max: data.max
      }];
  const rowsHtml = rows.map(row => `
    <tr class="${row.total ? 'total-row' : ''}">
      <td>${escapeHtml(row.label)}</td>
      <td class="num metric mean-value">${formatNumericMeanDisplay(row.mean, unit)}</td>
      <td class="num metric">${formatNumericValue(row.min)}</td>
      <td class="num metric">${formatNumericValue(row.q1)}</td>
      <td class="num metric">${formatNumericValue(row.median)}</td>
      <td class="num metric">${formatNumericValue(row.q3)}</td>
      <td class="num metric">${formatNumericValue(row.max)}</td>
      <td class="num respondents">${Number(row.n || 0).toLocaleString()}</td>
    </tr>
  `).join('');
  const tableHtml = `
    <table class="result-table derived-scale-table">
      <thead>
        <tr>
          <th>구분</th>
          <th class="num metric">평균</th>
          <th class="num metric">최소</th>
          <th class="num metric">Q1 (하위 25%)</th>
          <th class="num metric">Q2 (중앙값)</th>
          <th class="num metric">Q3 (상위 25%)</th>
          <th class="num metric">최대</th>
          <th class="num respondents">응답자 수 (명)</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  return wrapResultTable(tableHtml);
}

function buildDataTableHtml(data, hiddenGroups = new Set()) {
  if (data.visualType === 'rank') return buildRankDataTableHtml(data, hiddenGroups);
  if (data.visualType === 'scale') return buildScaleDataTableHtml(data, hiddenGroups);
  if (data.visualType === 'numeric-open') return buildNumericOpenDataTableHtml(data, hiddenGroups);
  return buildChoiceDataTableHtml(data);
}

/* =========================================================
   [객관식 순위] 집계 / 렌더
   ========================================================= */

// 원 문항 라벨에서 순위별 expanded 컬럼 목록을 찾는다
// pattern: `${targetLabel}__N순위`
function findRankExpandedColumns(targetLabel) {
  const headerMap = filterState.headerMap;
  if (!headerMap) return [];
  const cols = [];
  for (let n = 1; n <= 30; n++) {
    const name = `${targetLabel}__${n}순위`;
    const idx = headerMap.get(name);
    if (idx === undefined) break;
    cols.push({ rank: n, label: name, colIdx: idx });
  }
  return cols;
}

function aggregateRank(targetLabel, criterionLabel, rows) {
  const entry = resultState.codebookByLabel.get(targetLabel);
  if (!entry) return null;
  const rawIdx = filterState.headerMap ? filterState.headerMap.get(targetLabel) : undefined;

  const rankCols = findRankExpandedColumns(targetLabel);
  if (rankCols.length === 0) return null;
  const rankCount = rankCols.length;

  const optionOrder = [...entry.options];
  const optionSet = new Set(optionOrder);
  // perRankCount[rankIdx][option] = count
  const perRankCount = rankCols.map(() => {
    const m = {};
    optionOrder.forEach(o => { m[o] = 0; });
    return m;
  });
  // respondent coverage (raw 또는 any rank filled)
  let respondentN = 0;

  rows.forEach(row => {
    const raw = rawIdx !== undefined ? cleanCell((row || [])[rawIdx]) : '';
    let touched = false;
    rankCols.forEach((rc, ri) => {
      const v = cleanCell(row[rc.colIdx]);
      if (v === '') return;
      if (!optionSet.has(v)) {
        optionSet.add(v);
        optionOrder.push(v);
        perRankCount.forEach(m => { if (m[v] === undefined) m[v] = 0; });
      }
      perRankCount[ri][v] = (perRankCount[ri][v] || 0) + 1;
      touched = true;
    });
    if (touched || raw !== '') respondentN += 1;
  });

  // weighted score: rank i (1-indexed) 는 (rankCount - i + 1)점
  // 종합 순위 판정에 사용
  const weightedScore = {};
  optionOrder.forEach(o => {
    weightedScore[o] = 0;
    rankCols.forEach((rc, ri) => {
      const w = rankCount - ri;
      weightedScore[o] += (perRankCount[ri][o] || 0) * w;
    });
  });

  const rawOnlyCount = {};
  optionOrder.forEach(o => { rawOnlyCount[o] = 0; });
  if (rawIdx !== undefined) {
    rows.forEach(row => {
      const raw = cleanCell((row || [])[rawIdx]);
      if (!raw || raw.includes('|')) return;
      if (!Object.prototype.hasOwnProperty.call(rawOnlyCount, raw)) return;
      const hasRank = rankCols.some((rc) => cleanCell((row || [])[rc.colIdx]) !== '');
      if (!hasRank) rawOnlyCount[raw] += 1;
    });
  }

  // 0건인 보기는 숨김하되, raw 단독 응답은 순위가 없어도 유지합니다.
  const nonzeroOptionOrder = optionOrder.filter(o => {
    const hasRankCount = rankCols.some((_, ri) => (perRankCount[ri][o] || 0) > 0);
    return hasRankCount || (rawOnlyCount[o] || 0) > 0;
  });
  const visibleOptionOrder = optionOrder.filter(o => {
    if (isOtherOption(o)) return false;
    return rankCols.some((_, ri) => (perRankCount[ri][o] || 0) > 0);
  });

  // 종합 순위 계산 (내림차순, 동률이면 공동 순위)
  const sortedVisible = [...visibleOptionOrder].sort((a, b) => weightedScore[b] - weightedScore[a]);
  const ranking = [];
  let currentPos = 0;
  let lastScore = null;
  let seen = 0;
  sortedVisible.forEach(opt => {
    seen += 1;
    const sc = weightedScore[opt];
    if (lastScore === null || sc !== lastScore) {
      currentPos = seen;
      lastScore = sc;
    }
    ranking.push({ option: opt, position: currentPos, score: sc });
  });

  // per-option, per-rank 비율 표 데이터
  // basis: 순위별 응답자 수가 아니라 전체 응답자 수(respondentN)
  const totalResults = nonzeroOptionOrder.map(opt => {
    const perRank = rankCols.map((rc, ri) => {
      const c = perRankCount[ri][opt] || 0;
      const pct = respondentN > 0 ? (c / respondentN) * 100 : 0;
      return { rank: rc.rank, count: c, pct };
    });
    return {
      option: opt,
      score: weightedScore[opt],
      perRank,
      totalPct: perRank.reduce((s, r) => s + r.pct, 0) + (respondentN > 0 ? ((rawOnlyCount[opt] || 0) / respondentN) * 100 : 0),
      totalCount: perRank.reduce((s, r) => s + r.count, 0) + (rawOnlyCount[opt] || 0)
    };
  });

  // 그룹별 비교
  let groupResults = null;
  if (criterionLabel) {
    const critEntry = getCriterionEntry(criterionLabel);
    const cIdx = filterState.headerMap.get(criterionLabel);
    if (critEntry && cIdx !== undefined) {
      const groupOrder = [...critEntry.options];
      const groupSet = new Set(groupOrder);
      // per-group per-rank count
      const byGroup = new Map();
      const makeBucket = () => ({
        n: 0,
        perRankCount: rankCols.map(() => Object.fromEntries(optionOrder.map(o => [o, 0])))
      });
      groupOrder.forEach(gv => byGroup.set(gv, makeBucket()));

      rows.forEach(row => {
        const gv = cleanCell(row[cIdx]);
        if (gv === '') return;
        if (!groupSet.has(gv)) {
          groupSet.add(gv);
          groupOrder.push(gv);
          byGroup.set(gv, makeBucket());
        }
        const bucket = byGroup.get(gv);
        const raw = rawIdx !== undefined ? cleanCell((row || [])[rawIdx]) : '';
        let touched = false;
        rankCols.forEach((rc, ri) => {
          const v = cleanCell(row[rc.colIdx]);
          if (v === '') return;
          if (!optionSet.has(v)) {
            optionSet.add(v);
            optionOrder.push(v);
            byGroup.forEach(b => {
              b.perRankCount.forEach(m => { if (m[v] === undefined) m[v] = 0; });
            });
          }
          bucket.perRankCount[ri][v] = (bucket.perRankCount[ri][v] || 0) + 1;
          touched = true;
        });
        if (touched || raw !== '') bucket.n += 1;
      });

      groupResults = groupOrder.map(gv => {
        const bucket = byGroup.get(gv);
        const gRawOnlyCount = {};
        nonzeroOptionOrder.forEach(opt => { gRawOnlyCount[opt] = 0; });
        if (rawIdx !== undefined) {
          rows.forEach(row => {
            const rowGroup = cleanCell((row || [])[cIdx]);
            if (rowGroup !== gv) return;
            const raw = cleanCell((row || [])[rawIdx]);
            if (!raw || raw.includes('|')) return;
            if (!Object.prototype.hasOwnProperty.call(gRawOnlyCount, raw)) return;
            const hasRank = rankCols.some((rc) => cleanCell((row || [])[rc.colIdx]) !== '');
            if (!hasRank) gRawOnlyCount[raw] += 1;
          });
        }
        // group 내부 가중 점수
        const gScore = {};
        visibleOptionOrder.forEach(opt => {
          gScore[opt] = 0;
          rankCols.forEach((rc, ri) => {
            const w = rankCount - ri;
            gScore[opt] += (bucket.perRankCount[ri][opt] || 0) * w;
          });
        });
        const gSorted = [...visibleOptionOrder].sort((a, b) => gScore[b] - gScore[a]);
        const gRanking = [];
        let pos = 0; let last = null; let n = 0;
        gSorted.forEach(opt => {
          n += 1;
          const sc = gScore[opt];
          if (last === null || sc !== last) { pos = n; last = sc; }
          gRanking.push({ option: opt, position: pos, score: sc });
        });
        const gPerOption = nonzeroOptionOrder.map(opt => ({
          option: opt,
          score: gScore[opt],
          totalCount: rankCols.reduce((sum, _rc, ri) => sum + (bucket.perRankCount[ri][opt] || 0), 0) + (gRawOnlyCount[opt] || 0),
          perRank: rankCols.map((rc, ri) => {
            const c = bucket.perRankCount[ri][opt] || 0;
            const pct = bucket.n > 0 ? (c / bucket.n) * 100 : 0;
            return { rank: rc.rank, count: c, pct };
          })
        }));
        return {
          value: gv,
          label: `${critEntry.label}: ${gv}`,
          n: bucket.n,
          ranking: gRanking,
          perOption: gPerOption
        };
      });
    }
  }

  return {
    targetLabel,
    codebookEntry: entry,
    rankCount,
    rankLabels: rankCols.map(rc => `${rc.rank}순위`),
    respondentN,
    optionOrder: visibleOptionOrder,
    totalResults,
    ranking,
    visualType: 'rank',
    criterionLabel: groupResults ? criterionLabel : null,
    groupResults
  };
}

function buildRankSummaryHtml(data) {
  if (!data.ranking || data.ranking.length === 0) return '';
  const tokens = data.ranking.map((r, i) => {
    const prev = i > 0 ? data.ranking[i - 1] : null;
    const sepHtml = prev
      ? `<span class="rank-sep">${prev.position === r.position ? '=' : '&gt;'}</span>`
      : '';
    return `${sepHtml}<span class="rank-token"><span class="rank-pos">${r.position}위</span><span class="rank-opt">${escapeHtml(r.option)}</span></span>`;
  }).join('');
  return `
    <div class="rank-summary">
      <div class="rank-summary-line">
        <div class="rank-summary-title">종합 순위</div>
        <div>${tokens}</div>
      </div>
    </div>
  `;
}

function buildRankStackChartHtml(data, hiddenRanks) {
  const rows = data.totalResults;
  const rankLabels = data.rankLabels;
  const rowHtml = rows.map(r => {
    const labelTip = encodeURIComponent(JSON.stringify({
      kind: 'option-label',
      option: r.option
    }));
    const rankedCount = r.perRank.reduce((s, pr) => s + (pr.count || 0), 0);
    const nonRankedCount = Math.max(0, (r.totalCount || 0) - rankedCount);
    const nonRankedPct = Math.max(0, (r.totalPct || 0) - r.perRank.reduce((s, pr) => s + (pr.pct || 0), 0));
    const segments = r.perRank.map((pr, ri) => {
      if (hiddenRanks.has(ri)) return '';
      const w = Math.max(0, pr.pct);
      if (w <= 0) return '';
      const color = rankColor(ri);
      const tip = encodeURIComponent(JSON.stringify({
        kind: 'rank-seg',
        option: r.option,
        rankLabel: rankLabels[ri],
        pct: pr.pct,
        count: pr.count
      }));
      return `<div class="rank-stack-seg"
                   style="width:${w}%; background:${color};"
                   data-tip="${tip}"></div>`;
    }).join('');
    const visiblePct = r.perRank.reduce((s, pr, ri) => s + (hiddenRanks.has(ri) ? 0 : pr.pct), 0);
    const fallbackWidth = Math.max(0, Math.min(100, nonRankedPct));
    const fallbackTip = encodeURIComponent(JSON.stringify({
      kind: 'rank-nonranked',
      option: r.option,
      rankLabel: '비순위 응답',
      pct: nonRankedPct,
      count: nonRankedCount
    }));
    const trackHtml = segments || (fallbackWidth > 0
      ? `<div class="rank-stack-seg" style="width:${fallbackWidth}%; background:#b88383;" data-tip="${fallbackTip}"></div>`
      : '');
    return `
      <div class="rank-stack-row">
        <div class="rank-stack-label" title="${escapeHtml(r.option)}" data-tip="${labelTip}">${escapeHtml(r.option)}</div>
        <div class="rank-stack-track">${trackHtml}</div>
        <div class="hbar-value rank-stack-value">${formatPercent(segments ? visiblePct : nonRankedPct)}</div>
      </div>
    `;
  }).join('');
  return `<div class="rank-stack-chart">${rowHtml}</div>`;
}

function buildRankLegendHtml(data, hiddenRanks) {
  const items = data.rankLabels.map((lab, ri) => {
    const isHidden = hiddenRanks.has(ri);
    const color = rankColor(ri);
    return `
      <label class="legend-item ${isHidden ? 'disabled' : ''}" data-rank="${ri}">
        <input type="checkbox" ${isHidden ? '' : 'checked'}>
        <span class="legend-swatch" style="background:${color}"></span>
        <span>${escapeHtml(lab)}</span>
      </label>
    `;
  }).join('');
  return `
    <aside class="legend-panel">
      <div class="legend" data-target="${escapeHtml(data.targetLabel)}" data-mode="rank">${items}</div>
      <div class="legend-actions" data-target="${escapeHtml(data.targetLabel)}" data-mode="rank">
        <button type="button" class="legend-action-btn" data-legend-action="all-on">전체 선택</button>
        <button type="button" class="legend-action-btn" data-legend-action="all-off">전체 해제</button>
      </div>
    </aside>
  `;
}

function buildRankGroupLegendHtml(data, hiddenGroups) {
  if (!data.groupResults) return '';
  const items = data.groupResults.map((g, i) => {
    const color = GROUP_PALETTE[i % GROUP_PALETTE.length];
    const isHidden = hiddenGroups.has(g.value);
    return `
      <label class="legend-item ${isHidden ? 'disabled' : ''}" data-group="${escapeHtml(g.value)}">
        <input type="checkbox" ${isHidden ? '' : 'checked'}>
        <span class="legend-swatch" style="background:${color}"></span>
        <span>${escapeHtml(g.label)}</span>
      </label>
    `;
  }).join('');
  return `
    <aside class="legend-panel">
      <div class="legend" data-target="${escapeHtml(data.targetLabel)}" data-mode="group">${items}</div>
      <div class="legend-actions" data-target="${escapeHtml(data.targetLabel)}" data-mode="group">
        <button type="button" class="legend-action-btn" data-legend-action="all-on">전체 선택</button>
        <button type="button" class="legend-action-btn" data-legend-action="all-off">전체 해제</button>
      </div>
    </aside>
  `;
}

function buildRankGroupTextHtml(data, hiddenGroups) {
  if (!data.groupResults) return '';
  const displayGroups = data.groupResults.filter(g => !hiddenGroups.has(g.value));
  if (displayGroups.length === 0) return '';
  const groupedRankings = displayGroups.map(g => {
    const groups = [];
    (g.ranking || []).forEach(item => {
      const last = groups[groups.length - 1];
      if (last && last.position === item.position) {
        last.items.push(item);
      } else {
        groups.push({ position: item.position, items: [item] });
      }
    });
    return { group: g, rankGroups: groups };
  });
  const displayRankCount = groupedRankings.reduce((max, entry) => Math.max(max, entry.rankGroups.length), 0);
  const headCells = [
    `<th>그룹</th>`,
    ...Array.from({ length: displayRankCount }, (_, i) => `<th>${i + 1}위</th>`)
  ].join('');
  const bodyRows = groupedRankings.map(({ group, rankGroups }) => {
    const rankCells = Array.from({ length: displayRankCount }, (_, i) => {
      const rankGroup = rankGroups[i];
      const label = rankGroup
        ? rankGroup.items.map(item => escapeHtml(item.option)).join(' / ')
        : '-';
      return `<td>${label}</td>`;
    }).join('');
    return `
      <tr>
        <td class="group-name">${escapeHtml(group.label)}</td>
        ${rankCells}
      </tr>
    `;
  }).join('');
  return `
    <div class="rank-group-panel">
      <div class="rank-group-heading">
        <div class="rank-summary-title">그룹별 순위</div>
      </div>
      <div class="rank-group-table-wrap">
        <table class="rank-group-table">
          <thead><tr>${headCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function buildRankDataTableHtml(data, hiddenGroups = new Set()) {
  const { totalResults, rankLabels, groupResults, respondentN } = data;
  if (!groupResults) {
    const topRow = [
      `<th rowspan="2">응답 보기</th>`,
      ...rankLabels.map(lab => `<th colspan="2" class="group-head">${escapeHtml(lab)}</th>`),
      `<th rowspan="2" class="num group-col">가중 점수</th>`,
      `<th rowspan="2" class="num">종합 순위</th>`
    ].join('');
    const subRow = [
      ...rankLabels.map(() => `<th class="num group-col">비율(%)</th><th class="num">빈도수 (명)</th>`)
    ].join('');
    const bodyRows = totalResults.map(r => {
      const rankObj = data.ranking.find(rk => rk.option === r.option);
      const pos = rankObj ? rankObj.position : '-';
      const rankCells = r.perRank.map(pr => `<td class="num">${formatPercent(pr.pct)}</td><td class="num">${pr.count.toLocaleString()}</td>`).join('');
      return `
        <tr>
          <td>${renderTableOptionLabel(r.option, data.targetLabel)}</td>
          ${rankCells}
          <td class="num">${rankObj ? r.score.toLocaleString() : '-'}</td>
          <td class="num">${pos === '-' ? '-' : `${pos}위`}</td>
        </tr>
      `;
    }).join('');
    const totalRankCells = rankLabels.map((_, ri) => {
      const totalCount = totalResults.reduce((sum, result) => sum + ((result.perRank[ri] && result.perRank[ri].count) || 0), 0);
      const totalPct = respondentN > 0 ? (totalCount / respondentN) * 100 : 0;
      return `<td class="num">${formatPercent(totalPct)}</td><td class="num">${totalCount.toLocaleString()}</td>`;
    }).join('');
    const tableHtml = `
      <table class="result-table">
        <thead>
          <tr>${topRow}</tr>
          <tr>${subRow}</tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="total-row">
            <td>합계</td>
            ${totalRankCells}
            <td class="num">-</td>
            <td class="num">-</td>
          </tr>
        </tbody>
      </table>
    `;
    return wrapResultTable(
      tableHtml,
      `<div class="result-table-note">가중 점수는 상위 순위에 더 큰 가중치를 주는 방식으로 계산합니다. 1순위 응답 건수에는 ${data.rankCount}점을, 2순위에는 ${Math.max(data.rankCount - 1, 0)}점을 부여하는 식으로 내려가며 합산합니다.</div>`
    );
  }

  const displayGroups = getDisplayGroupResults(groupResults, hiddenGroups);
  const blockColspan = (rankLabels.length * 2) + 2;
  const topRow = [
    `<th rowspan="3">응답 보기</th>`,
    buildGroupedCountHeader('응답자 전체', respondentN, blockColspan),
    ...displayGroups.map(g => buildGroupedCountHeader(g.label, g.n, blockColspan))
  ].join('');
  const midRow = [
    ...[null, ...displayGroups].map(() => [
      ...rankLabels.map(lab => `<th colspan="2" class="group-head">${escapeHtml(lab)}</th>`),
      `<th rowspan="2" class="num group-col">가중점수</th>`,
      `<th rowspan="2" class="num">종합순위</th>`
    ].join(''))
  ].join('');
  const subRow = [
    ...[null, ...displayGroups].map(() =>
      rankLabels.map(() => `<th class="num group-col">비율(%)</th><th class="num">빈도수 (명)</th>`).join('')
    )
  ].join('');

  const bodyRows = totalResults.map(r => {
    const totalRank = data.ranking.find(rk => rk.option === r.option);
    const totalPos = totalRank ? totalRank.position : '-';
    const rankCells = r.perRank.map(pr => `<td class="num group-col">${formatPercent(pr.pct)}</td><td class="num">${pr.count.toLocaleString()}</td>`).join('');
    const groupCells = displayGroups.map(g => {
      const perOpt = g.perOption.find(x => x.option === r.option);
      const perRankCells = (perOpt ? perOpt.perRank : rankLabels.map(() => ({ pct: 0, count: 0 })))
        .map(pr => `<td class="num group-col">${formatPercent(pr.pct)}</td><td class="num">${pr.count.toLocaleString()}</td>`)
        .join('');
      const rk = g.ranking.find(x => x.option === r.option);
      const po = rk ? rk.position : '-';
      const sc = rk ? rk.score : 0;
      return `${perRankCells}<td class="num group-col">${rk ? sc.toLocaleString() : '-'}</td><td class="num">${po === '-' ? '-' : `${po}위`}</td>`;
    }).join('');
    return `
      <tr>
        <td>${renderTableOptionLabel(r.option, data.targetLabel)}</td>
        ${rankCells}
        <td class="num group-col">${totalRank ? r.score.toLocaleString() : '-'}</td>
        <td class="num">${totalPos === '-' ? '-' : `${totalPos}위`}</td>
        ${groupCells}
      </tr>
    `;
  }).join('');
  const totalRankCells = rankLabels.map((_, ri) => {
    const totalCount = totalResults.reduce((sum, result) => sum + ((result.perRank[ri] && result.perRank[ri].count) || 0), 0);
    const totalPct = respondentN > 0 ? (totalCount / respondentN) * 100 : 0;
    return `<td class="num group-col">${formatPercent(totalPct)}</td><td class="num">${totalCount.toLocaleString()}</td>`;
  }).join('');
  const totalGroupCells = displayGroups.map(g => {
    const totalPerRank = rankLabels.map((_, ri) => {
      const totalCount = totalResults.reduce((sum, result) => {
        const perOpt = g.perOption.find(x => x.option === result.option);
        return sum + ((perOpt && perOpt.perRank[ri] && perOpt.perRank[ri].count) || 0);
      }, 0);
      const totalPct = g.n > 0 ? (totalCount / g.n) * 100 : 0;
      return `<td class="num group-col">${formatPercent(totalPct)}</td><td class="num">${totalCount.toLocaleString()}</td>`;
    }).join('');
    return `${totalPerRank}<td class="num group-col">-</td><td class="num">-</td>`;
  }).join('');
  const tableHtml = `
    <table class="result-table">
      <thead>
        <tr>${topRow}</tr>
        <tr>${midRow}</tr>
        <tr>${subRow}</tr>
      </thead>
      <tbody>
        ${bodyRows}
        <tr class="total-row">
          <td>합계</td>
          ${totalRankCells}
          <td class="num group-col">-</td>
          <td class="num">-</td>
          ${totalGroupCells}
        </tr>
      </tbody>
    </table>
  `;
  return wrapResultTable(
    tableHtml,
    `<div class="result-table-note">가중 점수는 상위 순위에 더 큰 가중치를 주는 방식으로 계산합니다. 1순위 응답 건수에는 ${data.rankCount}점을, 2순위에는 ${Math.max(data.rankCount - 1, 0)}점을 부여하는 식으로 내려가며 합산합니다.</div>`
  );
}

function buildRankSection(data, rows) {
  const { codebookEntry, targetLabel, groupResults } = data;
  const hiddenRanks = resultState.hiddenRankKeys.get(targetLabel) || new Set();
  const hiddenGroups = resultState.hiddenGroupKeys.get(targetLabel) || new Set();

  const summaryHtml = buildRankSummaryHtml(data);
  let chartHtml = '';
  let legendHtml = '';
  if (groupResults) {
    chartHtml = buildRankGroupTextHtml(data, hiddenGroups);
    legendHtml = buildRankGroupLegendHtml(data, hiddenGroups);
  } else {
    chartHtml = buildRankStackChartHtml(data, hiddenRanks);
    legendHtml = buildRankLegendHtml(data, hiddenRanks);
  }
  const tableHtml = buildRankDataTableHtml(data, hiddenGroups);
  const otherTexts = getOtherResponseTexts(targetLabel, rows);
  resultState.otherResponseTexts.set(targetLabel, otherTexts);
  const fullText = buildQuestionFullHtml(codebookEntry);

  return `
    <section class="result-section" data-target="${escapeHtml(targetLabel)}" data-type="rank">
      <div class="result-header">
        <div class="result-title">
          ${escapeHtml(targetLabel)}
        </div>
        ${fullText}
      </div>
      ${summaryHtml ? `
      <div class="result-visual rank-summary-row has-legend">
        <div class="result-chart-col">${summaryHtml}</div>
        <aside class="legend-panel" aria-hidden="true"></aside>
      </div>` : ''}
      <div class="result-visual has-legend">
        <div class="result-chart-col">${chartHtml}</div>
        ${legendHtml}
      </div>
      ${tableHtml}
    </section>
  `;
}

/* ---------- 기타 응답 모음 ---------- */
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

function getOtherResponseTexts(targetLabel, rows) {
  const entry = resultState.codebookByLabel.get(targetLabel);
  if (!entry || !entry.otherInput) return [];
  const textIdx = findOtherTextColumnIndex(targetLabel);
  if (textIdx === undefined) return [];
  const textSet = new Set();
  (rows || []).forEach(row => {
    const text = cleanCell((row || [])[textIdx]);
    if (text) textSet.add(text);
  });
  return [...textSet];
}

function openOtherResponsesModal(targetLabel, event) {
  const modal = document.getElementById('other-response-modal');
  const panel = modal ? modal.querySelector('.modal') : null;
  const titleEl = document.getElementById('other-response-modal-title');
  const subtitleEl = document.getElementById('other-response-modal-subtitle');
  const listEl = document.getElementById('other-response-modal-list');
  if (!modal || !panel || !titleEl || !subtitleEl || !listEl) return;

  const texts = resultState.otherResponseTexts.get(targetLabel) || [];
  titleEl.textContent = `${targetLabel} 기타 응답`;
  subtitleEl.textContent = `${texts.length}건의 직접 입력 응답`;
  listEl.innerHTML = texts.length
    ? texts.map(text => `<li>${escapeHtml(text)}</li>`).join('')
    : '<li>표시할 기타 응답이 없습니다.</li>';
  modal.classList.add('show');

  const pad = 12;
  const clickX = event && Number.isFinite(event.clientX) ? event.clientX : Math.round(window.innerWidth / 2);
  const clickY = event && Number.isFinite(event.clientY) ? event.clientY : Math.round(window.innerHeight / 2);
  requestAnimationFrame(() => {
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(pad, window.innerWidth - rect.width - pad);
    const maxTop = Math.max(pad, window.innerHeight - rect.height - pad);
    let left = clickX + 10;
    let top = clickY + 10;

    if (left > maxLeft) left = Math.max(pad, clickX - rect.width - 10);
    if (top > maxTop) top = Math.max(pad, clickY - rect.height - 10);

    panel.style.left = `${Math.min(left, maxLeft)}px`;
    panel.style.top = `${Math.min(top, maxTop)}px`;
  });
}

function closeOtherResponsesModal() {
  const modal = document.getElementById('other-response-modal');
  const panel = modal ? modal.querySelector('.modal') : null;
  if (panel) {
    panel.style.left = '';
    panel.style.top = '';
  }
  if (modal) modal.classList.remove('show');
}

function setupOtherResponseModal() {
  const modal = document.getElementById('other-response-modal');
  const closeBtn = document.getElementById('close-other-response-btn');
  if (!modal || !closeBtn) return;
  closeBtn.addEventListener('click', closeOtherResponsesModal);
  modal.addEventListener('click', e => {
    if (e.target === modal) closeOtherResponsesModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('show')) {
      closeOtherResponsesModal();
    }
  });
}

function openScaleCompareModal(targetLabel) {
  const modal = document.getElementById('scale-compare-modal');
  const titleEl = document.getElementById('scale-compare-modal-title');
  const noteEl = document.getElementById('scale-compare-modal-note');
  const listEl = document.getElementById('scale-compare-modal-list');
  if (!modal || !titleEl || !noteEl || !listEl) return;

  const candidates = getScaleCompareCandidateEntries(targetLabel);
  if (candidates.length === 0) {
    alert('같은 척도 길이의 비교 가능한 문항이 없습니다.');
    return;
  }

  const selected = new Set(getScaleCompareSelectedLabels(targetLabel));
  const baseEntry = resultState.codebookByLabel.get(targetLabel);
  titleEl.textContent = `${targetLabel}와 묶어 볼 문항 선택`;
  noteEl.textContent = `${baseEntry && baseEntry.valueCount ? `${baseEntry.valueCount}점 척도` : '같은 척도'} 문항만 선택할 수 있어요. 현재 문항은 기본으로 포함되며, 아래에서 추가할 문항만 고르면 됩니다.`;
  listEl.innerHTML = candidates.length > 0
    ? candidates.map(entry => `
      <label class="scale-compare-modal-item">
        <input type="checkbox" value="${escapeHtml(entry.label)}" ${selected.has(entry.label) ? 'checked' : ''}>
        <span class="scale-compare-modal-copy">
          <span class="scale-compare-modal-label">${escapeHtml(entry.label)}</span>
          ${entry.full ? `<span class="scale-compare-modal-full">${escapeHtml(entry.full)}</span>` : ''}
        </span>
      </label>
    `).join('')
    : '<div class="scale-compare-modal-empty">선택 가능한 문항이 없습니다.</div>';
  modal.dataset.target = targetLabel;
  modal.classList.add('show');
}

function closeScaleCompareModal() {
  const modal = document.getElementById('scale-compare-modal');
  const listEl = document.getElementById('scale-compare-modal-list');
  if (listEl) listEl.innerHTML = '';
  if (!modal) return;
  modal.dataset.target = '';
  modal.classList.remove('show');
}

function applyScaleCompareModalSelection() {
  const modal = document.getElementById('scale-compare-modal');
  const listEl = document.getElementById('scale-compare-modal-list');
  const targetLabel = modal ? cleanCell(modal.dataset.target) : '';
  if (!targetLabel || !listEl) return;
  const selectedLabels = Array.from(listEl.querySelectorAll('input[type="checkbox"]:checked'))
    .map(input => cleanCell(input.value))
    .filter(Boolean);
  if (selectedLabels.length > 0) resultState.scaleCompareSelections.set(targetLabel, selectedLabels);
  else resultState.scaleCompareSelections.delete(targetLabel);
  closeScaleCompareModal();
  renderResults();
}

function setupScaleCompareModal() {
  const modal = document.getElementById('scale-compare-modal');
  const closeBtn = document.getElementById('close-scale-compare-btn');
  const cancelBtn = document.getElementById('cancel-scale-compare-btn');
  const applyBtn = document.getElementById('apply-scale-compare-btn');
  if (!modal || !closeBtn || !cancelBtn || !applyBtn) return;

  closeBtn.addEventListener('click', closeScaleCompareModal);
  cancelBtn.addEventListener('click', closeScaleCompareModal);
  applyBtn.addEventListener('click', applyScaleCompareModalSelection);
  modal.addEventListener('click', e => {
    if (e.target === modal) closeScaleCompareModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('show')) {
      closeScaleCompareModal();
    }
  });
}

/* ---------- 섹션 dispatch ---------- */
function buildChoiceSectionHtml(data, rows) {
  if (!data) return '';
  const { codebookEntry, targetLabel, groupResults } = data;
  const hiddenGroups = resultState.hiddenGroupKeys.get(targetLabel) || new Set();
  const chartHtml = groupResults
    ? buildGroupCompareChartHtml(data, hiddenGroups)
    : buildBasicChartHtml(data);
  const legendHtml = groupResults ? buildLegendHtml(data, hiddenGroups) : '';
  const tableHtml = buildDataTableHtml(data, hiddenGroups);
  const otherTexts = getOtherResponseTexts(targetLabel, rows);
  resultState.otherResponseTexts.set(targetLabel, otherTexts);
  const fullText = buildQuestionFullHtml(codebookEntry);
  const visualClass = getResultVisualClass(!!groupResults);
  const tableNoteHtml = data.isMulti
    ? '<div class="result-table-note">복수응답 문항이므로 각 보기의 비율을 모두 더하면 100%를 초과할 수 있습니다.</div>'
    : '';

  return `
    <section class="result-section" data-target="${escapeHtml(targetLabel)}" data-type="${data.isMulti ? 'multiple' : 'single'}">
      <div class="result-header">
        <div class="result-title">${escapeHtml(targetLabel)}</div>
        ${fullText}
      </div>
      <div class="${visualClass}">
        <div class="result-chart-col">${chartHtml}</div>
        ${legendHtml}
      </div>
      ${tableHtml}
      ${tableNoteHtml}
    </section>
  `;
}

function buildScaleSection(data, rows) {
  if (!data) return '';
  const { codebookEntry, targetLabel, groupResults } = data;
  const hiddenGroups = resultState.hiddenGroupKeys.get(targetLabel) || new Set();
  const viewMode = getScaleViewMode(targetLabel);
  const hideMidpoint = isScaleMidpointHidden(targetLabel);
  const chartHtml = buildScaleChartHtml(data, hiddenGroups, viewMode);
  const legendHtml = (!data.isDerivedScale && viewMode === 'distribution') ? buildScaleLegendHtml(data) : '';
  const tableHtml = buildDataTableHtml(data, hiddenGroups);
  const compareTriggerHtml = '';
  const compareSectionHtml = '';
  const fullText = buildQuestionFullHtml(codebookEntry);
  const toggleHtml = buildScaleToggleHtml(targetLabel, viewMode, {
    showMidpointOption: !data.isDerivedScale && canHideScaleMidpoint(data),
    hideMidpoint
  });
  const groupControlsHtml = groupResults ? buildScaleGroupControlsHtml(data, hiddenGroups) : '';
  const visualClass = getResultVisualClass(!!legendHtml);

  return `
    <section class="result-section" data-target="${escapeHtml(targetLabel)}" data-type="scale">
      <div class="result-header">
        <div class="result-title">${escapeHtml(targetLabel)}</div>
        ${fullText}
        ${toggleHtml}
        ${groupControlsHtml}
      </div>
      <div class="${visualClass}">
        <div class="result-chart-col">${chartHtml}</div>
        ${legendHtml}
      </div>
      ${tableHtml}
      ${compareTriggerHtml}
      ${compareSectionHtml}
    </section>
  `;
}

function buildTargetScaleCompareSection(compareData) {
  if (!compareData || !compareData.baseData) return '';
  const hiddenGroups = resultState.hiddenGroupKeys.get(compareData.targetLabel) || new Set();
  const hasGroups = Array.isArray(compareData.groups) && compareData.groups.length > 0;
  let viewMode = resultState.scaleViewModes.get(TARGET_SCALE_COMPARE_VIEW_KEY) || 'mean';
  if (hasGroups && viewMode === 'distribution') {
    viewMode = 'mean';
    resultState.scaleViewModes.set(TARGET_SCALE_COMPARE_VIEW_KEY, 'mean');
  }
  const hideMidpoint = isScaleMidpointHidden(TARGET_SCALE_COMPARE_VIEW_KEY);
  const toggleHtml = buildScaleToggleHtml(TARGET_SCALE_COMPARE_VIEW_KEY, viewMode, {
    showMidpointOption: canHideScaleMidpoint(compareData.baseData),
    hideMidpoint,
    disabledModes: hasGroups ? ['distribution'] : []
  });
  const compareSectionHtml = viewMode === 'distribution'
    ? buildScaleCompareDistributionSectionHtml(compareData)
    : buildScaleCompareSectionHtml(compareData, hiddenGroups, { showHeader: false, flush: true });
  const tableHtml = buildScaleCompareDataTableHtml(compareData, hiddenGroups);
  return `
    <section class="result-section" data-target="${escapeHtml(compareData.targetLabel)}" data-type="scale-compare">
      <div class="result-header">
        <div class="result-title">여러 문항 한 번에 비교하기</div>
        ${toggleHtml}
      </div>
      ${compareSectionHtml}
      ${tableHtml}
    </section>
  `;
}

function buildResultSection(data, rows) {
  if (!data) return '';
  if (data.visualType === 'rank') return buildRankSection(data, rows);
  if (data.visualType === 'scale') return buildScaleSection(data, rows);
  if (data.visualType === 'numeric-open') return buildNumericOpenSection(data, rows);
  return buildChoiceSectionHtml(data, rows);
}

function buildUnsupportedSection(label, entry) {
  const fullText = buildQuestionFullHtml(entry);
  const typeText = entry ? entry.type : '알 수 없음';
  return `
    <section class="result-section" data-target="${escapeHtml(label)}">
      <div class="result-header">
        <div class="result-title">${escapeHtml(label)}</div>
        ${fullText}
      </div>
      <div class="result-unsupported">
        이 문항 유형(<strong>${escapeHtml(typeText)}</strong>)의 시각화는 아직 준비 중이에요. 현재는 <strong>객관식 단일</strong>, <strong>객관식 중복</strong>, <strong>객관식 순위</strong>, <strong>객관식 척도</strong>, <strong>주관식 숫자</strong> 문항을 지원합니다.
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
  resultState.otherResponseTexts = new Map();

  const targetLabels = getTargetChipLabels();
  if (targetLabels.length === 0) {
    container.innerHTML = '<div class="result-empty">보고 싶은 문항을 좌측에서 드래그해 주세요.</div>';
    return;
  }

  await ensureCodebookIndexLoaded();
  refreshTargetScaleCompareControl();

  if (!filterState.rows || filterState.rows.length < 2) {
    container.innerHTML = '<div class="result-empty">응답 데이터가 아직 준비되지 않아 결과를 표시할 수 없어요.</div>';
    return;
  }

  const criterionLabel = getCriterionChipLabel();
  const filteredRowIndexes = getFilteredRowIndexes();
  const filteredRows = getFilteredLabelDataRows();
  const filteredValueRows = getFilteredValueDataRows();

  if (resultState.targetScaleCompareMode) {
    const compareData = aggregateTargetScaleCompareData(targetLabels, criterionLabel, filteredRows);
    if (compareData) {
      container.innerHTML = buildTargetScaleCompareSection(compareData);
      alignScaleCompareCharts(container);
      attachResultEventListeners(container);
      return;
    }
    resultState.targetScaleCompareMode = false;
    refreshTargetScaleCompareControl();
  }

  const sections = targetLabels.map(label => {
    const entry = resultState.codebookByLabel.get(label);
    if (!entry) return buildUnsupportedSection(label, null);
    if (!supportsResultType(entry.type)) return buildUnsupportedSection(label, entry);
    const data = aggregateResultQuestion(label, criterionLabel, filteredRows, filteredValueRows, filteredRowIndexes);
    if (!data) return buildUnsupportedSection(label, entry);
    return buildResultSection(data, filteredRows);
  }).join('');

  container.innerHTML = sections;
  alignGroupCompareCharts(container);
  alignScaleCompareCharts(container);
  attachResultEventListeners(container);
}

function alignGroupCompareCharts(container) {
  if (!container) return;
  container.querySelectorAll('.hbar-chart.group-compare').forEach(chart => {
    const overlay = chart.querySelector('.hbar-group-overlay');
    const svg = chart.querySelector('.group-line-svg');
    const rows = Array.from(chart.querySelectorAll('.hbar-row'));
    if (!overlay || !svg || rows.length === 0) return;

    const overlayRect = overlay.getBoundingClientRect();
    const width = overlay.clientWidth;
    const height = overlay.clientHeight;
    if (!width || !height) return;

    const trackMetrics = rows.map(row => {
      const track = row.querySelector('.hbar-track');
      const rect = (track || row).getBoundingClientRect();
      return {
        centerY: (rect.top + (rect.height / 2)) - overlayRect.top,
        left: rect.left - overlayRect.left,
        width: rect.width
      };
    });

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    svg.querySelectorAll('.group-path').forEach(path => {
      const pcts = String(path.dataset.pcts || '')
        .split(',')
        .map(v => Number(v))
        .filter(v => Number.isFinite(v));
      const d = pcts.map((pct, i) => {
        const metric = trackMetrics[i] || { centerY: 0, left: 0, width: 0 };
        const x = metric.left + ((pct / 100) * metric.width);
        const y = metric.centerY;
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
      }).join(' ');
      path.setAttribute('d', d);
    });

    chart.querySelectorAll('.group-dot').forEach(dot => {
      const rowIndex = Number(dot.dataset.rowIndex || 0);
      const metric = trackMetrics[rowIndex] || { centerY: 0, left: 0, width: 0 };
      const pct = Math.max(0, Math.min(100, Number(dot.style.left.replace('%', '')) || 0));
      const x = metric.left + ((pct / 100) * metric.width);
      const y = metric.centerY;
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
    });
  });
}

function alignScaleCompareCharts(container) {
  if (!container) return;
  container.querySelectorAll('.scale-compare-chart.is-group').forEach(chart => {
    const overlay = chart.querySelector('.scale-compare-overlay');
    const svg = chart.querySelector('.scale-compare-line-svg');
    const plots = Array.from(chart.querySelectorAll('.scale-compare-plot'));
    const maxScore = Number(chart.dataset.maxScore || 0);
    if (!overlay || !svg || plots.length === 0 || !Number.isFinite(maxScore) || maxScore <= 1) return;

    const overlayRect = overlay.getBoundingClientRect();
    const width = overlay.clientWidth;
    const height = overlay.clientHeight;
    if (!width || !height) return;

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    svg.querySelectorAll('.scale-compare-line').forEach(path => {
      const means = String(path.dataset.means || '').split('|').map(value => {
        const trimmed = cleanCell(value);
        return trimmed === '' ? NaN : Number(trimmed);
      });
      let started = false;
      const commands = [];
      means.forEach((mean, index) => {
        if (!Number.isFinite(mean)) {
          started = false;
          return;
        }
        const plot = plots[index];
        if (!plot) {
          started = false;
          return;
        }
        const rect = plot.getBoundingClientRect();
        const leftPct = getScaleMeanLeftPct(mean, maxScore);
        if (!Number.isFinite(leftPct)) {
          started = false;
          return;
        }
        const plotStyles = getComputedStyle(plot.parentElement || plot);
        const trackTop = Number.parseFloat(plotStyles.getPropertyValue('--scale-compare-track-top')) || (rect.height * 0.46);
        const x = (rect.left - overlayRect.left) + ((leftPct / 100) * rect.width);
        const y = (rect.top - overlayRect.top) + trackTop;
        commands.push(`${started ? 'L' : 'M'} ${x} ${y}`);
        started = true;
      });
      path.setAttribute('d', commands.join(' '));
    });
  });
}

function attachResultEventListeners(container) {
  ensureTooltip();
  container.querySelectorAll('[data-tip]').forEach(el => {
    el.addEventListener('mouseenter', onTipEnter);
    el.addEventListener('mousemove', onTipMove);
    el.addEventListener('mouseleave', onTipLeave);
  });
  container.querySelectorAll('[data-open-other]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      openOtherResponsesModal(btn.dataset.openOther || '', e);
    });
  });
  container.querySelectorAll('[data-scale-mode]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const mode = btn.dataset.scaleMode;
      const targetLabel = btn.dataset.target;
      if (!mode || !targetLabel) return;
      if (btn.dataset.scaleModeDisabled === 'true') {
        if (targetLabel === TARGET_SCALE_COMPARE_VIEW_KEY && mode === 'distribution') {
          alert('그룹별 비교 기준이 적용된 상태에서는 분포 보기를 사용할 수 없습니다. 분포 보기를 보려면 그룹별 비교 기준을 해제해 주세요.');
        }
        return;
      }
      resultState.scaleViewModes.set(targetLabel, mode);
      renderResults();
    });
  });
  container.querySelectorAll('[data-scale-hide-midpoint]').forEach(input => {
    input.addEventListener('change', e => {
      e.stopPropagation();
      const targetLabel = input.dataset.target;
      if (!targetLabel) return;
      resultState.scaleMidpointHidden.set(targetLabel, !!input.checked);
      renderResults();
    });
  });
  container.querySelectorAll('[data-scale-group-toggle]').forEach(input => {
    input.addEventListener('change', e => {
      e.stopPropagation();
      const targetLabel = input.dataset.target;
      const groupValue = input.dataset.group;
      if (!targetLabel || !groupValue) return;
      const hidden = resultState.hiddenGroupKeys.get(targetLabel) || new Set();
      if (input.checked) hidden.delete(groupValue);
      else hidden.add(groupValue);
      resultState.hiddenGroupKeys.set(targetLabel, hidden);
      renderResults();
    });
  });
  const bindNumericCommit = (selector, key, normalize) => {
    container.querySelectorAll(selector).forEach(input => {
      const commit = () => {
        const targetLabel = input.dataset.target;
        if (!targetLabel) return;
        const current = resultState.numericHistogramConfigs.get(targetLabel) || {};
        const nextValue = normalize(input.value);
        input.value = nextValue;
        resultState.numericHistogramConfigs.set(targetLabel, { ...current, [key]: nextValue });
        renderResults();
      };
      input.addEventListener('change', e => {
        e.stopPropagation();
        commit();
      });
      input.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        commit();
      });
    });
  };
  bindNumericCommit('[data-numeric-interval]', 'interval', clampNumericHistogramStep);
  bindNumericCommit('[data-numeric-start]', 'start', normalizeNumericHistogramStart);
  container.querySelectorAll('[data-numeric-view]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const targetLabel = btn.dataset.target;
      const mode = btn.dataset.numericView;
      if (!targetLabel || !mode) return;
      if (btn.dataset.numericViewLocked === 'true') {
        if (mode === 'histogram') {
          alert('그룹별 비교에서는 히스토그램 보기를 사용할 수 없습니다. 그룹별 비교는 박스수염으로 표시합니다.');
        }
        return;
      }
      resultState.numericOpenViewModes.set(targetLabel, mode === 'box' ? 'box' : 'histogram');
      renderResults();
    });
  });
  container.querySelectorAll('[data-open-scale-compare]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const targetLabel = btn.dataset.openScaleCompare;
      if (!targetLabel) return;
      openScaleCompareModal(targetLabel);
    });
  });
  container.querySelectorAll('.legend').forEach(legend => {
    const targetLabel = legend.dataset.target;
    const mode = legend.dataset.mode; // 'group' or 'rank'
    legend.querySelectorAll('.legend-item, .scale-compare-legend-item').forEach(item => {
      const cb = item.querySelector('input[type="checkbox"]');
      if (!cb) return;
      cb.addEventListener('change', () => {
        if (mode === 'rank') {
          const hidden = resultState.hiddenRankKeys.get(targetLabel) || new Set();
          const ri = Number(item.dataset.rank);
          if (cb.checked) hidden.delete(ri);
          else hidden.add(ri);
          resultState.hiddenRankKeys.set(targetLabel, hidden);
        } else {
          const hidden = resultState.hiddenGroupKeys.get(targetLabel) || new Set();
          if (cb.checked) hidden.delete(item.dataset.group);
          else hidden.add(item.dataset.group);
          resultState.hiddenGroupKeys.set(targetLabel, hidden);
        }
        renderResults();
      });
    });
  });
  container.querySelectorAll('.legend-actions').forEach(actions => {
    const targetLabel = actions.dataset.target;
    const mode = actions.dataset.mode;
    actions.querySelectorAll('.legend-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const action = btn.dataset.legendAction;
        if (mode === 'rank') {
          const legend = actions.parentElement ? actions.parentElement.querySelector('.legend[data-mode="rank"]') : null;
          const rankIndexes = legend
            ? Array.from(legend.querySelectorAll('.legend-item')).map(item => Number(item.dataset.rank)).filter(Number.isFinite)
            : [];
          const nextHidden = action === 'all-off' ? new Set(rankIndexes) : new Set();
          resultState.hiddenRankKeys.set(targetLabel, nextHidden);
        } else {
          const legend = actions.parentElement ? actions.parentElement.querySelector('.legend[data-mode="group"]') : null;
          const groupValues = legend
            ? Array.from(legend.querySelectorAll('.legend-item, .scale-compare-legend-item')).map(item => item.dataset.group).filter(Boolean)
            : [];
          resultState.hiddenGroupKeys.set(targetLabel, action === 'all-off' ? new Set(groupValues) : new Set());
        }
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
  tip.style.whiteSpace = data.kind === 'rank-group-text' ? 'normal' : 'nowrap';
  tip.style.maxWidth = data.kind === 'rank-group-text' ? '280px' : 'none';
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
    case 'option-label':
      return [
        line(escapeHtml(d.option))
      ].join('');
    case 'question-full':
      return [
        line(escapeHtml(d.label || '')),
        d.full ? line(`Q. ${escapeHtml(d.full)}`) : ''
      ].join('');
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
    case 'rank-seg':
    case 'rank-nonranked':
      return [
        line(escapeHtml(d.option)),
        line(escapeHtml(d.rankLabel)),
        line(pct(d.pct)),
        line(n(d.count))
      ].join('');
    case 'rank-group-text': {
      const head = [
        line(escapeHtml(d.groupLabel)),
        line(escapeHtml(d.option))
      ];
      const perRank = (d.perRank || []).map(pr =>
        line(`${escapeHtml(pr.rankLabel)}: ${pct(pr.pct)}`)
      );
      const tail = [line(n(d.count))];
      return [...head, ...perRank, ...tail].join('');
    }
    case 'scale-segment':
      return [
        line(`${escapeHtml(String(d.score))}점`),
        d.scoreLabel && d.scoreLabel !== `${d.score}점` ? line(escapeHtml(d.scoreLabel)) : '',
        line(pct(d.pct)),
        line(n(d.count))
      ].join('');
    case 'scale-mean':
      return [
        d.questionLabel ? line(escapeHtml(d.questionLabel)) : '',
        d.groupLabel ? line(escapeHtml(d.groupLabel)) : '',
        line(`평균 ${Number(d.mean || 0).toFixed(2)}점`),
        line(n(d.totalN))
      ].join('');
    case 'derived-scale-violin':
      return [
        line(`연속값 분포`),
        line(n(d.totalN)),
        line(`최소 ${Number(d.min || 0).toFixed(2)}점`),
        line(`최대 ${Number(d.max || 0).toFixed(2)}점`)
      ].join('');
    case 'derived-scale-quartile':
      return [
        line(escapeHtml(d.label)),
        line(`${Number(d.value || 0).toFixed(2)}점`)
      ].join('');
    case 'numeric-hist-bin':
      return [
        d.groupLabel ? line(escapeHtml(d.groupLabel)) : '',
        line(`구간 ${escapeHtml(d.rangeLabel || '')}`),
        line(pct(d.pct)),
        line(n(d.count))
      ].join('');
    case 'numeric-mean':
      return [
        d.groupLabel ? line(escapeHtml(d.groupLabel)) : '',
        line(`평균 ${formatNumericMeanDisplay(d.mean, d.unit || '')}`),
        line(n(d.totalN))
      ].join('');
    case 'numeric-quartile':
      return [
        d.groupLabel ? line(escapeHtml(d.groupLabel)) : '',
        line(escapeHtml(d.tooltipLabel || d.label || '')),
        line(formatNumericValueWithUnit(Number(d.value), d.unit || ''))
      ].join('');
    case 'numeric-whisker-range':
      return [
        d.groupLabel ? line(escapeHtml(d.groupLabel)) : '',
        line(`최소 ${formatNumericValueWithUnit(Number(d.min), d.unit || '')}`),
        line(`최대 ${formatNumericValueWithUnit(Number(d.max), d.unit || '')}`),
        line(n(d.totalN))
      ].join('');
    case 'numeric-whisker-box':
      return [
        d.groupLabel ? line(escapeHtml(d.groupLabel)) : '',
        line(`Q1 ${formatNumericValueWithUnit(Number(d.q1), d.unit || '')}`),
        line(`Q2 ${formatNumericValueWithUnit(Number(d.median), d.unit || '')}`),
        line(`Q3 ${formatNumericValueWithUnit(Number(d.q3), d.unit || '')}`),
        line(n(d.totalN))
      ].join('');
    case 'scale-compare-group-dot':
      return [
        d.questionLabel ? line(escapeHtml(d.questionLabel)) : '',
        line(escapeHtml(d.groupLabel)),
        line(`평균 ${Number(d.mean || 0).toFixed(2)}점`),
        d.totalN !== undefined ? line(n(d.totalN)) : ''
      ].join('');
    default:
      return '';
  }
}

function observeDropZones() {
  ['drop-target', 'drop-criterion'].forEach(id => {
    const zone = document.getElementById(id);
    if (!zone) return;
    const obs = new MutationObserver(() => { renderResults(); });
    obs.observe(zone, { childList: true, subtree: false });
  });
}

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

async function initResultFeature() {
  if (resultState.initialized) return;
  resultState.initialized = true;

  try { await migrateLegacySurveyStorage(); } catch (_) {}

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
    const titleEl = document.getElementById('project-title');
    if (titleEl && cur && cur.title) {
      try { titleEl.textContent = cur.title; } catch (_) {}
    }
  }

  try { setupAccordion && setupAccordion(); } catch (_) {}
  try { setupSearch && setupSearch(); } catch (_) {}
  try { setupPanelToggle && setupPanelToggle(); } catch (_) {}
  try { setupSelectionAndDragDrop && setupSelectionAndDragDrop(); } catch (_) {}
  try { setupOtherResponseModal && setupOtherResponseModal(); } catch (_) {}
  try { setupScaleCompareModal && setupScaleCompareModal(); } catch (_) {}
  try { setupTitleRename && setupTitleRename(); } catch (_) {}
  try { setupSavedModal && setupSavedModal(); } catch (_) {}
  try { await setupFilters(); } catch (_) {}

  hookFilterUpdates();
  observeDropZones();
  window.addEventListener('resize', () => {
    const container = document.getElementById('result-container');
    alignGroupCompareCharts(container);
    alignScaleCompareCharts(container);
  });
  renderResults();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { initResultFeature(); });
} else {
  setTimeout(() => { initResultFeature(); }, 0);
}
