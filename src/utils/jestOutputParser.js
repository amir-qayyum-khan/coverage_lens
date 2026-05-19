/**
 * Parse Jest text output to extract test counts.
 * @param {string} output - Raw Jest stdout/stderr
 * @returns {{ totalTests: number, passedTests: number, failedTests: number, testSuites: number, passedSuites: number, failedSuites: number, message: string }}
 */
function parseJestOutput(output) {
    const results = {
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        testSuites: 0,
        passedSuites: 0,
        failedSuites: 0,
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

    if (results.failedTests > 0) {
        results.message = `${results.failedTests} test(s) failed out of ${results.totalTests}`;
    } else if (results.totalTests > 0) {
        results.message = `All ${results.totalTests} tests passed`;
    } else {
        results.message = 'No tests found or executed';
    }

    return results;
}

module.exports = {
    parseJestOutput
};
