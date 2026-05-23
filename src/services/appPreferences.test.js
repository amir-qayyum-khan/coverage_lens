const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    DEFAULT_APP_PREFERENCES,
    readAppPreferences,
    writeAppPreferences,
    isTrapezeJunctionSetupEnabled,
    appPreferencesFilePath
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

    test('readAppPreferences returns defaults when file missing', () => {
        const prefs = readAppPreferences(userDataPath);
        expect(prefs).toEqual(DEFAULT_APP_PREFERENCES);
        expect(prefs.trapezeJunctionSetupEnabled).toBe(true);
    });

    test('writeAppPreferences merges and persists', () => {
        const written = writeAppPreferences(userDataPath, { trapezeJunctionSetupEnabled: true });
        expect(written.trapezeJunctionSetupEnabled).toBe(true);
        expect(written.version).toBe(1);

        const reread = readAppPreferences(userDataPath);
        expect(reread.trapezeJunctionSetupEnabled).toBe(true);

        const fp = appPreferencesFilePath(userDataPath);
        expect(fs.existsSync(fp)).toBe(true);
    });

    test('writeAppPreferences preserves other fields when merging', () => {
        writeAppPreferences(userDataPath, { trapezeJunctionSetupEnabled: true });
        const updated = writeAppPreferences(userDataPath, {});
        expect(updated.trapezeJunctionSetupEnabled).toBe(true);
    });

    test('readAppPreferences falls back on invalid JSON', () => {
        const fp = appPreferencesFilePath(userDataPath);
        fs.writeFileSync(fp, '{ not json', 'utf8');
        const prefs = readAppPreferences(userDataPath);
        expect(prefs.trapezeJunctionSetupEnabled).toBe(true);
    });

    test('readAppPreferences ignores non-boolean trapezeJunctionSetupEnabled', () => {
        const fp = appPreferencesFilePath(userDataPath);
        fs.writeFileSync(fp, JSON.stringify({ trapezeJunctionSetupEnabled: 'yes' }), 'utf8');
        const prefs = readAppPreferences(userDataPath);
        expect(prefs.trapezeJunctionSetupEnabled).toBe(true);
    });

    test('isTrapezeJunctionSetupEnabled reflects stored preference', () => {
        expect(isTrapezeJunctionSetupEnabled(userDataPath)).toBe(true);
        writeAppPreferences(userDataPath, { trapezeJunctionSetupEnabled: false });
        expect(isTrapezeJunctionSetupEnabled(userDataPath)).toBe(false);
    });
});
