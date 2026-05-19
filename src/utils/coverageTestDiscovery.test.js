const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    findColocatedTestFile,
    resolveAnalysisFileAbsolute
} = require('./coverageTestDiscovery');

describe('coverageTestDiscovery', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-test-disc-'));
    });

    afterEach(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    test('findColocatedTestFile finds __tests__/Component.test.js', () => {
        const detailsDir = path.join(tmpDir, 'details');
        const testsDir = path.join(detailsDir, '__tests__');
        fs.mkdirSync(testsDir, { recursive: true });
        const source = path.join(detailsDir, 'BookingDetails.js');
        const testFile = path.join(testsDir, 'BookingDetails.test.js');
        fs.writeFileSync(source, 'export default {};\n', 'utf8');
        fs.writeFileSync(testFile, 'test("x", () => {});\n', 'utf8');

        expect(findColocatedTestFile(source)).toBe(testFile);
    });

    test('findColocatedTestFile finds __tests__/Component.coverage.test.js', () => {
        const detailsDir = path.join(tmpDir, 'details');
        const testsDir = path.join(detailsDir, '__tests__');
        fs.mkdirSync(testsDir, { recursive: true });
        const source = path.join(detailsDir, 'BookingDetails.js');
        const testFile = path.join(testsDir, 'BookingDetails.coverage.test.js');
        fs.writeFileSync(source, 'export default {};\n', 'utf8');
        fs.writeFileSync(testFile, 'test("x", () => {});\n', 'utf8');

        expect(findColocatedTestFile(source)).toBe(testFile);
    });

    test('resolveAnalysisFileAbsolute joins clone root and relative path', () => {
        const rel = 'source/src/components/foo.js';
        const abs = resolveAnalysisFileAbsolute(tmpDir, rel);
        expect(abs).toBe(path.join(tmpDir, 'source', 'src', 'components', 'foo.js'));
    });
});
