const { resolveRemoteCoverageBranches } = require('../data/appsCatalog');

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
 * Saved git credentials from localStorage, or null.
 * @returns {{ username: string, token: string } | null}
 */
function getSavedGitCredentials() {
    try {
        const saved = localStorage.getItem('git_credentials');
        return saved ? JSON.parse(saved) : null;
    } catch { return null; }
}

/**
 * Fetch remote coverage for a catalog app.
 * @param {{ url: string }} app
 * @returns {Promise<{ lines: object, statements: object, branches: object, tests: object, branch: string, generatedAt: string } | null>}
 */
async function fetchAppCoverage(app) {
    const result = await window.electronAPI.fetchRemoteCoverage(
        app.url,
        getSavedGitCredentials(),
        resolveRemoteCoverageBranches(app)
    );
    if (!(result.success && result.data?.coverage)) return null;
    const cov = result.data.coverage;
    return {
        lines: cov.lines,
        statements: cov.statements,
        branches: cov.branches,
        branch: result.branch,
        generatedAt: result.data.generatedAt,
        tests: result.data.tests
    };
}

module.exports = { getSavedGitCredentials, fetchAppCoverage, sumLoadedTestCounts, toTestCount };
