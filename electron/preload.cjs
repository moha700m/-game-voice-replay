const { contextBridge, ipcRenderer } = require('electron');

ipcRenderer.on('desktop-hotkey', (_event, code) => {
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      code,
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
});

contextBridge.exposeInMainWorld('gameVoiceDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: '0.1.0',
});
