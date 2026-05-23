const path = require('path');
const fs = require('fs');

const FILE_NAME = 'app-preferences.json';
const PREFERENCES_VERSION = 1;

/** Default app preferences — junction setup on for Trapeze UI clones (toggle in Super Dashboard to disable). */
const DEFAULT_APP_PREFERENCES = {
    version: PREFERENCES_VERSION,
    trapezeJunctionSetupEnabled: true
};

/**
 * Path to persisted preferences under Electron userData.
 * @param {string} userDataPath
 * @returns {string}
 */
function appPreferencesFilePath(userDataPath) {
    return path.join(userDataPath, FILE_NAME);
}

/**
 * Normalize raw JSON into a valid preferences object.
 * @param {unknown} raw
 * @returns {{ version: number, trapezeJunctionSetupEnabled: boolean }}
 */
function normalizeAppPreferences(raw) {
    const base = { ...DEFAULT_APP_PREFERENCES };
    if (!raw || typeof raw !== 'object') {
        return base;
    }
    if (typeof raw.trapezeJunctionSetupEnabled === 'boolean') {
        base.trapezeJunctionSetupEnabled = raw.trapezeJunctionSetupEnabled;
    }
    if (typeof raw.version === 'number' && Number.isFinite(raw.version)) {
        base.version = raw.version;
    }
    return base;
}

/**
 * Read app preferences from userData (defaults when file missing or invalid).
 * @param {string} userDataPath
 * @returns {{ version: number, trapezeJunctionSetupEnabled: boolean }}
 */
function readAppPreferences(userDataPath) {
    const fp = appPreferencesFilePath(userDataPath);
    if (!fs.existsSync(fp)) {
        return { ...DEFAULT_APP_PREFERENCES };
    }
    try {
        const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
        return normalizeAppPreferences(raw);
    } catch {
        return { ...DEFAULT_APP_PREFERENCES };
    }
}

/**
 * Merge partial preferences and persist to userData.
 * @param {string} userDataPath
 * @param {Partial<{ trapezeJunctionSetupEnabled: boolean }>} partial
 * @returns {{ version: number, trapezeJunctionSetupEnabled: boolean }}
 */
function writeAppPreferences(userDataPath, partial) {
    const current = readAppPreferences(userDataPath);
    const next = normalizeAppPreferences({ ...current, ...(partial || {}) });
    next.version = PREFERENCES_VERSION;
    const fp = appPreferencesFilePath(userDataPath);
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(next, null, 2), 'utf8');
    return next;
}

/**
 * Whether Trapeze junction (sm-link) setup should run.
 * @param {string} userDataPath
 * @returns {boolean}
 */
function isTrapezeJunctionSetupEnabled(userDataPath) {
    return readAppPreferences(userDataPath).trapezeJunctionSetupEnabled === true;
}

module.exports = {
    FILE_NAME,
    DEFAULT_APP_PREFERENCES,
    appPreferencesFilePath,
    normalizeAppPreferences,
    readAppPreferences,
    writeAppPreferences,
    isTrapezeJunctionSetupEnabled
};
