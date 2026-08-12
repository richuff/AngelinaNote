const api = window.angelina;
const CHARACTER_STICKERS = ['坐坐', '拍照', '探险', '海边', '潜水', '看书', '纸飞机', '购物', '送货', '骑行'];
const UI_STICKERS = [
  { asset: 'ui:3', label: '海浪徽章' },
  { asset: 'ui:4', label: '星球徽章' },
  { asset: 'ui:5', label: '游戏机徽章' },
  { asset: 'ui:6', label: '兔子徽章' },
  { asset: 'ui:7', label: '星星徽章' },
  { asset: 'ui:9-1', label: '直到此地标题' },
  { asset: 'ui:16', label: '蓝色兔子' },
  { asset: 'ui:17', label: '橙色兔子' },
  { asset: 'ui:18', label: '兔子与花' },
  { asset: 'ui:20', label: '黄色涂鸦' },
  { asset: 'ui:22', label: '彩色星星' },
  { asset: 'ui:23', label: '篮球星星' },
  { asset: 'ui:24', label: '绿色花朵' },
  { asset: 'ui:25', label: '粉色花朵' },
  { asset: 'ui:26', label: '黄色花朵' },
  { asset: 'ui:27', label: '白色星星' }
];
const YEAR_STICKERS = ['骑行', '纸飞机', '拍照', '探险', '看书', '海边'];
const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const COLORS = ['#1f6fbd', '#e96560', '#efb13c', '#53a978', '#8b67b2', '#e47ca4'];

const state = {
  years: [], tags: [], customFonts: [], selectedTag: null, currentYear: null, currentMonth: new Date().getMonth(),
  currentDate: null, yearNotes: [], stickers: [], selectedSticker: null, dirty: false,
  editing: false, currentFavorite: false, currentHasContent: false, saveTimer: null, currentView: 'home', editorReturnView: 'yearOverview',
  pendingYearCover: '', pendingYearTitleImage: '',
  preferences: { theme: 'blue', appFont: 'interfaceHandwritten', autoSave: true, compactCalendar: false, fontSize: 16, lineHeight: 31, collapsedSidebar: false }
};
// 新增：保存并发锁，防止重复写入
let isSaving = false;

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const pad = value => String(value).padStart(2, '0');
const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const stripHtml = html => { const el = document.createElement('div'); el.innerHTML = html || ''; return el.textContent.trim(); };
const stickerSrc = name => name.startsWith('ui:')
  ? `../Angelina/UI素材/${name.slice(3)}.png`
  : `../Angelina/PNG/${name}.png`;
const stickerLabel = asset => UI_STICKERS.find(item => item.asset === asset)?.label || asset;
const allStickerAssets = () => [
  ...CHARACTER_STICKERS,
  ...UI_STICKERS.map(item => item.asset)
];

// 优化lucide：销毁重建，避免图标重复堆积
let lucideInstance; // 全局存储lucide实例

function refreshIcons() {
  if (typeof lucide !== 'undefined') {
    // 先判断实例存在且拥有销毁方法，再执行销毁
    if (lucideInstance && typeof lucideInstance.destroy === 'function') {
      lucideInstance.destroy();
    }
    // 重新创建图标实例并保存
    lucideInstance = lucide.createIcons();
  }
}

function showView(name) {
  state.currentView = name;
  $$('.view').forEach(view => view.classList.toggle('active', view.id === `${name}View`));
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === name));
  refreshIcons();
}

async function init() {
  try {
    loadPreferences();
    bindEvents();
    state.customFonts = await api.listCustomFonts();
    await registerCustomFonts();
    populateCustomFontOptions();
    if (state.preferences.appFont === 'fajardose') {
      const migratedFont = state.customFonts.find(font => /miss\s*fajardose/i.test(font.name));
      if (migratedFont) {
        state.preferences.appFont = `custom:${migratedFont.id}`;
        localStorage.setItem('angelina-preferences', JSON.stringify(state.preferences));
      }
    }
    applyPreferences();
    const thisYear = new Date().getFullYear();
    await api.ensureYears([thisYear]);
    state.tags = await api.listTags();
    renderTagFilters();
    renderStickerLibrary();
    await loadYears();
    refreshIcons();
  } catch (err) {
    console.error('应用初始化失败', err);
    alert('程序启动异常：' + err.message);
    document.body.innerHTML = `<main style="padding:40px;font-family:sans-serif"><h1>应用启动失败</h1><pre>${escapeHtml(err.stack)}</pre></main>`;
  }
}

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem('angelina-preferences') || '{}');
    state.preferences = { ...state.preferences, ...saved };
    if (!saved.interfaceHandwrittenDefaultV1) {
      state.preferences.appFont = 'interfaceHandwritten';
      state.preferences.interfaceHandwrittenDefaultV1 = true;
      localStorage.setItem('angelina-preferences', JSON.stringify(state.preferences));
    }
  } catch (error) {
    console.warn('Unable to read preferences', error);
  }
  applyPreferences();
}

function savePreferences() {
  localStorage.setItem('angelina-preferences', JSON.stringify(state.preferences));
  applyPreferences();
}

function applyPreferences() {
  const root = document.documentElement;
  const fonts = {
    interfaceHandwritten: '"Medieval Sharp", KaiTi, STKaiti, "Microsoft YaHei", cursive',
    mixed: '"Segoe UI", Inter, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
    system: '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
    serif: 'Georgia, "Times New Roman", "Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif',
    rounded: '"Arial Rounded MT Bold", Nunito, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
    handwritten: '"Segoe Print", "Comic Sans MS", KaiTi, STKaiti, cursive',
    monospace: 'Consolas, "Cascadia Mono", "Microsoft YaHei UI", "Microsoft YaHei", monospace'
  };
  root.dataset.theme = state.preferences.theme;
  root.dataset.font = state.preferences.appFont;
  const customFont = state.customFonts.find(font => `custom:${font.id}` === state.preferences.appFont);
  root.style.setProperty('--app-font', customFont ? `"${customFont.family}", "Microsoft YaHei", sans-serif` : (fonts[state.preferences.appFont] || fonts.mixed));
  root.style.setProperty('--note-font-size', `${state.preferences.fontSize}px`);
  root.style.setProperty('--note-line-height', `${state.preferences.lineHeight}px`);
  $('.app-shell').classList.toggle('sidebar-collapsed', state.preferences.collapsedSidebar);
  $('.app-shell').classList.toggle('compact-calendar', state.preferences.compactCalendar);
  $('#autoSaveSetting').checked = state.preferences.autoSave;
  $('#compactCalendarSetting').checked = state.preferences.compactCalendar;
  $('#fontSizeSetting').value = state.preferences.fontSize;
  $('#lineHeightSetting').value = state.preferences.lineHeight;
  $('#fontSizeValue').textContent = `${state.preferences.fontSize} px`;
  $('#lineHeightValue').textContent = `${state.preferences.lineHeight} px`;
  $('#collapsedSidebarSetting').checked = state.preferences.collapsedSidebar;
  $('#appFontSetting').value = state.preferences.appFont;
  $$('#themeSetting [data-theme]').forEach(button => button.classList.toggle('active', button.dataset.theme === state.preferences.theme));
  $('#sidebarCollapse').innerHTML = state.preferences.collapsedSidebar
    ? '<i data-lucide="panel-left-open"></i>'
    : '<i data-lucide="panel-left-close"></i>';
  $('#sidebarCollapse').title = state.preferences.collapsedSidebar ? '展开侧栏' : '收起侧栏';
  $('#sidebarCollapse').setAttribute('aria-label', $('#sidebarCollapse').title);
  refreshIcons();
}

async function registerCustomFonts() {
  await Promise.all(state.customFonts.map(async font => {
    font.family = `Angelina Custom ${font.id}`;
    try {
      const face = new FontFace(font.family, `url("${font.dataUrl}")`);
      await face.load();
      document.fonts.add(face);
    } catch (error) {
      console.warn(`Unable to load字体 ${font.fileName}`, error);
      alert(`字体 ${font.name} 加载失败，将跳过该字体`);
    }
  }));
}

function populateCustomFontOptions() {
  ['#appFontSetting', '#fontSelect'].forEach(selector => {
    const select = $(selector);
    select.querySelectorAll('option[data-custom-font]').forEach(option => option.remove());
    state.customFonts.filter(font => !/^medieval\s*sharp$/i.test(font.name)).forEach(font => {
      const option = document.createElement('option');
      option.value = `custom:${font.id}`;
      option.textContent = font.name;
      option.dataset.customFont = 'true';
      select.append(option);
    });
  });
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
  $$('.year-card').forEach(card => card.addEventListener('click', () => openYearCover(Number(card.dataset.year))));
  refreshIcons();
}

function openYearCover(year) {
  state.currentYear = year;
  const settings = state.years.find(item => item.year === year) || {
    year, title: String(year), subtitle: '我的年度手帐'
  };
  $('#coverYearNumber').textContent = year;
  $('#coverYearTitle').textContent = settings.title || String(year);
  $('#coverYearSubtitle').textContent = settings.subtitle || '我的年度手帐';
  const surface = $('#yearCoverSurface');
  surface.classList.toggle('custom-cover', Boolean(settings.cover_image));
  surface.style.backgroundImage = settings.cover_image ? `url("${settings.cover_image}")` : '';
  $('#coverTitleArt').src = settings.cover_title_image || '../Angelina/UI素材/9-1.png';
  showView('yearCover');
}

async function openYearOverview(year, changeView = true) {
  state.currentYear = year;
  state.yearNotes = await api.getYearNotes(year, state.selectedTag);
  const settings = state.years.find(item => item.year === year) || {
    year, title: String(year), subtitle: '我的年度手帐'
  };
  $('#overviewKicker').textContent = `${year} · YEAR IN REVIEW`;
  $('#overviewYearTitle').textContent = settings.title;
  $('#overviewYearSubtitle').textContent = settings.subtitle;
  $('#overviewWrittenDays').textContent = state.yearNotes.length;
  renderOverviewMonths();
  renderOverviewTags();
  renderJournalStream();
  if (changeView) showView('yearOverview');
}

function renderOverviewMonths() {
  const counts = Array(12).fill(0);
  state.yearNotes.forEach(note => { counts[Number(note.note_date.slice(5, 7)) - 1] += 1; });
  $('#overviewMonthFilters').innerHTML = MONTHS.map((month, index) => `
    <button class="overview-month" data-month="${index}">
      <span>${pad(index + 1)}</span><strong>${month}</strong><small>${counts[index]} 篇</small>
    </button>`).join('');
  $$('.overview-month').forEach(button => button.addEventListener('click', async () => {
    state.currentMonth = Number(button.dataset.month);
    await openYear(state.currentYear);
  }));
}

function renderOverviewTags() {
  $('#overviewTagFilters').innerHTML = `
    <button class="overview-tag ${state.selectedTag ? '' : 'active'}" data-tag="">全部</button>
    ${state.tags.map(tag => `<button class="overview-tag ${state.selectedTag === tag.id ? 'active' : ''}" data-tag="${tag.id}"><i class="tag-color" style="background:${tag.color}"></i>${escapeHtml(tag.name)}</button>`).join('')}`;
  $$('#overviewTagFilters [data-tag]').forEach(button => button.addEventListener('click', () => selectTag(button.dataset.tag)));
}

function renderJournalStream() {
  $('#journalResultCount').textContent = `${state.yearNotes.length} 篇日志`;
  if (!state.yearNotes.length) {
    $('#journalStream').innerHTML = `<div class="journal-empty"><i data-lucide="notebook-pen"></i><strong>这一年还没有符合条件的日志</strong><p>从月份日历中选择一天开始记录。</p></div>`;
    refreshIcons();
    return;
  }
  $('#journalStream').innerHTML = [...state.yearNotes].reverse().map(note => {
    const date = new Date(`${note.note_date}T12:00:00`);
    const excerpt = stripHtml(note.content) || '这一天留下了一则记录。';
    const tags = note.tags ? note.tags.split(', ').filter(Boolean) : [];
    return `<button class="journal-entry" data-date="${note.note_date}">
      <time><strong>${pad(date.getDate())}</strong><span>${pad(date.getMonth() + 1)}月</span><small>${WEEKDAYS[date.getDay()]}</small></time>
      <span class="journal-body"><strong>${escapeHtml(note.title || `${date.getMonth() + 1}月${date.getDate()}日`)}</strong><span>${escapeHtml(excerpt)}</span><small>${tags.map(tag => `<i>${escapeHtml(tag)}</i>`).join('')}</small></span>
      <i class="journal-arrow" data-lucide="arrow-up-right"></i>
    </button>`;
  }).join('');
  $$('.journal-entry').forEach(entry => entry.addEventListener('click', () => openEditor(entry.dataset.date, 'yearOverview')));
  refreshIcons();
}

function renderArchiveResults(containerSelector, notes, emptyMessage) {
  const container = $(containerSelector);
  if (!notes.length) {
    container.innerHTML = `<div class="journal-empty"><i data-lucide="book-open"></i><strong>${escapeHtml(emptyMessage)}</strong></div>`;
    refreshIcons();
    return;
  }
  container.innerHTML = notes.map(note => {
    const date = new Date(`${note.note_date}T12:00:00`);
    const excerpt = stripHtml(note.content) || '这一天留下了一则记录。';
    const tags = note.tags ? note.tags.split(', ').filter(Boolean) : [];
    return `<button class="journal-entry" data-date="${note.note_date}">
      <time><strong>${pad(date.getDate())}</strong><span>${pad(date.getMonth() + 1)}月</span><small>${date.getFullYear()} · ${WEEKDAYS[date.getDay()]}</small></time>
      <span class="journal-body"><strong>${escapeHtml(note.title || `${date.getMonth() + 1}月${date.getDate()}日`)}</strong><span>${escapeHtml(excerpt)}</span><small>${tags.map(tag => `<i>${escapeHtml(tag)}</i>`).join('')}</small></span>
      <i class="journal-arrow" data-lucide="${note.is_favorite ? 'star' : 'arrow-up-right'}"${note.is_favorite ? ' fill="currentColor"' : ''}></i>
    </button>`;
  }).join('');
  container.querySelectorAll('.journal-entry').forEach(entry => entry.addEventListener('click', () => {
    state.currentYear = Number(entry.dataset.date.slice(0, 4));
    openEditor(entry.dataset.date, state.currentView);
  }));
  refreshIcons();
}

async function runSearch() {
  const query = $('#searchInput').value.trim();
  if (!query) {
    $('#searchResultCount').textContent = '输入关键词开始搜索';
    $('#searchResults').innerHTML = '';
    return;
  }
  const notes = await api.searchNotes(query);
  $('#searchResultCount').textContent = `${notes.length} 篇日志`;
  renderArchiveResults('#searchResults', notes, '没有找到匹配的日志');
}

async function loadFavorites() {
  const notes = await api.listFavoriteNotes();
  $('#favoriteResultCount').textContent = `${notes.length} 篇收藏`;
  renderArchiveResults('#favoriteResults', notes, '还没有收藏日志');
}

async function selectTag(value) {
  state.selectedTag = value ? Number(value) : null;
  renderTagFilters();
  if (!state.currentYear) return;
  if (state.currentView === 'yearOverview') await openYearOverview(state.currentYear, false);
  if (state.currentView === 'year') await openYear(state.currentYear, false);
}

function renderTagFilters() {
  const container = $('#tagFilters');
  if (!container) return;
  container.innerHTML = `<button class="tag-filter ${state.selectedTag ? '' : 'active'}" data-tag=""><span class="tag-color" style="background:#fff"></span>全部</button>` +
    state.tags.map(tag => `<button class="tag-filter ${state.selectedTag === tag.id ? 'active' : ''}" data-tag="${tag.id}"><span class="tag-color" style="background:${tag.color}"></span>${escapeHtml(tag.name)}</button>`).join('');
  $$('.tag-filter').forEach(button => button.addEventListener('click', async () => {
    await selectTag(button.dataset.tag);
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
  renderMonthTabs();
  renderCalendar();
  if (changeView) showView('year');
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

async function openEditor(date, returnView = state.currentView) {
  if (state.dirty) await saveCurrentNote();
  state.editorReturnView = ['year', 'search', 'favorites'].includes(returnView) ? returnView : 'yearOverview';
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
  state.currentFavorite = Boolean(note.is_favorite);
  renderNoteTags(note.tags.map(tag => tag.id));
  renderPlacedStickers();
  showView('editor');
  setDirty(false);
  const hasContent = Boolean(
    note.title.trim() || stripHtml(note.content) || note.tags.length || note.stickers.length
  );
  state.currentHasContent = hasContent;
  updateFavoriteButton();
  setEditorMode(!hasContent);
}

function updateFavoriteButton() {
  const button = $('#favoriteNoteButton');
  button.disabled = !state.currentHasContent;
  button.classList.toggle('active', state.currentFavorite);
  button.title = state.currentFavorite ? '取消收藏' : '收藏这篇日志';
  button.setAttribute('aria-label', button.title);
  button.innerHTML = `<i data-lucide="star"${state.currentFavorite ? ' fill="currentColor"' : ''}></i>`;
  refreshIcons();
}

async function openRandomNote(favoritesOnly = false) {
  const note = await api.getRandomNote(favoritesOnly);
  if (!note) {
    window.alert(favoritesOnly ? '还没有收藏的日志。' : '还没有可以随机阅读的日志。');
    return;
  }
  state.currentYear = Number(note.note_date.slice(0, 4));
  await openEditor(note.note_date, 'yearOverview');
}

function setEditorMode(editing) {
  state.editing = editing;
  $('#editorView').classList.toggle('reading', !editing);
  $('#editorView').classList.toggle('editing', editing);
  $('#noteTitle').readOnly = !editing;
  $('#noteContent').contentEditable = editing ? 'true' : 'false';
  $('#moodSelect').disabled = !editing;
  $('#editNoteButton').hidden = editing;
  $('#saveButton').hidden = !editing;
  $('#editorSaveHint').hidden = !editing;
  $$('.format-toolbar button, .format-toolbar select, #noteTags input, #randomSticker, #editorAddTag')
    .forEach(control => { control.disabled = !editing; });
  if (!editing) {
    state.selectedSticker = null;
    renderPlacedStickers();
  }
}

function renderStickerLibrary() {
  $('#stickerLibrary').innerHTML = `
    <p class="sticker-group-label">人物贴纸</p>
    ${CHARACTER_STICKERS.map(name => `<button class="sticker-option" data-asset="${name}" title="添加${name}贴纸"><img src="${stickerSrc(name)}" alt="${name}" loading="lazy" decoding="async"></button>`).join('')}
    <p class="sticker-group-label">UI 装饰</p>
    ${UI_STICKERS.map(item => `<button class="sticker-option" data-asset="${item.asset}" title="添加${item.label}"><img src="${stickerSrc(item.asset)}" alt="${item.label}" loading="lazy" decoding="async"></button>`).join('')}`;
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
    rotation: Math.round(-12 + ((random * 2.31) % 1) * 24),
    scale: (asset.startsWith('ui:') ? .72 : .85) + ((random * 3.17) % 1) * .25,
    z_index: index + 1
  });
  state.selectedSticker = state.stickers.at(-1).id;
  clampStickerToPaper(state.stickers.at(-1));
  renderPlacedStickers();
  setDirty(true);
}

function clampStickerToPaper(sticker) {
  const layer = $('#stickerLayer');
  if (!layer || !sticker) return;
  const visualSize = 120 * sticker.scale;
  const rotationPadding = Math.abs(Math.sin(sticker.rotation * Math.PI / 180)) * visualSize * .28;
  const edge = Math.max(72, visualSize + rotationPadding);
  sticker.x = Math.max(0, Math.min(layer.clientWidth - edge, sticker.x));
  sticker.y = Math.max(0, Math.min(layer.clientHeight - edge, sticker.y));
}

function renderPlacedStickers() {
  $('#stickerLayer').innerHTML = state.stickers.map(sticker => `<img class="placed-sticker ${state.selectedSticker === sticker.id ? 'selected' : ''}" data-id="${sticker.id}" src="${stickerSrc(sticker.asset)}" alt="${stickerLabel(sticker.asset)}贴纸" draggable="false" style="left:${sticker.x}px;top:${sticker.y}px;z-index:${sticker.z_index};transform:rotate(${sticker.rotation}deg) scale(${sticker.scale})">`).join('');
  $$('.placed-sticker').forEach(bindStickerDrag);
  updateStickerControls();
}

function bindStickerDrag(element) {
  element.addEventListener('pointerdown', event => {
    if (!state.editing) return;
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
      sticker.x = originX + move.clientX - startX;
      sticker.y = originY + move.clientY - startY;
      clampStickerToPaper(sticker);
      element.style.left = `${sticker.x}px`;
      element.style.top = `${sticker.y}px`;
      setDirty(true);
    };
    element.onpointerup = () => { element.onpointermove = null; element.onpointerup = null; };
  });
}

function updateStickerControls() {
  const sticker = state.stickers.find(item => item.id === state.selectedSticker);
  $('#paper').classList.toggle('sticker-editing', Boolean(sticker));
  $('#stickerControls').classList.toggle('disabled', !sticker);
  if (sticker) {
    $('#rotateSticker').value = sticker.rotation;
    $('#scaleSticker').value = Math.round(sticker.scale * 100);
  }
}

function clearStickerSelection() {
  if (!state.selectedSticker) return;
  state.selectedSticker = null;
  $$('.placed-sticker').forEach(item => item.classList.remove('selected'));
  updateStickerControls();
}

function renderNoteTags(selectedIds = []) {
  if (!state.tags.length) {
    $('#noteTags').innerHTML = '<p class="empty-tags">暂无可用标签</p>';
    return;
  }
  $('#noteTags').innerHTML = state.tags.map(tag => `<label class="note-tag"><input type="checkbox" value="${tag.id}" ${selectedIds.includes(tag.id) ? 'checked' : ''}><span><i class="tag-color" style="background:${tag.color}"></i>${escapeHtml(tag.name)}</span><button type="button" class="delete-tag" data-tag-id="${tag.id}" title="删除标签" aria-label="删除${escapeHtml(tag.name)}标签"><i data-lucide="minus"></i></button></label>`).join('');
  $$('#noteTags input').forEach(input => input.addEventListener('change', () => setDirty(true)));
  $$('.delete-tag').forEach(button => button.addEventListener('click', async event => {
    event.preventDefault();
    event.stopPropagation();
    const tagId = Number(button.dataset.tagId);
    const tag = state.tags.find(item => item.id === tagId);
    if (!tag || !window.confirm(`删除“${tag.name}”标签？它会从所有日志中移除。`)) return;
    const remainingSelected = $$('#noteTags input:checked').map(input => Number(input.value)).filter(id => id !== tagId);
    await api.deleteTag(tagId);
    if (state.selectedTag === tagId) state.selectedTag = null;
    state.tags = await api.listTags();
    renderNoteTags(remainingSelected);
    renderTagFilters();
    if (state.currentView === 'yearOverview') await openYearOverview(state.currentYear, false);
    refreshIcons();
  }));
  refreshIcons();
}

function setDirty(value) {
  if (value && !state.editing) return;
  state.dirty = value;
  $('#editorSaveHint').textContent = value ? '等待保存' : '已保存';
  $('#saveStatus').textContent = value ? '有尚未保存的更改' : '所有内容已保存';
  if (value && state.preferences.autoSave) {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveCurrentNote, 1200);
  }
}

async function saveCurrentNote() {
  if (!state.currentDate || !state.dirty || isSaving) return;
  isSaving = true;
  clearTimeout(state.saveTimer);
  try {
    $('#editorSaveHint').textContent = '保存中…';
    await api.saveNote({
      note_date: state.currentDate,
      title: $('#noteTitle').value.trim(),
      content: $('#noteContent').innerHTML,
      mood: $('#moodSelect').value,
      is_favorite: state.currentFavorite,
      tagIds: $$('#noteTags input:checked').map(input => Number(input.value)),
      stickers: state.stickers
    });
    state.currentHasContent = Boolean(
      $('#noteTitle').value.trim() || stripHtml($('#noteContent').innerHTML) ||
      $$('#noteTags input:checked').length || state.stickers.length
    );
    updateFavoriteButton();
    state.dirty = false;
    $('#editorSaveHint').textContent = '刚刚保存';
    $('#saveStatus').textContent = '所有内容已保存';
  } catch (err) {
    console.error('保存日志失败', err);
    alert('保存失败：' + err.message);
  } finally {
    isSaving = false;
  }
}

function openYearDialog(year = null) {
  const selected = year ? state.years.find(item => item.year === year) : null;
  $('#yearInput').value = selected?.year || (Math.max(...state.years.map(item => item.year), new Date().getFullYear()) + 1);
  $('#yearInput').disabled = Boolean(selected);
  $('#yearTitleInput').value = selected?.title || '';
  $('#yearSubtitleInput').value = selected?.subtitle || '';
  state.pendingYearCover = selected?.cover_image || '';
  state.pendingYearTitleImage = selected?.cover_title_image || '';
  updateYearCoverPreview();
  updateYearTitleImagePreview();
  $('#yearDialog').showModal();
}

function updateYearCoverPreview() {
  const preview = $('#yearCoverPreview');
  const image = state.pendingYearCover || '../Angelina/BackGround/01.jpg'
  preview.classList.toggle('has-image');
  preview.style.backgroundImage = `url("${image}")`;
  preview.innerHTML = '';
  $('#removeYearCover').disabled = !state.pendingYearCover;
}

function updateYearTitleImagePreview() {
  const preview = $('#yearTitleImagePreview');
  const image = state.pendingYearTitleImage || '../Angelina/UI素材/9-1.png';
  preview.classList.add('has-image');
  preview.style.backgroundImage = `url("${image}")`;
  preview.innerHTML = '';
  $('#removeYearTitleImage').disabled = !state.pendingYearTitleImage;
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
  // 全局指针抬起：终止所有贴纸拖拽，窗口失焦拖拽不会残留
  document.addEventListener('pointerup', () => {
    $$('.placed-sticker').forEach(el => {
      el.onpointermove = null;
      el.onpointerup = null;
    })
  })

  document.addEventListener('pointerdown', event => {
    if (event.target.closest('.placed-sticker, #stickerControls')) return;
    clearStickerSelection();
  });
  $('#paper').addEventListener('wheel', event => {
    if (!state.selectedSticker) return;
    $('#noteContent').scrollTop += event.deltaY;
    event.preventDefault();
  }, { passive: false });
  $('#homeButton').addEventListener('click', async () => { await saveCurrentNote(); await loadYears(); showView('home'); });
  $('[data-view="home"]').addEventListener('click', async () => { await saveCurrentNote(); await loadYears(); showView('home'); });
  $('[data-view="today"]').addEventListener('click', async () => { const now = new Date(); state.currentYear = now.getFullYear(); await openEditor(dateKey(now), 'yearOverview'); });
  $('[data-view="search"]').addEventListener('click', async () => { await saveCurrentNote(); showView('search'); $('#searchInput').focus(); });
  $('[data-view="favorites"]').addEventListener('click', async () => { await saveCurrentNote(); showView('favorites'); await loadFavorites(); });
  $('[data-view="settings"]').addEventListener('click', async () => { await saveCurrentNote(); showView('settings'); });
  $('#backToYears').addEventListener('click', async () => { await openYearOverview(state.currentYear); });
  $('#coverBackButton').addEventListener('click', async event => { event.stopPropagation(); await loadYears(); showView('home'); });
  $('#yearCoverSurface').addEventListener('click', () => openYearOverview(state.currentYear));
  $('#overviewBackButton').addEventListener('click', async () => { await loadYears(); showView('home'); });
  $('#backToYear').addEventListener('click', async () => {
    await saveCurrentNote();
    if (state.editorReturnView === 'year') await openYear(state.currentYear);
    else if (state.editorReturnView === 'search') { showView('search'); await runSearch(); }
    else if (state.editorReturnView === 'favorites') { showView('favorites'); await loadFavorites(); }
    else await openYearOverview(state.currentYear);
  });
  $('#editYearButton').addEventListener('click', () => openYearDialog(state.currentYear));
  $('#overviewEditYear').addEventListener('click', () => openYearDialog(state.currentYear));
  $('#pickYearCover').addEventListener('click', async () => {
    const image = await api.pickYearCover();
    if (!image) return;
    state.pendingYearCover = image;
    updateYearCoverPreview();
  });
  $('#removeYearCover').addEventListener('click', () => {
    state.pendingYearCover = '';
    updateYearCoverPreview();
  });
  $('#pickYearTitleImage').addEventListener('click', async () => {
    const image = await api.pickYearTitleImage();
    if (!image) return;
    state.pendingYearTitleImage = image;
    updateYearTitleImagePreview();
  });
  $('#removeYearTitleImage').addEventListener('click', () => {
    state.pendingYearTitleImage = '';
    updateYearTitleImagePreview();
  });
  $('#editorAddTag').addEventListener('click', openTagDialog);
  $('#saveButton').addEventListener('click', saveCurrentNote);
  $('#favoriteNoteButton').addEventListener('click', async () => {
    if (!state.currentDate || !state.currentHasContent) return;
    state.currentFavorite = !state.currentFavorite;
    await api.setNoteFavorite(state.currentDate, state.currentFavorite);
    updateFavoriteButton();
  });
  $('#editNoteButton').addEventListener('click', () => {
    setEditorMode(true);
    $('#noteContent').focus();
  });
  $('#randomSticker').addEventListener('click', () => {
    const assets = allStickerAssets();
    addSticker(assets[Math.floor(Math.random() * assets.length)], true);
  });
  $('#deleteSticker').addEventListener('click', () => {
    state.stickers = state.stickers.filter(item => item.id !== state.selectedSticker);
    state.selectedSticker = null; renderPlacedStickers(); setDirty(true);
  });
  $('#rotateSticker').addEventListener('input', event => updateSelectedSticker('rotation', Number(event.target.value)));
  $('#scaleSticker').addEventListener('input', event => updateSelectedSticker('scale', Number(event.target.value) / 100));
  ['#noteTitle', '#noteContent', '#moodSelect'].forEach(selector => $(selector).addEventListener('input', () => setDirty(true)));
  $('#noteContent').addEventListener('keydown', event => {
    if (event.key !== 'Tab' || !state.editing) return;
    event.preventDefault();
    document.execCommand('insertText', false, '\u3000\u3000');
    setDirty(true);
  });
  // 格式工具栏
  $$('.format-toolbar button[data-command]').forEach(button => button.addEventListener('click', () => {
    if (!state.editing) return;
    document.execCommand(button.dataset.command, false, button.dataset.value || null);
    $('#noteContent').focus();
    setDirty(true);
  }));
  $('#fontSelect').addEventListener('change', event => {
    const editorFonts = {
      mixed: 'Segoe UI, Microsoft YaHei UI, Microsoft YaHei',
      serif: 'Georgia, Times New Roman, Noto Serif SC, Songti SC, SimSun',
      handwritten: 'Segoe Print, Comic Sans MS, KaiTi, STKaiti',
      monospace: 'Consolas, Cascadia Mono, Microsoft YaHei UI, Microsoft YaHei'
    };
    const customFont = state.customFonts.find(font => `custom:${font.id}` === event.target.value);
    if (customFont) document.execCommand('fontName', false, `${customFont.family}, Microsoft YaHei`);
    else if (editorFonts[event.target.value]) document.execCommand('fontName', false, editorFonts[event.target.value]);
    $('#noteContent').focus();
    setDirty(true);
  });
  // 重构插入图片，移除废弃execCommand
  $('#insertNoteImage').addEventListener('click', async () => {
    if (!state.editing) return;
    const selection = window.getSelection();
    const savedRange = selection.rangeCount && $('#noteContent').contains(selection.anchorNode)
      ? selection.getRangeAt(0).cloneRange() : null;
    const image = await api.pickNoteAttachment();
    if (!image) return;
    $('#noteContent').focus();
    if (savedRange) {
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }
    const img = document.createElement('img');
    img.src = image;
    img.style.maxWidth = "100%";
    const range = selection.rangeCount ? selection.getRangeAt(0) : document.createRange();
    range.insertNode(img);
    range.setStartAfter(img);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    setDirty(true);
  });
  $('#sidebarCollapse').addEventListener('click', () => {
    state.preferences.collapsedSidebar = !state.preferences.collapsedSidebar;
    savePreferences();
  });
  $('#autoSaveSetting').addEventListener('change', event => { state.preferences.autoSave = event.target.checked; savePreferences(); });
  $('#compactCalendarSetting').addEventListener('change', event => { state.preferences.compactCalendar = event.target.checked; savePreferences(); });
  $('#fontSizeSetting').addEventListener('input', event => { state.preferences.fontSize = Number(event.target.value); savePreferences(); });
  $('#lineHeightSetting').addEventListener('input', event => { state.preferences.lineHeight = Number(event.target.value); savePreferences(); });
  $('#collapsedSidebarSetting').addEventListener('change', event => { state.preferences.collapsedSidebar = event.target.checked; savePreferences(); });
  $$('#themeSetting [data-theme]').forEach(button => button.addEventListener('click', () => {
    state.preferences.theme = button.dataset.theme;
    savePreferences();
  }));
  $('#appFontSetting').addEventListener('change', event => { state.preferences.appFont = event.target.value; savePreferences(); });
  $('#addFontButton').addEventListener('click', async () => {
    const fonts = await api.importCustomFont();
    if (!fonts) return;
    state.customFonts = fonts;
    await registerCustomFonts();
    populateCustomFontOptions();
    applyPreferences();
  });
  $('#randomNoteButton').addEventListener('click', () => openRandomNote(false));
  $('#randomFavoriteButton').addEventListener('click', () => openRandomNote(true));
  $('#searchForm').addEventListener('submit', async event => { event.preventDefault(); await runSearch(); });
  $('#refreshFavorites').addEventListener('click', loadFavorites);
  $('#exportDataButton').addEventListener('click', async () => {
    try {
      const filePath = await api.exportData();
      if (filePath) $('#backupStatus').textContent = `备份已导出：${filePath}`;
    } catch (error) {
      window.alert(`导出失败：${error.message}`);
    }
  });
  $('#importDataButton').addEventListener('click', async () => {
    if (!window.confirm('恢复备份会替换当前全部日志数据。确定继续吗？')) return;
    try {
      const filePath = await api.importData();
      if (!filePath) return;
      state.tags = await api.listTags();
      state.currentDate = null;
      state.dirty = false;
      await loadYears();
      renderTagFilters();
      showView('home');
      $('#saveStatus').textContent = '备份恢复完成';
    } catch (error) {
      window.alert(`恢复失败：${error.message}`);
    }
  });
  // 软件更新检测
  $('#checkUpdateBtn')?.addEventListener('click', () => {
    if(window.electronAPI?.checkUpdate) window.electronAPI.checkUpdate();
  });
  // 接收更新进度回调
  if(window.electronAPI){
    window.electronAPI.onUpdateStatus?.((text) => {
      const statusDom = $('#updateStatusText');
      if(statusDom) statusDom.textContent = text;
    });
    window.electronAPI.onDownloadProgress?.((percent) => {
      const statusDom = $('#updateStatusText');
      if(statusDom) statusDom.textContent = `下载进度：${percent}%`;
    });
  }
  $('#yearForm').addEventListener('submit', async event => {
    event.preventDefault();
    const year = Number($('#yearInput').value);
    await api.ensureYears([year]);
    await api.saveYear({
      year,
      title: $('#yearTitleInput').value || String(year),
      subtitle: $('#yearSubtitleInput').value,
      cover_image: state.pendingYearCover,
      cover_title_image: state.pendingYearTitleImage
    });
    $('#yearDialog').close(); await loadYears();
    if (state.currentYear === year && state.currentView === 'yearOverview') await openYearOverview(year);
    else if (state.currentYear === year && state.currentView === 'year') await openYear(year);
  });
  $('#tagForm').addEventListener('submit', async event => {
    event.preventDefault();
    const name = $('#tagNameInput').value.trim();
    if (!name) return;
    await api.createTag({ name, color: $('.color-choice.active').dataset.color });
    state.tags = await api.listTags();
    $('#tagDialog').close(); renderTagFilters();
    if (state.currentView === 'yearOverview') renderOverviewTags();
    if (state.currentDate) renderNoteTags($$('#noteTags input:checked').map(input => Number(input.value)));
  });
  $$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => {
    $(`#${button.dataset.closeDialog}`).close();
  }));
  window.addEventListener('beforeunload', async (e) => {
    if (state.dirty) {
      await saveCurrentNote();
      e.returnValue = '还有内容未保存，确定关闭吗？';
    }
  });
}

function updateSelectedSticker(key, value) {
  const sticker = state.stickers.find(item => item.id === state.selectedSticker);
  if (!sticker) return;
  sticker[key] = value;
  clampStickerToPaper(sticker);
  const element = $(`.placed-sticker[data-id="${sticker.id}"]`);
  element.style.left = `${sticker.x}px`;
  element.style.top = `${sticker.y}px`;
  element.style.transform = `rotate(${sticker.rotation}deg) scale(${sticker.scale})`;
  setDirty(true);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

init();
