import { useState, useEffect } from 'react';
import { Settings, Key, X, Check, Eye, EyeOff } from 'lucide-react';

interface Props {
    onClose: () => void;
}

export function SettingsPanel({ onClose }: Props) {
    const [apiKey, setApiKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        const stored = localStorage.getItem('anthropic_api_key') || '';
        setApiKey(stored);
    }, []);

    const handleSave = () => {
        if (apiKey.trim()) {
            localStorage.setItem('anthropic_api_key', apiKey.trim());
        } else {
            localStorage.removeItem('anthropic_api_key');
        }
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    const handleClear = () => {
        setApiKey('');
        localStorage.removeItem('anthropic_api_key');
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-[#1e1e1e] border border-[#3e3e42] w-[500px] flex flex-col shadow-2xl rounded-lg overflow-hidden">
                {/* Header */}
                <div className="h-12 bg-[#252526] border-b border-[#3e3e42] flex items-center justify-between px-4">
                    <h2 className="font-bold text-white flex items-center gap-2">
                        <Settings size={18} className="text-gray-400" />
                        Settings
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    {/* API Key Section */}
                    <div className="space-y-2">
                        <label className="text-sm text-gray-400 flex items-center gap-2">
                            <Key size={14} />
                            Anthropic API Key
                        </label>
                        <p className="text-xs text-gray-500">
                            Required for autonomous review. Get your key from{' '}
                            <a
                                href="https://console.anthropic.com/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:underline"
                            >
                                console.anthropic.com
                            </a>
                        </p>
                        <div className="flex gap-2">
                            <div className="flex-1 relative">
                                <input
                                    type={showKey ? 'text' : 'password'}
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    placeholder="sk-ant-api03-..."
                                    className="w-full bg-[#252526] border border-[#3e3e42] px-3 py-2 text-sm text-gray-300 font-mono focus:outline-none focus:border-blue-500 rounded pr-10"
                                />
                                <button
                                    onClick={() => setShowKey(!showKey)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                                >
                                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-2">
                        <button
                            onClick={handleSave}
                            className="flex items-center gap-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded"
                        >
                            {saved ? <Check size={14} /> : null}
                            {saved ? 'Saved!' : 'Save'}
                        </button>
                        <button
                            onClick={handleClear}
                            className="flex items-center gap-1 px-4 py-2 bg-[#3e3e42] hover:bg-[#4e4e52] text-gray-300 text-sm rounded"
                        >
                            Clear
                        </button>
                    </div>

                    {/* Info */}
                    <div className="text-xs text-gray-500 pt-4 border-t border-[#3e3e42]">
                        <p className="mb-2">
                            <strong>Autonomous Mode:</strong> When API key is set, jobs will automatically:
                        </p>
                        <ul className="list-disc list-inside space-y-1 text-gray-600">
                            <li>Run verification (lint/build)</li>
                            <li>Create snapshots</li>
                            <li>Get AI code review</li>
                            <li>Auto-fix issues (up to 2 attempts)</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
