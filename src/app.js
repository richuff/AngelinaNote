const api = window.angelina;
const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const COLORS = ['#1f6fbd', '#e96560', '#efb13c', '#53a978', '#8b67b2', '#e47ca4'];
const STICKERS = ['坐坐', '拍照', '探险', '海边', '潜水', '看书', '纸飞机', '购物', '送货', '骑行'];
const YEAR_STICKERS = ['骑行', '纸飞机', '拍照', '探险', '看书', '海边'];

const state = {
  years: [], tags: [], selectedTag: null, currentYear: null, currentMonth: new Date().getMonth(),
  currentDate: null, yearNotes: [], stickers: [], selectedSticker: null, dirty: false, saveTimer: null
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const pad = value => String(value).padStart(2, '0');
const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const stripHtml = html => { const el = document.createElement('div'); el.innerHTML = html || ''; return el.textContent.trim(); };
const stickerSrc = name => `../Angelina/PNG/${name}.png`;

function showView(name) {
  $$('.view').forEach(view => view.classList.toggle('active', view.id === `${name}View`));
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === name || (name !== 'home' && item.dataset.view === 'today' && name === 'editor')));
}

async function init() {
  const thisYear = new Date().getFullYear();
  await api.ensureYears([thisYear, thisYear + 1, thisYear + 2]);
  state.tags = await api.listTags();
  if (!state.tags.length) {
    for (const tag of [{ name: '日常', color: COLORS[0] }, { name: '灵感', color: COLORS[1] }, { name: '旅行', color: COLORS[2] }]) {
      await api.createTag(tag);
    }
    state.tags = await api.listTags();
  }
  renderTagFilters();
  renderStickerLibrary();
  await loadYears();
  bindEvents();
  lucide.createIcons();
}

async function loadYears() {
  state.years = await api.listYears();
  renderYears();
}

function renderYears() {
  $('#yearGrid').innerHTML = state.years.map((year, index) => `
    <button class="year-card" data-year="${year.year}">
      <span class="tape"></span>
      <div><span class="index">VOLUME ${pad(index + 1)}</span><h2>${escapeHtml(year.title || year.year)}</h2><p>${escapeHtml(year.subtitle || '我的年度手帐')}</p></div>
      <img src="${stickerSrc(YEAR_STICKERS[index % YEAR_STICKERS.length])}" alt="">
      <footer><i data-lucide="book-open"></i><span>${year.note_count} 篇记录</span><i data-lucide="arrow-up-right"></i></footer>
    </button>`).join('');
  $$('.year-card').forEach(card => card.addEventListener('click', () => openYear(Number(card.dataset.year))));
  lucide.createIcons();
}

function renderTagFilters() {
  $('#tagFilters').innerHTML = `<button class="tag-filter ${state.selectedTag ? '' : 'active'}" data-tag=""><span class="tag-color" style="background:#fff"></span>全部</button>` +
    state.tags.map(tag => `<button class="tag-filter ${state.selectedTag === tag.id ? 'active' : ''}" data-tag="${tag.id}"><span class="tag-color" style="background:${tag.color}"></span>${escapeHtml(tag.name)}</button>`).join('');
  $$('.tag-filter').forEach(button => button.addEventListener('click', async () => {
    state.selectedTag = button.dataset.tag ? Number(button.dataset.tag) : null;
    renderTagFilters();
    if (state.currentYear) await openYear(state.currentYear, false);
  }));
}

async function openYear(year, changeView = true) {
  state.currentYear = year;
  state.yearNotes = await api.getYearNotes(year, state.selectedTag);
  const settings = state.years.find(item => item.year === year) || { year, title: String(year), subtitle: '' };
  $('#yearKicker').textContent = `${year} · ANNUAL NOTES`;
  $('#yearTitle').textContent = settings.title;
  $('#yearSubtitle').textContent = settings.subtitle;
  $('#writtenDays').textContent = state.yearNotes.length;
  const now = new Date();
  const total = isLeapYear(year) ? 366 : 365;
  const elapsed = year < now.getFullYear() ? total : year > now.getFullYear() ? 0 : Math.ceil((now - new Date(year, 0, 1)) / 86400000) + 1;
  $('#yearProgress').textContent = `${Math.round(elapsed / total * 100)}%`;
  $('#activeFilter').textContent = state.selectedTag ? state.tags.find(tag => tag.id === state.selectedTag)?.name : '全部';
  renderMonthTabs();
  renderCalendar();
  if (changeView) showView('year');
  lucide.createIcons();
}

function renderMonthTabs() {
  $('#monthTabs').innerHTML = MONTHS.map((month, index) => `<button class="month-tab ${state.currentMonth === index ? 'active' : ''}" data-month="${index}">${index + 1}月</button>`).join('');
  $$('.month-tab').forEach(tab => tab.addEventListener('click', () => {
    state.currentMonth = Number(tab.dataset.month);
    renderMonthTabs();
    renderCalendar();
  }));
}

function renderCalendar() {
  const year = state.currentYear;
  const month = state.currentMonth;
  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const noteMap = new Map(state.yearNotes.map(note => [note.note_date, note]));
  const today = dateKey(new Date());
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push('<div class="day-cell empty"></div>');
  for (let day = 1; day <= days; day++) {
    const key = `${year}-${pad(month + 1)}-${pad(day)}`;
    const note = noteMap.get(key);
    cells.push(`<button class="day-cell ${note ? 'has-entry' : ''} ${today === key ? 'is-today' : ''}" data-date="${key}">
      <span class="day-number">${day}</span>
      ${note ? `<span class="day-preview">${escapeHtml(note.title || stripHtml(note.content) || '这一天有一则记录')}</span><span class="day-tags">${escapeHtml(note.tags || '')}</span>` : ''}
    </button>`);
  }
  while (cells.length % 7) cells.push('<div class="day-cell empty"></div>');
  $('#calendar').innerHTML = `<div class="calendar-weekdays">${['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map(day => `<div>${day}</div>`).join('')}</div><div class="calendar-grid">${cells.join('')}</div>`;
  $$('.day-cell[data-date]').forEach(cell => cell.addEventListener('click', () => openEditor(cell.dataset.date)));
}

async function openEditor(date) {
  if (state.dirty) await saveCurrentNote();
  state.currentDate = date;
  const note = await api.getNote(date);
  state.stickers = note.stickers.map(item => ({ ...item }));
  state.selectedSticker = null;
  const parsed = new Date(`${date}T12:00:00`);
  $('#editorYear').textContent = `${parsed.getFullYear()} · DAILY NOTE`;
  $('#editorDate').textContent = `${MONTHS[parsed.getMonth()]} ${parsed.getDate()}日`;
  $('#weekdayLabel').textContent = `${WEEKDAYS[parsed.getDay()]} / ${date}`;
  $('#noteTitle').value = note.title;
  $('#noteContent').innerHTML = note.content;
  $('#moodSelect').value = note.mood;
  renderNoteTags(note.tags.map(tag => tag.id));
  renderPlacedStickers();
  showView('editor');
  setDirty(false);
  lucide.createIcons();
}

function renderStickerLibrary() {
  $('#stickerLibrary').innerHTML = STICKERS.map(name => `<button class="sticker-option" data-asset="${name}" title="添加${name}贴纸"><img src="${stickerSrc(name)}" alt="${name}"></button>`).join('');
  $$('.sticker-option').forEach(button => button.addEventListener('click', () => addSticker(button.dataset.asset)));
}

function addSticker(asset, randomize = false) {
  const paper = $('#paper');
  const xRange = Math.max(120, paper.clientWidth - 180);
  const yRange = Math.max(140, paper.clientHeight - 190);
  const index = state.stickers.length;
  const seeded = (state.currentDate.replaceAll('-', '').split('').reduce((sum, n) => sum + Number(n), 0) * 37 + index * 83) % 997;
  const random = randomize ? Math.random() : seeded / 997;
  state.stickers.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    asset, x: 45 + (random * xRange) % xRange, y: 90 + ((random * 1.73) % 1) * yRange,
    rotation: Math.round(-12 + ((random * 2.31) % 1) * 24), scale: .85 + ((random * 3.17) % 1) * .25, z_index: index + 1
  });
  state.selectedSticker = state.stickers.at(-1).id;
  renderPlacedStickers();
  setDirty(true);
}

function renderPlacedStickers() {
  $('#stickerLayer').innerHTML = state.stickers.map(sticker => `<img class="placed-sticker ${state.selectedSticker === sticker.id ? 'selected' : ''}" data-id="${sticker.id}" src="${stickerSrc(sticker.asset)}" alt="${sticker.asset}贴纸" draggable="false" style="left:${sticker.x}px;top:${sticker.y}px;z-index:${sticker.z_index};transform:rotate(${sticker.rotation}deg) scale(${sticker.scale})">`).join('');
  $$('.placed-sticker').forEach(bindStickerDrag);
  updateStickerControls();
}

function bindStickerDrag(element) {
  element.addEventListener('pointerdown', event => {
    event.preventDefault();
    state.selectedSticker = element.dataset.id;
    const sticker = state.stickers.find(item => item.id === state.selectedSticker);
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = sticker.x;
    const originY = sticker.y;
    element.setPointerCapture(event.pointerId);
    $$('.placed-sticker').forEach(item => item.classList.toggle('selected', item === element));
    updateStickerControls();
    element.onpointermove = move => {
      const layer = $('#stickerLayer');
      sticker.x = Math.max(0, Math.min(layer.clientWidth - 90, originX + move.clientX - startX));
      sticker.y = Math.max(0, Math.min(layer.clientHeight - 90, originY + move.clientY - startY));
      element.style.left = `${sticker.x}px`;
      element.style.top = `${sticker.y}px`;
      setDirty(true);
    };
    element.onpointerup = () => { element.onpointermove = null; element.onpointerup = null; };
  });
}

function updateStickerControls() {
  const sticker = state.stickers.find(item => item.id === state.selectedSticker);
  $('#stickerControls').classList.toggle('disabled', !sticker);
  if (sticker) {
    $('#rotateSticker').value = sticker.rotation;
    $('#scaleSticker').value = Math.round(sticker.scale * 100);
  }
}

function renderNoteTags(selectedIds = []) {
  $('#noteTags').innerHTML = state.tags.map(tag => `<label class="note-tag"><input type="checkbox" value="${tag.id}" ${selectedIds.includes(tag.id) ? 'checked' : ''}><span><i class="tag-color" style="background:${tag.color}"></i>${escapeHtml(tag.name)}</span></label>`).join('');
  $$('#noteTags input').forEach(input => input.addEventListener('change', () => setDirty(true)));
}

function setDirty(value) {
  state.dirty = value;
  $('#editorSaveHint').textContent = value ? '等待保存' : '已保存';
  $('#saveStatus').textContent = value ? '有尚未保存的更改' : '所有内容已保存';
  if (value) {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveCurrentNote, 1200);
  }
}

async function saveCurrentNote() {
  if (!state.currentDate || !state.dirty) return;
  clearTimeout(state.saveTimer);
  $('#editorSaveHint').textContent = '保存中…';
  await api.saveNote({
    note_date: state.currentDate,
    title: $('#noteTitle').value.trim(),
    content: $('#noteContent').innerHTML,
    mood: $('#moodSelect').value,
    tagIds: $$('#noteTags input:checked').map(input => Number(input.value)),
    stickers: state.stickers
  });
  state.dirty = false;
  $('#editorSaveHint').textContent = '刚刚保存';
  $('#saveStatus').textContent = '所有内容已保存';
}

function openYearDialog(year = null) {
  const selected = year ? state.years.find(item => item.year === year) : null;
  $('#yearInput').value = selected?.year || (Math.max(...state.years.map(item => item.year), new Date().getFullYear()) + 1);
  $('#yearInput').disabled = Boolean(selected);
  $('#yearTitleInput').value = selected?.title || '';
  $('#yearSubtitleInput').value = selected?.subtitle || '';
  $('#yearDialog').showModal();
}

function openTagDialog() {
  $('#tagNameInput').value = '';
  $('#tagColors').innerHTML = COLORS.map((color, i) => `<button type="button" class="color-choice ${i === 0 ? 'active' : ''}" data-color="${color}" style="background:${color}" aria-label="选择颜色"></button>`).join('');
  $$('.color-choice').forEach(choice => choice.addEventListener('click', () => {
    $$('.color-choice').forEach(item => item.classList.remove('active'));
    choice.classList.add('active');
  }));
  $('#tagDialog').showModal();
  $('#tagNameInput').focus();
}

function bindEvents() {
  $('#homeButton').addEventListener('click', async () => { await saveCurrentNote(); await loadYears(); showView('home'); });
  $('[data-view="home"]').addEventListener('click', async () => { await saveCurrentNote(); await loadYears(); showView('home'); });
  $('[data-view="today"]').addEventListener('click', async () => { const now = new Date(); state.currentYear = now.getFullYear(); await openEditor(dateKey(now)); });
  $('#backToYears').addEventListener('click', async () => { await loadYears(); showView('home'); });
  $('#backToYear').addEventListener('click', async () => { await saveCurrentNote(); await openYear(state.currentYear); });
  $('#addYearButton').addEventListener('click', () => openYearDialog());
  $('#editYearButton').addEventListener('click', () => openYearDialog(state.currentYear));
  $('#addTagButton').addEventListener('click', openTagDialog);
  $('#editorAddTag').addEventListener('click', openTagDialog);
  $('#saveButton').addEventListener('click', saveCurrentNote);
  $('#randomSticker').addEventListener('click', () => addSticker(STICKERS[Math.floor(Math.random() * STICKERS.length)], true));
  $('#deleteSticker').addEventListener('click', () => {
    state.stickers = state.stickers.filter(item => item.id !== state.selectedSticker);
    state.selectedSticker = null; renderPlacedStickers(); setDirty(true);
  });
  $('#rotateSticker').addEventListener('input', event => updateSelectedSticker('rotation', Number(event.target.value)));
  $('#scaleSticker').addEventListener('input', event => updateSelectedSticker('scale', Number(event.target.value) / 100));
  ['#noteTitle', '#noteContent', '#moodSelect'].forEach(selector => $(selector).addEventListener('input', () => setDirty(true)));
  $$('.format-toolbar button[data-command]').forEach(button => button.addEventListener('click', () => {
    document.execCommand(button.dataset.command, false, button.dataset.value || null); $('#noteContent').focus(); setDirty(true);
  }));
  $('#fontSelect').addEventListener('change', event => { if (event.target.value) document.execCommand('fontName', false, event.target.value); $('#noteContent').focus(); setDirty(true); });
  $('#yearForm').addEventListener('submit', async event => {
    event.preventDefault();
    const year = Number($('#yearInput').value);
    await api.ensureYears([year]);
    await api.saveYear({ year, title: $('#yearTitleInput').value || String(year), subtitle: $('#yearSubtitleInput').value });
    $('#yearDialog').close(); await loadYears();
    if (state.currentYear === year) await openYear(year);
  });
  $('#tagForm').addEventListener('submit', async event => {
    event.preventDefault();
    const name = $('#tagNameInput').value.trim();
    if (!name) return;
    await api.createTag({ name, color: $('.color-choice.active').dataset.color });
    state.tags = await api.listTags();
    $('#tagDialog').close(); renderTagFilters();
    if (state.currentDate) renderNoteTags($$('#noteTags input:checked').map(input => Number(input.value)));
  });
  window.addEventListener('beforeunload', () => { if (state.dirty) saveCurrentNote(); });
}

function updateSelectedSticker(key, value) {
  const sticker = state.stickers.find(item => item.id === state.selectedSticker);
  if (!sticker) return;
  sticker[key] = value;
  const element = $(`.placed-sticker[data-id="${sticker.id}"]`);
  element.style.transform = `rotate(${sticker.rotation}deg) scale(${sticker.scale})`;
  setDirty(true);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function isLeapYear(year) { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }

init().catch(error => {
  console.error(error);
  document.body.innerHTML = `<main style="padding:40px;font-family:sans-serif"><h1>应用启动失败</h1><pre>${escapeHtml(error.stack)}</pre></main>`;
});
