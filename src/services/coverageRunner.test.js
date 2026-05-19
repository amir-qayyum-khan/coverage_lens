const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    formatMissingLines,
    findJestProjectRoot,
    isJestProjectDirectory,
    packageJsonDeclaresJest,
    getBatchScopes,
    mergeCoverageSummaries,
    mergeCoverageFinal,
    buildJestArgs,
    buildTestPathPattern,
    parseCoverageResults
} = require('./coverageRunner');

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

    describe('getBatchScopes', () => {
        let tmpDir;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-batch-'));
            fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}', 'utf8');
            const srcPath = path.join(tmpDir, 'src');
            fs.mkdirSync(path.join(srcPath, 'components'), { recursive: true });
            fs.mkdirSync(path.join(srcPath, 'pages'), { recursive: true });
        });

        afterEach(() => {
            try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            } catch {
                // ignore
            }
        });

        test('returns single scope for subfolder analysis', () => {
            const booking = path.join(tmpDir, 'src', 'components', 'booking');
            fs.mkdirSync(booking, { recursive: true });
            expect(getBatchScopes(tmpDir, booking, 200)).toEqual(['src/components/booking']);
        });

        test('returns single scope when file count is small', () => {
            const srcPath = path.join(tmpDir, 'src');
            expect(getBatchScopes(tmpDir, srcPath, 50)).toEqual(['src']);
        });

        test('splits large full-src into child batches', () => {
            const srcPath = path.join(tmpDir, 'src');
            const batches = getBatchScopes(tmpDir, srcPath, 200);
            expect(batches).toContain('src/components');
            expect(batches).toContain('src/pages');
            expect(batches.length).toBe(2);
        });
    });

    describe('mergeCoverageSummaries', () => {
        test('merges file entries and recomputes total', () => {
            const a = {
                'src/a.js': { lines: { total: 10, covered: 5, pct: 50 }, statements: { total: 5, covered: 2, pct: 40 }, functions: { total: 1, covered: 1, pct: 100 }, branches: { total: 0, covered: 0, pct: 100 } },
                total: { lines: { total: 10, covered: 5, pct: 50 }, statements: { total: 5, covered: 2, pct: 40 }, functions: { total: 1, covered: 1, pct: 100 }, branches: { total: 0, covered: 0, pct: 100 } }
            };
            const b = {
                'src/b.js': { lines: { total: 4, covered: 4, pct: 100 }, statements: { total: 2, covered: 2, pct: 100 }, functions: { total: 1, covered: 1, pct: 100 }, branches: { total: 0, covered: 0, pct: 100 } },
                total: { lines: { total: 4, covered: 4, pct: 100 }, statements: { total: 2, covered: 2, pct: 100 }, functions: { total: 1, covered: 1, pct: 100 }, branches: { total: 0, covered: 0, pct: 100 } }
            };
            const merged = mergeCoverageSummaries([a, b]);
            expect(merged['src/a.js']).toBeDefined();
            expect(merged['src/b.js']).toBeDefined();
            expect(merged.total.lines.total).toBe(14);
            expect(merged.total.lines.covered).toBe(9);
        });

        test('keeps entry with more covered lines when duplicate keys exist', () => {
            const low = {
                'src/a.js': {
                    lines: { total: 10, covered: 0, pct: 0 },
                    statements: { total: 5, covered: 0, pct: 0 },
                    functions: { total: 1, covered: 0, pct: 0 },
                    branches: { total: 0, covered: 0, pct: 100 }
                },
                total: { lines: { total: 10, covered: 0, pct: 0 }, statements: { total: 5, covered: 0, pct: 0 }, functions: { total: 1, covered: 0, pct: 0 }, branches: { total: 0, covered: 0, pct: 100 } }
            };
            const high = {
                'src/a.js': {
                    lines: { total: 10, covered: 8, pct: 80 },
                    statements: { total: 5, covered: 4, pct: 80 },
                    functions: { total: 1, covered: 1, pct: 100 },
                    branches: { total: 0, covered: 0, pct: 100 }
                },
                total: { lines: { total: 10, covered: 8, pct: 80 }, statements: { total: 5, covered: 4, pct: 80 }, functions: { total: 1, covered: 1, pct: 100 }, branches: { total: 0, covered: 0, pct: 100 } }
            };
            const merged = mergeCoverageSummaries([low, high]);
            expect(merged['src/a.js'].lines.covered).toBe(8);
        });
    });

    describe('mergeCoverageFinal', () => {
        test('prefers detailed entry with more executed statements', () => {
            const a = {
                'src/a.js': {
                    s: { 0: 0, 1: 0 },
                    statementMap: { 0: { start: { line: 1 } }, 1: { start: { line: 2 } } }
                }
            };
            const b = {
                'src/a.js': {
                    s: { 0: 1, 1: 1 },
                    statementMap: { 0: { start: { line: 1 } }, 1: { start: { line: 2 } } }
                }
            };
            const merged = mergeCoverageFinal([a, b]);
            expect(merged['src/a.js'].s['0']).toBe(1);
        });
    });

    describe('buildJestArgs', () => {
        test('adds testPathPattern scoped to folder (matches npx jest CLI)', () => {
            const { jestArgs, testPathPattern } = buildJestArgs('/tmp/jest.config.js', 'src/components/booking', 50, false);
            expect(testPathPattern).toBe('src/components/booking');
            expect(jestArgs.some((a) => a === '--testPathPattern=src/components/booking')).toBe(true);
            expect(jestArgs.some((a) => a.startsWith('--collectCoverageFrom='))).toBe(true);
        });

        test('omits testPathPattern for project-wide empty scope', () => {
            const { jestArgs, testPathPattern } = buildJestArgs('/tmp/jest.config.js', '', 50, false);
            expect(testPathPattern).toBeNull();
            expect(jestArgs.some((a) => a.startsWith('--testPathPattern='))).toBe(false);
        });
    });

    describe('buildTestPathPattern', () => {
        test('escapes regex metacharacters in scope paths', () => {
            expect(buildTestPathPattern('src/(special)')).toBe('src/\\(special\\)');
        });
    });

    describe('parseCoverageResults', () => {
        let tmpDir;
        let folderDir;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-parse-'));
            folderDir = path.join(tmpDir, 'src', 'booking');
            fs.mkdirSync(folderDir, { recursive: true });
            fs.writeFileSync(path.join(folderDir, 'in.js'), 'x', 'utf8');
            fs.writeFileSync(path.join(tmpDir, 'src', 'out.js'), 'y', 'utf8');
        });

        afterEach(() => {
            try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            } catch {
                // ignore
            }
        });

        test('keeps only files under selected folder', () => {
            const inFile = path.join(folderDir, 'in.js');
            const outFile = path.join(tmpDir, 'src', 'out.js');
            const summary = {
                [inFile]: { lines: { total: 1, covered: 1, pct: 100 }, statements: { total: 1, covered: 1, pct: 100 } },
                [outFile]: { lines: { total: 1, covered: 0, pct: 0 }, statements: { total: 1, covered: 0, pct: 0 } },
                total: { lines: { total: 2, covered: 1, pct: 50 }, statements: { total: 2, covered: 1, pct: 50 } }
            };
            const parsed = parseCoverageResults(summary, {}, folderDir, tmpDir);
            expect(parsed.files).toHaveLength(1);
            expect(parsed.files[0].relativePath).toBe('in.js');
            expect(parsed.diagnostics.skippedKeyCount).toBe(1);
        });
    });
});
