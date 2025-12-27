import { ipcMain } from 'electron'
import { exec } from 'child_process'
import util from 'util'

const execAsync = util.promisify(exec);

export function setupGitHandlers() {
    ipcMain.handle('git-status', async (_event, cwd: string) => {
        try {
            const { stdout } = await execAsync('git status --porcelain', { cwd });
            const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd });
            return { status: stdout, branch: branch.trim(), success: true };
        } catch (error) {
            console.error('Git status error', error);
            // Return empty or error state
            return { status: '', branch: '', success: false, error: String(error) };
        }
    });

    ipcMain.handle('git-diff', async (_event, { cwd, file }: { cwd: string, file: string }) => {
        try {
            // Limit diff size?
            const { stdout } = await execAsync(`git diff "${file}"`, { cwd });
            return { diff: stdout, success: true };
        } catch (error) {
            return { diff: '', success: false, error: String(error) };
        }
    });

    ipcMain.handle('git-restore', async (_event, cwd: string) => {
        try {
            await execAsync('git restore .', { cwd });
            // Also restore staged? "undo" usually means discard all changes.
            // git restore . only restores working tree.
            // git restore --staged . is also needed if added.
            // For MVP, "git restore ." is what was requested (Undo uncommitted).
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });
}
