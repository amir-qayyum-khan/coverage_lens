const path = require('path');
const fs = require('fs');

const FILE_NAME = 'super-dashboard-known-clones.json';

function knownClonesFilePath(userDataPath) {
    return path.join(userDataPath, FILE_NAME);
}

/** @param {unknown} arr */
function normalizePaths(arr) {
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    const out = [];
    for (const p of arr) {
        if (typeof p !== 'string' || !p.trim()) continue;
        let resolved;
        try {
            resolved = path.resolve(p.trim());
        } catch {
            resolved = p.trim();
        }
        const dedupeKey = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        out.push(resolved);
    }
    return out;
}

/**
 * If the app previously stored known clones under Roaming/Electron (legacy dev name), copy once into this app's userData.
 * @param {string} userDataPath - app.getPath('userData'), e.g. .../Roaming/voyagerr-lens
 * @returns {string[]}
 */
function importLegacyKnownClonesIfEmpty(userDataPath) {
    const roaming = path.dirname(userDataPath);
    const legacyFile = path.join(roaming, 'Electron', FILE_NAME);
    if (!fs.existsSync(legacyFile)) {
        return [];
    }
    try {
        const raw = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
        const list = Array.isArray(raw) ? raw : raw.paths;
        const norm = normalizePaths(list || []);
        if (norm.length === 0) {
            return [];
        }
        return writeKnownClonePaths(userDataPath, norm);
    } catch {
        return [];
    }
}

/**
 * @param {string} userDataPath
 * @returns {string[]}
 */
function readKnownClonePathsWithLegacyImport(userDataPath) {
    const paths = readKnownClonePaths(userDataPath);
    if (paths.length > 0) {
        return paths;
    }
    return importLegacyKnownClonesIfEmpty(userDataPath);
}

/**
 * @param {string} userDataPath
 * @returns {string[]}
 */
function readKnownClonePaths(userDataPath) {
    const fp = knownClonesFilePath(userDataPath);
    if (!fs.existsSync(fp)) {
        return [];
    }
    try {
        const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
        const list = Array.isArray(raw) ? raw : raw.paths;
        return normalizePaths(list || []);
    } catch {
        return [];
    }
}

/**
 * @param {string} userDataPath
 * @param {string[]} paths
 * @returns {string[]}
 */
function writeKnownClonePaths(userDataPath, paths) {
    const norm = normalizePaths(paths);
    const fp = knownClonesFilePath(userDataPath);
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(fp, JSON.stringify({ paths: norm }, null, 2), 'utf8');
    return norm;
}

/**
 * @param {string} userDataPath
 * @param {string} fullPath
 * @returns {string[]}
 */
function appendKnownClonePath(userDataPath, fullPath) {
    if (!fullPath || typeof fullPath !== 'string') {
        return readKnownClonePaths(userDataPath);
    }
    const trimmed = fullPath.trim();
    if (!trimmed) {
        return readKnownClonePaths(userDataPath);
    }
    const [canon] = normalizePaths([trimmed]);
    if (!canon) {
        return readKnownClonePaths(userDataPath);
    }
    const current = readKnownClonePaths(userDataPath);
    const key = process.platform === 'win32' ? canon.toLowerCase() : canon;
    const already = current.some((c) => (process.platform === 'win32' ? c.toLowerCase() : c) === key);
    if (already) {
        return current;
    }
    return writeKnownClonePaths(userDataPath, [...current, canon]);
}

module.exports = {
    FILE_NAME,
    knownClonesFilePath,
    readKnownClonePaths,
    readKnownClonePathsWithLegacyImport,
    importLegacyKnownClonesIfEmpty,
    writeKnownClonePaths,
    appendKnownClonePath,
    normalizePaths
};
