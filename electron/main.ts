import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { setupPty } from './pty-manager'
import { setupGitHandlers } from './git-service'
import { setupSnapshotHandlers } from './snapshot-manager'
import { setupOrchestrator } from './orchestrator'
import { setupLLMHandlers } from './llm-service'
import { setupResearchHandlers } from './research-service'
import { keyManager } from './key-manager'

// Disable GPU acceleration to avoid cache permission issues
app.disableHardwareAcceleration()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
    win = new BrowserWindow({
        icon: path.join(process.env.VITE_PUBLIC || '', 'electron-vite.svg'),
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.mjs'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    })

    win.webContents.openDevTools()

    if (VITE_DEV_SERVER_URL) {
        win.loadURL(VITE_DEV_SERVER_URL)
    } else {
        win.loadFile(path.join(process.env.DIST || '', 'index.html'))
    }
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
        win = null
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

app.whenReady().then(() => {
    createWindow()
    setupGitHandlers()
    if (win) {
        setupPty(win)
        setupSnapshotHandlers(win)
        setupOrchestrator(win)
        setupLLMHandlers(win)
        setupResearchHandlers()

        // Key Management IPC
        ipcMain.handle('key-set', async (_event, provider: string, key: string) => {
            return await keyManager.setApiKey(provider, key);
        });

        ipcMain.handle('key-has', (_event, provider: string) => {
            return !!keyManager.getApiKey(provider);
        });

        ipcMain.handle('key-delete', (_event, provider: string) => {
            keyManager.deleteApiKey(provider);
            return true;
        });
    }

    // Folder selection dialog
    ipcMain.handle('select-folder', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Select Workspace Folder'
        })
        if (result.canceled || result.filePaths.length === 0) {
            return null
        }
        return result.filePaths[0]
    })
})
