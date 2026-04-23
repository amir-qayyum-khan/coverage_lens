const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { findJestProjectRoot } = require('./coverageRunner');
const { writeSuperDashboardJestSummary } = require('./superDashboardPersist');

/**
 * Run a git command and return its output
 * @param {string[]} args - Git command arguments
 * @param {string} cwd - Working directory
 * @param {number} [timeout=120000] - Timeout in ms
 * @returns {Promise<{success: boolean, stdout: string, stderr: string}>}
 */
function runGitCommand(args, cwd, timeout = 120000) {
    return new Promise((resolve) => {
        const git = spawn('git', args, {
            cwd,
            shell: true,
            timeout
        });

        let stdout = '';
        let stderr = '';

        git.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        git.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        git.on('close', (code) => {
            resolve({
                success: code === 0,
                stdout: stdout.trim(),
                stderr: stderr.trim()
            });
        });

        git.on('error', (err) => {
            resolve({
                success: false,
                stdout: '',
                stderr: err.message
            });
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
 * @returns {Promise<{success: boolean, message: string, branch: string|null, testResults: object|null}>}
 */
async function cloneAndTest(repoUrl, targetDir, onProgress, credentials, branch, progressKey) {
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

    try {
        // Step 1: Clone
        sendProgress('cloning', `Cloning ${repoName}...`, 10);

        if (fs.existsSync(clonePath)) {
            // If already cloned, just cd into it
            sendProgress('cloning', `Repository already exists at ${clonePath}, using existing...`, 15);
        } else {
            const cloneResult = await runGitCommand(['clone', authRepoUrl, clonePath], targetDir, 300000);
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
        const fetchResult = await runGitCommand(['fetch', 'origin'], clonePath);
        if (!fetchResult.success) {
            sendProgress('fetching', `Fetch warning: ${fetchResult.stderr}`, 35);
        }
        sendProgress('fetching', 'Fetch complete', 40);

        // Step 3: Try checkout the specified branch (default to master)
        const targetBranch = branch || 'master';
        sendProgress('checkout', `Trying to checkout ${targetBranch}...`, 45);

        // Try to checkout existing or track from origin
        let checkoutResult = await runGitCommand(['checkout', targetBranch], clonePath);

        if (!checkoutResult.success) {
            // Try to create/track from remote if it exists but not locally
            checkoutResult = await runGitCommand(['checkout', '-b', targetBranch, `origin/${targetBranch}`], clonePath);

            if (!checkoutResult.success) {
                // If the user specified a branch and it failed, we should probably stop here
                // but if they didn't, we might want to try other defaults? 
                // For now, let's just fail if the target branch (master or provided) doesn't exist.
                return {
                    success: false,
                    message: `Branch ${targetBranch} not found: ${checkoutResult.stderr}`,
                    branch: null,
                    testResults: null
                };
            }
        }

        const activeBranch = targetBranch;

        sendProgress('checkout', `Checked out ${activeBranch}`, 55);

        // Step 5: Install dependencies at clone root and/or nested Jest package (monorepos / inner package.json)
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

        // Step 6: Run Jest from discovered project root (package.json + jest config / Jest dependency)
        sendProgress('testing', 'Running unit tests...', 90);
        const testResults = await runTests(clonePath, sendProgress, activeBranch);

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
 * Resolve how to invoke Jest for a package (local binary, node jest.js on Windows, or npx).
 * @param {string} projectRoot - Directory containing node_modules (Jest package root)
 * @returns {{ command: string, args: string[] }}
 */
function resolveJestSpawn(projectRoot) {
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

    const jestArgs = [
        '--coverage',
        '--coverageReporters=json-summary',
        '--coverageReporters=text',
        '--passWithNoTests',
        '--forceExit',
        '--maxWorkers=50%'
    ];

    if (useNodeToExecute) {
        return { command: 'node', args: [jestBinPath, ...jestArgs] };
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
function runTests(clonePath, sendProgress, branch) {
    return new Promise((resolve) => {
        const jestRoot = findJestProjectRoot(clonePath);

        if (!jestRoot) {
            resolve({
                success: false,
                message:
                    'No Jest project found: need package.json with jest.config.* or Jest in dependencies under the clone.',
                totalTests: 0,
                passedTests: 0,
                failedTests: 0,
                testSuites: 0,
                jestProjectRoot: null,
                superDashboardSummaryPath: null
            });
            return;
        }

        const testCandidates = findTestFiles(jestRoot);
        const relRoot = path.relative(clonePath, jestRoot) || '.';
        if (testCandidates.length === 0) {
            sendProgress(
                'testing',
                `Jest root: ${relRoot} — no *.test/*.spec files found; running Jest with --passWithNoTests.`,
                92
            );
        } else {
            sendProgress(
                'testing',
                `Jest root: ${relRoot} — running ${testCandidates.length} test file(s)...`,
                92
            );
        }

        const { command, args: spawnArgs } = resolveJestSpawn(jestRoot);

        const jestChild = spawn(command, spawnArgs, {
            cwd: jestRoot,
            shell: true,
            env: { ...process.env, CI: 'true' }
        });

        let stdout = '';
        let stderr = '';

        jestChild.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        jestChild.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        jestChild.on('close', (code) => {
            const results = parseJestOutput(stdout + '\n' + stderr);
            results.exitCode = code;
            results.success = code === 0;
            results.jestProjectRoot = jestRoot;

            const coverageSummaryPath = path.join(jestRoot, 'coverage', 'coverage-summary.json');
            try {
                if (fs.existsSync(coverageSummaryPath)) {
                    const fullSummary = JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf8'));
                    results.coverage = {
                        total: fullSummary.total,
                        files: Object.entries(fullSummary)
                            .filter(([key]) => key !== 'total')
                            .map(([filePath, data]) => ({
                                fileName: path.basename(filePath),
                                relativePath: path.relative(jestRoot, filePath),
                                lines: data.lines,
                                branches: data.branches,
                                statements: data.statements
                            }))
                    };
                }
            } catch (covErr) {
                console.warn('Failed to parse coverage summary:', covErr.message);
            }

            results.superDashboardSummaryPath = writeSuperDashboardJestSummary(
                clonePath,
                branch,
                jestRoot,
                results
            );

            resolve(results);
        });

        jestChild.on('error', (err) => {
            resolve({
                success: false,
                message: `Failed to run tests: ${err.message}`,
                totalTests: 0,
                passedTests: 0,
                failedTests: 0,
                testSuites: 0,
                jestProjectRoot: jestRoot,
                superDashboardSummaryPath: null
            });
        });
    });
}

/**
 * Find all test files recursively in a directory
 * @param {string} dir
 * @returns {string[]}
 */
function findTestFiles(dir) {
    const files = [];

    function walk(currentDir) {
        try {
            const items = fs.readdirSync(currentDir);
            for (const item of items) {
                const fullPath = path.join(currentDir, item);
                const stat = fs.statSync(fullPath);

                if (stat.isDirectory()) {
                    if (!['node_modules', 'coverage', 'dist', 'build', '.git'].includes(item)) {
                        walk(fullPath);
                    }
                } else if (stat.isFile()) {
                    if (
                        item.endsWith('.test.js') ||
                        item.endsWith('.spec.js') ||
                        item.endsWith('.test.jsx') ||
                        item.endsWith('.spec.jsx')
                    ) {
                        files.push(fullPath);
                    }
                }
            }
        } catch (err) {
            // skip unreadable dirs
        }
    }

    walk(dir);
    return files;
}

/**
 * Parse Jest text output to extract test counts
 * @param {string} output - Raw Jest output text
 * @returns {object}
 */
function parseJestOutput(output) {
    const results = {
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        testSuites: 0,
        passedSuites: 0,
        failedSuites: 0,
        message: ''
    };

    // Match "Tests:       X passed, Y total"
    const testsMatch = output.match(/Tests:\s+(?:(\d+)\s+failed,\s+)?(?:(\d+)\s+skipped,\s+)?(?:(\d+)\s+passed,\s+)?(\d+)\s+total/);
    if (testsMatch) {
        results.failedTests = parseInt(testsMatch[1] || '0', 10);
        results.passedTests = parseInt(testsMatch[3] || '0', 10);
        results.totalTests = parseInt(testsMatch[4] || '0', 10);
    }

    // Match "Test Suites:  X passed, Y total"
    const suitesMatch = output.match(/Test Suites:\s+(?:(\d+)\s+failed,\s+)?(?:(\d+)\s+skipped,\s+)?(?:(\d+)\s+passed,\s+)?(\d+)\s+total/);
    if (suitesMatch) {
        results.failedSuites = parseInt(suitesMatch[1] || '0', 10);
        results.passedSuites = parseInt(suitesMatch[3] || '0', 10);
        results.testSuites = parseInt(suitesMatch[4] || '0', 10);
    }

    if (results.failedTests > 0) {
        results.message = `${results.failedTests} test(s) failed out of ${results.totalTests}`;
    } else if (results.totalTests > 0) {
        results.message = `All ${results.totalTests} tests passed`;
    } else {
        results.message = 'No tests found or executed';
    }

    return results;
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

    // Stage the coverage file (use -f to bypass .gitignore if necessary)
    console.log(`[GitPush] Staging file: ${COVERAGE_FILE}`);
    const addResult = await runGitCommand(['add', '-f', COVERAGE_FILE], clonePath);
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
    const coverageFilePath = path.join(clonePath, '.code-analyzer', 'super-dashboard-jest.json');
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
    await runGitCommand(['add', '-f', COVERAGE_FILE], clonePath);
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
    runTests,
    findTestFiles,
    parseJestOutput,
    resolveJestSpawn,
    pushCoverageReport
};
