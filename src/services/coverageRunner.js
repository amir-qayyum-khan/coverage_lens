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
                    // Skip common non-source directories
                    if (!['node_modules', '__tests__', 'coverage', 'dist', 'build', 'i18n'].includes(item)) {
                        walk(fullPath);
                    }
                } else if (stat.isFile() && item.endsWith('.js')) {
                    // Skip test files
                    if (!item.endsWith('.test.js') && !item.endsWith('.spec.js')) {
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
 * Run Jest with coverage on a folder
 * @param {string} folderPath - Path to the folder containing cases/files to analyze
 * @returns {Promise<object>} - Coverage results
 */
async function runCoverage(folderPath) {
    return new Promise((resolve, reject) => {
        // Find the nearest package root to run Jest from
        const projectRoot = findNearestPackageRoot(folderPath);

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

        // Check if node_modules exists
        const nodeModulesPath = path.join(projectRoot, 'node_modules');
        if (!fs.existsSync(nodeModulesPath)) {
            console.warn('node_modules not found in:', projectRoot);
            resolve({
                success: true,
                hasCoverage: false,
                message: 'Dependencies not installed. Run "npm install" in the project folder first.',
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

        // Check if jest is available
        const jestBinPath = path.join(projectRoot, 'node_modules', '.bin', 'jest');
        const jestPath = fs.existsSync(jestBinPath) || fs.existsSync(jestBinPath + '.cmd') ? jestBinPath : 'jest';

        // Coverage output directory (in the project root/coverage)
        const coverageDir = path.join(projectRoot, 'coverage_temp');

        // Make folderPath relative to projectRoot for collectCoverageFrom
        const relativeFolderPath = path.relative(projectRoot, folderPath);

        // Normalize slashes for Jest glob (must use forward slashes even on Windows)
        const posixPath = relativeFolderPath.split(path.sep).join('/');
        const globPattern = posixPath ? `${posixPath}/**/*.js` : '**/*.js';

        // Get all source files in the folder for --findRelatedTests
        const sourceFiles = getSourceFilesInFolder(folderPath);
        console.log(`[CoverageRunner] Found ${sourceFiles.length} source files in folder`);

        // Run jest with coverage
        const jestArgs = [
            '--coverage',
            '--coverageReporters=json-summary',
            '--coverageReporters=json',
            `--coverageDirectory=${coverageDir}`,
            `--collectCoverageFrom=${globPattern}`,
            `--collectCoverageFrom=!**/*.test.js`,
            `--collectCoverageFrom=!**/*.spec.js`,
            `--collectCoverageFrom=!**/__tests__/**`,
            `--collectCoverageFrom=!**/i18n/**`,
            '--passWithNoTests',
            '--silent'
        ];

        // Add --findRelatedTests to only run tests related to our source files
        // This dramatically speeds up execution by not running all project tests
        if (sourceFiles.length > 0) {
            jestArgs.push('--findRelatedTests', ...sourceFiles);
        }

        console.log(`[CoverageRunner] Project Root: ${projectRoot}`);
        console.log(`[CoverageRunner] Folder Path: ${folderPath}`);
        console.log(`[CoverageRunner] Glob Pattern: ${globPattern}`);
        console.log(`[CoverageRunner] Executing: ${jestPath} ${jestArgs.slice(0, 10).join(' ')}...`);

        const jest = spawn(jestPath, jestArgs, {
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

        jest.on('close', (code) => {
            // Try to read coverage summary
            const coverageSummaryPath = path.join(coverageDir, 'coverage-summary.json');

            try {
                if (fs.existsSync(coverageSummaryPath)) {
                    const fullSummary = JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf8'));
                    const summary = fullSummary.total;

                    const files = [];
                    for (const [filePath, fileData] of Object.entries(fullSummary)) {
                        if (filePath === 'total') continue;

                        const relativePath = path.relative(folderPath, filePath);

                        // Only include files that are actually inside our analyzed folder
                        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
                            continue;
                        }

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
    formatMissingLines
};
