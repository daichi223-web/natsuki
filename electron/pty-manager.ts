import { BrowserWindow, ipcMain } from 'electron'
import * as pty from 'node-pty'
import os from 'os'
import * as fs from 'fs'
import { EventEmitter } from 'events';
import { logEvent } from './log-service';

// --- BuilderRunner Interface ---
export const builder = new EventEmitter();

let ptyProcess: pty.IPty | null = null;
let ptyMetrics = {
    pid: 0,
    spawnTime: 0,
    bytesReceived: 0,
    lastOutputTime: 0,
    cwd: '',
    command: '',
    killSignal: null as string | null,
    exitCode: null as number | null
};

// Idle detection for autonomous loop
let idleTimer: NodeJS.Timeout | null = null;
let idleCallback: (() => void) | null = null;
const IDLE_THRESHOLD_MS = 5000; // 5 seconds of no output = idle

function resetIdleTimer() {
    if (idleTimer) {
        clearTimeout(idleTimer);
    }
    if (idleCallback) {
        idleTimer = setTimeout(() => {
            console.log('[PTY] Idle detected after', IDLE_THRESHOLD_MS, 'ms');
            if (idleCallback) idleCallback();
        }, IDLE_THRESHOLD_MS);
    }
}

export function setIdleCallback(callback: (() => void) | null) {
    idleCallback = callback;
    if (!callback && idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
}

// "Ring buffer" for recent logs (raw text)
let recentLogs: string[] = [];
const MAX_LOG_LINES = 50;

function appendLog(text: string) {
    const lines = text.split(/\r?\n/);
    lines.forEach(line => {
        if (line.trim().length > 0) {
            recentLogs.push(line);
        }
    });
    if (recentLogs.length > MAX_LOG_LINES) {
        recentLogs = recentLogs.slice(recentLogs.length - MAX_LOG_LINES);
    }
}

// --- Programmatic Control ---

export function startSession(cwd: string) {
    if (ptyProcess) {
        try {
            ptyProcess.kill();
        } catch (e) { console.error('Failed to kill pty', e); }
        ptyProcess = null;
    }

    const shell = os.platform() === 'win32' ? 'cmd.exe' : 'bash';
    const targetCwd = cwd || os.homedir();

    // Attempt to find Claude executable
    const hardcodedPath = 'C:\\Users\\a713678\\AppData\\Roaming\\npm\\claude.cmd';
    let claudeCommand = 'claude'; // Default to PATH

    if (os.platform() === 'win32') {
        if (fs.existsSync(hardcodedPath)) {
            claudeCommand = hardcodedPath;
        } else {
            // Try 'claudecode' or 'claude' from PATH
            claudeCommand = 'claude';
        }
    }

    console.log(`[Builder] Spawning ${shell} in ${targetCwd} (using ${claudeCommand})`);
    logEvent('pty-spawn', { command: shell, cwd: targetCwd, claude: claudeCommand });

    // Reset metrics
    ptyMetrics = {
        pid: 0,
        spawnTime: Date.now(),
        bytesReceived: 0,
        lastOutputTime: 0,
        cwd: targetCwd,
        command: shell,
        killSignal: null,
        exitCode: null
    };
    recentLogs = [];

    try {
        ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: targetCwd,
            env: process.env as any,
            useConpty: true
        });

        console.log('[Builder] PTY spawned, PID:', ptyProcess.pid);

        // Force UTF-8 on Windows
        if (os.platform() === 'win32') {
            ptyProcess.write('chcp 65001\r');
        }

        let autoStartSent = false;
        ptyProcess.onData((data: string) => {
            ptyMetrics.bytesReceived += data.length;
            ptyMetrics.lastOutputTime = Date.now();
            appendLog(data);
            resetIdleTimer();

            // Emit for Orchestrator
            builder.emit('data', data);

            // Auto-start Claude on first prompt/data (buffered)
            if (!autoStartSent) {
                // heuristic: wait a bit after first data or look for prompt ">"
                // For simplicity/robustness, just delay 1s after first data
                autoStartSent = true;
                setTimeout(() => {
                    if (ptyProcess) {
                        console.log('[Builder] Auto-starting Claude:', claudeCommand);
                        ptyProcess.write(`${claudeCommand}\r`);
                    }
                }, 1000);
            }
        });

        ptyProcess.onExit(({ exitCode, signal }: { exitCode: number, signal?: number }) => {
            const uptimeMs = Date.now() - ptyMetrics.spawnTime;
            console.log(`[Builder] PTY exited code=${exitCode} signal=${signal}`);
            logEvent('pty-exit', { exitCode, signal, uptimeMs });

            ptyMetrics.exitCode = exitCode;
            ptyMetrics.killSignal = signal ? String(signal) : null;

            builder.emit('exit', { exitCode, signal });
            ptyProcess = null;
        });

    } catch (error) {
        console.error('[Builder] Failed to spawn pty', error);
        builder.emit('error', error);
    }
}

export function stopSession() {
    if (ptyProcess) {
        ptyProcess.kill();
        ptyProcess = null;
    }
}

export function writeToSession(data: string) {
    if (ptyProcess) {
        ptyProcess.write(data);
    }
}


export function setupPty(win: BrowserWindow) {
    // --- Connect Builder Events to Frontend ---
    builder.on('data', (data) => {
        if (!win.isDestroyed()) win.webContents.send('terminal-data', data);
    });

    builder.on('exit', (info) => {
        if (!win.isDestroyed()) win.webContents.send('terminal-exit', info);
    });

    builder.on('error', (err) => {
        if (!win.isDestroyed()) win.webContents.send('terminal-data', `\r\nError: ${err}\r\n`);
    });

    // --- IPC Handlers ---

    ipcMain.handle('get-diagnostics', () => {
        return {
            process: {
                pid: ptyProcess ? ptyProcess.pid : ptyMetrics.pid,
                isAlive: !!ptyProcess,
                exitCode: ptyMetrics.exitCode,
                signal: ptyMetrics.killSignal,
                spawnCommand: ptyMetrics.command,
                spawnCwd: ptyMetrics.cwd,
                spawnTime: ptyMetrics.spawnTime,
                uptimeMs: ptyMetrics.spawnTime ? Date.now() - ptyMetrics.spawnTime : 0
            },
            pty: {
                bytesReceived: ptyMetrics.bytesReceived,
                lastOutputTime: ptyMetrics.lastOutputTime,
                timeSinceLastOutput: ptyMetrics.lastOutputTime > 0 ? Date.now() - ptyMetrics.lastOutputTime : null,
                recentLogs: recentLogs
            },
            timestamp: Date.now()
        };
    });

    ipcMain.handle('get-pty-metrics', () => {
        return {
            pid: ptyProcess ? ptyProcess.pid : 0,
            spawnTime: ptyMetrics.spawnTime,
            bytesReceived: ptyMetrics.bytesReceived,
            lastOutputTime: ptyMetrics.lastOutputTime,
            isRunning: !!ptyProcess
        };
    });

    ipcMain.handle('restart-pty', (_event) => {
        stopSession();
        return { success: true };
    });


    ipcMain.on('terminal-init', (_event: any, cwd: string) => {
        startSession(cwd);
    });

    ipcMain.on('terminal-input', (_event: any, data: string) => {
        writeToSession(data);
    });

    ipcMain.on('terminal-resize', (_event: any, { cols, rows }: { cols: number, rows: number }) => {
        if (ptyProcess) {
            try {
                ptyProcess.resize(cols, rows);
            } catch (e) { console.error('Resize error', e); }
        }
    });

    ipcMain.on('terminal-kill', () => {
        stopSession();
    });
}

// Export for Snapshot Engine
export function getRecentLogs(): string[] {
    return [...recentLogs];
}

// Export for Orchestrator compatibility (Deprecated, use writeToSession)
export function sendToPty(data: string) {
    writeToSession(data);
}
