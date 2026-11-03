const round1 = (v) => Math.round((Number(v) || 0) * 10) / 10;
const pct = (b) => `${round1(b && b.pct)}%`;

/**
 * Plain-language summary of a finished test run, posted to the chat for the reader.
 * @param {object} run - a runStore entry (status 'done' or 'error')
 * @returns {string}
 */
function formatRunSummary(run) {
    const where = `${run.app}${run.branch ? ` (${run.branch})` : ''}`;
    if (run.status === 'error') {
        return `The test run for ${where} failed: ${run.error || 'unknown error'}.`;
    }
    const t = run.tests || {};
    const c = run.coverage || {};
    const lines = [];
    const outcome = t.failed ? `${t.failed} failed` : 'all passed';
    lines.push(`Test run finished for ${where}: ${t.passed || 0} of ${t.total || 0} tests passed (${outcome}).`);
    lines.push(`Coverage: lines ${pct(c.lines)}, statements ${pct(c.statements)}, branches ${pct(c.branches)}, functions ${pct(c.functions)}.`);
    const groups = run.failures || [];
    if (t.failed && groups.length) {
        const top = groups.slice(0, 3).map((g) => {
            const name = g.tests && g.tests[0] ? `${g.tests[0]}: ` : '';
            return `${name}${g.reason}`;
        });
        lines.push(`Failing: ${top.join(' | ')}${groups.length > 3 ? ` and ${groups.length - 3} more error type(s)` : ''}.`);
    }
    const missing = (run.files || []).filter((f) => !f.hasCoverage).length;
    if (missing) lines.push(`${missing} file(s) have no coverage data.`);
    lines.push('Ask me for details, e.g. which tests fail or which files lack coverage.');
    return lines.join('\n');
}

module.exports = { formatRunSummary };
