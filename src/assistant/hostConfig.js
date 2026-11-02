/** Hand-picked aliases that override the generated lowercase-name alias list. */
const CUSTOM_APP_ALIASES = {
    CommonUI: ['we common', 'common', 'commonui'],
    CoreUI: ['wecore', 'we core', 'core', 'coreui']
};

/**
 * Build the host config sent to the assistant server (YAML key spelling).
 * @param {{ youApps: Array<{ name: string }>, weApps: Array<{ name: string }> }} apps
 * @returns {object}
 */
function buildHostConfig({ youApps, weApps }) {
    const app = {};
    for (const a of [...youApps, ...weApps]) {
        app[a.name] = CUSTOM_APP_ALIASES[a.name] || [a.name.toLowerCase()];
    }
    return {
        assistant: {
            name: 'Voyagerr Assistant',
            scope_message: 'I can run unit tests and answer coverage questions for You/We apps.'
        },
        entities: {
            app,
            group: {
                you: ['you apps', 'you'],
                we: ['we apps', 'we']
            }
        },
        tools: [
            {
                name: 'run_unit_tests',
                description: 'Run Jest unit tests with coverage for one app',
                params: { app: { entity: 'app', required: true } },
                confirm: 'folder'
            },
            {
                name: 'get_coverage',
                description: 'Coverage numbers for one app from the Super Dashboard',
                params: {
                    app: { entity: 'app', required: true },
                    metric: { enum: ['lines', 'statements', 'branches', 'all'], default: 'all' }
                },
                answer_template: '{app}: {covered} / {total} {metric} covered ({pct}%)'
            },
            {
                name: 'get_test_totals',
                description: 'Unit test totals for a group of apps or all apps',
                params: { group: { entity: 'group', required: false } }
            }
        ]
    };
}

module.exports = { buildHostConfig };
