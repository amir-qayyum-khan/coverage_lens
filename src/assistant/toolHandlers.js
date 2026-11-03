const { repoFolderKeyFromUrl, resolveAppDefaultBranch } = require('../data/appsCatalog');

const { sumLoadedCoverage } = require('../services/remoteCoverage');

const { appAliases } = require('./hostConfig');

const { askAdministrator } = require('./assistantSettings');

const METRICS = ['lines', 'statements', 'branches'];
const COMPLEX = `For anything more complex, ${askAdministrator()}.`;
const NO_RUN = 'No test run is open. Ask me to run the unit tests for an app first.';
const normPath = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();

const round1 = (v) => Math.round((Number.isFinite(Number(v)) ? Number(v) : 0) * 10) / 10;
const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
const parentDir = (p) => {
    const t = String(p || '').replace(/[\\/]+$/, '');
    const i = Math.max(t.lastIndexOf('\\'), t.lastIndexOf('/'));
    return i > 0 ? t.slice(0, i) : undefined;
};

/** True when the value cannot be a git ref name (whitespace, forbidden chars, bad endings). */
function isInvalidGitRef(b) {
    // eslint-disable-next-line no-control-regex
    if (/[\s~^:?*[\\\x00-\x1f\x7f]/.test(b)) return true;
    return b.includes('..') || b.includes('@{') || b.startsWith('/') || b.endsWith('/') || b.endsWith('.') || b.endsWith('.lock');
}

/** Lowercase names and aliases of every known app (a branch equal to one is a mis-extracted app phrase). */
function knownAppWords(apps) {
    return new Set(apps.flatMap((a) => appAliases(a.name, a.url)));
}

/**
 * @param {object} deps
 * @returns {Record<string, Function>}
 */
function createToolHandlers({ electronAPI, youApps, weApps, knownClonePaths, fetchAppCoverage, sumLoadedTestCounts, listRuns }) {
    const allApps = [...youApps, ...weApps];
    const appWords = knownAppWords(allApps);
    const findApp = (name) => {
        const app = allApps.find((a) => a.name === name);
        if (!app) throw new Error(`Unknown app: ${name}`);
        return app;
    };

    async function run_unit_tests({ app, branch }, ctx) { // eslint-disable-line no-unused-vars, camelcase
        const catalogApp = findApp(app);
        const key = repoFolderKeyFromUrl(catalogApp.url).toLowerCase();
        const hint = (knownClonePaths || []).find((p) => baseName(p).toLowerCase() === key);
        const folder = await electronAPI.selectFolder({
            title: `Select folder to clone ${app} into`,
            defaultPath: hint ? parentDir(hint) : undefined
        });
        if (!folder) throw new Error('No folder selected');
        let requested = typeof branch === 'string' ? branch.trim() : '';
        if (requested && (isInvalidGitRef(requested) || appWords.has(requested.toLowerCase()))) requested = '';
        const resolvedBranch = requested || resolveAppDefaultBranch(catalogApp);
        await electronAPI.openDetachedWindow(catalogApp, resolvedBranch, folder);
        return { app, folder, branch: resolvedBranch };
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

    async function get_test_totals({ app, group } = {}) { // eslint-disable-line camelcase
        const apps = app ? [findApp(app)] : group === 'you' ? youApps : group === 'we' ? weApps : allApps;
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
            group: app || group || 'all',
            appsCounted: apps.length - appsWithoutData.length,
            appsWithoutData,
            ...totals
        };
    }

    async function get_group_coverage({ group, metric } = {}) { // eslint-disable-line camelcase
        const apps = group === 'you' ? youApps : group === 'we' ? weApps : allApps;
        const label = group === 'you' ? 'you apps' : group === 'we' ? 'we apps' : 'all apps';
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
        const appsCounted = apps.length - appsWithoutData.length;
        if (appsCounted === 0) throw new Error(`No coverage data found for ${label}`);
        const wanted = METRICS.includes(metric) ? [metric] : METRICS;
        const items = wanted.map((m) => {
            const { covered, total, pct } = sumLoadedCoverage(apps, rowStatus, remoteMetrics, m);
            return { group: label, metric: m, covered, total, pct, appsCounted };
        });
        return { items, appsCounted, appsWithoutData };
    }

    /** Pick the most recent run (for the named app when given) or explain why there is none. */
    async function pickRun(app) {
        let runs = [];
        try {
            runs = (typeof listRuns === 'function' ? await listRuns() : null) || [];
        } catch {
            runs = [];
        }
        if (!runs.length) throw new Error(NO_RUN);
        const run = app ? runs.find((r) => r.app === app) : runs[0];
        if (!run) throw new Error(`No test run is open for ${app}. Ask me to run the unit tests for ${app} first.`);
        if (run.status === 'running') {
            throw new Error(`The test run for ${run.app} is still running. Ask again once it has finished.`);
        }
        if (run.status === 'error') {
            throw new Error(`The test run for ${run.app} failed: ${run.error || 'unknown error'}. ${COMPLEX}`);
        }
        return run;
    }

    async function get_run_summary({ app } = {}) { // eslint-disable-line camelcase
        const run = await pickRun(app);
        const t = run.tests || {};
        const c = run.coverage || {};
        return {
            app: run.app,
            branch: run.branch || 'default branch',
            passed: t.passed || 0,
            failed: t.failed || 0,
            total: t.total || 0,
            lines: round1(c.lines && c.lines.pct),
            statements: round1(c.statements && c.statements.pct),
            branches: round1(c.branches && c.branches.pct),
            functions: round1(c.functions && c.functions.pct),
            status: run.status
        };
    }

    async function get_run_path_coverage({ path, app } = {}) { // eslint-disable-line camelcase
        const run = await pickRun(app);
        const term = String(path || '').trim();
        if (!term) throw new Error(`Tell me which path or folder to look at. ${COMPLEX}`);
        const needle = normPath(term);
        const matched = (run.files || []).filter((f) => normPath(f.path).includes(needle));
        if (!matched.length) throw new Error(`No files in this run match "${term}". ${COMPLEX}`);
        const items = METRICS.map((m) => {
            const covered = matched.reduce((n, f) => n + ((f[m] && f[m].covered) || 0), 0);
            const total = matched.reduce((n, f) => n + ((f[m] && f[m].total) || 0), 0);
            return {
                app: run.app,
                path: term,
                metric: m,
                covered,
                total,
                pct: total ? round1((covered / total) * 100) : 0,
                fileCount: matched.length
            };
        });
        return { items, fileCount: matched.length };
    }

    async function get_run_gaps({ path, app } = {}) { // eslint-disable-line camelcase
        const run = await pickRun(app);
        const term = typeof path === 'string' ? path.trim() : '';
        let files = run.files || [];
        if (term) {
            const needle = normPath(term);
            files = files.filter((f) => normPath(f.path).includes(needle));
            if (!files.length) throw new Error(`No files in this run match "${term}". ${COMPLEX}`);
        }
        const linePct = (f) => (f.lines && Number(f.lines.pct)) || 0;
        const noCoverage = files.filter((f) => !f.hasCoverage).map((f) => f.path);
        const zeroCoverage = files.filter((f) => f.hasCoverage && linePct(f) === 0).map((f) => f.path);
        const lowest = files
            .filter((f) => f.hasCoverage)
            .sort((a, b) => linePct(a) - linePct(b))
            .slice(0, 10)
            .map((f) => ({ path: f.path, pct: round1(linePct(f)) }));
        const list = (arr) => (arr.length > 15 ? `${arr.slice(0, 15).join(', ')} and ${arr.length - 15} more` : arr.join(', '));
        const parts = [
            noCoverage.length
                ? `${noCoverage.length} file(s) have no coverage data: ${list(noCoverage)}.`
                : 'Every file has coverage data.',
            zeroCoverage.length
                ? `${zeroCoverage.length} file(s) are at 0% line coverage: ${list(zeroCoverage)}.`
                : 'No file is at 0% line coverage.',
            lowest.length ? `Lowest line coverage: ${lowest.map((f) => `${f.path} (${f.pct}%)`).join(', ')}.` : ''
        ];
        return {
            app: run.app,
            scope: term ? ` (files matching "${term}")` : '',
            fileCount: files.length,
            noCoverage,
            zeroCoverage,
            lowest,
            summary: parts.filter(Boolean).join(' ')
        };
    }

    async function get_run_failures({ app } = {}) { // eslint-disable-line camelcase
        const run = await pickRun(app);
        const failed = (run.tests && run.tests.failed) || 0;
        const groups = run.failures || [];
        const listed = groups.slice(0, 5).map((g) => {
            const names = g.tests.slice(0, 3).join('; ');
            return `${g.count} failing${names ? ` (${names})` : ''}: ${g.reason}`;
        });
        let summary;
        if (!failed) summary = 'No tests failed.';
        else if (!listed.length) summary = `${failed} test(s) failed, but no failure details were captured.`;
        else summary = `${failed} test(s) failed. ${listed.join(' | ')}${groups.length > 5 ? ` and ${groups.length - 5} more error type(s)` : ''}`;
        return { app: run.app, failed, summary };
    }

    return {
        run_unit_tests,
        get_run_failures,
        get_coverage,
        get_group_coverage,
        get_test_totals,
        get_run_summary,
        get_run_path_coverage,
        get_run_gaps
    };
}

module.exports = { createToolHandlers };
