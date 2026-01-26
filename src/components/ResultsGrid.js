import React from 'react';

/**
 * ResultsGrid component displaying file-level metrics in a table
 * @param {Object} props
 * @param {Array} props.files - Array of file analysis results
 * @param {number} props.totalFiles - Total number of files
 */
function ResultsGrid({ files, totalFiles }) {
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

    const formatMissingLines = (lines) => {
        if (!lines || lines.length === 0) return '—';

        // Group consecutive lines into ranges
        const sorted = [...lines].sort((a, b) => a - b);
        const ranges = [];
        let start = sorted[0];
        let end = sorted[0];

        for (let i = 1; i <= sorted.length; i++) {
            if (sorted[i] === end + 1) {
                end = sorted[i];
            } else {
                if (start === end) {
                    ranges.push(String(start));
                } else {
                    ranges.push(`${start}-${end}`);
                }
                start = sorted[i];
                end = sorted[i];
            }
        }

        return ranges.join(', ');
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

    if (!files || files.length === 0) {
        return (
            <section className="results-section">
                <div className="results-header">
                    <h2 className="results-title">File Analysis</h2>
                    <span className="results-count">0 files</span>
                </div>
                <div className="results-container">
                    <div className="empty-state">
                        <div className="empty-state-icon">📄</div>
                        <h3 className="empty-state-title">No files found</h3>
                        <p className="empty-state-text">
                            No JavaScript files were found in the selected folder (excluding test files and ignored folders).
                        </p>
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section className="results-section fade-in">
            <div className="results-header">
                <h2 className="results-title">File Analysis</h2>
                <span className="results-count">{totalFiles} files</span>
            </div>

            <div className="results-container">
                <div className="results-table-wrapper">
                    <table className="results-table">
                        <thead>
                            <tr>
                                <th>File Name</th>
                                <th>Total Lines</th>
                                <th>Statements</th>
                                <th>Line Coverage</th>
                                <th>Stmt Coverage</th>
                                <th>Missing Lines</th>
                            </tr>
                        </thead>
                        <tbody>
                            {files.map((file, index) => (
                                <tr key={file.relativePath || index}>
                                    <td className="file-name" title={file.relativePath}>
                                        {file.relativePath}
                                    </td>
                                    <td className="number-cell">
                                        {formatNumber(file.totalLinesJest ?? file.lines)}
                                    </td>
                                    <td className="number-cell">
                                        {formatNumber(file.totalStatementsJest ?? file.statements)}
                                    </td>
                                    <td className={`coverage-cell ${getCoverageClass(file.lineCoverage)}`}>
                                        {file.lineCoverage !== null ? `${formatNumber(file.coveredLines)} / ${formatNumber(file.totalLinesJest)} (${formatPercentage(file.lineCoverage)})` : '—'}
                                        {renderCoverageBar(file.lineCoverage)}
                                    </td>
                                    <td className={`coverage-cell ${getCoverageClass(file.statementCoverage)}`}>
                                        {file.statementCoverage !== null ? `${formatNumber(file.coveredStatements)} / ${formatNumber(file.totalStatementsJest)} (${formatPercentage(file.statementCoverage)})` : '—'}
                                        {renderCoverageBar(file.statementCoverage)}
                                    </td>
                                    <td className="missing-lines" title={formatMissingLines(file.missingLines)}>
                                        {formatMissingLines(file.missingLines)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    );
}

export default ResultsGrid;
