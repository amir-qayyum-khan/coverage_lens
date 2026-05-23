/**
 * Normalize a relative path key for Map lookups (forward slashes, lowercase, no leading ./).
 * @param {string} p
 * @returns {string}
 */
function normalizeRelativeKey(p) {
    return String(p || '')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .toLowerCase();
}

/**
 * Collapse CoreUI-style `source/src/...` and CRA-style `src/...` to a common key.
 * @param {string} p
 * @returns {string}
 */
function canonicalPathKey(p) {
    let key = normalizeRelativeKey(p);
    if (key.startsWith('source/src/')) {
        key = key.slice('source/'.length);
    } else if (key === 'source/src') {
        key = 'src';
    } else if (key.startsWith('source/')) {
        key = key.slice('source/'.length);
    }
    return key;
}

/**
 * Find coverage entry for an analysis file path (exact key, then suffix fallback).
 * @param {Array<{ relativePath: string, relativePathKey?: string }>} coverageFiles
 * @param {string} analysisRelativePath
 * @returns {object|undefined}
 */
function lookupCoverageForAnalysis(coverageFiles, analysisRelativePath) {
    if (!coverageFiles?.length) return undefined;

    const norm = canonicalPathKey(analysisRelativePath);
    const indexed = coverageFiles.map((f) => ({
        file: f,
        norm: canonicalPathKey(f.relativePathKey || f.relativePath)
    }));

    const exact = indexed.find((e) => e.norm === norm);
    if (exact) return exact.file;

    for (const entry of indexed) {
        if (norm.endsWith('/' + entry.norm) || entry.norm.endsWith('/' + norm)) {
            return entry.file;
        }
    }

    return undefined;
}

/**
 * Merge analysis file rows with Jest coverage rows.
 * @param {Array<{ relativePath: string }>} analysisFiles
 * @param {Array<object>|null|undefined} coverageFiles
 * @returns {Array<object>}
 */
function mergeAnalysisWithCoverage(analysisFiles, coverageFiles) {
    if (!analysisFiles?.length) return [];

    return analysisFiles.map((f) => {
        const cov = lookupCoverageForAnalysis(coverageFiles, f.relativePath);
        return {
            ...f,
            relativePath: f.relativePath,
            lineCoverage: cov?.lines?.pct ?? null,
            coveredLines: cov?.lines?.covered ?? null,
            totalLines: cov?.lines?.total ?? null,
            statementCoverage: cov?.statements?.pct ?? null,
            coveredStatements: cov?.statements?.covered ?? null,
            totalStatements: cov?.statements?.total ?? null,
            missingLines: cov ? (cov.missingLines || []) : null
        };
    });
}

/**
 * Count analysis files with no matching Jest coverage row.
 * @param {Array<{ relativePath: string }>} analysisFiles
 * @param {Array<object>|null|undefined} coverageFiles
 * @returns {number}
 */
function countUnmatchedAnalysisFiles(analysisFiles, coverageFiles) {
    if (!analysisFiles?.length) return 0;
    return analysisFiles.filter(
        (f) => !lookupCoverageForAnalysis(coverageFiles, f.relativePath)
    ).length;
}

module.exports = {
    normalizeRelativeKey,
    canonicalPathKey,
    lookupCoverageForAnalysis,
    mergeAnalysisWithCoverage,
    countUnmatchedAnalysisFiles
};
