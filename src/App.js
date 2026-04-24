import React, { useState, useCallback, useEffect } from 'react';
import FolderBrowser from './components/FolderBrowser';
import Summary from './components/Summary';
import ResultsGrid from './components/ResultsGrid';
import AnalysisLoader from './components/AnalysisLoader';
import Dashboard from './components/Dashboard';
import SuperDashboard from './components/SuperDashboard';
import DetachedView from './components/DetachedView';
import logo from './assets/logo.png';
import { getBasename } from './utils/pathUtils';
import {
    loadKnownClonePaths,
    rememberClonePath,
    syncKnownClonePathsToLocalStorage
} from './utils/superDashboardClonePaths';

function App() {
    const [view, setView] = useState('super');
    const [folderPath, setFolderPath] = useState('');
    const [analysisResults, setAnalysisResults] = useState(null);
    const [coverageResults, setCoverageResults] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [error, setError] = useState(null);
    const [coverageMessage, setCoverageMessage] = useState('');
    const [executionTime, setExecutionTime] = useState(null);
    const [currentBranch, setCurrentBranch] = useState(null);
    const [superProjectMetrics, setSuperProjectMetrics] = useState({});
    const [superKnownClonePaths, setSuperKnownClonePaths] = useState([]);
    const [superDashBusy, setSuperDashBusy] = useState(false);

    const refreshSuperDashboardFromPaths = useCallback(async (paths) => {
        if (!paths || paths.length === 0) return;
        const res = await window.electronAPI.loadSuperDashboardCache(paths);
        if (res?.success && res.data?.metrics) {
            setSuperProjectMetrics((prev) => ({ ...prev, ...res.data.metrics }));
        }
    }, []);

    const persistAndReloadSuperPaths = useCallback(
        async (nextPaths) => {
            let merged = nextPaths;
            if (window.electronAPI?.setSuperDashboardKnownClonePaths) {
                const w = await window.electronAPI.setSuperDashboardKnownClonePaths(merged);
                if (w?.success && Array.isArray(w.paths)) {
                    merged = w.paths;
                }
            }
            syncKnownClonePathsToLocalStorage(merged);
            setSuperKnownClonePaths(merged);
            await refreshSuperDashboardFromPaths(merged);
        },
        [refreshSuperDashboardFromPaths]
    );

    const handleBrowseSuperReposParent = useCallback(async () => {
        setError(null);
        const api = window.electronAPI?.browseSuperDashboardReposParent;
        if (!api) {
            setError('Super Dashboard folder browse is not available.');
            return;
        }
        setSuperDashBusy(true);
        try {
            const res = await api();
            if (!res || res.canceled) return;
            if (!res.success) {
                setError(res.error || 'Failed to read subfolders under the selected path.');
                return;
            }
            const children = res.childPaths || [];
            if (children.length === 0) {
                setError(
                    'No subfolders found. Choose the directory that contains your cloned repo folders (each repo as its own subfolder).'
                );
                return;
            }
            const diskRes = await window.electronAPI.getSuperDashboardKnownClonePaths();
            const fromDisk =
                diskRes?.success && Array.isArray(diskRes.paths) ? diskRes.paths : [];
            const fromLocal = loadKnownClonePaths();
            const merged = [...new Set([...fromDisk, ...fromLocal, ...children])];
            await persistAndReloadSuperPaths(merged);
        } catch (e) {
            setError(e.message || String(e));
        } finally {
            setSuperDashBusy(false);
        }
    }, [persistAndReloadSuperPaths]);

    const handleAddSingleSuperRepoFolder = useCallback(async () => {
        setError(null);
        setSuperDashBusy(true);
        try {
            const selected = await window.electronAPI.selectFolder();
            if (!selected) return;
            const diskRes = await window.electronAPI.getSuperDashboardKnownClonePaths();
            const fromDisk =
                diskRes?.success && Array.isArray(diskRes.paths) ? diskRes.paths : [];
            const fromLocal = loadKnownClonePaths();
            const merged = [...new Set([...fromDisk, ...fromLocal, selected.trim()])];
            await persistAndReloadSuperPaths(merged);
        } catch (e) {
            setError(e.message || String(e));
        } finally {
            setSuperDashBusy(false);
        }
    }, [persistAndReloadSuperPaths]);

    useEffect(() => {
        // Detect detached view from URL parameters
        const params = new URLSearchParams(window.location.search);
        if (params.get('view') === 'detached') {
            setView('detached');
        }

        let cancelled = false;
        (async () => {
            let pathsFromFile = [];
            try {
                if (window.electronAPI?.getSuperDashboardKnownClonePaths) {
                    const fileRes = await window.electronAPI.getSuperDashboardKnownClonePaths();
                    if (!cancelled && fileRes?.success && Array.isArray(fileRes.paths)) {
                        pathsFromFile = fileRes.paths;
                    }
                }
            } catch (e) {
                console.warn('Super Dashboard known paths (userData) read failed:', e.message);
            }
            const fromLocalStorage = loadKnownClonePaths();
            let merged = [...new Set([...pathsFromFile, ...fromLocalStorage])];
            if (merged.length > 0) {
                syncKnownClonePathsToLocalStorage(merged);
            }
            const sameSet =
                merged.length === pathsFromFile.length &&
                merged.every((p) => pathsFromFile.includes(p));
            if (!cancelled && !sameSet && merged.length > 0 && window.electronAPI?.setSuperDashboardKnownClonePaths) {
                try {
                    const wrote = await window.electronAPI.setSuperDashboardKnownClonePaths(merged);
                    if (wrote?.success && Array.isArray(wrote.paths)) {
                        merged = wrote.paths;
                    }
                } catch (e) {
                    console.warn('Super Dashboard known paths (userData) merge write failed:', e.message);
                }
            }
            if (!cancelled) {
                setSuperKnownClonePaths(merged);
            }
            if (merged.length === 0) return;
            try {
                const res = await window.electronAPI.loadSuperDashboardCache(merged);
                if (cancelled || !res?.success || !res.data?.metrics) return;
                setSuperProjectMetrics((prev) => ({ ...prev, ...res.data.metrics }));
            } catch (e) {
                console.warn('Super Dashboard cache load failed:', e.message);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const handleFolderSelect = useCallback(async () => {
        try {
            const selectedPath = await window.electronAPI.selectFolder();
            if (selectedPath) {
                setFolderPath(selectedPath);
                setError(null);
            }
        } catch (err) {
            setError('Failed to open folder dialog: ' + err.message);
        }
    }, []);

    const handleAnalyze = useCallback(async (pathOverride = null) => {
        const targetPath = pathOverride || folderPath;
        if (!targetPath) {
            setError('Please select a folder first');
            return;
        }

        setIsLoading(true);
        setError(null);
        setAnalysisResults(null);
        setCoverageResults(null);
        setExecutionTime(null);
        const startTime = Date.now();

        try {
            // Step 1: Analyze code
            setLoadingMessage('Analyzing code structure...');
            const analysisResponse = await window.electronAPI.analyzeFolder(targetPath);

            if (!analysisResponse.success) {
                throw new Error(analysisResponse.error || 'Analysis failed');
            }

            setAnalysisResults(analysisResponse.data);

            // Step 2: Run coverage
            setLoadingMessage('Running tests and collecting coverage...');
            const coverageResponse = await window.electronAPI.runCoverage(targetPath);

            const emptySummary = {
                lines: { total: 0, covered: 0, pct: 0 },
                statements: { total: 0, covered: 0, pct: 0 },
                branches: { total: 0, covered: 0, pct: 0 }
            };

            if (coverageResponse.success) {
                setCoverageResults(coverageResponse.data);
                setCoverageMessage(coverageResponse.data.message || '');
            } else {
                // Coverage might fail but analysis succeeded
                console.warn('Coverage collection failed:', coverageResponse.error);
                setCoverageMessage('Failed to collect coverage: ' + coverageResponse.error);
                setCoverageResults({
                    hasCoverage: false,
                    files: [],
                    summary: emptySummary
                });
            }

            const folderKey = getBasename(targetPath);
            if (folderKey) {
                rememberClonePath(targetPath);
                const summaryForSuper =
                    coverageResponse.success && coverageResponse.data?.summary
                        ? coverageResponse.data.summary
                        : emptySummary;
                setSuperProjectMetrics((prev) => ({
                    ...prev,
                    [folderKey]: {
                        lines: summaryForSuper.lines,
                        statements: summaryForSuper.statements,
                        branches: summaryForSuper.branches
                    }
                }));
            }

        } catch (err) {
            setError(err.message);
        } finally {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            setExecutionTime(elapsed);
            setIsLoading(false);
            setLoadingMessage('');
        }
    }, [folderPath]);



    // Merge analysis and coverage data for each file
    const getMergedResults = useCallback(() => {
        if (!analysisResults) return [];

        const coverageMap = new Map();
        if (coverageResults && coverageResults.files) {
            coverageResults.files.forEach(file => {
                coverageMap.set(file.relativePath, file);
            });
        }

        return analysisResults.files.map(file => {
            const coverage = coverageMap.get(file.relativePath) || {};
            return {
                ...file,
                lineCoverage: coverage.lines?.pct ?? null,
                coveredLines: coverage.lines?.covered ?? null,
                totalLinesJest: coverage.lines?.total ?? null,
                statementCoverage: coverage.statements?.pct ?? null,
                coveredStatements: coverage.statements?.covered ?? null,
                totalStatementsJest: coverage.statements?.total ?? null,
                missingLines: coverage.missingLines || []
            };
        });
    }, [analysisResults, coverageResults]);

    // Calculate summary statistics
    const getSummary = useCallback(() => {
        const defaultSummary = {
            totalLines: 0,
            totalStatements: 0,
            coveredLines: null,
            coveredStatements: null,
            totalLinesJest: null,
            totalStatementsJest: null,
            lineCoverage: null,
            statementCoverage: null
        };

        if (!analysisResults) return defaultSummary;

        const summary = {
            totalLines: analysisResults.summary.totalCodeLines,
            totalStatements: analysisResults.summary.totalStatements,
            coveredLines: coverageResults?.summary?.lines?.covered ?? null,
            coveredStatements: coverageResults?.summary?.statements?.covered ?? null,
            totalLinesJest: coverageResults?.summary?.lines?.total ?? null,
            totalStatementsJest: coverageResults?.summary?.statements?.total ?? null,
            lineCoverage: coverageResults?.summary?.lines?.pct ?? null,
            statementCoverage: coverageResults?.summary?.statements?.pct ?? null
        };

        return summary;
    }, [analysisResults, coverageResults]);

    const handleExport = useCallback(async () => {
        setError(null);
        const mergedResults = getMergedResults();
        const summary = getSummary();

        if (mergedResults.length === 0) {
            setError('No results to export. Please analyze a folder first.');
            return;
        }

        try {
            const response = await window.electronAPI.saveExcelFile({
                summary,
                files: mergedResults
            });

            if (response.success) {
                console.log('Exported successfully to:', response.path);
            } else if (response.message !== 'Export canceled') {
                setError('Failed to export to Excel: ' + response.error);
            }
        } catch (err) {
            setError('Failed to export to Excel: ' + err.message);
        }
    }, [getMergedResults, getSummary]);

    useEffect(() => {
        const removeListener = window.electronAPI.onExportExcel(() => {
            handleExport();
        });
        return () => {
            if (removeListener && typeof removeListener === 'function') {
                removeListener();
            }
        };
    }, [handleExport]);

    return (
        <div className="app">
            {view !== 'detached' && (
                <header className="main-header">
                    <div className="header-left">
                        <img src={logo} alt="Voyagerr Lens" className="app-logo" />
                        <h1 className="app-title">Voyagerr Lens</h1>
                    </div>
                    <nav className="main-nav">
                        <button
                            className={`nav-item ${view === 'super' ? 'active' : ''}`}
                            onClick={() => setView('super')}
                        >
                            Super Dashboard
                        </button>
                        <button
                            className={`nav-item ${view === 'dashboard' ? 'active' : ''}`}
                            onClick={() => setView('dashboard')}
                        >
                            Dashboard
                        </button>
                        <button
                            className={`nav-item ${view === 'analysis' ? 'active' : ''}`}
                            onClick={() => setView('analysis')}
                        >
                            Code Analysis
                        </button>
                    </nav>
                </header>
            )}

            <main className="content">
                {error && (
                    <div className="error-banner fade-in">
                        <span className="error-icon">⚠️</span>
                        <span>{error}</span>
                    </div>
                )}

                {view === 'detached' ? (
                    <DetachedView />
                ) : view === 'super' ? (
                    <SuperDashboard
                        knownClonePaths={superKnownClonePaths}
                        onBrowseReposParent={handleBrowseSuperReposParent}
                        onAddRepoFolder={handleAddSingleSuperRepoFolder}
                        busy={superDashBusy}
                    />
                ) : view === 'dashboard' ? (
                    <Dashboard />
                ) : (
                    <div className="analysis-view fade-in">
                        {/* Coverage Warning */}
                        {coverageMessage && (
                            <div className="error-banner warning fade-in" style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', borderColor: 'rgba(245, 158, 11, 0.3)', color: '#fbbf24' }}>
                                <span className="error-icon">ℹ️</span>
                                <span>{coverageMessage}</span>
                            </div>
                        )}

                        {/* Folder Browser */}
                        <FolderBrowser
                            folderPath={folderPath}
                            onFolderPathChange={setFolderPath}
                            onBrowse={handleFolderSelect}
                            onAnalyze={handleAnalyze}
                            isLoading={isLoading}
                        />

                        {/* Summary Section */}
                        {analysisResults && (
                            <Summary {...getSummary()} executionTime={executionTime} />
                        )}

                        {/* Results Grid */}
                        {analysisResults ? (
                            <ResultsGrid
                                files={getMergedResults()}
                                totalFiles={analysisResults.summary.totalFiles}
                            />
                        ) : (
                            <div className="empty-state fade-in">
                                <div className="empty-state-logo-container">
                                    <img src={logo} alt="Voyagerr Logo" className="empty-state-logo" />
                                </div>
                                <h2 className="empty-state-title">No folder selected</h2>
                                <p className="empty-state-text">
                                    Select a folder to analyze its JavaScript files for code metrics and test coverage using Voyagerr Lens.
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* Loading Overlay */}
            {isLoading && (
                <AnalysisLoader loadingMessage={loadingMessage} />
            )}
        </div>
    );
}

export default App;
