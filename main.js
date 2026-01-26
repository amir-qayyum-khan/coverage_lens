const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { analyzeFolder } = require('./src/services/codeAnalyzer');
const { runCoverage } = require('./src/services/coverageRunner');

let mainWindow;

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
