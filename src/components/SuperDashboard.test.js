import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import SuperDashboard from './SuperDashboard';
import { YOU_APPS, WE_APPS, resolveRemoteCoverageBranches } from '../data/appsCatalog';

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

    test('fetches remote coverage using each app catalog defaultBranch order', async () => {
        render(<SuperDashboard knownClonePaths={[]} />);

        await waitFor(() => {
            expect(mockFetchRemoteCoverage.mock.calls.length).toBe(YOU_APPS.length + WE_APPS.length);
        });

        const byUrl = Object.fromEntries(
            mockFetchRemoteCoverage.mock.calls.map(([url, , branches]) => [url, branches])
        );

        const youTravel = YOU_APPS.find((a) => a.name === 'YouTravelUI');
        const launchpad = YOU_APPS.find((a) => a.name === 'LaunchpadUI');
        const core = WE_APPS.find((a) => a.name === 'CoreUI');

        expect(byUrl[youTravel.url]).toEqual(resolveRemoteCoverageBranches(youTravel));
        expect(byUrl[youTravel.url][0]).toBe('develop');
        expect(byUrl[launchpad.url]).toEqual(['developV2', 'develop']);
        expect(byUrl[core.url][0]).toBe('developV2');
    });
});
