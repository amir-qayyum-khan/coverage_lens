const path = require('path');
const fs = require('fs');
const {
    analyzeFolder,
    analyzeFile,
    countStatements,
    shouldIgnoreFile,
    shouldIgnoreFolder,
    getJsFiles
} = require('./codeAnalyzer');

// Create a temporary test directory
const testDir = path.join(__dirname, '__test_temp__');

beforeAll(() => {
    // Create test directory structure
    if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
    }

    // Create test files
    fs.writeFileSync(
        path.join(testDir, 'sample.js'),
        `
const x = 1;
const y = 2;

function add(a, b) {
  return a + b;
}

if (x > 0) {
  console.log('positive');
}
`.trim()
    );

    fs.writeFileSync(
        path.join(testDir, 'sample.test.js'),
        'test("sample", () => expect(true).toBe(true));'
    );

    // Create i18n folder
    const i18nDir = path.join(testDir, 'i18n');
    fs.mkdirSync(i18nDir, { recursive: true });
    fs.writeFileSync(path.join(i18nDir, 'en.js'), 'export const messages = {};');
});

afterAll(() => {
    // Cleanup test directory
    fs.rmSync(testDir, { recursive: true, force: true });
});

describe('shouldIgnoreFile', () => {
    test('ignores .test.js files', () => {
        expect(shouldIgnoreFile('component.test.js')).toBe(true);
    });

    test('ignores .spec.js files', () => {
        expect(shouldIgnoreFile('component.spec.js')).toBe(true);
    });

    test('ignores .html files', () => {
        expect(shouldIgnoreFile('index.html')).toBe(true);
    });

    test('ignores .css files', () => {
        expect(shouldIgnoreFile('styles.css')).toBe(true);
    });

    test('does not ignore regular .js files', () => {
        expect(shouldIgnoreFile('component.js')).toBe(false);
    });
});

describe('shouldIgnoreFolder', () => {
    test('ignores i18n folder', () => {
        expect(shouldIgnoreFolder('i18n')).toBe(true);
    });

    test('ignores __tests__ folder', () => {
        expect(shouldIgnoreFolder('__tests__')).toBe(true);
    });

    test('ignores node_modules folder', () => {
        expect(shouldIgnoreFolder('node_modules')).toBe(true);
    });

    test('does not ignore regular folders', () => {
        expect(shouldIgnoreFolder('components')).toBe(false);
        expect(shouldIgnoreFolder('src')).toBe(false);
    });
});

describe('countStatements', () => {
    test('counts variable declarations', () => {
        const code = 'const x = 1; let y = 2; var z = 3;';
        expect(countStatements(code)).toBeGreaterThan(0);
    });

    test('counts function declarations', () => {
        const code = 'function add(a, b) { return a + b; }';
        expect(countStatements(code)).toBeGreaterThan(0);
    });

    test('counts if statements', () => {
        const code = 'if (true) { console.log("yes"); }';
        expect(countStatements(code)).toBeGreaterThan(0);
    });

    test('counts for loops', () => {
        const code = 'for (let i = 0; i < 10; i++) { console.log(i); }';
        expect(countStatements(code)).toBeGreaterThan(0);
    });

    test('handles empty code', () => {
        expect(countStatements('')).toBe(0);
    });

    test('handles comments only', () => {
        const code = '// This is a comment\n/* Block comment */';
        expect(countStatements(code)).toBe(0);
    });
});

describe('getJsFiles', () => {
    test('finds .js files in directory', () => {
        const files = getJsFiles(testDir);
        expect(files.some(f => f.endsWith('sample.js'))).toBe(true);
    });

    test('excludes .test.js files', () => {
        const files = getJsFiles(testDir);
        expect(files.some(f => f.endsWith('.test.js'))).toBe(false);
    });

    test('excludes i18n folder', () => {
        const files = getJsFiles(testDir);
        expect(files.some(f => f.includes('i18n'))).toBe(false);
    });
});

describe('analyzeFile', () => {
    test('returns file analysis results', () => {
        const filePath = path.join(testDir, 'sample.js');
        const result = analyzeFile(filePath);

        expect(result.success).toBe(true);
        expect(result.totalLines).toBeGreaterThan(0);
        expect(result.codeLines).toBeGreaterThan(0);
        expect(result.statements).toBeGreaterThan(0);
    });

    test('handles non-existent files', () => {
        const result = analyzeFile('/non/existent/file.js');

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });
});

describe('analyzeFolder', () => {
    test('analyzes all files in folder', async () => {
        const result = await analyzeFolder(testDir);

        expect(result.folderPath).toBe(testDir);
        expect(result.files).toBeDefined();
        expect(result.summary).toBeDefined();
        expect(result.summary.totalFiles).toBeGreaterThan(0);
    });

    test('calculates summary correctly', async () => {
        const result = await analyzeFolder(testDir);

        expect(result.summary.totalLines).toBeGreaterThan(0);
        expect(result.summary.totalStatements).toBeGreaterThan(0);
    });

    test('excludes test files from analysis', async () => {
        const result = await analyzeFolder(testDir);

        const hasTestFile = result.files.some(f => f.relativePath.includes('.test.js'));
        expect(hasTestFile).toBe(false);
    });
});
