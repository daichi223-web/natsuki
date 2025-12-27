import { useState } from 'react';
import { TerminalComponent } from './Terminal';
import { FileListComponent } from './FileList';
import { DiffPaneComponent } from './DiffPane';
import { DiagnosticPanel } from './DiagnosticPanel';
import { JobPanel } from './JobPanel';
import { ResearchPanel } from './ResearchPanel';
import { ReviewPanel } from './ReviewPanel';
import { Folder, Play, Undo, ShieldAlert, Activity, ListTodo, Camera, ClipboardList, Search } from 'lucide-react';
import type { ReviewHistoryItem, ReviewIssue } from '../types';

type VerifyProfile = 'lint' | 'build' | 'typecheck' | 'test';

export function AppShell() {
    const [cwd, setCwd] = useState<string>(''); // Empty = default/home
    const [activeView, setActiveView] = useState<'explorer' | 'jobs' | 'research'>('explorer');
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState('');
    const [showDiagnostics, setShowDiagnostics] = useState(false);

    // ✅ Phase2 Snapshot Engine wiring
    const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
    const [isSnapshotting, setIsSnapshotting] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [lastSnapshotInfo, setLastSnapshotInfo] = useState<string>(''); // small UI hint
    const [lastSnapshotId, setLastSnapshotId] = useState<string | null>(null);
    const [isReviewing, setIsReviewing] = useState(false);
    const [reviewHistory, setReviewHistory] = useState<ReviewHistoryItem[]>([]);
    const [showReviewPanel, setShowReviewPanel] = useState(false);

    const handleSelectWorkspace = async () => {
        const selectedPath = await window.electronAPI.invoke('select-folder');
        if (selectedPath) {
            setCwd(selectedPath);
            setStatusMessage(`Workspace: ${selectedPath}`);
            window.electronAPI.send('terminal-init', selectedPath);
        }
    };

    const handleUndo = async () => {
        if (confirm("Are you sure you want to discard all uncommitted changes? (git restore .)")) {
            const res = await window.electronAPI.invoke('git-restore', cwd);
            if (res.success) {
                setStatusMessage("Undone changes.");
            } else {
                alert("Undo failed: " + res.error);
            }
        }
    };

    // ✅ Snapshot (After) — minimal: git status + git diff + terminal tail
    const handleSnapshot = async () => {
        if (!cwd) return alert('Select a workspace first.');
        if (!selectedJobId) return alert('Select a Job first.');
        if (isSnapshotting) return;

        setIsSnapshotting(true);
        setStatusMessage('Creating snapshot...');
        try {
            const res = await window.electronAPI.invoke('snapshot-create', {
                cwd,
                jobId: selectedJobId,
                includeVerify: false
            });

            if (res?.success) {
                setStatusMessage(`Snapshot created: ${res.snapshotId}`);
                setLastSnapshotId(res.snapshotId);
                setLastSnapshotInfo(`SNAP: ${res.snapshotId} • files:${res.summary?.changedFiles ?? '-'} • exit:${res.summary?.verifyExitCode ?? '-'}`);
            } else {
                alert('Snapshot failed: ' + (res?.error ?? 'Unknown error'));
                setStatusMessage('Snapshot failed.');
            }
        } finally {
            setIsSnapshotting(false);
        }
    };

    // ✅ Verify (allowlist) — run in backend (not by piping into Claude)
    const handleVerify = async (profile: VerifyProfile) => {
        if (!cwd) return alert('Select a workspace first.');
        if (!selectedJobId) return alert('Select a Job first.');
        if (isVerifying) return;

        setIsVerifying(true);
        setStatusMessage(`Running verify: ${profile}...`);
        try {
            const res = await window.electronAPI.invoke('verify-run', {
                cwd,
                jobId: selectedJobId,
                profile
            });

            if (res?.success) {
                setStatusMessage(`Verify OK (${profile}) exit=${res.exitCode}`);
                // After verify, take a snapshot automatically (recommended)
                await handleSnapshot();
            } else {
                setStatusMessage(`Verify failed (${profile})`);
                alert(`Verify failed (${profile}): ` + (res?.error ?? 'Unknown error'));
                // Still snapshot, because failure is evidence
                await handleSnapshot();
            }
        } finally {
            setIsVerifying(false);
        }
    };

    // ✅ Review — call LLM to review the snapshot (v0.1 Capability Levels)
    const handleReview = async () => {
        if (!selectedJobId || !lastSnapshotId) return;
        if (isReviewing) return;

        // Check if backend has key
        const hasKey = await window.electronAPI.invoke('key-has', 'anthropic') || await window.electronAPI.invoke('key-has', 'gemini') || await window.electronAPI.invoke('key-has', 'openai');

        if (!hasKey) {
            // Fallback to local storage or alert
            const localKey = localStorage.getItem('anthropic_api_key');
            if (!localKey) {
                alert('No API keys found. Please set a key in Job Panel Settings.');
                return;
            }
        }

        setIsReviewing(true);
        setStatusMessage('Requesting AI review...');
        try {
            const res = await window.electronAPI.invoke('review-run', {
                jobId: selectedJobId,
                snapshotId: lastSnapshotId,
                apiKey: undefined // Let backend handle it
            });

            if (res?.success && res.result) {
                const { decision, achievedLevel, summary } = res.result;
                setStatusMessage(`Review: ${decision} (${achievedLevel}) - ${summary}`);

                // Add to review history
                const historyItem: ReviewHistoryItem = {
                    id: `review-${Date.now()}`,
                    timestamp: Date.now(),
                    snapshotId: lastSnapshotId,
                    result: res.result
                };
                setReviewHistory(prev => [historyItem, ...prev]);

                // Auto-open panel for important decisions
                if (decision === 'BLOCK' || decision === 'IMPROVE') {
                    setShowReviewPanel(true);
                } else if (decision === 'APPROVE' || decision === 'EXCELLENT') {
                    alert(`Review PASSED (${decision})! ✓\nLevel: ${achievedLevel}\n\n${summary}`);
                }
            } else {
                alert('Review failed: ' + (res?.error ?? 'Unknown error'));
                setStatusMessage('Review failed.');
            }
        } finally {
            setIsReviewing(false);
        }
    };

    // Handle revert from ReviewPanel
    const handleRevertFromReview = async () => {
        if (confirm("Are you sure you want to discard all uncommitted changes? (git restore .)")) {
            const res = await window.electronAPI.invoke('git-restore', cwd);
            if (res.success) {
                setStatusMessage("Changes reverted.");
                setShowReviewPanel(false);
            } else {
                alert("Revert failed: " + res.error);
            }
        }
    };

    // Handle fix job creation from ReviewPanel
    const handleCreateFixJob = (issues: ReviewIssue[]) => {
        // TODO: Create a new job with the issues as context
        const issueList = issues.map(i => `- [${i.severity}] ${i.title}`).join('\n');
        alert(`Fix Job would be created with issues:\n\n${issueList}\n\n(Not implemented yet)`);
        setShowReviewPanel(false);
    };

    return (
        <div className="flex flex-col h-full bg-[#1e1e1e] text-gray-300">
            {/* Control Bar */}
            <div className="h-10 bg-[#333333] flex items-center px-2 shadow-sm shrink-0 border-b border-black">
                <button onClick={handleSelectWorkspace} className="flex items-center gap-1 px-3 py-1 bg-[#007acc] text-white text-xs hover:bg-[#0062a3] mr-2 rounded-sm">
                    <Folder size={14} /> Workspace
                </button>
                <div className="flex-1 text-xs text-gray-400 font-mono truncate mr-2">
                    {cwd || "No workspace selected"}
                </div>

                {/* ✅ Quick status hint for latest snapshot */}
                {lastSnapshotInfo && (
                    <div className="text-[11px] text-gray-400 font-mono truncate mr-2 max-w-[40%]">
                        {lastSnapshotInfo}
                    </div>
                )}

                <div className="flex gap-2">
                    <button
                        onClick={() => handleVerify('lint')}
                        disabled={isVerifying}
                        className="flex items-center gap-1 px-2 py-1 bg-[#3e3e42] text-xs hover:bg-[#4e4e52] rounded-sm disabled:opacity-50"
                    >
                        <ShieldAlert size={12} /> Lint
                    </button>
                    <button
                        onClick={() => handleVerify('build')}
                        disabled={isVerifying}
                        className="flex items-center gap-1 px-2 py-1 bg-[#3e3e42] text-xs hover:bg-[#4e4e52] rounded-sm disabled:opacity-50"
                    >
                        <Play size={12} /> Build
                    </button>

                    {/* ✅ Snapshot button */}
                    <button
                        onClick={handleSnapshot}
                        disabled={isSnapshotting}
                        className="flex items-center gap-1 px-2 py-1 bg-[#2d2d30] text-gray-300 text-xs hover:bg-[#3e3e42] rounded-sm disabled:opacity-50"
                        title="Create Snapshot (diff/status/log tail)"
                    >
                        <Camera size={12} /> Snap
                    </button>

                    {/* ✅ Review button */}
                    <button
                        onClick={handleReview}
                        disabled={isReviewing || !lastSnapshotId}
                        className="flex items-center gap-1 px-2 py-1 bg-purple-900/50 hover:bg-purple-900 text-purple-100 rounded-sm text-xs border border-purple-900 ml-2 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Request AI Review (requires Snapshot)"
                    >
                        <ShieldAlert size={12} /> Review
                    </button>
                    {/* Review History button */}
                    {reviewHistory.length > 0 && (
                        <button
                            onClick={() => setShowReviewPanel(true)}
                            className="flex items-center gap-1 px-2 py-1 bg-[#2d2d30] text-gray-300 text-xs hover:bg-[#3e3e42] rounded-sm"
                            title="View Review History"
                        >
                            <ClipboardList size={12} /> ({reviewHistory.length})
                        </button>
                    )}

                    <button onClick={handleUndo} className="flex items-center gap-1 px-2 py-1 bg-[#8a1c1c] text-white text-xs hover:bg-[#a12323] rounded-sm">
                        <Undo size={12} /> Undo
                    </button>
                    <button onClick={() => setShowDiagnostics(true)} className="flex items-center gap-1 px-2 py-1 bg-[#2d2d30] text-gray-300 text-xs hover:bg-[#3e3e42] border-l border-[#3e3e42] ml-2 rounded-sm">
                        <Activity size={12} /> Diag
                    </button>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="flex-1 flex overflow-hidden">
                {/* Activity Bar */}
                <div className="w-12 bg-[#333333] flex flex-col items-center py-2 gap-2 shrink-0 border-r border-black">
                    <button
                        onClick={() => setActiveView('explorer')}
                        className={`p-2 rounded ${activeView === 'explorer' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                        title="Explorer"
                    >
                        <Folder size={24} strokeWidth={1.5} />
                    </button>
                    <button
                        onClick={() => setActiveView('jobs')}
                        className={`p-2 rounded ${activeView === 'jobs' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                        title="Jobs (Iori)"
                    >
                        <ListTodo size={24} strokeWidth={1.5} />
                    </button>
                    <button
                        onClick={() => setActiveView('research')}
                        className={`p-2 rounded ${activeView === 'research' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                        title="Research Engine"
                    >
                        <Search size={24} strokeWidth={1.5} />
                    </button>
                </div>

                {/* Sidebar Pane */}
                <div className="w-64 border-r border-[#3e3e42] flex flex-col bg-[#252526]">
                    <div className="h-9 px-4 flex items-center text-xs font-bold text-gray-400 bg-[#252526] uppercase tracking-wide">
                        {activeView === 'explorer' ? 'Explorer' : activeView === 'jobs' ? 'Jobs' : 'Research'}
                    </div>
                    <div className="flex-1 overflow-auto">
                        {activeView === 'explorer' && (
                            <FileListComponent cwd={cwd} selectedFile={selectedFile} onFileSelect={setSelectedFile} />
                        )}
                        {activeView === 'jobs' && (
                            <JobPanel
                                cwd={cwd}
                                selectedJobId={selectedJobId}
                                onSelectJob={setSelectedJobId}
                            />
                        )}
                        {activeView === 'research' && (
                            <ResearchPanel selectedJobId={selectedJobId} />
                        )}
                    </div>
                </div>

                {/* Diff / Main View */}
                <div className="flex-1 flex flex-col min-w-[300px] bg-[#1e1e1e]">
                    <DiffPaneComponent cwd={cwd} file={selectedFile} />
                </div>
            </div>

            {/* Bottom: Terminal */}
            <div className="h-[40%] border-t border-[#3e3e42] bg-black">
                <TerminalComponent cwd={cwd} />
            </div>

            {/* Status Bar */}
            <div className="h-6 bg-[#007acc] text-white text-xs flex items-center px-2 shrink-0">
                {statusMessage}
            </div>
            {showDiagnostics && <DiagnosticPanel onClose={() => setShowDiagnostics(false)} />}
            {showReviewPanel && (
                <ReviewPanel
                    reviews={reviewHistory}
                    onClose={() => setShowReviewPanel(false)}
                    onRevert={handleRevertFromReview}
                    onFixJob={handleCreateFixJob}
                />
            )}
        </div>
    );
}
