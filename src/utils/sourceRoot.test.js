const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    findSourceRootUnder,
    resolveCollectCoverageScope,
    resolveAnalyzerTargetPath,
    isFullSourceTreeScope
} = require('./sourceRoot');

describe('sourceRoot', () => {
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

    describe('resolveCollectCoverageScope', () => {
        test('returns src when jestRoot is CoreUI source package', () => {
            const jestRoot = path.join(tmpDir, 'source');
            fs.mkdirSync(path.join(jestRoot, 'src', 'components'), { recursive: true });
            expect(resolveCollectCoverageScope(jestRoot)).toBe('src');
        });

        test('returns source/src when tree is at repo root', () => {
            fs.mkdirSync(path.join(tmpDir, 'source', 'src'), { recursive: true });
            expect(resolveCollectCoverageScope(tmpDir)).toBe('source/src');
        });

        test('returns src when jestRoot is DriverCom source/UI package', () => {
            const jestRoot = path.join(tmpDir, 'source', 'UI');
            fs.mkdirSync(path.join(jestRoot, 'src', 'components'), { recursive: true });
            expect(resolveCollectCoverageScope(jestRoot)).toBe('src');
        });
    });

    describe('findSourceRootUnder / DriverCom layout', () => {
        test('prefers source/UI/src over bare source when source/src missing', () => {
            const uiSrc = path.join(tmpDir, 'source', 'UI', 'src');
            const backend = path.join(tmpDir, 'source', 'Backend');
            fs.mkdirSync(uiSrc, { recursive: true });
            fs.mkdirSync(backend, { recursive: true });
            expect(findSourceRootUnder(tmpDir)).toBe(uiSrc);
        });

        test('resolveAnalyzerTargetPath maps clone root to source/UI/src', () => {
            const uiSrc = path.join(tmpDir, 'source', 'UI', 'src');
            fs.mkdirSync(uiSrc, { recursive: true });
            expect(resolveAnalyzerTargetPath(tmpDir)).toBe(uiSrc);
        });

        test('isFullSourceTreeScope accepts source/UI/src, components, and project root', () => {
            expect(isFullSourceTreeScope('source/UI/src')).toBe(true);
            expect(isFullSourceTreeScope('source/src')).toBe(true);
            expect(isFullSourceTreeScope('src')).toBe(true);
            expect(isFullSourceTreeScope('components')).toBe(true);
            expect(isFullSourceTreeScope('')).toBe(true);
            expect(isFullSourceTreeScope('source/Backend')).toBe(false);
        });
    });

    describe('findSourceRootUnder / flat YouDrive layout', () => {
        test('uses catalog sourceRoot components when clone has no src', () => {
            const clonePath = path.join(tmpDir, 'TrapezeDRTYouDriveUI');
            const components = path.join(clonePath, 'components');
            fs.mkdirSync(components, { recursive: true });
            expect(findSourceRootUnder(clonePath)).toBe(path.resolve(components));
            expect(resolveAnalyzerTargetPath(clonePath)).toBe(path.resolve(components));
            expect(resolveCollectCoverageScope(clonePath)).toBe('components');
        });

        test('uses catalog sourceRoot components for YouTravelUI', () => {
            const clonePath = path.join(tmpDir, 'TrapezeDRTYouTravelUI');
            const components = path.join(clonePath, 'components');
            fs.mkdirSync(components, { recursive: true });
            expect(findSourceRootUnder(clonePath)).toBe(path.resolve(components));
            expect(resolveCollectCoverageScope(clonePath)).toBe('components');
        });
    });
});
