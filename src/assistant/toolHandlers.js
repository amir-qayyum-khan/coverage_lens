const { repoFolderKeyFromUrl } = require('../data/appsCatalog');

const METRICS = ['lines', 'statements', 'branches'];
const MAX_FAILED_FILES = 20;
const MAX_LOWEST_FILES = 10;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round1 = (v) => Math.round(num(v) * 10) / 10;
const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';

/**
 * Compact summary of a runCoverage result for the assistant.
 * @param {string} app
 * @param {string} folder
 * @param {object} data runCoverage `data` payload
 * @returns {object}
 */
function summarizeCoverageRun(app, folder, data) {
    const d = data || {};
    const block = (m) => {
        const b = d.summary?.[m];
        return { covered: num(b?.covered), total: num(b?.total), pct: num(b?.pct) };
    };
    const lowestCoverageFiles = (d.files || [])
        .filter((f) => f && f.lines && Number.isFinite(Number(f.lines.pct)))
        .map((f) => ({ file: f.relativePath, linesPct: Number(f.lines.pct) }))
        .sort((a, b) => a.linesPct - b.linesPct)
        .slice(0, MAX_LOWEST_FILES);
    return {
        app,
        folder,
        tests: { total: num(d.totalTests), passed: num(d.passedTests), failed: num(d.failedTests) },
        coverage: { lines: block('lines'), statements: block('statements'), branches: block('branches') },
        failedTestFiles: (d.diagnostics?.failedTestFiles || []).slice(0, MAX_FAILED_FILES),
        lowestCoverageFiles,
        message: d.message || ''
    };
}

/**
 * @param {object} deps
 * @returns {{ run_unit_tests: Function, get_coverage: Function, get_test_totals: Function }}
 */
function createToolHandlers({ electronAPI, youApps, weApps, knownClonePaths, fetchAppCoverage, sumLoadedTestCounts }) {
    const allApps = [...youApps, ...weApps];
    const findApp = (name) => {
        const app = allApps.find((a) => a.name === name);
        if (!app) throw new Error(`Unknown app: ${name}`);
        return app;
    };

    async function run_unit_tests({ app }, ctx) { // eslint-disable-line no-unused-vars, camelcase
        const catalogApp = findApp(app);
        const key = repoFolderKeyFromUrl(catalogApp.url).toLowerCase();
        const hint = (knownClonePaths || []).find((p) => baseName(p).toLowerCase() === key);
        const folder = await electronAPI.selectFolder({ title: `Confirm folder for ${app}`, defaultPath: hint });
        if (!folder) throw new Error('No folder selected');
        const result = await electronAPI.runCoverage(folder);
        if (!result || !result.success) throw new Error(result?.error || 'Coverage run failed');
        return summarizeCoverageRun(app, folder, result.data);
    }

    async function get_coverage({ app, metric }) { // eslint-disable-line camelcase
        const catalogApp = findApp(app);
        const cov = await fetchAppCoverage(catalogApp);
        const item = (m) => {
            const b = cov?.[m];
            if (!b) throw new Error(`No coverage data found for ${app}`);
            return { metric: m, covered: b.covered, total: b.total, pct: round1(b.pct) };
        };
        if (!cov) throw new Error(`No coverage data found for ${app}`);
        if (metric === 'all') return { items: METRICS.map(item) };
        return item(metric);
    }

    async function get_test_totals({ group } = {}) { // eslint-disable-line camelcase
        const apps = group === 'you' ? youApps : group === 'we' ? weApps : allApps;
        const settled = await Promise.allSettled(apps.map((a) => fetchAppCoverage(a)));
        const rowStatus = {};
        const remoteMetrics = {};
        const appsWithoutData = [];
        settled.forEach((r, i) => {
            const name = apps[i].name;
            if (r.status === 'fulfilled' && r.value) {
                rowStatus[name] = 'loaded';
                remoteMetrics[name] = r.value;
            } else {
                appsWithoutData.push(name);
            }
        });
        const totals = sumLoadedTestCounts(apps, rowStatus, remoteMetrics);
        return {
            group: group || 'all',
            appsCounted: apps.length - appsWithoutData.length,
            appsWithoutData,
            ...totals
        };
    }

    return { run_unit_tests, get_coverage, get_test_totals };
}

module.exports = { createToolHandlers, summarizeCoverageRun };
