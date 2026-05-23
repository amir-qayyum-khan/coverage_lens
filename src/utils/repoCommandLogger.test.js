const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    getLogsDirectory,
    getRepoLogFilePath,
    isInsideAppAsar,
    classifyCommandError,
    beginRepoLogSession,
    logRepoCommand,
    maskCommandLine,
    truncateLogTail,
    JEST_LOG_TAIL_BYTES
} = require('./repoCommandLogger');

describe('repoCommandLogger', () => {
    let logsDir;
    const prevLogsDir = process.env.CODE_ANALYZER_LOGS_DIR;

    beforeEach(() => {
        logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-logs-'));
        process.env.CODE_ANALYZER_LOGS_DIR = logsDir;
    });

    afterEach(() => {
        if (prevLogsDir === undefined) {
            delete process.env.CODE_ANALYZER_LOGS_DIR;
        } else {
            process.env.CODE_ANALYZER_LOGS_DIR = prevLogsDir;
        }
        try {
            fs.rmSync(logsDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    test('creates new log file on first write', () => {
        logRepoCommand({
            repoName: 'TrapezeDRTCoreUI',
            commandType: 'git',
            command: 'git fetch origin',
            cwd: 'D:/unittest/TrapezeDRTCoreUI',
            success: true,
            exitCode: 0,
            stdout: 'ok',
            stderr: ''
        });

        const logPath = getRepoLogFilePath('TrapezeDRTCoreUI');
        expect(fs.existsSync(logPath)).toBe(true);
        const content = fs.readFileSync(logPath, 'utf8');
        expect(content).toContain('git fetch origin');
        expect(content).toContain('Error type: NONE');
    });

    test('appends to existing log file', () => {
        logRepoCommand({
            repoName: 'MyRepo',
            commandType: 'git',
            command: 'git status',
            success: true,
            exitCode: 0
        });
        logRepoCommand({
            repoName: 'MyRepo',
            commandType: 'npm',
            command: 'npm install',
            success: false,
            exitCode: 1,
            stderr: 'npm ERR! code ELIFECYCLE'
        });

        const content = fs.readFileSync(getRepoLogFilePath('MyRepo'), 'utf8');
        expect(content.match(/git status/g)).toHaveLength(1);
        expect(content).toContain('NPM_INSTALL_FAILED');
        expect((content.match(/-{80}/g) || []).length).toBeGreaterThanOrEqual(2);
    });

    test('beginRepoLogSession writes session header', () => {
        beginRepoLogSession('CoreUI', { operation: 'cloneAndTest', branch: 'develop' });
        const content = fs.readFileSync(getRepoLogFilePath('CoreUI'), 'utf8');
        expect(content).toContain('SESSION START');
        expect(content).toContain('cloneAndTest');
    });

    test('classifyCommandError detects auth and branch errors', () => {
        expect(classifyCommandError('git', 'Authentication failed', '', 128)).toBe('GIT_AUTH');
        expect(classifyCommandError('git', 'unknown revision or path not in the tree', '', 1)).toBe(
            'GIT_BRANCH'
        );
        expect(classifyCommandError('jest', 'Test Suites: 1 failed, 1 total', '', 1)).toBe(
            'JEST_TEST_FAILURE'
        );
    });

    test('maskCommandLine hides URL passwords', () => {
        const masked = maskCommandLine('git clone https://user:secret@host/repo.git');
        expect(masked).not.toContain('secret');
        expect(masked).toContain('****');
    });

    test('isInsideAppAsar detects packaged archive paths', () => {
        expect(isInsideAppAsar('C:\\app\\resources\\app.asar\\src\\utils')).toBe(true);
        expect(isInsideAppAsar('D:/work/code-analyzer/src/utils')).toBe(false);
    });

    test('getLogsDirectory uses CODE_ANALYZER_LOGS_DIR when set', () => {
        expect(getLogsDirectory()).toBe(path.resolve(logsDir));
    });

    test('truncateLogTail keeps only the end of long text', () => {
        const long = 'x'.repeat(JEST_LOG_TAIL_BYTES + 500);
        const tail = truncateLogTail(long, 100);
        expect(tail).toContain('truncated');
        expect(Buffer.byteLength(tail, 'utf8')).toBeLessThan(200);
    });

    test('jest log entries truncate stdout in repo log file', () => {
        const huge = 'line\n'.repeat(5000);
        logRepoCommand({
            repoName: 'HugeJest',
            commandType: 'jest',
            command: 'node jest.js --coverage',
            success: false,
            exitCode: 1,
            stdout: huge,
            stderr: ''
        });
        const content = fs.readFileSync(getRepoLogFilePath('HugeJest'), 'utf8');
        expect(content).toContain('truncated');
        expect(content.length).toBeLessThan(huge.length);
    });
});
