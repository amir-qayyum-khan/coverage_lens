import React from 'react';
import { render, screen } from '@testing-library/react';
import ResultsGrid from './ResultsGrid';

describe('ResultsGrid Component', () => {
    const mockFiles = [
        {
            relativePath: 'src/App.js',
            fileName: 'App.js',
            lines: 100,
            statements: 50,
            totalLinesJest: 100,
            totalStatementsJest: 50,
            coveredLines: 85,
            coveredStatements: 40,
            lineCoverage: 85,
            statementCoverage: 80,
            missingLines: [10, 15, 20]
        },
        {
            relativePath: 'src/utils/helper.js',
            fileName: 'helper.js',
            lines: 50,
            statements: 25,
            totalLinesJest: 50,
            totalStatementsJest: 25,
            coveredLines: 30,
            coveredStatements: 14,
            lineCoverage: 60,
            statementCoverage: 55,
            missingLines: [5, 6, 7, 8]
        }
    ];

    test('renders table headers', () => {
        render(<ResultsGrid files={mockFiles} totalFiles={2} />);

        expect(screen.getByText('File Name')).toBeInTheDocument();
        expect(screen.getByText('Total Lines')).toBeInTheDocument();
        expect(screen.getByText('Statements')).toBeInTheDocument();
        expect(screen.getByText('Line Coverage')).toBeInTheDocument();
        expect(screen.getByText('Stmt Coverage')).toBeInTheDocument();
        expect(screen.getByText('Missing Lines')).toBeInTheDocument();
    });

    test('renders file data rows', () => {
        render(<ResultsGrid files={mockFiles} totalFiles={2} />);

        expect(screen.getByText('src/App.js')).toBeInTheDocument();
        expect(screen.getByText('src/utils/helper.js')).toBeInTheDocument();
    });

    test('displays file count', () => {
        render(<ResultsGrid files={mockFiles} totalFiles={2} />);

        expect(screen.getByText('2 files')).toBeInTheDocument();
    });

    test('renders empty state when no files', () => {
        render(<ResultsGrid files={[]} totalFiles={0} />);

        expect(screen.getByText('No files found')).toBeInTheDocument();
        expect(screen.getByText('0 files')).toBeInTheDocument();
    });

    test('displays formatted line counts', () => {
        render(<ResultsGrid files={mockFiles} totalFiles={2} />);

        // 100 appears as codeLines for first file
        expect(screen.getAllByText('100').length).toBeGreaterThan(0);
        // 50 appears multiple times (codeLines for file2, statements for file1)
        expect(screen.getAllByText('50').length).toBeGreaterThan(0);
    });

    test('displays coverage percentages', () => {
        render(<ResultsGrid files={mockFiles} totalFiles={2} />);

        // Component displays coverage as "covered / total (pct%)"
        expect(screen.getByText(/85 \/ 100 \(85%\)/)).toBeInTheDocument();
        expect(screen.getByText(/40 \/ 50 \(80%\)/)).toBeInTheDocument();
    });

    test('formats missing lines as ranges', () => {
        const filesWithRanges = [
            {
                relativePath: 'test.js',
                lines: 100,
                statements: 50,
                totalLinesJest: 100,
                totalStatementsJest: 50,
                coveredLines: 50,
                coveredStatements: 25,
                lineCoverage: 50,
                statementCoverage: 50,
                missingLines: [1, 2, 3, 5, 10, 11, 12]
            }
        ];

        render(<ResultsGrid files={filesWithRanges} totalFiles={1} />);

        expect(screen.getByText('1-3, 5, 10-12')).toBeInTheDocument();
    });

    test('displays dash for null coverage', () => {
        const filesWithNullCoverage = [
            {
                relativePath: 'test.js',
                lines: 100,
                statements: 50,
                totalLinesJest: null,
                totalStatementsJest: null,
                coveredLines: null,
                coveredStatements: null,
                lineCoverage: null,
                statementCoverage: null,
                missingLines: []
            }
        ];

        render(<ResultsGrid files={filesWithNullCoverage} totalFiles={1} />);

        const dashes = screen.getAllByText('—');
        expect(dashes.length).toBeGreaterThanOrEqual(2);
    });

    test('applies coverage color classes', () => {
        const { container } = render(<ResultsGrid files={mockFiles} totalFiles={2} />);

        expect(container.querySelector('.coverage-high')).toBeInTheDocument();
        expect(container.querySelector('.coverage-medium')).toBeInTheDocument();
    });

    test('renders coverage bars', () => {
        const { container } = render(<ResultsGrid files={mockFiles} totalFiles={2} />);

        expect(container.querySelectorAll('.coverage-bar').length).toBeGreaterThan(0);
    });
});
