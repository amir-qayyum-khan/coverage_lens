const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

jest.mock('../utils/repoCommandLogger', () => ({
    logRepoCommand: jest.fn(),
    resolveRepoNameFromCwd: jest.fn(() => 'TestRepo'),
    truncateLogTail: jest.requireActual('../utils/repoCommandLogger').truncateLogTail
}));

jest.mock('child_process', () => ({
    spawn: jest.fn()
}));

const { spawn } = require('child_process');
const {
    runResilientJestCoverage,
    runIsolatedJestCoverage,
    findTestFiles,
    sanitizeCoverageTempKey,
    runWithConcurrency
} = require('./jestResilientCoverage');

function mockJestChild(exitCode, stdoutText = '') {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    process.nextTick(() => {
        if (stdoutText) proc.stdout.emit('data', Buffer.from(stdoutText));
        proc.emit('close', exitCode);
    });
    return proc;
}

function writeCoverageArtifacts(coverageDir) {
    fs.mkdirSync(coverageDir, { recursive: true });
    const summary = {
        'src/sample.js': {
            lines: { total: 5, covered: 3, pct: 60 },
            statements: { total: 5, covered: 3, pct: 60 },
            functions: { total: 1, covered: 1, pct: 100 },
            branches: { total: 2, covered: 1, pct: 50 }
        },
        total: {
            lines: { total: 5, covered: 3, pct: 60 },
            statements: { total: 5, covered: 3, pct: 60 },
            functions: { total: 1, covered: 1, pct: 100 },
            branches: { total: 2, covered: 1, pct: 50 }
        }
    };
    fs.writeFileSync(path.join(coverageDir, 'coverage-summary.json'), JSON.stringify(summary), 'utf8');
    fs.writeFileSync(path.join(coverageDir, 'coverage-final.json'), JSON.stringify({}), 'utf8');
}

const PASS_OUTPUT = 'Tests: 1 passed, 1 total\nTest Suites: 1 passed, 1 total\n';

describe('jestResilientCoverage', () => {
    let tmpDir;

    beforeEach(() => {
        jest.clearAllMocks();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jest-resilient-'));
        fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'resilient-test' }), 'utf8');
        fs.writeFileSync(path.join(tmpDir, 'jest.config.js'), 'module.exports = {};\n', 'utf8');
        fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    });

    afterEach(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    test('sanitizeCoverageTempKey strips unsafe characters', () => {
        expect(sanitizeCoverageTempKey('src/a:b.test.js')).toBe('src_a_b.test.js');
    });

    test('findTestFiles discovers test files', () => {
        fs.writeFileSync(path.join(tmpDir, 'src', 'a.test.js'), 'test("x", () => {});\n', 'utf8');
        const files = findTestFiles(tmpDir);
        expect(files).toHaveLength(1);
    });

    test('runWithConcurrency limits parallel workers', async () => {
        let active = 0;
        let maxActive = 0;
        const tasks = [1, 2, 3, 4, 5].map((n) => async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((r) => setTimeout(r, 20));
            active -= 1;
            return n;
        });
        const results = await runWithConcurrency(tasks, 2);
        expect(results).toEqual([1, 2, 3, 4, 5]);
        expect(maxActive).toBeLessThanOrEqual(2);
    });

    test('full run success skips batch and per-file phases', async () => {
        spawn.mockImplementation(() => {
            const spawnArgs = spawn.mock.calls[spawn.mock.calls.length - 1][1];
            const coverageDirArg = spawnArgs.find((a) => String(a).startsWith('--coverageDirectory='));
            const dir = coverageDirArg.slice('--coverageDirectory='.length);
            writeCoverageArtifacts(dir);
            return mockJestChild(0, PASS_OUTPUT);
        });

        const result = await runResilientJestCoverage({
            jestRoot: tmpDir,
            jestConfigPath: path.join(tmpDir, 'jest.config.js')
        });

        expect(spawn).toHaveBeenCalledTimes(1);
        expect(result.hasCoverage).toBe(true);
        expect(result.diagnostics.coverageExecutionMode).toBe('full');
        expect(result.diagnostics.phasesUsed).toEqual(['full']);
    });

    test('falls back to batch when full run is incomplete', async () => {
        fs.mkdirSync(path.join(tmpDir, 'src', 'components'), { recursive: true });
        fs.mkdirSync(path.join(tmpDir, 'src', 'pages'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'src', 'components', 'a.test.js'), 'test("a", () => {});\n', 'utf8');

        spawn.mockImplementation(() => {
            const spawnArgs = spawn.mock.calls[spawn.mock.calls.length - 1][1];
            const coverageDirArg = spawnArgs.find((a) => String(a).startsWith('--coverageDirectory='));
            const dir = coverageDirArg.slice('--coverageDirectory='.length);
            const isFull = dir.includes(`${path.sep}full`) || dir.endsWith('/full') || dir.endsWith('\\full');
            if (!isFull) {
                writeCoverageArtifacts(dir);
                return mockJestChild(0, PASS_OUTPUT);
            }
            return mockJestChild(1, 'PASS src/a.test.js\nFAIL src/b.test.js\n');
        });

        const result = await runResilientJestCoverage({
            jestRoot: tmpDir,
            jestConfigPath: path.join(tmpDir, 'jest.config.js')
        });

        expect(spawn.mock.calls.length).toBeGreaterThan(1);
        expect(result.hasCoverage).toBe(true);
        expect(result.diagnostics.phasesUsed).toContain('batch');
    });

    test('runIsolatedJestCoverage delegates to hybrid runner', async () => {
        spawn.mockImplementation(() => {
            const spawnArgs = spawn.mock.calls[spawn.mock.calls.length - 1][1];
            const coverageDirArg = spawnArgs.find((a) => String(a).startsWith('--coverageDirectory='));
            writeCoverageArtifacts(coverageDirArg.slice('--coverageDirectory='.length));
            return mockJestChild(0, PASS_OUTPUT);
        });

        const result = await runIsolatedJestCoverage({
            jestRoot: tmpDir,
            jestConfigPath: path.join(tmpDir, 'jest.config.js')
        });
        expect(result.hasCoverage).toBe(true);
    });
});
