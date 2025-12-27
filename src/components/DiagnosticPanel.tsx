import { useState, useEffect } from 'react';
import { Activity, RefreshCw, AlertTriangle, Terminal, Cpu, Network, CheckCircle, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';

interface DiagnosticState {
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

const STALL_THRESHOLD = 20000;
const PROBE_TIMEOUT = 30000;

export function DiagnosticPanel({ onClose }: { onClose: () => void }) {
    const [state, setState] = useState<DiagnosticState | null>(null);
    const [llmStatus, setLlmStatus] = useState<'idle' | 'testing' | 'ok' | 'timeout' | 'error'>('idle');
    const [probeStartTime, setProbeStartTime] = useState<number | null>(null);

    const fetchData = async () => {
        try {
            const data = await window.electronAPI.invoke('get-diagnostics');
            setState(data);
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 1000);
        return () => clearInterval(interval);
    }, []);

    // LLM Probe Logic
    const runLlmProbe = () => {
        if (!state?.process.isAlive) return;
        setLlmStatus('testing');
        setProbeStartTime(Date.now());

        // Send a "silent" probe if possible, or just "hello" as spec suggests
        window.electronAPI.send('terminal-input', 'hello\r');

        const checkInterval = setInterval(async () => {
            const fresh = await window.electronAPI.invoke('get-diagnostics');

            // Check if output received AFTER we started probe
            if (fresh.pty.lastOutputTime > (probeStartTime || Date.now())) {
                setLlmStatus('ok');
                setProbeStartTime(null);
                clearInterval(checkInterval);
                return;
            }

            // Timeout check
            if (Date.now() - (probeStartTime || Date.now()) > PROBE_TIMEOUT) {
                setLlmStatus('timeout');
                setProbeStartTime(null);
                clearInterval(checkInterval);
            }
        }, 500);
    };

    const handleRestart = async () => {
        if (confirm('Restart PTY session? This will kill the current process.')) {
            await window.electronAPI.invoke('restart-pty');
            // Re-init? Or let app handle it. 
            // Ideally notify parent to re-init.
            // For now, reload window is the cleanest "Restart Session" for MVP
            window.location.reload();
        }
    };

    // Derived Status
    const isProcessAlive = state?.process.isAlive;
    const isStalled = isProcessAlive && (state?.pty.timeSinceLastOutput || 0) > STALL_THRESHOLD;
    const hasRx = (state?.pty.bytesReceived || 0) > 0;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-[#1e1e1e] border border-[#3e3e42] w-[800px] h-[600px] flex flex-col shadow-2xl rounded-lg overflow-hidden font-sans">
                {/* Header */}
                <div className="h-12 bg-[#252526] border-b border-[#3e3e42] flex items-center justify-between px-4">
                    <h2 className="font-bold text-white flex items-center gap-2">
                        <Activity className="text-blue-400" size={18} />
                        Diagnostic Panel <span className="text-xs text-gray-500 font-mono">v0.1</span>
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
                </div>

                <div className="flex-1 overflow-auto p-4 space-y-6">

                    {/* A. Session Overview */}
                    <div className="flex items-center gap-4">
                        <div className={clsx(
                            "px-4 py-2 rounded text-lg font-bold flex items-center gap-2 border",
                            !isProcessAlive ? "bg-red-900/30 border-red-800 text-red-500" :
                                isStalled ? "bg-amber-900/30 border-amber-800 text-amber-500" :
                                    "bg-green-900/30 border-green-800 text-green-500"
                        )}>
                            {!isProcessAlive ? <XCircle /> : isStalled ? <AlertTriangle /> : <CheckCircle />}
                            {!isProcessAlive ? "EXITED" : isStalled ? "STALLED" : "RUNNING"}
                        </div>
                        <div className="text-sm text-gray-400">
                            {isStalled && <span>No output for {formatDistanceToNow(Date.now() - (state?.pty.timeSinceLastOutput || 0))}</span>}
                            {!isProcessAlive && <span>Exit Code: {state?.process.exitCode ?? 'Unknown'}</span>}
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        {/* B. Process */}
                        <div className="bg-[#2d2d30] p-4 rounded border border-[#3e3e42]">
                            <h3 className="text-gray-400 font-bold text-xs uppercase mb-3 flex items-center gap-2">
                                <Cpu size={14} /> Process
                            </h3>
                            <div className="space-y-2 text-sm">
                                <Row label="PID" value={state?.process.pid} />
                                <Row label="Command" value={state?.process.spawnCommand} truncate />
                                <Row label="Uptime" value={state?.process.isAlive ? formatDistanceToNow(Date.now() - state.process.uptimeMs) : 'Stopped'} />
                                <div className="mt-2 pt-2 border-t border-[#3e3e42] flex justify-between">
                                    <span className="text-gray-500">Status</span>
                                    <span className={state?.process.isAlive ? "text-green-400" : "text-red-400"}>
                                        {state?.process.isAlive ? "ALIVE" : "DEAD"}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* C. PTY */}
                        <div className="bg-[#2d2d30] p-4 rounded border border-[#3e3e42]">
                            <h3 className="text-gray-400 font-bold text-xs uppercase mb-3 flex items-center gap-2">
                                <Terminal size={14} /> PTY (I/O)
                            </h3>
                            <div className="space-y-2 text-sm">
                                <Row label="Backend" value="node-pty" />
                                <Row label="RX Bytes" value={state?.pty.bytesReceived.toLocaleString()} />
                                <Row label="Last Output" value={state?.pty.lastOutputTime ? formatDistanceToNow(state.pty.lastOutputTime) + ' ago' : 'Never'} />

                                <div className="mt-2 pt-2 border-t border-[#3e3e42]">
                                    {!hasRx && <div className="text-red-400 text-xs">⚠ No output received yet</div>}
                                </div>
                            </div>
                        </div>

                        {/* D. LLM Reachability */}
                        <div className="bg-[#2d2d30] p-4 rounded border border-[#3e3e42]">
                            <h3 className="text-gray-400 font-bold text-xs uppercase mb-3 flex items-center gap-2">
                                <Network size={14} /> LLM Reachability
                            </h3>
                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={runLlmProbe}
                                    disabled={!isProcessAlive || llmStatus === 'testing'}
                                    className="px-3 py-1 bg-[#007acc] hover:bg-[#0062a3] disabled:opacity-50 text-white text-xs rounded transition-colors"
                                >
                                    {llmStatus === 'testing' ? 'Probing...' : 'Run Probe (Send "hello")'}
                                </button>

                                <div className="mt-2 text-sm flex justify-between">
                                    <span className="text-gray-400">Result:</span>
                                    <StatusBadge status={llmStatus} />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* E. Recommendations */}
                    <div className="bg-[#252526] border border-[#3e3e42] rounded p-4">
                        <h3 className="text-white font-bold text-sm mb-2">💡 Recommendations</h3>
                        <ul className="list-disc list-inside text-sm text-gray-300 space-y-1">
                            {!isProcessAlive && (
                                <li className="text-red-300">Process exited. Check your path or installation. <button onClick={handleRestart} className="underline text-blue-400">Restart Session</button></li>
                            )}
                            {isStalled && (
                                <li className="text-amber-300">Session stalled. Try pressing Enter or <button onClick={handleRestart} className="underline text-blue-400">Restart</button>.</li>
                            )}
                            {llmStatus === 'timeout' && (
                                <li className="text-red-300">LLM Timeout. Check network/VPN/Auth.</li>
                            )}
                            {isProcessAlive && !isStalled && llmStatus !== 'timeout' && (
                                <li className="text-green-400">System appears healthy. If stuck, try typing "clear".</li>
                            )}
                        </ul>
                    </div>

                    {/* Recent Logs */}
                    <div className="flex-1 flex flex-col min-h-0 bg-black rounded p-2 border border-[#3e3e42]">
                        <h3 className="text-gray-500 font-mono text-xs mb-1">Recent PTY Output (Raw)</h3>
                        <div className="flex-1 overflow-auto font-mono text-xs text-gray-400 whitespace-pre-wrap">
                            {state?.pty.recentLogs.join('\n') || 'No logs yet...'}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Row({ label, value, truncate }: { label: string, value: any, truncate?: boolean }) {
    return (
        <div className="flex justify-between items-center">
            <span className="text-gray-500">{label}</span>
            <span className={clsx("font-mono text-gray-300", truncate && "truncate max-w-[120px]")} title={String(value)}>
                {value ?? '-'}
            </span>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    if (status === 'idle') return <span className="text-gray-500">Idle</span>;
    if (status === 'testing') return <span className="text-blue-400 animate-pulse">Testing...</span>;
    if (status === 'ok') return <span className="text-green-400">OK</span>;
    if (status === 'timeout') return <span className="text-red-400">TIMEOUT</span>;
    return <span className="text-red-500">ERROR</span>;
}
