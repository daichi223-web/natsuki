import { BrowserWindow, ipcMain } from 'electron';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { getRecentLogs } from './pty-manager';

const SNAPSHOT_BASE_DIR = path.join(os.homedir(), '.natsuki', 'snapshots');

// Profiles for allowlisted verify commands
const VERIFY_PROFILES: Record<string, string> = {
    'lint': 'npm run lint',
    'build': 'npm run build',
    'typecheck': 'npm run typecheck',
    'test': 'npm test',
};

async function ensureDir(dir: string) {
    if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
    }
}

async function runCommand(cmd: string, args: string[], cwd: string): Promise<{ exitCode: number, stdout: string, stderr: string }> {
    return new Promise((resolve) => {
        // use shell: true to handle 'npm' on windows
        const child = spawn(cmd, args, { cwd, shell: true });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });

        child.on('close', (code) => {
            resolve({
                exitCode: code ?? -1,
                stdout,
                stderr
            });
        });

        child.on('error', (err) => {
            resolve({
                exitCode: -1,
                stdout: '',
                stderr: err.message
            });
        });
    });
}

// Internal function for Orchestrator
export async function runVerify(cwd: string, completionProfile: string): Promise<{ success: boolean, exitCode: number, stdoutTail: string, stderrTail: string, error?: string }> {
    const commandStr = VERIFY_PROFILES[completionProfile];
    if (!commandStr) {
        return { success: false, exitCode: -1, stdoutTail: '', stderrTail: '', error: `Profile '${completionProfile}' not allowed/found.` };
    }

    console.log(`[Verify] Running ${commandStr} in ${cwd}`);

    const [cmd, ...args] = commandStr.split(' ');
    const { exitCode, stdout, stderr } = await runCommand(cmd, args, cwd);

    return {
        success: exitCode === 0,
        exitCode,
        stdoutTail: stdout.slice(-2000),
        stderrTail: stderr.slice(-2000)
    };
}

// Internal function for Orchestrator
export async function createSnapshot(cwd: string, jobId: string, intent: string = ""): Promise<{ success: boolean, snapshotId?: string, summary?: any, error?: string }> {
    try {
        const timestamp = new Date();
        const snapshotId = timestamp.toISOString().replace(/[:.]/g, '-');

        const snapshotDir = path.join(SNAPSHOT_BASE_DIR, jobId, snapshotId);
        await ensureDir(snapshotDir);

        // 1. Git Status
        const { stdout: gitStatus } = await runCommand('git', ['status', '--porcelain'], cwd);

        // 2. Git Diff
        const { stdout: gitDiff } = await runCommand('git', ['diff'], cwd);

        // 3. Terminal Tail
        const terminalLines = getRecentLogs();

        // Write payload files
        const sources = {
            git_status: 'git_status.txt',
            git_diff: 'git_diff.patch',
            terminal_tail: 'terminal_tail.txt'
        };

        await fs.promises.writeFile(path.join(snapshotDir, sources.git_status), gitStatus);
        await fs.promises.writeFile(path.join(snapshotDir, sources.git_diff), gitDiff);
        await fs.promises.writeFile(path.join(snapshotDir, sources.terminal_tail), terminalLines.join('\n'));

        // Manifest
        const manifest = {
            snapshot_id: snapshotId,
            job_id: jobId,
            workspace: cwd,
            created_at: timestamp.toISOString(),
            intent: intent, // Added Intent
            sources,
            summary: {
                dirty: gitStatus.trim().length > 0,
                changed_files: gitStatus.split('\n').filter(l => l.trim()).length,
                verifyExitCode: null as number | null
            }
        };

        await fs.promises.writeFile(path.join(snapshotDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

        console.log(`[Snapshot] Created ${snapshotId} for Job ${jobId}`);

        return {
            success: true,
            snapshotId,
            summary: manifest.summary
        };

    } catch (e: any) {
        console.error('[Snapshot] Error:', e);
        return { success: false, error: e.message };
    }
}

export function setupSnapshotHandlers(win: BrowserWindow) {
    // T4: VerifyRunner
    ipcMain.handle('verify-run', async (_event, { cwd, jobId, profile }: { cwd: string, jobId: string, profile: string }) => {
        return await runVerify(cwd, profile);
    });

    // T5: SnapshotOrchestrator
    ipcMain.handle('snapshot-create', async (_event, { cwd, jobId, includeVerify }: { cwd: string, jobId: string, includeVerify?: boolean }) => {
        return await createSnapshot(cwd, jobId);
    });
}
