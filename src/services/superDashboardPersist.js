const path = require('path');
const fs = require('fs');

const CODE_ANALYZER_META_DIR = '.code-analyzer';
const SUPER_DASHBOARD_JEST_FILE = 'super-dashboard-jest.json';

/**
 * Persist Jest + coverage totals under <repoRoot>/.code-analyzer/ (on disk; survives app restart).
 * @param {string} repoRoot - Folder that owns the metadata (selected clone root or Code Analysis folder)
 * @param {string|null|undefined} branch
 * @param {string} jestProjectRoot - Directory where Jest ran
 * @param {object} results - Parsed test + coverage results (or code-analysis shape with reportSource)
 * @returns {string|null} - Written file path or null
 */
function writeSuperDashboardJestSummary(repoRoot, branch, jestProjectRoot, results) {
    try {
        const metaDir = path.join(repoRoot, CODE_ANALYZER_META_DIR);
        fs.mkdirSync(metaDir, { recursive: true });
        const total = results.coverage?.total;
        const payload = {
            version: 1,
            generatedAt: new Date().toISOString(),
            clonePath: repoRoot,
            jestProjectRoot,
            branch: branch != null ? branch : null,
            reportSource: results.reportSource || 'clone-test',
            tests: {
                totalTests: results.totalTests,
                passedTests: results.passedTests,
                failedTests: results.failedTests,
                testSuites: results.testSuites,
                success: results.success,
                exitCode: results.exitCode
            },
            coverage: total
                ? {
                    lines: total.lines,
                    statements: total.statements,
                    branches: total.branches,
                    functions: total.functions
                }
                : null
        };
        const outPath = path.join(metaDir, SUPER_DASHBOARD_JEST_FILE);
        fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
        return outPath;
    } catch (e) {
        console.warn('[superDashboardPersist] super-dashboard summary write failed:', e.message);
        return null;
    }
}

/**
 * @param {string} repoRoot
 * @returns {{ lines?: object, statements?: object, branches?: object }|null}
 */
function readSuperDashboardJestSummary(repoRoot) {
    const filePath = path.join(repoRoot, CODE_ANALYZER_META_DIR, SUPER_DASHBOARD_JEST_FILE);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const cov = raw && raw.coverage;
        if (!cov || typeof cov !== 'object') {
            return null;
        }
        return {
            lines: cov.lines,
            statements: cov.statements,
            branches: cov.branches
        };
    } catch (e) {
        console.warn('[superDashboardPersist] super-dashboard summary read failed:', e.message);
        return null;
    }
}

/**
 * @param {string[]} clonePaths
 * @returns {{ metrics: Record<string, object>, skipped: string[] }}
 */
function loadCachedSuperDashboardMetrics(clonePaths) {
    const metrics = {};
    const skipped = [];
    if (!Array.isArray(clonePaths)) {
        return { metrics, skipped };
    }
    for (const p of clonePaths) {
        if (!p || typeof p !== 'string') continue;
        const trimmed = p.trim();
        if (!trimmed) continue;
        let dirPath = trimmed;
        try {
            dirPath = path.resolve(trimmed);
        } catch {
            // keep trimmed
        }
        try {
            if (!fs.existsSync(dirPath)) {
                skipped.push(trimmed);
                continue;
            }
            const stat = fs.statSync(dirPath);
            if (!stat.isDirectory()) {
                skipped.push(trimmed);
                continue;
            }
            const key = path.basename(dirPath);
            if (!key) continue;
            const block = readSuperDashboardJestSummary(dirPath);
            if (block) {
                metrics[key] = block;
            } else {
                skipped.push(trimmed);
            }
        } catch (e) {
            console.warn('[superDashboardPersist] loadCachedSuperDashboardMetrics skip:', trimmed, e.message);
            skipped.push(trimmed);
        }
    }
    return { metrics, skipped };
}

module.exports = {
    CODE_ANALYZER_META_DIR,
    SUPER_DASHBOARD_JEST_FILE,
    writeSuperDashboardJestSummary,
    readSuperDashboardJestSummary,
    loadCachedSuperDashboardMetrics
};
