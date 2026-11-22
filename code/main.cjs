'use strict';

const { mkdirSync } = require('node:fs');
const { isAbsolute, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, dialog, ipcMain, Menu, session } = require('electron');
const { InputError, openStorage } = require('./storage.cjs');
const { BackupError, readBackup, writeBackup } = require('./backup.cjs');
const { copy, inputFailure, menuTemplate } = require('./main-language.cjs');

const indexPath = join(__dirname, 'index.html');
const indexUrl = pathToFileURL(indexPath).href;
let mainWindow;
let database;
let language = 'zh-CN';

function applyLanguage() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(language)));
  mainWindow.setTitle(copy[language].title);
}

const ok = value => ({ ok: true, value });
const failure = code => ({ ok: false, message: copy[language][code] });
function databaseFailure(method, error) {
  if (error instanceof InputError) return inputFailure(language, error);
  console.error(`Workspace operation ${method} failed:`, error);
  const { operations, dbReasons, dbError, retry } = copy[language];
  return { ok: false, message: operations[method] + (dbReasons[error.errcode & 255] ?? dbError) + retry };
}

async function start() {
  // Development launches may opt into a separate profile without touching ordinary user data.
  const profile = process.env.WORKSPACE_DATA_DIR;
  if (profile !== undefined) {
    if (!isAbsolute(profile)) throw new Error('WORKSPACE_DATA_DIR must be an absolute path');
    mkdirSync(profile, { recursive: true });
    app.setPath('userData', profile);
    app.setPath('sessionData', profile);
  }
  // Electron keys the lock by userData; set the profile before taking it.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.commandLine.appendSwitch('disable-background-networking');
  // Let the native date control use the document language instead of the host default.
  app.commandLine.appendSwitch('enable-blink-features', 'LangAttributeAwareFormControlUI');
  await app.whenReady();

  const databasePath = join(app.getPath('userData'), 'workspace.sqlite');
  database = openStorage(databasePath);
  language = database.getLanguage();
  // Disabling checks alone does not stop Electron from fetching configured dictionaries.
  session.defaultSession.setSpellCheckerLanguages([]);
  session.defaultSession.setSpellCheckerEnabled(false);
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 480,
    minHeight: 420,
    backgroundColor: '#f7faf8',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false, // Avoid Chromium's automatic dictionary download.
    },
  });
  applyLanguage();
  mainWindow.on('page-title-updated', event => event.preventDefault());
  const contents = mainWindow.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());

  const trusted = event => {
    const frame = event.senderFrame;
    return event.sender === contents && frame?.url === indexUrl && !frame.parent;
  };
  ipcMain.handle('workspace:storage-status', (event, ...args) => {
    if (!trusted(event) || args.length) throw new Error('Invalid storage status request');
    return 'ready';
  });
  const handle = (channel, method, arity, operation = database[method]) => {
    ipcMain.handle(`workspace:${channel}`, async (event, ...args) => {
      if (!trusted(event)) throw new Error('Invalid workspace request sender');
      if (args.length !== arity) return failure('invalidInput');
      try {
        return ok(await operation(...args));
      } catch (error) {
        if (error instanceof BackupError) {
          if (error.cause) console.error(`Workspace file operation ${error.code} failed:`, error.cause);
          return failure(error.code);
        }
        return databaseFailure(method, error);
      }
    });
  };
  handle('list-projects', 'listProjects', 0);
  handle('get-project', 'getProject', 1);
  handle('create-project', 'createProject', 1, input => database.createProject(input, copy[language].statuses));
  handle('update-project', 'updateProject', 2);
  handle('create-task', 'createTask', 2);
  handle('update-task', 'updateTask', 3);
  handle('move-task', 'moveTask', 3);
  handle('set-project-archived', 'setProjectArchived', 2);
  handle('set-task-archived', 'setTaskArchived', 3);
  handle('create-status', 'createStatus', 2);
  handle('rename-status', 'renameStatus', 3);
  handle('reorder-statuses', 'reorderStatuses', 2);
  handle('delete-status', 'deleteStatus', 3);
  handle('get-language', 'getLanguage', 0, () => language);
  handle('set-language', 'setLanguage', 1, value => {
    if (value !== 'zh-CN' && value !== 'en') throw new InputError('invalidLanguage');
    language = database.setLanguage(value);
    applyLanguage();
    return language;
  });

  handle('get-theme', 'getTheme', 0);
  handle('set-theme', 'setTheme', 1, value => {
    if (!['sage', 'lavender', 'blue', 'yellow', 'white'].includes(value)) throw new InputError('invalidTheme');
    return database.setTheme(value);
  });

  let backupBusy = false;
  function backupOperation(restore) {
    return async () => {
      if (backupBusy) throw new BackupError('backupBusy');
      backupBusy = true;
      const fileError = restore ? 'backupRead' : 'backupWrite';
      const fileAccess = async work => {
        try { return await work(); }
        catch (error) {
          if (error instanceof BackupError) throw error;
          console.error(`Workspace file operation ${fileError} failed:`, error);
          throw new BackupError(fileError);
        }
      };
      try {
        if (restore) database.requireEmpty();
        const { saveDialog, openDialog, fileLabel } = copy[language];
        const filters = [{ name: fileLabel, extensions: ['json'] }];
        if (restore) {
          const selection = await fileAccess(() => dialog.showOpenDialog(mainWindow, { title: openDialog, filters, properties: ['openFile'] }));
          if (selection.canceled) return null;
          database.restoreBackup(readBackup(selection.filePaths[0]));
          return true;
        }
        const selection = await fileAccess(() => dialog.showSaveDialog(mainWindow, { title: saveDialog, filters, defaultPath: 'workspace-backup.json' }));
        if (selection.canceled) return null;
        writeBackup(selection.filePath, database.visitBackup, databasePath);
        return true;
      } finally { backupBusy = false; }
    };
  }
  handle('export-backup', 'exportBackup', 0, backupOperation(false));
  handle('restore-backup', 'restoreBackup', 0, backupOperation(true));
  await mainWindow.loadFile(indexPath);
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => database?.close());
start().catch(error => {
  console.error('Unable to start the workspace:', error);
  const { startupTitle, startupError } = copy[language];
  dialog.showErrorBox(startupTitle, startupError);
  app.exit(1);
});
