const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Open native folder selection dialog
    selectFolder: () => ipcRenderer.invoke('dialog:openDirectory'),

    // Analyze a folder for code metrics (lines, statements)
    analyzeFolder: (folderPath) => ipcRenderer.invoke('analyze:folder', folderPath),

    // Run Jest coverage on a folder
    runCoverage: (folderPath) => ipcRenderer.invoke('coverage:run', folderPath),

    // Get folder information
    getFolderInfo: (folderPath) => ipcRenderer.invoke('folder:info', folderPath),
    saveExcelFile: (data) => ipcRenderer.invoke('export:excel', data),
    onExportExcel: (callback) => {
        const subscription = (event) => callback();
        ipcRenderer.on('menu:export-excel', subscription);
        return () => {
            ipcRenderer.removeListener('menu:export-excel', subscription);
        };
    },

    // Node.js installation APIs
    checkNode: () => ipcRenderer.invoke('node:check'),
    checkPackages: (projectPath) => ipcRenderer.invoke('node:checkPackages', projectPath),
    installNode: () => ipcRenderer.invoke('node:install'),
    onNodeInstallProgress: (callback) => {
        const subscription = (event, progress) => callback(progress);
        ipcRenderer.on('node:installProgress', subscription);
        return () => {
            ipcRenderer.removeListener('node:installProgress', subscription);
        };
    },

    // Git APIs
    checkGit: () => ipcRenderer.invoke('git:check'),
    installGit: () => ipcRenderer.invoke('git:install'),
    onGitInstallProgress: (callback) => {
        const subscription = (event, progress) => callback(progress);
        ipcRenderer.on('git:installProgress', subscription);
        return () => {
            ipcRenderer.removeListener('git:installProgress', subscription);
        };
    },

    // Super Dashboard: read cached jest summaries from known clone roots
    loadSuperDashboardCache: (clonePaths) =>
        ipcRenderer.invoke('superDashboard:loadCached', { clonePaths }),
    getSuperDashboardKnownClonePaths: () => ipcRenderer.invoke('superDashboard:getKnownClonePaths'),
    setSuperDashboardKnownClonePaths: (paths) =>
        ipcRenderer.invoke('superDashboard:setKnownClonePaths', { paths }),
    rememberSuperDashboardClone: (clonePath) =>
        ipcRenderer.invoke('superDashboard:rememberClone', { clonePath }),
    browseSuperDashboardReposParent: () => ipcRenderer.invoke('superDashboard:browseReposParent'),

    // App Operations APIs
    cloneAndTest: (repoUrl, targetDir, credentials, branch, progressKey) =>
        ipcRenderer.invoke('app:cloneAndTest', { repoUrl, targetDir, credentials, branch, progressKey }),
    onAppProgress: (callback) => {
        const subscription = (event, progress) => callback(progress);
        ipcRenderer.on('app:progress', subscription);
        return () => {
            ipcRenderer.removeListener('app:progress', subscription);
        };
    }
});
