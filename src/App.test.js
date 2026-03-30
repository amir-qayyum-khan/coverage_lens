import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';

// Mock the electronAPI (Dashboard mounts first and registers progress listeners)
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
    cloneAndTest: jest.fn()
};

beforeEach(() => {
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
});

function goToCodeAnalysis() {
    fireEvent.click(screen.getByRole('button', { name: /code analysis/i }));
}

describe('App Component', () => {
    test('renders header with title', () => {
        render(<App />);
        expect(screen.getByText('Voyagerr Lens')).toBeInTheDocument();
        expect(screen.getByText('Environment Dashboard')).toBeInTheDocument();
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
