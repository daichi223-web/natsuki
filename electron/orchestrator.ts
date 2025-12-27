import { BrowserWindow, ipcMain } from 'electron';
import { runVerify, createSnapshot } from './snapshot-manager';
import { runReview } from './llm-service';
import { sendToPty, setIdleCallback } from './pty-manager';
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

        // Initialize runtime state if needed
        activeRuntimes.set(jobId, { jobId });

        // Update Job Data (reset count)
        this.updateJobStatus(jobId, 'running', { autoFixCount: 0 });

        if (hasKey) {
            console.log(`[Orchestrator] Autonomous mode enabled for Job ${jobId}`);
        } else {
            console.log(`[Orchestrator] Manual mode (No Reviewer Key found)`);
        }

        // Register idle callback for auto-advance
        setIdleCallback(() => {
            console.log(`[Orchestrator] PTY idle detected, advancing loop for ${jobId}`);
            this.advanceLoop(jobId);
        });

        console.log(`[Orchestrator] Job ${jobId} started.`);

        return { success: true };
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
