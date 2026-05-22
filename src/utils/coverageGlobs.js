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

module.exports = {
    buildCollectCoverageFromPatterns
};
