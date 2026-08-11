/** Catalog apps shown on Dashboard and Super Dashboard */

/** Standard Trapeze UI links (CommonUI + Framework). */
const JUNCTIONS_STANDARD = ['we-common', 'we-framework'];

/** CoreUI links (includes WeTrack). */
const JUNCTIONS_CORE = ['we-common', 'we-framework', 'we-track'];

/** Catalog fallback when an app omits defaultBranch. */
const DEFAULT_BRANCH_FALLBACK = 'developV2';

const YOU_APPS = [
    {
        name: 'LaunchpadUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTPortalsLaunchpadUI.git',
        defaultBranch: 'developV2'
    },
    {
        name: 'YouTravelUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouTravelUI.git',
        // Flat layout: package.json / jest / components live at clone root (no src/)
        sourceRoot: '.',
        defaultBranch: 'develop'
    },
    {
        name: 'YouOperateUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouOperateUI.git',
        junctions: [...JUNCTIONS_STANDARD],
        defaultBranch: 'developV2'
    },
    {
        name: 'YouBookUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouBookUI.git',
        junctions: [...JUNCTIONS_STANDARD],
        defaultBranch: 'developV2'
    },
    {
        name: 'YouDriveUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouDriveUI.git',
        // Flat layout: package.json / jest / components live at clone root (no src/)
        sourceRoot: '.',
        defaultBranch: 'develop'
    },
    {
        name: 'YouDriveAdminUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouDriveAdminUI.git',
        defaultBranch: 'developV2'
    },
    {
        name: 'YouCertUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouCertUI.git',
        defaultBranch: 'developV2'
    },
    {
        name: 'YouApplyUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouApply.git',
        junctions: [...JUNCTIONS_STANDARD],
        defaultBranch: 'developV2'
    }
];

const WE_APPS = [
    {
        name: 'CoreUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTCoreUI.git',
        junctions: [...JUNCTIONS_CORE],
        defaultBranch: 'developV2'
    },
    {
        name: 'WeCertNEMT-UI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTWeCertNEMT-UI.git',
        junctions: [...JUNCTIONS_STANDARD],
        defaultBranch: 'developV2'
    },
    {
        name: 'WeTrackUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTWeTrackUI.git',
        defaultBranch: 'develop-we'
    },
    {
        name: 'CertUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTCertUI.git',
        junctions: [...JUNCTIONS_STANDARD],
        defaultBranch: 'developV2'
    },
    {
        name: 'CommonUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTCommonUI.git',
        defaultBranch: 'developV2'
    },
    {
        name: 'TravelmateWeUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTTravelmateWeUI.git',
        junctions: [...JUNCTIONS_STANDARD],
        defaultBranch: 'develop'
    },
    {
        name: 'BatchSchedulingAgentUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTBatchSchedulingAgentUI.git',
        junctions: [...JUNCTIONS_STANDARD],
        defaultBranch: 'developV2'
    },
    {
        name: 'FrameworkUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeFrameworkUI.git',
        defaultBranch: 'developV2'
    },
    {
        name: 'DriverCom',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTDriverCom.git',
        junctions: [...JUNCTIONS_STANDARD],
        sourceRoot: 'source/UI/src',
        defaultBranch: 'developV2'
    }
];

/**
 * Folder name produced by git clone (basename of repo URL without .git)
 * @param {string} repoUrl
 * @returns {string}
 */
function repoFolderKeyFromUrl(repoUrl) {
    const trimmed = String(repoUrl || '').replace(/\.git$/i, '').replace(/\/$/, '');
    const parts = trimmed.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
}

/**
 * Resolve catalog defaultBranch (fallback developV2).
 * @param {{ defaultBranch?: string }|null|undefined} app
 * @returns {string}
 */
function resolveAppDefaultBranch(app) {
    const branch = typeof app?.defaultBranch === 'string' ? app.defaultBranch.trim() : '';
    return branch || DEFAULT_BRANCH_FALLBACK;
}

/**
 * Ordered Gitea branches to try when fetching Super Dashboard unit-test summaries.
 * Prefers the app catalog defaultBranch, then common Trapeze fallbacks.
 * @param {{ defaultBranch?: string }|null|undefined} app
 * @returns {string[]}
 */
function resolveRemoteCoverageBranches(app) {
    const preferred = resolveAppDefaultBranch(app);
    const FALLBACKS = ['developV2', 'develop'];
    const out = [preferred];
    for (const branch of FALLBACKS) {
        if (!out.includes(branch)) {
            out.push(branch);
        }
    }
    return out;
}

/**
 * Normalize catalog junctions to a unique list of known link names.
 * @param {unknown} junctions
 * @returns {string[]}
 */
function normalizeAppJunctions(junctions) {
    if (!Array.isArray(junctions)) {
        return [];
    }
    const allowed = new Set(['we-common', 'we-framework', 'we-track']);
    const out = [];
    for (const name of junctions) {
        if (typeof name === 'string' && allowed.has(name) && !out.includes(name)) {
            out.push(name);
        }
    }
    return out;
}

/**
 * Normalize optional catalog sourceRoot (relative path from clone root).
 * Use `.` or `./` for flat layouts where the clone root is the source tree.
 * Rejects absolute paths and path traversal.
 * @param {unknown} sourceRoot
 * @returns {string|null} Forward-slash relative path (`.` for project root), or null if invalid/empty
 */
function normalizeAppSourceRoot(sourceRoot) {
    if (typeof sourceRoot !== 'string') {
        return null;
    }
    const trimmed = sourceRoot.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!trimmed) {
        return null;
    }
    // `./` strips to `.` via trailing-slash removal; keep explicit project-root marker
    if (trimmed === '.') {
        return '.';
    }
    if (trimmed.includes(':') || trimmed.split('/').some((seg) => seg === '..' || seg === '.')) {
        return null;
    }
    return trimmed;
}

/**
 * Build repo folder basename → junction link names from the apps catalog.
 * @returns {Record<string, string[]>}
 */
function buildJunctionsByRepoFolder() {
    const map = {};
    for (const app of [...YOU_APPS, ...WE_APPS]) {
        const folder = repoFolderKeyFromUrl(app.url);
        if (!folder) {
            continue;
        }
        const links = normalizeAppJunctions(app.junctions);
        if (links.length > 0) {
            map[folder] = links;
        }
    }
    return map;
}

/**
 * Build repo folder basename → relative source root from the apps catalog.
 * @returns {Record<string, string>}
 */
function buildSourceRootByRepoFolder() {
    const map = {};
    for (const app of [...YOU_APPS, ...WE_APPS]) {
        const folder = repoFolderKeyFromUrl(app.url);
        if (!folder) {
            continue;
        }
        const root = normalizeAppSourceRoot(app.sourceRoot);
        if (root) {
            map[folder] = root;
        }
    }
    return map;
}

module.exports = {
    YOU_APPS,
    WE_APPS,
    JUNCTIONS_STANDARD,
    JUNCTIONS_CORE,
    DEFAULT_BRANCH_FALLBACK,
    repoFolderKeyFromUrl,
    resolveAppDefaultBranch,
    resolveRemoteCoverageBranches,
    normalizeAppJunctions,
    normalizeAppSourceRoot,
    buildJunctionsByRepoFolder,
    buildSourceRootByRepoFolder
};
