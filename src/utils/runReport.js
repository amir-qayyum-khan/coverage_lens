const { mergeAnalysisWithCoverage, lookupCoverageForAnalysis } = require('./coverageMerge');

const block = (b) => {
    if (!b) return { covered: 0, total: 0, pct: 0 };
    return { covered: Number(b.covered) || 0, total: Number(b.total) || 0, pct: Number(b.pct) || 0 };
};

/**
 * Build the compact payload reported to the main-process run store.
 * @param {object} coverageResults - cloneAndTest testResults
 * @param {object} analysisResults - analyzeFolder data
 * @returns {{ tests: object, coverage: object, files: object[] }}
 */
function buildRunPayload(coverageResults, analysisResults) {
    const cr = coverageResults || {};
    const summary = cr.summary || {};
    const rows = mergeAnalysisWithCoverage(analysisResults && analysisResults.files, cr.files);
    const files = rows.map((r) => {
        const cov = lookupCoverageForAnalysis(cr.files, r.relativePath);
        return {
            path: r.relativePath,
            lines: { covered: r.coveredLines || 0, total: r.totalLines || 0, pct: r.lineCoverage || 0 },
            statements: { covered: r.coveredStatements || 0, total: r.totalStatements || 0, pct: r.statementCoverage || 0 },
            functions: block(cov && cov.functions),
            branches: block(cov && cov.branches),
            hasCoverage: r.lineCoverage != null
        };
    });
    const groups = (cr.diagnostics && cr.diagnostics.failureSummary && cr.diagnostics.failureSummary.groups) || [];
    const failures = groups.map((g) => ({
        reason: String(g.reason || ''),
        count: Number(g.count) || 0,
        tests: Array.isArray(g.tests) ? g.tests.map(String) : []
    }));
    return {
        failures,
        tests: {
            total: cr.totalTests || 0,
            passed: cr.passedTests || 0,
            failed: cr.failedTests || 0,
            suites: cr.testSuites || 0,
            failedSuites: cr.failedSuites || 0
        },
        coverage: {
            lines: block(summary.lines),
            statements: block(summary.statements),
            functions: block(summary.functions),
            branches: block(summary.branches)
        },
        files
    };
}

module.exports = { buildRunPayload };
