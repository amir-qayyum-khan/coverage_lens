import React from 'react';
import { render, screen } from '@testing-library/react';
import Summary from './Summary';

describe('Summary Component', () => {
    test('renders all summary cards', () => {
        render(
            <Summary
                totalLinesJest={1000}
                totalStatementsJest={500}
                coveredLines={800}
                coveredStatements={375}
                lineCoverage={80}
                statementCoverage={75}
            />
        );

        expect(screen.getByText('Total Testable Lines')).toBeInTheDocument();
        expect(screen.getByText('Total Testable Statements')).toBeInTheDocument();
        expect(screen.getByText(/Total Tested Lines \(80%\)/)).toBeInTheDocument();
        expect(screen.getByText(/Total Tested Statements \(75%\)/)).toBeInTheDocument();
    });

    test('displays formatted numbers', () => {
        render(
            <Summary
                totalLinesJest={1234}
                totalStatementsJest={567}
                coveredLines={1000}
                coveredStatements={400}
                lineCoverage={80}
                statementCoverage={75}
            />
        );

        expect(screen.getByText('1,234')).toBeInTheDocument();
        expect(screen.getByText('567')).toBeInTheDocument();
    });

    test('displays percentages with % sign in labels', () => {
        render(
            <Summary
                totalLinesJest={100}
                totalStatementsJest={50}
                coveredLines={85}
                coveredStatements={35}
                lineCoverage={85}
                statementCoverage={70}
            />
        );

        expect(screen.getByText(/Total Tested Lines \(85%\)/)).toBeInTheDocument();
        expect(screen.getByText(/Total Tested Statements \(70%\)/)).toBeInTheDocument();
    });

    test('displays dash for null coverage values', () => {
        render(
            <Summary
                totalLinesJest={null}
                totalStatementsJest={null}
                coveredLines={null}
                coveredStatements={null}
                lineCoverage={null}
                statementCoverage={null}
            />
        );

        // Should find dashes in the value fields
        const dashes = screen.getAllByText('—');
        expect(dashes.length).toBe(4);

        // Should also find dashes in the labels
        expect(screen.getAllByText(/Total Tested Lines \(—\)/).length).toBe(1);
        expect(screen.getAllByText(/Total Tested Statements \(—\)/).length).toBe(1);
    });

    test('applies success class for high coverage', () => {
        const { container } = render(
            <Summary
                totalLinesJest={100}
                totalStatementsJest={50}
                coveredLines={90}
                coveredStatements={45}
                lineCoverage={90}
                statementCoverage={90}
            />
        );

        const successCards = container.querySelectorAll('.summary-card.success');
        expect(successCards.length).toBe(2);
    });

    test('applies warning class for medium coverage', () => {
        const { container } = render(
            <Summary
                totalLinesJest={100}
                totalStatementsJest={50}
                coveredLines={60}
                coveredStatements={30}
                lineCoverage={60}
                statementCoverage={60}
            />
        );

        const warningCards = container.querySelectorAll('.summary-card.warning');
        expect(warningCards.length).toBe(2);
    });

    test('applies error class for low coverage', () => {
        const { container } = render(
            <Summary
                totalLinesJest={100}
                totalStatementsJest={50}
                coveredLines={30}
                coveredStatements={15}
                lineCoverage={30}
                statementCoverage={30}
            />
        );

        const errorCards = container.querySelectorAll('.summary-card.error');
        expect(errorCards.length).toBe(2);
    });

    test('handles zero values', () => {
        render(
            <Summary
                totalLinesJest={0}
                totalStatementsJest={0}
                coveredLines={0}
                coveredStatements={0}
                lineCoverage={0}
                statementCoverage={0}
            />
        );

        expect(screen.getAllByText('0').length).toBe(4); // totalLinesJest, totalStatementsJest, coveredLines, coveredStatements
        expect(screen.getAllByText(/0%/).length).toBe(2);
    });
});

