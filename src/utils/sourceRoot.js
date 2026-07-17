const path = require('path');
const fs = require('fs');

/**
 * Relative segments from repo root to the main JS source tree (first match wins).
 * Covers CRA-style `src/`, CoreUI-style `source/src/`, and DriverCom-style `source/UI/src/`.
 */
const SOURCE_ROOT_RELATIVE_CANDIDATES = [
    'src',
    path.join('source', 'src'),
    path.join('source', 'UI', 'src')
];

/** Relative paths treated as the full source tree for analyzer targeting / batching. */
const FULL_SOURCE_TREE_SCOPES = new Set(['src', 'source/src', 'source/UI/src']);

/**
 * Find the primary source directory under a base path.
 * @param {string} basePath - Repo root or parent folder
 * @returns {string|null} Absolute path to source tree
 */
function findSourceRootUnder(basePath) {
    if (!basePath || !fs.existsSync(basePath)) return null;

    for (const rel of SOURCE_ROOT_RELATIVE_CANDIDATES) {
        const candidate = path.join(basePath, rel);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
            return candidate;
        }
    }

    const sourceOnly = path.join(basePath, 'source');
    if (fs.existsSync(sourceOnly) && fs.statSync(sourceOnly).isDirectory()) {
        return sourceOnly;
    }

    return null;
}

/**
 * Path relative to project root using forward slashes, or empty string for project root.
 * @param {string} projectRoot
 * @param {string} dirPath
 * @returns {string}
 */
function relativeToProject(projectRoot, dirPath) {
    return path.relative(projectRoot, dirPath).split(path.sep).join('/');
}

/**
 * Resolve which directory to scan/run coverage on.
 * @param {string} folderPath - User-selected folder
 * @param {string} projectRoot - Jest package root
 * @returns {string} Absolute path
 */
function resolveTargetAnalysisPath(folderPath, projectRoot) {
    const projectSourceRoot = findSourceRootUnder(projectRoot);
    const relFolderToProject = relativeToProject(projectRoot, folderPath);
    const isInsideProject =
        relFolderToProject !== '' && !relFolderToProject.startsWith('..') && !path.isAbsolute(relFolderToProject);

    if (!isInsideProject) {
        return findSourceRootUnder(folderPath) || projectSourceRoot || folderPath;
    }

    if (relFolderToProject === '') {
        return projectSourceRoot || folderPath;
    }

    if (projectSourceRoot) {
        const folderResolved = path.resolve(folderPath);
        const rootResolved = path.resolve(projectSourceRoot);
        if (folderResolved.startsWith(rootResolved + path.sep) || folderResolved === rootResolved) {
            return folderPath;
        }
        const parentResolved = path.resolve(path.dirname(projectSourceRoot));
        if (folderResolved === parentResolved || folderResolved === path.resolve(projectRoot, 'source')) {
            return projectSourceRoot;
        }
    }

    return folderPath;
}

/**
 * When folder is repo root or parent of `source/src`, analyze the source tree; otherwise keep selection.
 * @param {string} folderPath
 * @returns {string}
 */
function resolveAnalyzerTargetPath(folderPath) {
    const sourceRoot = findSourceRootUnder(folderPath);
    if (!sourceRoot) return folderPath;

    const folderResolved = path.resolve(folderPath);
    const rootResolved = path.resolve(sourceRoot);

    if (folderResolved === rootResolved) {
        console.log(`[CodeAnalyzer] Source tree detected, analyzing: ${sourceRoot}`);
        return sourceRoot;
    }

    if (rootResolved.startsWith(folderResolved + path.sep)) {
        const relFromFolder = path.relative(folderResolved, rootResolved).split(path.sep).join('/');
        if (FULL_SOURCE_TREE_SCOPES.has(relFromFolder)) {
            console.log(`[CodeAnalyzer] Source tree detected, analyzing: ${sourceRoot}`);
            return sourceRoot;
        }
    }

    if (folderResolved.startsWith(rootResolved + path.sep)) {
        return folderPath;
    }

    return folderPath;
}

/**
 * True when relative scope is the full source tree (batching candidate).
 * @param {string} scopeRelativeToRoot
 * @returns {boolean}
 */
function isFullSourceTreeScope(scopeRelativeToRoot) {
    const scope = (scopeRelativeToRoot || '').replace(/\\/g, '/');
    return FULL_SOURCE_TREE_SCOPES.has(scope);
}

/**
 * Jest config rootDir when it differs from package root (e.g. CoreUI uses `source`).
 * @param {string} projectRoot
 * @param {function} [loadConfig] - (configPath) => config object
 * @returns {string}
 */
function resolveJestRootDir(projectRoot, loadConfig) {
    const configPath = path.join(projectRoot, 'jest.config.js');
    const tryLoad = loadConfig || ((p) => {
        if (!fs.existsSync(p)) return null;
        return require(p);
    });

    for (const name of ['jest.config.js', 'jest.config.ts', 'jest.config.cjs', 'jest.config.mjs']) {
        const full = path.join(projectRoot, name);
        if (!fs.existsSync(full)) continue;
        try {
            const cfg = tryLoad(full);
            if (cfg?.rootDir) {
                const rd = String(cfg.rootDir).replace(/<rootDir>/g, projectRoot);
                return path.resolve(projectRoot, rd);
            }
        } catch {
            // ignore invalid config
        }
    }
    return projectRoot;
}

/**
 * Scope string for --testPathPattern and --collectCoverageFrom (matches CLI from repo root).
 * Uses paths relative to Jest rootDir when set (e.g. `src/components/booking`), otherwise project root.
 * @param {string} projectRoot
 * @param {string} targetAnalysisPath
 * @returns {string}
 */
function resolveJestCoverageScope(projectRoot, targetAnalysisPath) {
    const absTarget = path.resolve(targetAnalysisPath);
    const jestRoot = resolveJestRootDir(projectRoot);
    const fromJestRoot = path.relative(jestRoot, absTarget).split(path.sep).join('/');

    if (fromJestRoot && !fromJestRoot.startsWith('..') && !path.isAbsolute(fromJestRoot)) {
        return fromJestRoot;
    }

    return path.relative(projectRoot, absTarget).split(path.sep).join('/');
}

/**
 * Relative scope for collectCoverageFrom when running Jest from jestRoot (e.g. "src" for CoreUI).
 * @param {string} jestRoot - Directory containing package.json / jest config
 * @returns {string} Scope relative to jestRoot, or empty for project-wide glob
 */
function resolveCollectCoverageScope(jestRoot) {
    const sourceRoot = findSourceRootUnder(jestRoot);
    if (sourceRoot) {
        return relativeToProject(jestRoot, sourceRoot);
    }
    if (fs.existsSync(path.join(jestRoot, 'src'))) {
        return 'src';
    }
    return '';
}

module.exports = {
    SOURCE_ROOT_RELATIVE_CANDIDATES,
    findSourceRootUnder,
    relativeToProject,
    resolveTargetAnalysisPath,
    resolveAnalyzerTargetPath,
    isFullSourceTreeScope,
    resolveJestRootDir,
    resolveJestCoverageScope,
    resolveCollectCoverageScope
};
