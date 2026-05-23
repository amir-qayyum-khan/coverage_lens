/** Max example test names shown per deduplicated reason in formatted output. */
const MAX_EXAMPLE_TESTS = 3;

/** Lines that look like stack frames or Jest noise, not failure reasons. */
const SKIP_LINE_PREFIXES = ['at ', 'console.error', 'console.warn', 'npm :', 'CategoryInfo', 'FullyQualifiedErrorId'];

/** First line of a failure reason (error type or assertion). */
const REASON_LINE_RE = /^(TypeError|ReferenceError|SyntaxError|RangeError|Error|AssertionError|expect\(|Expected\b|Received\b)/;

/**
 * Remove ANSI escape sequences and common Jest color artifacts.
 * @param {string} text
 * @returns {string}
 */
function stripAnsi(text) {
    if (!text) return '';
    return text
        .replace(/\u001b\[[0-9;]*m/g, '')
        .replace(/\[[0-9;]*m/g, '');
}

/**
 * Normalize a failure reason for deduplication keys.
 * @param {string} reason
 * @returns {string}
 */
function normalizeReasonKey(reason) {
    return stripAnsi(reason)
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * Whether a trimmed line should be skipped when hunting for a reason.
 * @param {string} line
 * @returns {boolean}
 */
function shouldSkipReasonLine(line) {
    if (!line) return true;
    return SKIP_LINE_PREFIXES.some((prefix) => line.startsWith(prefix));
}

/**
 * Extract assertion-style reason from consecutive Expected/Received lines.
 * @param {string[]} lines
 * @param {number} startIndex
 * @returns {{ reason: string, nextIndex: number }|null}
 */
function tryParseAssertionReason(lines, startIndex) {
    const expectedLine = (lines[startIndex] || '').trim();
    if (!expectedLine || !/^Expected\b/i.test(expectedLine)) {
        return null;
    }
    const parts = [expectedLine];
    let i = startIndex + 1;
    while (i < lines.length) {
        const next = lines[i].trim();
        if (!next) {
            i += 1;
            continue;
        }
        if (/^●/.test(next) || /^FAIL\s/.test(next)) {
            break;
        }
        if (/^Received\b/i.test(next)) {
            parts.push(next);
            i += 1;
        }
        break;
    }
    return { reason: parts.join(' / '), nextIndex: i };
}

/**
 * Find the first substantive error line after a ● failure header.
 * @param {string[]} lines
 * @param {number} startIndex
 * @returns {string}
 */
function extractReasonFromLines(lines, startIndex) {
    for (let i = startIndex; i < lines.length; i += 1) {
        const trimmed = lines[i].trim();
        if (!trimmed || shouldSkipReasonLine(trimmed)) {
            continue;
        }
        if (/^●/.test(trimmed) || /^FAIL\s/.test(trimmed)) {
            break;
        }
        if (/^Expected\b/i.test(trimmed)) {
            const assertion = tryParseAssertionReason(lines, i);
            if (assertion) {
                return assertion.reason;
            }
        }
        if (REASON_LINE_RE.test(trimmed)) {
            return trimmed;
        }
    }
    return '';
}

/**
 * Parse individual test failures from Jest combined stdout/stderr.
 * @param {string} output - Raw Jest stdout/stderr
 * @returns {{ testName: string, reason: string, reasonKey: string }[]}
 */
function extractJestFailures(output) {
    const cleaned = stripAnsi(output);
    const lines = cleaned.split(/\r?\n/);
    const failures = [];
    const bulletRe = /^[●◆■□]\s+(.+)$/;

    for (let i = 0; i < lines.length; i += 1) {
        const match = lines[i].trim().match(bulletRe);
        if (!match) continue;

        const testName = match[1].trim();
        const reason = extractReasonFromLines(lines, i + 1);
        if (!reason) continue;

        failures.push({
            testName,
            reason,
            reasonKey: normalizeReasonKey(reason)
        });
    }

    return failures;
}

/**
 * Group failures by normalized reason.
 * @param {{ testName: string, reason: string, reasonKey: string }[]} failures
 * @returns {{ reason: string, count: number, tests: string[] }[]}
 */
function deduplicateJestFailures(failures) {
    const groups = new Map();

    for (const { testName, reason, reasonKey } of failures) {
        const key = reasonKey || normalizeReasonKey(reason);
        if (!groups.has(key)) {
            groups.set(key, { reason, count: 0, tests: [] });
        }
        const group = groups.get(key);
        group.count += 1;
        if (testName && !group.tests.includes(testName)) {
            group.tests.push(testName);
        }
    }

    return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}

/**
 * Build IPC-safe failure summary payload.
 * @param {{ reason: string, count: number, tests: string[] }[]} deduped
 * @returns {{ uniqueReasonCount: number, groups: { reason: string, count: number, tests: string[] }[] }}
 */
function buildFailureSummary(deduped) {
    return {
        uniqueReasonCount: deduped.length,
        groups: deduped.map((g) => ({
            reason: g.reason,
            count: g.count,
            tests: g.tests.slice(0, MAX_EXAMPLE_TESTS)
        }))
    };
}

/**
 * Format deduplicated failure groups for logs or UI.
 * @param {{ reason: string, count: number, tests: string[] }[]} deduped
 * @param {{ passedTests?: number, failedTests?: number, totalTests?: number }} [stats]
 * @returns {string}
 */
function formatJestFailureSummary(deduped, stats = {}) {
    if (!deduped.length) return '';

    const lines = [];
    const { passedTests = 0, failedTests = 0, totalTests = 0 } = stats;

    if (totalTests > 0 || failedTests > 0) {
        lines.push(`Jest: ${passedTests}/${totalTests} passed, ${failedTests} failed`);
        lines.push('');
    }

    lines.push(`=== Failure reasons (deduplicated, ${deduped.length} unique) ===`);

    for (const group of deduped) {
        lines.push(`[${group.count}×] ${group.reason}`);
        if (group.tests.length > 0) {
            const shown = group.tests.slice(0, MAX_EXAMPLE_TESTS);
            const extra = group.count - shown.length;
            let exampleText = `  Examples: ${shown.join('; ')}`;
            if (extra > 0) {
                exampleText += ` (+${extra} more)`;
            }
            lines.push(exampleText);
        }
    }

    return lines.join('\n');
}

/**
 * Estimate suite counts from PASS/FAIL file lines when Jest exits before the summary.
 * @param {string} output
 * @returns {{ passedSuites: number, failedSuites: number, testSuites: number }}
 */
function estimateSuiteCountsFromOutput(output) {
    const cleaned = stripAnsi(output);
    const passedSuites = (cleaned.match(/^PASS\s+\S+/gm) || []).length;
    const failedSuites = (cleaned.match(/^FAIL\s+\S+/gm) || []).length;
    return {
        passedSuites,
        failedSuites,
        testSuites: passedSuites + failedSuites
    };
}

/**
 * True when output shows suites ran but the final Tests: summary line is missing (crash/OOM).
 * @param {string} output
 * @param {boolean} hasSummaryLine
 * @returns {boolean}
 */
function detectIncompleteJestRun(output, hasSummaryLine) {
    if (hasSummaryLine) {
        return false;
    }
    const { testSuites } = estimateSuiteCountsFromOutput(output);
    if (testSuites > 0) {
        return true;
    }
    return /TypeError:.*is not iterable|ENOMEM|JavaScript heap out of memory|SIGKILL|SIGABRT/i.test(output);
}

/**
 * Parse Jest text output to extract test counts.
 * @param {string} output - Raw Jest stdout/stderr
 * @returns {{ totalTests: number, passedTests: number, failedTests: number, testSuites: number, passedSuites: number, failedSuites: number, incompleteRun: boolean, estimatedFromOutput: boolean, message: string }}
 */
function parseJestOutput(output) {
    const results = {
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        testSuites: 0,
        passedSuites: 0,
        failedSuites: 0,
        incompleteRun: false,
        estimatedFromOutput: false,
        message: ''
    };

    const testsMatch = output.match(
        /Tests:\s+(?:(\d+)\s+failed,\s+)?(?:(\d+)\s+skipped,\s+)?(?:(\d+)\s+passed,\s+)?(\d+)\s+total/
    );
    if (testsMatch) {
        results.failedTests = parseInt(testsMatch[1] || '0', 10);
        results.passedTests = parseInt(testsMatch[3] || '0', 10);
        results.totalTests = parseInt(testsMatch[4] || '0', 10);
    }

    const suitesMatch = output.match(
        /Test Suites:\s+(?:(\d+)\s+failed,\s+)?(?:(\d+)\s+skipped,\s+)?(?:(\d+)\s+passed,\s+)?(\d+)\s+total/
    );
    if (suitesMatch) {
        results.failedSuites = parseInt(suitesMatch[1] || '0', 10);
        results.passedSuites = parseInt(suitesMatch[3] || '0', 10);
        results.testSuites = parseInt(suitesMatch[4] || '0', 10);
    }

    results.incompleteRun = detectIncompleteJestRun(output, Boolean(testsMatch));

    if (!testsMatch && results.incompleteRun) {
        const estimated = estimateSuiteCountsFromOutput(output);
        results.passedSuites = estimated.passedSuites;
        results.failedSuites = estimated.failedSuites;
        results.testSuites = estimated.testSuites;
        results.estimatedFromOutput = estimated.testSuites > 0;
    }

    if (results.failedTests > 0) {
        const deduped = deduplicateJestFailures(extractJestFailures(output));
        const uniqueCount = deduped.length;
        results.message =
            uniqueCount > 0
                ? `${results.failedTests} test(s) failed out of ${results.totalTests} — ${uniqueCount} unique error(s)`
                : `${results.failedTests} test(s) failed out of ${results.totalTests}`;
    } else if (results.totalTests > 0) {
        results.message = `All ${results.totalTests} tests passed`;
    } else if (results.incompleteRun) {
        const suitePart =
            results.testSuites > 0
                ? `${results.passedSuites} passed, ${results.failedSuites} failed suite(s) before exit`
                : 'Jest exited before printing results';
        results.message = `Jest exited before summary (${suitePart}) — possible crash or OOM`;
    } else {
        results.message = 'No tests found or executed';
    }

    return results;
}

/**
 * Sum Jest stats across multiple isolated per-file runs.
 * @param {Array<{ output?: string, exitCode?: number|null, hadCoverageSummary?: boolean }>} runs
 * @returns {{ totalTests: number, passedTests: number, failedTests: number, testSuites: number, passedSuites: number, failedSuites: number, incompleteRun: boolean, runsWithSummary: number, message: string }}
 */
function aggregateJestOutputs(runs) {
    const aggregated = {
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        testSuites: 0,
        passedSuites: 0,
        failedSuites: 0,
        incompleteRun: false,
        runsWithSummary: 0,
        message: ''
    };

    if (!runs?.length) {
        aggregated.message = 'No tests found or executed';
        return aggregated;
    }

    let runsStarted = 0;
    for (const run of runs) {
        runsStarted += 1;
        const output = run.output || '';
        const parsed = parseJestOutput(output);
        const hasSummaryLine = /Tests:\s+/i.test(output) || /Test Suites:\s+/i.test(output);

        if (hasSummaryLine || run.hadCoverageSummary) {
            aggregated.runsWithSummary += 1;
            aggregated.totalTests += parsed.totalTests;
            aggregated.passedTests += parsed.passedTests;
            aggregated.failedTests += parsed.failedTests;
            if (parsed.testSuites > 0) {
                aggregated.testSuites += parsed.testSuites;
                aggregated.passedSuites += parsed.passedSuites;
                aggregated.failedSuites += parsed.failedSuites;
            } else {
                aggregated.testSuites += 1;
                if (run.exitCode === 0 && parsed.failedTests === 0) {
                    aggregated.passedSuites += 1;
                } else {
                    aggregated.failedSuites += 1;
                }
            }
        } else {
            aggregated.testSuites += 1;
            aggregated.failedSuites += 1;
        }
    }

    aggregated.incompleteRun = runsStarted > 0 && aggregated.runsWithSummary === 0;

    if (aggregated.failedTests > 0) {
        aggregated.message = `${aggregated.failedTests} test(s) failed out of ${aggregated.totalTests}`;
    } else if (aggregated.totalTests > 0) {
        aggregated.message = `All ${aggregated.totalTests} tests passed`;
    } else if (aggregated.incompleteRun) {
        aggregated.message = 'Jest exited before printing results for all test files';
    } else {
        aggregated.message = 'No tests found or executed';
    }

    return aggregated;
}

/**
 * Human-readable message for per-file isolated coverage collection.
 * @param {number} passedFiles
 * @param {number} totalFiles
 * @param {number} failedFiles
 * @returns {string}
 */
function buildIsolatedCoverageMessage(passedFiles, totalFiles, failedFiles) {
    if (totalFiles === 0) {
        return 'No test files found';
    }
    if (failedFiles === 0) {
        return `Coverage from ${passedFiles}/${totalFiles} test file(s)`;
    }
    return `Coverage from ${passedFiles}/${totalFiles} test file(s) (${failedFiles} failed)`;
}

/**
 * Build full jest-execution.log body with deduplicated summary on top.
 * @param {{ code?: number|null, signal?: string|null, errorMessage?: string, stdout?: string, stderr?: string }} params
 * @returns {string}
 */
function formatJestExecutionLog({ code = null, signal = null, errorMessage = '', stdout = '', stderr = '' }) {
    const combined = `${stdout}\n${stderr}`;
    const stats = parseJestOutput(combined);
    const deduped = deduplicateJestFailures(extractJestFailures(combined));

    const sections = [];

    if (errorMessage) {
        sections.push(`Error: ${errorMessage}`);
    } else {
        sections.push(`Exit Code: ${code}`);
        sections.push(`Signal: ${signal}`);
    }

    sections.push('');

    const summary = formatJestFailureSummary(deduped, stats);
    if (summary) {
        sections.push(summary);
        sections.push('');
    }

    sections.push('=== Full STDOUT ===');
    sections.push(stdout || '(empty)');
    sections.push('');
    sections.push('=== Full STDERR ===');
    sections.push(stderr || '(empty)');

    return sections.join('\n');
}

module.exports = {
    stripAnsi,
    extractJestFailures,
    deduplicateJestFailures,
    buildFailureSummary,
    formatJestFailureSummary,
    formatJestExecutionLog,
    estimateSuiteCountsFromOutput,
    detectIncompleteJestRun,
    parseJestOutput,
    aggregateJestOutputs,
    buildIsolatedCoverageMessage
};
