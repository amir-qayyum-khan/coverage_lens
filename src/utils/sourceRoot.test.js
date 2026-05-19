const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveCollectCoverageScope } = require('./sourceRoot');

describe('sourceRoot resolveCollectCoverageScope', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-src-root-'));
    });

    afterEach(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    test('returns src when jestRoot is CoreUI source package', () => {
        const jestRoot = path.join(tmpDir, 'source');
        fs.mkdirSync(path.join(jestRoot, 'src', 'components'), { recursive: true });
        expect(resolveCollectCoverageScope(jestRoot)).toBe('src');
    });

    test('returns source/src when tree is at repo root', () => {
        fs.mkdirSync(path.join(tmpDir, 'source', 'src'), { recursive: true });
        expect(resolveCollectCoverageScope(tmpDir)).toBe('source/src');
    });
});
