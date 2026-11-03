const { buildRunPayload } = require('./runReport');

describe('buildRunPayload', () => {
    it('builds totals, overall coverage and per-file rows', () => {
        const cov = {
            totalTests: 10,
            passedTests: 8,
            failedTests: 2,
            testSuites: 3,
            failedSuites: 1,
            summary: { lines: { covered: 5, total: 10, pct: 50 }, branches: { covered: 1, total: 4, pct: 25 } },
            files: [
                {
                    relativePath: 'src/a.js',
                    lines: { covered: 5, total: 10, pct: 50 },
                    statements: { covered: 6, total: 12, pct: 50 },
                    branches: { covered: 1, total: 4, pct: 25 },
                    functions: { covered: 1, total: 2, pct: 50 }
                }
            ]
        };
        const analysis = { files: [{ relativePath: 'src/a.js' }, { relativePath: 'src/b.js' }] };
        const p = buildRunPayload(cov, analysis);
        expect(p.tests).toEqual({ total: 10, passed: 8, failed: 2, suites: 3, failedSuites: 1 });
        expect(p.coverage.lines).toEqual({ covered: 5, total: 10, pct: 50 });
        expect(p.coverage.functions).toEqual({ covered: 0, total: 0, pct: 0 });
        expect(p.files).toHaveLength(2);
        expect(p.files[0]).toMatchObject({ path: 'src/a.js', hasCoverage: true, branches: { covered: 1, total: 4, pct: 25 } });
        expect(p.files[1]).toMatchObject({ path: 'src/b.js', hasCoverage: false });
    });

    it('tolerates missing inputs', () => {
        const p = buildRunPayload(null, null);
        expect(p.files).toEqual([]);
        expect(p.tests.total).toBe(0);
    });
});
