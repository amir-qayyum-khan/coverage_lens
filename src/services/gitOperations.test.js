const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

jest.mock('./coverageRunner', () => ({
    findJestProjectRoot: jest.fn(),
    findNearestJestConfig: jest.fn(),
    getMissingLines: jest.fn(() => [])
}));

jest.mock('./trapezeJunctionSetup', () => ({
    setupTrapezeUIJunctions: jest.fn().mockResolvedValue({
        success: true,
        skipped: true,
        message: 'skipped',
        profile: null,
        links: [],
        warnings: []
    })
}));

jest.mock('./nodeInstaller', () => ({
    installPackages: jest.fn().mockResolvedValue({ success: true, message: 'ok' })
}));

jest.mock('../utils/repoCommandLogger', () => ({
    beginRepoLogSession: jest.fn(),
    logRepoCommand: jest.fn(),
    resolveRepoNameFromCwd: jest.fn(() => 'TestRepo'),
    maskCommandLine: jest.fn((s) => s)
}));

jest.mock('child_process', () => ({
    spawn: jest.fn()
}));

jest.mock('./jestResilientCoverage', () => ({
    runResilientJestCoverage: jest.fn(),
    findTestFiles: jest.fn(() => [])
}));

const { spawn } = require('child_process');
const { findJestProjectRoot, findNearestJestConfig } = require('./coverageRunner');
const { runResilientJestCoverage } = require('./jestResilientCoverage');
const { setupTrapezeUIJunctions } = require('./trapezeJunctionSetup');
const { beginRepoLogSession } = require('../utils/repoCommandLogger');
const {
    cloneAndTest,
    runTests,
    parseJestOutput,
    mapCoverageSummaryFiles,
    resolveJestSpawn
} = require('./gitOperations');

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

        test('runs isolated Jest coverage and reads merged summary', async () => {
            const jestRoot = path.join(tmpDir, 'packages', 'app');
            fs.mkdirSync(jestRoot, { recursive: true });

            findJestProjectRoot.mockReturnValue(jestRoot);
            findNearestJestConfig.mockReturnValue(null);

            const fullSummary = {
                total: {
                    lines: { pct: 100, covered: 1, total: 1 },
                    statements: { pct: 100, covered: 1, total: 1 },
                    branches: { pct: 100, covered: 1, total: 1 },
                    functions: { pct: 100, covered: 1, total: 1 }
                }
            };

            runResilientJestCoverage.mockResolvedValue({
                success: true,
                hasCoverage: true,
                fullSummary,
                detailed: {},
                message: 'Coverage from 1/1 test file(s)',
                totalTests: 1,
                passedTests: 1,
                failedTests: 0,
                testSuites: 1,
                passedSuites: 1,
                failedSuites: 0,
                incompleteRun: false,
                failedTestFiles: [],
                exitCode: 0,
                diagnostics: { coverageExecutionMode: 'full', phasesUsed: ['full'] }
            });

            const r = await runTests(tmpDir, () => {}, 'feature/x');
            expect(runResilientJestCoverage).toHaveBeenCalled();
            expect(spawn).not.toHaveBeenCalled();
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

    describe('mapCoverageSummaryFiles', () => {
        test('maps relative jest keys to clone-relative paths for CoreUI layout', () => {
            const clonePath = tmpDir;
            const jestRoot = path.join(tmpDir, 'source');
            fs.mkdirSync(jestRoot, { recursive: true });

            const relKey = 'src/components/booking/BookingDetails.js';
            const absFile = path.join(jestRoot, relKey);
            const summary = {
                [relKey]: {
                    lines: { total: 10, covered: 5, pct: 50 },
                    statements: { total: 10, covered: 5, pct: 50 },
                    branches: { total: 0, covered: 0, pct: 100 }
                }
            };

            const files = mapCoverageSummaryFiles(summary, {}, clonePath, jestRoot);
            expect(files).toHaveLength(1);
            expect(files[0].relativePath).toBe('source/src/components/booking/BookingDetails.js');
            expect(files[0].relativePathKey).toBe(
                'source/src/components/booking/bookingdetails.js'
            );
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

    describe('cloneAndTest', () => {
        test('invokes setupTrapezeUIJunctions after checkout and before install', async () => {
            const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-target-'));
            const clonePath = path.join(targetDir, 'TrapezeDRTCoreUI');
            fs.mkdirSync(clonePath, { recursive: true });
            fs.mkdirSync(path.join(clonePath, 'source'), { recursive: true });
            fs.writeFileSync(path.join(clonePath, 'package.json'), '{}');
            fs.writeFileSync(
                path.join(clonePath, 'source', 'package.json'),
                JSON.stringify({ devDependencies: { jest: '^27.0.0' } })
            );
            fs.writeFileSync(path.join(clonePath, 'source', 'jest.config.js'), 'module.exports = {};');

            findJestProjectRoot.mockReturnValue(path.join(clonePath, 'source'));
            spawn.mockImplementation((cmd, args) => {
                if (cmd === 'git') {
                    const proc = new EventEmitter();
                    proc.stdout = new EventEmitter();
                    proc.stderr = new EventEmitter();
                    process.nextTick(() => {
                        if (args[0] === 'remote') {
                            proc.stdout.emit(
                                'data',
                                Buffer.from('https://git.example/Trapeze/TrapezeDRTCoreUI.git')
                            );
                        }
                        proc.emit('close', 0);
                    });
                    return proc;
                }
                return mockJestChild(0, 'Tests: 1 passed, 1 total\n');
            });

            try {
                const progressEvents = [];
                await cloneAndTest(
                    'https://git.example/Trapeze/TrapezeDRTCoreUI.git',
                    targetDir,
                    (p) => progressEvents.push(p),
                    null,
                    'develop',
                    'CoreUI'
                );

                expect(beginRepoLogSession).toHaveBeenCalled();
                expect(setupTrapezeUIJunctions).toHaveBeenCalled();
                const [calledClonePath, opts] = setupTrapezeUIJunctions.mock.calls[0];
                expect(calledClonePath).toBe(clonePath);
                expect(opts.branch).toBe('develop');
                expect(typeof opts.runGitCommand).toBe('function');

                // Skipped junctions must still report linking_deps (not silent)
                expect(
                    progressEvents.some(
                        (e) => e.stage === 'linking_deps' && /skipped/i.test(e.message)
                    )
                ).toBe(true);
            } finally {
                fs.rmSync(targetDir, { recursive: true, force: true });
            }
        });

        test('reports linking_deps when junction setup runs successfully', async () => {
            const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-target-'));
            const clonePath = path.join(targetDir, 'TrapezeDRTYouBookUI');
            fs.mkdirSync(clonePath, { recursive: true });
            fs.writeFileSync(path.join(clonePath, 'package.json'), '{}');
            findJestProjectRoot.mockReturnValue(clonePath);
            setupTrapezeUIJunctions.mockResolvedValueOnce({
                success: true,
                skipped: false,
                message: 'Junctions ready',
                profile: 'standard',
                links: [{ success: true }, { success: true }],
                warnings: []
            });

            spawn.mockImplementation((cmd, args) => {
                if (cmd === 'git') {
                    const proc = new EventEmitter();
                    proc.stdout = new EventEmitter();
                    proc.stderr = new EventEmitter();
                    process.nextTick(() => {
                        if (args[0] === 'remote') {
                            proc.stdout.emit(
                                'data',
                                Buffer.from('https://git.example/Trapeze/TrapezeDRTYouBookUI.git')
                            );
                        }
                        proc.emit('close', 0);
                    });
                    return proc;
                }
                return mockJestChild(0, 'Tests: 1 passed, 1 total\n');
            });

            try {
                const progressEvents = [];
                await cloneAndTest(
                    'https://git.example/Trapeze/TrapezeDRTYouBookUI.git',
                    targetDir,
                    (p) => progressEvents.push(p),
                    null,
                    'develop',
                    'YouBookUI'
                );

                expect(setupTrapezeUIJunctions).toHaveBeenCalled();
                expect(
                    progressEvents.some(
                        (e) => e.stage === 'linking_deps' && e.message === 'Junctions ready'
                    )
                ).toBe(true);
            } finally {
                fs.rmSync(targetDir, { recursive: true, force: true });
            }
        });
    });
});
