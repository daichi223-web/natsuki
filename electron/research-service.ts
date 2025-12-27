import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

const RESEARCH_BASE_DIR = path.join(os.homedir(), '.natsuki', 'research');

async function ensureDir(dir: string) {
    if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
    }
}

// 1. Generate Premises from Intent
async function generatePremises(intent: string): Promise<Premises> {
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
async function generatePlan(premises: Premises): Promise<ResearchPlan> {
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

// 3. Collect Evidence (Mock KB search for v0.1, using file search later if needed)
async function collectEvidence(cwd: string, plan: ResearchPlan): Promise<string[]> {
    // Phase 4.0: Just look for markdown files in 'knowledge' folder if it exists
    const kbDir = path.join(cwd, 'knowledge');
    const evidences: string[] = [];

    if (fs.existsSync(kbDir)) {
        try {
            const files = await fs.promises.readdir(kbDir);
            for (const file of files) {
                if (file.endsWith('.md')) {
                    const content = await fs.promises.readFile(path.join(kbDir, file), 'utf-8');
                    // Simple keyword match
                    if (plan.keywords.some(k => content.toLowerCase().includes(k))) {
                        evidences.push(`From ${file}:\n${content.slice(0, 500)}...`);
                    }
                }
            }
        } catch (e) {
            console.warn('[Research] Failed to read KB:', e);
        }
    }

    if (evidences.length === 0) {
        evidences.push("No local knowledge found for this topic.");
    }

    return evidences;
}

// 4. Build Contract
async function buildContract(premises: Premises, evidence: string[]): Promise<{ json: Contract, markdown: string }> {
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


// --- API Exposure ---

export function setupResearchHandlers() {
    ipcMain.handle('research-intent', async (_, intent: string) => {
        return await generatePremises(intent);
    });

    ipcMain.handle('research-plan', async (_, premises: Premises) => {
        return await generatePlan(premises);
    });

    ipcMain.handle('research-evidence', async (_, { cwd, plan }: { cwd: string, plan: ResearchPlan }) => {
        return await collectEvidence(cwd, plan);
    });

    ipcMain.handle('research-build-contract', async (_, { premises, evidence }: { premises: Premises, evidence: string[] }) => {
        const result = await buildContract(premises, evidence);

        // Save to disk
        // TODO: Organize by jobId properly later. For now, random ID folder or common?
        // v0.1: just return, let frontend handle job creation with this data.
        return result;
    });
}
