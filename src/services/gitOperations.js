const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { findJestProjectRoot, getMissingLines, findNearestJestConfig } = require('./coverageRunner');
const { writeSuperDashboardJestSummary } = require('./superDashboardPersist');
const { buildCollectCoverageFromPatterns } = require('../utils/coverageGlobs');
const { resolveCollectCoverageScope } = require('../utils/sourceRoot');
const { canonicalPathKey, normalizeRelativeKey } = require('../utils/coverageMerge');
const { resolveCoverageKeyToAbsolute, toDisplayRelativePath } = require('../utils/coveragePaths');
const { parseJestOutput } = require('../utils/jestOutputParser');
const {
    beginRepoLogSession,
    logRepoCommand,
    resolveRepoNameFromCwd,
    maskCommandLine
} = require('../utils/repoCommandLogger');
const { runResilientJestCoverage, findTestFiles } = require('./jestResilientCoverage');

/**
 * Resolve repo log name for a git invocation (clone targets repo folder, not parent cwd).
 * @param {string[]} args
 * @param {string} cwd
 * @param {string} [explicitRepoName]
 * @returns {string}
 */
function resolveGitLogRepoName(args, cwd, explicitRepoName) {
    if (explicitRepoName) {
        return explicitRepoName;
    }
    if (args[0] === 'clone' && args[2]) {
        return path.basename(args[2]);
    }
    return resolveRepoNameFromCwd(cwd);
}

/**
 * Run a git command and return its output
 * @param {string[]} args - Git command arguments
 * @param {string} cwd - Working directory
 * @param {number} [timeout=120000] - Timeout in ms
 * @param {object} [options]
 * @param {string} [options.repoName] - Log file key (defaults from cwd / clone path)
 * @param {{ username?: string, token?: string }|null} [options.credentials] - Mask secrets in logs
 * @returns {Promise<{success: boolean, stdout: string, stderr: string}>}
 */
function runGitCommand(args, cwd, timeout = 120000, options = {}) {
    const { repoName: explicitRepoName, credentials = null } = options;
    const logRepoName = resolveGitLogRepoName(args, cwd, explicitRepoName);

    const logArgs = args.map(arg => {
        if (typeof arg === 'string' && arg.includes('://')) {
            try {
                const url = new URL(arg);
                if (url.password) {
                    url.password = '****';
                }
                return url.toString();
            } catch (e) {
                return arg;
            }
        }
        return arg;
    });
    const commandLine = `git ${logArgs.join(' ')}`;
    console.log(`[GitCommand] Executing: ${commandLine}`);
    const startedAt = Date.now();

    return new Promise((resolve) => {
        const git = spawn('git', args, {
            cwd,
            shell: true,
            timeout,
            windowsHide: true
        });

        let stdout = '';
        let stderr = '';

        git.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        git.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        const finish = (result, spawnError = '') => {
            logRepoCommand({
                repoName: logRepoName,
                commandType: 'git',
                command: commandLine,
                cwd,
                success: result.success,
                exitCode: result.exitCode ?? (result.success ? 0 : 1),
                stdout: result.stdout,
                stderr: result.stderr,
                spawnError,
                durationMs: Date.now() - startedAt,
                credentials
            });
            resolve({
                success: result.success,
                stdout: result.stdout,
                stderr: result.stderr
            });
        };

        git.on('close', (code) => {
            finish({
                success: code === 0,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exitCode: code
            });
        });

        git.on('error', (err) => {
            finish({
                success: false,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exitCode: null
            }, err.message);
        });
    });
}

/**
 * Clone a repo, checkout the right branch, fetch, reset, and run unit tests
 * @param {string} repoUrl - Git repository URL
 * @param {string} targetDir - Directory to clone into
 * @param {function} onProgress - Progress callback ({stage, message, percent})
 * @param {object} [credentials] - Git credentials {username, token}
 * @param {string} [branch] - Branch to checkout (defaults to master)
 * @param {string} [progressKey] - UI key for progress events (must match Dashboard card id, e.g. catalog app name)
 * @param {{ junctionSetupEnabled?: boolean }} [options] - App options (junction/sm-link setup)
 * @returns {Promise<{success: boolean, message: string, branch: string|null, testResults: object|null}>}
 */
async function cloneAndTest(repoUrl, targetDir, onProgress, credentials, branch, progressKey, options = {}) {
    const repoName = path.basename(repoUrl, '.git');
    const clonePath = path.join(targetDir, repoName);
    // Dashboard keys status by app.name; URL basename (e.g. TrapezeDRTCoreUI) would never match "CoreUI".
    const progressRepoName = progressKey || repoName;

    const sendProgress = (stage, message, percent) => {
        if (onProgress) {
            onProgress({ stage, message, percent, repoName: progressRepoName });
        }
    };

    // Prepare authenticated URL if credentials provided
    let authRepoUrl = repoUrl;
    if (credentials && credentials.token) {
        try {
            const urlObj = new URL(repoUrl);
            const authPrefix = credentials.username
                ? `${encodeURIComponent(credentials.username)}:${encodeURIComponent(credentials.token)}`
                : encodeURIComponent(credentials.token);
            urlObj.username = credentials.username || '';
            urlObj.password = credentials.token;
            authRepoUrl = urlObj.toString();
        } catch (e) {
            console.error('Failed to parse repo URL for auth:', e);
        }
    }

    const targetBranch = branch || 'master';

    beginRepoLogSession(repoName, {
        operation: 'cloneAndTest',
        repoUrl: maskCommandLine(repoUrl),
        targetDir,
        branch: targetBranch
    });

    try {
        // Step 1: Clone
        sendProgress('cloning', `Cloning ${repoName}...`, 10);

        if (fs.existsSync(clonePath)) {
            // If already cloned, just cd into it
            sendProgress('cloning', `Repository already exists at ${clonePath}, using existing...`, 15);
        } else {
            const cloneResult = await runGitCommand(
                ['clone', authRepoUrl, clonePath],
                targetDir,
                300000,
                { repoName, credentials }
            );
            if (!cloneResult.success) {
                // Strip credentials from error message if they leaked
                let cleanError = cloneResult.stderr;
                if (credentials && credentials.token) {
                    cleanError = cleanError.replace(new RegExp(credentials.token, 'g'), '****');
                    if (credentials.username) {
                        cleanError = cleanError.replace(new RegExp(credentials.username, 'g'), '****');
                    }
                }
                return {
                    success: false,
                    message: `Clone failed: ${cleanError}`,
                    branch: null,
                    testResults: null
                };
            }
        }

        sendProgress('cloning', 'Clone complete', 25);

        // Step 2: Fetch origin
        sendProgress('fetching', 'Fetching latest from origin...', 30);
        const fetchResult = await runGitCommand(['fetch', 'origin'], clonePath, 120000, {
            repoName,
            credentials
        });
        if (!fetchResult.success) {
            sendProgress('fetching', `Fetch warning: ${fetchResult.stderr}`, 35);
        }
        sendProgress('fetching', 'Fetch complete', 40);

        // Step 3: Checkout and sync with remote
        sendProgress('checkout', `Checking out ${targetBranch}...`, 45);

        const gitOpts = { repoName, credentials };

        // Try to checkout existing (use -f to discard any accidental local changes)
        let checkoutResult = await runGitCommand(['checkout', '-f', targetBranch], clonePath, 120000, gitOpts);

        if (!checkoutResult.success) {
            // Try to create/track from remote if it exists but not locally
            checkoutResult = await runGitCommand(
                ['checkout', '-b', targetBranch, `origin/${targetBranch}`],
                clonePath,
                120000,
                gitOpts
            );

            // If it still fails with "already exists", try one last force checkout
            if (!checkoutResult.success && checkoutResult.stderr.includes('already exists')) {
                checkoutResult = await runGitCommand(['checkout', '-f', targetBranch], clonePath, 120000, gitOpts);
            }

            if (!checkoutResult.success) {
                return {
                    success: false,
                    message: `Branch ${targetBranch} not found: ${checkoutResult.stderr}`,
                    branch: null,
                    testResults: null
                };
            }
        }

        const activeBranch = targetBranch;

        // Step 4: Hard reset to remote to ensure we have the latest code
        sendProgress('checkout', `Resetting to latest origin/${activeBranch}...`, 50);
        const resetResult = await runGitCommand(
            ['reset', '--hard', `origin/${activeBranch}`],
            clonePath,
            120000,
            gitOpts
        );
        if (!resetResult.success) {
            sendProgress('checkout', `Reset warning: ${resetResult.stderr}`, 52);
        }

        sendProgress('checkout', `Checked out and updated ${activeBranch}`, 55);

        // Step 5: Trapeze UI — junctions to we-common, we-framework (and we-track for CoreUI)
        const { setupTrapezeUIJunctions } = require('./trapezeJunctionSetup');
        const junctionResult = await setupTrapezeUIJunctions(clonePath, {
            credentials,
            branch: activeBranch,
            repoUrl,
            runGitCommand,
            onProgress: sendProgress,
            logRepoName: repoName,
            junctionSetupEnabled: options.junctionSetupEnabled
        });
        if (!junctionResult.skipped) {
            if (junctionResult.warnings.length > 0) {
                for (const w of junctionResult.warnings) {
                    sendProgress('linking_deps', `Junction warning: ${w}`, 62);
                }
            }
            sendProgress(
                'linking_deps',
                junctionResult.message,
                junctionResult.success ? 65 : 63
            );
        }

        // Step 6: Install dependencies at clone root and/or nested Jest package (monorepos / inner package.json)
        sendProgress('installing_deps', 'Checking dependencies...', 75);
        const { installPackages } = require('./nodeInstaller');
        const jestProjectRoot = findJestProjectRoot(clonePath);
        const installDirs = new Set();
        if (fs.existsSync(path.join(clonePath, 'package.json'))) {
            installDirs.add(clonePath);
        }
        if (
            jestProjectRoot &&
            jestProjectRoot !== clonePath &&
            fs.existsSync(path.join(jestProjectRoot, 'package.json'))
        ) {
            installDirs.add(jestProjectRoot);
        }
        if (installDirs.size === 0 && jestProjectRoot && fs.existsSync(path.join(jestProjectRoot, 'package.json'))) {
            installDirs.add(jestProjectRoot);
        }
        for (const dir of installDirs) {
            const installResult = await installPackages(dir, sendProgress);
            if (!installResult.success) {
                sendProgress('installing_deps', `Install warning (${path.basename(dir)}): ${installResult.message}`, 80);
            }
        }
        sendProgress('installing_deps', 'Dependencies ready', 85);

        // Step 7: Run Jest from discovered project root (package.json + jest config / Jest dependency)
        sendProgress('testing', 'Running unit tests...', 90);
        const testResults = await runTests(clonePath, sendProgress, activeBranch);

        if (!junctionResult.skipped && testResults) {
            testResults.junctionSetup = {
                profile: junctionResult.profile,
                siblingBranches: junctionResult.siblingBranches || [],
                warnings: junctionResult.warnings || [],
                links: junctionResult.links || []
            };
            testResults.diagnostics = {
                ...(testResults.diagnostics || {}),
                siblingBranches: junctionResult.siblingBranches || [],
                junctionWarnings: junctionResult.warnings || []
            };
        }

        sendProgress('complete', `Done! Branch: ${activeBranch}`, 100);

        return {
            success: true,
            message: `Successfully cloned, checked out ${activeBranch}, and ran tests`,
            branch: activeBranch,
            testResults,
            clonePath
        };
    } catch (error) {
        return {
            success: false,
            message: `Operation failed: ${error.message}`,
            branch: null,
            testResults: null
        };
    }
}

/**
 * Prefer Node 18 from nvm4w on Windows (Trapeze Jest suites target Node 18; Node 22 can crash workers before coverage flush).
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
 * Remove prior coverage artifacts so a failed run cannot leave stale json-summary data.
 * @param {string} coverageDir
 */
function clearCoverageOutput(coverageDir) {
    if (!fs.existsSync(coverageDir)) {
        fs.mkdirSync(coverageDir, { recursive: true });
        return;
    }
    const staleNames = [
        'coverage-summary.json',
        'coverage-final.json',
        'clover.xml',
        'lcov.info',
        'jest-execution.log'
    ];
    try {
        for (const name of staleNames) {
            const full = path.join(coverageDir, name);
            if (fs.existsSync(full)) {
                fs.unlinkSync(full);
            }
        }
        const lcovReport = path.join(coverageDir, 'lcov-report');
        if (fs.existsSync(lcovReport)) {
            fs.rmSync(lcovReport, { recursive: true, force: true });
        }
    } catch (err) {
        console.warn(`[runTests] Failed to clear coverage artifacts in ${coverageDir}:`, err.message);
    }
}

/**
 * Resolve how to invoke Jest for a package (local binary, node jest.js on Windows, or npx).
 * @param {string} projectRoot - Directory containing node_modules (Jest package root)
 * @param {string} [configPath] - Optional path to a specific jest config file
 * @returns {{ command: string, args: string[] }}
 */
function resolveJestSpawn(projectRoot, configPath) {
    let jestBinPath = path.join(projectRoot, 'node_modules', '.bin', 'jest');
    let useNodeToExecute = false;

    const jestJs = path.join(projectRoot, 'node_modules', 'jest', 'bin', 'jest.js');
    if (process.platform === 'win32') {
        const jestCmd = path.join(projectRoot, 'node_modules', '.bin', 'jest.cmd');
        // Prefer node jest.js (matches npm run test:coverage:full heap wrapper via NODE_OPTIONS).
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

    const jestArgs = [
        '--coverage',
        '--coverageReporters=json-summary',
        '--coverageReporters=json',
        '--coverageReporters=text',
        '--passWithNoTests',
        '--forceExit',
        '--detectOpenHandles',
        '--maxWorkers=50%'
    ];

    if (configPath) {
        const baseName = path.basename(configPath);
        const normalizedConfig = baseName === 'jest.config.js'
            ? 'jest.config.js'
            : configPath.split(path.sep).join('/');
        jestArgs.push(`--config=${normalizedConfig}`);
    }

    if (useNodeToExecute) {
        return { command: resolveNodeExecutable(), args: [jestBinPath, ...jestArgs] };
    }
    if (jestBinPath === 'npx') {
        return { command: 'npx', args: ['--yes', 'jest', ...jestArgs] };
    }
    return { command: jestBinPath, args: jestArgs };
}

/**
 * Run unit tests via Jest from the discovered package root (nested monorepos supported).
 * Coverage follows the project's jest.config.js; output goes to <jestRoot>/coverage/.
 * @param {string} clonePath - Cloned repository root (for metadata file location)
 * @param {function} sendProgress - Progress callback
 * @param {string} [branch] - Active branch label for the summary file
 * @returns {Promise<object>} - Test results summary
 */
async function runTests(clonePath, sendProgress, branch) {
    const jestRoot = findJestProjectRoot(clonePath);

    if (!jestRoot) {
        return {
            success: false,
            hasCoverage: false,
            message:
                'No Jest project found: need package.json with jest.config.* or Jest in dependencies under the clone.',
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            testSuites: 0,
            jestProjectRoot: null,
            superDashboardSummaryPath: null
        };
    }

    const coverageDir = path.join(jestRoot, 'coverage');
    clearCoverageOutput(coverageDir);
    const fullCoverageConfigPath = path.join(jestRoot, 'jest.config.full-coverage.js');
    const useFullCoverageConfig = fs.existsSync(fullCoverageConfigPath);
    const tempConfigPath = path.join(jestRoot, 'jest.config.js');
    const backupConfigPath = path.join(jestRoot, 'jest.config.js.original');
    const baseConfigPath = findNearestJestConfig(jestRoot) || path.join(jestRoot, 'jest.config.js');
    const baseConfigExists = fs.existsSync(baseConfigPath);

    const escapedBaseConfigPath = baseConfigExists
        ? (baseConfigPath === tempConfigPath ? backupConfigPath : baseConfigPath).replace(/\\/g, '/')
        : tempConfigPath.replace(/\\/g, '/');

    if (!useFullCoverageConfig && fs.existsSync(tempConfigPath)) {
        try {
            fs.renameSync(tempConfigPath, backupConfigPath);
        } catch (e) {
            console.warn(`[runTests] Failed to backup base config: ${e.message}`);
        }
    }

    const coverageScope = resolveCollectCoverageScope(jestRoot);
    const fallbackPatterns = buildCollectCoverageFromPatterns(coverageScope);
    const fallbackPatternsJson = JSON.stringify(fallbackPatterns, null, 4).replace(/\n/g, '\n    ');

    const tempConfigContent = `
const fs = require('fs');

module.exports = (function () {
    const baseConfig = fs.existsSync('${escapedBaseConfigPath}') ? require('${escapedBaseConfigPath}') : {};
    const { coverageThreshold, coveragePathIgnorePatterns, bail, ...rest } = baseConfig;
    const collectCoverageFrom = baseConfig.collectCoverageFrom || ${fallbackPatternsJson};
    return {
        ...rest,
        bail: 0,
        collectCoverage: true,
        collectCoverageFrom,
        coverageDirectory: '${coverageDir.replace(/\\/g, '/')}',
        coverageReporters: ['json-summary', 'json'],
        coverageThreshold: undefined,
        coveragePathIgnorePatterns: []
    };
})();
`;

    if (!useFullCoverageConfig) {
        try {
            fs.writeFileSync(tempConfigPath, tempConfigContent, 'utf8');
        } catch (err) {
            console.warn(`[runTests] Failed to write temp config: ${err.message}`);
        }
    }

    const testCandidates = findTestFiles(jestRoot);
    const relRoot = path.relative(clonePath, jestRoot) || '.';
    sendProgress(
        'testing',
        testCandidates.length === 0
            ? `Jest root: ${relRoot} — no *.test/*.spec files found.`
            : `Jest root: ${relRoot} — running ${testCandidates.length} test file(s) in isolation...`,
        92
    );

    const jestConfigPath = useFullCoverageConfig ? fullCoverageConfigPath : tempConfigPath;
    const jestLogRepo = path.basename(clonePath);

    const restoreConfig = () => {
        if (!useFullCoverageConfig) {
            try {
                if (fs.existsSync(tempConfigPath)) {
                    fs.unlinkSync(tempConfigPath);
                }
                if (fs.existsSync(backupConfigPath)) {
                    fs.renameSync(backupConfigPath, tempConfigPath);
                }
            } catch {
                // ignore
            }
        }
    };

    try {
        const isolated = await runResilientJestCoverage({
            jestRoot,
            jestConfigPath,
            sendProgress,
            logRepoName: jestLogRepo,
            finalCoverageDir: coverageDir,
            targetAnalysisPath: jestRoot,
            sourceFileCount: testCandidates.length
        });

        restoreConfig();

        const results = {
            success: isolated.success,
            hasCoverage: isolated.hasCoverage,
            message: isolated.message,
            exitCode: isolated.exitCode,
            jestProjectRoot: jestRoot,
            totalTests: isolated.totalTests,
            passedTests: isolated.passedTests,
            failedTests: isolated.failedTests,
            testSuites: isolated.testSuites,
            passedSuites: isolated.passedSuites,
            failedSuites: isolated.failedSuites,
            incompleteRun: isolated.incompleteRun,
            failureSummary: isolated.failureSummary,
            failedTestFiles: isolated.failedTestFiles,
            diagnostics: isolated.diagnostics
        };

        if (isolated.hasCoverage && isolated.fullSummary) {
            results.summary = isolated.fullSummary.total;
            results.files = mapCoverageSummaryFiles(
                isolated.fullSummary,
                isolated.detailed || {},
                clonePath,
                jestRoot
            );
            results.coverage = {
                total: results.summary,
                files: results.files
            };
        }

        console.log(`[runTests] Writing super dashboard summary to: ${clonePath}`);
        results.superDashboardSummaryPath = writeSuperDashboardJestSummary(
            clonePath,
            branch,
            jestRoot,
            results
        );

        return results;
    } catch (err) {
        restoreConfig();
        return {
            success: false,
            hasCoverage: false,
            message: `Failed to run tests: ${err.message}`,
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            testSuites: 0,
            jestProjectRoot: jestRoot,
            superDashboardSummaryPath: null
        };
    }
}

/**
 * Map istanbul coverage-summary entries to app file rows (clone-relative paths).
 * @param {object} fullSummary
 * @param {object} detailedCoverage - coverage-final.json
 * @param {string} clonePath
 * @param {string} jestRoot
 * @returns {object[]}
 */
function mapCoverageSummaryFiles(fullSummary, detailedCoverage, clonePath, jestRoot) {
    return Object.entries(fullSummary)
        .filter(([key]) => key !== 'total')
        .map(([filePath, data]) => {
            const absoluteFile = resolveCoverageKeyToAbsolute(filePath, jestRoot);
            const relativePath = toDisplayRelativePath(clonePath, absoluteFile, jestRoot);
            const detailedKey = Object.keys(detailedCoverage).find(
                (k) =>
                    k === filePath ||
                    canonicalPathKey(k) === canonicalPathKey(filePath) ||
                    normalizeRelativeKey(k) === normalizeRelativeKey(filePath)
            );

            return {
                fileName: path.basename(absoluteFile),
                filePath: absoluteFile,
                relativePath,
                relativePathKey: normalizeRelativeKey(relativePath),
                lines: data.lines,
                branches: data.branches,
                statements: data.statements,
                missingLines:
                    detailedKey && detailedCoverage[detailedKey]
                        ? getMissingLines(detailedCoverage[detailedKey])
                        : []
            };
        });
}

/**
 * Build an authenticated Git remote URL by embedding credentials.
 * @param {string} originUrl
 * @param {{ username?: string, token?: string }|null} credentials
 * @returns {string}
 */
function buildAuthUrl(originUrl, credentials) {
    if (!credentials || !credentials.token) return originUrl;
    try {
        const u = new URL(originUrl);
        u.username = credentials.username || '';
        u.password = credentials.token;
        return u.toString();
    } catch {
        return originUrl;
    }
}

/**
 * Push the coverage report file back to Git.
 * Strategy:
 *   1. git add <file>
 *   2. git commit
 *   3. git push  → if rejected due to conflict:
 *      a. read our file content
 *      b. git fetch + git reset --hard origin/<branch>
 *      c. re-write file, add, commit, push again
 * No force push is used unless the second attempt also fai/**
 * @param {string} clonePath
 * @param {string} branch
 * @param {{ username?: string, token?: string }|null} credentials
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function pushCoverageReport(clonePath, branch, credentials) {
    const COVERAGE_FILE = '.code-analyzer/super-dashboard-jest.json'; // Always use forward slashes for Git
    const COMMIT_MSG = 'chore: update coverage report [skip ci]';

    console.log(`[GitPush] Starting push for ${path.basename(clonePath)} on branch ${branch}...`);
    console.log(`[GitPush] Clone path: ${clonePath}`);
    console.log(`[GitPush] Path exists: ${fs.existsSync(clonePath)}`);
    console.log(`[GitPush] Is git repo: ${fs.existsSync(path.join(clonePath, '.git'))}`);

    if (!fs.existsSync(clonePath)) {
        return { success: false, message: `Clone path does not exist: ${clonePath}` };
    }
    if (!fs.existsSync(path.join(clonePath, '.git'))) {
        return { success: false, message: `Not a git repository: ${clonePath}` };
    }

    // Resolve origin URL (for auth injection)
    const originResult = await runGitCommand(['remote', 'get-url', 'origin'], clonePath);
    const originUrl = originResult.success ? originResult.stdout.trim() : null;
    const authUrl = originUrl ? buildAuthUrl(originUrl, credentials) : null;
    
    console.log(`[GitPush] Origin URL: ${originUrl ? 'found' : 'missing'}`);

    const stripCreds = (str) => {
        let s = str || '';
        if (credentials?.token) s = s.replace(new RegExp(credentials.token, 'g'), '****');
        if (credentials?.username) s = s.replace(new RegExp(credentials.username, 'g'), '****');
        return s;
    };

    // Ensure Git identity is set (otherwise commit fails on clean machines)
    const emailCheck = await runGitCommand(['config', 'user.email'], clonePath);
    if (!emailCheck.success || !emailCheck.stdout) {
        console.log('[GitPush] Setting local git identity...');
        await runGitCommand(['config', 'user.email', 'lens-auto-reporter@we-support.se'], clonePath);
        await runGitCommand(['config', 'user.name', 'Voyagerr Lens Reporter'], clonePath);
    }

    // Verify the coverage file exists before staging
    const coverageFilePath = path.join(clonePath, '.code-analyzer', 'super-dashboard-jest.json');
    const coverageFileExists = fs.existsSync(coverageFilePath);
    console.log(`[GitPush] Coverage file path: ${coverageFilePath}`);
    console.log(`[GitPush] Coverage file exists: ${coverageFileExists}`);
    if (!coverageFileExists) {
        console.error('[GitPush] Coverage report file not found — aborting push.');
        return { 
            success: false, 
            message: `Coverage report file not found at ${coverageFilePath}. Please re-run the tests first.` 
        };
    }

    // Stage the coverage file using OS-native relative path (use -f to bypass .gitignore if necessary)
    const coverageFileRelative = path.join('.code-analyzer', 'super-dashboard-jest.json');
    console.log(`[GitPush] Staging file: ${coverageFileRelative}`);
    const addResult = await runGitCommand(['add', '-f', '--', coverageFileRelative], clonePath);
    if (!addResult.success) {
        console.error('[GitPush] Add failed:', stripCreds(addResult.stderr));
        return { success: false, message: `git add failed: ${stripCreds(addResult.stderr)}` };
    }

    // Commit (--allow-empty in case file didn't change)
    console.log('[GitPush] Committing changes...');
    const commitResult = await runGitCommand(
        ['commit', '-m', `"${COMMIT_MSG}"`, '--allow-empty'],
        clonePath
    );
    if (!commitResult.success) {
        console.error('[GitPush] Commit failed:', stripCreds(commitResult.stderr));
        return { success: false, message: `git commit failed: ${stripCreds(commitResult.stderr)}` };
    }

    // First push attempt
    console.log(`[GitPush] Pushing to ${authUrl ? 'authenticated remote' : 'origin'}...`);
    const pushArgs = authUrl
        ? ['push', authUrl, `${branch}:${branch}`]
        : ['push', 'origin', `${branch}:${branch}`];

    let pushResult = await runGitCommand(pushArgs, clonePath);

    if (pushResult.success) {
        console.log('[GitPush] Push successful.');
        return { success: true, message: 'Coverage report pushed successfully.' };
    }

    const stderr = pushResult.stderr.toLowerCase();
    const isConflict =
        stderr.includes('rejected') ||
        stderr.includes('non-fast-forward') ||
        stderr.includes('[rejected]');

    if (!isConflict) {
        console.error('[GitPush] Push failed (not a conflict):', stripCreds(pushResult.stderr));
        return { success: false, message: `Push failed: ${stripCreds(pushResult.stderr)}` };
    }

    // --- Conflict resolution ---
    console.log('[GitPush] Conflict detected. Attempting resolution...');
    let savedContent = null;
    try {
        savedContent = fs.readFileSync(coverageFilePath, 'utf8');
    } catch {
        console.error('[GitPush] Could not read coverage file for re-apply.');
        return { success: false, message: 'Conflict detected but could not read coverage file to re-apply.' };
    }

    // 2. Undo our commit so we can sync with remote
    console.log('[GitPush] Undoing local commit...');
    await runGitCommand(['reset', '--hard', 'HEAD~1'], clonePath);

    // 3. Fetch latest from remote
    console.log('[GitPush] Fetching latest from remote...');
    const fetchArgs = authUrl
        ? ['fetch', authUrl, branch]
        : ['fetch', 'origin', branch];
    await runGitCommand(fetchArgs, clonePath);

    // 4. Reset hard to remote HEAD
    console.log(`[GitPush] Resetting hard to origin/${branch}...`);
    const resetResult = await runGitCommand(['reset', '--hard', `origin/${branch}`], clonePath);
    if (!resetResult.success) {
        console.log('[GitPush] origin branch not found, trying FETCH_HEAD...');
        await runGitCommand(['reset', '--hard', `FETCH_HEAD`], clonePath);
    }

    // 5. Re-write our coverage file
    console.log('[GitPush] Re-writing coverage file...');
    try {
        const metaDir = path.dirname(coverageFilePath);
        if (!fs.existsSync(metaDir)) fs.mkdirSync(metaDir, { recursive: true });
        fs.writeFileSync(coverageFilePath, savedContent, 'utf8');
    } catch (e) {
        console.error('[GitPush] Re-write failed:', e.message);
        return { success: false, message: `Failed to re-write coverage file after conflict: ${e.message}` };
    }

    // 6. Stage + commit + push again
    console.log('[GitPush] Re-committing and retrying push...');
    await runGitCommand(['add', '-f', '--', coverageFileRelative], clonePath);
    await runGitCommand(['commit', '-m', `"${COMMIT_MSG}"`, '--allow-empty'], clonePath);

    const retryPushResult = await runGitCommand(pushArgs, clonePath);
    if (retryPushResult.success) {
        console.log('[GitPush] Push successful after resolution.');
        return { success: true, message: 'Coverage report pushed (conflict resolved).' };
    }

    console.error('[GitPush] Retry push failed:', stripCreds(retryPushResult.stderr));
    return {
        success: false,
        message: `Push failed after conflict resolution: ${stripCreds(retryPushResult.stderr)}`
    };
}

module.exports = {
    cloneAndTest,
    runGitCommand,
    runTests,
    findTestFiles,
    parseJestOutput,
    mapCoverageSummaryFiles,
    resolveJestSpawn,
    resolveNodeExecutable,
    clearCoverageOutput,
    pushCoverageReport
};
