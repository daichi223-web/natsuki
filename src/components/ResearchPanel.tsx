import React, { useState, useEffect } from 'react';
import { Play, FileText, CheckSquare, Search, ArrowRight, ShieldCheck } from 'lucide-react';

// --- Types (Mirroring Backend) ---
interface Premises {
    intent: string;
    domain: 'game' | 'webapp' | 'tool' | 'unknown';
    product: string;
    platform: 'desktop' | 'web' | 'mobile';
    fidelity: 'prototype' | 'mvp' | 'production';
}

interface ResearchPlan {
    checklist: string[];
    keywords: string[];
}

interface Contract {
    id: string;
    premises: Premises;
    levels: {
        minimum: string[];
        middle: string[];
        maximum: string[];
    };
    requirements: Record<string, string>;
}

export function ResearchPanel() {
    // State machine: 'intake' -> 'premises' -> 'plan' -> 'outcome'
    const [step, setStep] = useState<'intake' | 'premises' | 'plan' | 'outcome'>('intake');
    const [loading, setLoading] = useState(false);

    // Data
    const [intent, setIntent] = useState('');
    const [premises, setPremises] = useState<Premises | null>(null);
    const [plan, setPlan] = useState<ResearchPlan | null>(null);
    const [evidence, setEvidence] = useState<string[]>([]);
    const [contract, setContract] = useState<{ json: Contract, markdown: string } | null>(null);

    // --- Actions ---

    const handleAnalyzeIntent = async () => {
        if (!intent.trim()) return;
        setLoading(true);
        try {
            const result = await window.electronAPI.invoke('research-intent', intent);
            setPremises(result);
            setStep('premises');
        } catch (e) {
            console.error(e);
            alert("Failed to analyze intent");
        } finally {
            setLoading(false);
        }
    };

    const handleGeneratePlan = async () => {
        if (!premises) return;
        setLoading(true);
        try {
            const result = await window.electronAPI.invoke('research-plan', premises);
            setPlan(result);
            setStep('plan');
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleCollectAndBuild = async () => {
        if (!plan || !premises) return;
        setLoading(true);
        try {
            // 1. Collect Evidence (Mock for now, can specify cwd if needed)
            const ev = await window.electronAPI.invoke('research-evidence', { cwd: '', plan });
            setEvidence(ev);

            // 2. Build Contract
            const con = await window.electronAPI.invoke('research-build-contract', { premises, evidence: ev });
            setContract(con);
            setStep('outcome');
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSendToBuilder = async () => {
        if (!contract) return;
        // TODO: This needs to create a job. 
        // For v0.1, we'll just copy to clipboard or alert.
        // In real integration, we'd call 'orchestrator-start' with contract context.
        await navigator.clipboard.writeText(contract.markdown);
        alert("Contract Markdown copied to clipboard! (Job creation integration pending)");
    };

    // --- Render ---

    return (
        <div className="flex flex-col h-full bg-[#1e1e1e] text-gray-300 p-4 overflow-y-auto">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Search className="w-5 h-5 text-purple-400" />
                Research Engine <span className="text-xs font-normal text-gray-500">v0.1</span>
            </h2>

            {/* Stepper */}
            <div className="flex text-xs mb-6 border-b border-[#333] pb-2">
                <div className={`px-2 ${step === 'intake' ? 'text-white font-bold' : 'text-gray-500'}`}>1. Intent</div>
                <div className={`px-2 ${step === 'premises' ? 'text-white font-bold' : 'text-gray-500'}`}>2. Premises</div>
                <div className={`px-2 ${step === 'plan' ? 'text-white font-bold' : 'text-gray-500'}`}>3. Plan</div>
                <div className={`px-2 ${step === 'outcome' ? 'text-white font-bold' : 'text-gray-500'}`}>4. Contract</div>
            </div>

            {loading && <div className="text-blue-400 mb-4 animate-pulse">Processing...</div>}

            {/* Step 1: Intake */}
            {step === 'intake' && (
                <div className="flex flex-col gap-4">
                    <label className="text-sm font-semibold">What is your goal?</label>
                    <textarea
                        className="bg-[#252526] border border-[#333] p-2 rounded text-white h-24"
                        placeholder="e.g., Build a Tetris game in React"
                        value={intent}
                        onChange={e => setIntent(e.target.value)}
                    />
                    <button
                        onClick={handleAnalyzeIntent}
                        disabled={!intent.trim()}
                        className="bg-purple-700 hover:bg-purple-600 text-white px-4 py-2 rounded flex items-center justify-center gap-2"
                    >
                        Analyze <ArrowRight size={16} />
                    </button>
                </div>
            )}

            {/* Step 2: Premises */}
            {step === 'premises' && premises && (
                <div className="flex flex-col gap-4">
                    <div className="bg-[#252526] p-4 rounded border border-[#333]">
                        <h3 className="font-bold text-white mb-2">Premises</h3>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <label>Domain</label>
                            <select
                                value={premises.domain}
                                onChange={e => setPremises({ ...premises, domain: e.target.value as any })}
                                className="bg-[#1e1e1e] border border-[#333] p-1 rounded"
                            >
                                <option value="game">Game</option>
                                <option value="webapp">Web App</option>
                                <option value="tool">Tool</option>
                            </select>

                            <label>Platform</label>
                            <select
                                value={premises.platform}
                                onChange={e => setPremises({ ...premises, platform: e.target.value as any })}
                                className="bg-[#1e1e1e] border border-[#333] p-1 rounded"
                            >
                                <option value="desktop">Desktop</option>
                                <option value="web">Web</option>
                                <option value="mobile">Mobile</option>
                            </select>

                            <label>Fidelity</label>
                            <select
                                value={premises.fidelity}
                                onChange={e => setPremises({ ...premises, fidelity: e.target.value as any })}
                                className="bg-[#1e1e1e] border border-[#333] p-1 rounded"
                            >
                                <option value="prototype">Prototype</option>
                                <option value="mvp">MVP</option>
                                <option value="production">Production</option>
                            </select>
                        </div>
                    </div>
                    <button
                        onClick={handleGeneratePlan}
                        className="bg-blue-700 hover:bg-blue-600 text-white px-4 py-2 rounded flex items-center justify-center gap-2"
                    >
                        Generate Research Plan <ArrowRight size={16} />
                    </button>
                    <button onClick={() => setStep('intake')} className="text-xs text-gray-500 underline">Back</button>
                </div>
            )}

            {/* Step 3: Plan */}
            {step === 'plan' && plan && (
                <div className="flex flex-col gap-4">
                    <div className="bg-[#252526] p-4 rounded border border-[#333]">
                        <h3 className="font-bold text-white mb-2 flex items-center gap-2">
                            <CheckSquare size={16} /> Research Plan
                        </h3>
                        <ul className="list-disc list-inside text-sm text-gray-300 space-y-1">
                            {plan.checklist.map((item, i) => (
                                <li key={i}>{item}</li>
                            ))}
                        </ul>
                    </div>
                    <button
                        onClick={handleCollectAndBuild}
                        className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded flex items-center justify-center gap-2"
                    >
                        Collect & Build Contract <ArrowRight size={16} />
                    </button>
                    <button onClick={() => setStep('premises')} className="text-xs text-gray-500 underline">Back</button>
                </div>
            )}

            {/* Step 4: Outcome (Contract) */}
            {step === 'outcome' && contract && (
                <div className="flex flex-col gap-4 h-full">
                    <div className="bg-[#252526] p-4 rounded border border-[#333] flex-1 overflow-auto">
                        <h3 className="font-bold text-white mb-2 flex items-center gap-2">
                            <ShieldCheck size={16} className="text-green-400" /> Contract Agreement
                        </h3>

                        <div className="space-y-4 text-sm">
                            <div className="border-l-2 border-purple-500 pl-3">
                                <div className="text-xs text-gray-400">ID</div>
                                <div>{contract.json.id}</div>
                            </div>

                            <div>
                                <h4 className="font-semibold text-blue-400 mb-1">Capability Levels</h4>
                                <div className="grid grid-cols-1 gap-2">
                                    <div className="bg-black/20 p-2 rounded">
                                        <div className="text-xs font-bold text-gray-400">MINIMUM (Must)</div>
                                        <ul className="list-disc list-inside text-gray-300">
                                            {contract.json.levels.minimum.map((l, i) => <li key={i}>{l}</li>)}
                                        </ul>
                                    </div>
                                    <div className="bg-black/20 p-2 rounded">
                                        <div className="text-xs font-bold text-gray-400">MIDDLE (Should)</div>
                                        <ul className="list-disc list-inside text-gray-300">
                                            {contract.json.levels.middle.map((l, i) => <li key={i}>{l}</li>)}
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={handleSendToBuilder}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded font-bold"
                    >
                        Copy Contract to Clipboard
                    </button>
                    <button onClick={() => setStep('plan')} className="text-xs text-gray-500 underline">Back</button>
                </div>
            )}
        </div>
    );
}
