const { app, BrowserWindow, ipcMain, dialog, nativeImage, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
// 引入自动更新模块
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

let db;
let mainWindow = null;
let tray = null;
let isQuitting = false;
let updateCheckInProgress = false;

// ========== 自动更新配置 ==========
// 更新日志输出
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
// GitHub更新源 + 国内镜像加速，规避request timed out
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'richuff',
  repo: 'AngelinaNote'
});
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// 统一推送更新状态给渲染层
function sendUpdateStatus(statusText) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', statusText);
  }
}
// 推送下载进度
function sendDownloadProgress(percent) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-progress', percent);
  }
}

function updateErrorMessage(error) {
  const message = String(error?.message || error || '未知错误');
  if (/latest\.yml|404|Not Found/i.test(message)) return '更新配置未发布：请在 GitHub Release 上传 latest.yml 和对应安装包。';
  if (/net::ERR_|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout|network/i.test(message)) return '更新连接失败：无法访问 GitHub 更新资源，请稍后重试。';
  if (/checksum|sha512|signature|verify/i.test(message)) return '更新包校验失败：请重新下载或重新发布该版本。';
  return `更新失败：${message.slice(0, 140)}`;
}

// 监听更新事件
function bindAutoUpdateEvents() {
  // 检测到新版本
  autoUpdater.on('update-available', (info) => {
    updateCheckInProgress = false;
    sendUpdateStatus(`发现新版本 v${info.version}，正在下载更新包`);
  });

  // 已是最新版
  autoUpdater.on('update-not-available', () => {
    updateCheckInProgress = false;
    sendUpdateStatus('当前已是最新版本，无需更新');
  });

  // 下载进度
  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent);
    sendDownloadProgress(percent);
  });

  // 更新包下载完毕
  autoUpdater.on('update-downloaded', () => {
    updateCheckInProgress = false;
    sendUpdateStatus('新版本下载完成，重启即可安装');
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '更新就绪',
      message: '新版本已下载完成，重启软件完成更新？',
      buttons: ['立即重启更新', '稍后再说']
    }).then(res => {
      if (res.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  // 更新报错（超时、网络异常都会触发）
  autoUpdater.on('error', (err) => {
    updateCheckInProgress = false;
    sendUpdateStatus(updateErrorMessage(err));
    log.error('更新错误详情：', err);
  });
}
// =================================

function initDatabase() {
  const configuredDir = process.env.ANGELINA_DATA_DIR;
  const dataDir = configuredDir
    ? path.resolve(configuredDir)
    : app.isPackaged
      ? app.getPath('userData')
      : path.join(app.getAppPath(), '.data');

  fs.mkdirSync(dataDir, { recursive: true });
  db = new Database(path.join(dataDir, 'angelina-note.sqlite'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS years (
      year INTEGER PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      subtitle TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS notes (
      note_date TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      mood TEXT NOT NULL DEFAULT 'sunny',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS note_tags (
      note_date TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (note_date, tag_id),
      FOREIGN KEY (note_date) REFERENCES notes(note_date) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS stickers (
      id TEXT PRIMARY KEY,
      note_date TEXT NOT NULL,
      asset TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      rotation REAL NOT NULL,
      scale REAL NOT NULL DEFAULT 1,
      opacity REAL NOT NULL DEFAULT 1,
      z_index INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS note_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_date TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      mood TEXT NOT NULL DEFAULT 'sunny',
      is_favorite INTEGER NOT NULL DEFAULT 0,
      snapshot_at TEXT NOT NULL
    );
  `);
  const yearColumns = db.prepare('PRAGMA table_info(years)').all();
  if (!yearColumns.some(column => column.name === 'cover_image')) {
    db.exec("ALTER TABLE years ADD COLUMN cover_image TEXT NOT NULL DEFAULT ''");
  }
  if (!yearColumns.some(column => column.name === 'cover_title_image')) {
    db.exec("ALTER TABLE years ADD COLUMN cover_title_image TEXT NOT NULL DEFAULT ''");
  }
  const noteColumns = db.prepare('PRAGMA table_info(notes)').all();
  if (!noteColumns.some(column => column.name === 'is_favorite')) {
    db.exec('ALTER TABLE notes ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0');
  }
  if (!noteColumns.some(column => column.name === 'deleted_at')) {
    db.exec('ALTER TABLE notes ADD COLUMN deleted_at TEXT');
  }
  const stickerColumns = db.prepare('PRAGMA table_info(stickers)').all();
  if (!stickerColumns.some(column => column.name === 'opacity')) {
    db.exec('ALTER TABLE stickers ADD COLUMN opacity REAL NOT NULL DEFAULT 1');
  }
  db.prepare("DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-30 days')").run();
  db.exec(`DELETE FROM note_history WHERE id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY note_date ORDER BY id DESC) AS position
      FROM note_history
    ) WHERE position <= 5
  )`);
  seedInitialData();
}

function seedInitialData() {
  if (db.prepare('SELECT COUNT(*) AS count FROM notes').get().count > 0) return;
  const seedPath = path.join(app.getAppPath(), 'Angelina', 'Data', 'angelina.json');
  if (!fs.existsSync(seedPath)) return;
  const backup = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  if (backup.format !== 'angelina-note-backup' || !Array.isArray(backup.years) ||
    !Array.isArray(backup.notes) || !Array.isArray(backup.tags) ||
    !Array.isArray(backup.noteTags) || !Array.isArray(backup.stickers)) {
    throw new Error('Angelina/Data/angelina.json is not a valid backup file');
  }
  db.transaction(() => {
    const addYear = db.prepare('INSERT OR IGNORE INTO years (year, title, subtitle, cover_image, cover_title_image) VALUES (?, ?, ?, ?, ?)');
    backup.years.forEach(item => addYear.run(item.year, item.title || String(item.year), item.subtitle || '', item.cover_image || '', item.cover_title_image || ''));
    const addNote = db.prepare('INSERT OR IGNORE INTO notes (note_date, title, content, mood, updated_at, is_favorite) VALUES (?, ?, ?, ?, ?, ?)');
    backup.notes.forEach(item => addNote.run(item.note_date, item.title || '', item.content || '', item.mood || 'sunny', item.updated_at || new Date().toISOString(), item.is_favorite ? 1 : 0));
    const addTag = db.prepare('INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, ?)');
    backup.tags.forEach(item => addTag.run(item.id, item.name, item.color));
    const addLink = db.prepare('INSERT OR IGNORE INTO note_tags (note_date, tag_id) VALUES (?, ?)');
    backup.noteTags.forEach(item => addLink.run(item.note_date, item.tag_id));
    const addSticker = db.prepare('INSERT OR IGNORE INTO stickers (id, note_date, asset, x, y, rotation, scale, opacity, z_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    backup.stickers.forEach(item => addSticker.run(item.id, item.note_date, item.asset, item.x, item.y, item.rotation, item.scale, item.opacity ?? 1, item.z_index));
  })();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1050,
    minHeight: 700,
    title: 'Angelina Note',
    icon: path.join(app.getAppPath(), 'Angelina', 'Icons', 'app.ico'),
    backgroundColor: '#f7f4ea',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow = win;
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('close', event => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
  // 窗口创建完成后绑定更新事件
  bindAutoUpdateEvents();
}

function showMainWindow(view = 'home') {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('navigate-from-tray', view);
}

function createTray() {
  const iconPath = path.join(app.getAppPath(), 'Angelina', 'Icons', 'app.ico');
  tray = new Tray(iconPath);
  tray.setToolTip('Angelina Note');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '今日日志', click: () => showMainWindow('today') },
    { label: '年度书架', click: () => showMainWindow('home') },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => showMainWindow('home'));
}

function getCustomFontDir() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'Fonts')
    : path.join(app.getAppPath(), 'Angelina', 'Fonts');
}

function listCustomFonts() {
  const fontDir = getCustomFontDir();
  fs.mkdirSync(fontDir, { recursive: true });
  const mimeTypes = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
  return fs.readdirSync(fontDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && mimeTypes[path.extname(entry.name).toLowerCase()])
    .map(entry => {
      const extension = path.extname(entry.name).toLowerCase();
      const id = Buffer.from(entry.name, 'utf8').toString('base64url');
      const name = path.basename(entry.name, extension).replace(/[-_]+/g, ' ');
      const data = fs.readFileSync(path.join(fontDir, entry.name)).toString('base64');
      return { id, name, fileName: entry.name, dataUrl: `data:${mimeTypes[extension]};base64,${data}` };
    });
}

function registerIpc() {
  ipcMain.handle('app:version', () => app.getVersion());
  // 新增：渲染层触发检查更新
  ipcMain.on('check-update', async () => {
    if (!app.isPackaged) {
      sendUpdateStatus('开发环境不执行更新检查；请运行打包后的安装版测试。');
      return;
    }
    if (updateCheckInProgress) return;
    updateCheckInProgress = true;
    sendUpdateStatus('正在连接服务器检测版本...');
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      updateCheckInProgress = false;
      sendUpdateStatus(updateErrorMessage(error));
      log.error('检查更新失败：', error);
    }
  });

  ipcMain.handle('fonts:list', () => listCustomFonts());
  ipcMain.handle('fonts:import', async () => {
    const result = await dialog.showOpenDialog({
      title: '添加字体',
      properties: ['openFile'],
      filters: [{ name: '字体文件', extensions: ['ttf', 'otf', 'woff', 'woff2'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    const fontDir = getCustomFontDir();
    fs.mkdirSync(fontDir, { recursive: true });
    const destination = path.join(fontDir, path.basename(source));
    if (path.resolve(source).toLowerCase() !== path.resolve(destination).toLowerCase()) {
      fs.copyFileSync(source, destination);
    }
    return listCustomFonts();
  });
  ipcMain.handle('years:list', () => db.prepare(`
    SELECT y.year, y.title, y.subtitle, y.cover_image, y.cover_title_image,
      COUNT(DISTINCT n.note_date) AS note_count,
      MAX(n.updated_at) AS last_update
    FROM years y LEFT JOIN notes n ON CAST(substr(n.note_date, 1, 4) AS INTEGER) = y.year AND n.deleted_at IS NULL
    GROUP BY y.year ORDER BY y.year
  `).all());

  ipcMain.handle('years:ensure', (_, years) => {
    const insert = db.prepare('INSERT OR IGNORE INTO years (year, title, subtitle) VALUES (?, ?, ?)');
    db.transaction(() => years.forEach(year => insert.run(year, `${year}`, '我的年度手帐')))();
    return true;
  });

  ipcMain.handle('years:save', (_, payload) => {
    db.prepare('UPDATE years SET title = ?, subtitle = ?, cover_image = ?, cover_title_image = ? WHERE year = ?')
      .run(payload.title.trim() || String(payload.year), payload.subtitle.trim(), payload.cover_image || '', payload.cover_title_image || '', payload.year);
    return true;
  });

  ipcMain.handle('years:pick-cover', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择年度封面图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = nativeImage.createFromPath(result.filePaths[0]);
    if (source.isEmpty()) throw new Error('无法读取所选图片');
    const size = source.getSize();
    const cover = size.width > 1800 ? source.resize({ width: 1800, quality: 'good' }) : source;
    return `data:image/jpeg;base64,${cover.toJPEG(88).toString('base64')}`;
  });

  ipcMain.handle('years:pick-title-image', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择年度封面中心图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = nativeImage.createFromPath(result.filePaths[0]);
    if (source.isEmpty()) throw new Error('无法读取所选图片');
    const size = source.getSize();
    const image = size.width > 1400 ? source.resize({ width: 1400, quality: 'good' }) : source;
    return `data:image/png;base64,${image.toPNG().toString('base64')}`;
  });

  ipcMain.handle('notes:year', (_, { year, tagId }) => {
    const params = [String(year)];
    let tagClause = '';
    if (tagId) {
      tagClause = 'AND EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_date = n.note_date AND nt.tag_id = ?)';
      params.push(tagId);
    }
    return db.prepare(`
      SELECT n.note_date, n.title, n.content, n.mood, n.is_favorite, n.updated_at,
        GROUP_CONCAT(t.name, ', ') AS tags
      FROM notes n
      LEFT JOIN note_tags nt ON nt.note_date = n.note_date
      LEFT JOIN tags t ON t.id = nt.tag_id
      WHERE substr(n.note_date, 1, 4) = ? AND n.deleted_at IS NULL ${tagClause}
      GROUP BY n.note_date ORDER BY n.note_date
    `).all(...params);
  });

  ipcMain.handle('notes:stats', (_, year) => {
    const yearPrefix = `${Number(year)}-%`;
    return {
      notes: db.prepare(`SELECT note_date, title, content, mood FROM notes
        WHERE note_date LIKE ? AND deleted_at IS NULL
        AND (trim(title) <> '' OR trim(content) <> '') ORDER BY note_date`).all(yearPrefix),
      tags: db.prepare(`SELECT t.name, t.color, COUNT(*) AS count FROM note_tags nt
        JOIN notes n ON n.note_date = nt.note_date JOIN tags t ON t.id = nt.tag_id
        WHERE n.note_date LIKE ? AND n.deleted_at IS NULL GROUP BY t.id ORDER BY count DESC, t.name`).all(yearPrefix),
      moods: db.prepare(`SELECT mood, COUNT(*) AS count FROM notes WHERE note_date LIKE ?
        AND deleted_at IS NULL AND (trim(title) <> '' OR trim(content) <> '')
        GROUP BY mood ORDER BY count DESC`).all(yearPrefix)
    };
  });

  ipcMain.handle('notes:by-title', (_, title) => db.prepare(`SELECT note_date FROM notes
    WHERE title = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1`).get(String(title || '').trim()) || null);

  ipcMain.handle('notes:titles', (_, rawQuery = '') => {
    const query = String(rawQuery).trim();
    return db.prepare(`SELECT note_date, title FROM notes WHERE deleted_at IS NULL
      AND trim(title) <> '' ${query ? 'AND title LIKE ?' : ''}
      ORDER BY updated_at DESC LIMIT 30`).all(...(query ? [`%${query}%`] : []));
  });

  ipcMain.handle('notes:get', (_, date) => {
    const note = db.prepare('SELECT * FROM notes WHERE note_date = ? AND deleted_at IS NULL').get(date) || {
      note_date: date, title: '', content: '', mood: 'sunny', is_favorite: 0, updated_at: null
    };
    note.tags = db.prepare(`SELECT t.* FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_date = ?`).all(date);
    note.stickers = db.prepare('SELECT * FROM stickers WHERE note_date = ? ORDER BY z_index').all(date);
    return note;
  });

  ipcMain.handle('notes:save', (_, note) => {
    const save = db.transaction(() => {
      const previous = db.prepare('SELECT title, content, mood, is_favorite FROM notes WHERE note_date = ? AND deleted_at IS NULL').get(note.note_date);
      if (previous && (previous.title !== note.title || previous.content !== note.content || previous.mood !== note.mood || Boolean(previous.is_favorite) !== Boolean(note.is_favorite))) {
        db.prepare('INSERT INTO note_history (note_date, title, content, mood, is_favorite, snapshot_at) VALUES (?, ?, ?, ?, ?, ?)').run(note.note_date, previous.title, previous.content, previous.mood, previous.is_favorite, new Date().toISOString());
        db.prepare(`DELETE FROM note_history WHERE note_date = ? AND id NOT IN (SELECT id FROM note_history WHERE note_date = ? ORDER BY id DESC LIMIT 5)`).run(note.note_date, note.note_date);
      }
      db.prepare(`INSERT INTO notes (note_date, title, content, mood, is_favorite, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(note_date) DO UPDATE SET title=excluded.title, content=excluded.content,
          mood=excluded.mood, is_favorite=excluded.is_favorite, deleted_at=NULL, updated_at=excluded.updated_at`)
        .run(note.note_date, note.title, note.content, note.mood, note.is_favorite ? 1 : 0, new Date().toISOString());
      db.prepare('DELETE FROM note_tags WHERE note_date = ?').run(note.note_date);
      const link = db.prepare('INSERT OR IGNORE INTO note_tags (note_date, tag_id) VALUES (?, ?)');
      note.tagIds.forEach(id => link.run(note.note_date, id));
      db.prepare('DELETE FROM stickers WHERE note_date = ?').run(note.note_date);
      const add = db.prepare(`INSERT INTO stickers (id, note_date, asset, x, y, rotation, scale, opacity, z_index)
        VALUES (@id, @note_date, @asset, @x, @y, @rotation, @scale, @opacity, @z_index)`);
      note.stickers.forEach(sticker => add.run({ ...sticker, opacity: sticker.opacity ?? 1, note_date: note.note_date }));
    });
    save();
    return true;
  });

  ipcMain.handle('notes:history', (_, date) => db.prepare('SELECT * FROM note_history WHERE note_date = ? ORDER BY id DESC LIMIT 5').all(date));
  ipcMain.handle('notes:restore-history', (_, id) => {
    const item = db.prepare('SELECT * FROM note_history WHERE id = ?').get(id);
    if (!item) return null;
    const restore = db.transaction(() => {
      const current = db.prepare('SELECT title, content, mood, is_favorite FROM notes WHERE note_date = ?').get(item.note_date);
      if (current) db.prepare('INSERT INTO note_history (note_date, title, content, mood, is_favorite, snapshot_at) VALUES (?, ?, ?, ?, ?, ?)').run(item.note_date, current.title, current.content, current.mood, current.is_favorite, new Date().toISOString());
      db.prepare(`UPDATE notes SET title = ?, content = ?, mood = ?, is_favorite = ?, deleted_at = NULL, updated_at = ? WHERE note_date = ?`).run(item.title, item.content, item.mood, item.is_favorite, new Date().toISOString(), item.note_date);
      db.prepare(`DELETE FROM note_history WHERE note_date = ? AND id NOT IN (SELECT id FROM note_history WHERE note_date = ? ORDER BY id DESC LIMIT 5)`).run(item.note_date, item.note_date);
    });
    restore();
    return db.prepare('SELECT * FROM notes WHERE note_date = ?').get(item.note_date);
  });

  ipcMain.handle('notes:delete', (_, date) => {
    db.prepare("UPDATE notes SET deleted_at = datetime('now') WHERE note_date = ?").run(date);
    return true;
  });

  ipcMain.handle('notes:set-favorite', (_, { date, favorite }) => {
    db.prepare('UPDATE notes SET is_favorite = ? WHERE note_date = ?').run(favorite ? 1 : 0, date);
    return true;
  });

  ipcMain.handle('notes:random', (_, favoritesOnly = false) => {
    const favoriteClause = favoritesOnly ? 'AND n.is_favorite = 1' : '';
    return db.prepare(`
      SELECT n.note_date FROM notes n
      WHERE n.deleted_at IS NULL AND (trim(n.title) <> '' OR trim(n.content) <> ''
        OR EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_date = n.note_date)
        OR EXISTS (SELECT 1 FROM stickers s WHERE s.note_date = n.note_date))
        ${favoriteClause}
      ORDER BY RANDOM() LIMIT 1
    `).get() || null;
  });

  ipcMain.handle('notes:search', (_, rawQuery) => {
    const query = String(rawQuery || '').trim();
    if (!query) return [];
    const pattern = `%${query}%`;
    return db.prepare(`
      SELECT n.note_date, n.title, n.content, n.mood, n.is_favorite, n.updated_at,
        GROUP_CONCAT(t.name, ', ') AS tags
      FROM notes n
      LEFT JOIN note_tags nt ON nt.note_date = n.note_date
      LEFT JOIN tags t ON t.id = nt.tag_id
      WHERE n.deleted_at IS NULL AND (n.note_date LIKE ? OR n.title LIKE ? OR n.content LIKE ?
        OR EXISTS (
          SELECT 1 FROM note_tags snt JOIN tags st ON st.id = snt.tag_id
          WHERE snt.note_date = n.note_date AND st.name LIKE ?
        ))
      GROUP BY n.note_date ORDER BY n.note_date DESC
    `).all(pattern, pattern, pattern, pattern);
  });

  ipcMain.handle('notes:favorites', () => db.prepare(`
    SELECT n.note_date, n.title, n.content, n.mood, n.is_favorite, n.updated_at,
      GROUP_CONCAT(t.name, ', ') AS tags
    FROM notes n
    LEFT JOIN note_tags nt ON nt.note_date = n.note_date
    LEFT JOIN tags t ON t.id = nt.tag_id
    WHERE n.is_favorite = 1 AND n.deleted_at IS NULL
    GROUP BY n.note_date ORDER BY n.note_date DESC
  `).all());

  ipcMain.handle('notes:trash', () => db.prepare(`
    SELECT n.note_date, n.title, n.content, n.mood, n.deleted_at,
      GROUP_CONCAT(t.name, ', ') AS tags
    FROM notes n
    LEFT JOIN note_tags nt ON nt.note_date = n.note_date
    LEFT JOIN tags t ON t.id = nt.tag_id
    WHERE n.deleted_at IS NOT NULL
    GROUP BY n.note_date ORDER BY n.deleted_at DESC
  `).all());

  ipcMain.handle('notes:restore', (_, date) => {
    db.prepare('UPDATE notes SET deleted_at = NULL WHERE note_date = ?').run(date);
    return true;
  });

  ipcMain.handle('notes:purge', (_, date) => {
    db.transaction(() => {
      db.prepare('DELETE FROM note_tags WHERE note_date = ?').run(date);
      db.prepare('DELETE FROM stickers WHERE note_date = ?').run(date);
      db.prepare('DELETE FROM notes WHERE note_date = ?').run(date);
    })();
    return true;
  });

  ipcMain.handle('notes:pick-attachment', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择正文图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = nativeImage.createFromPath(result.filePaths[0]);
    if (source.isEmpty()) throw new Error('无法读取所选图片');
    const size = source.getSize();
    const image = size.width > 1600 ? source.resize({ width: 1600, quality: 'good' }) : source;
    return `data:image/png;base64,${image.toPNG().toString('base64')}`;
  });

  ipcMain.handle('notes:import-dropped-attachment', (_, filePath) => {
    const extension = path.extname(String(filePath)).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) throw new Error('仅支持 JPG、PNG 和 WebP 图片');
    const source = nativeImage.createFromPath(filePath);
    if (source.isEmpty()) throw new Error('无法读取拖入的图片');
    const size = source.getSize();
    const image = size.width > 1600 ? source.resize({ width: 1600, quality: 'good' }) : source;
    return `data:image/png;base64,${image.toPNG().toString('base64')}`;
  });

  ipcMain.handle('notes:export-pdf', async (_, note) => {
    const safeTitle = String(note.title || note.note_date || 'Angelina Note').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
    const result = await dialog.showSaveDialog({
      title: '导出日志 PDF',
      defaultPath: `${safeTitle}.pdf`,
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }]
    });
    if (result.canceled || !result.filePath) return null;

    const printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
    const stickerMarkup = (note.stickers || []).map(sticker => {
      const sourcePath = sticker.asset.startsWith('ui:')
        ? path.join(app.getAppPath(), 'Angelina', 'UI素材', `${sticker.asset.slice(3)}.png`)
        : path.join(app.getAppPath(), 'Angelina', 'PNG', `${sticker.asset}.png`);
      if (!fs.existsSync(sourcePath)) return '';
      const image = `data:image/png;base64,${fs.readFileSync(sourcePath).toString('base64')}`;
      const scale = Number(sticker.scale || 1) * .72;
      const x = Math.round(Number(sticker.x || 0) * .72);
      const y = Math.round(Number(sticker.y || 0) * .72 + 100);
      return `<img class="pdf-sticker" src="${image}" style="left:${x}px;top:${y}px;width:${Math.round(120 * scale)}px;opacity:${Math.max(0.1, Math.min(1, Number(sticker.opacity ?? 1)))};transform:rotate(${Number(sticker.rotation || 0)}deg)">`;
    }).join('');
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><style>
      @page { size: A4; margin: 18mm 16mm; }
      body { color: #20242b; font: 15px/1.85 Georgia, "Microsoft YaHei", serif; }
      header { margin-bottom: 26px; padding-bottom: 14px; border-bottom: 2px solid #1f6fbd; }
      .date { color: #1f6fbd; font: 700 11px Arial, "Microsoft YaHei", sans-serif; letter-spacing: 1.2px; }
      h1 { margin: 6px 0 0; font-size: 28px; line-height: 1.25; }
      .mood { margin-top: 8px; color: #68717e; font: 12px Arial, "Microsoft YaHei", sans-serif; }
      main img { display: block; max-width: 100%; max-height: 170mm; height: auto; margin: 16px auto; object-fit: contain; }
      main blockquote { margin: 16px 0; padding-left: 14px; border-left: 3px solid #e96560; color: #455a73; }
      main { overflow-wrap: anywhere; word-break: break-word; }
      main, main * { background: transparent !important; }
      .pdf-stickers { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
      .pdf-sticker { position: absolute; height: auto; object-fit: contain; opacity: .92; }
      header, main { position: relative; z-index: 1; }
    </style></head><body><div class="pdf-stickers">${stickerMarkup}</div><header><div class="date">${escape(note.note_date)}</div><h1>${escape(note.title || '无标题日志')}</h1><div class="mood">${escape(note.mood || '')}</div></header><main>${note.content || '<p></p>'}</main></body></html>`;
    const temporaryDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'angelina-note-pdf-'));
    const temporaryHtml = path.join(temporaryDir, 'export.html');
    fs.writeFileSync(temporaryHtml, html, 'utf8');
    try {
      await printWindow.loadFile(temporaryHtml);
      const pdf = await printWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
      fs.writeFileSync(result.filePath, pdf);
      return result.filePath;
    } finally {
      if (!printWindow.isDestroyed()) printWindow.destroy();
      fs.rmSync(temporaryDir, { recursive: true, force: true });
    }
  });

  ipcMain.handle('data:export', async () => {
    const result = await dialog.showSaveDialog({
      title: '导出 Angelina Note 备份',
      defaultPath: `angelina-note-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON 备份', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return null;
    const backup = {
      format: 'angelina-note-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      years: db.prepare('SELECT * FROM years ORDER BY year').all(),
      notes: db.prepare('SELECT * FROM notes ORDER BY note_date').all(),
      tags: db.prepare('SELECT * FROM tags ORDER BY id').all(),
      noteTags: db.prepare('SELECT * FROM note_tags ORDER BY note_date, tag_id').all(),
      stickers: db.prepare('SELECT * FROM stickers ORDER BY note_date, z_index').all()
    };
    fs.writeFileSync(result.filePath, JSON.stringify(backup, null, 2), 'utf8');
    return result.filePath;
  });

  ipcMain.handle('data:import', async () => {
    const result = await dialog.showOpenDialog({
      title: '恢复 Angelina Note 备份',
      properties: ['openFile'],
      filters: [{ name: 'JSON 备份', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const backup = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
    if (backup.format !== 'angelina-note-backup' || !Array.isArray(backup.years) ||
      !Array.isArray(backup.notes) || !Array.isArray(backup.tags) ||
      !Array.isArray(backup.noteTags) || !Array.isArray(backup.stickers)) {
      throw new Error('所选文件不是有效的 Angelina Note 备份');
    }
    db.transaction(() => {
      db.prepare('DELETE FROM note_tags').run();
      db.prepare('DELETE FROM stickers').run();
      db.prepare('DELETE FROM notes').run();
      db.prepare('DELETE FROM tags').run();
      db.prepare('DELETE FROM years').run();
      const addYear = db.prepare('INSERT INTO years (year, title, subtitle, cover_image, cover_title_image) VALUES (?, ?, ?, ?, ?)');
      backup.years.forEach(item => addYear.run(item.year, item.title || String(item.year), item.subtitle || '', item.cover_image || '', item.cover_title_image || ''));
      const addNote = db.prepare('INSERT INTO notes (note_date, title, content, mood, updated_at, is_favorite) VALUES (?, ?, ?, ?, ?, ?)');
      backup.notes.forEach(item => addNote.run(item.note_date, item.title || '', item.content || '', item.mood || 'sunny', item.updated_at || new Date().toISOString(), item.is_favorite ? 1 : 0));
      const addTag = db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)');
      backup.tags.forEach(item => addTag.run(item.id, item.name, item.color));
      const addLink = db.prepare('INSERT INTO note_tags (note_date, tag_id) VALUES (?, ?)');
      backup.noteTags.forEach(item => addLink.run(item.note_date, item.tag_id));
      const addSticker = db.prepare('INSERT INTO stickers (id, note_date, asset, x, y, rotation, scale, opacity, z_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      backup.stickers.forEach(item => addSticker.run(item.id, item.note_date, item.asset, item.x, item.y, item.rotation, item.scale, item.opacity ?? 1, item.z_index));
    })();
    return result.filePaths[0];
  });

  ipcMain.handle('tags:list', () => db.prepare('SELECT * FROM tags ORDER BY id').all());
  ipcMain.handle('tags:create', (_, tag) => {
    const result = db.prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)').run(tag.name.trim(), tag.color);
    return result.changes ? { id: result.lastInsertRowid, ...tag } : db.prepare('SELECT * FROM tags WHERE name = ?').get(tag.name.trim());
  });
  ipcMain.handle('tags:delete', (_, tagId) => {
    db.transaction(() => {
      db.prepare('DELETE FROM note_tags WHERE tag_id = ?').run(tagId);
      db.prepare('DELETE FROM tags WHERE id = ?').run(tagId);
    })();
    return true;
  });
}

app.whenReady().then(() => {
  initDatabase();
  registerIpc();
  createWindow();
  createTray();
  app.on('activate', () => showMainWindow('home'));
});

app.on('window-all-closed', () => {
  if (isQuitting) app.quit();
});

app.on('before-quit', () => { isQuitting = true; db?.close(); });
