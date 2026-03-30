const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    writeSuperDashboardJestSummary,
    readSuperDashboardJestSummary,
    loadCachedSuperDashboardMetrics
} = require('./superDashboardPersist');

describe('superDashboardPersist', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-test-'));
    });

    afterEach(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    test('readSuperDashboardJestSummary returns metrics after write', () => {
        const results = {
            totalTests: 1,
            passedTests: 1,
            failedTests: 0,
            testSuites: 1,
            success: true,
            exitCode: 0,
            coverage: {
                total: {
                    lines: { pct: 10, covered: 1, total: 10 },
                    statements: { pct: 10, covered: 1, total: 10 },
                    branches: { pct: 10, covered: 1, total: 10 },
                    functions: { pct: 10, covered: 1, total: 10 }
                }
            }
        };
        writeSuperDashboardJestSummary(tmpDir, 'main', '/jest', results);
        const read = readSuperDashboardJestSummary(tmpDir);
        expect(read.lines.pct).toBe(10);
        expect(read.statements.total).toBe(10);
    });

    test('readSuperDashboardJestSummary returns null when file missing', () => {
        expect(readSuperDashboardJestSummary(tmpDir)).toBeNull();
    });

    test('loadCachedSuperDashboardMetrics merges keys by repo basename', () => {
        const cloneA = path.join(tmpDir, 'RepoA');
        const cloneB = path.join(tmpDir, 'RepoB');
        fs.mkdirSync(cloneA, { recursive: true });
        fs.mkdirSync(cloneB, { recursive: true });
        writeSuperDashboardJestSummary(cloneA, 'main', '/jest', {
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            testSuites: 0,
            success: true,
            exitCode: 0,
            coverage: {
                total: {
                    lines: { pct: 100, covered: 1, total: 1 },
                    statements: { pct: 100, covered: 1, total: 1 },
                    branches: { pct: 100, covered: 1, total: 1 },
                    functions: { pct: 100, covered: 1, total: 1 }
                }
            }
        });
        const { metrics, skipped } = loadCachedSuperDashboardMetrics([cloneA, cloneB, '/nonexistent']);
        expect(metrics.RepoA.lines.pct).toBe(100);
        expect(Object.keys(metrics)).toEqual(['RepoA']);
        expect(skipped.length).toBeGreaterThanOrEqual(2);
    });

    test('writes JSON with coverage totals and default reportSource', () => {
        const results = {
            totalTests: 2,
            passedTests: 2,
            failedTests: 0,
            testSuites: 1,
            success: true,
            exitCode: 0,
            coverage: {
                total: {
                    lines: { pct: 80, covered: 8, total: 10 },
                    statements: { pct: 75, covered: 15, total: 20 },
                    branches: { pct: 50, covered: 5, total: 10 },
                    functions: { pct: 90, covered: 9, total: 10 }
                }
            }
        };
        const p = writeSuperDashboardJestSummary(tmpDir, 'develop', '/abs/jest-root', results);
        expect(p).toBe(path.join(tmpDir, '.code-analyzer', 'super-dashboard-jest.json'));
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        expect(data.branch).toBe('develop');
        expect(data.jestProjectRoot).toBe('/abs/jest-root');
        expect(data.coverage.lines.pct).toBe(80);
        expect(data.tests.totalTests).toBe(2);
        expect(data.reportSource).toBe('clone-test');
    });

    test('writes reportSource code-analysis when set', () => {
        writeSuperDashboardJestSummary(tmpDir, null, '/proj', {
            reportSource: 'code-analysis',
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            testSuites: 0,
            success: true,
            exitCode: 0,
            coverage: {
                total: {
                    lines: { pct: 1, covered: 1, total: 1 },
                    statements: { pct: 1, covered: 1, total: 1 },
                    branches: { pct: 1, covered: 1, total: 1 },
                    functions: { pct: 1, covered: 1, total: 1 }
                }
            }
        });
        const data = JSON.parse(
            fs.readFileSync(path.join(tmpDir, '.code-analyzer', 'super-dashboard-jest.json'), 'utf8')
        );
        expect(data.reportSource).toBe('code-analysis');
    });
});
