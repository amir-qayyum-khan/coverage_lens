const fs = require('fs');
const os = require('os');
const path = require('path');
const { formatMissingLines, findJestProjectRoot, isJestProjectDirectory, packageJsonDeclaresJest } = require('./coverageRunner');

describe('coverageRunner', () => {
    describe('formatMissingLines', () => {
        test('formats single line', () => {
            expect(formatMissingLines([5])).toBe('5');
        });

        test('formats multiple non-consecutive lines', () => {
            expect(formatMissingLines([1, 5, 10])).toBe('1, 5, 10');
        });

        test('formats consecutive lines as range', () => {
            expect(formatMissingLines([1, 2, 3])).toBe('1-3');
        });

        test('formats mixed ranges and single lines', () => {
            expect(formatMissingLines([1, 2, 3, 5, 10, 11, 12])).toBe('1-3, 5, 10-12');
        });

        test('handles empty array', () => {
            expect(formatMissingLines([])).toBe('');
        });

        test('handles null', () => {
            expect(formatMissingLines(null)).toBe('');
        });

        test('handles unsorted input', () => {
            expect(formatMissingLines([10, 1, 5, 2, 3])).toBe('1-3, 5, 10');
        });
    });

    describe('findJestProjectRoot', () => {
        let tmpDir;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-runner-jest-'));
        });

        afterEach(() => {
            try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            } catch {
                // ignore
            }
        });

        test('finds nested folder with package.json and jest.config.js', () => {
            const inner = path.join(tmpDir, 'apps', 'client');
            fs.mkdirSync(inner, { recursive: true });
            fs.writeFileSync(
                path.join(inner, 'package.json'),
                JSON.stringify({ name: 'client', devDependencies: { jest: '^29.0.0' } }),
                'utf8'
            );
            fs.writeFileSync(path.join(inner, 'jest.config.js'), 'module.exports = {};\n', 'utf8');

            expect(findJestProjectRoot(tmpDir)).toBe(inner);
        });

        test('prefers root when it has package.json and jest.config.js', () => {
            fs.writeFileSync(
                path.join(tmpDir, 'package.json'),
                JSON.stringify({ name: 'root', devDependencies: { jest: '^29.0.0' } }),
                'utf8'
            );
            fs.writeFileSync(path.join(tmpDir, 'jest.config.js'), 'module.exports = {};\n', 'utf8');

            const inner = path.join(tmpDir, 'other');
            fs.mkdirSync(inner, { recursive: true });
            fs.writeFileSync(
                path.join(inner, 'package.json'),
                JSON.stringify({ name: 'other' }),
                'utf8'
            );
            fs.writeFileSync(path.join(inner, 'jest.config.js'), 'module.exports = {};\n', 'utf8');

            expect(findJestProjectRoot(tmpDir)).toBe(tmpDir);
        });

        test('matches package.json with jest dependency but no jest.config file', () => {
            const inner = path.join(tmpDir, 'pkg');
            fs.mkdirSync(inner, { recursive: true });
            fs.writeFileSync(
                path.join(inner, 'package.json'),
                JSON.stringify({ name: 'pkg', devDependencies: { jest: '^29.0.0' } }),
                'utf8'
            );

            expect(findJestProjectRoot(tmpDir)).toBe(inner);
        });
    });

    describe('packageJsonDeclaresJest / isJestProjectDirectory', () => {
        let tmpDir;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-pkg-jest-'));
        });

        afterEach(() => {
            try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            } catch {
                // ignore
            }
        });

        test('packageJsonDeclaresJest is true when jest key present', () => {
            fs.writeFileSync(
                path.join(tmpDir, 'package.json'),
                JSON.stringify({ name: 'x', jest: { testEnvironment: 'node' } }),
                'utf8'
            );
            expect(packageJsonDeclaresJest(tmpDir)).toBe(true);
            expect(isJestProjectDirectory(tmpDir)).toBe(true);
        });

        test('isJestProjectDirectory is false without package.json', () => {
            expect(isJestProjectDirectory(tmpDir)).toBe(false);
        });
    });

    // Note: runCoverage and parseCoverageDetails require Jest to be installed
    // and are tested via integration tests with a real project
});
