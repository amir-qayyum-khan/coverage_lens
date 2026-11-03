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
