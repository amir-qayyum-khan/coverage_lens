const path = require('path');
const fs = require('fs');
const {
    isFullSourceTreeScope,
    findSourceRootUnder,
    resolveJestCoverageScope
} = require('./sourceRoot');

const MAX_SOURCE_FILES_THROTTLE = 150;
const BATCH_SKIP_DIRS = ['node_modules', '__tests__', '__test__', '__mocks__', 'i18n', 'config', 'coverage', 'dist', 'build'];

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
 * Build --testPathPattern value for a coverage scope.
 * @param {string} scopeRelativeToRoot
 * @returns {string|null}
 */
function buildTestPathPattern(scopeRelativeToRoot) {
    const scope = (scopeRelativeToRoot || '').replace(/\\/g, '/').trim();
    if (!scope) return null;
    return escapeForJestTestPathPattern(scope);
}

/**
 * Jest scopes for coverage runs. Large full-`src` trees split by immediate child folder.
 * @param {string} projectRoot
 * @param {string} targetAnalysisPath
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
    } catch {
        return [scope];
    }

    if (batches.length === 0) {
        return [scope];
    }

    return batches;
}

/**
 * List immediate child folder scopes under src for hybrid batch fallback (ignores file-count throttle).
 * @param {string} projectRoot
 * @returns {string[]}
 */
function getHybridBatchScopes(projectRoot) {
    const srcPath = findSourceRootUnder(projectRoot);
    if (!srcPath || !fs.existsSync(srcPath)) {
        return [''];
    }

    const batches = [];
    try {
        const entries = fs.readdirSync(srcPath, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory() || BATCH_SKIP_DIRS.includes(entry.name)) continue;
            batches.push(resolveJestCoverageScope(projectRoot, path.join(srcPath, entry.name)));
        }
    } catch {
        return [''];
    }

    return batches.length > 0 ? batches : [''];
}

module.exports = {
    getBatchScopes,
    getHybridBatchScopes,
    buildTestPathPattern,
    escapeForJestTestPathPattern,
    MAX_SOURCE_FILES_THROTTLE
};
