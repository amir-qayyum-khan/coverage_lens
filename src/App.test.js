import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';

// Mock the electronAPI (Dashboard registers progress listeners when that view is opened)
const mockElectronAPI = {
    selectFolder: jest.fn(),
    analyzeFolder: jest.fn(),
    runCoverage: jest.fn(),
    getFolderInfo: jest.fn(),
    onExportExcel: jest.fn(() => () => {}),
    saveExcelFile: jest.fn(),
    checkNode: jest.fn().mockResolvedValue({
        success: true,
        data: { loading: false, installed: true, version: '16.0.0' }
    }),
    checkGit: jest.fn().mockResolvedValue({
        success: true,
        data: { loading: false, installed: true, version: '2.40.0' }
    }),
    onNodeInstallProgress: jest.fn(() => () => {}),
    onGitInstallProgress: jest.fn(() => () => {}),
    onAppProgress: jest.fn(() => () => {}),
    installNode: jest.fn(),
    installGit: jest.fn(),
    cloneAndTest: jest.fn(),
    loadSuperDashboardCache: jest.fn().mockResolvedValue({ success: true, data: { metrics: {}, skipped: [] } }),
    getSuperDashboardKnownClonePaths: jest.fn().mockResolvedValue({ success: true, paths: [] }),
    setSuperDashboardKnownClonePaths: jest.fn().mockImplementation((paths) =>
        Promise.resolve({ success: true, paths: paths || [] })
    ),
    rememberSuperDashboardClone: jest.fn().mockResolvedValue({ success: true, paths: [] }),
    browseSuperDashboardReposParent: jest.fn().mockResolvedValue({ success: false, canceled: true })
};

beforeEach(() => {
    localStorage.clear();
    window.electronAPI = mockElectronAPI;
    jest.clearAllMocks();
    mockElectronAPI.checkNode.mockResolvedValue({
        success: true,
        data: { loading: false, installed: true, version: '16.0.0' }
    });
    mockElectronAPI.checkGit.mockResolvedValue({
        success: true,
        data: { loading: false, installed: true, version: '2.40.0' }
    });
    mockElectronAPI.setSuperDashboardKnownClonePaths.mockImplementation((paths) =>
        Promise.resolve({ success: true, paths: paths || [] })
    );
    mockElectronAPI.loadSuperDashboardCache.mockResolvedValue({
        success: true,
        data: { metrics: {}, skipped: [] }
    });
    mockElectronAPI.getSuperDashboardKnownClonePaths.mockResolvedValue({ success: true, paths: [] });
    mockElectronAPI.browseSuperDashboardReposParent.mockResolvedValue({ success: false, canceled: true });
});

function goToCodeAnalysis() {
    fireEvent.click(screen.getByRole('button', { name: /code analysis/i }));
}

describe('App Component', () => {
    test('Set repos folder registers subfolders and reloads Super Dashboard cache', async () => {
        mockElectronAPI.getSuperDashboardKnownClonePaths.mockResolvedValue({ success: true, paths: [] });
        mockElectronAPI.setSuperDashboardKnownClonePaths.mockResolvedValue({
            success: true,
            paths: ['/data/repos/TrapezeDRTCoreUI']
        });
        mockElectronAPI.browseSuperDashboardReposParent.mockResolvedValue({
            success: true,
            parentPath: '/data/repos',
            childPaths: ['/data/repos/TrapezeDRTCoreUI']
        });
        mockElectronAPI.loadSuperDashboardCache.mockResolvedValue({
            success: true,
            data: {
                metrics: {
                    TrapezeDRTCoreUI: {
                        lines: { pct: 12, covered: 1, total: 8 },
                        statements: { pct: 11, covered: 1, total: 8 },
                        branches: { pct: 10, covered: 1, total: 8 }
                    }
                },
                skipped: []
            }
        });

        render(<App />);

        fireEvent.click(
            screen.getByRole('button', { name: /browse for folder containing all cloned repositories/i })
        );

        await waitFor(() => {
            expect(mockElectronAPI.setSuperDashboardKnownClonePaths).toHaveBeenCalledWith([
                '/data/repos/TrapezeDRTCoreUI'
            ]);
        });
        await waitFor(() => {
            expect(mockElectronAPI.loadSuperDashboardCache).toHaveBeenCalledWith([
                '/data/repos/TrapezeDRTCoreUI'
            ]);
        });
        await waitFor(() => {
            expect(screen.getByText(/1.*8.*\(12%\)/)).toBeInTheDocument();
        });
    });

    test('loads cached super dashboard metrics on mount when clone paths are stored', async () => {
        localStorage.setItem(
            'super_dashboard_known_clone_paths',
            JSON.stringify(['/data/TrapezeDRTCoreUI'])
        );
        mockElectronAPI.loadSuperDashboardCache.mockResolvedValue({
            success: true,
            data: {
                metrics: {
                    TrapezeDRTCoreUI: {
                        lines: { pct: 50, covered: 5, total: 10 },
                        statements: { pct: 40, covered: 4, total: 10 },
                        branches: { pct: 30, covered: 3, total: 10 }
                    }
                },
                skipped: []
            }
        });

        render(<App />);

        await waitFor(() => {
            expect(mockElectronAPI.setSuperDashboardKnownClonePaths).toHaveBeenCalledWith(['/data/TrapezeDRTCoreUI']);
        });
        await waitFor(() => {
            expect(mockElectronAPI.loadSuperDashboardCache).toHaveBeenCalledWith(['/data/TrapezeDRTCoreUI']);
        });
        await waitFor(() => {
            expect(screen.getByText(/5.*10.*\(50%\)/)).toBeInTheDocument();
        });
    });

    test('renders header with title and Super Dashboard first', () => {
        render(<App />);
        expect(screen.getByText('Voyagerr Lens')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Super Dashboard' })).toBeInTheDocument();
        const nav = document.querySelector('.main-nav');
        expect(nav).toBeTruthy();
        const navButtons = [...nav.querySelectorAll('button')];
        expect(navButtons[0].textContent).toMatch(/Super Dashboard/i);
        expect(navButtons[1].textContent).toMatch(/^Dashboard$/i);
    });

    test('renders empty state initially', () => {
        render(<App />);
        goToCodeAnalysis();
        expect(screen.getByText('No folder selected')).toBeInTheDocument();
        expect(screen.getByText(/Select a folder to analyze its JavaScript files for code metrics and test coverage using Voyagerr Lens\./i)).toBeInTheDocument();
    });

    test('renders folder browser with browse button', () => {
        render(<App />);
        goToCodeAnalysis();
        expect(screen.getByRole('button', { name: /browse/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /analyze/i })).toBeInTheDocument();
    });

    test('browse button calls selectFolder', async () => {
        mockElectronAPI.selectFolder.mockResolvedValue('/test/path');

        render(<App />);
        goToCodeAnalysis();

        const browseButton = screen.getByRole('button', { name: /browse/i });
        fireEvent.click(browseButton);

        await waitFor(() => {
            expect(mockElectronAPI.selectFolder).toHaveBeenCalled();
        });
    });

    test('analyze button is disabled when no folder selected', () => {
        render(<App />);
        goToCodeAnalysis();

        const analyzeButton = screen.getByRole('button', { name: /analyze/i });
        expect(analyzeButton).toBeDisabled();
    });

    test('shows error when analysis fails', async () => {
        mockElectronAPI.selectFolder.mockResolvedValue('/test/path');
        mockElectronAPI.analyzeFolder.mockResolvedValue({
            success: false,
            error: 'Test error message'
        });

        render(<App />);
        goToCodeAnalysis();

        // Select folder first
        const browseButton = screen.getByRole('button', { name: /browse/i });
        fireEvent.click(browseButton);

        await waitFor(() => {
            expect(screen.getByDisplayValue('/test/path')).toBeInTheDocument();
        });

        // Click analyze
        const analyzeButton = screen.getByRole('button', { name: /analyze/i });
        fireEvent.click(analyzeButton);

        await waitFor(() => {
            expect(screen.getByText('Test error message')).toBeInTheDocument();
        });
    });

    test('displays results after successful analysis', async () => {
        mockElectronAPI.selectFolder.mockResolvedValue('/test/path');
        mockElectronAPI.analyzeFolder.mockResolvedValue({
            success: true,
            data: {
                folderPath: '/test/path',
                files: [
                    {
                        filePath: '/test/path/file1.js',
                        fileName: 'file1.js',
                        relativePath: 'file1.js',
                        totalLines: 100,
                        codeLines: 80,
                        statements: 50,
                        success: true
                    }
                ],
                summary: {
                    totalFiles: 1,
                    totalLines: 100,
                    totalCodeLines: 80,
                    totalStatements: 50
                }
            }
        });
        mockElectronAPI.runCoverage.mockResolvedValue({
            success: true,
            data: {
                hasCoverage: true,
                files: [],
                summary: {
                    lines: { total: 100, covered: 80, pct: 80 },
                    statements: { total: 50, covered: 40, pct: 80 }
                }
            }
        });

        render(<App />);
        goToCodeAnalysis();

        // Select folder and analyze
        fireEvent.click(screen.getByRole('button', { name: /browse/i }));

        await waitFor(() => {
            expect(screen.getByDisplayValue('/test/path')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: /analyze/i }));

        // Wait for analysis to complete (loading overlay to disappear)
        await waitFor(() => {
            expect(screen.queryByText(/analyzing/i)).not.toBeInTheDocument();
        }, { timeout: 3000 });

        await waitFor(() => {
            // Check for total testable lines (100)
            expect(screen.getAllByText(/100/).length).toBeGreaterThan(0);
            // Check for tested lines (80)
            expect(screen.getAllByText(/80/).length).toBeGreaterThan(0);
            // Check for total testable statements (50)
            expect(screen.getAllByText(/50/).length).toBeGreaterThan(0);
        }, { timeout: 2000 });
    });
});
