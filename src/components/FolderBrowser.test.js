import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import FolderBrowser from './FolderBrowser';

describe('FolderBrowser Component', () => {
    const defaultProps = {
        folderPath: '',
        onFolderPathChange: jest.fn(),
        onBrowse: jest.fn(),
        onAnalyze: jest.fn(),
        isLoading: false
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('renders browse button', () => {
        render(<FolderBrowser {...defaultProps} />);
        expect(screen.getByRole('button', { name: /browse/i })).toBeInTheDocument();
    });

    test('renders analyze button', () => {
        render(<FolderBrowser {...defaultProps} />);
        expect(screen.getByRole('button', { name: /analyze/i })).toBeInTheDocument();
    });

    test('renders folder path input', () => {
        render(<FolderBrowser {...defaultProps} />);
        expect(screen.getByPlaceholderText(/select or enter folder path/i)).toBeInTheDocument();
    });

    test('displays folder path in input', () => {
        render(<FolderBrowser {...defaultProps} folderPath="/test/path" />);
        expect(screen.getByDisplayValue('/test/path')).toBeInTheDocument();
    });

    test('calls onBrowse when browse button clicked', () => {
        render(<FolderBrowser {...defaultProps} />);

        fireEvent.click(screen.getByRole('button', { name: /browse/i }));
        expect(defaultProps.onBrowse).toHaveBeenCalledTimes(1);
    });

    test('calls onAnalyze when analyze button clicked', () => {
        render(<FolderBrowser {...defaultProps} folderPath="/test/path" />);

        fireEvent.click(screen.getByRole('button', { name: /analyze/i }));
        expect(defaultProps.onAnalyze).toHaveBeenCalledTimes(1);
    });

    test('analyze button is disabled when no folder path', () => {
        render(<FolderBrowser {...defaultProps} folderPath="" />);

        expect(screen.getByRole('button', { name: /analyze/i })).toBeDisabled();
    });

    test('analyze button is disabled when loading', () => {
        render(<FolderBrowser {...defaultProps} folderPath="/test/path" isLoading={true} />);

        expect(screen.getByRole('button', { name: /analyzing/i })).toBeDisabled();
    });

    test('shows Analyzing text when loading', () => {
        render(<FolderBrowser {...defaultProps} folderPath="/test/path" isLoading={true} />);

        expect(screen.getByText(/analyzing/i)).toBeInTheDocument();
    });

    test('calls onFolderPathChange when input changes', () => {
        render(<FolderBrowser {...defaultProps} />);

        const input = screen.getByPlaceholderText(/select or enter folder path/i);
        fireEvent.change(input, { target: { value: '/new/path' } });

        expect(defaultProps.onFolderPathChange).toHaveBeenCalledWith('/new/path');
    });

    test('calls onAnalyze when Enter pressed in input with path', () => {
        render(<FolderBrowser {...defaultProps} folderPath="/test/path" />);

        const input = screen.getByDisplayValue('/test/path');
        fireEvent.keyPress(input, { key: 'Enter', code: 'Enter', charCode: 13 });

        expect(defaultProps.onAnalyze).toHaveBeenCalledTimes(1);
    });

    test('does not call onAnalyze when Enter pressed with empty path', () => {
        render(<FolderBrowser {...defaultProps} folderPath="" />);

        const input = screen.getByPlaceholderText(/select or enter folder path/i);
        fireEvent.keyPress(input, { key: 'Enter', code: 'Enter', charCode: 13 });

        expect(defaultProps.onAnalyze).not.toHaveBeenCalled();
    });
});
