const { buildCollectCoverageFromPatterns } = require('./coverageGlobs');

describe('coverageGlobs', () => {
    test('buildCollectCoverageFromPatterns for scoped folder', () => {
        const patterns = buildCollectCoverageFromPatterns('src/components/booking');
        expect(patterns[0]).toBe('src/components/booking/**/*.{js,jsx}');
        expect(patterns.some((p) => p.includes('**/*.test.js'))).toBe(true);
        expect(patterns.some((p) => p.includes('**/config/**'))).toBe(true);
    });

    test('buildCollectCoverageFromPatterns for project root', () => {
        const patterns = buildCollectCoverageFromPatterns('');
        expect(patterns[0]).toBe('**/*.{js,jsx}');
    });
});
