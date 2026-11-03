/** Hand-picked aliases that override the generated lowercase-name alias list. */
const CUSTOM_APP_ALIASES = {
    CommonUI: ['we common', 'common', 'commonui'],
    CoreUI: ['wecore', 'we core', 'core', 'coreui']
};

/**
 * Lowercase name and aliases an app can be referred to by.
 * @param {string} name
 * @returns {string[]}
 */
function appAliases(name) {
    return [name.toLowerCase(), ...(CUSTOM_APP_ALIASES[name] || [])];
}

/**
 * Build the host config sent to the assistant server (YAML key spelling).
 * @param {{ youApps: Array<{ name: string }>, weApps: Array<{ name: string }> }} apps
 * @returns {object}
 */
function buildHostConfig({ youApps, weApps }) {
    const app = {};
    for (const a of [...youApps, ...weApps]) {
        app[a.name] = CUSTOM_APP_ALIASES[a.name] || appAliases(a.name);
    }
    return {
        assistant: {
            name: 'Voyagerr Assistant',
            scope_message:
                'I can run unit tests and answer coverage questions for You/We apps and for test runs you have open. For complex questions, please ask your administrator.'
        },
        entities: {
            app,
            group: {
                you: ['you apps', 'you group'],
                we: ['we apps', 'we group']
            }
        },
        tools: [
            {
                name: 'run_unit_tests',
                description: 'Run or execute the Jest unit tests and coverage for one app now (clones the repo in a new window), optionally on a given git branch',
                params: {
                    app: { entity: 'app', required: true },
                    branch: { type: 'string', required: false }
                },
                confirm: 'folder',
                answer_template:
                    'Opened a window for {app} on branch {branch}: it clones the repo and runs the unit tests with coverage. Progress and results are shown there.'
            },
            {
                name: 'get_coverage',
                description: 'Look up the stored coverage numbers (lines, statements, branches) of ONE app from the Super Dashboard, without running tests',
                params: {
                    app: { entity: 'app', required: true },
                    metric: { enum: ['lines', 'statements', 'branches', 'all'], default: 'all' }
                },
                answer_template: '{app}: {covered} / {total} {metric} covered ({pct}%)'
            },
            {
                name: 'get_group_coverage',
                description:
                    'Coverage numbers and total lines/statements/branches summed over a group of apps (You, We) or all apps, from the Super Dashboard data',
                params: {
                    group: { entity: 'group', required: false },
                    metric: { enum: ['lines', 'statements', 'branches', 'all'], default: 'all' }
                },
                answer_template: '{group}: {covered} / {total} {metric} covered ({pct}%) across {appsCounted} apps'
            },
            {
                name: 'get_test_totals',
                description: 'Number of unit tests (passed, failed, total) for a group of apps or all apps',
                params: { group: { entity: 'group', required: false } }
            },
            {
                name: 'get_run_summary',
                description:
                    'Summary of a test run that is ALREADY run or open in a window: how many tests passed/failed/total and the overall coverage of that run (lines, statements, branches, functions). Use for questions like "how many tests failed" or "what is the coverage of the run"; does not run tests',
                params: { app: { entity: 'app', required: false } },
                answer_template:
                    '{app} ({branch}): {passed} passed, {failed} failed of {total} tests. Run coverage: lines {lines}%, statements {statements}%, branches {branches}%, functions {functions}%.'
            },
            {
                name: 'get_run_path_coverage',
                description:
                    'Total coverage (lines, statements, branches) of the files in an already-run/open test run whose path contains a term, for example "booking" or "src/utils"; sums covered and total over all matching files',
                params: {
                    path: { type: 'string', required: true },
                    app: { entity: 'app', required: false }
                },
                answer_template:
                    '{app} run, files matching "{path}": {covered} / {total} {metric} covered ({pct}%) across {fileCount} files'
            },
            {
                name: 'get_run_gaps',
                description:
                    'Coverage gaps in an already-run/open test run: files with no coverage data, files with 0% line coverage and the lowest-covered files, optionally only files whose path contains a term. Use for "any file missing coverage?"',
                params: {
                    path: { type: 'string', required: false },
                    app: { entity: 'app', required: false }
                },
                answer_template: '{app} run{scope}: {summary}'
            }
        ]
    };
}

module.exports = { buildHostConfig, appAliases };
