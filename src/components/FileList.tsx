import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import clsx from 'clsx';

interface GitStatus {
    path: string;
    status: string; // 'M', '??', etc.
}

interface FileListProps {
    cwd: string;
    selectedFile: string | null;
    onFileSelect: (file: string) => void;
}

export function FileListComponent({ cwd, selectedFile, onFileSelect }: FileListProps) {
    const [files, setFiles] = useState<GitStatus[]>([]);
    const [branch, setBranch] = useState<string>('');
    const [error, setError] = useState<string>('');

    useEffect(() => {
        if (!cwd) return;

        const poll = async () => {
            try {
                const res = await window.electronAPI.invoke('git-status', cwd);
                if (res.success) {
                    setBranch(res.branch);
                    // Parse porcelain output
                    // " M file.ts"
                    // "?? new.ts"
                    const lines = res.status.split('\n').filter((l: string) => l.trim());
                    const parsed = lines.map((line: string) => {
                        const code = line.substring(0, 2);
                        const path = line.substring(3);
                        return { status: code, path };
                    });
                    setFiles(parsed);
                    setError('');
                } else {
                    setError(res.error || 'Unknown error');
                }
            } catch (e) {
                setError(String(e));
            }
        };

        poll();
        const interval = setInterval(poll, 2000);
        return () => clearInterval(interval);
    }, [cwd]);

    return (
        <div className="flex flex-col h-full bg-[#252526] text-white">
            <div className="p-2 border-b border-[#3e3e42] flex justify-between items-center text-sm">
                <span className="font-bold flex items-center gap-1">
                    <RefreshCw size={14} /> CHANGES
                </span>
                <span className="text-xs text-gray-400">{branch}</span>
            </div>

            {error && <div className="text-red-400 text-xs p-2">{error}</div>}

            <div className="flex-1 overflow-auto">
                {files.length === 0 && !error && (
                    <div className="text-gray-500 text-xs text-center mt-4">No changes</div>
                )}
                {files.map(f => (
                    <div
                        key={f.path}
                        className={clsx(
                            "flex items-center px-2 py-1 text-sm cursor-pointer hover:bg-[#2a2d2e]",
                            selectedFile === f.path && "bg-[#37373d]"
                        )}
                        onClick={() => onFileSelect(f.path)}
                    >
                        <span className={clsx(
                            "w-4 mr-2 font-mono text-xs",
                            f.status.includes('?') ? "text-green-400" : "text-amber-400"
                        )}>
                            {f.status}
                        </span>
                        <span className="truncate">{f.path}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
