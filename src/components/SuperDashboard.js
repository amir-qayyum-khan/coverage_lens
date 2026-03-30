import React from 'react';
import { YOU_APPS, WE_APPS, repoFolderKeyFromUrl } from '../data/appsCatalog';

/**
 * @param {Object} props
 * @param {Record<string, { lines?: object, statements?: object, branches?: object }>} props.projectMetrics — keyed by clone folder name (repo basename)
 */
function SuperDashboard({ projectMetrics = {} }) {
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

    return (
        <div className="dashboard fade-in super-dashboard">
            <header className="dashboard-header" style={{ marginBottom: '1rem' }}>
                <h2 className="section-title" style={{ marginBottom: 0 }}>
                    Super Dashboard
                </h2>
                <p
                    className="settings-desc"
                    style={{
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                        marginTop: 'var(--spacing-sm)',
                        maxWidth: '720px'
                    }}
                >
                    Coverage columns match Code Analysis file grid (line, statement, and branch totals from Jest).
                    Rows fill after you analyze a folder whose name matches the cloned repository folder (e.g. TrapezeDRTCoreUI).
                </p>
            </header>
            {renderTable('You Apps', YOU_APPS)}
            {renderTable('We Apps', WE_APPS)}
        </div>
    );
}

export default SuperDashboard;
