import { app, shell, BrowserWindow, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { existsSync } from 'node:fs'
import { Channels } from '@shared/ipc'
import icon from '../../resources/icon.png?asset'
import { openDb } from './db/connection'
import { BooksRepo } from './db/repositories/books'
import { registerIpc } from './ipc'
import { importAsBooks } from './ipc/library'
import { scheduleDailyBackup } from './export/backup'
import { initLogging, registerAppIpc } from './logging'

// Tests (and power users) can isolate all app data in a custom folder.
if (process.env.PAGETURN_USER_DATA) app.setPath('userData', process.env.PAGETURN_USER_DATA)
initLogging()

// Forces the slide-transition fallback (tests, troubleshooting GPU problems).
const disableWebgl = process.env.PAGETURN_DISABLE_WEBGL === '1'
if (disableWebgl) app.disableHardwareAcceleration()

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'PageTurn',
    show: false,
    autoHideMenuBar: true,
    // No OS title bar: the app runs to the top edge and draws its own minimise / maximise /
    // close buttons (renderer WindowControls; macOS keeps its traffic lights).
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? {} : { icon }), // macOS uses the bundle icon
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webgl: !disableWebgl
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}

/** .pdf paths passed on the command line (file association / "Open with"). */
function pdfArgs(argv: string[]): string[] {
  return argv.slice(1).filter((a) => /\.pdf$/i.test(a) && existsSync(a))
}

let mainWindow: BrowserWindow | null = null
let books: BooksRepo | null = null

async function openFromArgs(argv: string[]): Promise<void> {
  const paths = pdfArgs(argv)
  if (!mainWindow || !books || paths.length === 0) return
  try {
    const imported = await importAsBooks(books, paths)
    const last = imported[imported.length - 1]
    if (last) mainWindow.webContents.send(Channels.libraryOpenRequest, last)
  } catch (err) {
    console.error('Failed to open file from arguments', err)
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    void openFromArgs(argv)
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.pageturn.app')
    // No app menu: its hidden accelerators (Ctrl+±/0 zoom) would fight the reader's own keys.
    Menu.setApplicationMenu(null)

    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    const db = openDb(join(app.getPath('userData'), 'pageturn.db'))
    books = new BooksRepo(db)
    mainWindow = createWindow()
    registerIpc(db, mainWindow)
    registerAppIpc(mainWindow)
    // Daily JSON backup to userData/backups (keeps the last 7).
    scheduleDailyBackup(db, join(app.getPath('userData'), 'backups'))
    mainWindow.webContents.once('did-finish-load', () => void openFromArgs(process.argv))

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
