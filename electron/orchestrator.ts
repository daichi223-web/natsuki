import { BrowserWindow, ipcMain } from 'electron';
import { runVerify, createSnapshot } from './snapshot-manager';
import { runReview } from './llm-service';
import { sendToPty, setIdleCallback, builder, ptyManager } from './pty-manager';
import { ReviewResult } from './llm-service';
import { keyManager } from './key-manager';
import { jobManager, Job, JobStatus } from './job-manager';

// Runtime tracking for active jobs (things not in DB like PTY handles, timeouts)
interface JobRuntime {
    jobId: string;
    // Add runtime specific stuff here if needed
}

const activeRuntimes: Map<string, JobRuntime> = new Map();

// Configuration
const MAX_AUTO_FIXES = 2;
const MAX_DIFF_LINES = 1000;
const TIMEOUTS = {
    VERIFY: 10 * 60 * 1000,
    SNAPSHOT: 5 * 60 * 1000,
    REVIEW: 3 * 60 * 1000
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
    ]);
}

export class Orchestrator {
    private mainWindow: BrowserWindow;

    constructor(win: BrowserWindow) {
        this.mainWindow = win;
        this.setupIPC();
        this.setupPTYListeners();
    }

    private setupPTYListeners() {
        // Listen to global builder events from pty-manager
        builder.on('exit', (info: { exitCode: number, signal?: number }) => {
            console.log(`[Orchestrator] PTY exited: ${info.exitCode}`);
            this.handlePTYExit(info);
        });
    }

    private handlePTYExit(info: { exitCode: number, signal?: number }) {
        // Check all active runtimes
        activeRuntimes.forEach((runtime, jobId) => {
            const job = jobManager.getJob(jobId);
            if (job && (job.status === 'running' || job.status === 'fixing')) {
                console.warn(`[Orchestrator] Job ${jobId} was ${job.status} but PTY exited.`);
                if (info.exitCode !== 0) {
                    this.updateJobStatus(jobId, 'failed', { description: `Process exited with code ${info.exitCode}` });
                } else {
                    // Start next phase if it exited cleanly? 
                    // Usually 'running' expects meaningful work. If it exits 0 immediately, maybe it's done?
                    // For now, let's treat unexpected exit as idle/paused or failed if code != 0.
                    // If we assume claudecode runs interactively, exit 0 means user quit?
                    this.updateJobStatus(jobId, 'failed', { description: `Process exited (Code ${info.exitCode})` });
                }
            }
        });
        activeRuntimes.clear();
    }

    private setupIPC() {
        ipcMain.handle('orchestrator-start', async (_, { jobId, cwd }: { jobId: string, cwd: string }) => {
            return this.startJob(jobId, cwd);
        });

        ipcMain.handle('orchestrator-step', async (_, { jobId }: { jobId: string }) => {
            return this.advanceLoop(jobId);
        });

        ipcMain.handle('orchestrator-proceed', async (_, { jobId, action }: { jobId: string, action: 'approve' | 'fix' | 'retry' }) => {
            return this.handleUserAction(jobId, action);
        });
    }

    private updateJobStatus(jobId: string, status: JobStatus, updates: Partial<Job> = {}) {
        // Update via JobManager
        const job = jobManager.updateJob(jobId, { status, ...updates });
        if (job) {
            this.mainWindow.webContents.send('job-update', job);
            console.log(`[Orchestrator] Job ${jobId} -> ${status}`);
        }
    }

    async startJob(jobId: string, cwd: string) {
        // Assume Job is already created in JobManager
        const job = jobManager.getJob(jobId);
        if (!job) {
            console.error(`[Orchestrator] Job ${jobId} not found in JobManager`);
            return { success: false, error: 'Job not found' };
        }

        const provider = 'anthropic';
        const hasKey = !!keyManager.getApiKey(provider) || !!keyManager.getApiKey('gemini') || !!keyManager.getApiKey('openai');

        activeRuntimes.set(jobId, { jobId });
        this.updateJobStatus(jobId, 'running', { autoFixCount: 0, workspace: cwd });

        if (hasKey) console.log(`[Orchestrator] Autonomous mode enabled for Job ${jobId}`);
        else console.log(`[Orchestrator] Manual mode (No Reviewer Key found)`);

        // ★ CRITICAL: Explicitly Spawn Claude
        // We need the active session ID. For now, we assume single active workspace logic.
        const sessionId = ptyManager.activeSessionId;
        if (!sessionId) {
            console.error('[Orchestrator] No active PTY session found.');
            // Should we try to create one? Or fail? Fail is safer.
            this.updateJobStatus(jobId, 'failed', { description: 'No active PTY session. Please open a workspace.' });
            return { success: false, error: 'No PTY session' };
        }

        console.log(`[Orchestrator] Spawning Claude for Job ${jobId} in session ${sessionId}`);
        ptyManager.spawnClaude(sessionId);

        // Wait a bit for Claude to initialize
        await new Promise(r => setTimeout(r, 2000));

        // Send the job description as the first prompt
        const prompt = this.buildInitialPrompt(job);
        console.log(`[Orchestrator] Sending initial prompt to Claude: ${prompt.slice(0, 100)}...`);
        sendToPty(prompt + '\r');

        // Register idle callback for auto-advance (triggers after Claude finishes)
        setIdleCallback(() => {
            console.log(`[Orchestrator] PTY idle detected, advancing loop for ${jobId}`);
            this.advanceLoop(jobId);
        });

        console.log(`[Orchestrator] Job ${jobId} started with prompt.`);
        return { success: true };
    }

    private buildInitialPrompt(job: Job): string {
        // Build a clear prompt for Claude Code
        let prompt = job.description;

        // If it's a Fix job, the description already contains the structured feedback
        if (!job.description.startsWith('[Fix]')) {
            // For regular jobs, add some context
            prompt = `Task: ${job.description}\n\nPlease implement this task. When done, I will verify and review your changes.`;
        }

        return prompt;
    }

    // This method drives the Autonomous Loop
    async advanceLoop(jobId: string) {
        const job = jobManager.getJob(jobId);
        if (!job) return;

        // Clear idle callback while we're processing
        setIdleCallback(null);

        console.log(`[Orchestrator] Advancing loop for ${jobId} (current: ${job.status})`);

        try {
            // Sequence: Running -> Verifying -> Snapshot -> Review -> (Fix or Complete)

            if (job.status === 'running' || job.status === 'fixing') {
                // Assume execution finished (manual trigger or detected idle).

                // Cooldown: Wait for file system stability (simple sleep for v0.1)
                await new Promise(r => setTimeout(r, 2000));

                // Next: Verify
                this.updateJobStatus(jobId, 'verifying');
                const verifyRes = await withTimeout(
                    runVerify(job.workspace || process.cwd(), 'lint'),
                    TIMEOUTS.VERIFY,
                    'Verification'
                );

                if (job.history) {
                    job.history.push({ timestamp: Date.now(), action: 'verify', result: verifyRes });
                }
                this.updateJobStatus(jobId, 'verifying'); // Trigger save

                // Next: Snapshot
                this.updateJobStatus(jobId, 'snapshotting');
                const snapRes = await withTimeout(
                    createSnapshot(job.workspace || process.cwd(), jobId, job.description),
                    TIMEOUTS.SNAPSHOT,
                    'Snapshot'
                );

                if (!snapRes.success || !snapRes.snapshotId) {
                    this.updateJobStatus(jobId, 'failed', { description: 'Snapshot failed: ' + snapRes.error });
                    return;
                }

                // Update latestSnapshotId
                this.updateJobStatus(jobId, 'snapshotting', { latestSnapshotId: snapRes.snapshotId });

                // Next: Review (Key Check)
                const provider = 'anthropic';
                const hasKey = !!keyManager.getApiKey(provider) || !!keyManager.getApiKey('gemini') || !!keyManager.getApiKey('openai');

                if (hasKey) {
                    this.updateJobStatus(jobId, 'reviewing', { latestSnapshotId: snapRes.snapshotId });

                    const reviewRes = await withTimeout(
                        runReview(jobId, snapRes.snapshotId, ''),
                        TIMEOUTS.REVIEW,
                        'Review'
                    );

                    if (reviewRes.success && reviewRes.result) {
                        if (job.history) job.history.push({ timestamp: Date.now(), action: 'review', result: reviewRes.result });
                        // Save history and result
                        this.updateJobStatus(jobId, 'reviewing', { reviewResult: reviewRes.result });
                        await this.handleReviewDecision(jobId, reviewRes.result);
                    } else {
                        // If review failed (API error or safety block), we mark as failed
                        this.updateJobStatus(jobId, 'failed', { description: 'Review failed: ' + reviewRes.error });
                    }
                } else {
                    this.updateJobStatus(jobId, 'waiting_approval', { latestSnapshotId: snapRes.snapshotId });
                }
            }
        } catch (e) {
            console.error(e);
            this.updateJobStatus(jobId, 'failed');
        }
    }

    // To be called when Review is done (could be via UI or auto)
    async handleReviewDecision(jobId: string, result: ReviewResult) {
        const job = jobManager.getJob(jobId);
        if (!job) return;

        // job.reviewResult = result; // already saved above

        if (result.decision === 'APPROVE' || result.decision === 'EXCELLENT') {
            this.updateJobStatus(jobId, 'completed');
        } else if (result.decision === 'IMPROVE') {
            if ((job.autoFixCount || 0) < MAX_AUTO_FIXES) {
                const newCount = (job.autoFixCount || 0) + 1;
                this.updateJobStatus(jobId, 'fixing', { autoFixCount: newCount });

                // Drive Claude to fix it!
                const issuesText = result.issues.map(i => `- [${i.severity}] ${i.title}: ${i.evidence || ''}`).join('\n');
                const fixPrompt = `Review Feedback (Level ${result.achievedLevel}):\n${issuesText}\n\nPlease fix these issues to reach the next level.`;
                sendToPty(`${fixPrompt}\r`);

                // Re-register idle callback to detect when Claude finishes fixing
                setIdleCallback(() => {
                    console.log(`[Orchestrator] PTY idle detected during fix, advancing loop for ${jobId}`);
                    this.advanceLoop(jobId);
                });
            } else {
                this.updateJobStatus(jobId, 'failed', { description: 'Max auto-fix limit reached' });
            }
        } else {
            // BLOCK
            this.updateJobStatus(jobId, 'failed', { description: 'Review blocked: ' + result.summary });
        }
    }

    async handleUserAction(jobId: string, action: 'approve' | 'fix' | 'retry') {
        const job = jobManager.getJob(jobId);
        if (!job) return;
        // Allows user to override state manually (e.g. force fix)
    }
}

export function setupOrchestrator(win: BrowserWindow) {
    new Orchestrator(win);
}
