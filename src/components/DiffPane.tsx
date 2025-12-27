import { useState, useEffect } from 'react';

interface DiffPaneProps {
    cwd: string;
    file: string | null;
}

export function DiffPaneComponent({ cwd, file }: DiffPaneProps) {
    const [diff, setDiff] = useState<string>('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!cwd || !file) {
            setDiff('');
            return;
        }

        const fetchDiff = async () => {
            setLoading(true);
            try {
                const res = await window.electronAPI.invoke('git-diff', { cwd, file });
                if (res.success) {
                    setDiff(res.diff);
                } else {
                    setDiff(`Error: ${res.error}`);
                }
            } catch (e) {
                setDiff(`Error: ${String(e)}`);
            } finally {
                setLoading(false);
            }
        };

        fetchDiff();
        // Poll logic could be added here
        const interval = setInterval(fetchDiff, 3000); // 3s polling for diff
        return () => clearInterval(interval);

    }, [cwd, file]);

    if (!file) {
        return <div className="h-full flex items-center justify-center text-gray-500 bg-[#1e1e1e]">Select a file to view diff</div>
    }

    return (
        <div className="h-full flex flex-col bg-[#1e1e1e] text-gray-300 font-mono text-sm">
            <div className="p-2 border-b border-[#3e3e42] bg-[#252526]">
                {file}
            </div>
            <div className="flex-1 overflow-auto p-2 whitespace-pre">
                {loading && <div className="text-xs text-blue-400 mb-2">Loading...</div>}
                {diff || "No content (or binary file)"}
            </div>
        </div>
    );
}
