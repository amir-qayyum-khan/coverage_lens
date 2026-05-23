import React from 'react';
import { render, screen, within } from '@testing-library/react';
import CoverageDetails from './CoverageDetails';

/**
 * Build component props for coverage details rendering tests.
 * Inputs: optional override objects for coverage and analysis payloads.
 * Output: fully shaped props object accepted by CoverageDetails.
 */
const buildProps = ({ coverageResults, analysisResults } = {}) => ({
    coverageResults: coverageResults || {
        hasCoverage: true,
        summary: {
            lines: { total: 100, covered: 33, pct: 33 },
            statements: { total: 200, covered: 65, pct: 32.5 }
        },
        files: [
            {
                relativePath: 'src/known.js',
                lines: { total: 100, covered: 33, pct: 33 },
                statements: { total: 200, covered: 65, pct: 32.5 },
                missingLines: [10, 12]
            }
        ],
        totalTests: 10,
        passedTests: 9,
        failedTests: 1,
        diagnostics: {}
    },
    analysisResults: analysisResults || {
        files: [
            { relativePath: 'src/known.js', codeLines: 100, statements: 200 },
            { relativePath: 'src/unmatched.js', codeLines: 1000, statements: 500 }
        ]
    },
    folderPath: 'D:/repo/source',
    executionTime: '2.5',
    branch: 'develop'
});

describe('CoverageDetails totals alignment', () => {
    beforeEach(() => {
        window.electronAPI = {
            fileExists: jest.fn().mockResolvedValue(false)
        };
    });

    test('shows strict Jest summary totals even when unmatched files exist', async () => {
        render(<CoverageDetails {...buildProps()} />);

        // Wait for async colocated-test hint effect to settle once.
        await screen.findByText(/analyzed file/i);

        expect(
            screen.getByText(/had no matching Jest coverage row/i)
        ).toBeInTheDocument();
        expect(
            screen.getByText(/strict Jest summary values/i)
        ).toBeInTheDocument();

        const totalStatementsLabel = screen.getByText('Total Testable Statements');
        const totalStatementsCard = totalStatementsLabel.closest('.summary-card');
        expect(within(totalStatementsCard).getByText('200')).toBeInTheDocument();

        const coveredStatementsLabel = screen.getByText(/Covered Statements/i);
        const coveredStatementsCard = coveredStatementsLabel.closest('.summary-card');
        expect(within(coveredStatementsCard).getByText('65')).toBeInTheDocument();
    });

    test('shows hybrid execution mode in Jest banner', async () => {
        render(
            <CoverageDetails
                {...buildProps({
                    coverageResults: {
                        hasCoverage: true,
                        summary: {
                            lines: { total: 10, covered: 5, pct: 50 },
                            statements: { total: 10, covered: 5, pct: 50 }
                        },
                        files: [],
                        totalTests: 5,
                        passedTests: 5,
                        failedTests: 0,
                        diagnostics: {
                            coverageExecutionMode: 'hybrid',
                            phasesUsed: ['full-fallback', 'batch'],
                            jestMessage: 'Coverage from 30/37 test file(s) (7 failed)'
                        }
                    }
                })}
            />
        );
        await screen.findByText(/Collected via hybrid/i);
        expect(screen.getByText(/full-fallback → batch/i)).toBeInTheDocument();
    });

    test('shows coverage table when hasCoverage despite test failures', async () => {
        render(
            <CoverageDetails
                {...buildProps({
                    coverageResults: {
                        hasCoverage: true,
                        success: false,
                        message: 'Coverage from 2/3 test file(s) (1 failed)',
                        summary: {
                            lines: { total: 10, covered: 5, pct: 50 },
                            statements: { total: 10, covered: 5, pct: 50 }
                        },
                        files: [
                            {
                                relativePath: 'src/known.js',
                                lines: { total: 10, covered: 5, pct: 50 },
                                statements: { total: 10, covered: 5, pct: 50 },
                                missingLines: []
                            }
                        ],
                        totalTests: 5,
                        passedTests: 4,
                        failedTests: 1,
                        diagnostics: {
                            jestMessage: 'Coverage from 2/3 test file(s) (1 failed)',
                            failedTestFiles: [
                                { path: 'src/broken.test.js', reason: 'no-coverage', exitCode: 1 }
                            ]
                        }
                    }
                })}
            />
        );

        await screen.findByText(/analyzed file/i);
        expect(screen.queryByText('Tests Failed')).not.toBeInTheDocument();
        expect(screen.getByText(/Partial coverage/i)).toBeInTheDocument();
        expect(screen.getByText(/broken.test.js/)).toBeInTheDocument();
    });

    test('shows deduplicated failure reasons when tests fail', async () => {
        const failureReason = 'TypeError: window.electronAPI.onExportExcel is not a function';
        render(
            <CoverageDetails
                {...buildProps({
                    coverageResults: {
                        hasCoverage: true,
                        summary: {
                            lines: { total: 10, covered: 5, pct: 50 },
                            statements: { total: 10, covered: 5, pct: 50 }
                        },
                        files: [],
                        totalTests: 10,
                        passedTests: 3,
                        failedTests: 7,
                        diagnostics: {
                            jestMessage: '7 test(s) failed out of 10 — 1 unique error(s)',
                            failureSummary: {
                                uniqueReasonCount: 1,
                                groups: [
                                    {
                                        reason: failureReason,
                                        count: 7,
                                        tests: ['App › one', 'App › two']
                                    }
                                ]
                            }
                        }
                    }
                })}
            />
        );

        expect(await screen.findByText(/tests passed/)).toBeInTheDocument();
        expect(screen.getByText(/7 failed/)).toBeInTheDocument();
        expect(screen.getByText(failureReason)).toBeInTheDocument();
        expect(screen.queryAllByText(failureReason)).toHaveLength(1);
        const listItem = screen.getByTitle(failureReason);
        expect(listItem.textContent).toMatch(/7×/);
    });
});
