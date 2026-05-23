const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { mergeCoverageSummaries, mergeCoverageFinal } = require('../utils/istanbulCoverageMerge');
const { getHybridBatchScopes, buildTestPathPattern } = require('../utils/jestBatchScopes');
const {
    parseJestOutput,
    aggregateJestOutputs,
    buildIsolatedCoverageMessage,
    detectIncompleteJestRun
} = require('../utils/jestOutputParser');
const { logRepoCommand, resolveRepoNameFromCwd, truncateLogTail } = require('../utils/repoCommandLogger');

const TEST_FILE_RE = /\.(test|spec)\.(js|jsx)$/i;
const WALK_SKIP_DIRS = ['node_modules', 'coverage', 'coverage_temp', 'dist', 'build', '.git'];
const CHUNK_TAIL_BYTES = 4096;
const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 3;

/**
 * Prefer Node 18 from nvm4w on Windows (Trapeze Jest suites target Node 18).
 * @returns {string}
 */
function resolveNodeExecutable() {
    if (process.platform === 'win32') {
        const nvmNode = path.join(process.env.NVM_SYMLINK || 'C:\\nvm4w\\nodejs', 'node.exe');
        if (fs.existsSync(nvmNode)) {
            return nvmNode;
        }
    }
    return 'node';
}

/**
 * Find all test files recursively under a directory.
 * @param {string} dir
 * @param {string} [scopeRel] - Optional path prefix relative to dir (batch scope)
 * @returns {string[]} Absolute paths
 */
function findTestFiles(dir, scopeRel = '') {
    const root = scopeRel ? path.join(dir, scopeRel.split('/').join(path.sep)) : dir;
    if (!fs.existsSync(root)) {
        return [];
    }

    const files = [];

    function walk(currentDir) {
        try {
            const items = fs.readdirSync(currentDir);
            for (const item of items) {
                const fullPath = path.join(currentDir, item);
                const stat = fs.statSync(fullPath);

                if (stat.isDirectory()) {
                    if (!WALK_SKIP_DIRS.includes(item)) {
                        walk(fullPath);
                    }
                } else if (stat.isFile() && TEST_FILE_RE.test(item)) {
                    files.push(fullPath);
                }
            }
        } catch {
            // skip unreadable dirs
        }
    }

    walk(root);
    return files;
}

/**
 * Sanitize a relative test path for use as a coverage_temp subdirectory name.
 * @param {string} relPath
 * @returns {string}
 */
function sanitizeCoverageTempKey(relPath) {
    return String(relPath || 'root')
        .replace(/\\/g, '_')
        .replace(/[/:]/g, '_')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 180);
}

/**
 * Resolve Jest binary invocation (local binary, node jest.js on Windows, or npx).
 * @param {string} projectRoot
 * @returns {{ jestBinPath: string, useNodeToExecute: boolean }}
 */
function resolveJestBinary(projectRoot) {
    let jestBinPath = path.join(projectRoot, 'node_modules', '.bin', 'jest');
    let useNodeToExecute = false;
    const jestJs = path.join(projectRoot, 'node_modules', 'jest', 'bin', 'jest.js');

    if (process.platform === 'win32') {
        const jestCmd = path.join(projectRoot, 'node_modules', '.bin', 'jest.cmd');
        if (fs.existsSync(jestJs)) {
            jestBinPath = jestJs;
            useNodeToExecute = true;
        } else if (fs.existsSync(jestCmd)) {
            jestBinPath = jestCmd;
        } else if (!fs.existsSync(jestBinPath)) {
            jestBinPath = 'npx';
        }
    } else if (fs.existsSync(jestJs)) {
        jestBinPath = jestJs;
        useNodeToExecute = true;
    } else if (!fs.existsSync(jestBinPath)) {
        jestBinPath = 'npx';
    }

    if (jestBinPath !== 'npx') {
        jestBinPath = jestBinPath.split(path.sep).join('/');
    }

    return { jestBinPath, useNodeToExecute };
}

/**
 * Build Jest CLI args for full, batch, or per-file coverage runs.
 * @param {object} opts
 * @returns {{ command: string, args: string[], commandLine: string }}
 */
function buildJestSpawn(opts) {
    const {
        projectRoot,
        configPath,
        coverageDir,
        mode = 'per-file',
        testRelPath = null,
        testPathPattern = null
    } = opts;

    const { jestBinPath, useNodeToExecute } = resolveJestBinary(projectRoot);
    const baseName = path.basename(configPath);
    const normalizedConfig = baseName === 'jest.config.js'
        ? 'jest.config.js'
        : configPath.split(path.sep).join('/');
    const normalizedCoverageDir = coverageDir.split(path.sep).join('/');

    const jestArgs = [
        `--config=${normalizedConfig}`,
        '--coverage',
        `--coverageDirectory=${normalizedCoverageDir}`,
        '--coverageReporters=json-summary',
        '--coverageReporters=json',
        '--passWithNoTests',
        '--forceExit',
        '--silent'
    ];

    if (mode === 'full') {
        jestArgs.push('--maxWorkers=50%');
    } else if (mode === 'batch') {
        jestArgs.push('--maxWorkers=50%');
        if (testPathPattern) {
            jestArgs.push(`--testPathPattern=${testPathPattern}`);
        }
    } else {
        jestArgs.push('--runInBand');
        if (testRelPath) {
            jestArgs.push(testRelPath.split(path.sep).join('/'));
        }
    }

    let command;
    let args;
    if (useNodeToExecute) {
        command = resolveNodeExecutable();
        args = [jestBinPath, ...jestArgs];
    } else if (jestBinPath === 'npx') {
        command = 'npx';
        args = ['--yes', 'jest', ...jestArgs];
    } else {
        command = jestBinPath;
        args = jestArgs;
    }

    return {
        command,
        args,
        commandLine: `${command} ${args.join(' ')}`
    };
}

/** @deprecated Use buildJestSpawn */
function buildIsolatedJestSpawn(projectRoot, configPath, coverageDir, testRelPath) {
    return buildJestSpawn({
        projectRoot,
        configPath,
        coverageDir,
        mode: 'per-file',
        testRelPath
    });
}

/**
 * Incrementally merge istanbul outputs to limit memory use.
 */
class CoverageAccumulator {
    constructor() {
        this.mergedSummary = null;
        this.mergedDetailed = {};
    }

    /**
     * @param {string} coverageDir
     * @returns {boolean}
     */
    addFromDir(coverageDir) {
        const summaryPath = path.join(coverageDir, 'coverage-summary.json');
        const finalPath = path.join(coverageDir, 'coverage-final.json');
        let added = false;

        if (fs.existsSync(summaryPath)) {
            try {
                const part = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
                this.mergedSummary = this.mergedSummary
                    ? mergeCoverageSummaries([this.mergedSummary, part])
                    : part;
                added = true;
            } catch (err) {
                console.warn('[jestResilientCoverage] Failed to read coverage-summary:', err.message);
            }
        }

        if (fs.existsSync(finalPath)) {
            try {
                const part = JSON.parse(fs.readFileSync(finalPath, 'utf8'));
                this.mergedDetailed = mergeCoverageFinal([this.mergedDetailed, part]);
            } catch (err) {
                console.warn('[jestResilientCoverage] Failed to read coverage-final:', err.message);
            }
        }

        return added;
    }

    hasCoverage() {
        return Boolean(this.mergedSummary?.total);
    }
}

/**
 * Run tasks with limited concurrency.
 * @template T
 * @param {Array<() => Promise<T>>} tasks
 * @param {number} concurrency
 * @returns {Promise<T[]>}
 */
async function runWithConcurrency(tasks, concurrency) {
    const results = new Array(tasks.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < tasks.length) {
            const i = nextIndex;
            nextIndex += 1;
            results[i] = await tasks[i]();
        }
    }

    const workers = Array.from(
        { length: Math.min(concurrency, tasks.length) },
        () => worker()
    );
    await Promise.all(workers);
    return results;
}

/**
 * Spawn Jest once; cap captured output for memory safety.
 * @param {object} opts
 * @returns {Promise<{ code: number, stdoutTail: string, stderrTail: string, coverageDir: string, commandLine: string }>}
 */
function runJestSpawn(opts) {
    const {
        projectRoot,
        configPath,
        coverageDir,
        mode,
        testRelPath,
        testPathPattern,
        logRepoName
    } = opts;

    const { command, args, commandLine } = buildJestSpawn({
        projectRoot,
        configPath,
        coverageDir,
        mode,
        testRelPath,
        testPathPattern
    });
    const startedAt = Date.now();

    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd: projectRoot,
            shell: true,
            env: {
                ...process.env,
                CI: 'true',
                NODE_OPTIONS: '--max-old-space-size=8192'
            }
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
            if (Buffer.byteLength(stdout, 'utf8') > CHUNK_TAIL_BYTES * 2) {
                stdout = truncateLogTail(stdout, CHUNK_TAIL_BYTES);
            }
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
            if (Buffer.byteLength(stderr, 'utf8') > CHUNK_TAIL_BYTES * 2) {
                stderr = truncateLogTail(stderr, CHUNK_TAIL_BYTES);
            }
        });

        const finish = (code, signal) => {
            const stdoutTail = truncateLogTail(stdout, CHUNK_TAIL_BYTES);
            const stderrTail = truncateLogTail(
                signal ? `${stderr}\n[signal] ${signal}` : stderr,
                CHUNK_TAIL_BYTES
            );
            logRepoCommand({
                repoName: logRepoName,
                commandType: 'jest',
                command: commandLine,
                cwd: projectRoot,
                success: code === 0,
                exitCode: code,
                stdout,
                stderr: signal ? `${stderr}\n[signal] ${signal}` : stderr,
                durationMs: Date.now() - startedAt
            });
            resolve({
                code: code ?? -1,
                stdoutTail,
                stderrTail,
                coverageDir,
                commandLine
            });
        };

        child.on('close', (code, signal) => finish(code, signal));

        child.on('error', (error) => {
            logRepoCommand({
                repoName: logRepoName,
                commandType: 'jest',
                command: commandLine,
                cwd: projectRoot,
                success: false,
                exitCode: null,
                stdout,
                stderr,
                spawnError: error.message,
                durationMs: Date.now() - startedAt
            });
            resolve({
                code: -1,
                stdoutTail: truncateLogTail(stdout, CHUNK_TAIL_BYTES),
                stderrTail: error.message,
                coverageDir,
                commandLine
            });
        });
    });
}

/**
 * @param {string} stdoutTail
 * @param {string} stderrTail
 * @returns {{ incompleteRun: boolean, parsed: object }}
 */
function analyzeRunOutput(stdoutTail, stderrTail) {
    const combined = `${stdoutTail}\n${stderrTail}`;
    const parsed = parseJestOutput(combined);
    const hasSummaryLine = /Tests:\s+/i.test(combined) || /Test Suites:\s+/i.test(combined);
    const incompleteRun = detectIncompleteJestRun(combined, hasSummaryLine);
    return { incompleteRun, parsed };
}

/**
 * @param {string} jestRoot
 * @param {string} finalCoverageDir
 */
function prepareCoverageDirectories(jestRoot, finalCoverageDir) {
    const tempRoot = path.join(jestRoot, 'coverage_temp');
    if (fs.existsSync(tempRoot)) {
        try {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        } catch {
            // ignore
        }
    }
    fs.mkdirSync(tempRoot, { recursive: true });

    if (fs.existsSync(finalCoverageDir)) {
        for (const name of ['coverage-summary.json', 'coverage-final.json', 'jest-execution.log']) {
            const full = path.join(finalCoverageDir, name);
            if (fs.existsSync(full)) {
                try {
                    fs.unlinkSync(full);
                } catch {
                    // ignore
                }
            }
        }
    } else {
        fs.mkdirSync(finalCoverageDir, { recursive: true });
    }
}

/**
 * Append a capped run section to jest-execution.log.
 * @param {string} logPath
 * @param {string} label
 * @param {string} stdoutTail
 * @param {string} stderrTail
 * @param {number} exitCode
 */
function appendExecutionLogChunk(logPath, label, stdoutTail, stderrTail, exitCode) {
    const chunk = [
        `\n=== ${label} (exit ${exitCode}) ===\n`,
        '--- stdout (tail) ---\n',
        stdoutTail || '(empty)',
        '\n--- stderr (tail) ---\n',
        stderrTail || '(empty)',
        '\n'
    ].join('');
    try {
        fs.appendFileSync(logPath, chunk, 'utf8');
    } catch (err) {
        console.warn('[jestResilientCoverage] Failed to append jest-execution.log:', err.message);
    }
}

/**
 * Hybrid resilient coverage: full project → folder batches → per-file for failed batches.
 * @param {object} opts
 * @returns {Promise<object>}
 */
async function runResilientJestCoverage(opts) {
    const {
        jestRoot,
        jestConfigPath,
        sendProgress = () => {},
        logRepoName = resolveRepoNameFromCwd(jestRoot),
        finalCoverageDir = path.join(jestRoot, 'coverage'),
        concurrency = DEFAULT_CONCURRENCY,
        targetAnalysisPath = jestRoot,
        sourceFileCount = 9999
    } = opts;

    prepareCoverageDirectories(jestRoot, finalCoverageDir);

    const executionLogPath = path.join(finalCoverageDir, 'jest-execution.log');
    fs.writeFileSync(executionLogPath, `Jest hybrid coverage started ${new Date().toISOString()}\n`, 'utf8');

    const accumulator = new CoverageAccumulator();
    const runRecords = [];
    const failedTestFiles = [];
    const failedBatches = [];
    let lastCommandPreview = '';
    let phasesUsed = [];
    const poolSize = Math.min(MAX_CONCURRENCY, Math.max(1, concurrency));

    // --- Phase 1: full-project run ---
    sendProgress('testing', 'Running full-project Jest coverage...', 90);
    const fullCoverageDir = path.join(jestRoot, 'coverage_temp', 'full');
    fs.mkdirSync(fullCoverageDir, { recursive: true });

    const fullResult = await runJestSpawn({
        projectRoot: jestRoot,
        configPath: jestConfigPath,
        coverageDir: fullCoverageDir,
        mode: 'full',
        logRepoName
    });
    lastCommandPreview = fullResult.commandLine;
    appendExecutionLogChunk(
        executionLogPath,
        'full-project',
        fullResult.stdoutTail,
        fullResult.stderrTail,
        fullResult.code
    );

    const fullAnalysis = analyzeRunOutput(fullResult.stdoutTail, fullResult.stderrTail);
    const fullHadSummary = accumulator.addFromDir(fullCoverageDir);
    runRecords.push({
        exitCode: fullResult.code,
        hadCoverageSummary: fullHadSummary,
        output: `${fullResult.stdoutTail}\n${fullResult.stderrTail}`
    });

    if (fullHadSummary && !fullAnalysis.incompleteRun) {
        phasesUsed = ['full'];
        sendProgress('testing', 'Full-project coverage collected.', 98);
    } else {
        phasesUsed.push('full-fallback');

        // --- Phase 2: folder batches (parallel) ---
        const batchScopes = getHybridBatchScopes(jestRoot);

        sendProgress(
            'testing',
            `Full run incomplete — running ${batchScopes.length} folder batch(es)...`,
            91
        );

        const batchTasks = batchScopes.map((scope, index) => async () => {
            const scopeLabel = scope || '<project>';
            const tempKey = sanitizeCoverageTempKey(scopeLabel || 'root');
            const coverageDir = path.join(jestRoot, 'coverage_temp', `batch_${tempKey}`);
            fs.mkdirSync(coverageDir, { recursive: true });

            sendProgress(
                'testing',
                `Batch ${index + 1}/${batchScopes.length}: ${scopeLabel}`,
                91 + Math.floor((index / batchScopes.length) * 5)
            );

            const pattern = buildTestPathPattern(scope);
            const result = await runJestSpawn({
                projectRoot: jestRoot,
                configPath: jestConfigPath,
                coverageDir,
                mode: 'batch',
                testPathPattern: pattern,
                logRepoName
            });

            appendExecutionLogChunk(
                executionLogPath,
                `batch ${scopeLabel}`,
                result.stdoutTail,
                result.stderrTail,
                result.code
            );

            const analysis = analyzeRunOutput(result.stdoutTail, result.stderrTail);
            const hadSummary = fs.existsSync(path.join(coverageDir, 'coverage-summary.json'));

            return {
                scope: scopeLabel,
                scopeRaw: scope,
                result,
                hadSummary,
                incompleteRun: analysis.incompleteRun,
                analysis
            };
        });

        const batchResults = batchScopes.length > 0
            ? await runWithConcurrency(batchTasks, poolSize)
            : [];

        for (const br of batchResults) {
            lastCommandPreview = br.result.commandLine;
            const hadCoverage = accumulator.addFromDir(br.result.coverageDir);
            runRecords.push({
                exitCode: br.result.code,
                hadCoverageSummary: hadCoverage,
                output: `${br.result.stdoutTail}\n${br.result.stderrTail}`
            });

            if (!hadCoverage || br.incompleteRun) {
                failedBatches.push(br.scopeRaw);
                failedTestFiles.push({
                    path: br.scope || '<batch>',
                    exitCode: br.result.code,
                    reason: 'no-coverage',
                    batch: true
                });
            } else if (br.result.code !== 0) {
                failedTestFiles.push({
                    path: br.scope,
                    exitCode: br.result.code,
                    reason: 'test-failure',
                    batch: true
                });
            }
        }

        phasesUsed.push('batch');

        // --- Phase 3: per-file only for failed batches ---
        const scopesForPerFile = [...failedBatches];
        if (scopesForPerFile.length > 0) {
            sendProgress(
                'testing',
                `Per-file fallback for ${scopesForPerFile.length} failed batch(es)...`,
                96
            );
            phasesUsed.push('per-file');

            for (const scopeRaw of scopesForPerFile) {
                const scopeRel = (scopeRaw || '').replace(/\\/g, '/');
                const testFiles = findTestFiles(jestRoot, scopeRel).sort();

                const fileTasks = testFiles.map((testAbsPath, fileIndex) => async () => {
                    const relPath = path.relative(jestRoot, testAbsPath).split(path.sep).join('/');
                    const tempKey = sanitizeCoverageTempKey(relPath);
                    const coverageDir = path.join(jestRoot, 'coverage_temp', `file_${tempKey}`);
                    fs.mkdirSync(coverageDir, { recursive: true });

                    const result = await runJestSpawn({
                        projectRoot: jestRoot,
                        configPath: jestConfigPath,
                        coverageDir,
                        mode: 'per-file',
                        testRelPath: relPath,
                        logRepoName
                    });

                    appendExecutionLogChunk(
                        executionLogPath,
                        relPath,
                        result.stdoutTail,
                        result.stderrTail,
                        result.code
                    );

                    const hadSummary = fs.existsSync(path.join(coverageDir, 'coverage-summary.json'));
                    return { relPath, result, hadSummary };
                });

                const fileResults = testFiles.length > 0
                    ? await runWithConcurrency(fileTasks, poolSize)
                    : [];

                for (const fr of fileResults) {
                    lastCommandPreview = fr.result.commandLine;
                    const hadCoverage = accumulator.addFromDir(fr.result.coverageDir);
                    runRecords.push({
                        exitCode: fr.result.code,
                        hadCoverageSummary: hadCoverage,
                        output: `${fr.result.stdoutTail}\n${fr.result.stderrTail}`
                    });

                    const existing = failedTestFiles.find((f) => f.path === fr.relPath && f.batch);
                    if (!hadCoverage) {
                        if (!existing) {
                            failedTestFiles.push({
                                path: fr.relPath,
                                exitCode: fr.result.code,
                                reason: 'no-coverage'
                            });
                        }
                    } else if (fr.result.code !== 0) {
                        if (!existing) {
                            failedTestFiles.push({
                                path: fr.relPath,
                                exitCode: fr.result.code,
                                reason: 'test-failure'
                            });
                        }
                    } else if (existing) {
                        const idx = failedTestFiles.indexOf(existing);
                        failedTestFiles.splice(idx, 1);
                    }
                }
            }
        }
    }

    const hasCoverage = accumulator.hasCoverage();
    const fullSummary = accumulator.mergedSummary;
    const detailed = accumulator.mergedDetailed;

    if (hasCoverage && fullSummary) {
        try {
            fs.writeFileSync(
                path.join(finalCoverageDir, 'coverage-summary.json'),
                JSON.stringify(fullSummary, null, 2),
                'utf8'
            );
            fs.writeFileSync(
                path.join(finalCoverageDir, 'coverage-final.json'),
                JSON.stringify(detailed, null, 2),
                'utf8'
            );
        } catch (err) {
            console.warn('[jestResilientCoverage] Failed to write merged coverage:', err.message);
        }
    }

    const totalTestFiles = findTestFiles(jestRoot).length;
    const passedFiles = runRecords.filter((r) => r.hadCoverageSummary).length;
    const coverageFailedCount = failedTestFiles.filter((f) => f.reason === 'no-coverage').length;
    const jestStats = aggregateJestOutputs(runRecords);
    const executionMode = phasesUsed.includes('full') && phasesUsed.length === 1
        ? 'full'
        : phasesUsed.includes('per-file')
            ? 'hybrid'
            : 'batch';

    const isolatedMessage = buildIsolatedCoverageMessage(
        Math.min(passedFiles, totalTestFiles || passedFiles),
        totalTestFiles || passedFiles,
        coverageFailedCount
    );

    const success =
        hasCoverage &&
        coverageFailedCount === 0 &&
        failedTestFiles.length === 0 &&
        !jestStats.incompleteRun;

    return {
        hasCoverage,
        success,
        fullSummary,
        detailed,
        combinedStdout: '',
        combinedStderr: '',
        totalTests: jestStats.totalTests,
        passedTests: jestStats.passedTests,
        failedTests: jestStats.failedTests,
        testSuites: jestStats.testSuites || totalTestFiles,
        passedSuites: jestStats.passedSuites || passedFiles,
        failedSuites: jestStats.failedSuites || failedTestFiles.length,
        incompleteRun: jestStats.incompleteRun,
        failedTestFiles,
        passedTestFiles: passedFiles,
        totalTestFiles: totalTestFiles || passedFiles,
        coverageFailedCount,
        message: isolatedMessage,
        exitCode: failedTestFiles.some((f) => f.reason === 'no-coverage' || f.exitCode !== 0) ? 1 : 0,
        failureSummary: null,
        diagnostics: {
            jestMessage: isolatedMessage,
            coverageExecutionMode: executionMode,
            phasesUsed,
            failedTestFiles,
            passedTestFiles: passedFiles,
            totalTestFiles: totalTestFiles || passedFiles,
            coverageFailedCount,
            incompleteRun: jestStats.incompleteRun,
            jestCommandPreview: lastCommandPreview,
            failedBatches: failedBatches.map((s) => s || '<project>')
        }
    };
}

/**
 * @deprecated Use runResilientJestCoverage
 */
async function runIsolatedJestCoverage(opts) {
    return runResilientJestCoverage(opts);
}

/** @deprecated */
function runJestForTestFile(opts) {
    const testRelPath = path.relative(opts.projectRoot, opts.testAbsPath).split(path.sep).join('/');
    return runJestSpawn({
        projectRoot: opts.projectRoot,
        configPath: opts.configPath,
        coverageDir: opts.coverageDir,
        mode: 'per-file',
        testRelPath,
        logRepoName: opts.logRepoName
    }).then((r) => ({
        code: r.code,
        stdout: r.stdoutTail,
        stderr: r.stderrTail,
        coverageDir: r.coverageDir,
        commandLine: r.commandLine
    }));
}

module.exports = {
    findTestFiles,
    sanitizeCoverageTempKey,
    runResilientJestCoverage,
    runIsolatedJestCoverage,
    runJestForTestFile,
    runJestSpawn,
    buildJestSpawn,
    buildIsolatedJestSpawn,
    resolveJestBinary,
    CoverageAccumulator,
    runWithConcurrency
};
