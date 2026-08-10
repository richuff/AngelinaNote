const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');

let db;

function initDatabase() {
  db = new Database(path.join(app.getPath('userData'), 'angelina-note.sqlite'));
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
      z_index INTEGER NOT NULL DEFAULT 1
    );
  `);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1050,
    minHeight: 700,
    title: 'Angelina Note',
    backgroundColor: '#f7f4ea',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

function registerIpc() {
  ipcMain.handle('years:list', () => db.prepare(`
    SELECT y.year, y.title, y.subtitle,
      COUNT(DISTINCT n.note_date) AS note_count,
      MAX(n.updated_at) AS last_update
    FROM years y LEFT JOIN notes n ON CAST(substr(n.note_date, 1, 4) AS INTEGER) = y.year
    GROUP BY y.year ORDER BY y.year
  `).all());

  ipcMain.handle('years:ensure', (_, years) => {
    const insert = db.prepare('INSERT OR IGNORE INTO years (year, title, subtitle) VALUES (?, ?, ?)');
    db.transaction(() => years.forEach(year => insert.run(year, `${year}`, '我的年度手帐')))();
    return true;
  });

  ipcMain.handle('years:save', (_, payload) => {
    db.prepare('UPDATE years SET title = ?, subtitle = ? WHERE year = ?')
      .run(payload.title.trim() || String(payload.year), payload.subtitle.trim(), payload.year);
    return true;
  });

  ipcMain.handle('notes:year', (_, { year, tagId }) => {
    const params = [String(year)];
    let tagClause = '';
    if (tagId) {
      tagClause = 'AND EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_date = n.note_date AND nt.tag_id = ?)';
      params.push(tagId);
    }
    return db.prepare(`
      SELECT n.note_date, n.title, n.content, n.mood, n.updated_at,
        GROUP_CONCAT(t.name, ', ') AS tags
      FROM notes n
      LEFT JOIN note_tags nt ON nt.note_date = n.note_date
      LEFT JOIN tags t ON t.id = nt.tag_id
      WHERE substr(n.note_date, 1, 4) = ? ${tagClause}
      GROUP BY n.note_date ORDER BY n.note_date
    `).all(...params);
  });

  ipcMain.handle('notes:get', (_, date) => {
    const note = db.prepare('SELECT * FROM notes WHERE note_date = ?').get(date) || {
      note_date: date, title: '', content: '', mood: 'sunny', updated_at: null
    };
    note.tags = db.prepare(`SELECT t.* FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_date = ?`).all(date);
    note.stickers = db.prepare('SELECT * FROM stickers WHERE note_date = ? ORDER BY z_index').all(date);
    return note;
  });

  ipcMain.handle('notes:save', (_, note) => {
    const save = db.transaction(() => {
      db.prepare(`INSERT INTO notes (note_date, title, content, mood, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(note_date) DO UPDATE SET title=excluded.title, content=excluded.content,
          mood=excluded.mood, updated_at=excluded.updated_at`)
        .run(note.note_date, note.title, note.content, note.mood, new Date().toISOString());
      db.prepare('DELETE FROM note_tags WHERE note_date = ?').run(note.note_date);
      const link = db.prepare('INSERT OR IGNORE INTO note_tags (note_date, tag_id) VALUES (?, ?)');
      note.tagIds.forEach(id => link.run(note.note_date, id));
      db.prepare('DELETE FROM stickers WHERE note_date = ?').run(note.note_date);
      const add = db.prepare(`INSERT INTO stickers (id, note_date, asset, x, y, rotation, scale, z_index)
        VALUES (@id, @note_date, @asset, @x, @y, @rotation, @scale, @z_index)`);
      note.stickers.forEach(sticker => add.run({ ...sticker, note_date: note.note_date }));
    });
    save();
    return true;
  });

  ipcMain.handle('tags:list', () => db.prepare('SELECT * FROM tags ORDER BY id').all());
  ipcMain.handle('tags:create', (_, tag) => {
    const result = db.prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)').run(tag.name.trim(), tag.color);
    return result.changes ? { id: result.lastInsertRowid, ...tag } : db.prepare('SELECT * FROM tags WHERE name = ?').get(tag.name.trim());
  });
}

app.whenReady().then(() => {
  initDatabase();
  registerIpc();
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length || createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => db?.close());
