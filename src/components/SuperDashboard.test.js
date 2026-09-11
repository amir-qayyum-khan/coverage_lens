import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import SuperDashboard from './SuperDashboard';
import { YOU_APPS, WE_APPS, resolveRemoteCoverageBranches } from '../data/appsCatalog';

/** Minimal remote payload Super Dashboard treats as a loaded row. */
function coverageResult(tests, branch = 'developV2') {
    return {
        success: true,
        branch,
        data: {
            generatedAt: '2026-09-11T00:00:00.000Z',
            coverage: {
                lines: { pct: 80, covered: 8, total: 10 },
                statements: { pct: 80, covered: 8, total: 10 },
                branches: { pct: 50, covered: 5, total: 10 }
            },
            tests
        }
    };
}

describe('SuperDashboard', () => {
    const mockFetchRemoteCoverage = jest.fn().mockResolvedValue({ success: false });
    const launchpad = YOU_APPS.find((a) => a.name === 'LaunchpadUI');
    const youTravel = YOU_APPS.find((a) => a.name === 'YouTravelUI');
    const youOperate = YOU_APPS.find((a) => a.name === 'YouOperateUI');
    const core = WE_APPS.find((a) => a.name === 'CoreUI');

    beforeEach(() => {
        mockFetchRemoteCoverage.mockReset();
        mockFetchRemoteCoverage.mockResolvedValue({ success: false });
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

    test('shows unit-test passed/failed/total for loaded apps and omits no-data from totals', async () => {
        mockFetchRemoteCoverage.mockImplementation((url) => {
            if (url === launchpad.url) {
                return Promise.resolve(
                    coverageResult({ passedTests: 10, failedTests: 2, totalTests: 12 })
                );
            }
            if (url === youTravel.url) {
                return Promise.resolve(
                    coverageResult({ passedTests: 5, failedTests: 0, totalTests: 5 }, 'develop')
                );
            }
            if (url === youOperate.url) {
                return Promise.resolve(coverageResult(undefined));
            }
            if (url === core.url) {
                return Promise.resolve(
                    coverageResult({
                        passedTests: 100,
                        failedTests: 1,
                        totalTests: 101,
                        incompleteRun: true
                    })
                );
            }
            return Promise.resolve({ success: false });
        });

        render(<SuperDashboard knownClonePaths={[]} />);

        expect((await screen.findAllByRole('columnheader', { name: 'Unit Tests' })).length).toBe(2);

        const launchpadRow = screen.getByText('LaunchpadUI').closest('tr');
        expect(within(launchpadRow).getByText('10 passed')).toBeInTheDocument();
        expect(within(launchpadRow).getByText('2 failed')).toBeInTheDocument();
        expect(within(launchpadRow).getByText('12 total')).toBeInTheDocument();

        const youTravelRow = screen.getByText('YouTravelUI').closest('tr');
        expect(within(youTravelRow).getByText('5 passed')).toBeInTheDocument();

        const coreRow = screen.getByText('CoreUI').closest('tr');
        expect(within(coreRow).getByText('100 passed')).toBeInTheDocument();
        expect(within(coreRow).getByText('⚠ Incomplete run')).toBeInTheDocument();

        const youFooter = screen.getByText('You Apps total').closest('tr');
        expect(within(youFooter).getByText('15 passed')).toBeInTheDocument();
        expect(within(youFooter).getByText('2 failed')).toBeInTheDocument();
        expect(within(youFooter).getByText('17 total')).toBeInTheDocument();

        const weFooter = screen.getByText('We Apps total').closest('tr');
        expect(within(weFooter).getByText('100 passed')).toBeInTheDocument();
        expect(within(weFooter).getByText('1 failed')).toBeInTheDocument();
        expect(within(weFooter).getByText('101 total')).toBeInTheDocument();

        expect(
            screen.getByText('All apps: 115 passed · 3 failed · 118 total')
        ).toBeInTheDocument();

        const youOperateRow = screen.getByText('YouOperateUI').closest('tr');
        expect(youOperateRow).toHaveTextContent('—');
        expect(youOperateRow).not.toHaveTextContent('passed');

        expect(screen.getByText('YouApplyUI').closest('tr')).toHaveTextContent(
            '— No coverage data found'
        );
    });
});
