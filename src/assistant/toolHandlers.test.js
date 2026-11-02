const { createToolHandlers, summarizeCoverageRun } = require('./toolHandlers');
const { YOU_APPS, WE_APPS, repoFolderKeyFromUrl } = require('../data/appsCatalog');

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
        electronAPI: { selectFolder: jest.fn(), runCoverage: jest.fn() },
        youApps: YOU_APPS,
        weApps: WE_APPS,
        knownClonePaths: paths,
        fetchAppCoverage: jest.fn(),
        sumLoadedTestCounts: sum
    };
    return { deps, handlers: createToolHandlers(deps) };
}

describe('run_unit_tests', () => {
    it('rejects when folder selection is cancelled', async () => {
        const { deps, handlers } = make();
        deps.electronAPI.selectFolder.mockResolvedValue(null);
        await expect(handlers.run_unit_tests({ app: 'CommonUI' }, {})).rejects.toThrow('No folder selected');
        expect(deps.electronAPI.runCoverage).not.toHaveBeenCalled();
    });

    it('throws on unknown app', async () => {
        const { handlers } = make();
        await expect(handlers.run_unit_tests({ app: 'Nope' }, {})).rejects.toThrow('Unknown app: Nope');
    });

    it('throws the runCoverage error', async () => {
        const { deps, handlers } = make();
        deps.electronAPI.selectFolder.mockResolvedValue('D:\\x');
        deps.electronAPI.runCoverage.mockResolvedValue({ success: false, error: 'boom' });
        await expect(handlers.run_unit_tests({ app: 'CommonUI' }, {})).rejects.toThrow('boom');
    });

    it('returns a summary on success', async () => {
        const { deps, handlers } = make();
        deps.electronAPI.selectFolder.mockResolvedValue(commonPath);
        deps.electronAPI.runCoverage.mockResolvedValue({
            success: true,
            data: {
                totalTests: 10,
                passedTests: 8,
                failedTests: 2,
                summary: {
                    lines: { covered: 50, total: 100, pct: 50 },
                    statements: { covered: 5, total: 10, pct: 50 },
                    branches: { covered: 1, total: 4, pct: 25 }
                },
                files: [
                    { relativePath: 'a.js', lines: { pct: 90 } },
                    { relativePath: 'b.js', lines: { pct: 10 } },
                    { relativePath: 'c.js', lines: { pct: 50 } }
                ],
                diagnostics: { failedTestFiles: ['x.test.js'] },
                message: 'done'
            }
        });
        const res = await handlers.run_unit_tests({ app: 'CommonUI' }, {});
        expect(deps.electronAPI.selectFolder).toHaveBeenCalledWith({
            title: 'Confirm folder for CommonUI',
            defaultPath: commonPath
        });
        expect(deps.electronAPI.runCoverage).toHaveBeenCalledWith(commonPath);
        expect(res.tests).toEqual({ total: 10, passed: 8, failed: 2 });
        expect(res.coverage.lines.pct).toBe(50);
        expect(res.lowestCoverageFiles[0]).toEqual({ file: 'b.js', linesPct: 10 });
        expect(res.failedTestFiles).toEqual(['x.test.js']);
        expect(res.message).toBe('done');
    });

    it('matches the clone-path hint case-insensitively', async () => {
        const { deps, handlers } = make(['D:\\repos\\Other', commonPath.toLowerCase()]);
        deps.electronAPI.selectFolder.mockResolvedValue(null);
        await expect(handlers.run_unit_tests({ app: 'CommonUI' }, {})).rejects.toThrow();
        expect(deps.electronAPI.selectFolder.mock.calls[0][0].defaultPath).toBe(commonPath.toLowerCase());
    });
});

describe('summarizeCoverageRun', () => {
    it('caps lists and tolerates missing data', () => {
        const files = Array.from({ length: 30 }, (_, i) => ({ relativePath: `f${i}.js`, lines: { pct: 100 - i } }));
        const failed = Array.from({ length: 30 }, (_, i) => `t${i}`);
        const r = summarizeCoverageRun('A', 'D:\\a', { files, diagnostics: { failedTestFiles: failed } });
        expect(r.lowestCoverageFiles).toHaveLength(10);
        expect(r.lowestCoverageFiles[0].file).toBe('f29.js');
        expect(r.failedTestFiles).toHaveLength(20);
        expect(r.tests).toEqual({ total: 0, passed: 0, failed: 0 });
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
