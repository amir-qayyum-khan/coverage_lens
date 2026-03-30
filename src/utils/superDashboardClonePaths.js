const STORAGE_KEY = 'super_dashboard_known_clone_paths';

/** Mirror paths from main-process userData into localStorage (helps when a new window/session had empty storage). */
export function syncKnownClonePathsToLocalStorage(paths) {
    if (!Array.isArray(paths) || paths.length === 0) return;
    try {
        const clean = [
            ...new Set(paths.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim()))
        ];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch {
        // ignore quota / private mode
    }
}

/** @returns {string[]} */
export function loadKnownClonePaths() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(arr)) return [];
        return [...new Set(arr.filter((p) => typeof p === 'string' && p.trim()))];
    } catch {
        return [];
    }
}

/** Remember a repository root so Super Dashboard can reload cached Jest summaries on next launch. */
export function rememberClonePath(fullPath) {
    if (!fullPath || typeof fullPath !== 'string') return;
    const normalized = fullPath.trim();
    if (!normalized) return;
    const paths = loadKnownClonePaths();
    if (paths.includes(normalized)) return;
    paths.push(normalized);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
    // Persist in main process userData so a second app instance sees the same paths (localStorage can be unreliable with multiple Electron processes on one profile).
    if (typeof window !== 'undefined' && window.electronAPI?.rememberSuperDashboardClone) {
        window.electronAPI.rememberSuperDashboardClone(normalized).catch(() => {});
    }
}
