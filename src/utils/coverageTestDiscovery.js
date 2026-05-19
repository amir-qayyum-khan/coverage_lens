const TEST_SUFFIXES = [
    '.coverage.test.js',
    '.coverage.test.jsx',
    '.test.js',
    '.test.jsx',
    '.spec.js',
    '.spec.jsx'
];

/**
 * Lazy Node fs (main process / tests only). Avoid top-level require so webpack renderer bundle loads.
 * @returns {typeof import('fs')|null}
 */
function getFs() {
    try {
        // eslint-disable-next-line global-require
        return require('fs');
    } catch {
        return null;
    }
}

/**
 * Join path segments without Node path module (safe in Electron renderer).
 * @param {...string} parts
 * @param {{ preferBackslash?: boolean }} [opts]
 * @returns {string}
 */
function joinPath(...parts) {
    const last = parts[parts.length - 1];
    const opts = last && typeof last === 'object' && !Array.isArray(last) && 'preferBackslash' in last
        ? parts.pop()
        : {};
    const useBackslash =
        opts.preferBackslash === true ||
        parts.some((p) => String(p).includes('\\'));
    const sep = useBackslash ? '\\' : '/';
    return parts
        .filter(Boolean)
        .map((p, i) => {
            let s = String(p).replace(/[/\\]+/g, sep);
            if (i > 0) s = s.replace(/^[/\\]+/, '');
            return s.replace(/[/\\]+$/, '');
        })
        .join(sep);
}

/**
 * Find a colocated unit test file for a source module (e.g. __tests__/Component.test.js).
 * @param {string} sourceAbsolutePath - Absolute path to the source file
 * @param {{ fileExistsSync?: (p: string) => boolean }} [opts]
 * @returns {string|null} Absolute path to test file, or null
 */
function findColocatedTestFile(sourceAbsolutePath, opts = {}) {
    if (!sourceAbsolutePath) return null;

    const exists =
        opts.fileExistsSync ||
        ((p) => {
            const fs = getFs();
            return fs ? fs.existsSync(p) : false;
        });

    const preferBackslash = sourceAbsolutePath.includes('\\');
    const pathOpts = { preferBackslash };
    const segments = sourceAbsolutePath.split(/[/\\]/).filter(Boolean);
    if (segments.length === 0) return null;

    const fileName = segments[segments.length - 1];
    const dirParts = segments.slice(0, -1);
    const dot = fileName.lastIndexOf('.');
    const base = dot > 0 ? fileName.slice(0, dot) : fileName;
    const testsDir = joinPath(...dirParts, '__tests__', pathOpts);

    for (const suffix of TEST_SUFFIXES) {
        const candidate = joinPath(testsDir, base + suffix, pathOpts);
        if (exists(candidate)) return candidate;
    }

    for (const suffix of TEST_SUFFIXES) {
        const candidate = joinPath(...dirParts, base + suffix, pathOpts);
        if (exists(candidate)) return candidate;
    }

    return null;
}

/**
 * Resolve absolute path for an analysis row when clone/folder path is known.
 * @param {string} folderPath - Clone or analysis root
 * @param {string} relativePath - Forward-slash relative path from analysis
 * @returns {string}
 */
function resolveAnalysisFileAbsolute(folderPath, relativePath) {
    if (!folderPath || !relativePath) return '';
    return joinPath(folderPath, ...relativePath.split('/').filter(Boolean), {
        preferBackslash: folderPath.includes('\\')
    });
}

module.exports = {
    findColocatedTestFile,
    resolveAnalysisFileAbsolute,
    joinPath,
    TEST_SUFFIXES
};
