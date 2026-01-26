import React from 'react';
import { render, screen } from '@testing-library/react';
import Summary from './Summary';

describe('Summary Component', () => {
    test('renders all summary cards', () => {
        render(
            <Summary
                totalLines={1000}
                totalStatements={500}
                lineCoverage={80}
                statementCoverage={75}
            />
        );

        expect(screen.getByText('Total Lines')).toBeInTheDocument();
        expect(screen.getByText('Total Statements')).toBeInTheDocument();
        expect(screen.getByText('Line Coverage')).toBeInTheDocument();
        expect(screen.getByText('Statement Coverage')).toBeInTheDocument();
    });

    test('displays formatted numbers', () => {
        render(
            <Summary
                totalLines={1234}
                totalStatements={567}
                lineCoverage={80}
                statementCoverage={75}
            />
        );

        expect(screen.getByText('1,234')).toBeInTheDocument();
        expect(screen.getByText('567')).toBeInTheDocument();
    });

    test('displays percentages with % sign', () => {
        render(
            <Summary
                totalLines={100}
                totalStatements={50}
                lineCoverage={85}
                statementCoverage={70}
            />
        );

        expect(screen.getByText('85%')).toBeInTheDocument();
        expect(screen.getByText('70%')).toBeInTheDocument();
    });

    test('displays dash for null coverage values', () => {
        render(
            <Summary
                totalLines={100}
                totalStatements={50}
                lineCoverage={null}
                statementCoverage={null}
            />
        );

        const dashes = screen.getAllByText('—');
        expect(dashes.length).toBe(2);
    });

    test('applies success class for high coverage', () => {
        const { container } = render(
            <Summary
                totalLines={100}
                totalStatements={50}
                lineCoverage={90}
                statementCoverage={85}
            />
        );

        const successCards = container.querySelectorAll('.summary-card.success');
        expect(successCards.length).toBe(2);
    });

    test('applies warning class for medium coverage', () => {
        const { container } = render(
            <Summary
                totalLines={100}
                totalStatements={50}
                lineCoverage={60}
                statementCoverage={55}
            />
        );

        const warningCards = container.querySelectorAll('.summary-card.warning');
        expect(warningCards.length).toBe(2);
    });

    test('applies error class for low coverage', () => {
        const { container } = render(
            <Summary
                totalLines={100}
                totalStatements={50}
                lineCoverage={30}
                statementCoverage={25}
            />
        );

        const errorCards = container.querySelectorAll('.summary-card.error');
        expect(errorCards.length).toBe(2);
    });

    test('handles zero values', () => {
        render(
            <Summary
                totalLines={0}
                totalStatements={0}
                lineCoverage={0}
                statementCoverage={0}
            />
        );

        expect(screen.getAllByText('0').length).toBe(2);
        expect(screen.getAllByText('0%').length).toBe(2);
    });
});
