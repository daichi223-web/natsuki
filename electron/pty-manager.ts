import { BrowserWindow, ipcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import * as pty from 'node-pty';
import os from 'os';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { logEvent } from './log-service';
import { randomUUID } from 'crypto';

// Idle detection for Orchestrator
let idleTimer: NodeJS.Timeout | null = null;
let idleCallback: (() => void) | null = null;
const IDLE_THRESHOLD_MS = 5000;

function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    if (idleCallback) {
        idleTimer = setTimeout(() => {
            console.log('[PTY] Idle detected');
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

export const builder = new EventEmitter();

interface Session {
    pty: pty.IPty;
    cwd: string;
    metrics: {
        pid: number;
        spawnTime: number;
        bytesReceived: number;
        lastOutputTime: number;
    };
    logs: string[];
}

class PtyManager {
    private sessions = new Map<string, Session>();
    private claudePath: string | null = null;
    public activeSessionId: string | null = null;

    constructor() {
        this.resolveClaudePath();
    }

    private resolveClaudePath() {
        if (os.platform() !== 'win32') {
            this.claudePath = 'claude';
            return;
        }

        const hardcodedPath = 'C:\\Users\\a713678\\AppData\\Roaming\\npm\\claude.cmd';
        if (fs.existsSync(hardcodedPath)) {
            this.claudePath = hardcodedPath;
        } else {
            this.claudePath = 'claude';
        }
        console.log('[PtyManager] Resolved Claude Path:', this.claudePath);
    }

    create(cwd: string): string {
        const id = randomUUID();
        const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
        const targetCwd = cwd || os.homedir();

        console.log(`[PtyManager] Creating session ${id} in ${targetCwd}`);

        const ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: targetCwd,
            env: process.env as any,
            useConpty: true
        });

        // Initialize Session Data
        const session: Session = {
            pty: ptyProcess,
            cwd: targetCwd,
            metrics: {
                pid: ptyProcess.pid,
                spawnTime: Date.now(),
                bytesReceived: 0,
                lastOutputTime: 0
            },
            logs: []
        };
        this.sessions.set(id, session);
        this.activeSessionId = id; // Track as active

        // --- Event Handlers ---

        // 1. Initial Setup for Windows
        if (os.platform() === 'win32') {
            // Force UTF-8 (PowerShell usually handles this well, but chcp 65001 ensures ConPTY matches)
            ptyProcess.write('chcp 65001\r');
        }

        // 2. Data Handler
        let autoStartSent = false;
        ptyProcess.onData((data: string) => {
            session.metrics.bytesReceived += data.length;
            session.metrics.lastOutputTime = Date.now();

            // Log buffer (keep last 50 lines)
            const lines = data.split(/\r?\n/);
            lines.forEach(l => {
                if (l.trim()) session.logs.push(l);
            });
            if (session.logs.length > 50) session.logs = session.logs.slice(-50);

            // Emit safely with ID
            builder.emit('data', { sessionId: id, data });

            // Reset idle timer for Orchestrator
            resetIdleTimer();

            // 3. Auto-start Claude logic
            if (!autoStartSent) {
                autoStartSent = true;
                setTimeout(() => {
                    // Check if session still active
                    if (this.sessions.has(id)) {
                        const cmd = this.claudePath || 'claude';
                        const runCmd = os.platform() === 'win32' ? `& "${cmd}"` : cmd;
                        console.log(`[PtyManager] Auto-starting Claude in session ${id}: ${runCmd}`);
                        ptyProcess.write(`${runCmd}\r`);
                    }
                }, 1000); // 1s delay for shell readiness
            }
        });

        ptyProcess.onExit(({ exitCode, signal }) => {
            console.log(`[PtyManager] Session ${id} exited (code ${exitCode})`);
            logEvent('pty-exit', { sessionId: id, exitCode, signal });

            builder.emit('exit', { sessionId: id, exitCode, signal });
            this.sessions.delete(id);
        });

        return id;
    }

    write(id: string, data: string) {
        const session = this.sessions.get(id);
        if (session) {
            session.pty.write(data);
        } else {
            console.warn(`[PtyManager] Write dropped: Session ${id} not found`);
        }
    }

    resize(id: string, cols: number, rows: number) {
        const session = this.sessions.get(id);
        if (session) {
            try {
                session.pty.resize(cols, rows);
            } catch (e) { console.error('Resize error:', e); }
        }
    }

    kill(id: string) {
        const session = this.sessions.get(id);
        if (session) {
            console.log(`[PtyManager] Killing session ${id}`);
            session.pty.kill();
            this.sessions.delete(id);
        }
    }

    // For diagnostics (getting logs of a specific or latest session)
    getLogs(id?: string): string[] {
        if (id) return this.sessions.get(id)?.logs || [];
        // Fallback: get logs of first active session
        const first = this.sessions.values().next().value;
        return first?.logs || [];
    }
}

export const ptyManager = new PtyManager();

// --- Main Process Glue ---
export function setupPty(win: BrowserWindow) {

    // Relay Events to Renderer (filtered by sessionId logic in Renderer)
    builder.on('data', (payload: { sessionId: string, data: string }) => {
        if (!win.isDestroyed()) win.webContents.send('terminal-data', payload);
    });

    builder.on('exit', (payload: { sessionId: string, exitCode: number }) => {
        if (!win.isDestroyed()) win.webContents.send('terminal-exit', payload);
    });

    // --- IPC Handlers ---

    ipcMain.handle('terminal-init', (_event: IpcMainInvokeEvent, cwd: string) => {
        return { sessionId: ptyManager.create(cwd) };
    });

    ipcMain.on('terminal-input', (_event: IpcMainEvent, { sessionId, data }: { sessionId: string, data: string }) => {
        ptyManager.write(sessionId, data);
    });

    ipcMain.on('terminal-resize', (_event: IpcMainEvent, { sessionId, cols, rows }: { sessionId: string, cols: number, rows: number }) => {
        ptyManager.resize(sessionId, cols, rows);
    });

    ipcMain.on('terminal-kill', (_event: IpcMainEvent, sessionId: string) => {
        ptyManager.kill(sessionId);
    });
}

// Export for Snapshot Engine
export function getRecentLogs(): string[] {
    return ptyManager.getLogs();
}

// Helper for Orchestrator
export function sendToPty(data: string, sessionId?: string) {
    const target = sessionId || ptyManager.activeSessionId;
    if (target) {
        ptyManager.write(target, data);
    } else {
        console.warn('[PtyManager] sendToPty failed: No active session');
    }
}
