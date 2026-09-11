import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { YOU_APPS, WE_APPS, resolveRemoteCoverageBranches } from '../data/appsCatalog';

/**
 * Coerce a Jest summary field to a finite count (missing or invalid → 0).
 * @param {unknown} n
 * @returns {number}
 */
function toTestCount(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
}

/**
 * Sum passed/failed/total for catalog apps whose Super Dashboard row loaded.
 * Missing test fields count as 0. Incomplete-but-loaded rows are included.
 * @param {Array<{ name: string }>} apps
 * @param {Record<string, string>} rowStatus
 * @param {Record<string, { tests?: { passedTests?: number, failedTests?: number, totalTests?: number } }>} remoteMetrics
 * @returns {{ passedTests: number, failedTests: number, totalTests: number }}
 */
function sumLoadedTestCounts(apps, rowStatus, remoteMetrics) {
    let passedTests = 0;
    let failedTests = 0;
    let totalTests = 0;
    for (const app of apps) {
        if (rowStatus[app.name] !== 'loaded') continue;
        const tests = remoteMetrics[app.name]?.tests;
        passedTests += toTestCount(tests?.passedTests);
        failedTests += toTestCount(tests?.failedTests);
        totalTests += toTestCount(tests?.totalTests);
    }
    return { passedTests, failedTests, totalTests };
}

/**
 * Super Dashboard — fetches coverage JSON from Gitea remote in parallel.
 * Each row shows a skeleton loader until its data arrives.
 * Uses each app's catalog defaultBranch first (then developV2 / develop).
 */
function SuperDashboard({
    knownClonePaths = [],
    onBrowseReposParent,
    onAddRepoFolder,
    busy = false
}) {
    // rowStatus: 'loading' | 'loaded' | 'no-data' | 'error'
    const [rowStatus, setRowStatus] = useState({});
    const [remoteMetrics, setRemoteMetrics] = useState({});
    const [isFetching, setIsFetching] = useState(false);
    const [lastFetchAt, setLastFetchAt] = useState(null);
    const fetchIdRef = useRef(0);

    // Inline credentials panel
    const [showCredentials, setShowCredentials] = useState(false);
    const [credentials, setCredentials] = useState(() => {
        try {
            const saved = localStorage.getItem('git_credentials');
            return saved ? JSON.parse(saved) : { username: '', token: '' };
        } catch { return { username: '', token: '' }; }
    });
    const [credSaved, setCredSaved] = useState(false);

    const saveCredentials = () => {
        localStorage.setItem('git_credentials', JSON.stringify(credentials));
        setCredSaved(true);
        setTimeout(() => setCredSaved(false), 2000);
        setShowCredentials(false);
        // Auto-refresh with new credentials
        setTimeout(() => fetchAllCoverage(), 100);
    };

    const getCredentials = () => {
        try {
            const saved = localStorage.getItem('git_credentials');
            return saved ? JSON.parse(saved) : null;
        } catch { return null; }
    };

    const fetchAllCoverage = useCallback(async () => {
        const allApps = [...YOU_APPS, ...WE_APPS];
        const id = ++fetchIdRef.current;

        // Reset all rows to loading
        const initialStatus = {};
        allApps.forEach(app => { initialStatus[app.name] = 'loading'; });
        setRowStatus(initialStatus);
        setRemoteMetrics({});
        setIsFetching(true);

        const creds = getCredentials();

        await Promise.allSettled(
            allApps.map(async (app) => {
                try {
                    const result = await window.electronAPI.fetchRemoteCoverage(
                        app.url,
                        creds,
                        resolveRemoteCoverageBranches(app)
                    );
                    if (id !== fetchIdRef.current) return; // stale

                    if (result.success && result.data?.coverage) {
                        const cov = result.data.coverage;
                        setRemoteMetrics(prev => ({
                            ...prev,
                            [app.name]: {
                                lines: cov.lines,
                                statements: cov.statements,
                                branches: cov.branches,
                                branch: result.branch,
                                generatedAt: result.data.generatedAt,
                                tests: result.data.tests
                            }
                        }));
                        setRowStatus(prev => ({ ...prev, [app.name]: 'loaded' }));
                    } else {
                        setRowStatus(prev => ({ ...prev, [app.name]: 'no-data' }));
                    }
                } catch {
                    if (id !== fetchIdRef.current) return;
                    setRowStatus(prev => ({ ...prev, [app.name]: 'error' }));
                }
            })
        );

        if (id === fetchIdRef.current) {
            setIsFetching(false);
            setLastFetchAt(new Date().toLocaleTimeString());
        }
    }, []);

    useEffect(() => {
        fetchAllCoverage();
    }, [fetchAllCoverage]);

    const formatPct = (pct) => {
        if (pct == null) return '—';
        return `${Number(pct).toFixed(1)}%`;
    };

    const formatNum = (n) => {
        if (n == null) return '—';
        return Number(n).toLocaleString();
    };

    /**
     * Three-line passed / failed / total cell, or em dash when tests are absent.
     * @param {{ passedTests?: number, failedTests?: number, totalTests?: number }|null|undefined} tests
     * @returns {JSX.Element}
     */
    const renderTestCountsCell = (tests) => {
        if (!tests || typeof tests !== 'object') {
            return <td className="coverage-cell">—</td>;
        }
        const failed = toTestCount(tests.failedTests);
        return (
            <td className="coverage-cell">
                <div>{formatNum(tests.passedTests)} passed</div>
                <div className={failed > 0 ? 'text-error' : undefined}>{formatNum(tests.failedTests)} failed</div>
                <div>{formatNum(tests.totalTests)} total</div>
            </td>
        );
    };

    const getCoverageClass = (pct) => {
        if (pct == null) return '';
        if (pct >= 80) return 'coverage-high';
        if (pct >= 50) return 'coverage-medium';
        return 'coverage-low';
    };

    const renderCoverageBar = (pct) => {
        if (pct == null) return null;
        let barClass = 'low';
        if (pct >= 80) barClass = 'high';
        else if (pct >= 50) barClass = 'medium';
        return (
            <div className="coverage-bar">
                <div className={`coverage-bar-fill ${barClass}`} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
        );
    };

    const renderMetricCell = (block) => {
        if (!block || block.total == null) {
            return <td className="coverage-cell">—</td>;
        }
        const pct = block.pct;
        return (
            <td className={`coverage-cell ${getCoverageClass(pct)}`}>
                <div style={{ fontWeight: 600 }}>{formatPct(pct)}</div>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>{formatNum(block.covered)} / {formatNum(block.total)}</div>
                {renderCoverageBar(pct)}
            </td>
        );
    };

    const renderSkeletonCell = () => (
        <td className="coverage-cell">
            <div className="skeleton-pulse" style={{ height: '16px', width: '70%', borderRadius: '4px', marginBottom: '4px' }} />
            <div className="skeleton-pulse" style={{ height: '10px', width: '50%', borderRadius: '4px' }} />
        </td>
    );

    const renderBranchTag = (branch) => {
        if (!branch) return null;
        const cls = branch === 'developV2' ? 'branch-tag-v2' : 'branch-tag-dev';
        return <span className={`branch-tag ${cls}`}>{branch}</span>;
    };

    const renderRow = (app) => {
        const status = rowStatus[app.name] || 'loading';
        const m = remoteMetrics[app.name];

        if (status === 'loading') {
            return (
                <tr key={app.name} className="skeleton-row">
                    <td className="file-name">
                        <span>{app.name}</span>
                        <div className="skeleton-pulse" style={{ height: '10px', width: '60px', borderRadius: '3px', marginTop: '4px' }} />
                    </td>
                    {renderSkeletonCell()}
                    {renderSkeletonCell()}
                    {renderSkeletonCell()}
                    {renderSkeletonCell()}
                    <td><div className="skeleton-pulse" style={{ height: '20px', width: '80px', borderRadius: '10px' }} /></td>
                </tr>
            );
        }

        if (status === 'no-data' || status === 'error') {
            return (
                <tr key={app.name} className="no-data-row">
                    <td className="file-name">{app.name}</td>
                    <td className="coverage-cell" colSpan={4} style={{ color: 'var(--text-secondary)', fontSize: '12px', textAlign: 'center' }}>
                        {status === 'error' ? '⚠ Fetch error' : '— No coverage data found'}
                    </td>
                    <td />
                </tr>
            );
        }

        return (
            <tr key={app.name} className="fade-in">
                <td className="file-name">
                    <div>{app.name}</div>
                    {m?.generatedAt && (
                        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            {new Date(m.generatedAt).toLocaleDateString()}
                        </div>
                    )}
                </td>
                {renderMetricCell(m?.lines)}
                {renderMetricCell(m?.statements)}
                {renderMetricCell(m?.branches)}
                {renderTestCountsCell(m?.tests)}
                <td style={{ textAlign: 'center' }}>
                    {renderBranchTag(m?.branch)}
                    {m?.tests?.incompleteRun && (
                        <div
                            title="Jest exited before summary — coverage may be partial"
                            style={{
                                fontSize: '10px',
                                color: 'var(--warning, #b8860b)',
                                marginTop: '4px',
                                fontWeight: 600
                            }}
                        >
                            ⚠ Incomplete run
                        </div>
                    )}
                </td>
            </tr>
        );
    };

    const renderTable = (title, apps, footerLabel, sectionTotals) => (
        <div className="app-section super-dashboard-section">
            <h3 className="section-title">{title}</h3>
            <div className="results-container">
                <div className="results-table-wrapper">
                    <table className="results-table">
                        <thead>
                            <tr>
                                <th>Project</th>
                                <th>Line Coverage</th>
                                <th>Stmt Coverage</th>
                                <th>Branch Coverage</th>
                                <th>Unit Tests</th>
                                <th style={{ textAlign: 'center', width: 110 }}>Source Branch</th>
                            </tr>
                        </thead>
                        <tbody>
                            {apps.map(renderRow)}
                        </tbody>
                        <tfoot>
                            <tr className="super-dash-totals-row">
                                <td className="file-name"><strong>{footerLabel}</strong></td>
                                <td className="coverage-cell" />
                                <td className="coverage-cell" />
                                <td className="coverage-cell" />
                                {renderTestCountsCell(sectionTotals)}
                                <td />
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    );

    const hasNoToken = !getCredentials()?.token;
    const loadedCount = Object.values(rowStatus).filter(s => s === 'loaded').length;
    const totalCount = YOU_APPS.length + WE_APPS.length;
    const youTestTotals = useMemo(
        () => sumLoadedTestCounts(YOU_APPS, rowStatus, remoteMetrics),
        [rowStatus, remoteMetrics]
    );
    const weTestTotals = useMemo(
        () => sumLoadedTestCounts(WE_APPS, rowStatus, remoteMetrics),
        [rowStatus, remoteMetrics]
    );
    const grandTestTotals = useMemo(() => ({
        passedTests: youTestTotals.passedTests + weTestTotals.passedTests,
        failedTests: youTestTotals.failedTests + weTestTotals.failedTests,
        totalTests: youTestTotals.totalTests + weTestTotals.totalTests
    }), [youTestTotals, weTestTotals]);

    return (
        <div className="dashboard fade-in super-dashboard">
            <header className="dashboard-header" style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--spacing-md)' }}>
                    <div>
                        <h2 className="section-title" style={{ marginBottom: '4px' }}>Super Dashboard</h2>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            All apps: {formatNum(grandTestTotals.passedTests)} passed · {formatNum(grandTestTotals.failedTests)} failed · {formatNum(grandTestTotals.totalTests)} total
                        </div>
                        {lastFetchAt && (
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                Last refreshed: {lastFetchAt}
                                {isFetching && <span style={{ marginLeft: '8px' }}>· Loading {loadedCount}/{totalCount}…</span>}
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                        <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={fetchAllCoverage}
                            disabled={isFetching}
                        >
                            {isFetching ? (
                                <><span className="push-spinner">⟳</span> Fetching…</>
                            ) : '↺ Refresh'}
                        </button>
                    </div>
                </div>

                {/* Inline credentials panel */}
                {showCredentials && (
                    <div className="sd-cred-panel fade-in">
                        <div className="sd-cred-header">
                            <span className="sd-cred-title">🔑 Git Credentials</span>
                            <button className="close-btn" onClick={() => setShowCredentials(false)}>×</button>
                        </div>
                        <p className="sd-cred-desc">
                            Enter your Gitea username and Personal Access Token to fetch coverage from private repos.
                            Don't have a token?{' '}
                            <button
                                className="sd-link-btn"
                                onClick={() => window.electronAPI.openExternal('https://git.we-support.se/user/settings/applications')}
                            >
                                Create one in Gitea ↗
                            </button>
                        </p>
                        <div className="sd-cred-form">
                            <div className="sd-cred-field">
                                <label className="sd-cred-label">Username (optional)</label>
                                <input
                                    type="text"
                                    className="styled-input"
                                    value={credentials.username}
                                    onChange={e => setCredentials(c => ({ ...c, username: e.target.value }))}
                                    placeholder="your-username"
                                    autoComplete="username"
                                />
                            </div>
                            <div className="sd-cred-field">
                                <label className="sd-cred-label">Personal Access Token *</label>
                                <input
                                    type="password"
                                    className="styled-input"
                                    value={credentials.token}
                                    onChange={e => setCredentials(c => ({ ...c, token: e.target.value }))}
                                    placeholder="paste token here"
                                    autoComplete="current-password"
                                />
                            </div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={saveCredentials}
                                    disabled={!credentials.token.trim()}
                                >
                                    Save &amp; Refresh
                                </button>
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setShowCredentials(false)}
                                >
                                    Cancel
                                </button>
                                {credSaved && (
                                    <span style={{ fontSize: '12px', color: '#34d399' }}>✓ Saved!</span>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {hasNoToken && (
                    <div className="super-dash-notice">
                        ⚠ No Git token configured — remote coverage cannot be fetched from private repos.
                        Click <strong>⚙ Git Settings</strong> in the Environment Dashboard to enter your Gitea Personal Access Token.
                    </div>
                )}
                <p className="settings-desc" style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px', maxWidth: '720px' }}>
                    Coverage data is fetched from each app's catalog default branch
                    (usually <code>developV2</code>; YouTravelUI / YouDriveUI use <code>develop</code>),
                    then falls back to the other common branch.
                    Results stream in as each project responds.
                </p>
            </header>

            {renderTable('You Apps', YOU_APPS, 'You Apps total', youTestTotals)}
            {renderTable('We Apps', WE_APPS, 'We Apps total', weTestTotals)}
        </div>
    );
}

export default SuperDashboard;
