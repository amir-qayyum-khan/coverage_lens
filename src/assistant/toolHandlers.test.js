const { createToolHandlers } = require('./toolHandlers');
const { YOU_APPS, WE_APPS, repoFolderKeyFromUrl, resolveAppDefaultBranch } = require('../data/appsCatalog');

const commonUI = WE_APPS.find((a) => a.name === 'CommonUI');
const commonPath = `D:\\repos\\${repoFolderKeyFromUrl(commonUI.url)}`;
const cov = (covered, total) => ({ covered, total, pct: (covered / total) * 100 });

function make(paths = ['D:\\repos\\Other', commonPath]) {
    const sum = jest.fn((apps, rowStatus, metrics) => {
        let p = 0;
        let f = 0;
        let t = 0;
        for (const a of apps) {
            if (rowStatus[a.name] !== 'loaded') continue;
            p += metrics[a.name].tests.passedTests;
            f += metrics[a.name].tests.failedTests;
            t += metrics[a.name].tests.totalTests;
        }
        return { passedTests: p, failedTests: f, totalTests: t };
    });
    const deps = {
        electronAPI: { selectFolder: jest.fn(), openDetachedWindow: jest.fn().mockResolvedValue(undefined) },
        youApps: YOU_APPS,
        weApps: WE_APPS,
        knownClonePaths: paths,
        fetchAppCoverage: jest.fn(),
        sumLoadedTestCounts: sum
    };
    return { deps, handlers: createToolHandlers(deps) };
}

describe('run_unit_tests', () => {
    it('rejects and opens no window when folder selection is cancelled', async () => {
        const { deps, handlers } = make();
        deps.electronAPI.selectFolder.mockResolvedValue(null);
        await expect(handlers.run_unit_tests({ app: 'CommonUI' }, {})).rejects.toThrow('No folder selected');
        expect(deps.electronAPI.openDetachedWindow).not.toHaveBeenCalled();
    });

    it('throws on unknown app', async () => {
        const { handlers } = make();
        await expect(handlers.run_unit_tests({ app: 'Nope' }, {})).rejects.toThrow('Unknown app: Nope');
    });

    it('defaults the dialog to the parent of the hinted clone and opens the window', async () => {
        const { deps, handlers } = make();
        deps.electronAPI.selectFolder.mockResolvedValue('D:\\base');
        const res = await handlers.run_unit_tests({ app: 'CommonUI', branch: 'release/2.1' }, {});
        expect(deps.electronAPI.selectFolder).toHaveBeenCalledWith({
            title: 'Select folder to clone CommonUI into',
            defaultPath: 'D:\\repos'
        });
        expect(deps.electronAPI.openDetachedWindow).toHaveBeenCalledWith(commonUI, 'release/2.1', 'D:\\base');
        expect(res).toEqual({ app: 'CommonUI', folder: 'D:\\base', branch: 'release/2.1' });
    });

    it('trims an explicit branch', async () => {
        const { deps, handlers } = make();
        deps.electronAPI.selectFolder.mockResolvedValue('D:\\base');
        const res = await handlers.run_unit_tests({ app: 'CommonUI', branch: '  developV2 ' }, {});
        expect(res.branch).toBe('developV2');
        expect(deps.electronAPI.openDetachedWindow.mock.calls[0][1]).toBe('developV2');
    });

    it.each([[undefined], [''], ['   ']])('falls back to the catalog default branch for %p', async (branch) => {
        const { deps, handlers } = make();
        deps.electronAPI.selectFolder.mockResolvedValue('D:\\base');
        const res = await handlers.run_unit_tests({ app: 'CommonUI', branch }, {});
        const expected = resolveAppDefaultBranch(commonUI);
        expect(res.branch).toBe(expected);
        expect(deps.electronAPI.openDetachedWindow).toHaveBeenCalledWith(commonUI, expected, 'D:\\base');
    });

    it('matches the clone-path hint case-insensitively', async () => {
        const { deps, handlers } = make(['D:\\repos\\Other', commonPath.toLowerCase()]);
        deps.electronAPI.selectFolder.mockResolvedValue(null);
        await expect(handlers.run_unit_tests({ app: 'CommonUI' }, {})).rejects.toThrow();
        expect(deps.electronAPI.selectFolder.mock.calls[0][0].defaultPath).toBe('d:\\repos');
    });

    it('passes no default path when there is no hint', async () => {
        const { deps, handlers } = make([]);
        deps.electronAPI.selectFolder.mockResolvedValue(null);
        await expect(handlers.run_unit_tests({ app: 'CommonUI' }, {})).rejects.toThrow();
        expect(deps.electronAPI.selectFolder.mock.calls[0][0].defaultPath).toBeUndefined();
    });
});

describe('get_coverage', () => {
    it('rounds a single metric', async () => {
        const { deps, handlers } = make();
        deps.fetchAppCoverage.mockResolvedValue({ lines: { covered: 80499, total: 106235, pct: 75.77 } });
        expect(await handlers.get_coverage({ app: 'CommonUI', metric: 'lines' })).toEqual({
            metric: 'lines',
            covered: 80499,
            total: 106235,
            pct: 75.8
        });
    });

    it('returns all three metrics', async () => {
        const { deps, handlers } = make();
        deps.fetchAppCoverage.mockResolvedValue({ lines: cov(1, 2), statements: cov(1, 2), branches: cov(1, 4) });
        const res = await handlers.get_coverage({ app: 'CommonUI', metric: 'all' });
        expect(res.items).toHaveLength(3);
        expect(res.items[2]).toEqual({ metric: 'branches', covered: 1, total: 4, pct: 25 });
    });

    it('rejects with no data', async () => {
        const { deps, handlers } = make();
        deps.fetchAppCoverage.mockResolvedValue(null);
        await expect(handlers.get_coverage({ app: 'CoreUI', metric: 'all' })).rejects.toThrow(
            'No coverage data found for CoreUI'
        );
    });
});

describe('get_test_totals', () => {
    it('sums only WE apps and lists those without data', async () => {
        const { deps, handlers } = make();
        deps.fetchAppCoverage.mockImplementation(async (app) => {
            if (app.name === 'CoreUI') return null;
            if (app.name === 'CommonUI') throw new Error('net');
            return { tests: { passedTests: 9, failedTests: 1, totalTests: 10 } };
        });
        const res = await handlers.get_test_totals({ group: 'we' });
        const n = WE_APPS.length;
        expect(res.group).toBe('we');
        expect(res.appsCounted).toBe(n - 2);
        expect([...res.appsWithoutData].sort()).toEqual(['CommonUI', 'CoreUI']);
        expect(res.totalTests).toBe((n - 2) * 10);
        expect(res.passedTests).toBe((n - 2) * 9);
        expect(res.failedTests).toBe(n - 2);
        expect(deps.fetchAppCoverage).toHaveBeenCalledTimes(n);
    });

    it('returns only the named app when app is given', async () => {
        const { deps, handlers } = make();
        deps.fetchAppCoverage.mockResolvedValue({ tests: { passedTests: 9, failedTests: 1, totalTests: 10 } });
        const res = await handlers.get_test_totals({ app: 'LaunchpadUI' });
        expect(res.group).toBe('LaunchpadUI');
        expect(res.appsCounted).toBe(1);
        expect(res.failedTests).toBe(1);
        expect(deps.fetchAppCoverage).toHaveBeenCalledTimes(1);
        expect(deps.fetchAppCoverage.mock.calls[0][0].name).toBe('LaunchpadUI');
    });

    it('defaults to all groups', async () => {
        const { deps, handlers } = make();
        deps.fetchAppCoverage.mockResolvedValue({ tests: { passedTests: 1, failedTests: 0, totalTests: 1 } });
        const res = await handlers.get_test_totals({});
        expect(res.group).toBe('all');
        expect(res.appsCounted).toBe(YOU_APPS.length + WE_APPS.length);
        expect(res.totalTests).toBe(YOU_APPS.length + WE_APPS.length);
    });
});

describe('get_group_coverage', () => {
    const blk = (c, t) => ({ lines: cov(c, t), statements: cov(c, t), branches: cov(c, t) });

    it('sums covered/total across the we apps for all metrics', async () => {
        const { deps, handlers } = make();
        deps.fetchAppCoverage.mockResolvedValue({
            lines: { covered: 1, total: 3, pct: 33 },
            statements: { covered: 2, total: 4, pct: 50 },
            branches: { covered: 0, total: 0, pct: 0 }
        });
        const res = await handlers.get_group_coverage({ group: 'we', metric: 'all' });
        const n = WE_APPS.length;
        expect(res.appsCounted).toBe(n);
        expect(res.appsWithoutData).toEqual([]);
        expect(res.items).toEqual([
            { group: 'we apps', metric: 'lines', covered: n, total: 3 * n, pct: 33.3, appsCounted: n },
            { group: 'we apps', metric: 'statements', covered: 2 * n, total: 4 * n, pct: 50, appsCounted: n },
            { group: 'we apps', metric: 'branches', covered: 0, total: 0, pct: 0, appsCounted: n }
        ]);
    });

    it('returns one item for a single metric and uses the you group', async () => {
        const { deps, handlers } = make();
        deps.fetchAppCoverage.mockResolvedValue(blk(1, 4));
        const res = await handlers.get_group_coverage({ group: 'you', metric: 'branches' });
        const n = YOU_APPS.length;
        expect(deps.fetchAppCoverage).toHaveBeenCalledTimes(n);
        expect(res.items).toEqual([{ group: 'you apps', metric: 'branches', covered: n, total: 4 * n, pct: 25, appsCounted: n }]);
    });

    it('defaults to all apps', async () => {
        const { deps, handlers } = make();
        deps.fetchAppCoverage.mockResolvedValue(blk(1, 2));
        const res = await handlers.get_group_coverage({ metric: 'lines' });
        const n = YOU_APPS.length + WE_APPS.length;
        expect(res.items[0]).toMatchObject({ group: 'all apps', covered: n, total: 2 * n, pct: 50 });
        expect(res.appsCounted).toBe(n);
    });

    it('counts failed and null apps in appsWithoutData and skips them in sums', async () => {
        const { deps, handlers } = make();
        deps.fetchAppCoverage.mockImplementation(async (app) => {
            if (app.name === 'CoreUI') return null;
            if (app.name === 'CommonUI') throw new Error('net');
            return blk(5, 10);
        });
        const res = await handlers.get_group_coverage({ group: 'we', metric: 'lines' });
        const n = WE_APPS.length - 2;
        expect([...res.appsWithoutData].sort()).toEqual(['CommonUI', 'CoreUI']);
        expect(res.appsCounted).toBe(n);
        expect(res.items[0]).toMatchObject({ covered: 5 * n, total: 10 * n, pct: 50, appsCounted: n });
    });

    it('gives pct 0 when total is 0', async () => {
        const { deps, handlers } = make();
        deps.fetchAppCoverage.mockResolvedValue(blk(0, 0));
        const res = await handlers.get_group_coverage({ group: 'we', metric: 'lines' });
        expect(res.items[0]).toMatchObject({ covered: 0, total: 0, pct: 0 });
    });

    it('throws when no app loaded', async () => {
        const { deps, handlers } = make();
        deps.fetchAppCoverage.mockRejectedValue(new Error('x'));
        await expect(handlers.get_group_coverage({ group: 'we' })).rejects.toThrow('No coverage data found for we apps');
        await expect(handlers.get_group_coverage({})).rejects.toThrow('No coverage data found for all apps');
    });
});

describe('run_unit_tests branch sanitising', () => {
    it.each([['core ui'], ['we common'], ['CoreUI'], ['  '], ['Common'], ['launchpadui'], ['a..b'], ['x~1'], ['a:b'], ['foo.lock'], ['dir/']])(
        'treats %p as no branch',
        async (branch) => {
            const { deps, handlers } = make();
            deps.electronAPI.selectFolder.mockResolvedValue('D:\base');
            const res = await handlers.run_unit_tests({ app: 'CommonUI', branch }, {});
            expect(res.branch).toBe(resolveAppDefaultBranch(commonUI));
        }
    );

    it.each([['developV2', 'developV2'], [' release/2.1 ', 'release/2.1'], ['develop', 'develop'], ['main', 'main'], ['feature/x-y', 'feature/x-y']])(
        'passes %p through as %p',
        async (branch, expected) => {
            const { deps, handlers } = make();
            deps.electronAPI.selectFolder.mockResolvedValue('D:\base');
            const res = await handlers.run_unit_tests({ app: 'CommonUI', branch }, {});
            expect(res.branch).toBe(expected);
        }
    );
});

describe('run tools', () => {
    const b = (covered, total) => ({ covered, total, pct: total ? (covered / total) * 100 : 0 });
    const file = (path, l, st, br, hasCoverage = true) => ({
        path,
        lines: b(...l),
        statements: b(...st),
        branches: b(...br),
        functions: b(0, 0),
        hasCoverage
    });
    const doneRun = (app, extra = {}) => ({
        id: `id-${app}`,
        app,
        branch: 'developV2',
        status: 'done',
        error: null,
        tests: { total: 20, passed: 17, failed: 3, suites: 4, failedSuites: 1 },
        coverage: { lines: b(75, 100), statements: b(80, 100), branches: b(1, 3), functions: b(9, 10) },
        files: [
            file('src/booking/Form.js', [8, 10], [9, 10], [1, 2]),
            file('src/booking/List.js', [2, 10], [2, 10], [0, 2]),
            file('src/Other.js', [10, 10], [10, 10], [2, 2]),
            file('src/Zero.js', [0, 5], [0, 5], [0, 0]),
            file('src/Missing.js', [0, 0], [0, 0], [0, 0], false)
        ],
        ...extra
    });
    const withRuns = (runs) => {
        const { deps } = make();
        deps.listRuns = jest.fn().mockResolvedValue(runs);
        return createToolHandlers(deps);
    };
    const NO_RUN = 'No test run is open. Ask me to run the unit tests for an app first.';

    it.each(['get_run_summary', 'get_run_path_coverage', 'get_run_gaps'])('%s reports no open run', async (name) => {
        const h = withRuns([]);
        await expect(h[name]({ path: 'x' })).rejects.toThrow(NO_RUN);
    });

    it('treats a missing listRuns dependency as no run', async () => {
        const { handlers } = make();
        await expect(handlers.get_run_summary({})).rejects.toThrow(NO_RUN);
    });

    it('summary uses the most recent run overall', async () => {
        const h = withRuns([doneRun('CoreUI'), doneRun('CommonUI')]);
        const r = await h.get_run_summary({});
        expect(r).toMatchObject({ app: 'CoreUI', passed: 17, failed: 3, total: 20, lines: 75, statements: 80, branches: 33.3, functions: 90 });
    });

    it('summary selects the run for the named app', async () => {
        const h = withRuns([doneRun('CoreUI'), doneRun('CommonUI', { tests: { total: 2, passed: 2, failed: 0 } })]);
        const r = await h.get_run_summary({ app: 'CommonUI' });
        expect(r).toMatchObject({ app: 'CommonUI', total: 2, failed: 0 });
    });

    it('says so when the named app has no run', async () => {
        const h = withRuns([doneRun('CoreUI')]);
        await expect(h.get_run_summary({ app: 'CommonUI' })).rejects.toThrow(
            'No test run is open for CommonUI. Ask me to run the unit tests for CommonUI first.'
        );
    });

    it('failures lists failing tests with reasons', async () => {
        const failures = [{ reason: 'Expected 1, received 2', count: 3, tests: ['Foo renders', 'Bar loads'] }];
        const h = withRuns([doneRun('CoreUI', { failures })]);
        const r = await h.get_run_failures({});
        expect(r.app).toBe('CoreUI');
        expect(r.failed).toBe(3);
        expect(r.summary).toContain('Foo renders; Bar loads');
        expect(r.summary).toContain('Expected 1, received 2');
    });

    it('failures says so when nothing failed or details are missing', async () => {
        const ok = withRuns([doneRun('CoreUI', { tests: { total: 2, passed: 2, failed: 0 } })]);
        expect((await ok.get_run_failures({})).summary).toBe('No tests failed.');
        const none = withRuns([doneRun('CoreUI')]);
        expect((await none.get_run_failures({})).summary).toMatch(/no failure details were captured/);
    });

    it('says the run is still running', async () => {
        const h = withRuns([doneRun('CoreUI', { status: 'running', tests: null, coverage: null, files: [] })]);
        await expect(h.get_run_summary({})).rejects.toThrow(/still running/);
        await expect(h.get_run_gaps({})).rejects.toThrow(/still running/);
    });

    it('reports a failed run with the administrator hint', async () => {
        const h = withRuns([doneRun('CoreUI', { status: 'error', error: 'clone failed' })]);
        await expect(h.get_run_summary({})).rejects.toThrow(/clone failed.*ask your administrator \(amir\.khan@voyagerr\.com\)/);
    });

    it('path coverage sums matching files case-insensitively', async () => {
        const h = withRuns([doneRun('CoreUI')]);
        const r = await h.get_run_path_coverage({ path: 'BOOKING' });
        expect(r.fileCount).toBe(2);
        expect(r.items).toEqual([
            { app: 'CoreUI', path: 'BOOKING', metric: 'lines', covered: 10, total: 20, pct: 50, fileCount: 2 },
            { app: 'CoreUI', path: 'BOOKING', metric: 'statements', covered: 11, total: 20, pct: 55, fileCount: 2 },
            { app: 'CoreUI', path: 'BOOKING', metric: 'branches', covered: 1, total: 4, pct: 25, fileCount: 2 }
        ]);
    });

    it('path coverage accepts backslash terms', async () => {
        const h = withRuns([doneRun('CoreUI')]);
        const r = await h.get_run_path_coverage({ path: 'src\\booking' });
        expect(r.fileCount).toBe(2);
    });

    it('path coverage rejects a term that matches nothing', async () => {
        const h = withRuns([doneRun('CoreUI')]);
        await expect(h.get_run_path_coverage({ path: 'payments' })).rejects.toThrow(
            'No files in this run match "payments". For anything more complex, ask your administrator (amir.khan@voyagerr.com).'
        );
    });

    it('path coverage honours app selection', async () => {
        const h = withRuns([doneRun('CoreUI'), doneRun('CommonUI', { files: [file('src/booking/X.js', [1, 1], [1, 1], [0, 0])] })]);
        const r = await h.get_run_path_coverage({ path: 'booking', app: 'CommonUI' });
        expect(r.fileCount).toBe(1);
        expect(r.items[0].app).toBe('CommonUI');
    });

    it('gaps lists missing, zero and lowest files', async () => {
        const h = withRuns([doneRun('CoreUI')]);
        const r = await h.get_run_gaps({});
        expect(r.noCoverage).toEqual(['src/Missing.js']);
        expect(r.zeroCoverage).toEqual(['src/Zero.js']);
        expect(r.lowest.map((f) => f.path)).toEqual(['src/Zero.js', 'src/booking/List.js', 'src/booking/Form.js', 'src/Other.js']);
        expect(r.scope).toBe('');
        expect(r.summary).toContain('1 file(s) have no coverage data: src/Missing.js.');
        expect(r.summary).toContain('1 file(s) are at 0% line coverage: src/Zero.js.');
    });

    it('gaps caps the lowest list at 10 and can filter by path', async () => {
        const many = Array.from({ length: 14 }, (_, i) => file(`src/m/f${i}.js`, [i + 1, 20], [1, 1], [0, 0]));
        const h = withRuns([doneRun('CoreUI', { files: many })]);
        expect((await h.get_run_gaps({})).lowest).toHaveLength(10);
        const r = await h.get_run_gaps({ path: 'f13' });
        expect(r.fileCount).toBe(1);
        expect(r.scope).toBe(' (files matching "f13")');
        await expect(h.get_run_gaps({ path: 'zzz' })).rejects.toThrow(/No files in this run match "zzz"/);
    });

    it('gaps reports a clean run', async () => {
        const h = withRuns([doneRun('CoreUI', { files: [file('src/a.js', [5, 10], [5, 10], [0, 0])] })]);
        const r = await h.get_run_gaps({});
        expect(r.summary).toContain('Every file has coverage data.');
        expect(r.summary).toContain('No file is at 0% line coverage.');
    });
});
