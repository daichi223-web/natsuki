// Review Types (v0.1 Capability Levels)
export type Decision = 'BLOCK' | 'IMPROVE' | 'APPROVE' | 'EXCELLENT';
export type AchievedLevel = 'none' | 'minimum' | 'middle' | 'maximum';
export type Severity = 'critical' | 'major' | 'minor';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface ReviewIssue {
    severity: Severity;
    title: string;
    evidence: string;
    suggestion: string;
}

export interface ReviewResult {
    decision: Decision;
    achievedLevel: AchievedLevel;
    summary: string;
    missing: {
        minimum: string[];
        middle: string[];
        maximum: string[];
    };
    issues: ReviewIssue[];
    risk: {
        security: RiskLevel;
        correctness: RiskLevel;
        maintainability: RiskLevel;
    };
}

export interface ReviewHistoryItem {
    id: string;
    timestamp: number;
    snapshotId: string;
    result: ReviewResult;
}

export interface ContractLevels {
    minimum: string[];
    middle: string[];
    maximum: string[];
}

export interface Job {
    id: string;
    description: string;
    status: 'idle' | 'running' | 'verifying' | 'snapshotting' | 'reviewing' | 'completed' | 'failed' | 'waiting_approval' | 'fixing';
    createdAt: number;
    workspace?: string;
    logSummary?: string;
    autoFixCount?: number;
    // Phase 3 extensions
    latestSnapshotId?: string;
    reviewResult?: ReviewResult;
    reviewHistory?: ReviewHistoryItem[];
}

export interface SessionDiagnosticState {
    process: {
        pid: number;
        isAlive: boolean;
        exitCode: number | null;
        signal: string | null;
        spawnCommand: string;
        spawnCwd: string;
        spawnTime: number;
        uptimeMs: number;
    };
    pty: {
        bytesReceived: number;
        lastOutputTime: number;
        timeSinceLastOutput: number | null;
        recentLogs: string[];
    };
    timestamp: number;
}
