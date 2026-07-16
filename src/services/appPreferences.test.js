const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    DEFAULT_APP_PREFERENCES,
    appPreferencesFilePath,
    readAppPreferences,
    writeAppPreferences,
    normalizeAppPreferences
} = require('./appPreferences');

describe('appPreferences', () => {
    let userDataPath;

    beforeEach(() => {
        userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'app-prefs-'));
    });

    afterEach(() => {
        try {
            fs.rmSync(userDataPath, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    test('defaults have version only (junctions live in appsCatalog)', () => {
        expect(DEFAULT_APP_PREFERENCES).toEqual({ version: 1 });
        expect(readAppPreferences(userDataPath)).toEqual({ version: 1 });
    });

    test('write and read round-trip', () => {
        const written = writeAppPreferences(userDataPath, {});
        expect(written.version).toBe(1);
        expect(fs.existsSync(appPreferencesFilePath(userDataPath))).toBe(true);
        expect(readAppPreferences(userDataPath).version).toBe(1);
    });

    test('normalize ignores removed trapezeJunctionSetupEnabled key', () => {
        expect(
            normalizeAppPreferences({ version: 2, trapezeJunctionSetupEnabled: false })
        ).toEqual({ version: 2 });
    });

    test('readAppPreferences recovers from invalid JSON', () => {
        fs.writeFileSync(appPreferencesFilePath(userDataPath), '{not-json', 'utf8');
        expect(readAppPreferences(userDataPath)).toEqual({ version: 1 });
    });
});
