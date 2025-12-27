import type { Job } from '../types';

type JobUpdateCallback = (job: Job) => void;

class JobServiceClass {
    private jobs: Map<string, Job> = new Map();
    private listeners: Set<JobUpdateCallback> = new Set();
    private initialized = false;

    constructor() {
        this.initialize();
    }

    private async initialize() {
        if (this.initialized) return;

        try {
            // Initial fetch
            const jobs: Job[] = await window.electronAPI.invoke('job-list');
            jobs.forEach(j => this.jobs.set(j.id, j));

            // Listen for updates
            window.electronAPI.on('job-update', (updatedJob: Job) => {
                this.jobs.set(updatedJob.id, updatedJob);
                this.notifyListeners(updatedJob);
            });

            this.initialized = true;
        } catch (e) {
            console.error("Failed to initialize JobService:", e);
        }
    }

    subscribe(callback: JobUpdateCallback) {
        this.listeners.add(callback);
        // Immediately notify with current list if needed, or caller calls getAllJobs
        return () => this.listeners.delete(callback);
    }

    private notifyListeners(job: Job) {
        this.listeners.forEach(cb => cb(job));
    }

    getAllJobs(): Job[] {
        return Array.from(this.jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
    }

    getJob(id: string): Job | undefined {
        return this.jobs.get(id);
    }

    async createJob(description: string) {
        const job = await window.electronAPI.invoke('job-create', { description, cwd: '' }); // cwd handled by backend or pass active?
        // Backend handles notifications
        return job;
    }

    // "FixJob" action
    async createFixJob(fromJobId: string, reviewResult: any) {
        const res = await window.electronAPI.invoke('job-create-from-review', { jobId: fromJobId, reviewResult });
        return res.job;
    }

    async startJob(jobId: string, cwd: string) {
        const res = await window.electronAPI.invoke('orchestrator-start', { jobId, cwd });
        return res.success;
    }

    // Deprecated / Handled by PTY: onTerminalOutput
    // We keep empty stub if components call it, but likely we should remove calls.
    onTerminalOutput(_data: string) {
        // No-op, PTY handles buffer or Backend handles log summary
    }

    isJobRunning(): boolean {
        return Array.from(this.jobs.values()).some(j => j.status === 'running' || j.status === 'fixing' || j.status === 'verifying');
    }
}

export const jobService = new JobServiceClass();
