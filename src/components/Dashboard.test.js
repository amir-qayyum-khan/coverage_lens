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
    test('prefills branch fields from catalog defaultBranch', async () => {
        render(<Dashboard onProjectReady={jest.fn()} />);

        await waitFor(() => {
            expect(mockElectronAPI.checkNode).toHaveBeenCalled();
        });

        expect(screen.getByLabelText('LaunchpadUI branch').value).toBe('developV2');
        expect(screen.getByLabelText('YouTravelUI branch').value).toBe('develop');
        expect(screen.getByLabelText('YouDriveUI branch').value).toBe('develop');
        expect(screen.getByLabelText('YouBookUI branch').value).toBe('developV2');
    });

    test('typing in branch field does not unmount dashboard', async () => {
        render(<Dashboard onProjectReady={jest.fn()} />);

        await waitFor(() => {
            expect(mockElectronAPI.checkNode).toHaveBeenCalled();
        });

        expect(screen.getByText('Environment Dashboard')).toBeInTheDocument();

        const branchInput = screen.getByLabelText('LaunchpadUI branch');
        fireEvent.change(branchInput, { target: { value: 'feature/x' } });

        expect(screen.getByText('Environment Dashboard')).toBeInTheDocument();
        expect(branchInput.value).toBe('feature/x');
    });

    test('Restore refills catalog defaultBranch after clear or edit', async () => {
        render(<Dashboard onProjectReady={jest.fn()} />);

        await waitFor(() => {
            expect(mockElectronAPI.checkNode).toHaveBeenCalled();
        });

        const branchInput = screen.getByLabelText('YouTravelUI branch');
        const restoreBtn = screen.getByLabelText('Restore YouTravelUI default branch');

        expect(branchInput.value).toBe('develop');
        expect(restoreBtn).toBeDisabled();

        fireEvent.change(branchInput, { target: { value: '' } });
        expect(branchInput.value).toBe('');
        expect(restoreBtn).not.toBeDisabled();

        fireEvent.click(restoreBtn);
        expect(branchInput.value).toBe('develop');
        expect(restoreBtn).toBeDisabled();

        fireEvent.change(branchInput, { target: { value: 'feature/other' } });
        fireEvent.click(restoreBtn);
        expect(branchInput.value).toBe('develop');
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
