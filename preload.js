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
    }
});
