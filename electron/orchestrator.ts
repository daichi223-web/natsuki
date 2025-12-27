import { BrowserWindow, ipcMain } from 'electron';
import { runVerify, createSnapshot } from './snapshot-manager';
import { runReview } from './llm-service';
import { sendToPty, setIdleCallback } from './pty-manager';
import { ReviewResult } from './llm-service';
import { keyManager } from './key-manager';

// Job State Definition (matches types.ts)
type JobStatus = 'idle' | 'running' | 'verifying' | 'snapshotting' | 'reviewing' | 'completed' | 'failed' | 'waiting_approval' | 'fixing';

interface JobState {
    id: string;
    description: string;
    status: JobStatus;
    workspace: string;
    history: {
        timestamp: number;
        action: string;
        result?: any;
    }[];
    latestSnapshotId?: string;
    reviewResult?: ReviewResult;
    autoFixCount: number;
    apiKey?: string;
}

// In-memory store
const activeJobs: Map<string, JobState> = new Map();

// Configuration
const MAX_AUTO_FIXES = 2;

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

        // Used for manual stepping or debug
        ipcMain.handle('orchestrator-step', async (_, { jobId }: { jobId: string }) => {
            return this.advanceLoop(jobId);
        });

        ipcMain.handle('orchestrator-proceed', async (_, { jobId, action }: { jobId: string, action: 'approve' | 'fix' | 'retry' }) => {
            return this.handleUserAction(jobId, action);
        });
    }

    private updateJobStatus(jobId: string, status: JobStatus, updates: Partial<JobState> = {}) {
        const job = activeJobs.get(jobId);
        if (job) {
            job.status = status;
            Object.assign(job, updates);
            this.mainWindow.webContents.send('job-update', { jobId, ...job });
            console.log(`[Orchestrator] Job ${jobId} -> ${status}`);
        }
    }

    async startJob(jobId: string, cwd: string) {
        // Check if we have ANY valid key to run autonomously
        // For Phase 3.0, we prioritize 'anthropic' but support others.
        // TODO: Get preferred provider from config/UI.
        const provider = 'anthropic';
        const hasKey = !!keyManager.getApiKey(provider) || !!keyManager.getApiKey('gemini') || !!keyManager.getApiKey('openai');

        const job: JobState = {
            id: jobId,
            description: "Active Job",
            status: 'running',
            workspace: cwd,
            history: [],
            autoFixCount: 0,
            apiKey: hasKey ? 'present' : undefined // Keeping field name for frontend compatibility if needed, but value is dummy
        };
        activeJobs.set(jobId, job);

        this.updateJobStatus(jobId, 'running');

        if (hasKey) {
            console.log(`[Orchestrator] Autonomous mode enabled for Job ${jobId} (Key found)`);
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
        const job = activeJobs.get(jobId);
        if (!job) return;

        // Clear idle callback while we're processing
        setIdleCallback(null);

        console.log(`[Orchestrator] Advancing loop for ${jobId} (current: ${job.status})`);

        try {
            // Sequence: Running -> Verifying -> Snapshot -> Review -> (Fix or Complete)

            if (job.status === 'running' || job.status === 'fixing') {
                // Assume execution finished (manual trigger or detected idle).
                // Next: Verify
                this.updateJobStatus(jobId, 'verifying');
                const verifyRes = await runVerify(job.workspace, 'lint'); // Default profile
                job.history.push({ timestamp: Date.now(), action: 'verify', result: verifyRes });

                // Next: Snapshot
                this.updateJobStatus(jobId, 'snapshotting');
                const snapRes = await createSnapshot(job.workspace, jobId, job.description); // Pass Intent

                if (!snapRes.success || !snapRes.snapshotId) {
                    this.updateJobStatus(jobId, 'failed', { description: 'Snapshot failed' });
                    return;
                }

                job.latestSnapshotId = snapRes.snapshotId;

                // Next: Review (Key Check)
                // We check dynamically in case key was added mid-flight
                const provider = 'anthropic'; // TODO: Config
                // We let llm-service handle the key retrieval.
                // But we need to know if we SHOULD call it.
                const canReview = !!keyManager.getApiKey(provider) || !!keyManager.getApiKey('gemini') || !!keyManager.getApiKey('openai');

                if (canReview) {
                    this.updateJobStatus(jobId, 'reviewing', { latestSnapshotId: snapRes.snapshotId });

                    const reviewRes = await runReview(jobId, snapRes.snapshotId, ''); // No API key passed
                    if (reviewRes.success && reviewRes.result) {
                        job.history.push({ timestamp: Date.now(), action: 'review', result: reviewRes.result });
                        // Handle Decision (Fix/Approve/Block)
                        await this.handleReviewDecision(jobId, reviewRes.result);
                    } else {
                        // If review failed (e.g. API error), fallback to manual? or fail?
                        // For now, fail to alert user.
                        this.updateJobStatus(jobId, 'failed', { description: 'Review API failed: ' + reviewRes.error });
                    }
                } else {
                    // Manual Fallback
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
        const job = activeJobs.get(jobId);
        if (!job) return;

        job.reviewResult = result;

        if (result.decision === 'APPROVE' || result.decision === 'EXCELLENT') {
            this.updateJobStatus(jobId, 'completed');
        } else if (result.decision === 'IMPROVE') {
            if (job.autoFixCount < MAX_AUTO_FIXES) {
                job.autoFixCount++;
                this.updateJobStatus(jobId, 'fixing');

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
        const job = activeJobs.get(jobId);
        if (!job) return;
        // Allows user to override state manually (e.g. force fix)
    }
}

export function setupOrchestrator(win: BrowserWindow) {
    new Orchestrator(win);
}
