/**
 * Merge istanbul json-summary and coverage-final payloads from multiple Jest runs.
 */

/**
 * Sum istanbul metric objects { total, covered, pct }.
 * @param {object[]} metrics
 * @returns {{ total: number, covered: number, pct: number }}
 */
function sumMetric(metrics) {
    const total = metrics.reduce((s, m) => s + (m?.total || 0), 0);
    const covered = metrics.reduce((s, m) => s + (m?.covered || 0), 0);
    const pct = total > 0 ? (covered / total) * 100 : 0;
    return { total, covered, pct };
}

/**
 * Prefer the coverage entry with more covered lines (for duplicate keys across batches).
 * @param {object} a
 * @param {object} b
 * @returns {object}
 */
function pickBetterCoverageSummaryEntry(a, b) {
    const coveredA = a?.lines?.covered ?? 0;
    const coveredB = b?.lines?.covered ?? 0;
    return coveredB > coveredA ? b : a;
}

/**
 * Count executed statements in istanbul file data.
 * @param {object} fileData
 * @returns {number}
 */
function countCoveredStatements(fileData) {
    if (!fileData?.s) return 0;
    return Object.values(fileData.s).filter((v) => v > 0).length;
}

/**
 * Merge multiple coverage-summary.json payloads into one.
 * @param {object[]} summaries
 * @returns {object}
 */
function mergeCoverageSummaries(summaries) {
    const merged = {};
    for (const summary of summaries) {
        for (const [key, data] of Object.entries(summary)) {
            if (key === 'total') continue;
            merged[key] = merged[key]
                ? pickBetterCoverageSummaryEntry(merged[key], data)
                : data;
        }
    }

    const fileEntries = Object.values(merged);
    merged.total = {
        lines: sumMetric(fileEntries.map((f) => f.lines)),
        statements: sumMetric(fileEntries.map((f) => f.statements)),
        functions: sumMetric(fileEntries.map((f) => f.functions)),
        branches: sumMetric(fileEntries.map((f) => f.branches))
    };

    return merged;
}

/**
 * Merge coverage-final.json objects by file path key.
 * @param {object[]} detailedList
 * @returns {object}
 */
function mergeCoverageFinal(detailedList) {
    const merged = {};
    for (const detailed of detailedList) {
        for (const [key, data] of Object.entries(detailed)) {
            const existing = merged[key];
            if (!existing) {
                merged[key] = data;
                continue;
            }
            if (countCoveredStatements(data) > countCoveredStatements(existing)) {
                merged[key] = data;
            }
        }
    }
    return merged;
}

module.exports = {
    sumMetric,
    pickBetterCoverageSummaryEntry,
    countCoveredStatements,
    mergeCoverageSummaries,
    mergeCoverageFinal
};
