const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hoot', {
  ask: (text, withScreen) => ipcRenderer.invoke('ask', { text, withScreen }),
  reset: () => ipcRenderer.invoke('chat:reset'),
  openScreenSettings: () => ipcRenderer.invoke('open:screenSettings'),
  bubble: (open) => ipcRenderer.send('bubble', open),
  space: () => ipcRenderer.invoke('win:space'),
  resize: (w, h) => ipcRenderer.send('win:resize', { w, h }),
  dragStart: () => ipcRenderer.send('drag:start'),
  dragMove: (dx, dy) => ipcRenderer.send('drag:move', { dx, dy }),
  dragEnd: () => ipcRenderer.send('drag:end'),
  click: () => ipcRenderer.send('pet:click'),
  petMenu: () => ipcRenderer.send('pet:menu'),
  on: (channel, cb) => {
    if (['pet:open', 'pet:close', 'pet:look', 'chat:shot', 'chat:delta', 'chat:reset', 'test:ask'].includes(channel)) ipcRenderer.on(channel, (_e, payload) => cb(payload));
  }
});
