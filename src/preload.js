const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('angelina', {
  // 更新相关
  checkUpdate: () => ipcRenderer.send('check-update'),
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_, text) => callback(text)),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (_, num) => callback(num)),

  listCustomFonts: () => ipcRenderer.invoke('fonts:list'),
  importCustomFont: () => ipcRenderer.invoke('fonts:import'),
  listYears: () => ipcRenderer.invoke('years:list'),
  ensureYears: years => ipcRenderer.invoke('years:ensure', years),
  saveYear: year => ipcRenderer.invoke('years:save', year),
  pickYearCover: () => ipcRenderer.invoke('years:pick-cover'),
  pickYearTitleImage: () => ipcRenderer.invoke('years:pick-title-image'),
  getYearNotes: (year, tagId) => ipcRenderer.invoke('notes:year', { year, tagId }),
  getNote: date => ipcRenderer.invoke('notes:get', date),
  saveNote: note => ipcRenderer.invoke('notes:save', note),
  setNoteFavorite: (date, favorite) => ipcRenderer.invoke('notes:set-favorite', { date, favorite }),
  getRandomNote: favoritesOnly => ipcRenderer.invoke('notes:random', favoritesOnly),
  searchNotes: query => ipcRenderer.invoke('notes:search', query),
  listFavoriteNotes: () => ipcRenderer.invoke('notes:favorites'),
  pickNoteAttachment: () => ipcRenderer.invoke('notes:pick-attachment'),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  listTags: () => ipcRenderer.invoke('tags:list'),
  createTag: tag => ipcRenderer.invoke('tags:create', tag),
  deleteTag: tagId => ipcRenderer.invoke('tags:delete', tagId)
});
