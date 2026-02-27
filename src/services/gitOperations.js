const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

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
 * @returns {Promise<{success: boolean, message: string, branch: string|null, testResults: object|null}>}
 */
async function cloneAndTest(repoUrl, targetDir, onProgress, credentials) {
    const repoName = path.basename(repoUrl, '.git');
    const clonePath = path.join(targetDir, repoName);

    const sendProgress = (stage, message, percent) => {
        if (onProgress) {
            onProgress({ stage, message, percent, repoName });
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

        // Step 3: Try checkout developV2 first (high priority), then develop
        sendProgress('checkout', 'Trying to checkout developV2...', 45);
        let branch = 'developV2';

        // Try to checkout existing or track from origin
        let checkoutResult = await runGitCommand(['checkout', 'developV2'], clonePath);

        if (!checkoutResult.success) {
            // Try to create/track from remote if it exists but not locally
            checkoutResult = await runGitCommand(['checkout', '-b', 'developV2', 'origin/developV2'], clonePath);

            if (!checkoutResult.success) {
                sendProgress('checkout', 'developV2 not found, trying develop...', 50);
                branch = 'develop';
                checkoutResult = await runGitCommand(['checkout', 'develop'], clonePath);

                if (!checkoutResult.success) {
                    checkoutResult = await runGitCommand(['checkout', '-b', 'develop', 'origin/develop'], clonePath);

                    if (!checkoutResult.success) {
                        return {
                            success: false,
                            message: `Neither developV2 nor develop branch found: ${checkoutResult.stderr}`,
                            branch: null,
                            testResults: null
                        };
                    }
                }
            }
        }

        sendProgress('checkout', `Checked out ${branch}`, 55);

        // Step 5: Install dependencies if node_modules missing or pull happened
        sendProgress('installing_deps', 'Checking dependencies...', 75);
        const { installPackages } = require('./nodeInstaller');
        const installResult = await installPackages(clonePath, sendProgress);
        if (!installResult.success) {
            sendProgress('installing_deps', `Install warning: ${installResult.message}`, 80);
        }
        sendProgress('installing_deps', 'Dependencies ready', 85);

        // Step 6: Run unit tests using npx jest on src folder
        sendProgress('testing', 'Running unit tests...', 90);
        const testResults = await runTests(clonePath, sendProgress);

        sendProgress('complete', `Done! Branch: ${branch}`, 100);

        return {
            success: true,
            message: `Successfully cloned, checked out ${branch}, and ran tests`,
            branch,
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
 * Run unit tests on a cloned repo's src folder using npx jest
 * Same logic as coverageRunner.js
 * @param {string} projectRoot - Path to the project root
 * @param {function} sendProgress - Progress callback
 * @returns {Promise<object>} - Test results summary
 */
function runTests(projectRoot, sendProgress) {
    return new Promise((resolve) => {
        const srcPath = path.join(projectRoot, 'src');

        // Check if src exists
        if (!fs.existsSync(srcPath)) {
            resolve({
                success: false,
                message: 'No src folder found',
                totalTests: 0,
                passedTests: 0,
                failedTests: 0,
                testSuites: 0
            });
            return;
        }

        // Find test files in src
        const testFiles = findTestFiles(srcPath);
        if (testFiles.length === 0) {
            resolve({
                success: true,
                message: 'No test files found in src/',
                totalTests: 0,
                passedTests: 0,
                failedTests: 0,
                testSuites: 0
            });
            return;
        }

        sendProgress('testing', `Found ${testFiles.length} test file(s), running...`, 80);

        // Check if local jest exists
        const jestBinPath = path.join(projectRoot, 'node_modules', '.bin', 'jest');
        const hasLocalJest = fs.existsSync(jestBinPath) || fs.existsSync(jestBinPath + '.cmd');
        const useNpx = !hasLocalJest;

        const jestArgs = [
            '--coverage',
            '--collectCoverageFrom="src/**/*.js"',
            '--coverageReporters=json-summary',
            '--coverageReporters=text',
            '--passWithNoTests',
            '--forceExit',
            '--detectOpenHandles',
            '--maxWorkers=50%'
        ];

        const command = useNpx ? 'npx' : jestBinPath;
        const spawnArgs = useNpx ? ['--yes', 'jest', ...jestArgs] : jestArgs;

        const jest = spawn(command, spawnArgs, {
            cwd: projectRoot,
            shell: true,
            env: { ...process.env, CI: 'true' }
        });

        let stdout = '';
        let stderr = '';

        jest.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        jest.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        jest.on('close', async (code) => {
            // Parse Jest output for basic result
            const results = parseJestOutput(stdout + '\n' + stderr);
            results.exitCode = code;
            results.success = code === 0;

            // Try to read coverage summary for detailed stats
            const coverageSummaryPath = path.join(projectRoot, 'coverage', 'coverage-summary.json');
            try {
                if (fs.existsSync(coverageSummaryPath)) {
                    const fullSummary = JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf8'));
                    results.coverage = {
                        total: fullSummary.total,
                        files: Object.entries(fullSummary)
                            .filter(([key]) => key !== 'total')
                            .map(([filePath, data]) => ({
                                fileName: path.basename(filePath),
                                relativePath: path.relative(projectRoot, filePath),
                                lines: data.lines,
                                branches: data.branches,
                                statements: data.statements
                            }))
                    };
                }
            } catch (covErr) {
                console.warn('Failed to parse coverage summary:', covErr.message);
            }

            // DO NOT include rawOutput or any deep structures to avoid Electron bridge issues
            resolve(results);
        });

        jest.on('error', (err) => {
            resolve({
                success: false,
                message: `Failed to run tests: ${err.message}`,
                totalTests: 0,
                passedTests: 0,
                failedTests: 0,
                testSuites: 0
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
                    if (item.endsWith('.test.js') || item.endsWith('.spec.js')) {
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

module.exports = {
    cloneAndTest,
    runTests,
    findTestFiles,
    parseJestOutput
};
