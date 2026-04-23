const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Stable userData dir across dev (electron .) and packaged builds so Super Dashboard known-clone paths persist.
try {
    const pkg = require(path.join(__dirname, 'package.json'));
    if (pkg && typeof pkg.name === 'string' && pkg.name.trim()) {
        app.setName(pkg.name.trim());
    }
} catch {
    // ignore
}
const XLSX = require('xlsx');
const { analyzeFolder } = require('./src/services/codeAnalyzer');
const { runCoverage } = require('./src/services/coverageRunner');
const { checkNodeInstalled, checkPackagesInstalled, installNode, TARGET_NODE_VERSION } = require('./src/services/nodeInstaller');
const { checkGitInstalled, installGit } = require('./src/services/gitChecker');
const { cloneAndTest, pushCoverageReport } = require('./src/services/gitOperations');
const { loadCachedSuperDashboardMetrics } = require('./src/services/superDashboardPersist');
const {
    readKnownClonePathsWithLegacyImport,
    writeKnownClonePaths,
    appendKnownClonePath
} = require('./src/services/superDashboardKnownClones');
const { listImmediateChildDirectories } = require('./src/services/superDashboardParentScan');

let mainWindow;
let nodeInstallProgress = null;

function createMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Export to Excel',
                    click: () => {
                        mainWindow.webContents.send('menu:export-excel');
                    }
                },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            role: 'window',
            submenu: [
                { role: 'minimize' },
                { role: 'close' }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        backgroundColor: '#0f0f1a',
        title: 'Voyagerr Lens',
        icon: path.join(__dirname, 'icon.png')
    });

    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));

    // Always open DevTools for now to diagnose issues
    // mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    createWindow();
    createMenu();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// IPC Handlers

// Open folder dialog
ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Folder to Analyze'
    });

    if (result.canceled) {
        return null;
    }

    return result.filePaths[0];
});

// Analyze folder for code metrics
ipcMain.handle('analyze:folder', async (event, folderPath) => {
    try {
        const results = await analyzeFolder(folderPath);
        return { success: true, data: results };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Run Jest coverage
ipcMain.handle('coverage:run', async (event, folderPath) => {
    try {
        const results = await runCoverage(folderPath);
        return { success: true, data: results };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Get folder info
ipcMain.handle('folder:info', async (event, folderPath) => {
    try {
        const stats = fs.statSync(folderPath);
        return {
            success: true,
            data: {
                exists: true,
                isDirectory: stats.isDirectory(),
                path: folderPath
            }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Export data to Excel
ipcMain.handle('export:excel', async (event, { summary, files }) => {
    try {
        const { filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Export Analysis to Excel',
            defaultPath: 'code-analysis-report.xlsx',
            filters: [
                { name: 'Excel Files', extensions: ['xlsx'] }
            ]
        });

        if (!filePath) return { success: false, message: 'Export canceled' };

        const wb = XLSX.utils.book_new();

        // Summary Sheet
        const summaryData = [
            ['Metric', 'Value'],
            ['Total Testable Lines', summary.totalLinesJest],
            ['Total Tested Lines', summary.coveredLines],
            ['Line Coverage (%)', summary.lineCoverage],
            ['Total Testable Statements', summary.totalStatementsJest],
            ['Total Tested Statements', summary.coveredStatements],
            ['Statement Coverage (%)', summary.statementCoverage]
        ];
        const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

        // Details Sheet
        const detailsData = [
            ['File Name', 'Relative Path', 'Total Lines (LOC)', 'Total Statements (AST)', 'Covered Lines', 'Testable Lines', 'Line Coverage (%)', 'Covered Statements', 'Testable Statements', 'Stmt Coverage (%)', 'Missing Lines']
        ];

        files.forEach(f => {
            detailsData.push([
                f.fileName,
                f.relativePath,
                f.totalLinesJest ?? f.lines,
                f.totalStatementsJest ?? f.statements,
                f.coveredLines,
                f.totalLinesJest,
                f.lineCoverage,
                f.coveredStatements,
                f.totalStatementsJest,
                f.statementCoverage,
                (f.missingLines || []).join(', ')
            ]);
        });
        const wsDetails = XLSX.utils.aoa_to_sheet(detailsData);
        XLSX.utils.book_append_sheet(wb, wsDetails, 'File Analysis');

        XLSX.writeFile(wb, filePath);
        return { success: true, path: filePath };
    } catch (error) {
        console.error('Excel export error:', error);
        return { success: false, error: error.message };
    }
});

// Check if Node.js is installed
ipcMain.handle('node:check', async () => {
    try {
        const nodeStatus = checkNodeInstalled();
        return {
            success: true,
            data: {
                ...nodeStatus,
                targetVersion: TARGET_NODE_VERSION
            }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Check if packages are installed in a project
ipcMain.handle('node:checkPackages', async (event, projectPath) => {
    try {
        const packageStatus = checkPackagesInstalled(projectPath);
        return {
            success: true,
            data: packageStatus
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Install Node.js
ipcMain.handle('node:install', async () => {
    try {
        const result = await installNode((progress) => {
            if (mainWindow) {
                mainWindow.webContents.send('node:installProgress', progress);
            }
        });
        return {
            success: result.success,
            message: result.message
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Check if Git is installed
ipcMain.handle('git:check', async () => {
    try {
        const gitStatus = checkGitInstalled();
        return {
            success: true,
            data: gitStatus
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Install Git
ipcMain.handle('git:install', async () => {
    try {
        const result = await installGit((progress) => {
            if (mainWindow) {
                mainWindow.webContents.send('git:installProgress', progress);
            }
        });
        return {
            success: result.success,
            message: result.message
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Known clone roots for Super Dashboard (disk in userData — shared across app instances; localStorage alone can be empty when multiple Electron processes use the same profile)
ipcMain.handle('superDashboard:getKnownClonePaths', async () => {
    try {
        const paths = readKnownClonePathsWithLegacyImport(app.getPath('userData'));
        return { success: true, paths };
    } catch (error) {
        return { success: false, error: error.message, paths: [] };
    }
});

ipcMain.handle('superDashboard:setKnownClonePaths', async (event, { paths }) => {
    try {
        const merged = writeKnownClonePaths(app.getPath('userData'), paths || []);
        return { success: true, paths: merged };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('superDashboard:rememberClone', async (event, { clonePath }) => {
    try {
        const paths = appendKnownClonePath(app.getPath('userData'), clonePath);
        return { success: true, paths };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Load cached Super Dashboard metrics from .code-analyzer/super-dashboard-jest.json under each clone path
ipcMain.handle('superDashboard:loadCached', async (event, { clonePaths }) => {
    try {
        const { metrics, skipped } = loadCachedSuperDashboardMetrics(clonePaths || []);
        return { success: true, data: { metrics, skipped } };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Pick a parent folder whose immediate subfolders are treated as repo roots for Super Dashboard cache lookup
ipcMain.handle('superDashboard:browseReposParent', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select folder containing your cloned repositories'
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) {
        return { success: false, canceled: true };
    }
    const parentPath = result.filePaths[0];
    try {
        const childPaths = listImmediateChildDirectories(parentPath);
        return { success: true, parentPath, childPaths };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Clone and Test an App
ipcMain.handle('app:cloneAndTest', async (event, { repoUrl, targetDir, credentials, branch, progressKey }) => {
    try {
        const result = await cloneAndTest(
            repoUrl,
            targetDir,
            (progress) => {
                if (mainWindow) {
                    mainWindow.webContents.send('app:progress', progress);
                }
            },
            credentials,
            branch,
            progressKey
        );
        return {
            success: result.success,
            message: result.message,
            data: result
        };
    } catch (error) {
        return { success: false, message: error.message };
    }
});

// Push coverage report file to Git (no force push; conflict-safe)
ipcMain.handle('app:pushCoverageReport', async (event, { clonePath, branch, credentials }) => {
    try {
        const result = await pushCoverageReport(clonePath, branch, credentials);
        return result;
    } catch (error) {
        return { success: false, message: error.message };
    }
});

// Fetch the remote coverage JSON from Gitea (tries developV2, then develop)
ipcMain.handle('app:fetchRemoteCoverage', async (event, { repoUrl, credentials }) => {
    const https = require('https');
    const http = require('http');
    const FILE_PATH = '.code-analyzer/super-dashboard-jest.json';
    const BRANCHES = ['developV2', 'develop'];

    function buildRawUrl(url, branch) {
        const base = url.replace(/\.git$/i, '').replace(/\/$/, '');
        return `${base}/raw/branch/${encodeURIComponent(branch)}/${FILE_PATH}`;
    }

    function fetchRaw(rawUrl, creds) {
        return new Promise((resolve) => {
            let urlObj;
            try { urlObj = new URL(rawUrl); } catch { resolve({ ok: false }); return; }
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers: {}
            };
            if (creds && creds.token) {
                const b64 = Buffer.from(`${creds.username || ''}:${creds.token}`).toString('base64');
                options.headers['Authorization'] = `Basic ${b64}`;
            }
            const protocol = urlObj.protocol === 'https:' ? https : http;
            const req = protocol.request(options, (res) => {
                let body = '';
                res.on('data', (c) => { body += c; });
                res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body }));
            });
            req.on('error', () => resolve({ ok: false }));
            req.setTimeout(15000, () => { req.destroy(); resolve({ ok: false }); });
            req.end();
        });
    }

    for (const branch of BRANCHES) {
        const rawUrl = buildRawUrl(repoUrl, branch);
        try {
            const res = await fetchRaw(rawUrl, credentials);
            if (res.ok) {
                try {
                    const data = JSON.parse(res.body);
                    return { success: true, data, branch };
                } catch {
                    // malformed JSON — try next branch
                }
            }
        } catch { /* try next branch */ }
    }
    return { success: false, message: 'Coverage not found on developV2 or develop' };
});

// Open a URL in the system browser (for Gitea auth / token creation)
ipcMain.handle('app:openExternal', async (event, { url }) => {
    try {
        await shell.openExternal(url);
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});
