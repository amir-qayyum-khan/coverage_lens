import React from 'react';
import { render, screen } from '@testing-library/react';
import SuperDashboard from './SuperDashboard';

describe('SuperDashboard', () => {
    const mockFetchRemoteCoverage = jest.fn().mockResolvedValue({ success: false });

    beforeEach(() => {
        mockFetchRemoteCoverage.mockClear();
        window.electronAPI = {
            fetchRemoteCoverage: mockFetchRemoteCoverage
        };
    });

    test('does not render junction setup toggle', async () => {
        render(<SuperDashboard knownClonePaths={[]} />);
        expect(await screen.findByRole('button', { name: /refresh/i })).toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: /junction/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/Enable Trapeze junction links/i)).not.toBeInTheDocument();
    });

    test('renders refresh button', async () => {
        render(<SuperDashboard knownClonePaths={[]} />);
        expect(await screen.findByRole('button', { name: /refresh/i })).toBeInTheDocument();
    });
});
