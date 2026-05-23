const {
    normalizeRelativeKey,
    canonicalPathKey,
    lookupCoverageForAnalysis,
    mergeAnalysisWithCoverage,
    countUnmatchedAnalysisFiles
} = require('./coverageMerge');

describe('coverageMerge', () => {
    test('normalizeRelativeKey lowercases and uses forward slashes', () => {
        expect(normalizeRelativeKey('.\\Src\\Foo.js')).toBe('src/foo.js');
        expect(normalizeRelativeKey('./src/foo.js')).toBe('src/foo.js');
    });

    test('canonicalPathKey aligns source/src and src prefixes', () => {
        expect(canonicalPathKey('source/src/components/booking/a.js')).toBe(
            canonicalPathKey('src/components/booking/a.js')
        );
    });

    test('lookupCoverageForAnalysis matches across source/ prefix difference', () => {
        const coverageFiles = [
            { relativePath: 'source/src/components/booking/a.js', lines: { pct: 42 } }
        ];
        expect(lookupCoverageForAnalysis(coverageFiles, 'src/components/booking/a.js')).toEqual(
            coverageFiles[0]
        );
    });

    test('lookupCoverageForAnalysis matches exact and suffix paths', () => {
        const coverageFiles = [
            { relativePath: 'src/components/booking/a.js', lines: { pct: 50 } },
            { relativePath: 'utils.js', lines: { pct: 80 } }
        ];

        expect(lookupCoverageForAnalysis(coverageFiles, 'src/components/booking/a.js')).toEqual(
            coverageFiles[0]
        );
        expect(lookupCoverageForAnalysis(coverageFiles, 'utils.js')).toEqual(coverageFiles[1]);
        expect(lookupCoverageForAnalysis(coverageFiles, 'missing.js')).toBeUndefined();
    });

    test('mergeAnalysisWithCoverage marks missing coverage as null missingLines', () => {
        const analysis = [{ relativePath: 'a.js' }, { relativePath: 'b.js' }];
        const coverage = [{ relativePath: 'a.js', lines: { pct: 100, covered: 10, total: 10 }, statements: { pct: 100, covered: 5, total: 5 }, missingLines: [] }];

        const merged = mergeAnalysisWithCoverage(analysis, coverage);
        expect(merged[0].lineCoverage).toBe(100);
        expect(merged[0].missingLines).toEqual([]);
        expect(merged[1].lineCoverage).toBeNull();
        expect(merged[1].missingLines).toBeNull();
    });

    test('countUnmatchedAnalysisFiles', () => {
        const analysis = [{ relativePath: 'a.js' }, { relativePath: 'b.js' }];
        const coverage = [{ relativePath: 'a.js', lines: {} }];
        expect(countUnmatchedAnalysisFiles(analysis, coverage)).toBe(1);
    });
});
