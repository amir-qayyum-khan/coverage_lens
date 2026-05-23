const {
    stripAnsi,
    extractJestFailures,
    deduplicateJestFailures,
    formatJestFailureSummary,
    formatJestExecutionLog,
    buildFailureSummary,
    estimateSuiteCountsFromOutput,
    detectIncompleteJestRun,
    parseJestOutput,
    aggregateJestOutputs,
    buildIsolatedCoverageMessage
} = require('./jestOutputParser');

const TYPE_ERROR_REASON = 'TypeError: window.electronAPI.onExportExcel is not a function';

const singleFailureBlock = (testName) =>
    `  ● ${testName}\n\n    ${TYPE_ERROR_REASON}\n\n      at src/App.js:162:51\n`;

describe('jestOutputParser', () => {
    describe('stripAnsi', () => {
        test('removes ANSI color codes', () => {
            const input = '\u001b[31mTypeError\u001b[0m: boom';
            expect(stripAnsi(input)).toBe('TypeError: boom');
        });
    });

    describe('extractJestFailures', () => {
        test('extracts TypeError from a ● block', () => {
            const output =
                'FAIL src/App.test.js\n' +
                singleFailureBlock('App Component › renders header with title') +
                'Tests:       1 failed, 0 passed, 1 total\n';

            const failures = extractJestFailures(output);
            expect(failures).toHaveLength(1);
            expect(failures[0].testName).toBe('App Component › renders header with title');
            expect(failures[0].reason).toBe(TYPE_ERROR_REASON);
        });

        test('parses output with ANSI codes', () => {
            const output =
                `  \u001b[31m●\u001b[0m App Component › renders header with title\n\n` +
                `    \u001b[31m${TYPE_ERROR_REASON}\u001b[0m\n`;

            const failures = extractJestFailures(output);
            expect(failures).toHaveLength(1);
            expect(failures[0].reason).toBe(TYPE_ERROR_REASON);
        });

        test('extracts Expected/Received assertion reasons', () => {
            const output = [
                '  ● math › adds numbers',
                '',
                '    Expected: 4',
                '    Received: 3',
                ''
            ].join('\n');

            const failures = extractJestFailures(output);
            expect(failures).toHaveLength(1);
            expect(failures[0].reason).toBe('Expected: 4 / Received: 3');
        });
    });

    describe('deduplicateJestFailures', () => {
        test('collapses identical reasons into one group', () => {
            const failures = [
                'App Component › renders header with title',
                'App Component › renders empty state initially',
                'App Component › browse button calls selectFolder',
                'App Component › analyze button is disabled when no folder selected',
                'App Component › shows error when analysis fails',
                'App Component › displays results after successful analysis',
                'App Component › extra test'
            ].flatMap((name) =>
                extractJestFailures(singleFailureBlock(name))
            );

            const deduped = deduplicateJestFailures(failures);
            expect(deduped).toHaveLength(1);
            expect(deduped[0].count).toBe(7);
            expect(deduped[0].reason).toBe(TYPE_ERROR_REASON);
            expect(deduped[0].tests.length).toBe(7);
        });

        test('keeps separate groups for mixed reasons', () => {
            const output =
                singleFailureBlock('suite › fails type') +
                [
                    '  ● suite › fails assert',
                    '',
                    '    Expected: true',
                    '    Received: false',
                    ''
                ].join('\n') +
                singleFailureBlock('suite › fails type again');

            const deduped = deduplicateJestFailures(extractJestFailures(output));
            expect(deduped).toHaveLength(2);
            expect(deduped[0].count).toBe(2);
            expect(deduped[0].reason).toBe(TYPE_ERROR_REASON);
            expect(deduped[1].count).toBe(1);
            expect(deduped[1].reason).toBe('Expected: true / Received: false');
        });
    });

    describe('formatJestFailureSummary', () => {
        test('includes counts and caps example test names', () => {
            const deduped = deduplicateJestFailures(
                extractJestFailures(
                    singleFailureBlock('Test A') +
                    singleFailureBlock('Test B') +
                    singleFailureBlock('Test C') +
                    singleFailureBlock('Test D')
                )
            );

            const text = formatJestFailureSummary(deduped, {
                passedTests: 2,
                failedTests: 4,
                totalTests: 6
            });

            expect(text).toContain('Jest: 2/6 passed, 4 failed');
            expect(text).toContain('[4×]');
            expect(text).toContain(TYPE_ERROR_REASON);
            expect(text).toContain('Examples:');
            expect(text).toContain('(+1 more)');
        });
    });

    describe('formatJestExecutionLog', () => {
        test('places deduplicated summary before full stdout', () => {
            const stdout =
                singleFailureBlock('App › one') +
                'Tests:       1 failed, 0 passed, 1 total\n';
            const log = formatJestExecutionLog({ code: 1, signal: null, stdout, stderr: '' });

            const summaryIndex = log.indexOf('=== Failure reasons');
            const stdoutIndex = log.indexOf('=== Full STDOUT ===');
            expect(summaryIndex).toBeGreaterThan(-1);
            expect(stdoutIndex).toBeGreaterThan(summaryIndex);
            expect(log).toContain(TYPE_ERROR_REASON);
        });
    });

    describe('buildFailureSummary', () => {
        test('returns compact groups for diagnostics', () => {
            const deduped = deduplicateJestFailures(
                extractJestFailures(singleFailureBlock('Test A'))
            );
            const summary = buildFailureSummary(deduped);
            expect(summary.uniqueReasonCount).toBe(1);
            expect(summary.groups[0].reason).toBe(TYPE_ERROR_REASON);
            expect(summary.groups[0].count).toBe(1);
        });
    });

    describe('estimateSuiteCountsFromOutput', () => {
        test('counts PASS and FAIL suite lines', () => {
            const output = 'PASS src/a.test.js\nFAIL src/b.test.js\nPASS src/c.test.js\n';
            const counts = estimateSuiteCountsFromOutput(output);
            expect(counts.passedSuites).toBe(2);
            expect(counts.failedSuites).toBe(1);
            expect(counts.testSuites).toBe(3);
        });
    });

    describe('detectIncompleteJestRun', () => {
        test('true when suites ran but no Tests summary', () => {
            expect(detectIncompleteJestRun('PASS src/a.test.js\nFAIL src/b.test.js\n', false)).toBe(true);
        });

        test('false when Tests summary present', () => {
            expect(detectIncompleteJestRun('Tests: 1 passed, 1 total\n', true)).toBe(false);
        });
    });

    describe('parseJestOutput', () => {
        test('includes unique error count in message when failures exist', () => {
            const output =
                'Tests:       2 failed, 1 passed, 3 total\n' +
                singleFailureBlock('A › one') +
                singleFailureBlock('A › two');

            const r = parseJestOutput(output);
            expect(r.failedTests).toBe(2);
            expect(r.message).toMatch(/2 test\(s\) failed/);
            expect(r.message).toMatch(/1 unique error/);
        });

        test('flags incomplete run and estimates suites when summary missing', () => {
            const output =
                'PASS src/components/a.test.js\n' +
                'FAIL src/components/b.test.js\n' +
                'TypeError: result is not iterable\n';

            const r = parseJestOutput(output);
            expect(r.incompleteRun).toBe(true);
            expect(r.totalTests).toBe(0);
            expect(r.testSuites).toBe(2);
            expect(r.passedSuites).toBe(1);
            expect(r.failedSuites).toBe(1);
            expect(r.message).toMatch(/exited before summary/i);
        });
    });

    describe('aggregateJestOutputs', () => {
        test('sums test counts across multiple isolated runs', () => {
            const aggregated = aggregateJestOutputs([
                {
                    output: 'Tests:       2 passed, 2 total\nTest Suites: 1 passed, 1 total\n',
                    exitCode: 0,
                    hadCoverageSummary: true
                },
                {
                    output: 'Tests:       1 failed, 1 passed, 2 total\nTest Suites: 1 failed, 1 total\n',
                    exitCode: 1,
                    hadCoverageSummary: true
                }
            ]);
            expect(aggregated.totalTests).toBe(4);
            expect(aggregated.passedTests).toBe(3);
            expect(aggregated.failedTests).toBe(1);
            expect(aggregated.runsWithSummary).toBe(2);
            expect(aggregated.incompleteRun).toBe(false);
        });

        test('flags incomplete when no run produced a summary', () => {
            const aggregated = aggregateJestOutputs([
                { output: 'PASS src/a.test.js\n', exitCode: 1, hadCoverageSummary: false }
            ]);
            expect(aggregated.incompleteRun).toBe(true);
            expect(aggregated.runsWithSummary).toBe(0);
        });
    });

    describe('buildIsolatedCoverageMessage', () => {
        test('describes partial file coverage', () => {
            expect(buildIsolatedCoverageMessage(33, 37, 4)).toBe(
                'Coverage from 33/37 test file(s) (4 failed)'
            );
        });
    });
});
