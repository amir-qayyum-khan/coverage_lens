const { resolveRemoteCoverageBranches } = require('../data/appsCatalog');
const { fetchAppCoverage, sumLoadedTestCounts, getSavedGitCredentials } = require('./remoteCoverage');

describe('remoteCoverage', () => {
    const app = { name: 'A', url: 'https://git.example/a.git' };

    afterEach(() => {
        delete window.electronAPI;
        localStorage.clear();
    });

    test('fetchAppCoverage maps result', async () => {
        const creds = { username: 'u', token: 't' };
        localStorage.setItem('git_credentials', JSON.stringify(creds));
        const cov = {
            lines: { covered: 1, total: 2, pct: 50 },
            statements: { covered: 1, total: 2, pct: 50 },
            branches: { covered: 0, total: 2, pct: 0 }
        };
        const fetchRemoteCoverage = jest.fn().mockResolvedValue({
            success: true,
            branch: 'developV2',
            data: { coverage: cov, tests: { totalTests: 3 }, generatedAt: 't' }
        });
        window.electronAPI = { fetchRemoteCoverage };

        const out = await fetchAppCoverage(app);

        expect(out).toEqual({
            lines: cov.lines,
            statements: cov.statements,
            branches: cov.branches,
            tests: { totalTests: 3 },
            branch: 'developV2',
            generatedAt: 't'
        });
        expect(fetchRemoteCoverage).toHaveBeenCalledWith(app.url, creds, resolveRemoteCoverageBranches(app));
        expect(getSavedGitCredentials()).toEqual(creds);
    });

    test('returns null without coverage', async () => {
        window.electronAPI = { fetchRemoteCoverage: jest.fn().mockResolvedValue({ success: true, data: {} }) };
        expect(await fetchAppCoverage(app)).toBeNull();
        window.electronAPI.fetchRemoteCoverage.mockResolvedValue({ success: false });
        expect(await fetchAppCoverage(app)).toBeNull();
    });

    test('sumLoadedTestCounts sums only loaded rows', () => {
        const apps = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
        const rowStatus = { A: 'loaded', B: 'error', C: 'loaded' };
        const metrics = {
            A: { tests: { passedTests: 2, failedTests: 1, totalTests: 3 } },
            B: { tests: { passedTests: 9, failedTests: 9, totalTests: 18 } },
            C: {}
        };
        expect(sumLoadedTestCounts(apps, rowStatus, metrics)).toEqual({ passedTests: 2, failedTests: 1, totalTests: 3 });
    });
});
