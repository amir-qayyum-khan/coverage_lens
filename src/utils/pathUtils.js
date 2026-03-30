/** Last path segment without trailing slashes (renderer-safe, no Node path) */
export function getBasename(folderPath) {
    if (!folderPath || typeof folderPath !== 'string') return '';
    const normalized = folderPath.replace(/[/\\]+$/, '');
    const parts = normalized.split(/[/\\]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
}
