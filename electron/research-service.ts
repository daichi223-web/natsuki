import { ipcMain } from 'electron';
import { generatePremises, generatePlan, collectEvidence, buildContract, Premises, ResearchPlan } from './research-core';

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
        // Save to disk or handle further saving logic here if needed
        return result;
    });
}
