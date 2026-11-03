const { repoFolderKeyFromUrl, resolveAppDefaultBranch } = require('../data/appsCatalog');

const METRICS = ['lines', 'statements', 'branches'];

const round1 = (v) => Math.round((Number.isFinite(Number(v)) ? Number(v) : 0) * 10) / 10;
const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
const parentDir = (p) => {
    const t = String(p || '').replace(/[\\/]+$/, '');
    const i = Math.max(t.lastIndexOf('\\'), t.lastIndexOf('/'));
    return i > 0 ? t.slice(0, i) : undefined;
};

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

    async function run_unit_tests({ app, branch }, ctx) { // eslint-disable-line no-unused-vars, camelcase
        const catalogApp = findApp(app);
        const key = repoFolderKeyFromUrl(catalogApp.url).toLowerCase();
        const hint = (knownClonePaths || []).find((p) => baseName(p).toLowerCase() === key);
        const folder = await electronAPI.selectFolder({
            title: `Select folder to clone ${app} into`,
            defaultPath: hint ? parentDir(hint) : undefined
        });
        if (!folder) throw new Error('No folder selected');
        const requested = typeof branch === 'string' ? branch.trim() : '';
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

module.exports = { createToolHandlers };
