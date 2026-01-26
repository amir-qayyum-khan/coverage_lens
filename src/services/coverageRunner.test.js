const { formatMissingLines } = require('./coverageRunner');

describe('coverageRunner', () => {
    describe('formatMissingLines', () => {
        test('formats single line', () => {
            expect(formatMissingLines([5])).toBe('5');
        });

        test('formats multiple non-consecutive lines', () => {
            expect(formatMissingLines([1, 5, 10])).toBe('1, 5, 10');
        });

        test('formats consecutive lines as range', () => {
            expect(formatMissingLines([1, 2, 3])).toBe('1-3');
        });

        test('formats mixed ranges and single lines', () => {
            expect(formatMissingLines([1, 2, 3, 5, 10, 11, 12])).toBe('1-3, 5, 10-12');
        });

        test('handles empty array', () => {
            expect(formatMissingLines([])).toBe('');
        });

        test('handles null', () => {
            expect(formatMissingLines(null)).toBe('');
        });

        test('handles unsorted input', () => {
            expect(formatMissingLines([10, 1, 5, 2, 3])).toBe('1-3, 5, 10');
        });
    });

    // Note: runCoverage and parseCoverageDetails require Jest to be installed
    // and are tested via integration tests with a real project
});
