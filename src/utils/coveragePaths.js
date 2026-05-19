const path = require('path');
const fs = require('fs');
const { normalizeRelativeKey, lookupCoverageForAnalysis } = require('./coverageMerge');

/**
 * Resolve a coverage summary key (absolute or project-relative) to an absolute path.
 * @param {string} filePath - Key from coverage-summary.json
 * @param {string} projectRoot - Jest project root
 * @returns {string}
 */
function resolveCoverageKeyToAbsolute(filePath, projectRoot) {
    if (!filePath) return filePath;
    if (path.isAbsolute(filePath)) {
        return filePath;
    }
    return path.join(projectRoot, filePath);
}

/**
 * Best-effort realpath; returns input on failure.
 * @param {string} p
 * @returns {string}
 */
function safeRealpath(p) {
    try {
        return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
    } catch {
        try {
            return fs.realpathSync(p);
        } catch {
            return p;
        }
    }
}

/**
 * True when filePath is under folderPath (uses realpath + path.relative).
 * @param {string} folderPath - Selected analysis folder (absolute)
 * @param {string} filePath - Coverage key (absolute or relative to projectRoot)
 * @param {string} [projectRoot] - Jest cwd when filePath is relative
 * @returns {boolean}
 */
function isFileUnderFolder(folderPath, filePath, projectRoot) {
    const absoluteFile = projectRoot && !path.isAbsolute(filePath)
        ? resolveCoverageKeyToAbsolute(filePath, projectRoot)
        : filePath;

    let realFolder = safeRealpath(folderPath);
    let realFile = absoluteFile;

    if (path.isAbsolute(absoluteFile) && fs.existsSync(absoluteFile)) {
        realFile = safeRealpath(absoluteFile);
    } else if (projectRoot) {
        const joined = path.join(projectRoot, filePath);
        if (fs.existsSync(joined)) {
            realFile = safeRealpath(joined);
        }
    }

    const rel = path.relative(realFolder, realFile);
    if (!rel || rel === '') return true;
    return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Display relative path from folderPath to file (forward slashes).
 * @param {string} folderPath
 * @param {string} filePath
 * @param {string} [projectRoot]
 * @returns {string}
 */
function toDisplayRelativePath(folderPath, filePath, projectRoot) {
    const absoluteFile = projectRoot && !path.isAbsolute(filePath)
        ? resolveCoverageKeyToAbsolute(filePath, projectRoot)
        : filePath;

    let base = folderPath;
    try {
        base = safeRealpath(folderPath);
    } catch {
        // keep folderPath
    }

    let target = absoluteFile;
    if (fs.existsSync(absoluteFile)) {
        try {
            target = safeRealpath(absoluteFile);
        } catch {
            target = absoluteFile;
        }
    }

    return path.relative(base, target).split(path.sep).join('/');
}

module.exports = {
    normalizeRelativeKey,
    resolveCoverageKeyToAbsolute,
    safeRealpath,
    isFileUnderFolder,
    toDisplayRelativePath,
    lookupCoverageForAnalysis
};
