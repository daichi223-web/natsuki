import { Orchestrator } from './orchestrator';
import { jobManager } from './job-manager';
import { EventEmitter } from 'events';

// Mock dependencies
const mockWin = {
    webContents: {
        send: (channel: string, data: any) => {
            console.log(`[UI Event] ${channel}:`, JSON.stringify(data).slice(0, 100) + '...');
        }
    },
    isDestroyed: () => false
} as any;

async function runTest() {
    console.log("=== Starting Full Integration Test ===");

    // 1. Initialize Managers
    const orchestrator = new Orchestrator(mockWin);
    console.log("1. Managers Initialized");

    // 2. Create a Job
    const job = jobManager.createJob("Test Job Auto");
    console.log("2. Job Created:", job.id);

    // 3. Mock Workspace (use D:\Natsuki\test which we know exists)
    const testCwd = "D:\\Natsuki\\test";
    // Ensure package.json exists there (required for verify)
    const fs = require('fs');
    if (!fs.existsSync(testCwd + '\\package.json')) {
        console.log("Creating dummy package.json for test...");
        fs.writeFileSync(testCwd + '\\package.json', JSON.stringify({ name: "test-project", scripts: { lint: "echo linting" } }));
    }

    // Update Job with CWD
    jobManager.updateJob(job.id, { workspace: testCwd });

    // 4. Start Job via Orchestrator
    console.log("3. Starting Job...");
    await orchestrator.startJob(job.id, testCwd);

    // 5. Simulate Orchestrator Loop
    // The orchestrator waits for idle. We can manually trigger 'advanceLoop'.
    console.log("4. Triggering Loop Advance (Simulating PTY idle)...");
    await orchestrator.advanceLoop(job.id);

    // Check Job Status
    const finalJob = jobManager.getJob(job.id);
    if (!finalJob) {
        console.error("FAILURE: Job not found");
        process.exit(1);
    }
    console.log("5. Final Job Status:", finalJob.status);
    console.log("   Runtime History:", finalJob.history?.length || 0, "events");

    if (finalJob.status === 'reviewing' || finalJob.status === 'waiting_approval' || finalJob.status === 'failed') {
        console.log("SUCCESS: Job transitioned through lifecycle.");
    } else {
        console.error("FAILURE: Job stuck in", finalJob.status);
        process.exit(1);
    }
}

runTest().catch(e => {
    console.error("TEST FAILED:", e);
    process.exit(1);
});
