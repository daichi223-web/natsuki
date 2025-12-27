import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

// --- Types ---

export interface Premises {
    intent: string;
    domain: 'game' | 'webapp' | 'tool' | 'unknown';
    product: string;
    platform: 'desktop' | 'web' | 'mobile';
    fidelity: 'prototype' | 'mvp' | 'production';
}

export interface ResearchPlan {
    checklist: string[];
    keywords: string[];
}

export interface ContractLevels {
    minimum: string[];
    middle: string[];
    maximum: string[];
}

export interface Contract {
    id: string;
    premises: Premises;
    levels: ContractLevels;
    requirements: Record<string, string>;
}

// --- Templates (Rule-based for v0.1) ---

const DOMAIN_LEVELS: Record<string, ContractLevels> = {
    'game': {
        minimum: ['core_loop_playable', 'win_loss_condition', 'basic_controls'],
        middle: ['score_system', 'sound_effects', 'restart_capability'],
        maximum: ['save_load', 'high_score_persistence', 'settings_menu']
    },
    'webapp': {
        minimum: ['basic_routing', 'crud_operations', 'responsive_layout'],
        middle: ['auth_flow', 'error_handling', 'loading_states'],
        maximum: ['dark_mode', 'analytics', 'offline_support']
    },
    'tool': {
        minimum: ['cli_arguments', 'basic_output', 'error_codes'],
        middle: ['config_file_support', 'verbose_mode', 'piping_support'],
        maximum: ['plugin_system', 'auto_update', 'gui_mode']
    }
};

// --- Service Implementation ---

// Helper: Search with ripgrep or fallback
async function searchKnowledge(cwd: string, query: string): Promise<string[]> {
    const kbDir = path.join(cwd, 'knowledge');
    if (!fs.existsSync(kbDir)) return [];

    const results: string[] = [];

    // Try ripgrep first
    try {
        const lines = await new Promise<string[]>((resolve) => {
            const rg = spawn('rg', ['-i', '-n', '--no-heading', '--max-count', '3', query, 'knowledge'], { cwd });
            let out = '';
            rg.stdout.on('data', d => out += d);
            rg.on('error', () => resolve([]));
            rg.on('close', () => resolve(out.split('\n').filter(l => l.trim())));
        });

        if (lines.length > 0) {
            return lines.map(l => {
                // rg output: file:line:content
                const parts = l.split(':');
                if (parts.length >= 3) {
                    const file = parts[0];
                    const line = parts[1];
                    const content = parts.slice(2).join(':').trim();
                    return `[${file}:${line}] ${content}`;
                }
                return l;
            });
        }
    } catch (e) {
        // ignore rg error
    }

    // Fallback: Recursive Node search (Simple version)
    try {
        const files: string[] = [];
        async function recurse(dir: string) {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const ent of entries) {
                const fullPath = path.join(dir, ent.name);
                if (ent.isDirectory()) {
                    await recurse(fullPath);
                } else if (ent.isFile() && (ent.name.endsWith('.md') || ent.name.endsWith('.txt'))) {
                    files.push(fullPath);
                }
            }
        }
        await recurse(kbDir);

        for (const file of files) {
            const content = await fs.promises.readFile(file, 'utf-8');
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
                if (line.toLowerCase().includes(query.toLowerCase())) {
                    const relPath = path.relative(kbDir, file);
                    if (results.length < 5) { // Limit fallback results per keyword
                        results.push(`[${relPath}:${idx + 1}] ${line.trim()}`);
                    }
                }
            });
        }
    } catch (e) {
        console.warn('Fallback search failed:', e);
    }
    return results;
}

// 1. Generate Premises from Intent
export async function generatePremises(intent: string): Promise<Premises> {
    const lower = intent.toLowerCase();
    let domain: Premises['domain'] = 'unknown';
    let product = 'project';

    // Simple heuristic
    if (lower.includes('tetris') || lower.includes('game') || lower.includes('rpg')) {
        domain = 'game';
        if (lower.includes('tetris')) product = 'tetris';
    } else if (lower.includes('site') || lower.includes('app') || lower.includes('web')) {
        domain = 'webapp';
    } else if (lower.includes('cli') || lower.includes('tool') || lower.includes('script')) {
        domain = 'tool';
    }

    return {
        intent,
        domain,
        product,
        platform: 'desktop', // Default
        fidelity: 'prototype' // Default
    };
}

// 2. Generate Research Plan
export async function generatePlan(premises: Premises): Promise<ResearchPlan> {
    const checklist = [
        `Identify core requirements for ${premises.domain}`,
        `Search local KB for ${premises.product} patterns`
    ];

    if (premises.domain === 'game') {
        checklist.push('Check for input handling patterns');
        checklist.push('Check for game loop implementation');
    }

    return {
        checklist,
        keywords: [premises.domain, premises.product]
    };
}

// 3. Collect Evidence
export async function collectEvidence(cwd: string, plan: ResearchPlan): Promise<string[]> {
    const evidences: string[] = [];

    for (const keyword of plan.keywords) {
        const hits = await searchKnowledge(cwd, keyword);
        if (hits.length > 0) {
            evidences.push(`## Matches for "${keyword}":\n` + hits.join('\n'));
        }
    }

    if (evidences.length === 0) {
        evidences.push("No local knowledge found for keywords: " + plan.keywords.join(', '));
    }

    return evidences;
}

// 4. Build Contract
export async function buildContract(premises: Premises, evidence: string[]): Promise<{ json: Contract, markdown: string }> {
    const defaultLevels = DOMAIN_LEVELS[premises.domain] || DOMAIN_LEVELS['tool'];

    // Customize levels based on premises (v0.1 logic)
    const levels = { ...defaultLevels };
    if (premises.fidelity === 'production') {
        levels.minimum = [...levels.minimum, ...levels.middle];
        levels.middle = [...levels.maximum];
        // Maximum becomes "Blue Sky"
    }

    const contractId = `contract:${premises.product}:${Date.now()}`;

    const contractJson: Contract = {
        id: contractId,
        premises,
        levels,
        requirements: {
            "core": `${premises.product} core features based on ${premises.domain} standards.`,
            "platform": `Targeting ${premises.platform} platform.`
        }
    };

    const evidenceText = evidence.join('\n\n');

    const markdown = `# Contract: ${premises.product}
ID: ${contractId}

## Premises
- Domain: ${premises.domain}
- Platform: ${premises.platform}
- Fidelity: ${premises.fidelity}

## Capability Levels (The Judge's Criteria)
### Minimum (Must Have)
${levels.minimum.map(l => `- [ ] ${l}`).join('\n')}

### Middle (Should Have)
${levels.middle.map(l => `- [ ] ${l}`).join('\n')}

### Maximum (Nice to Have)
${levels.maximum.map(l => `- [ ] ${l}`).join('\n')}

## Evidence Used
${evidenceText}
`;

    return { json: contractJson, markdown };
}
