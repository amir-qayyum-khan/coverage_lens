const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { writeSuperDashboardJestSummary } = require('./superDashboardPersist');
const { runResilientJestCoverage } = require('./jestResilientCoverage');
const { getBatchScopes, buildTestPathPattern, escapeForJestTestPathPattern } = require('../utils/jestBatchScopes');
const {
    mergeCoverageSummaries,
    mergeCoverageFinal,
    pickBetterCoverageSummaryEntry
} = require('../utils/istanbulCoverageMerge');
const { isFileUnderFolder, toDisplayRelativePath } = require('../utils/coveragePaths');
const { normalizeRelativeKey, canonicalPathKey } = require('../utils/coverageMerge');
const { logRepoCommand, resolveRepoNameFromCwd } = require('../utils/repoCommandLogger');
const {
    parseJestOutput,
    extractJestFailures,
    deduplicateJestFailures,
    buildFailureSummary,
    formatJestExecutionLog
} = require('../utils/jestOutputParser');
const {
    resolveTargetAnalysisPath,
    resolveJestCoverageScope
} = require('../utils/sourceRoot');

const JEST_CONFIG_FILENAMES = ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs'];

/**
 * Find the nearest package.json starting from the given path and moving up
 * @param {string} startPath - Path to start searching from
 * @returns {string|null} - Path to the directory containing package.json or null
 */
function findNearestPackageRoot(startPath) {
    let current = startPath;
    while (current !== path.parse(current).root) {
        if (fs.existsSync(path.join(current, 'package.json'))) {
            return current;
        }
        current = path.dirname(current);
    }
    return null;
}

/**
 * Find the nearest jest.config.js starting from the given path and moving up
 * @param {string} startPath - Path to start searching from
 * @returns {string|null} - Full path to jest.config.js or null
 */
function findNearestJestConfig(startPath) {
    let current = startPath;

    while (current !== path.parse(current).root) {
        for (const name of JEST_CONFIG_FILENAMES) {
            const fullPath = path.join(current, name);
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        }
        current = path.dirname(current);
    }
    return null;
}

/**
 * Search downward from startPath to find a directory containing both package.json and jest.config.js
 * @param {string} startPath - Path to start searching from
 * @returns {string|null} - Path to the directory containing both files, or null
 */
function findTestRoot(startPath) {
    const skipDirs = ['node_modules', '.git', 'dist', 'build', 'coverage', 'coverage_temp'];

    function hasBothFiles(dirPath) {
        const hasPackageJson = fs.existsSync(path.join(dirPath, 'package.json'));
        if (!hasPackageJson) return false;
        return JEST_CONFIG_FILENAMES.some((name) => fs.existsSync(path.join(dirPath, name)));
    }

    if (hasBothFiles(startPath)) {
        return startPath;
    }

    function searchDown(dirPath) {
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            const subDirs = [];

            for (const entry of entries) {
                if (!entry.isDirectory() || skipDirs.includes(entry.name)) continue;

                const fullPath = path.join(dirPath, entry.name);
                if (hasBothFiles(fullPath)) {
                    return fullPath;
                }
                subDirs.push(fullPath);
            }

            for (const subDir of subDirs) {
                const result = searchDown(subDir);
                if (result) return result;
            }
        } catch (err) {
            console.warn(`[CoverageRunner] Error searching directory ${dirPath}:`, err.message);
        }
        return null;
    }

    return searchDown(startPath);
}

function hasJestConfigFileInDir(dirPath) {
    return JEST_CONFIG_FILENAMES.some((name) => fs.existsSync(path.join(dirPath, name)));
}

/**
 * True when package.json lists Jest as a dependency or defines a "jest" config block (e.g. CRA).
 * @param {string} dirPath
 * @returns {boolean}
 */
function packageJsonDeclaresJest(dirPath) {
    const pkgPath = path.join(dirPath, 'package.json');
    if (!fs.existsSync(pkgPath)) return false;
    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.jest != null && typeof pkg.jest === 'object') return true;
        return !!(pkg.devDependencies?.jest || pkg.dependencies?.jest);
    } catch {
        return false;
    }
}

/**
 * Directory that can run `jest` (package.json plus jest config file and/or Jest in package.json).
 * @param {string} dirPath
 * @returns {boolean}
 */
function isJestProjectDirectory(dirPath) {
    if (!fs.existsSync(path.join(dirPath, 'package.json'))) return false;
    return hasJestConfigFileInDir(dirPath) || packageJsonDeclaresJest(dirPath);
}

/**
 * Like findTestRoot but also matches projects that only declare Jest in package.json (no jest.config.*).
 * @param {string} startPath - Repository or folder root (e.g. clone path)
 * @returns {string|null}
 */
function findJestProjectRoot(startPath) {
    const strict = findTestRoot(startPath);
    if (strict) return strict;

    const skipDirs = ['node_modules', '.git', 'dist', 'build', 'coverage', 'coverage_temp'];

    if (isJestProjectDirectory(startPath)) {
        return startPath;
    }

    function searchDown(dirPath) {
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            const subDirs = [];

            for (const entry of entries) {
                if (!entry.isDirectory() || skipDirs.includes(entry.name)) continue;

                const fullPath = path.join(dirPath, entry.name);
                if (isJestProjectDirectory(fullPath)) {
                    return fullPath;
                }
                subDirs.push(fullPath);
            }

            for (const subDir of subDirs) {
                const found = searchDown(subDir);
                if (found) return found;
            }
        } catch (err) {
            console.warn(`[CoverageRunner] findJestProjectRoot search error ${dirPath}:`, err.message);
        }
        return null;
    }

    return searchDown(startPath);
}

/**
 * Get all source (non-test) JavaScript files in a folder recursively
 * @param {string} folderPath - Path to search for files
 * @returns {string[]} - Array of absolute file paths
 */
function getSourceFilesInFolder(folderPath) {
    const files = [];

    function walk(dir) {
        try {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stat = fs.statSync(fullPath);

                if (stat.isDirectory()) {
                    const ignoreFolders = ['node_modules', '__tests__', '__test__', 'coverage', 'dist', 'build', 'i18n', '.git', 'public', 'assets', '__mocks__', 'config', 'coverage-booking-folder', 'lcov-report'];
                    if (!ignoreFolders.includes(item)) {
                        walk(fullPath);
                    }
                } else if (stat.isFile() && (item.endsWith('.js') || item.endsWith('.jsx'))) {
                    const ignoreFiles = ['setupTests.js', 'postBuild.js', 'babelDev.js', 'babelProd.js', 'preStart.js', 'babel.prod.js', 'babel.dev.js', 'WeStore.js', 'version.js', 'store.js'];
                    const isConfig = item.startsWith('webpack.') || item.startsWith('babel.config.') || item.startsWith('jest.config.') || item === '.babelrc' || item.startsWith('.eslintrc');
                    if (!item.endsWith('.test.js') && !item.endsWith('.spec.js') && !item.endsWith('.test.jsx') && !item.endsWith('.spec.jsx') && !item.endsWith('.tests.js') && !item.endsWith('.tests.jsx') && !ignoreFiles.includes(item) && !isConfig) {
                        files.push(fullPath);
                    }
                }
            }
        } catch (err) {
            console.warn(`[CoverageRunner] Error reading directory ${dir}:`, err.message);
        }
    }

    walk(folderPath);
    return files;
}

/**
 * Coverage execution plan — hybrid full → batch → per-file fallback.
 * @returns {{ scopes: string[], mode: string }}
 */
function resolveCoverageExecutionPlan() {
    return {
        scopes: [],
        mode: 'hybrid'
    };
}

/**
 * Resolve local Jest binary for spawning.
 * @param {string} projectRoot
 * @returns {{ command: string, argsPrefix: string[], useNodeToExecute: boolean, jestBinPath: string }}
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
 * Build Jest CLI args aligned with direct coverage command behavior.
 * @param {string} configPath
 * @param {string} coverageDir
 * @returns {{ jestArgs: string[], testPathPattern: string|null }}
 */
function buildJestArgs(configPath, coverageDir) {
    const baseName = path.basename(configPath);
    const normalizedConfigPath = baseName === 'jest.config.js'
        ? 'jest.config.js'
        : configPath.split(path.sep).join('/');
    const normalizedCoverageDir = coverageDir.split(path.sep).join('/');

    const jestArgs = [
        `--config=${normalizedConfigPath}`,
        '--coverage',
        `--coverageDirectory=${normalizedCoverageDir}`,
        '--coverageReporters=json-summary',
        '--coverageReporters=json',
        '--coverageReporters=text',
        '--passWithNoTests',
        '--forceExit',
        '--maxWorkers=50%',
        '--detectOpenHandles'
    ];

    return { jestArgs, testPathPattern: null };
}

/**
 * Write jest-execution.log with deduplicated failure summary at the top.
 * @param {{ coverageDir: string, code?: number|null, signal?: string|null, errorMessage?: string, stdout?: string, stderr?: string }} params
 */
function writeJestExecutionLog({ coverageDir, code = null, signal = null, errorMessage = '', stdout = '', stderr = '' }) {
    const logPath = path.join(coverageDir, 'jest-execution.log');
    const body = formatJestExecutionLog({ code, signal, errorMessage, stdout, stderr });
    fs.writeFileSync(logPath, body, 'utf8');
    console.log(`[CoverageRunner] Saved jest logs to ${logPath}`);
}

/**
 * Build failure summary diagnostics from combined Jest output.
 * @param {string} combinedOutput
 * @returns {{ uniqueReasonCount: number, groups: object[] }|null}
 */
function buildJestFailureDiagnostics(combinedOutput) {
    const deduped = deduplicateJestFailures(extractJestFailures(combinedOutput));
    if (deduped.length === 0) return null;
    return buildFailureSummary(deduped);
}

/**
 * Run Jest once for a coverage scope.
 * @param {object} opts
 * @returns {Promise<{ code: number, stdout: string, stderr: string, coverageDir: string }>}
 */
function runJestOnce(opts) {
    const {
        projectRoot,
        scopeRelativeToRoot
    } = opts;

    const scope = (scopeRelativeToRoot || '').replace(/\\/g, '/');
    const coverageDir = path.join(
        projectRoot,
        'coverage_temp',
        scope ? scope.replace(/\//g, '_') : 'root'
    );

    if (fs.existsSync(coverageDir)) {
        try {
            fs.rmSync(coverageDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    }
    fs.mkdirSync(coverageDir, { recursive: true });

    const configPath = findNearestJestConfig(projectRoot) || path.join(projectRoot, 'jest.config.js');
    const { jestBinPath, useNodeToExecute } = resolveJestBinary(projectRoot);
    const { jestArgs, testPathPattern } = buildJestArgs(configPath, coverageDir);

    const command = useNodeToExecute ? 'node' : jestBinPath;
    const spawnArgs = useNodeToExecute
        ? [jestBinPath, ...jestArgs]
        : jestBinPath === 'npx'
            ? ['jest', ...jestArgs]
            : jestArgs;

    const jestCommandLine = `${command} ${spawnArgs.join(' ')}`;
    const jestCommandPreview = jestCommandLine.slice(0, 200);
    const logRepoName = resolveRepoNameFromCwd(projectRoot);
    const jestStartedAt = Date.now();

    console.log(`[CoverageRunner] Executing: ${jestCommandLine}`);

    return new Promise((resolve) => {
        const jest = spawn(command, spawnArgs, {
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

        jest.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        jest.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        jest.on('close', (code, signal) => {
            logRepoCommand({
                repoName: logRepoName,
                commandType: 'jest',
                command: jestCommandLine,
                cwd: projectRoot,
                success: code === 0,
                exitCode: code,
                stdout,
                stderr: signal ? `${stderr}\n[signal] ${signal}` : stderr,
                durationMs: Date.now() - jestStartedAt
            });

            try {
                writeJestExecutionLog({
                    coverageDir,
                    code,
                    signal,
                    stdout,
                    stderr
                });
            } catch (err) {
                console.warn(`[CoverageRunner] Failed to write jest-execution.log: ${err.message}`);
            }
            console.log(`[CoverageRunner] Scope "${scope}" exited code=${code} signal=${signal}`);
            resolve({
                code,
                stdout,
                stderr,
                coverageDir,
                testPathPattern,
                jestCommandPreview
            });
        });

        jest.on('error', (error) => {
            logRepoCommand({
                repoName: logRepoName,
                commandType: 'jest',
                command: jestCommandLine,
                cwd: projectRoot,
                success: false,
                exitCode: null,
                stdout,
                stderr,
                spawnError: error.message,
                durationMs: Date.now() - jestStartedAt
            });

            try {
                writeJestExecutionLog({
                    coverageDir,
                    errorMessage: error.message,
                    stdout,
                    stderr
                });
            } catch (err) {
                console.warn(`[CoverageRunner] Failed to write jest-execution.log: ${err.message}`);
            }
            resolve({
                code: -1,
                stdout,
                stderr: error.message,
                coverageDir,
                testPathPattern,
                jestCommandPreview
            });
        });
    });
}

/**
 * Parse Jest coverage output into app file list + summary.
 * @param {object} fullSummary - Merged coverage-summary
 * @param {object} detailed - Merged coverage-final
 * @param {string} folderPath - User-selected folder
 * @param {string} projectRoot - Jest project root
 * @returns {{ files: object[], summary: object, diagnostics: object }}
 */
function parseCoverageResults(fullSummary, detailed, folderPath, projectRoot) {
    const files = [];
    const coverageKeys = Object.keys(fullSummary).filter((k) => k !== 'total');
    const skippedKeys = [];

    for (const [filePath, fileData] of Object.entries(fullSummary)) {
        if (filePath === 'total') continue;

        if (!isFileUnderFolder(folderPath, filePath, projectRoot)) {
            skippedKeys.push(filePath);
            continue;
        }

        const relativePath = toDisplayRelativePath(folderPath, filePath, projectRoot);
        const entry = {
            filePath,
            relativePath,
            relativePathKey: normalizeRelativeKey(relativePath),
            fileName: path.basename(filePath),
            lines: fileData.lines,
            statements: fileData.statements,
            missingLines: []
        };

        const detailedKey = Object.keys(detailed).find(
            (k) =>
                k === filePath ||
                canonicalPathKey(k) === canonicalPathKey(filePath) ||
                normalizeRelativeKey(k) === normalizeRelativeKey(filePath)
        );
        if (detailedKey && detailed[detailedKey]) {
            entry.missingLines = getMissingLines(detailed[detailedKey]);
        }

        files.push(entry);
    }

    return {
        files,
        summary: fullSummary.total,
        diagnostics: {
            jestCoverageKeyCount: coverageKeys.length,
            matchedFileCount: files.length,
            skippedKeyCount: skippedKeys.length,
            sampleSkippedKeys: skippedKeys.slice(0, 5)
        }
    };
}

/**
 * Ensure npm dependencies are installed at project root.
 * @param {string} projectRoot
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function ensureNodeModules(projectRoot) {
    const nodeModulesPath = path.join(projectRoot, 'node_modules');
    if (fs.existsSync(nodeModulesPath)) {
        return { ok: true };
    }

    console.log(`[CoverageRunner] node_modules not found, running npm install --legacy-peer-deps...`);
    const { spawnSync } = require('child_process');
    const installResult = spawnSync('npm', ['install', '--legacy-peer-deps'], {
        cwd: projectRoot,
        shell: true,
        stdio: 'inherit',
        env: { ...process.env }
    });

    if (installResult.status !== 0) {
        return { ok: false, error: 'npm install --legacy-peer-deps failed. Check the project for dependency issues.' };
    }
    return { ok: true };
}

/**
 * Resolve Trapeze UI clone root from a Jest package root (e.g. …/TrapezeDRTCoreUI/source).
 * @param {string} projectRoot
 * @returns {string}
 */
function resolveTrapezeCloneRoot(projectRoot) {
    if (path.basename(projectRoot) === 'source') {
        return path.dirname(projectRoot);
    }
    return projectRoot;
}

/**
 * Read active git branch for a clone.
 * @param {string} cloneRoot
 * @param {function} runGitCommand
 * @returns {Promise<string>}
 */
async function readCloneBranch(cloneRoot, runGitCommand) {
    const result = await runGitCommand(
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        cloneRoot,
        30000,
        { repoName: path.basename(cloneRoot) }
    );
    if (result.success && result.stdout) {
        return result.stdout.trim();
    }
    return 'developV2';
}

/**
 * Run Jest with coverage on a folder
 * @param {string} folderPath - Path to the folder containing cases/files to analyze
 * @param {object} [options] - Reserved for future coverage options
 * @returns {Promise<object>} - Coverage results
 */
async function runCoverage(folderPath, options = {}) {
    let projectRoot = findTestRoot(folderPath);

    if (projectRoot) {
        console.log(`[CoverageRunner] Found test root at: ${projectRoot}`);
    } else {
        projectRoot = findNearestPackageRoot(folderPath);
    }

    if (!projectRoot) {
        return {
            success: true,
            hasCoverage: false,
            message: 'No package.json found in or above the selected folder.',
            files: [],
            summary: emptyCoverageSummary(),
            diagnostics: {}
        };
    }

    let junctionSetup = null;
    const cloneRoot = resolveTrapezeCloneRoot(projectRoot);
    const {
        isTrapezeUIClone,
        setupTrapezeUIJunctions
    } = require('./trapezeJunctionSetup');
    const { runGitCommand } = require('./gitOperations');

    if (process.platform === 'win32' && isTrapezeUIClone(cloneRoot)) {
        const uiBranch = await readCloneBranch(cloneRoot, runGitCommand);
        junctionSetup = await setupTrapezeUIJunctions(cloneRoot, {
            branch: uiBranch,
            runGitCommand,
            logRepoName: path.basename(cloneRoot)
        });
        if (junctionSetup.warnings?.length) {
            console.warn('[CoverageRunner] Junction warnings:', junctionSetup.warnings.join('; '));
        }
    }

    const install = await ensureNodeModules(projectRoot);
    if (!install.ok) {
        return {
            success: false,
            hasCoverage: false,
            error: install.error,
            files: [],
            summary: emptyCoverageSummary(),
            diagnostics: {}
        };
    }

    const targetAnalysisPath = resolveTargetAnalysisPath(folderPath, projectRoot);
    const jestCoverageScope = resolveJestCoverageScope(projectRoot, targetAnalysisPath);

    const sourceFiles = getSourceFilesInFolder(targetAnalysisPath);
    const executionPlan = resolveCoverageExecutionPlan(projectRoot, targetAnalysisPath, sourceFiles.length);
    const executionMode = executionPlan.mode;
    const configPath = findNearestJestConfig(projectRoot) || path.join(projectRoot, 'jest.config.js');
    const finalCoverageDir = path.join(projectRoot, 'coverage');

    console.log(`[CoverageRunner] Project root: ${projectRoot}`);
    console.log(`[CoverageRunner] Folder path: ${folderPath}`);
    console.log(`[CoverageRunner] Target: ${targetAnalysisPath} (${sourceFiles.length} source files)`);
    console.log(`[CoverageRunner] Jest coverage scope: ${jestCoverageScope}`);
    console.log(`[CoverageRunner] Coverage execution mode: ${executionMode}`);

    const isolated = await runResilientJestCoverage({
        jestRoot: projectRoot,
        jestConfigPath: configPath,
        finalCoverageDir,
        logRepoName: path.basename(resolveTrapezeCloneRoot(projectRoot)),
        targetAnalysisPath,
        sourceFileCount: sourceFiles.length
    });

    const combinedStdout = isolated.combinedStdout;
    const combinedStderr = isolated.combinedStderr;
    const lastExitCode = isolated.exitCode;
    const jestCommandPreview = isolated.diagnostics?.jestCommandPreview || '';

    if (!isolated.hasCoverage || !isolated.fullSummary) {
        return {
            success: true,
            hasCoverage: false,
            message: isolated.message || 'No coverage data generated',
            files: [],
            summary: emptyCoverageSummary(),
            rawOutput: combinedStdout,
            errorOutput: combinedStderr,
            diagnostics: {
                sourceFileCount: sourceFiles.length,
                batchCount: isolated.totalTestFiles,
                coverageExecutionMode: executionMode,
                failedTestFiles: isolated.failedTestFiles
            }
        };
    }

    const fullSummary = isolated.fullSummary;
    const detailed = isolated.detailed || {};
    const parsed = parseCoverageResults(fullSummary, detailed, folderPath, projectRoot);
    const combinedJestOutput = combinedStdout + '\n' + combinedStderr;
    const failureSummary =
        isolated.failureSummary || buildJestFailureDiagnostics(combinedJestOutput);

    console.log(
        `[CoverageRunner] Diagnostics: jest keys=${parsed.diagnostics.jestCoverageKeyCount}, ` +
        `matched=${parsed.diagnostics.matchedFileCount}, skipped=${parsed.diagnostics.skippedKeyCount}, ` +
        `tests=${isolated.passedTests}/${isolated.totalTests}`
    );
    if (parsed.diagnostics.sampleSkippedKeys?.length) {
        console.log(`[CoverageRunner] Sample skipped keys:`, parsed.diagnostics.sampleSkippedKeys);
    }

    if (fullSummary.total && typeof fullSummary.total === 'object') {
        writeSuperDashboardJestSummary(folderPath, null, projectRoot, {
            reportSource: 'code-analysis',
            totalTests: isolated.totalTests,
            passedTests: isolated.passedTests,
            failedTests: isolated.failedTests,
            testSuites: isolated.testSuites,
            success: isolated.success,
            exitCode: lastExitCode,
            coverage: { total: fullSummary.total }
        });
    }

    return {
        success: true,
        hasCoverage: true,
        files: parsed.files,
        summary: parsed.summary,
        rawOutput: combinedStdout,
        totalTests: isolated.totalTests,
        passedTests: isolated.passedTests,
        failedTests: isolated.failedTests,
        testSuites: isolated.testSuites,
        passedSuites: isolated.passedSuites,
        failedSuites: isolated.failedSuites,
        incompleteRun: isolated.incompleteRun,
        junctionSetup,
        diagnostics: {
            ...parsed.diagnostics,
            sourceFileCount: sourceFiles.length,
            batchCount: isolated.totalTestFiles,
            coverageExecutionMode: executionMode,
            analysisFolder: folderPath,
            jestMessage: isolated.message,
            incompleteRun: isolated.incompleteRun,
            passedSuites: isolated.passedSuites,
            failedSuites: isolated.failedSuites,
            testSuites: isolated.testSuites,
            failedTestFiles: isolated.failedTestFiles,
            passedTestFiles: isolated.passedTestFiles,
            totalTestFiles: isolated.totalTestFiles,
            siblingBranches: junctionSetup?.siblingBranches || [],
            junctionWarnings: junctionSetup?.warnings || [],
            failureSummary,
            jestCommandPreview
        },
        message: parsed.files.length === 0
            ? `No coverage match found for files in: ${folderPath}`
            : isolated.message
    };
}

function emptyCoverageSummary() {
    return {
        lines: { total: 0, covered: 0, pct: 0 },
        statements: { total: 0, covered: 0, pct: 0 },
        functions: { total: 0, covered: 0, pct: 0 },
        branches: { total: 0, covered: 0, pct: 0 }
    };
}

/**
 * Extract missing lines from detailed istanbul data
 * @param {object} fileData - Detailed file coverage data
 * @returns {number[]} - Array of missing line numbers
 */
function getMissingLines(fileData) {
    const missingLines = [];
    if (fileData.statementMap && fileData.s) {
        for (const [key, value] of Object.entries(fileData.s)) {
            if (value === 0 && fileData.statementMap[key]) {
                const loc = fileData.statementMap[key];
                if (loc.start && loc.start.line) {
                    missingLines.push(loc.start.line);
                }
            }
        }
    }
    return [...new Set(missingLines)].sort((a, b) => a - b);
}

/**
 * Format missing lines into readable ranges
 * @param {number[]} lines - Array of line numbers
 * @returns {string} - Formatted string like "1-5, 10, 15-20"
 */
function formatMissingLines(lines) {
    if (!lines || lines.length === 0) return '';

    const sorted = [...lines].sort((a, b) => a - b);
    const ranges = [];
    let start = sorted[0];
    let end = sorted[0];

    for (let i = 1; i <= sorted.length; i++) {
        if (sorted[i] === end + 1) {
            end = sorted[i];
        } else {
            if (start === end) {
                ranges.push(String(start));
            } else {
                ranges.push(`${start}-${end}`);
            }
            start = sorted[i];
            end = sorted[i];
        }
    }

    return ranges.join(', ');
}

module.exports = {
    runCoverage,
    formatMissingLines,
    getMissingLines,
    findTestRoot,
    findJestProjectRoot,
    isJestProjectDirectory,
    packageJsonDeclaresJest,
    findNearestJestConfig,
    getBatchScopes,
    mergeCoverageSummaries,
    mergeCoverageFinal,
    pickBetterCoverageSummaryEntry,
    parseCoverageResults,
    resolveCoverageExecutionPlan,
    buildJestArgs,
    buildTestPathPattern,
    escapeForJestTestPathPattern,
    isFileUnderFolder,
    getSourceFilesInFolder
};
