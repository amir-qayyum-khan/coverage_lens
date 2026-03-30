import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Dashboard from './Dashboard';

const mockElectronAPI = {
    checkNode: jest.fn(),
    checkGit: jest.fn(),
    onNodeInstallProgress: jest.fn(() => () => {}),
    onGitInstallProgress: jest.fn(() => () => {}),
    onAppProgress: jest.fn(() => () => {}),
    selectFolder: jest.fn(),
    cloneAndTest: jest.fn()
};

beforeEach(() => {
    window.electronAPI = mockElectronAPI;
    mockElectronAPI.checkNode.mockResolvedValue({
        success: true,
        data: { loading: false, installed: true, version: '16.0.0' }
    });
    mockElectronAPI.checkGit.mockResolvedValue({
        success: true,
        data: { loading: false, installed: true, version: '2.40.0' }
    });
    jest.clearAllMocks();
});

describe('Dashboard', () => {
    test('typing in branch field does not unmount dashboard', async () => {
        render(<Dashboard onProjectReady={jest.fn()} />);

        await waitFor(() => {
            expect(mockElectronAPI.checkNode).toHaveBeenCalled();
        });

        expect(screen.getByText('Environment Dashboard')).toBeInTheDocument();

        const branchInputs = screen.getAllByPlaceholderText('Branch (default: master)');
        expect(branchInputs.length).toBeGreaterThan(0);

        fireEvent.change(branchInputs[0], { target: { value: 'develop' } });

        expect(screen.getByText('Environment Dashboard')).toBeInTheDocument();
        expect(branchInputs[0].value).toBe('develop');
    });

    test('progress label renders when stage/message are non-objects after progress update', async () => {
        let progressHandler;
        mockElectronAPI.onAppProgress.mockImplementation((cb) => {
            progressHandler = cb;
            return () => {};
        });

        render(<Dashboard onProjectReady={jest.fn()} />);

        await waitFor(() => {
            expect(mockElectronAPI.onAppProgress).toHaveBeenCalled();
        });

        await act(async () => {
            progressHandler({
                repoName: 'CoreUI',
                stage: 'cloning',
                message: 'Starting...',
                percent: 10
            });
        });

        expect(screen.getByText(/Starting\.\.\./)).toBeInTheDocument();
    });
});
