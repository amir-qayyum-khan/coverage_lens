/**
 * Jest collectCoverageFrom patterns aligned with folder-scoped CLI usage.
 * @param {string} scopePath - Path relative to project root, e.g. "src/components/booking"
 * @returns {string[]}
 */
function buildCollectCoverageFromPatterns(scopePath) {
    const prefix = scopePath ? scopePath.replace(/\\/g, '/') : '';
    const glob = prefix ? `${prefix}/**/*.{js,jsx}` : '**/*.{js,jsx}';
    const negPrefix = prefix ? `${prefix}/` : '';

    return [
        glob,
        `!${negPrefix}**/*.test.js`,
        `!${negPrefix}**/*.test.jsx`,
        `!${negPrefix}**/*.spec.js`,
        `!${negPrefix}**/*.spec.jsx`,
        `!${negPrefix}**/__tests__/**`,
        `!${negPrefix}**/__test__/**`,
        `!${negPrefix}**/*.tests.js`,
        `!${negPrefix}**/*.tests.jsx`,
        `!${negPrefix}**/__mocks__/**`,
        `!${negPrefix}**/i18n/**`,
        `!${negPrefix}**/config/**`,
        `!**/webpack*.js`,
        `!**/babel.config*.js`,
        `!**/.babelrc`,
        `!**/jest.config*.js`,
        `!**/preStart.js`,
        `!**/babel.prod.js`,
        `!**/babel.dev.js`,
        `!**/.eslintrc*`,
        `!**/WeStore.js`,
        `!**/version.js`,
        `!**/store.js`,
        '!**/lcov-report/**',
        `!**/*.css`,
        `!**/*.scss`,
        `!**/*.less`,
        `!**/*.html`,
        `!**/*.json`
    ];
}

/**
 * Union an app's collectCoverageFrom allowlist with scoped folder patterns.
 * Keeps base exclusions (e.g. !components/yod/index.js) while instrumenting
 * other files under the source tree so analysis rows get 0% instead of N/A.
 *
 * @param {string[]|null|undefined} basePatterns - Patterns from the project's jest.config
 * @param {string} scopePath - Relative source scope (e.g. "components"); empty keeps base only
 * @returns {string[]}
 */
function unionCollectCoverageFrom(basePatterns, scopePath) {
    const scope = (scopePath || '').replace(/\\/g, '/').trim();
    const widen = buildCollectCoverageFromPatterns(scope);

    if (!Array.isArray(basePatterns) || basePatterns.length === 0) {
        return widen;
    }
    if (!scope) {
        return [...basePatterns];
    }

    const seen = new Set();
    const out = [];
    for (const pattern of [...basePatterns, ...widen]) {
        if (typeof pattern !== 'string' || seen.has(pattern)) {
            continue;
        }
        seen.add(pattern);
        out.push(pattern);
    }
    return out;
}

module.exports = {
    buildCollectCoverageFromPatterns,
    unionCollectCoverageFrom
};
