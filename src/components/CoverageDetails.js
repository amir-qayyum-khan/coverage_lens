import React, { useState, useMemo, useEffect } from 'react';
import {
    mergeAnalysisWithCoverage,
    countUnmatchedAnalysisFiles
} from '../utils/coverageMerge';
import { resolveAnalysisFileAbsolute, TEST_SUFFIXES } from '../utils/coverageTestDiscovery';

function CoverageDetails({ coverageResults, analysisResults, folderPath, executionTime, branch }) {
    const [sortKey, setSortKey] = useState('lineCoverage');
    const [sortDir, setSortDir] = useState('desc');
    const [showConfirm, setShowConfirm] = useState(false);
    const [filterText, setFilterText] = useState('');
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

    const baseFiles = useMemo(
        () => mergeAnalysisWithCoverage(analysisResults?.files, coverageResults?.files),
        [analysisResults, coverageResults]
    );

    const [colocatedHints, setColocatedHints] = useState({});

    useEffect(() => {
        if (!folderPath || !baseFiles.length) {
            setColocatedHints({});
            return undefined;
        }

        const fileExists = window.electronAPI?.fileExists;
        if (!fileExists) {
            setColocatedHints({});
            return undefined;
        }

        let cancelled = false;

        (async () => {
            const next = {};
            for (const f of baseFiles) {
                if (cancelled) break;
                const absPath = resolveAnalysisFileAbsolute(folderPath, f.relativePath);
                if (!absPath) continue;

                const candidates = [];
                const segments = absPath.split(/[/\\]/).filter(Boolean);
                const fileName = segments[segments.length - 1];
                const dirParts = segments.slice(0, -1);
                const dot = fileName.lastIndexOf('.');
                const base = dot > 0 ? fileName.slice(0, dot) : fileName;
                const sep = absPath.includes('\\') ? '\\' : '/';

                for (const suffix of TEST_SUFFIXES) {
                    candidates.push(
                        [...dirParts, '__tests__', base + suffix].join(sep),
                        [...dirParts, base + suffix].join(sep)
                    );
                }

                for (const candidate of candidates) {
                    // eslint-disable-next-line no-await-in-loop
                    if (await fileExists(candidate)) {
                        next[f.relativePath] = true;
                        break;
                    }
                }
            }
            if (!cancelled) setColocatedHints(next);
        })();

        return () => {
            cancelled = true;
        };
    }, [baseFiles, folderPath]);

    const files = useMemo(() => {
        return baseFiles.map((f) => {
            const hasColocatedTest = colocatedHints[f.relativePath] === true;
            const zeroCoverageWithTest =
                hasColocatedTest &&
                f.lineCoverage != null &&
                Number(f.lineCoverage) === 0;

            return {
                ...f,
                hasColocatedTest,
                zeroCoverageWithTest
            };
        });
    }, [baseFiles, colocatedHints]);

    const totalTests = coverageResults?.totalTests ?? 0;
    const passedTests = coverageResults?.passedTests ?? 0;
    const failedTests = coverageResults?.failedTests ?? 0;
    const incompleteRun =
        coverageResults?.incompleteRun === true ||
        coverageResults?.diagnostics?.incompleteRun === true;
    const passedSuites = coverageResults?.passedSuites ?? coverageResults?.diagnostics?.passedSuites ?? 0;
    const failedSuites = coverageResults?.failedSuites ?? coverageResults?.diagnostics?.failedSuites ?? 0;
    const testSuites = coverageResults?.testSuites ?? coverageResults?.diagnostics?.testSuites ?? 0;
    const failedTestFiles =
        coverageResults?.failedTestFiles ||
        coverageResults?.diagnostics?.failedTestFiles ||
        [];
    const coverageFailedCount =
        coverageResults?.coverageFailedCount ??
        coverageResults?.diagnostics?.coverageFailedCount ??
        failedTestFiles.filter((f) => f.reason === 'no-coverage').length;
    const siblingBranches =
        coverageResults?.diagnostics?.siblingBranches ||
        coverageResults?.junctionSetup?.siblingBranches ||
        [];
    const zeroCoverageWithTestCount = useMemo(
        () => files.filter((f) => f.zeroCoverageWithTest).length,
        [files]
    );

    const unmatchedCount = useMemo(
        () => countUnmatchedAnalysisFiles(analysisResults?.files, coverageResults?.files),
        [analysisResults, coverageResults]
    );

    // Keep top-level totals aligned with Jest's own summary output.
    const displaySummary = coverageResults?.summary || {};

    const lineCoverage = displaySummary.lines?.pct ?? null;
    const statementCoverage = displaySummary.statements?.pct ?? null;
    const coveredLines = displaySummary.lines?.covered ?? null;
    const totalLines = displaySummary.lines?.total ?? null;
    const coveredStatements = displaySummary.statements?.covered ?? null;
    const totalStatements = displaySummary.statements?.total ?? null;

    const filteredFiles = useMemo(() => {
        if (!filterText) return files;
        const lowFilter = filterText.toLowerCase();
        return files.filter(f => f.relativePath.toLowerCase().includes(lowFilter));
    }, [files, filterText]);

    const sorted = useMemo(() => {
        return [...filteredFiles].sort((a, b) => {
            const va = a[sortKey] ?? (sortDir === 'asc' ? Infinity : -Infinity);
            const vb = b[sortKey] ?? (sortDir === 'asc' ? Infinity : -Infinity);
            if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            return sortDir === 'asc' ? va - vb : vb - va;
        });
    }, [filteredFiles, sortKey, sortDir]);

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

    const hasCoverage = coverageResults?.hasCoverage === true;
    const showTestsFailedPage =
        !hasCoverage &&
        (coverageResults?.error ||
            coverageResults?.spawnError ||
            (coverageResults?.success === false && !coverageResults?.message?.includes('Coverage from')));

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
                    <div className="coverage-no-data-icon">{showTestsFailedPage ? '⚠️' : '📊'}</div>
                    <h3>{showTestsFailedPage ? 'Tests Failed' : 'No Coverage Data'}</h3>
                    <p>{coverageResults?.message || coverageResults?.error
                        || 'Coverage could not be collected for this project. Make sure Jest is configured correctly.'
                    }</p>
                </div>
            ) : (
                <>
                    {(totalTests > 0 || failedTests > 0) && (
                        <div
                            className={`push-status-banner fade-in ${failedTests > 0 ? 'push-status-error' : 'push-status-pushed'}`}
                            style={{ marginBottom: '16px' }}
                        >
                            <strong>Jest:</strong>{' '}
                            {passedTests}/{totalTests} tests passed
                            {failedTests > 0 && <span> · {failedTests} failed</span>}
                            {coverageResults?.diagnostics?.batchCount > 1 && (
                                <span> · {coverageResults.diagnostics.batchCount} coverage batches</span>
                            )}
                            {coverageResults?.diagnostics?.testPathPatterns?.length > 0 && (
                                <span style={{ display: 'block', marginTop: '6px', fontSize: '12px', opacity: 0.9 }}>
                                    testPathPattern:{' '}
                                    {coverageResults.diagnostics.testPathPatterns
                                        .map((entry) => entry.pattern)
                                        .join(', ')}
                                </span>
                            )}
                            {coverageResults?.diagnostics?.jestCommandPreview && (
                                <span
                                    style={{ display: 'block', marginTop: '4px', fontSize: '11px', opacity: 0.75 }}
                                    title={coverageResults.diagnostics.jestCommandPreview}
                                >
                                    {coverageResults.diagnostics.jestCommandPreview}
                                </span>
                            )}
                            {coverageResults?.diagnostics?.coverageExecutionMode && (
                                <span style={{ display: 'block', marginTop: '6px', fontSize: '12px', opacity: 0.9 }}>
                                    Collected via {coverageResults.diagnostics.coverageExecutionMode}
                                    {coverageResults.diagnostics.phasesUsed?.length > 0 && (
                                        <span> ({coverageResults.diagnostics.phasesUsed.join(' → ')})</span>
                                    )}
                                    {coverageResults.diagnostics.failedBatches?.length > 0 && (
                                        <span> · {coverageResults.diagnostics.failedBatches.length} batch(es) needed per-file fallback</span>
                                    )}
                                </span>
                            )}
                            {coverageResults?.diagnostics?.jestMessage && (
                                <span style={{ display: 'block', marginTop: '6px', fontSize: '12px', opacity: 0.9 }}>
                                    {coverageResults.diagnostics.jestMessage}
                                </span>
                            )}
                            {failedTests > 0 && coverageResults?.diagnostics?.failureSummary?.groups?.length > 0 && (
                                <ul
                                    style={{
                                        margin: '8px 0 0',
                                        paddingLeft: '18px',
                                        fontSize: '12px',
                                        opacity: 0.9,
                                        listStyle: 'disc'
                                    }}
                                >
                                    {coverageResults.diagnostics.failureSummary.groups.slice(0, 5).map((group) => (
                                        <li key={group.reason} title={group.reason}>
                                            <strong>{group.count}×</strong> {group.reason}
                                        </li>
                                    ))}
                                    {coverageResults.diagnostics.failureSummary.uniqueReasonCount > 5 && (
                                        <li style={{ listStyle: 'none', marginLeft: '-18px' }}>
                                            +{coverageResults.diagnostics.failureSummary.uniqueReasonCount - 5} more unique error(s)
                                        </li>
                                    )}
                                </ul>
                            )}
                        </div>
                    )}

                    {siblingBranches.length > 0 && (
                        <div
                            className="push-status-banner push-status-error fade-in"
                            style={{ marginBottom: '16px' }}
                        >
                            <strong>Sibling repo branches</strong>
                            <ul style={{ margin: '8px 0 0 18px', padding: 0 }}>
                                {siblingBranches.map((s) => (
                                    <li key={s.repoName || s.linkName}>
                                        <code>{s.repoName}</code>
                                        {s.actualBranch ? (
                                            <span>
                                                {' '}
                                                → {s.actualBranch}
                                                {s.commit ? ` (${s.commit})` : ''}
                                                {s.expectedBranch && s.expectedBranch !== s.actualBranch
                                                    ? ` — expected ${s.expectedBranch}`
                                                    : ''}
                                            </span>
                                        ) : (
                                            <span> — not aligned</span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                            {(coverageResults?.diagnostics?.junctionWarnings || coverageResults?.junctionSetup?.warnings || [])
                                .length > 0 && (
                                <p style={{ marginTop: '8px', marginBottom: 0 }}>
                                    {(coverageResults.diagnostics?.junctionWarnings ||
                                        coverageResults.junctionSetup?.warnings ||
                                        [])[0]}
                                </p>
                            )}
                        </div>
                    )}

                    {hasCoverage && (failedTestFiles.length > 0 || coverageFailedCount > 0) && (
                        <div
                            className="push-status-banner push-status-error fade-in"
                            style={{ marginBottom: '16px' }}
                        >
                            <strong>Partial coverage</strong>
                            {coverageResults?.diagnostics?.jestMessage || coverageResults?.message ? (
                                <span> — {coverageResults.diagnostics?.jestMessage || coverageResults.message}</span>
                            ) : null}
                            {failedTestFiles.length > 0 && (
                                <ul
                                    style={{
                                        margin: '8px 0 0',
                                        paddingLeft: '18px',
                                        fontSize: '12px',
                                        opacity: 0.9,
                                        listStyle: 'disc'
                                    }}
                                >
                                    {failedTestFiles.slice(0, 8).map((entry) => (
                                        <li key={entry.path}>
                                            <code>{entry.path}</code>
                                            {entry.reason === 'no-coverage' ? ' — no coverage written' : ' — tests failed'}
                                        </li>
                                    ))}
                                    {failedTestFiles.length > 8 && (
                                        <li style={{ listStyle: 'none', marginLeft: '-18px' }}>
                                            +{failedTestFiles.length - 8} more failed test file(s)
                                        </li>
                                    )}
                                </ul>
                            )}
                        </div>
                    )}

                    {hasCoverage && incompleteRun && failedTestFiles.length === 0 && (
                        <div
                            className="push-status-banner push-status-error fade-in"
                            style={{ marginBottom: '16px' }}
                        >
                            <strong>Jest exited before summary</strong> (crash or OOM). Coverage is partial.
                            {testSuites > 0 && (
                                <span>
                                    {' '}
                                    Observed {passedSuites} passed and {failedSuites} failed test suite(s) before exit.
                                </span>
                            )}
                        </div>
                    )}

                    {hasCoverage && totalTests === 0 && !incompleteRun && (
                        <div
                            className="push-status-banner push-status-error fade-in"
                            style={{ marginBottom: '16px' }}
                        >
                            <strong>No tests executed.</strong> Coverage may reflect instrumented files only (0% does not
                            always mean a test file is missing).
                        </div>
                    )}

                    {zeroCoverageWithTestCount > 0 && (
                        <div
                            className="push-status-banner push-status-error fade-in"
                            style={{ marginBottom: '16px' }}
                        >
                            <strong>{zeroCoverageWithTestCount}</strong> file
                            {zeroCoverageWithTestCount === 1 ? '' : 's'} have a colocated test but 0% coverage — the suite
                            may not have run, or the module was mocked.
                        </div>
                    )}

                    {unmatchedCount > 0 && (
                        <div
                            className="push-status-banner push-status-error fade-in"
                            style={{ marginBottom: '16px' }}
                        >
                            <strong>{unmatchedCount}</strong> analyzed file
                            {unmatchedCount === 1 ? '' : 's'} had no matching Jest coverage row
                            (shown as &quot;No coverage data&quot;). Total coverage cards below use strict Jest summary values.
                            {coverageResults?.diagnostics?.batchCount > 1 && (
                                <span> Ran {coverageResults.diagnostics.batchCount} coverage batches.</span>
                            )}
                        </div>
                    )}

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

                    {/* File-Level Coverage Table Header with Filter */}
                    <div className="cd-section-header">
                        <div className="cd-section-title" style={{ marginBottom: 0 }}>
                            File Coverage <span className="cd-file-count">({sorted.length} files)</span>
                        </div>
                        
                        <div className="cd-filter-container">
                            <div className="cd-filter-icon">🔍</div>
                            <input
                                type="text"
                                className="cd-filter-input"
                                placeholder="Filter files (e.g. booking)..."
                                value={filterText}
                                onChange={(e) => setFilterText(e.target.value)}
                            />
                            {filterText && (
                                <button className="cd-filter-clear" onClick={() => setFilterText('')} title="Clear filter">
                                    &times;
                                </button>
                            )}
                        </div>
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
                                                    {file.zeroCoverageWithTest && (
                                                        <div
                                                            className="cd-no-coverage"
                                                            style={{ color: 'var(--warning)', fontSize: '11px', marginTop: '4px' }}
                                                            title="Colocated test exists but module was not executed"
                                                        >
                                                            Test exists — 0% (not executed or mocked)
                                                        </div>
                                                    )}
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
                                                    {file.missingLines === null ? (
                                                        <span className="cd-no-coverage" style={{ color: 'var(--text-muted)', fontSize: '11px', fontStyle: 'italic' }}>
                                                            No coverage data
                                                        </span>
                                                    ) : file.missingLines.length > 0 ? (
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
