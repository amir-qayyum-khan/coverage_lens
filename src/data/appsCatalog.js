/** Catalog apps shown on Dashboard and Super Dashboard */

/** Standard Trapeze UI links (CommonUI + Framework). */
const JUNCTIONS_STANDARD = ['we-common', 'we-framework'];

/** CoreUI links (includes WeTrack). */
const JUNCTIONS_CORE = ['we-common', 'we-framework', 'we-track'];

const YOU_APPS = [
    { name: 'LaunchpadUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTPortalsLaunchpadUI.git' },
    { name: 'YouTravelUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouTravelUI.git' },
    {
        name: 'YouOperateUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouOperateUI.git',
        junctions: [...JUNCTIONS_STANDARD]
    },
    {
        name: 'YouBookUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouBookUI.git',
        junctions: [...JUNCTIONS_STANDARD]
    },
    { name: 'YouDriveUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouDriveUI.git' },
    { name: 'YouDriveAdminUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouDriveAdminUI.git' },
    { name: 'YouCertUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouCertUI.git' }
];

const WE_APPS = [
    {
        name: 'CoreUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTCoreUI.git',
        junctions: [...JUNCTIONS_CORE]
    },
    {
        name: 'WeCertNEMT-UI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTWeCertNEMT-UI.git',
        junctions: [...JUNCTIONS_STANDARD]
    },
    { name: 'WeTrackUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTWeTrackUI.git' },
    {
        name: 'CertUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTCertUI.git',
        junctions: [...JUNCTIONS_STANDARD]
    },
    { name: 'CommonUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTCommonUI.git' },
    {
        name: 'TravelmateWeUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTTravelmateWeUI.git',
        junctions: [...JUNCTIONS_STANDARD]
    },
    {
        name: 'BatchSchedulingAgentUI',
        url: 'https://git.we-support.se/Trapeze/TrapezeDRTBatchSchedulingAgentUI.git',
        junctions: [...JUNCTIONS_STANDARD]
    },
    { name: 'FrameworkUI', url: 'https://git.we-support.se/Trapeze/TrapezeFrameworkUI.git' }
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

module.exports = {
    YOU_APPS,
    WE_APPS,
    JUNCTIONS_STANDARD,
    JUNCTIONS_CORE,
    repoFolderKeyFromUrl,
    normalizeAppJunctions,
    buildJunctionsByRepoFolder
};
