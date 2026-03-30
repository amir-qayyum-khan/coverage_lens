/** Catalog apps shown on Dashboard and Super Dashboard */

export const YOU_APPS = [
    { name: 'LaunchpadUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTPortalsLaunchpadUI.git' },
    { name: 'YouTravelUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouTravelUI.git' },
    { name: 'YouOperateUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouOperateUI.git' },
    { name: 'YouBookUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouBookUI.git' },
    { name: 'YouDriveUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouDriveUI.git' },
    { name: 'YouDriveAdminUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouDriveAdminUI.git' }
];

export const WE_APPS = [
    { name: 'CoreUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTCoreUI.git' },
    { name: 'WeCertNEMT-UI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTWeCertNEMT-UI.git' },
    { name: 'WeTrackUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTWeTrackUI.git' },
    { name: 'CertUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTCertUI.git' },
    { name: 'CommonUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTCommonUI.git' },
    { name: 'TravelmateWeUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTTravelmateWeUI.git' },
    { name: 'BatchSchedulingAgentUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTBatchSchedulingAgentUI.git' },
    { name: 'YouCertUI', url: 'https://git.we-support.se/Trapeze/TrapezeDRTYouCertUI.git' },
    { name: 'FrameworkUI', url: 'https://git.we-support.se/Trapeze/TrapezeFrameworkUI.git' }
];

/** Folder name produced by git clone (basename of repo URL without .git) */
export function repoFolderKeyFromUrl(repoUrl) {
    const trimmed = String(repoUrl || '').replace(/\.git$/i, '').replace(/\/$/, '');
    const parts = trimmed.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
}
