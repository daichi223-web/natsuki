import { useState, useEffect } from 'react';
import { Play, Check, AlertCircle, Clock, Settings, Key, Trash2, X, Wrench } from 'lucide-react';
import type { Job } from '../types';

type Props = {
    cwd: string;
    selectedJobId: string | null;
    onSelectJob: (jobId: string) => void;
};

const PROVIDERS = [
    { id: 'anthropic', name: 'Anthropic (Claude)' },
    { id: 'gemini', name: 'Google (Gemini)' },
    { id: 'openai', name: 'OpenAI (GPT-4)' },
    { id: 'tiered', name: 'Auto (Tiered: Gemini -> Claude)' }
];

export function JobPanel({ cwd, selectedJobId, onSelectJob }: Props) {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [input, setInput] = useState('');
    const [showSettings, setShowSettings] = useState(false);

    // Settings State
    const [provider, setProvider] = useState(localStorage.getItem('natsuki_provider') || 'anthropic');
    const [apiKeyInput, setApiKeyInput] = useState('');
    const [hasKey, setHasKey] = useState(false);

    // Load initial jobs or sync with backend
    useEffect(() => {
        // Fetch initial list
        window.electronAPI.invoke('job-list').then(setJobs).catch(console.error);

        const removeListener = window.electronAPI.on('job-update', (updatedJob: Job) => {
            setJobs(prev => {
                const idx = prev.findIndex(j => j.id === updatedJob.id);
                if (idx >= 0) {
                    const newJobs = [...prev];
                    newJobs[idx] = { ...newJobs[idx], ...updatedJob };
                    return newJobs;
                }
                // If not found, it's a new job (e.g. created by backend)
                return [updatedJob, ...prev];
            });
        });

        // Sync initial provider
        window.electronAPI.invoke('set-card-provider', provider);
        checkKeyStatus(provider);

        return () => {
            removeListener();
        };
    }, []);

    const checkKeyStatus = async (prov: string) => {
        try {
            const exists = await window.electronAPI.invoke('key-has', prov);
            setHasKey(exists);
        } catch (e) {
            console.error("Failed to check key", e);
        }
    };

    const handleProviderChange = (newProvider: string) => {
        setProvider(newProvider);
        localStorage.setItem('natsuki_provider', newProvider);
        window.electronAPI.invoke('set-card-provider', newProvider);
        checkKeyStatus(newProvider);
        setApiKeyInput(''); // Clear input when switching
    };

    const handleSaveKey = async () => {
        if (!apiKeyInput.trim()) return;
        await window.electronAPI.invoke('key-set', provider, apiKeyInput.trim());
        setApiKeyInput('');
        checkKeyStatus(provider);
        alert(`API Key for ${provider} saved successfully.`);
    };

    const handleDeleteKey = async () => {
        if (confirm(`Delete API Key for ${provider}?`)) {
            await window.electronAPI.invoke('key-delete', provider);
            checkKeyStatus(provider);
        }
    };

    const handleCreateJob = () => {
        if (!input.trim()) return;

        const newJob: Job = {
            id: Date.now().toString(),
            description: input,
            status: 'idle',
            createdAt: Date.now()
        };

        setJobs([newJob, ...jobs]);
        setInput('');
        onSelectJob(newJob.id);
    };

    const handleRunJob = async (jobId: string) => {
        const job = jobs.find(j => j.id === jobId);
        if (!job) return;

        onSelectJob(jobId);
        setJobs(prev => prev.map(j => (j.id === jobId ? { ...j, status: 'running' } : j)));

        if (!cwd) return alert("Select workspace first");

        console.log(`Starting Job ${jobId} via Orchestrator`);
        try {
            await window.electronAPI.invoke('orchestrator-start', { jobId, cwd });
        } catch (e) {
            console.error("Failed to start job", e);
            alert("Failed to start orchestrator: " + e);
            setJobs(prev => prev.map(j => (j.id === jobId ? { ...j, status: 'failed' } : j)));
        }
    };

    return (
        <div className="h-full flex flex-col bg-[#1e1e1e] text-gray-300 relative">
            {/* Header */}
            <div className="p-3 border-b border-[#333] flex justify-between items-start">
                <div className="flex-1">
                    <h2 className="text-sm font-bold mb-2">New Job</h2>
                    <div className="flex gap-2 mb-2">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Describe task (e.g. Refactor utils.ts)"
                            className="flex-1 bg-[#252526] border border-[#333] px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                            onKeyDown={(e) => e.key === 'Enter' && handleCreateJob()}
                        />
                        <button
                            onClick={handleCreateJob}
                            className="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded-sm"
                        >
                            Add
                        </button>
                    </div>
                    <div className="text-[11px] text-gray-500 font-mono truncate">
                        {cwd ? `cwd: ${cwd}` : 'cwd: (none)'} {selectedJobId ? `• selected: ${selectedJobId}` : ''}
                    </div>
                </div>
                <button
                    onClick={() => setShowSettings(!showSettings)}
                    className="p-1 hover:bg-[#333] rounded ml-2 text-gray-400 hover:text-white"
                    title="Settings (API Keys)"
                >
                    <Settings size={14} />
                </button>
            </div>

            {/* Settings Overlay */}
            {showSettings && (
                <div className="absolute inset-x-0 top-[85px] z-10 bg-[#252526] border-b border-[#333] p-4 shadow-xl">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="text-sm font-bold flex items-center gap-2">
                            <Key size={14} /> API Configuration
                        </h3>
                        <button onClick={() => setShowSettings(false)} className="text-gray-500 hover:text-white">
                            <X size={14} />
                        </button>
                    </div>

                    <div className="space-y-3">
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Provider</label>
                            <select
                                value={provider}
                                onChange={(e) => handleProviderChange(e.target.value)}
                                className="w-full bg-[#1e1e1e] border border-[#333] text-sm px-2 py-1 rounded-sm focus:outline-none focus:border-blue-500"
                            >
                                {PROVIDERS.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs text-gray-400 mb-1">
                                API Key {hasKey ? <span className="text-green-500">(Set)</span> : <span className="text-red-500">(Missing)</span>}
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="password"
                                    value={apiKeyInput}
                                    onChange={(e) => setApiKeyInput(e.target.value)}
                                    placeholder={hasKey ? "Key is set (enter to update)" : "Enter API Key"}
                                    className="flex-1 bg-[#1e1e1e] border border-[#333] px-2 py-1 text-sm rounded-sm focus:outline-none focus:border-blue-500"
                                />
                                <button
                                    onClick={handleSaveKey}
                                    disabled={!apiKeyInput}
                                    className="px-3 py-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs rounded-sm"
                                >
                                    Save
                                </button>
                                {hasKey && (
                                    <button
                                        onClick={handleDeleteKey}
                                        className="px-2 py-1 bg-red-900/50 hover:bg-red-900 text-red-200 text-xs rounded-sm"
                                        title="Delete Key"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="text-[10px] text-gray-500 pt-2 border-t border-[#333]">
                            Keys are stored securely in OS Keychain (via safeStorage).
                        </div>
                    </div>
                </div>
            )}

            {/* Job List */}
            <div className="flex-1 overflow-auto p-2 space-y-2">
                {jobs.length === 0 && (
                    <div className="text-center text-gray-600 text-xs mt-4">
                        No jobs yet. Add one above.
                    </div>
                )}

                {jobs.map(job => {
                    const isSelected = selectedJobId === job.id;
                    const isFixJob = job.description.startsWith('[Fix]');

                    return (
                        <div
                            key={job.id}
                            onClick={() => onSelectJob(job.id)}
                            className={[
                                'border p-2 rounded-sm text-sm cursor-pointer',
                                isFixJob ? 'bg-orange-900/20' : 'bg-[#252526]',
                                isSelected
                                    ? (isFixJob ? 'border-orange-500 ring-1 ring-orange-600/30' : 'border-blue-500 ring-1 ring-blue-600/30')
                                    : 'border-[#333] hover:border-[#444]'
                            ].join(' ')}
                            title={isFixJob ? "Fix Job (auto-generated from Review)" : "Click to select this job"}
                        >
                            <div className="flex justify-between items-start mb-1 gap-2">
                                <span className="font-medium text-gray-200 leading-snug break-words flex items-start gap-1">
                                    {isFixJob && <Wrench size={14} className="text-orange-400 shrink-0 mt-0.5" />}
                                    <span>{isFixJob ? job.description.replace('[Fix] ', '') : job.description}</span>
                                </span>
                                <StatusBadge status={job.status} />
                            </div>

                            <div className="flex justify-between items-center mt-2">
                                <span className="text-xs text-gray-500">
                                    {new Date(job.createdAt).toLocaleTimeString()}
                                </span>

                                {job.status !== 'running' && job.status !== 'verifying' && job.status !== 'reviewing' && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleRunJob(job.id);
                                        }}
                                        className="flex items-center gap-1 text-xs bg-[#333] hover:bg-[#444] px-2 py-0.5 rounded-sm"
                                    >
                                        <Play size={10} /> Run
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function StatusBadge({ status }: { status: Job['status'] }) {
    switch (status) {
        case 'idle':
            return (
                <span className="text-gray-500 text-xs flex items-center gap-1 shrink-0">
                    <Clock size={10} /> Idle
                </span>
            );
        case 'running':
            return (
                <span className="text-blue-400 text-xs flex items-center gap-1 shrink-0">
                    <Clock size={10} className="animate-spin" /> Running
                </span>
            );
        case 'verifying':
            return (
                <span className="text-yellow-400 text-xs flex items-center gap-1 shrink-0">
                    <Clock size={10} className="animate-spin" /> Verifying
                </span>
            );
        case 'snapshotting':
            return (
                <span className="text-purple-400 text-xs flex items-center gap-1 shrink-0">
                    <Clock size={10} className="animate-spin" /> Snap
                </span>
            );
        case 'reviewing':
            return (
                <span className="text-indigo-400 text-xs flex items-center gap-1 shrink-0">
                    <Clock size={10} className="animate-spin" /> Review
                </span>
            );
        case 'fixing':
            return (
                <span className="text-orange-400 text-xs flex items-center gap-1 shrink-0">
                    <Clock size={10} className="animate-spin" /> Fixing
                </span>
            );
        case 'waiting_approval':
            return (
                <span className="text-pink-400 text-xs flex items-center gap-1 shrink-0">
                    <AlertCircle size={10} /> Wait
                </span>
            );
        case 'completed':
            return (
                <span className="text-green-500 text-xs flex items-center gap-1 shrink-0">
                    <Check size={10} /> Done
                </span>
            );
        case 'failed':
            return (
                <span className="text-red-500 text-xs flex items-center gap-1 shrink-0">
                    <AlertCircle size={10} /> Failed
                </span>
            );
    }
}

