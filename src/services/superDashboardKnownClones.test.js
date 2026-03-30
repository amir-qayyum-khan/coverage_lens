const fs = require('fs');
const path = require('path');
const os = require('os');
const {
    readKnownClonePaths,
    readKnownClonePathsWithLegacyImport,
    writeKnownClonePaths,
    appendKnownClonePath,
    knownClonesFilePath,
    normalizePaths,
    FILE_NAME
} = require('./superDashboardKnownClones');

describe('superDashboardKnownClones', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voyagerr-known-clones-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('readKnownClonePaths returns empty when file missing', () => {
        expect(readKnownClonePaths(tmpDir)).toEqual([]);
    });

    test('writeKnownClonePaths then read round-trips', () => {
        const a = path.join(tmpDir, 'a', 'x');
        const b = path.join(tmpDir, 'b', 'y');
        const written = writeKnownClonePaths(tmpDir, [`  ${a}  `, b, b]);
        const ra = path.resolve(a);
        const rb = path.resolve(b);
        expect(written).toEqual([ra, rb]);
        expect(readKnownClonePaths(tmpDir)).toEqual([ra, rb]);
        expect(fs.existsSync(knownClonesFilePath(tmpDir))).toBe(true);
    });

    test('readKnownClonePaths accepts legacy top-level array in file', () => {
        const fp = knownClonesFilePath(tmpDir);
        fs.mkdirSync(tmpDir, { recursive: true });
        const legacyRepo = path.join(tmpDir, 'legacy', 'repo');
        fs.writeFileSync(fp, JSON.stringify([legacyRepo]), 'utf8');
        expect(readKnownClonePaths(tmpDir)).toEqual([path.resolve(legacyRepo)]);
    });

    test('appendKnownClonePath dedupes and appends', () => {
        const one = path.join(tmpDir, 'one');
        const two = path.join(tmpDir, 'two');
        expect(appendKnownClonePath(tmpDir, one)).toEqual([path.resolve(one)]);
        expect(appendKnownClonePath(tmpDir, one)).toEqual([path.resolve(one)]);
        expect(appendKnownClonePath(tmpDir, two)).toEqual([path.resolve(one), path.resolve(two)]);
    });

    test('appendKnownClonePath ignores empty and invalid', () => {
        expect(appendKnownClonePath(tmpDir, '')).toEqual([]);
        expect(appendKnownClonePath(tmpDir, '   ')).toEqual([]);
        expect(appendKnownClonePath(tmpDir, null)).toEqual([]);
    });

    test('normalizePaths filters invalid', () => {
        const ok = path.join(tmpDir, 'ok');
        expect(normalizePaths(['', '  ', 3, ok])).toEqual([path.resolve(ok)]);
    });

    test('readKnownClonePathsWithLegacyImport copies Roaming/Electron file when app userData is empty', () => {
        const roaming = path.join(tmpDir, 'Roaming');
        const appUserData = path.join(roaming, 'voyagerr-lens');
        const electronDir = path.join(roaming, 'Electron');
        fs.mkdirSync(electronDir, { recursive: true });
        const repo = path.join(tmpDir, 'cloned', 'TrapezeDRTCoreUI');
        fs.mkdirSync(repo, { recursive: true });
        fs.writeFileSync(
            path.join(electronDir, FILE_NAME),
            JSON.stringify({ paths: [repo] }),
            'utf8'
        );
        const paths = readKnownClonePathsWithLegacyImport(appUserData);
        expect(paths).toEqual([path.resolve(repo)]);
        expect(readKnownClonePaths(appUserData)).toEqual([path.resolve(repo)]);
    });
});
