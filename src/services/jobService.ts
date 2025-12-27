/**
 * Job Service - Manages job lifecycle and completion detection
 *
 * Claude Code outputs specific patterns:
 * - When working: continuous output text
 * - When done: returns to prompt (detectable by specific patterns)
 */

import type { Job } from '../types';

// Patterns that indicate Claude is waiting for input (job complete)
const PROMPT_PATTERNS = [
    /\n>\s*$/,           // Simple > prompt
    /\n\$\s*$/,          // Shell $ prompt
    /\nUser:\s*$/,       // "User:" prompt pattern
    /waiting for input/i,
    /\[Y\/n\]/,          // Confirmation prompt
];

// Patterns that indicate an error occurred
const ERROR_PATTERNS = [
    /error:/i,
    /failed:/i,
    /exception:/i,
    /fatal:/i,
];

type JobUpdateCallback = (job: Job) => void;

class JobServiceClass {
    private jobs: Map<string, Job> = new Map();
    private activeJobId: string | null = null;
    private outputBuffer: string = '';
    private listeners: Set<JobUpdateCallback> = new Set();
    private lastActivityTime: number = 0;
    private idleCheckTimer: any = null;

    // How long to wait after last output to consider job complete
    private readonly IDLE_THRESHOLD_MS = 3000;

    constructor() {
        this.loadFromStorage();
    }

    private loadFromStorage() {
        try {
            const stored = localStorage.getItem('natsuki-jobs');
            if (stored) {
                const jobsArray: Job[] = JSON.parse(stored);
                jobsArray.forEach(job => {
                    // Reset running jobs to idle on reload
                    if (job.status === 'running') {
                        job.status = 'idle';
                    }
                    this.jobs.set(job.id, job);
                });
            }
        } catch (e) {
            console.warn('Failed to load jobs from storage:', e);
        }
    }

    private saveToStorage() {
        try {
            const jobsArray = Array.from(this.jobs.values());
            localStorage.setItem('natsuki-jobs', JSON.stringify(jobsArray));
        } catch (e) {
            console.warn('Failed to save jobs to storage:', e);
        }
    }

    subscribe(callback: JobUpdateCallback) {
        this.listeners.add(callback);
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

    createJob(description: string): Job {
        const job: Job = {
            id: Date.now().toString(),
            description,
            status: 'idle',
            createdAt: Date.now(),
        };
        this.jobs.set(job.id, job);
        this.saveToStorage();
        this.notifyListeners(job);
        return job;
    }

    startJob(jobId: string): boolean {
        const job = this.jobs.get(jobId);
        if (!job || this.activeJobId) {
            return false; // Can't start if job doesn't exist or another is running
        }

        job.status = 'running';
        this.activeJobId = jobId;
        this.outputBuffer = '';
        this.lastActivityTime = Date.now();

        // Start idle detection
        this.startIdleCheck();

        this.jobs.set(jobId, job);
        this.saveToStorage();
        this.notifyListeners(job);

        // Send command to terminal
        window.electronAPI.send('terminal-input', job.description + '\r');

        return true;
    }

    private startIdleCheck() {
        if (this.idleCheckTimer) {
            clearInterval(this.idleCheckTimer);
        }

        this.idleCheckTimer = setInterval(() => {
            if (!this.activeJobId) {
                this.stopIdleCheck();
                return;
            }

            const timeSinceActivity = Date.now() - this.lastActivityTime;
            if (timeSinceActivity > this.IDLE_THRESHOLD_MS) {
                // No output for a while, check if we're at a prompt
                this.checkForCompletion();
            }
        }, 1000);
    }

    private stopIdleCheck() {
        if (this.idleCheckTimer) {
            clearInterval(this.idleCheckTimer);
            this.idleCheckTimer = null;
        }
    }

    private checkForCompletion() {
        if (!this.activeJobId) return;

        // Check if output buffer ends with a prompt pattern
        const isAtPrompt = PROMPT_PATTERNS.some(pattern => pattern.test(this.outputBuffer));
        const hasError = ERROR_PATTERNS.some(pattern => pattern.test(this.outputBuffer));

        // If we haven't received output in a while and buffer looks like it's at a prompt
        if (isAtPrompt || this.outputBuffer.length === 0) {
            this.completeJob(hasError ? 'failed' : 'completed');
        }
    }

    /**
     * Called when terminal output is received
     */
    onTerminalOutput(data: string) {
        if (!this.activeJobId) return;

        this.outputBuffer += data;
        this.lastActivityTime = Date.now();

        // Keep buffer size manageable (last 10KB)
        if (this.outputBuffer.length > 10240) {
            this.outputBuffer = this.outputBuffer.slice(-10240);
        }

        // Update job log summary
        const job = this.jobs.get(this.activeJobId);
        if (job) {
            job.logSummary = this.outputBuffer.slice(-500); // Last 500 chars
            this.jobs.set(this.activeJobId, job);
        }
    }

    completeJob(status: 'completed' | 'failed' = 'completed') {
        if (!this.activeJobId) return;

        const job = this.jobs.get(this.activeJobId);
        if (job) {
            job.status = status;
            job.logSummary = this.outputBuffer.slice(-1000);
            this.jobs.set(this.activeJobId, job);
            this.saveToStorage();
            this.notifyListeners(job);
        }

        this.activeJobId = null;
        this.outputBuffer = '';
        this.stopIdleCheck();
    }

    deleteJob(jobId: string) {
        if (this.activeJobId === jobId) {
            this.completeJob('failed');
        }
        this.jobs.delete(jobId);
        this.saveToStorage();
    }

    getActiveJob(): Job | null {
        return this.activeJobId ? this.jobs.get(this.activeJobId) || null : null;
    }

    isJobRunning(): boolean {
        return this.activeJobId !== null;
    }
}

// Singleton instance
export const jobService = new JobServiceClass();
