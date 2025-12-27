import { useState, type ReactNode } from 'react';
import { X, AlertTriangle, CheckCircle, XCircle, ChevronDown, ChevronRight, Shield, Zap, Wrench, RotateCcw, Play } from 'lucide-react';

// Types matching llm-service.ts
type Decision = 'BLOCK' | 'IMPROVE' | 'APPROVE' | 'EXCELLENT';
type AchievedLevel = 'none' | 'minimum' | 'middle' | 'maximum';
type Severity = 'critical' | 'major' | 'minor';
type RiskLevel = 'low' | 'medium' | 'high';

interface ReviewIssue {
    severity: Severity;
    title: string;
    evidence: string;
    suggestion: string;
}

interface ReviewResult {
    decision: Decision;
    achievedLevel: AchievedLevel;
    summary: string;
    missing: {
        minimum: string[];
        middle: string[];
        maximum: string[];
    };
    issues: ReviewIssue[];
    risk: {
        security: RiskLevel;
        correctness: RiskLevel;
        maintainability: RiskLevel;
    };
}

interface ReviewHistoryItem {
    id: string;
    timestamp: number;
    snapshotId: string;
    result: ReviewResult;
}

interface Props {
    reviews: ReviewHistoryItem[];
    onClose: () => void;
    onRevert?: () => void;
    onFixJob?: (issues: ReviewIssue[]) => void;
}

const DecisionBadge = ({ decision }: { decision: Decision }) => {
    const styles: Record<Decision, string> = {
        BLOCK: 'bg-red-900/50 text-red-300 border-red-700',
        IMPROVE: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
        APPROVE: 'bg-green-900/50 text-green-300 border-green-700',
        EXCELLENT: 'bg-purple-900/50 text-purple-300 border-purple-700'
    };
    const icons: Record<Decision, ReactNode> = {
        BLOCK: <XCircle size={14} />,
        IMPROVE: <AlertTriangle size={14} />,
        APPROVE: <CheckCircle size={14} />,
        EXCELLENT: <Zap size={14} />
    };
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded border ${styles[decision]}`}>
            {icons[decision]} {decision}
        </span>
    );
};

const LevelBadge = ({ level }: { level: AchievedLevel }) => {
    const styles: Record<AchievedLevel, string> = {
        none: 'bg-gray-800 text-gray-400',
        minimum: 'bg-orange-900/50 text-orange-300',
        middle: 'bg-blue-900/50 text-blue-300',
        maximum: 'bg-purple-900/50 text-purple-300'
    };
    return (
        <span className={`px-2 py-0.5 text-[10px] font-mono rounded ${styles[level]}`}>
            {level.toUpperCase()}
        </span>
    );
};

const RiskIndicator = ({ label, level }: { label: string; level: RiskLevel }) => {
    const colors: Record<RiskLevel, string> = {
        low: 'bg-green-500',
        medium: 'bg-yellow-500',
        high: 'bg-red-500'
    };
    return (
        <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500 w-24">{label}</span>
            <div className="flex gap-1">
                {['low', 'medium', 'high'].map((l) => (
                    <div
                        key={l}
                        className={`w-3 h-3 rounded-sm ${level === l ? colors[level] : 'bg-gray-700'}`}
                        title={l}
                    />
                ))}
            </div>
            <span className="text-gray-400 text-[10px]">{level}</span>
        </div>
    );
};

const IssueCard = ({ issue }: { issue: ReviewIssue }) => {
    const [expanded, setExpanded] = useState(false);
    const severityColors: Record<Severity, string> = {
        critical: 'border-l-red-500 bg-red-950/30',
        major: 'border-l-yellow-500 bg-yellow-950/30',
        minor: 'border-l-blue-500 bg-blue-950/30'
    };

    return (
        <div className={`border-l-2 ${severityColors[issue.severity]} p-2 rounded-r`}>
            <div
                className="flex items-center gap-2 cursor-pointer"
                onClick={() => setExpanded(!expanded)}
            >
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span className={`text-[10px] uppercase font-bold ${
                    issue.severity === 'critical' ? 'text-red-400' :
                    issue.severity === 'major' ? 'text-yellow-400' : 'text-blue-400'
                }`}>{issue.severity}</span>
                <span className="text-sm text-gray-200">{issue.title}</span>
            </div>
            {expanded && (
                <div className="mt-2 pl-5 space-y-2 text-xs">
                    {issue.evidence && (
                        <div>
                            <span className="text-gray-500">Evidence:</span>
                            <pre className="mt-1 p-2 bg-black/30 rounded text-gray-400 whitespace-pre-wrap text-[11px]">
                                {issue.evidence}
                            </pre>
                        </div>
                    )}
                    {issue.suggestion && (
                        <div>
                            <span className="text-gray-500">Suggestion:</span>
                            <p className="mt-1 text-gray-300">{issue.suggestion}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const MissingSection = ({ title, items, color }: { title: string; items: string[]; color: string }) => {
    if (items.length === 0) return null;
    return (
        <div className="mb-2">
            <h5 className={`text-xs font-bold ${color} mb-1`}>{title} ({items.length})</h5>
            <ul className="list-disc list-inside text-xs text-gray-400 space-y-0.5">
                {items.map((item, i) => (
                    <li key={i}>{item}</li>
                ))}
            </ul>
        </div>
    );
};

export function ReviewPanel({ reviews, onClose, onRevert, onFixJob }: Props) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const currentReview = reviews[selectedIndex];

    if (reviews.length === 0) {
        return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-[#1e1e1e] border border-[#3e3e42] w-[600px] p-6 rounded-lg">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-lg font-bold text-white">Review History</h2>
                        <button onClick={onClose} className="text-gray-400 hover:text-white">
                            <X size={18} />
                        </button>
                    </div>
                    <p className="text-gray-500 text-center py-8">No reviews yet. Create a snapshot and run a review.</p>
                </div>
            </div>
        );
    }

    const result = currentReview.result;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-[#1e1e1e] border border-[#3e3e42] w-[800px] max-h-[80vh] flex flex-col rounded-lg overflow-hidden">
                {/* Header */}
                <div className="h-12 bg-[#252526] border-b border-[#3e3e42] flex items-center justify-between px-4 shrink-0">
                    <div className="flex items-center gap-3">
                        <Shield size={18} className="text-purple-400" />
                        <h2 className="font-bold text-white">Review Panel</h2>
                        <DecisionBadge decision={result.decision} />
                        <LevelBadge level={result.achievedLevel} />
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X size={18} />
                    </button>
                </div>

                {/* History tabs */}
                {reviews.length > 1 && (
                    <div className="flex gap-1 p-2 bg-[#252526] border-b border-[#3e3e42] overflow-x-auto shrink-0">
                        {reviews.map((review, i) => (
                            <button
                                key={review.id}
                                onClick={() => setSelectedIndex(i)}
                                className={`px-3 py-1 text-xs rounded whitespace-nowrap ${
                                    i === selectedIndex
                                        ? 'bg-[#3e3e42] text-white'
                                        : 'text-gray-500 hover:text-gray-300'
                                }`}
                            >
                                {new Date(review.timestamp).toLocaleTimeString()} - {review.result.decision}
                            </button>
                        ))}
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 overflow-auto p-4 space-y-4">
                    {/* Summary */}
                    <div className="bg-[#252526] p-3 rounded">
                        <p className="text-gray-300">{result.summary}</p>
                        <p className="text-[11px] text-gray-500 mt-1">
                            Snapshot: {currentReview.snapshotId} | {new Date(currentReview.timestamp).toLocaleString()}
                        </p>
                    </div>

                    {/* Risk Assessment */}
                    <div className="bg-[#252526] p-3 rounded">
                        <h4 className="text-xs font-bold text-gray-400 mb-2">Risk Assessment</h4>
                        <div className="grid grid-cols-3 gap-4">
                            <RiskIndicator label="Security" level={result.risk.security} />
                            <RiskIndicator label="Correctness" level={result.risk.correctness} />
                            <RiskIndicator label="Maintainability" level={result.risk.maintainability} />
                        </div>
                    </div>

                    {/* Missing Requirements */}
                    {(result.missing.minimum.length > 0 || result.missing.middle.length > 0 || result.missing.maximum.length > 0) && (
                        <div className="bg-[#252526] p-3 rounded">
                            <h4 className="text-xs font-bold text-gray-400 mb-2">Missing Requirements</h4>
                            <MissingSection title="MINIMUM" items={result.missing.minimum} color="text-red-400" />
                            <MissingSection title="MIDDLE" items={result.missing.middle} color="text-yellow-400" />
                            <MissingSection title="MAXIMUM" items={result.missing.maximum} color="text-blue-400" />
                        </div>
                    )}

                    {/* Issues */}
                    {result.issues.length > 0 && (
                        <div className="bg-[#252526] p-3 rounded">
                            <h4 className="text-xs font-bold text-gray-400 mb-2">
                                Issues ({result.issues.length})
                            </h4>
                            <div className="space-y-2">
                                {result.issues.map((issue, i) => (
                                    <IssueCard key={i} issue={issue} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Actions (only for BLOCK) */}
                {result.decision === 'BLOCK' && (
                    <div className="p-4 bg-[#252526] border-t border-[#3e3e42] flex gap-2 shrink-0">
                        <button
                            onClick={onRevert}
                            className="flex items-center gap-2 px-4 py-2 bg-red-900/50 hover:bg-red-900 text-red-200 text-sm rounded"
                        >
                            <RotateCcw size={14} /> Revert (git restore .)
                        </button>
                        <button
                            onClick={() => onFixJob?.(result.issues)}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-900/50 hover:bg-blue-900 text-blue-200 text-sm rounded"
                        >
                            <Wrench size={14} /> Create Fix Job
                        </button>
                    </div>
                )}

                {result.decision === 'IMPROVE' && (
                    <div className="p-4 bg-[#252526] border-t border-[#3e3e42] flex gap-2 shrink-0">
                        <button
                            onClick={() => onFixJob?.(result.issues)}
                            className="flex items-center gap-2 px-4 py-2 bg-yellow-900/50 hover:bg-yellow-900 text-yellow-200 text-sm rounded"
                        >
                            <Play size={14} /> Continue to Middle Level
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
