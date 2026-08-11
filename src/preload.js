const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('angelina', {
  listYears: () => ipcRenderer.invoke('years:list'),
  ensureYears: years => ipcRenderer.invoke('years:ensure', years),
  saveYear: year => ipcRenderer.invoke('years:save', year),
  pickYearCover: () => ipcRenderer.invoke('years:pick-cover'),
  getYearNotes: (year, tagId) => ipcRenderer.invoke('notes:year', { year, tagId }),
  getNote: date => ipcRenderer.invoke('notes:get', date),
  saveNote: note => ipcRenderer.invoke('notes:save', note),
  listTags: () => ipcRenderer.invoke('tags:list'),
  createTag: tag => ipcRenderer.invoke('tags:create', tag),
  deleteTag: tagId => ipcRenderer.invoke('tags:delete', tagId)
});
