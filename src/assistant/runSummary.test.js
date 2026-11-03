const { formatRunSummary } = require('./runSummary');

const base = {
    app: 'LaunchpadUI',
    branch: 'developV2',
    status: 'done',
    tests: { total: 537, passed: 536, failed: 1 },
    coverage: {
        lines: { pct: 78.24 },
        statements: { pct: 77 },
        branches: { pct: 60.5 },
        functions: { pct: 70 }
    },
    files: [{ hasCoverage: true }, { hasCoverage: false }],
    failures: [{ reason: 'Expected 1, received 2', count: 1, tests: ['Foo renders'] }]
};

describe('formatRunSummary', () => {
    it('summarizes tests, coverage, failures and missing coverage', () => {
        const s = formatRunSummary(base);
        expect(s).toContain('LaunchpadUI (developV2)');
        expect(s).toContain('536 of 537 tests passed (1 failed)');
        expect(s).toContain('lines 78.2%');
        expect(s).toContain('Failing: Foo renders: Expected 1, received 2');
        expect(s).toContain('1 file(s) have no coverage data');
    });

    it('says all passed and omits the failing line', () => {
        const s = formatRunSummary({ ...base, tests: { total: 2, passed: 2, failed: 0 }, failures: [], files: [] });
        expect(s).toContain('all passed');
        expect(s).not.toContain('Failing:');
    });

    it('reports an errored run', () => {
        expect(formatRunSummary({ app: 'CoreUI', branch: '', status: 'error', error: 'clone failed' })).toBe(
            'The test run for CoreUI failed: clone failed.'
        );
    });
});
