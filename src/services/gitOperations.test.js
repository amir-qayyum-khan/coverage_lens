const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

jest.mock('./coverageRunner', () => ({
    findJestProjectRoot: jest.fn()
}));

jest.mock('child_process', () => ({
    spawn: jest.fn()
}));

const { spawn } = require('child_process');
const { findJestProjectRoot } = require('./coverageRunner');
const { runTests, parseJestOutput, resolveJestSpawn } = require('./gitOperations');

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

describe('gitOperations', () => {
    let tmpDir;

    beforeEach(() => {
        jest.clearAllMocks();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-ops-test-'));
    });

    afterEach(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    describe('parseJestOutput', () => {
        test('parses passed and total tests', () => {
            const out =
                'Test Suites: 1 passed, 1 total\n' +
                'Tests:       3 passed, 3 total\n';
            const r = parseJestOutput(out);
            expect(r.passedTests).toBe(3);
            expect(r.totalTests).toBe(3);
            expect(r.failedTests).toBe(0);
        });

        test('parses failures', () => {
            const out = 'Tests:       1 failed, 2 passed, 3 total\n';
            const r = parseJestOutput(out);
            expect(r.failedTests).toBe(1);
            expect(r.passedTests).toBe(2);
            expect(r.totalTests).toBe(3);
        });
    });

    describe('runTests', () => {
        test('resolves early when no Jest project root', async () => {
            findJestProjectRoot.mockReturnValue(null);
            const r = await runTests(tmpDir, () => {}, 'main');
            expect(r.success).toBe(false);
            expect(r.message).toMatch(/No Jest project found/);
            expect(spawn).not.toHaveBeenCalled();
        });

        test('runs Jest in discovered root and reads coverage summary', async () => {
            const jestRoot = path.join(tmpDir, 'packages', 'app');
            fs.mkdirSync(path.join(jestRoot, 'coverage'), { recursive: true });
            fs.writeFileSync(
                path.join(jestRoot, 'coverage', 'coverage-summary.json'),
                JSON.stringify({
                    total: {
                        lines: { pct: 100, covered: 1, total: 1 },
                        statements: { pct: 100, covered: 1, total: 1 },
                        branches: { pct: 100, covered: 1, total: 1 },
                        functions: { pct: 100, covered: 1, total: 1 }
                    }
                }),
                'utf8'
            );

            findJestProjectRoot.mockReturnValue(jestRoot);
            spawn.mockImplementation(() =>
                mockJestChild(0, 'Tests:       1 passed, 1 total\nTest Suites: 1 passed, 1 total\n')
            );

            const r = await runTests(tmpDir, () => {}, 'feature/x');
            expect(spawn).toHaveBeenCalled();
            const spawnOpts = spawn.mock.calls[0][2];
            expect(spawnOpts.cwd).toBe(jestRoot);
            expect(r.success).toBe(true);
            expect(r.jestProjectRoot).toBe(jestRoot);
            expect(r.coverage.total.lines.pct).toBe(100);

            const summaryPath = path.join(tmpDir, '.code-analyzer', 'super-dashboard-jest.json');
            expect(fs.existsSync(summaryPath)).toBe(true);
            const written = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
            expect(written.branch).toBe('feature/x');
            expect(written.coverage.lines.pct).toBe(100);
            expect(written.reportSource).toBe('clone-test');
        });
    });

    describe('resolveJestSpawn', () => {
        test('uses npx when local jest binary is missing', () => {
            const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jest-bin-'));
            try {
                const { command, args } = resolveJestSpawn(emptyRoot);
                expect(command).toBe('npx');
                expect(args[0]).toBe('--yes');
                expect(args[1]).toBe('jest');
                expect(args).toContain('--coverage');
            } finally {
                fs.rmSync(emptyRoot, { recursive: true, force: true });
            }
        });
    });
});
