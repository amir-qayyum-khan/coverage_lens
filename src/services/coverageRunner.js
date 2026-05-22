const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { writeSuperDashboardJestSummary } = require('./superDashboardPersist');
const { isFileUnderFolder, toDisplayRelativePath } = require('../utils/coveragePaths');
const { normalizeRelativeKey, canonicalPathKey } = require('../utils/coverageMerge');
const { buildCollectCoverageFromPatterns } = require('../utils/coverageGlobs');
const { parseJestOutput } = require('../utils/jestOutputParser');
const {
    resolveTargetAnalysisPath,
    isFullSourceTreeScope,
    findSourceRootUnder,
    resolveJestCoverageScope
} = require('../utils/sourceRoot');

const JEST_CONFIG_FILENAMES = ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs'];
const MAX_SOURCE_FILES_THROTTLE = 150;
const BATCH_SKIP_DIRS = ['node_modules', '__tests__', '__test__', '__mocks__', 'i18n', 'config', 'coverage', 'dist', 'build'];

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
 * Jest scopes for coverage runs. Large full-`src` trees are split by immediate child folder.
 * @param {string} projectRoot
 * @param {string} relativeToRoot - Scope relative to project root (e.g. "src", "src/components/booking")
 * @param {number} sourceFileCount
 * @returns {string[]}
 */
function getBatchScopes(projectRoot, targetAnalysisPath, sourceFileCount) {
    const scope = resolveJestCoverageScope(projectRoot, targetAnalysisPath);

    if (sourceFileCount <= MAX_SOURCE_FILES_THROTTLE || !isFullSourceTreeScope(scope)) {
        return [scope];
    }

    const srcPath = findSourceRootUnder(projectRoot);
    if (!srcPath || !fs.existsSync(srcPath)) {
        return [scope];
    }

    const batches = [];
    try {
        const entries = fs.readdirSync(srcPath, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory() || BATCH_SKIP_DIRS.includes(entry.name)) continue;
            const childScope = resolveJestCoverageScope(projectRoot, path.join(srcPath, entry.name));
            batches.push(childScope);
        }
    } catch (err) {
        console.warn(`[CoverageRunner] Failed to list src children for batching:`, err.message);
        return [scope];
    }

    if (batches.length === 0) {
        return [scope];
    }

    console.log(`[CoverageRunner] Large source tree (${sourceFileCount} files) — running ${batches.length} batched Jest scopes`);
    return batches;
}

/**
 * Write temporary Jest config for a scoped coverage run.
 * @param {string} projectRoot
 * @param {string} scopeRelativeToRoot
 * @param {string} coverageDir
 * @param {string} configSuffix - Unique suffix for temp file name
 * @returns {string} Absolute path to temp config
 */
function writeTempJestConfig(projectRoot, scopeRelativeToRoot, coverageDir, configSuffix) {
    const baseConfigPath = findNearestJestConfig(projectRoot) || path.join(projectRoot, 'jest.config.js');
    const baseConfigExists = fs.existsSync(baseConfigPath);
    const tempConfigPath = path.join(projectRoot, 'jest.config.js');
    const backupConfigPath = path.join(projectRoot, 'jest.config.js.original');

    // Escape base config path for loading
    const escapedProjectConfigPath = baseConfigExists
        ? (baseConfigPath === tempConfigPath ? backupConfigPath : baseConfigPath).replace(/\\/g, '/')
        : tempConfigPath.replace(/\\/g, '/');

    // Backup original jest.config.js if it exists
    if (fs.existsSync(tempConfigPath)) {
        try {
            fs.renameSync(tempConfigPath, backupConfigPath);
        } catch (e) {
            console.warn(`[CoverageRunner] Failed to backup base config: ${e.message}`);
        }
    }

    const patterns = buildCollectCoverageFromPatterns(scopeRelativeToRoot);
    const patternsJson = JSON.stringify(patterns, null, 4).replace(/\n/g, '\n    ');

    const tempConfigContent = `
const fs = require('fs');

module.exports = {
    ...(function () {
        const b = fs.existsSync('${escapedProjectConfigPath}') ? require('${escapedProjectConfigPath}') : {};
        // Remove properties that can interfere with test discovery
        const { testPathIgnorePatterns, coveragePathIgnorePatterns, coverageThreshold, bail, ...rest } = b;
        return { ...rest };
    })(),
    bail: 0,
    collectCoverage: true,
    collectCoverageFrom: ${patternsJson},
    coverageDirectory: '${coverageDir.replace(/\\/g, '/')}',
    coverageReporters: ['json-summary', 'json'],
    coverageThreshold: undefined,
    coveragePathIgnorePatterns: [],
    testPathIgnorePatterns: ['/node_modules/']
};
`;
    fs.writeFileSync(tempConfigPath, tempConfigContent, 'utf8');
    return tempConfigPath;
}

/**
 * Resolve local Jest binary for spawning.
 * @param {string} projectRoot
 * @returns {{ command: string, argsPrefix: string[], useNodeToExecute: boolean, jestBinPath: string }}
 */
function resolveJestBinary(projectRoot) {
    let jestBinPath = path.join(projectRoot, 'node_modules', '.bin', 'jest');
    let useNodeToExecute = false;

    if (process.platform === 'win32') {
        const jestCmd = path.join(projectRoot, 'node_modules', '.bin', 'jest.cmd');
        const jestJs = path.join(projectRoot, 'node_modules', 'jest', 'bin', 'jest.js');

        if (fs.existsSync(jestCmd)) {
            jestBinPath = jestCmd;
        } else if (fs.existsSync(jestJs)) {
            jestBinPath = jestJs;
            useNodeToExecute = true;
        } else if (!fs.existsSync(jestBinPath)) {
            jestBinPath = 'npx';
        }
    } else if (!fs.existsSync(jestBinPath)) {
        jestBinPath = 'npx';
    }

    if (jestBinPath !== 'npx') {
        jestBinPath = jestBinPath.split(path.sep).join('/');
    }

    return { jestBinPath, useNodeToExecute };
}

/**
 * Escape a path scope for Jest --testPathPattern (regex).
 * @param {string} scope
 * @returns {string}
 */
function escapeForJestTestPathPattern(scope) {
    return String(scope || '')
        .replace(/\\/g, '/')
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build --testPathPattern value for a coverage scope (same path as collectCoverageFrom).
 * @param {string} scopeRelativeToRoot - e.g. "src/components/booking"
 * @returns {string|null} Pattern string, or null when scope is empty (project-wide)
 */
function buildTestPathPattern(scopeRelativeToRoot) {
    const scope = (scopeRelativeToRoot || '').replace(/\\/g, '/').trim();
    if (!scope) return null;
    return escapeForJestTestPathPattern(scope);
}

/**
 * Build Jest CLI args for a scoped coverage run (mirrors folder-scoped npx jest CLI).
 * @param {string} tempConfigPath
 * @param {string} scopeRelativeToRoot
 * @param {number} sourceFileCount - Files in the analyzed folder (for worker tuning)
 * @param {boolean} isFullSrcBatch - Part of a multi-batch full-src run
 * @returns {{ jestArgs: string[], testPathPattern: string|null }}
 */
function buildJestArgs(tempConfigPath, scopeRelativeToRoot, sourceFileCount, isFullSrcBatch) {
    const baseName = path.basename(tempConfigPath);
    const normalizedConfigPath = baseName === 'jest.config.js'
        ? 'jest.config.js'
        : tempConfigPath.split(path.sep).join('/');
    const scope = (scopeRelativeToRoot || '').replace(/\\/g, '/');
    const patterns = buildCollectCoverageFromPatterns(scope);
    const testPathPattern = buildTestPathPattern(scope);

    // Use moderate throttling for large folders — enough workers to run all tests without OOM
    const throttleWorkers = sourceFileCount > MAX_SOURCE_FILES_THROTTLE && !isFullSrcBatch;
    const maxWorkers = throttleWorkers ? '--maxWorkers=4' : '--maxWorkers=50%';

    const jestArgs = [
        `--config=${normalizedConfigPath}`,
        '--coverage',
        '--passWithNoTests',
        '--watchAll=false',
        '--forceExit',
        '--no-cache',
        maxWorkers
    ];

    if (testPathPattern) {
        jestArgs.push(`--testPathPattern=${testPathPattern}`);
    }

    for (const pattern of patterns) {
        jestArgs.push(`--collectCoverageFrom=${pattern}`);
    }

    return { jestArgs, testPathPattern };
}

/**
 * Run Jest once for a coverage scope.
 * @param {object} opts
 * @returns {Promise<{ code: number, stdout: string, stderr: string, coverageDir: string }>}
 */
function runJestOnce(opts) {
    const {
        projectRoot,
        scopeRelativeToRoot,
        sourceFileCount,
        configSuffix,
        isFullSrcBatch
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

    const tempConfigPath = writeTempJestConfig(projectRoot, scope, coverageDir, configSuffix);
    const { jestBinPath, useNodeToExecute } = resolveJestBinary(projectRoot);
    const { jestArgs, testPathPattern } = buildJestArgs(tempConfigPath, scope, sourceFileCount, isFullSrcBatch);

    const command = useNodeToExecute ? 'node' : jestBinPath;
    const spawnArgs = useNodeToExecute
        ? [jestBinPath, ...jestArgs]
        : jestBinPath === 'npx'
            ? ['jest', ...jestArgs]
            : jestArgs;

    const jestCommandPreview = `${command} ${spawnArgs.join(' ')}`.slice(0, 200);

    console.log(`[CoverageRunner] Executing: ${command} ${spawnArgs.join(' ')}`);

    return new Promise((resolve) => {
        const jest = spawn(command, spawnArgs, {
            cwd: projectRoot,
            shell: true,
            env: {
                ...process.env,
                CI: 'true',
                NODE_OPTIONS: process.env.NODE_OPTIONS
                    ? `${process.env.NODE_OPTIONS} --max-old-space-size=4096`
                    : '-- =4096'
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
            try {
                if (fs.existsSync(tempConfigPath)) {
                    fs.unlinkSync(tempConfigPath);
                }
                const backupConfigPath = path.join(projectRoot, 'jest.config.js.original');
                if (fs.existsSync(backupConfigPath)) {
                    fs.renameSync(backupConfigPath, tempConfigPath);
                }
                const logPath = path.join(coverageDir, 'jest-execution.log');
                fs.writeFileSync(logPath, `Exit Code: ${code}\nSignal: ${signal}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`, 'utf8');
                console.log(`[CoverageRunner] Saved jest logs to ${logPath}`);
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
            try {
                if (fs.existsSync(tempConfigPath)) {
                    fs.unlinkSync(tempConfigPath);
                }
                const backupConfigPath = path.join(projectRoot, 'jest.config.js.original');
                if (fs.existsSync(backupConfigPath)) {
                    fs.renameSync(backupConfigPath, tempConfigPath);
                }
                const logPath = path.join(coverageDir, 'jest-execution.log');
                fs.writeFileSync(logPath, `Error: ${error.message}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`, 'utf8');
                console.log(`[CoverageRunner] Saved jest error logs to ${logPath}`);
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
 * Sum istanbul metric objects { total, covered, pct }.
 * @param {object[]} metrics
 * @returns {{ total: number, covered: number, pct: number }}
 */
function sumMetric(metrics) {
    const total = metrics.reduce((s, m) => s + (m?.total || 0), 0);
    const covered = metrics.reduce((s, m) => s + (m?.covered || 0), 0);
    const pct = total > 0 ? (covered / total) * 100 : 0;
    return { total, covered, pct };
}

/**
 * Prefer the coverage entry with more covered lines (for duplicate keys across batches).
 * @param {object} a
 * @param {object} b
 * @returns {object}
 */
function pickBetterCoverageSummaryEntry(a, b) {
    const coveredA = a?.lines?.covered ?? 0;
    const coveredB = b?.lines?.covered ?? 0;
    return coveredB > coveredA ? b : a;
}

/**
 * Count executed statements in istanbul file data.
 * @param {object} fileData
 * @returns {number}
 */
function countCoveredStatements(fileData) {
    if (!fileData?.s) return 0;
    return Object.values(fileData.s).filter((v) => v > 0).length;
}

/**
 * Merge multiple coverage-summary.json payloads into one.
 * @param {object[]} summaries
 * @returns {object}
 */
function mergeCoverageSummaries(summaries) {
    const merged = {};
    for (const summary of summaries) {
        for (const [key, data] of Object.entries(summary)) {
            if (key === 'total') continue;
            merged[key] = merged[key]
                ? pickBetterCoverageSummaryEntry(merged[key], data)
                : data;
        }
    }

    const fileEntries = Object.values(merged);
    merged.total = {
        lines: sumMetric(fileEntries.map((f) => f.lines)),
        statements: sumMetric(fileEntries.map((f) => f.statements)),
        functions: sumMetric(fileEntries.map((f) => f.functions)),
        branches: sumMetric(fileEntries.map((f) => f.branches))
    };

    return merged;
}

/**
 * Merge coverage-final.json objects by file path key.
 * @param {object[]} detailedList
 * @returns {object}
 */
function mergeCoverageFinal(detailedList) {
    const merged = {};
    for (const detailed of detailedList) {
        for (const [key, data] of Object.entries(detailed)) {
            const existing = merged[key];
            if (!existing) {
                merged[key] = data;
                continue;
            }
            if (countCoveredStatements(data) > countCoveredStatements(existing)) {
                merged[key] = data;
            }
        }
    }
    return merged;
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
 * Run Jest with coverage on a folder
 * @param {string} folderPath - Path to the folder containing cases/files to analyze
 * @returns {Promise<object>} - Coverage results
 */
async function runCoverage(folderPath) {
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
    const scopes = getBatchScopes(projectRoot, targetAnalysisPath, sourceFiles.length);
    const isBatched = scopes.length > 1;

    console.log(`[CoverageRunner] Project root: ${projectRoot}`);
    console.log(`[CoverageRunner] Folder path: ${folderPath}`);
    console.log(`[CoverageRunner] Target: ${targetAnalysisPath} (${sourceFiles.length} source files)`);
    console.log(`[CoverageRunner] Jest coverage scope: ${jestCoverageScope}`);
    console.log(`[CoverageRunner] Scopes: ${scopes.join(', ')}`);

    const summaryParts = [];
    const detailedParts = [];
    let combinedStdout = '';
    let combinedStderr = '';
    let lastExitCode = 0;
    const batchTestPathPatterns = [];
    let jestCommandPreview = '';

    for (let i = 0; i < scopes.length; i++) {
        const scope = scopes[i];
        const result = await runJestOnce({
            projectRoot,
            scopeRelativeToRoot: scope,
            sourceFileCount: sourceFiles.length,
            configSuffix: isBatched ? `-batch-${i}` : '',
            isFullSrcBatch: isBatched
        });

        if (result.testPathPattern) {
            batchTestPathPatterns.push({ scope, pattern: result.testPathPattern });
        }
        if (result.jestCommandPreview) {
            jestCommandPreview = result.jestCommandPreview;
        }

        combinedStdout += result.stdout;
        combinedStderr += result.stderr;
        if (result.code !== 0) {
            lastExitCode = result.code;
        }

        const summaryPath = path.join(result.coverageDir, 'coverage-summary.json');
        const finalPath = path.join(result.coverageDir, 'coverage-final.json');

        if (fs.existsSync(summaryPath)) {
            summaryParts.push(JSON.parse(fs.readFileSync(summaryPath, 'utf8')));
        } else {
            console.warn(`[CoverageRunner] No coverage-summary.json for scope "${scope}"`);
        }

        if (fs.existsSync(finalPath)) {
            detailedParts.push(JSON.parse(fs.readFileSync(finalPath, 'utf8')));
        }
    }

    if (summaryParts.length === 0) {
        return {
            success: true,
            hasCoverage: false,
            message: 'No coverage data generated',
            files: [],
            summary: emptyCoverageSummary(),
            rawOutput: combinedStdout,
            errorOutput: combinedStderr,
            diagnostics: { sourceFileCount: sourceFiles.length, batchCount: scopes.length }
        };
    }

    const fullSummary = mergeCoverageSummaries(summaryParts);
    const detailed = mergeCoverageFinal(detailedParts);
    const parsed = parseCoverageResults(fullSummary, detailed, folderPath, projectRoot);
    const jestRun = parseJestOutput(combinedStdout + '\n' + combinedStderr);

    console.log(
        `[CoverageRunner] Diagnostics: jest keys=${parsed.diagnostics.jestCoverageKeyCount}, ` +
        `matched=${parsed.diagnostics.matchedFileCount}, skipped=${parsed.diagnostics.skippedKeyCount}, ` +
        `tests=${jestRun.passedTests}/${jestRun.totalTests}`
    );
    if (parsed.diagnostics.sampleSkippedKeys?.length) {
        console.log(`[CoverageRunner] Sample skipped keys:`, parsed.diagnostics.sampleSkippedKeys);
    }

    if (fullSummary.total && typeof fullSummary.total === 'object') {
        writeSuperDashboardJestSummary(folderPath, null, projectRoot, {
            reportSource: 'code-analysis',
            totalTests: jestRun.totalTests,
            passedTests: jestRun.passedTests,
            failedTests: jestRun.failedTests,
            testSuites: jestRun.testSuites,
            success: lastExitCode === 0,
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
        totalTests: jestRun.totalTests,
        passedTests: jestRun.passedTests,
        failedTests: jestRun.failedTests,
        testSuites: jestRun.testSuites,
        diagnostics: {
            ...parsed.diagnostics,
            sourceFileCount: sourceFiles.length,
            batchCount: scopes.length,
            scopesRun: scopes,
            analysisFolder: folderPath,
            jestMessage: jestRun.message,
            testPathPatterns: batchTestPathPatterns,
            jestCommandPreview
        },
        message: parsed.files.length === 0
            ? `No coverage match found for files in: ${folderPath}`
            : ''
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
    buildJestArgs,
    buildTestPathPattern,
    escapeForJestTestPathPattern,
    isFileUnderFolder,
    getSourceFilesInFolder
};
