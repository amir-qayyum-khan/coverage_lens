import React from 'react';
import { YOU_APPS, WE_APPS, repoFolderKeyFromUrl } from '../data/appsCatalog';

/**
 * @param {Object} props
 * @param {Record<string, { lines?: object, statements?: object, branches?: object }>} props.projectMetrics — keyed by clone folder name (repo basename)
 * @param {string[]} [props.knownClonePaths] — repo roots used to load cached Jest summaries
 * @param {() => void|Promise<void>} [props.onBrowseReposParent] — pick a folder whose subfolders are repo roots
 * @param {() => void|Promise<void>} [props.onAddRepoFolder] — add one repo root
 * @param {boolean} [props.busy]
 */
function SuperDashboard({
    projectMetrics = {},
    knownClonePaths = [],
    onBrowseReposParent,
    onAddRepoFolder,
    busy = false
}) {
    const formatNumber = (num) => {
        if (num === null || num === undefined) return '—';
        return num.toLocaleString();
    };

    const formatPercentage = (pct) => {
        if (pct === null || pct === undefined) return '—';
        return `${pct}%`;
    };

    const getCoverageClass = (pct) => {
        if (pct === null || pct === undefined) return '';
        if (pct >= 80) return 'coverage-high';
        if (pct >= 50) return 'coverage-medium';
        return 'coverage-low';
    };

    const renderCoverageBar = (pct) => {
        if (pct === null || pct === undefined) return null;
        let barClass = 'low';
        if (pct >= 80) barClass = 'high';
        else if (pct >= 50) barClass = 'medium';
        return (
            <div className="coverage-bar">
                <div
                    className={`coverage-bar-fill ${barClass}`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                />
            </div>
        );
    };

    const renderCoverageCell = (block) => {
        if (!block || block.total == null) {
            return <td className="coverage-cell">—</td>;
        }
        const pct = block.pct;
        const text =
            pct !== null && pct !== undefined
                ? `${formatNumber(block.covered)} / ${formatNumber(block.total)} (${formatPercentage(pct)})`
                : '—';
        return (
            <td className={`coverage-cell ${getCoverageClass(pct)}`}>
                {text}
                {renderCoverageBar(pct)}
            </td>
        );
    };

    const renderTable = (title, apps) => (
        <div className="app-section super-dashboard-section">
            <h3 className="section-title">{title}</h3>
            <div className="results-container">
                <div className="results-table-wrapper">
                    <table className="results-table">
                        <thead>
                            <tr>
                                <th>Project Name</th>
                                <th>Line Coverage</th>
                                <th>Stmt Coverage</th>
                                <th>Branch Coverage</th>
                            </tr>
                        </thead>
                        <tbody>
                            {apps.map((app) => {
                                const key = repoFolderKeyFromUrl(app.url);
                                const m = key ? projectMetrics[key] : null;
                                const lines = m?.lines;
                                const statements = m?.statements;
                                const branches = m?.branches;
                                return (
                                    <tr key={app.name}>
                                        <td className="file-name" title={key || app.url}>
                                            {app.name}
                                        </td>
                                        {renderCoverageCell(lines)}
                                        {renderCoverageCell(statements)}
                                        {renderCoverageCell(branches)}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );

    const pathCount = Array.isArray(knownClonePaths) ? knownClonePaths.length : 0;

    return (
        <div className="dashboard fade-in super-dashboard">
            <header className="dashboard-header" style={{ marginBottom: '1rem' }}>
                <div
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 'var(--spacing-md)'
                    }}
                >
                    <h2 className="section-title" style={{ marginBottom: 0 }}>
                        Super Dashboard
                    </h2>
                    <div className="super-dashboard-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {typeof onBrowseReposParent === 'function' && (
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => onBrowseReposParent()}
                                disabled={busy}
                                aria-busy={busy}
                                aria-label="Browse for folder containing all cloned repositories"
                            >
                                <span className="btn-icon">📂</span>
                                {busy ? 'Working…' : 'Set repos folder'}
                            </button>
                        )}
                        {typeof onAddRepoFolder === 'function' && (
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => onAddRepoFolder()}
                                disabled={busy}
                                aria-label="Add one repository folder"
                            >
                                <span className="btn-icon">📁</span>
                                Add repo folder
                            </button>
                        )}
                    </div>
                </div>
                <p
                    className="settings-desc"
                    style={{
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                        marginTop: 'var(--spacing-sm)',
                        maxWidth: '720px'
                    }}
                >
                    Rows are matched to cached coverage by repository folder name (same as the clone directory name).
                    Use <strong>Set repos folder</strong> to choose the directory that <em>contains</em> each cloned
                    repo as a subfolder; the app registers every subfolder and reads{' '}
                    <code>.code-analyzer/super-dashboard-jest.json</code> inside each one. Use{' '}
                    <strong>Add repo folder</strong> if a repo lives elsewhere. Coverage is saved when tests run from
                    Dashboard or Code Analysis.
                </p>
                {pathCount > 0 && (
                    <p
                        className="settings-desc"
                        style={{
                            fontSize: '11px',
                            color: 'var(--text-secondary)',
                            marginTop: '6px',
                            maxWidth: '720px'
                        }}
                    >
                        {pathCount} repo folder{pathCount === 1 ? '' : 's'} registered for cache lookup.
                    </p>
                )}
            </header>
            {renderTable('You Apps', YOU_APPS)}
            {renderTable('We Apps', WE_APPS)}
        </div>
    );
}

export default SuperDashboard;
