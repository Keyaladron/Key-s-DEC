const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const { getFfmpegCommands, getVideoDuration } = require('./utils');

let currentProcess = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 600,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Videos', extensions: ['mkv', 'avi', 'mp4', 'mov'] }],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('open-save-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.on('convert', (event, { file, type, outputFolder }) => {
  if (!outputFolder) {
    outputFolder = path.dirname(file);
  }
  
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
  const output_file = path.join(outputFolder, `${path.basename(file, path.extname(file))}_${timestamp}_${type}.mp4`);
  const commands = getFfmpegCommands(type, file, output_file);
  
  if (!commands) {
    event.sender.send('conversion-result', 'Error generating ffmpeg commands');
    return;
  }

  const duration = getVideoDuration(file);

  console.log(`Running command: ${commands.pass1}`);
  currentProcess = exec(commands.pass1);

  currentProcess.stdout.on('data', (data) => {
    console.log(`Pass 1: ${data}`);
  });

  currentProcess.stderr.on('data', (data) => {
    const timeMatch = data.match(/time=(\d+:\d+:\d+\.\d+)/);
    if (timeMatch) {
      const currentTime = parseTimeToSeconds(timeMatch[1]);
      const progress = (currentTime / duration) * 50;
      event.sender.send('conversion-progress', { pass: 1, progress: progress.toFixed(2) });
    }
    console.error(`Pass 1 stderr: ${data}`);
  });

  currentProcess.on('close', (code) => {
    if (code !== 0) {
      event.sender.send('conversion-result', `Pass 1 failed with code ${code}`);
      return;
    }

    console.log(`Running command: ${commands.pass2}`);
    currentProcess = exec(commands.pass2);

    currentProcess.stdout.on('data', (data) => {
      console.log(`Pass 2: ${data}`);
    });

    currentProcess.stderr.on('data', (data) => {
      const timeMatch = data.match(/time=(\d+:\d+:\d+\.\d+)/);
      if (timeMatch) {
        const currentTime = parseTimeToSeconds(timeMatch[1]);
        const progress = 50 + (currentTime / duration) * 50;
        event.sender.send('conversion-progress', { pass: 2, progress: progress.toFixed(2) });
      }
      console.error(`Pass 2 stderr: ${data}`);
    });

    currentProcess.on('close', (code) => {
      if (code !== 0) {
        event.sender.send('conversion-result', `Pass 2 failed with code ${code}`);
        return;
      }

      console.log('Conversion completed successfully!');
      event.sender.send('conversion-complete', { message: 'Conversion completed successfully!', outputFile: output_file });
    });
  });
});

ipcMain.on('cancel-conversion', (event, { outputFile }) => {
  if (currentProcess) {
    currentProcess.kill('SIGINT');
    currentProcess = null;
    if (fs.existsSync(outputFile)) {
      fs.unlinkSync(outputFile);
    }
    event.sender.send('conversion-cancelled', { message: 'Conversion cancelled and incomplete file deleted.' });
  }
});

ipcMain.on('open-file-location', (event, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.on('preview-file', (event, filePath) => {
  shell.openPath(filePath);
});

function parseTimeToSeconds(time) {
  const parts = time.split(':');
  return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
}
