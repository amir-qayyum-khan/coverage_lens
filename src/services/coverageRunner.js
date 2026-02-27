const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

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
    const configNames = ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs'];

    while (current !== path.parse(current).root) {
        for (const name of configNames) {
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
 * This identifies the true test root of a project where coverage can be run.
 * @param {string} startPath - Path to start searching from
 * @returns {string|null} - Path to the directory containing both files, or null
 */
function findTestRoot(startPath) {
    const jestConfigNames = ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs'];
    const skipDirs = ['node_modules', '.git', 'dist', 'build', 'coverage', 'coverage_temp'];

    /**
     * Check if a directory contains both package.json and a jest config file
     */
    function hasBothFiles(dirPath) {
        const hasPackageJson = fs.existsSync(path.join(dirPath, 'package.json'));
        if (!hasPackageJson) return false;

        return jestConfigNames.some(name => fs.existsSync(path.join(dirPath, name)));
    }

    // First check the startPath itself
    if (hasBothFiles(startPath)) {
        return startPath;
    }

    // Recursively search subdirectories (breadth-first)
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

            // Search deeper
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
                    // Skip common non-source directories - Sync with codeAnalyzer.js
                    const ignoreFolders = ['node_modules', '__tests__', 'coverage', 'dist', 'build', 'i18n', '.git', 'public', 'assets', '__mocks__', 'config'];
                    if (!ignoreFolders.includes(item)) {
                        walk(fullPath);
                    }
                } else if (stat.isFile() && (item.endsWith('.js') || item.endsWith('.jsx'))) {
                    // Skip test and config files - Sync with codeAnalyzer.js
                    const ignoreFiles = ['setupTests.js', 'webpack.config.js', 'babel.config.js', 'postBuild.js', 'babelDev.js', 'babelProd.js'];
                    if (!item.endsWith('.test.js') && !item.endsWith('.spec.js') && !item.endsWith('.test.jsx') && !item.endsWith('.spec.jsx') && !ignoreFiles.includes(item)) {
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
 * Get all test files (*.test.js, *.spec.js, files in __tests__) in a folder recursively
 * @param {string} folderPath - Path to search
 * @returns {string[]} - Array of absolute test file paths
 */
function getTestFilesInFolder(folderPath) {
    const files = [];

    function walk(dir) {
        try {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stat = fs.statSync(fullPath);

                if (stat.isDirectory()) {
                    if (item === 'node_modules' || item === '.git' || item === 'coverage' || item === 'dist' || item === 'build') continue;
                    walk(fullPath);
                } else if (stat.isFile() && (item.endsWith('.test.js') || item.endsWith('.spec.js') || item.endsWith('.test.jsx') || item.endsWith('.spec.jsx'))) {
                    files.push(fullPath);
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
 * Run Jest with coverage on a folder
 * @param {string} folderPath - Path to the folder containing cases/files to analyze
 * @returns {Promise<object>} - Coverage results
 */
async function runCoverage(folderPath) {
    return new Promise((resolve, reject) => {
        // Find the test root: a directory with both package.json and jest.config.js
        let projectRoot = findTestRoot(folderPath);

        if (projectRoot) {
            console.log(`[CoverageRunner] Found test root (package.json + jest.config) at: ${projectRoot}`);
        } else {
            // Fallback: find nearest package.json walking upward
            console.log(`[CoverageRunner] No co-located package.json + jest.config found, falling back to nearest package root`);
            projectRoot = findNearestPackageRoot(folderPath);
        }

        if (!projectRoot) {
            console.warn('No package.json found in or above folder:', folderPath);
            resolve({
                success: true,
                hasCoverage: false,
                message: 'No package.json found in or above the selected folder.',
                files: [],
                summary: {
                    lines: { total: 0, covered: 0, pct: 0 },
                    statements: { total: 0, covered: 0, pct: 0 },
                    functions: { total: 0, covered: 0, pct: 0 },
                    branches: { total: 0, covered: 0, pct: 0 }
                }
            });
            return;
        }

        console.log(`Running coverage from project root: ${projectRoot} for folder: ${folderPath}`);

        // Check if node_modules exists - if not, auto-install before running coverage
        const nodeModulesPath = path.join(projectRoot, 'node_modules');
        const hasNodeModules = fs.existsSync(nodeModulesPath);
        if (!hasNodeModules) {
            console.log(`[CoverageRunner] node_modules not found at ${nodeModulesPath}, running npm install --legacy-peer-deps...`);
            const { spawnSync } = require('child_process');
            const installResult = spawnSync('npm', ['install', '--legacy-peer-deps'], {
                cwd: projectRoot,
                shell: true,
                stdio: 'inherit',
                env: { ...process.env }
            });
            if (installResult.status !== 0) {
                console.error(`[CoverageRunner] npm install failed with code ${installResult.status}`);
                resolve({
                    success: false,
                    hasCoverage: false,
                    error: 'npm install --legacy-peer-deps failed. Check the project for dependency issues.',
                    files: [],
                    summary: {
                        lines: { total: 0, covered: 0, pct: 0 },
                        statements: { total: 0, covered: 0, pct: 0 },
                        functions: { total: 0, covered: 0, pct: 0 },
                        branches: { total: 0, covered: 0, pct: 0 }
                    }
                });
                return;
            }
            console.log(`[CoverageRunner] npm install completed successfully, proceeding with coverage...`);
        }

        // Use the local jest binary (node_modules guaranteed to exist at this point)
        const jestBinPath = path.join(projectRoot, 'node_modules', '.bin', 'jest');

        // Coverage output directory (in the project root)
        const coverageDir = path.join(projectRoot, 'coverage_temp');

        // Determine where the actual source lives.
        // Priority: src/ inside projectRoot > src/ inside folderPath > projectRoot itself.
        // This handles the common case where projectRoot is a subdirectory of folderPath
        // (e.g. folderPath=TrapezeDRTCoreUI, projectRoot=TrapezeDRTCoreUI/source).
        let targetAnalysisPath;
        const srcInProjectRoot = path.join(projectRoot, 'src');
        const srcInFolderPath = path.join(folderPath, 'src');
        if (fs.existsSync(srcInProjectRoot) && fs.statSync(srcInProjectRoot).isDirectory()) {
            console.log(`[CoverageRunner] src directory detected inside projectRoot, focusing analysis on: ${srcInProjectRoot}`);
            targetAnalysisPath = srcInProjectRoot;
        } else if (fs.existsSync(srcInFolderPath) && fs.statSync(srcInFolderPath).isDirectory()) {
            console.log(`[CoverageRunner] src directory detected inside folderPath, focusing analysis on: ${srcInFolderPath}`);
            targetAnalysisPath = srcInFolderPath;
        } else {
            targetAnalysisPath = projectRoot;
        }

        // Build glob relative to projectRoot (Jest resolves collectCoverageFrom relative to rootDir/projectRoot).
        // Using path.relative(projectRoot, targetAnalysisPath) avoids the broken `../**/*.js` pattern
        // that occurs when folderPath is a parent of projectRoot.
        const relativeToRoot = path.relative(projectRoot, targetAnalysisPath).split(path.sep).join('/');
        const globPattern = relativeToRoot ? `${relativeToRoot}/**/*.{js,jsx}` : '**/*.{js,jsx}';

        // Get all source files in targetAnalysisPath for --findRelatedTests
        const sourceFiles = getSourceFilesInFolder(targetAnalysisPath);
        console.log(`[CoverageRunner] Found ${sourceFiles.length} source files in ${targetAnalysisPath}`);

        // Create a temporary Jest config that overrides collectCoverageFrom
        // This is necessary because the project's jest.config.js settings override CLI arguments
        const tempConfigPath = path.join(projectRoot, 'jest.config.coverage-temp.js');
        const projectConfigPath = findNearestJestConfig(projectRoot) || path.join(projectRoot, 'jest.config.js');

        // Build config content that extends the existing config but overrides coverage settings
        // We use the absolute path for require to ensure it works regardless of where the config is
        const escapedProjectConfigPath = projectConfigPath.replace(/\\/g, '/');
        const tempConfigContent = `
// Temporary config generated by code-analyzer for folder-specific coverage
const baseConfig = fs.existsSync('${escapedProjectConfigPath}') ? require('${escapedProjectConfigPath}') : {};

module.exports = {
    ...baseConfig,
    bail: 0,
    collectCoverage: true,
    collectCoverageFrom: [
        '${globPattern}',
        '!**/*.test.js',
        '!**/*.spec.js',
        '!**/__tests__/**',
        '!**/i18n/**',
        '!**/*.css',
        '!**/*.scss',
        '!**/*.less',
        '!**/*.html',
        '!**/*.json',
        '!**/*.svg',
        '!**/*.png',
        '!**/*.jpg'
    ],
    coverageDirectory: '${coverageDir.replace(/\\/g, '/')}',
    coverageReporters: ['json-summary', 'json'],
    // Disable coverage threshold and bail so failing tests never block coverage output
    coverageThreshold: undefined
};
`;
        fs.writeFileSync(tempConfigPath, `const fs = require('fs');\n${tempConfigContent}`, 'utf8');
        console.log(`[CoverageRunner] Created temp config: ${tempConfigPath} using base: ${projectConfigPath}`);

        // Run jest with the temporary config
        // For small projects: --findRelatedTests with source files (runs only relevant tests)
        // For large projects: pass test files directly as positional args (avoids running all project tests)
        // Windows cmd line limit ~8191 chars; 150 source files is a safe ceiling for --findRelatedTests
        const MAX_RELATED_FILES = 150;
        const isLargeProject = sourceFiles.length > MAX_RELATED_FILES;

        // Workers: limit to 2 for large projects to avoid OOM when instrumenting many files
        const maxWorkers = isLargeProject ? '--maxWorkers=2' : '--maxWorkers=50%';

        const jestArgs = [
            `--config=${tempConfigPath}`,
            '--coverage',
            '--passWithNoTests',
            '--forceExit',
            maxWorkers
        ];

        if (!isLargeProject && sourceFiles.length > 0) {
            // Small project: find related tests from source files
            jestArgs.push('--findRelatedTests', ...sourceFiles);
            console.log(`[CoverageRunner] Small project: using --findRelatedTests with ${sourceFiles.length} source files`);
        } else {
            // Large project: just pass the target folder path to Jest.
            // Jest will automatically find and run all tests within that folder.
            // This avoids the "Command line is too long" error on Windows.
            // Normalize path for Windows/Jest compatibility
            const normalizedTargetDir = targetAnalysisPath.split(path.sep).join('/');
            console.log(`[CoverageRunner] Large project: passing target folder directly to Jest: ${normalizedTargetDir}`);
            jestArgs.push(normalizedTargetDir);
        }

        console.log(`[CoverageRunner] Project Root: ${projectRoot}`);
        console.log(`[CoverageRunner] Folder Path: ${folderPath}`);
        console.log(`[CoverageRunner] Glob Pattern: ${globPattern}`);
        console.log(`[CoverageRunner] Workers: ${maxWorkers}`);
        console.log(`[CoverageRunner] Executing: ${jestBinPath} ${jestArgs.slice(0, 5).join(' ')}...`);

        const command = jestBinPath;
        const spawnArgs = jestArgs;

        console.log(`[CoverageRunner] Using local jest binary`);

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

        jest.on('close', (code, signal) => {
            console.log(`[CoverageRunner] Jest exited with code=${code} signal=${signal}`);

            // Clean up temporary config file
            try {
                if (fs.existsSync(tempConfigPath)) {
                    fs.unlinkSync(tempConfigPath);
                    console.log(`[CoverageRunner] Cleaned up temp config`);
                }
            } catch (cleanupErr) {
                console.warn(`[CoverageRunner] Failed to clean up temp config: ${cleanupErr.message}`);
            }

            // Try to read coverage summary
            const coverageSummaryPath = path.join(coverageDir, 'coverage-summary.json');

            try {
                if (fs.existsSync(coverageSummaryPath)) {
                    const fullSummary = JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf8'));
                    const summary = fullSummary.total;

                    // Get realpath of folderPath for robust matching
                    let realFolderPath = folderPath;
                    try {
                        realFolderPath = fs.realpathSync(folderPath);
                    } catch (e) {
                        console.warn(`[CoverageRunner] Failed to get realpath for folderPath: ${folderPath}`);
                    }
                    const normalizedFolderPath = realFolderPath.toLowerCase().replace(/\\/g, '/');

                    // Debug: Log actual coverage paths
                    const files = [];
                    const coverageKeys = Object.keys(fullSummary).filter(k => k !== 'total');
                    console.log(`[CoverageRunner] DEBUG - Coverage file count: ${coverageKeys.length}`);
                    console.log(`[CoverageRunner] DEBUG - Looking for folder: ${normalizedFolderPath}`);

                    for (const [filePath, fileData] of Object.entries(fullSummary)) {
                        if (filePath === 'total') continue;

                        // Get realpath of individual file for comparison
                        let realFilePath = filePath;
                        try {
                            realFilePath = fs.realpathSync(filePath);
                        } catch (e) {
                            // keep original path if realpath fails
                        }

                        // Normalize the coverage file path for comparison
                        const normalizedFilePath = realFilePath.toLowerCase().replace(/\\/g, '/');

                        // Check if this file is inside our analyzed folder using normalized paths
                        if (!normalizedFilePath.startsWith(normalizedFolderPath) && !normalizedFilePath.includes(normalizedFolderPath)) {
                            continue;
                        }

                        // Calculate relative path using original filePath for display
                        const relativePath = path.relative(folderPath, filePath);

                        files.push({
                            filePath,
                            relativePath,
                            fileName: path.basename(filePath),
                            lines: fileData.lines,
                            statements: fileData.statements,
                            // We still need detailed JSON for missing lines
                            missingLines: []
                        });
                    }

                    // Try to augment with missing lines from detailed JSON if it exists
                    const coverageJsonPath = path.join(coverageDir, 'coverage-final.json');
                    if (fs.existsSync(coverageJsonPath)) {
                        const detailed = JSON.parse(fs.readFileSync(coverageJsonPath, 'utf8'));
                        files.forEach(file => {
                            const detailedData = detailed[file.filePath];
                            if (detailedData) {
                                file.missingLines = getMissingLines(detailedData);
                            }
                        });
                    }

                    console.log(`[CoverageRunner] Matched ${files.length} files within the selected folder.`);

                    resolve({
                        success: true,
                        hasCoverage: true,
                        files,
                        summary: summary,
                        rawOutput: stdout,
                        message: files.length === 0 ? `No coverage match found for files in: ${folderPath}` : ''
                    });
                } else {
                    console.warn(`[CoverageRunner] No coverage-summary.json found at: ${coverageSummaryPath}`);
                    console.warn(`[CoverageRunner] Jest exit code: ${code}`);
                    if (stderr) console.warn(`[CoverageRunner] Jest stderr:\n${stderr.slice(0, 2000)}`);
                    if (stdout) console.log(`[CoverageRunner] Jest stdout:\n${stdout.slice(0, 2000)}`);
                    resolve({
                        success: true,
                        hasCoverage: false,
                        message: 'No coverage data generated',
                        files: [],
                        summary: {
                            lines: { total: 0, covered: 0, pct: 0 },
                            statements: { total: 0, covered: 0, pct: 0 },
                            functions: { total: 0, covered: 0, pct: 0 },
                            branches: { total: 0, covered: 0, pct: 0 }
                        },
                        rawOutput: stdout,
                        errorOutput: stderr
                    });
                }
            } catch (error) {
                resolve({
                    success: false,
                    hasCoverage: false,
                    error: error.message,
                    files: [],
                    summary: {
                        lines: { total: 0, covered: 0, pct: 0 },
                        statements: { total: 0, covered: 0, pct: 0 },
                        functions: { total: 0, covered: 0, pct: 0 },
                        branches: { total: 0, covered: 0, pct: 0 }
                    }
                });
            }
        });

        jest.on('error', (error) => {
            resolve({
                success: false,
                hasCoverage: false,
                error: error.message,
                files: [],
                summary: {
                    lines: { total: 0, covered: 0, pct: 0 },
                    statements: { total: 0, covered: 0, pct: 0 },
                    functions: { total: 0, covered: 0, pct: 0 },
                    branches: { total: 0, covered: 0, pct: 0 }
                }
            });
        });
    });
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
    findTestRoot
};
