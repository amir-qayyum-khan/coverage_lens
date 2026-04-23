import React, { useState, useMemo } from 'react';

function CoverageDetails({ coverageResults, analysisResults, folderPath, executionTime, branch }) {
    const [sortKey, setSortKey] = useState('lineCoverage');
    const [sortDir, setSortDir] = useState('desc');
    const [showConfirm, setShowConfirm] = useState(false);
    const [pushStatus, setPushStatus] = useState({ state: 'idle', msg: '' }); // 'idle' | 'pushing' | 'pushed' | 'error'

    // Get credentials from localStorage
    const getGitCredentials = () => {
        try {
            const saved = localStorage.getItem('git_credentials');
            return saved ? JSON.parse(saved) : { username: '', token: '' };
        } catch {
            return { username: '', token: '' };
        }
    };

    // Project name = last segment of folder path
    const projectName = useMemo(() => {
        if (!folderPath) return 'Unknown Project';
        return folderPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || folderPath;
    }, [folderPath]);

    const formatPct = (pct) => {
        if (pct === null || pct === undefined) return '—';
        return `${Number(pct).toFixed(1)}%`;
    };

    const formatNum = (n) => {
        if (n === null || n === undefined) return '—';
        return Number(n).toLocaleString();
    };

    const getCoverageClass = (pct) => {
        if (pct === null || pct === undefined) return '';
        if (pct >= 80) return 'success';
        if (pct >= 50) return 'warning';
        return 'error';
    };

    const getCoverageBadge = (pct) => {
        if (pct === null || pct === undefined) return { label: 'N/A', cls: 'badge-na' };
        if (pct >= 80) return { label: 'High', cls: 'badge-high' };
        if (pct >= 50) return { label: 'Medium', cls: 'badge-medium' };
        return { label: 'Low', cls: 'badge-low' };
    };

    // Summary from coverage
    const summary = coverageResults?.summary || {};
    const lineCoverage = summary.lines?.pct ?? null;
    const statementCoverage = summary.statements?.pct ?? null;
    const coveredLines = summary.lines?.covered ?? null;
    const totalLines = summary.lines?.total ?? null;
    const coveredStatements = summary.statements?.covered ?? null;
    const totalStatements = summary.statements?.total ?? null;

    // Build merged file list from analysisResults + coverageResults
    const files = useMemo(() => {
        if (!analysisResults?.files) return [];
        const coverageMap = new Map();
        if (coverageResults?.files) {
            coverageResults.files.forEach(f => coverageMap.set(f.relativePath, f));
        }
        return analysisResults.files.map(f => {
            const cov = coverageMap.get(f.relativePath) || {};
            return {
                relativePath: f.relativePath,
                lineCoverage: cov.lines?.pct ?? null,
                coveredLines: cov.lines?.covered ?? null,
                totalLines: cov.lines?.total ?? null,
                statementCoverage: cov.statements?.pct ?? null,
                coveredStatements: cov.statements?.covered ?? null,
                totalStatements: cov.statements?.total ?? null,
                missingLines: cov.missingLines || [],
            };
        });
    }, [analysisResults, coverageResults]);

    const sorted = useMemo(() => {
        return [...files].sort((a, b) => {
            const va = a[sortKey] ?? (sortDir === 'asc' ? Infinity : -Infinity);
            const vb = b[sortKey] ?? (sortDir === 'asc' ? Infinity : -Infinity);
            if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            return sortDir === 'asc' ? va - vb : vb - va;
        });
    }, [files, sortKey, sortDir]);

    const handleSort = (key) => {
        if (sortKey === key) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir('asc');
        }
    };

    const SortIcon = ({ col }) => {
        if (sortKey !== col) return <span className="sort-icon sort-icon-inactive">↕</span>;
        return <span className="sort-icon">{sortDir === 'asc' ? '↑' : '↓'}</span>;
    };

    const hasCoverage = coverageResults?.hasCoverage !== false && coverageResults != null;

    const handlePush = async () => {
        setShowConfirm(false);
        const creds = getGitCredentials();
        
        if (!creds.token) {
            setPushStatus({ state: 'error', msg: 'No Git token configured. Set it in Dashboard settings.' });
            return;
        }

        if (!branch) {
            setPushStatus({ state: 'error', msg: 'No branch information available for this project.' });
            return;
        }

        setPushStatus({ state: 'pushing', msg: 'Pushing coverage report to Git...' });
        
        try {
            const result = await window.electronAPI.pushCoverageReport(folderPath, branch, creds);
            if (result.success) {
                setPushStatus({ state: 'pushed', msg: 'Coverage report successfully saved to Git.' });
            } else {
                setPushStatus({ state: 'error', msg: result.message || 'Push failed.' });
            }
        } catch (err) {
            setPushStatus({ state: 'error', msg: err.message || 'An unexpected error occurred.' });
        }
    };

    return (
        <div className="coverage-details fade-in">
            {/* Project Info Header */}
            <div className="project-info-card">
                <div className="project-info-icon">📁</div>
                <div className="project-info-text">
                    <div className="project-info-name">{projectName}</div>
                    <div className="project-info-path">{folderPath || '—'}</div>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    {branch && (
                        <div className="branch-tag branch-tag-dev">
                            branch: {branch}
                        </div>
                    )}
                    
                    {executionTime && (
                        <div className="project-info-time">
                            <span className="project-info-time-icon">⏱️</span>
                            <span>
                                {(() => {
                                    const totalSeconds = parseFloat(executionTime);
                                    const minutes = Math.floor(totalSeconds / 60);
                                    const seconds = Math.floor(totalSeconds % 60);
                                    return minutes > 0
                                        ? `${minutes}:${seconds.toString().padStart(2, '0')} min`
                                        : `${totalSeconds}s`;
                                })()}
                            </span>
                        </div>
                    )}

                    <button 
                        className="btn btn-primary" 
                        onClick={() => setShowConfirm(true)}
                        disabled={!hasCoverage || pushStatus.state === 'pushing'}
                        style={{ height: 'fit-content', padding: '8px 16px' }}
                    >
                        Save to Git
                    </button>
                </div>
            </div>

            {/* Push Status Banner */}
            {pushStatus.state !== 'idle' && (
                <div className={`push-status-banner push-status-${pushStatus.state} fade-in`} style={{ marginBottom: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            {pushStatus.state === 'pushing' && <span className="push-spinner">⟳</span>}
                            {pushStatus.state === 'pushed' && '✓'}
                            {pushStatus.state === 'error' && '✗'}
                            <span>{pushStatus.msg}</span>
                        </div>
                        <button 
                            className="close-btn" 
                            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '18px' }}
                            onClick={() => setPushStatus({ state: 'idle', msg: '' })}
                        >
                            &times;
                        </button>
                    </div>
                </div>
            )}

            {/* Confirmation Popup Modal */}
            {showConfirm && (
                <div className="modal-overlay fade-in">
                    <div className="modal-content">
                        <div className="modal-header">
                            <h3>Confirm Save</h3>
                            <button className="close-btn" onClick={() => setShowConfirm(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <p>We are going to save this coverage report on Git for the <strong>{branch}</strong> branch.</p>
                            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '10px' }}>
                                This will commit and push only the coverage summary JSON file.
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowConfirm(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handlePush}>Confirm Save</button>
                        </div>
                    </div>
                </div>
            )}

            {!hasCoverage ? (
                <div className="coverage-no-data">
                    <div className="coverage-no-data-icon">{coverageResults?.error ? '⚠️' : '📊'}</div>
                    <h3>{coverageResults?.error ? 'Install Failed' : 'No Coverage Data'}</h3>
                    <p>{coverageResults?.error
                        || 'Coverage could not be collected for this project. Make sure Jest is configured correctly.'
                    }</p>
                </div>
            ) : (
                <>
                    {/* Total Coverage Summary */}
                    <div className="cd-section-title">Total Coverage</div>
                    <div className="summary-grid" style={{ marginBottom: 'var(--spacing-xl)' }}>
                        <div className="summary-card">
                            <div className="summary-value">{formatNum(totalLines)}</div>
                            <div className="summary-label">Total Testable Lines</div>
                        </div>
                        <div className={`summary-card ${getCoverageClass(lineCoverage)}`}>
                            <div className="summary-value">{formatNum(coveredLines)}</div>
                            <div className="summary-label">Covered Lines · {formatPct(lineCoverage)}</div>
                        </div>
                        <div className="summary-card">
                            <div className="summary-value">{formatNum(totalStatements)}</div>
                            <div className="summary-label">Total Testable Statements</div>
                        </div>
                        <div className={`summary-card ${getCoverageClass(statementCoverage)}`}>
                            <div className="summary-value">{formatNum(coveredStatements)}</div>
                            <div className="summary-label">Covered Statements · {formatPct(statementCoverage)}</div>
                        </div>
                    </div>

                    {/* Overall coverage bar */}
                    <div className="cd-overall-bar-wrap">
                        <div className="cd-overall-bar-labels">
                            <span>Line Coverage</span>
                            <span className={`cd-pct-label ${getCoverageClass(lineCoverage)}-text`}>{formatPct(lineCoverage)}</span>
                        </div>
                        <div className="cd-overall-bar">
                            <div
                                className={`cd-overall-bar-fill ${getCoverageClass(lineCoverage)}`}
                                style={{ width: `${Math.min(lineCoverage ?? 0, 100)}%` }}
                            />
                        </div>
                    </div>

                    {/* File-Level Coverage Table */}
                    <div className="cd-section-title" style={{ marginTop: 'var(--spacing-xl)' }}>
                        File Coverage <span className="cd-file-count">({sorted.length} files)</span>
                    </div>

                    <div className="results-container">
                        <div className="results-table-wrapper">
                            <table className="results-table">
                                <thead>
                                    <tr>
                                        <th onClick={() => handleSort('relativePath')} className="sortable-th">
                                            File <SortIcon col="relativePath" />
                                        </th>
                                        <th onClick={() => handleSort('lineCoverage')} className="sortable-th" style={{ textAlign: 'right' }}>
                                            Line Coverage <SortIcon col="lineCoverage" />
                                        </th>
                                        <th onClick={() => handleSort('statementCoverage')} className="sortable-th" style={{ textAlign: 'right' }}>
                                            Stmt Coverage <SortIcon col="statementCoverage" />
                                        </th>
                                        <th style={{ width: 100 }}>Bar</th>
                                        <th>Missing Lines</th>
                                        <th onClick={() => handleSort('lineCoverage')} className="sortable-th" style={{ textAlign: 'center' }}>
                                            Status
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sorted.map((file, idx) => {
                                        const badge = getCoverageBadge(file.lineCoverage);
                                        const pct = file.lineCoverage ?? 0;
                                        const barClass = getCoverageClass(file.lineCoverage) || 'low';
                                        return (
                                            <tr key={idx}>
                                                <td>
                                                    <span className="file-name">{file.relativePath}</span>
                                                </td>
                                                <td className="coverage-cell" style={{ textAlign: 'right' }}>
                                                    <span className={`coverage-${getCoverageClass(file.lineCoverage) || 'low'}`}>
                                                        {formatPct(file.lineCoverage)}
                                                    </span>
                                                    <br />
                                                    <span className="cd-sub-stat">{formatNum(file.coveredLines)}/{formatNum(file.totalLines)}</span>
                                                </td>
                                                <td className="coverage-cell" style={{ textAlign: 'right' }}>
                                                    <span className={`coverage-${getCoverageClass(file.statementCoverage) || 'low'}`}>
                                                        {formatPct(file.statementCoverage)}
                                                    </span>
                                                    <br />
                                                    <span className="cd-sub-stat">{formatNum(file.coveredStatements)}/{formatNum(file.totalStatements)}</span>
                                                </td>
                                                <td>
                                                    <div className="cd-file-bar">
                                                        <div
                                                            className={`cd-file-bar-fill ${barClass}`}
                                                            style={{ width: `${Math.min(pct, 100)}%` }}
                                                        />
                                                    </div>
                                                </td>
                                                <td>
                                                    {file.missingLines && file.missingLines.length > 0 ? (
                                                        <span className="missing-lines" title={file.missingLines.join(', ')}>
                                                            {file.missingLines.slice(0, 8).join(', ')}
                                                            {file.missingLines.length > 8 ? ` +${file.missingLines.length - 8} more` : ''}
                                                        </span>
                                                    ) : (
                                                        <span className="cd-all-covered">✓ All covered</span>
                                                    )}
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <span className={`coverage-badge ${badge.cls}`}>{badge.label}</span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

export default CoverageDetails;
