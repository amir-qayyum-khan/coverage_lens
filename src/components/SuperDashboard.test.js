import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SuperDashboard from './SuperDashboard';

describe('SuperDashboard', () => {
    const mockFetchRemoteCoverage = jest.fn().mockResolvedValue({ success: false });

    beforeEach(() => {
        mockFetchRemoteCoverage.mockClear();
        window.electronAPI = {
            fetchRemoteCoverage: mockFetchRemoteCoverage,
            getAppPreferences: jest.fn().mockResolvedValue({
                success: true,
                data: { trapezeJunctionSetupEnabled: true }
            }),
            setAppPreferences: jest.fn().mockResolvedValue({
                success: true,
                data: { trapezeJunctionSetupEnabled: false }
            })
        };
    });

    test('renders junction toggle checked by default', async () => {
        render(<SuperDashboard knownClonePaths={[]} />);

        const toggle = await screen.findByRole('checkbox', {
            name: /enable trapeze junction links/i
        });
        expect(toggle).toBeChecked();
    });

    test('persists junction toggle when unchecked', async () => {
        render(<SuperDashboard knownClonePaths={[]} />);

        const toggle = await screen.findByRole('checkbox', {
            name: /enable trapeze junction links/i
        });
        fireEvent.click(toggle);

        await waitFor(() => {
            expect(window.electronAPI.setAppPreferences).toHaveBeenCalledWith({
                trapezeJunctionSetupEnabled: false
            });
        });
        expect(toggle).not.toBeChecked();
    });

    test('renders refresh button', async () => {
        render(<SuperDashboard knownClonePaths={[]} />);
        expect(await screen.findByRole('button', { name: /refresh/i })).toBeInTheDocument();
    });
});
