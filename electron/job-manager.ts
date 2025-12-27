import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Reuse types (duplicated to avoid build complexity between src/electron)
export type JobStatus = 'idle' | 'running' | 'verifying' | 'snapshotting' | 'reviewing' | 'completed' | 'failed' | 'waiting_approval' | 'fixing';

export interface Job {
    id: string;
    description: string;
    status: JobStatus;
    createdAt: number;
    workspace?: string; // e.g. cwd
    history?: {
        timestamp: number;
        action: string;
        result?: any;
    }[];
    logSummary?: string;
    latestSnapshotId?: string;
    autoFixCount?: number;
    // We can store review result here too
    reviewResult?: any;
}

const JOBS_FILE = path.join(os.homedir(), '.natsuki', 'jobs.json');

export class JobManager {
    private jobs: Map<string, Job> = new Map();

    constructor() {
        this.loadJobs();
        this.setupIPC();
    }

    private async loadJobs() {
        try {
            if (fs.existsSync(JOBS_FILE)) {
                const data = await fs.promises.readFile(JOBS_FILE, 'utf-8');
                const loaded: Job[] = JSON.parse(data);
                this.jobs.clear();
                loaded.forEach(j => this.jobs.set(j.id, j));
                console.log(`[JobManager] Loaded ${this.jobs.size} jobs`);
            }
        } catch (e) {
            console.error('[JobManager] Failed to load jobs:', e);
        }
    }

    private async saveJobs() {
        try {
            const jobsArray = Array.from(this.jobs.values());
            await fs.promises.mkdir(path.dirname(JOBS_FILE), { recursive: true });
            await fs.promises.writeFile(JOBS_FILE, JSON.stringify(jobsArray, null, 2));
        } catch (e) {
            console.error('[JobManager] Failed to save jobs:', e);
        }
    }

    // Public API for Orchestrator/Internal
    public getJob(id: string) {
        return this.jobs.get(id);
    }

    public updateJob(id: string, updates: Partial<Job>) {
        const job = this.jobs.get(id);
        if (job) {
            Object.assign(job, updates);
            this.jobs.set(id, job); // redundant but explicit
            this.saveJobs(); // Async save, don't await
            return job;
        }
        return null;
    }

    public createJob(description: string, parentJobId?: string, workspace?: string): Job {
        const id = `job-${Date.now()}`;
        const newJob: Job = {
            id,
            description,
            status: 'idle',
            createdAt: Date.now(),
            workspace: workspace || process.cwd(), // Default to current if not provided? Or make explicit.
            history: [],
            autoFixCount: 0
        };
        this.jobs.set(id, newJob);
        this.saveJobs();
        console.log(`[JobManager] Created Job ${id}`);
        return newJob;
    }

    private setupIPC() {
        // List
        ipcMain.handle('job-list', () => {
            return Array.from(this.jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
        });

        // Create
        ipcMain.handle('job-create', (_, { description, cwd }: { description: string, cwd?: string }) => {
            return this.createJob(description, undefined, cwd);
        });

        // Get Single
        ipcMain.handle('job-get', (_, id: string) => {
            return this.jobs.get(id);
        });

        // Create Fix Job (Workflow P0)
        ipcMain.handle('job-create-from-review', (_, { jobId, reviewResult }: { jobId: string, reviewResult: any }) => {
            console.log(`[JobManager] creating fix job for ${jobId}`);

            // Generate Description Logic
            const { decision, achievedLevel, missing, issues, summary } = reviewResult;
            let desc = `[Fix] Review Feedback (${decision} - Level ${achievedLevel})\n\n`;
            desc += `Parent Job: ${jobId}\n`;
            desc += `Summary: ${summary}\n\n`;

            if (missing?.minimum?.length > 0) {
                desc += `MUST FIX (Minimum):\n${missing.minimum.map((m: any) => `- ${m}`).join('\n')}\n\n`;
            }
            if (missing?.middle?.length > 0) {
                desc += `SHOULD FIX (Middle):\n${missing.middle.map((m: any) => `- ${m}`).join('\n')}\n\n`;
            }
            if (issues?.length > 0) {
                desc += `ISSUES:\n${issues.map((i: any) => `- [${i.severity}] ${i.title}`).join('\n')}\n\n`;
            }
            desc += `Verify profile: lint+test`;

            // Find parent job to inherit workspace
            const parentJob = this.getJob(jobId);
            const workspace = parentJob?.workspace;

            const fixJob = this.createJob(desc, jobId, workspace);

            // TODO: In Phase 3.1, automatically START this job via Orchestrator?
            // User requirement: "BLOCK/IMPROVE -> FixJob -> Run ... nonstop"
            // So yes, we should probably start it?
            // But 'orchestrator-start' requires frontend to trigger? 
            // Or we can emit an event 'job-auto-start' to main?
            // For v0.1: Creating it and having Frontend switch to it (via 'job-created' event?) is safer.
            // The user said: "UI only" is bad. 
            // If I return the new ID, the frontend can strictly switch to it and call run.

            return { success: true, job: fixJob };
        });
    }
}

// Global instance
export const jobManager = new JobManager();
