const { buildHostConfig } = require('./hostConfig');
const { YOU_APPS, WE_APPS } = require('../data/appsCatalog');

describe('buildHostConfig', () => {
    const cfg = buildHostConfig({ youApps: YOU_APPS, weApps: WE_APPS });

    it('lists every catalog app as an entity', () => {
        expect(Object.keys(cfg.entities.app)).toHaveLength(17);
        expect(cfg.entities.app.CommonUI).toEqual(expect.arrayContaining(['we common', 'common', 'commonui']));
        expect(cfg.entities.app.CoreUI).toEqual(expect.arrayContaining(['wecore', 'we core', 'core']));
        expect(cfg.entities.app.LaunchpadUI).toContain('launchpadui');
        expect(cfg.entities.app.LaunchpadUI).toEqual(
            expect.arrayContaining(['launch pad', 'pad', 'youlaunchpad', 'trapezedrtportalslaunchpadui', 'portalslaunchpadui'])
        );
        expect(cfg.entities.app.CoreUI).toEqual(expect.arrayContaining(['wecoreui', 'trapezedrtcoreui']));
        expect(cfg.entities.group).toEqual({ you: ['you apps', 'you group'], we: ['we apps', 'we group'] });
    });

    it('defines get_group_coverage', () => {
        const t = cfg.tools.find((x) => x.name === 'get_group_coverage');
        expect(t.params.group).toEqual({ entity: 'group', required: false });
        expect(t.params.metric).toEqual({ enum: ['lines', 'statements', 'branches', 'all'], default: 'all' });
        expect(t.answer_template).toBe('{group}: {covered} / {total} {metric} covered ({pct}%) across {appsCounted} apps');
    });

    it('defines the eight tools', () => {
        expect(cfg.tools.map((t) => t.name)).toEqual([
            'run_unit_tests',
            'get_coverage',
            'get_group_coverage',
            'get_test_totals',
            'get_run_summary',
            'get_run_failures',
            'get_run_path_coverage',
            'get_run_gaps'
        ]);
        expect(cfg.tools[0].confirm).toBe('folder');
    });

    it('run_unit_tests has optional branch param and answer_template', () => {
        const t = cfg.tools[0];
        expect(t.params.branch).toEqual({ type: 'string', required: false });
        expect(t.description).toMatch(/branch/);
        expect(t.answer_template).toContain('{app}');
        expect(t.answer_template).toContain('{branch}');
    });

    it('uses the spec answer_template for get_coverage', () => {
        const t = cfg.tools.find((x) => x.name === 'get_coverage');
        expect(t.answer_template).toBe('{app}: {covered} / {total} {metric} covered ({pct}%)');
        expect(t.params.metric).toEqual({ enum: ['lines', 'statements', 'branches', 'all'], default: 'all' });
    });

    it('has assistant name and scope_message', () => {
        expect(cfg.assistant.scope_message).toBe(
            'I can run unit tests and answer coverage questions for You/We apps and for test runs you have open. For complex questions, please ask your administrator (amir.khan@voyagerr.com).'
        );
    });

    it('defines get_run_summary', () => {
        const t = cfg.tools.find((x) => x.name === 'get_run_summary');
        expect(t.params).toEqual({ app: { entity: 'app', required: false } });
        expect(t.description).toMatch(/ALREADY/);
        expect(t.answer_template).toContain('{passed}');
        expect(t.answer_template).toContain('{failed}');
    });

    it('defines get_run_path_coverage with a required path', () => {
        const t = cfg.tools.find((x) => x.name === 'get_run_path_coverage');
        expect(t.params.path).toEqual({ type: 'string', required: true });
        expect(t.params.app).toEqual({ entity: 'app', required: false });
        expect(t.answer_template).toContain('{fileCount}');
    });

    it('defines get_run_gaps with an optional path', () => {
        const t = cfg.tools.find((x) => x.name === 'get_run_gaps');
        expect(t.params.path).toEqual({ type: 'string', required: false });
        expect(t.answer_template).toContain('{summary}');
    });
});
