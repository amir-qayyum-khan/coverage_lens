const fs = require('fs');
const path = require('path');

/**
 * Lists immediate non-hidden child directories under parentPath (resolved on disk).
 * @param {string} parentPath
 * @returns {string[]} absolute paths, sorted
 */
function listImmediateChildDirectories(parentPath) {
    if (!parentPath || typeof parentPath !== 'string' || !parentPath.trim()) {
        return [];
    }
    let resolved;
    try {
        resolved = path.resolve(parentPath.trim());
    } catch {
        return [];
    }
    let stat;
    try {
        stat = fs.statSync(resolved);
    } catch {
        return [];
    }
    if (!stat.isDirectory()) {
        return [];
    }
    let entries;
    try {
        entries = fs.readdirSync(resolved, { withFileTypes: true });
    } catch {
        return [];
    }
    const out = [];
    for (const dirent of entries) {
        if (!dirent.isDirectory()) continue;
        const name = dirent.name;
        if (name.startsWith('.')) continue;
        out.push(path.join(resolved, name));
    }
    return out.sort((a, b) => a.localeCompare(b));
}

module.exports = {
    listImmediateChildDirectories
};
