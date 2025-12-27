import { BrowserWindow, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as os from 'os';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { OpenAI } from 'openai';
import { keyManager } from './key-manager';
import { loadContract } from './snapshot-manager';

// --- Types ---

export type Decision = 'BLOCK' | 'IMPROVE' | 'APPROVE' | 'EXCELLENT';
export type AchievedLevel = 'none' | 'minimum' | 'middle' | 'maximum';
export type Severity = 'critical' | 'major' | 'minor';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface ReviewIssue {
    severity: Severity;
    title: string;
    evidence: string;   // snapshotからの根拠（diff/log）
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

export interface ContractLevels {
    minimum: string[];
    middle: string[];
    maximum: string[];
}

export interface SnapshotData {
    jobId: string;
    snapshotId: string;
    manifest: any;
    diff: string;
    logs: string;
    contract?: {
        id: string;
        levels: ContractLevels;
    };
}

interface ReviewerRunner {
    id: string; // 'anthropic', 'gemini', 'openai'
    review(snapshot: SnapshotData): Promise<ReviewResult>;
}

// --- Common ---

const REVIEWER_SYSTEM_PROMPT = `You are a Senior Code Reviewer implementing a 3-tier Capability Level judgment system.

## Your Mission
Evaluate the provided Snapshot (diff/logs) against the Contract's Capability Levels.
Your judgment must be OBJECTIVE and based ONLY on:
1. The Contract's defined levels (minimum/middle/maximum)
2. Evidence from the Snapshot (diff/logs)

## Decision Rules (CRITICAL)

R1: Minimum未達 → BLOCK
- If ANY minimum requirement is missing → decision = "BLOCK"
- Exception: If manifest.completeness == "partial", use "IMPROVE" instead (request re-snapshot)
- Exception: Security risks (credential leaks, etc.) → always "BLOCK"

R2: Minimum達成 & Middle未達 → IMPROVE
- All minimum requirements met but middle requirements missing
- Goal is to encourage reaching "usable" quality

R3: Middle達成 → APPROVE
- All minimum AND middle requirements met
- Maximum items become "quality suggestions" (not blocking)

R4: Maximum達成 → EXCELLENT
- All levels fully achieved
- Reserved for exceptional implementations

## Output Format (JSON only)
{
  "decision": "BLOCK" | "IMPROVE" | "APPROVE" | "EXCELLENT",
  "achievedLevel": "none" | "minimum" | "middle" | "maximum",
  "summary": "One-line summary of the review",
  "missing": {
    "minimum": ["list of unmet minimum requirements"],
    "middle": ["list of unmet middle requirements"],
    "maximum": ["list of unmet maximum requirements"]
  },
  "issues": [
    {
      "severity": "critical" | "major" | "minor",
      "title": "Issue title",
      "evidence": "Quote from diff/log proving the issue",
      "suggestion": "How to fix"
    }
  ],
  "risk": {
    "security": "low" | "medium" | "high",
    "correctness": "low" | "medium" | "high",
    "maintainability": "low" | "medium" | "high"
  }
}

## Important
- NEVER block based on "preferences" or "general best practices" alone
- ALWAYS cite evidence from the snapshot
- Evaluate ONLY against the contract's defined levels`;

function buildUserPrompt(snapshot: SnapshotData): string {
    const contractSection = snapshot.contract ? `
Contract ID: ${snapshot.contract.id}

Capability Levels:
- MINIMUM (must have): ${JSON.stringify(snapshot.contract.levels.minimum)}
- MIDDLE (should have): ${JSON.stringify(snapshot.contract.levels.middle)}
- MAXIMUM (nice to have): ${JSON.stringify(snapshot.contract.levels.maximum)}
` : `
Contract: Not provided (use general code quality standards)
- MINIMUM: Code compiles, no security vulnerabilities, basic functionality works
- MIDDLE: Tests pass, code is readable, error handling exists
- MAXIMUM: Performance optimized, fully documented, edge cases handled
`;

    return `${contractSection}

Manifest:
${JSON.stringify(snapshot.manifest, null, 2)}

Git Diff:
\`\`\`diff
${snapshot.diff.slice(0, 15000)}
\`\`\`
${snapshot.diff.length > 15000 ? '(Truncated: original was ' + snapshot.diff.length + ' chars)' : ''}

Recent Logs:
\`\`\`
${snapshot.logs.slice(-3000)}
\`\`\`

Evaluate this snapshot against the capability levels. Return JSON only.`;
}

function parseJsonResult(text: string): ReviewResult {
    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : text;
        const parsed = JSON.parse(jsonStr);

        return {
            decision: parsed.decision || 'BLOCK',
            achievedLevel: parsed.achievedLevel || 'none',
            summary: parsed.summary || 'No summary provided',
            missing: parsed.missing || { minimum: [], middle: [], maximum: [] },
            issues: parsed.issues || [],
            risk: parsed.risk || { security: 'low', correctness: 'low', maintainability: 'low' }
        };
    } catch (e) {
        console.error("Failed to parse JSON explanation:", text);
        return {
            decision: 'BLOCK',
            achievedLevel: 'none',
            summary: 'Failed to parse model output',
            missing: { minimum: [], middle: [], maximum: [] },
            issues: [{
                severity: 'critical',
                title: 'JSON Parse Error',
                evidence: 'N/A',
                suggestion: 'Check prompt and model output'
            }],
            risk: { security: 'high', correctness: 'low', maintainability: 'low' }
        };
    }
}

// --- Implementations ---

class AnthropicReviewer implements ReviewerRunner {
    id = 'anthropic';
    private apiKey: string | null = null;

    setApiKey(key: string) {
        this.apiKey = key;
    }

    async review(snapshot: SnapshotData): Promise<ReviewResult> {
        const apiKey = this.apiKey || keyManager.getApiKey('anthropic');
        if (!apiKey) throw new Error("Anthropic API Key not found");

        const prompt = buildUserPrompt(snapshot);
        // Using existing http call for now to avoid 'anthropic-sdk' heavy dep if not needed, 
        // but cleaner to switch eventually. Using the previous impl logic.

        return new Promise((resolve, reject) => {
            const data = JSON.stringify({
                model: "claude-3-5-sonnet-latest",
                max_tokens: 1000,
                system: REVIEWER_SYSTEM_PROMPT,
                messages: [{ role: "user", content: prompt }]
            });

            const req = https.request({
                hostname: 'api.anthropic.com',
                port: 443,
                path: '/v1/messages',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'Content-Length': data.length
                }
            }, (res) => {
                let body = '';
                res.on('data', c => body += c);
                res.on('end', () => {
                    if (res.statusCode && res.statusCode < 300) {
                        try {
                            const parsed = JSON.parse(body);
                            const text = parsed.content[0].text;
                            resolve(parseJsonResult(text));
                        } catch (e) { reject(e); }
                    } else {
                        reject(new Error(`Anthropic API Error: ${res.statusCode} ${body}`));
                    }
                });
            });
            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }
}

class GeminiReviewer implements ReviewerRunner {
    id = 'gemini';

    async review(snapshot: SnapshotData): Promise<ReviewResult> {
        const apiKey = keyManager.getApiKey('gemini');
        if (!apiKey) throw new Error("Gemini API Key not found");

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Tier 1 model

        const prompt = REVIEWER_SYSTEM_PROMPT + "\n\n" + buildUserPrompt(snapshot);

        const result = await model.generateContent(prompt);
        const text = result.response.text();

        return parseJsonResult(text);
    }
}

class OpenAIReviewer implements ReviewerRunner {
    id = 'openai';

    async review(snapshot: SnapshotData): Promise<ReviewResult> {
        const apiKey = keyManager.getApiKey('openai');
        if (!apiKey) throw new Error("OpenAI API Key not found");

        const openai = new OpenAI({ apiKey });
        const completion = await openai.chat.completions.create({
            messages: [
                { role: 'system', content: REVIEWER_SYSTEM_PROMPT },
                { role: 'user', content: buildUserPrompt(snapshot) }
            ],
            model: 'gpt-4o',
            response_format: { type: "json_object" }
        });

        const text = completion.choices[0].message.content || "{}";
        return parseJsonResult(text);
    }
}

class TieredReviewer implements ReviewerRunner {
    id = 'tiered';

    async review(snapshot: SnapshotData): Promise<ReviewResult> {
        console.log("[Tiered] Starting Tier 1 (Gemini Flash)...");
        try {
            const tier1 = new GeminiReviewer();
            const result1 = await tier1.review(snapshot);

            if (result1.decision === 'APPROVE' || result1.decision === 'EXCELLENT') {
                console.log("[Tiered] Tier 1 Approved. Skipping Tier 2.");
                return {
                    ...result1,
                    summary: "[Tier 1] " + result1.summary
                };
            }

            console.log(`[Tiered] Tier 1 decision was '${result1.decision}'. Escalating to Tier 2 (Anthropic)...`);
            const tier2 = new AnthropicReviewer();
            const result2 = await tier2.review(snapshot);

            return {
                ...result2,
                summary: `[Tier 2 (was ${result1.decision})] ` + result2.summary
            };

        } catch (e) {
            console.error("[Tiered] Tier 1 failed, falling back to Tier 2 immediately.", e);
            const tier2 = new AnthropicReviewer();
            return await tier2.review(snapshot);
        }
    }
}

// --- Factory ---

const reviewers: Record<string, new () => ReviewerRunner> = {
    'anthropic': AnthropicReviewer,
    'gemini': GeminiReviewer,
    'openai': OpenAIReviewer,
    'tiered': TieredReviewer
};

async function loadSnapshot(jobId: string, snapshotId: string): Promise<SnapshotData> {
    const snapshotDir = path.join(os.homedir(), '.natsuki', 'snapshots', jobId, snapshotId);
    let diffContent = "", logContent = "", manifestStr = "";

    try {
        diffContent = await fs.promises.readFile(path.join(snapshotDir, 'git_diff.patch'), 'utf-8');
        logContent = await fs.promises.readFile(path.join(snapshotDir, 'terminal_tail.txt'), 'utf-8');
        manifestStr = await fs.promises.readFile(path.join(snapshotDir, 'manifest.json'), 'utf-8');
    } catch (e) {
        throw new Error("Snapshot files not found: " + snapshotDir);
    }

    // Load contract if available
    const contract = await loadContract(jobId);

    return {
        jobId,
        snapshotId,
        manifest: JSON.parse(manifestStr),
        diff: diffContent,
        logs: logContent,
        contract: contract ? { id: contract.id, levels: contract.levels } : undefined
    };
}

// Global default provider
let defaultProvider = 'anthropic';

export function setReviewerProvider(provider: string) {
    if (reviewers[provider]) {
        defaultProvider = provider;
        console.log(`[LLM] Reviewer provider set to ${provider}`);
    }
}

export async function runReview(jobId: string, snapshotId: string, apiKey?: string): Promise<{ success: boolean, result?: ReviewResult, error?: string }> {
    try {
        const snapshot = await loadSnapshot(jobId, snapshotId);

        // Simple strategy for now: Use default provider
        // TODO: Implement Tiered Logic (Gemini Flash -> Anthropic) here if requested
        // For Phase 3.0, we just support switching.

        const ProviderClass = reviewers[defaultProvider];
        if (!ProviderClass) {
            return { success: false, error: `Provider ${defaultProvider} not initialized` };
        }

        const runner = new ProviderClass();

        // If apiKey is passed directly, use it (from frontend localStorage)
        if (apiKey && 'setApiKey' in runner) {
            (runner as any).setApiKey(apiKey);
        }

        console.log(`[Review] Starting review with ${runner.id} for ${snapshotId}`);
        const result = await runner.review(snapshot);

        return { success: true, result };

    } catch (e: any) {
        console.error("LLM Review Error:", e);
        return { success: false, error: e.message };
    }
}

export function setupLLMHandlers(win: BrowserWindow) {
    ipcMain.handle('review-run', async (_event, { jobId, snapshotId, apiKey }: { jobId: string, snapshotId: string, apiKey?: string }) => {
        return await runReview(jobId, snapshotId, apiKey);
    });

    ipcMain.handle('set-card-provider', (_event, provider: string) => {
        setReviewerProvider(provider);
        return true;
    });
}

