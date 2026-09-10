const { buildCollectCoverageFromPatterns, unionCollectCoverageFrom } = require('./coverageGlobs');

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

    test('unionCollectCoverageFrom appends scoped globs to allowlist and keeps exclusions', () => {
        const base = [
            'components/yod/**/*.js',
            '!components/yod/index.js',
            '!components/yod/appTag.js',
            'components/auth/PasswordPage.js'
        ];
        const merged = unionCollectCoverageFrom(base, 'components');
        expect(merged[0]).toBe('components/yod/**/*.js');
        expect(merged).toContain('!components/yod/index.js');
        expect(merged).toContain('components/**/*.{js,jsx}');
        expect(merged).toContain('!components/**/__tests__/**');
    });

    test('unionCollectCoverageFrom falls back to scoped patterns when base is empty', () => {
        const merged = unionCollectCoverageFrom(null, 'components');
        expect(merged[0]).toBe('components/**/*.{js,jsx}');
    });

    test('unionCollectCoverageFrom keeps base when scope is empty', () => {
        const base = ['src/**/*.js'];
        expect(unionCollectCoverageFrom(base, '')).toEqual(base);
    });
});

