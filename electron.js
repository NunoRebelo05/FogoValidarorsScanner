const { app, BrowserWindow } = require('electron');
const path = require('path');

// Start the Express server embedded
const server = require('./server');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'Fogo Validator Explorer',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true
  });

  mainWindow.loadURL('http://localhost:3000');

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => { app.quit(); });

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
