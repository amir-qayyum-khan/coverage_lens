import React from 'react';

/**
 * Summary component displaying aggregate statistics
 * @param {Object} props
 * @param {number} props.totalLines - Total lines of code
 * @param {number} props.totalLinesJest - Total lines of code as reported by Jest
 * @param {number} props.totalStatementsJest - Total statements as reported by Jest
 * @param {number|null} props.lineCoverage - Line coverage percentage
 * @param {number|null} props.statementCoverage - Statement coverage percentage
 */
function Summary({
    coveredLines,
    coveredStatements,
    totalLinesJest,
    totalStatementsJest,
    lineCoverage,
    statementCoverage,
    executionTime
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
        if (pct >= 80) return 'success';
        if (pct >= 50) return 'warning';
        return 'error';
    };

    return (
        <section className="summary-section fade-in">
            {executionTime && (
                <div className="execution-time-banner">
                    <span className="execution-time-icon">⏱️</span>
                    <span>Analysis completed in <strong>{executionTime}s</strong></span>
                </div>
            )}
            <div className="summary-grid">
                <div className="summary-card">
                    <div className="summary-value">{formatNumber(totalLinesJest)}</div>
                    <div className="summary-label">Total Testable Lines</div>
                </div>

                <div className={`summary-card ${getCoverageClass(lineCoverage)}`}>
                    <div className="summary-value">{formatNumber(coveredLines)}</div>
                    <div className="summary-label">Total Tested Lines ({formatPercentage(lineCoverage)})</div>
                </div>

                <div className="summary-card">
                    <div className="summary-value">{formatNumber(totalStatementsJest)}</div>
                    <div className="summary-label">Total Testable Statements</div>
                </div>

                <div className={`summary-card ${getCoverageClass(statementCoverage)}`}>
                    <div className="summary-value">{formatNumber(coveredStatements)}</div>
                    <div className="summary-label">Total Tested Statements ({formatPercentage(statementCoverage)})</div>
                </div>
            </div>
        </section>
    );
}

export default Summary;
