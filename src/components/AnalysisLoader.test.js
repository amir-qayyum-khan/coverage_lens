import React from 'react';
import { render, screen, act } from '@testing-library/react';
import AnalysisLoader from './AnalysisLoader';

describe('AnalysisLoader', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        act(() => {
            jest.runOnlyPendingTimers();
        });
        jest.useRealTimers();
    });

    it('renders loading message', () => {
        render(<AnalysisLoader loadingMessage="Analyzing code structure..." />);
        expect(screen.getByText('Analyzing code structure...')).toBeInTheDocument();
    });

    it('displays initial time as 0:00', () => {
        render(<AnalysisLoader loadingMessage="Testing..." />);
        expect(screen.getByText('0:00')).toBeInTheDocument();
    });

    it('increments time counter every second', () => {
        render(<AnalysisLoader loadingMessage="Testing..." />);

        expect(screen.getByText('0:00')).toBeInTheDocument();

        act(() => {
            jest.advanceTimersByTime(1000);
        });
        expect(screen.getByText('0:01')).toBeInTheDocument();

        act(() => {
            jest.advanceTimersByTime(1000);
        });
        expect(screen.getByText('0:02')).toBeInTheDocument();
    });

    it('formats time correctly for minutes', () => {
        render(<AnalysisLoader loadingMessage="Testing..." />);

        act(() => {
            jest.advanceTimersByTime(65000); // 1 minute 5 seconds
        });
        expect(screen.getByText('1:05')).toBeInTheDocument();
    });

    it('displays elapsed time label', () => {
        render(<AnalysisLoader loadingMessage="Testing..." />);
        expect(screen.getByText('ELAPSED TIME')).toBeInTheDocument();
    });

    it('shows appropriate status text based on elapsed time', () => {
        const { rerender } = render(<AnalysisLoader loadingMessage="Testing..." />);

        // Initial state (< 60 seconds)
        expect(screen.getByText(/analyzing folder structure/i)).toBeInTheDocument();

        // After 60 seconds
        act(() => {
            jest.advanceTimersByTime(60000);
        });
        rerender(<AnalysisLoader loadingMessage="Testing..." />);
        expect(screen.getByText(/analyzing code metrics/i)).toBeInTheDocument();

        // After 120 seconds
        act(() => {
            jest.advanceTimersByTime(60000);
        });
        rerender(<AnalysisLoader loadingMessage="Testing..." />);
        expect(screen.getByText(/analyzing test coverage/i)).toBeInTheDocument();
    });

    it('renders futuristic logo SVG', () => {
        const { container } = render(<AnalysisLoader loadingMessage="Testing..." />);
        const svg = container.querySelector('.analysis-logo');
        expect(svg).toBeInTheDocument();
    });

    it('renders particle effects', () => {
        const { container } = render(<AnalysisLoader loadingMessage="Testing..." />);
        const particles = container.querySelectorAll('.particle');
        expect(particles.length).toBe(12);
    });
});

