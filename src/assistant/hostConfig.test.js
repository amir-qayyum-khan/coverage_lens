const { buildHostConfig } = require('./hostConfig');
const { YOU_APPS, WE_APPS } = require('../data/appsCatalog');

describe('buildHostConfig', () => {
    const cfg = buildHostConfig({ youApps: YOU_APPS, weApps: WE_APPS });

    it('lists every catalog app as an entity', () => {
        expect(Object.keys(cfg.entities.app)).toHaveLength(17);
        expect(cfg.entities.app.CommonUI).toEqual(expect.arrayContaining(['we common', 'common', 'commonui']));
        expect(cfg.entities.app.CoreUI).toEqual(expect.arrayContaining(['wecore', 'we core', 'core']));
        expect(cfg.entities.app.LaunchpadUI).toContain('launchpadui');
        expect(cfg.entities.group).toEqual({ you: ['you apps', 'you'], we: ['we apps', 'we'] });
    });

    it('defines the three tools', () => {
        expect(cfg.tools.map((t) => t.name)).toEqual(['run_unit_tests', 'get_coverage', 'get_test_totals']);
        expect(cfg.tools[0].confirm).toBe('folder');
    });

    it('uses the spec answer_template for get_coverage', () => {
        const t = cfg.tools.find((x) => x.name === 'get_coverage');
        expect(t.answer_template).toBe('{app}: {covered} / {total} {metric} covered ({pct}%)');
        expect(t.params.metric).toEqual({ enum: ['lines', 'statements', 'branches', 'all'], default: 'all' });
    });

    it('has assistant name and scope_message', () => {
        expect(cfg.assistant.scope_message).toBe('I can run unit tests and answer coverage questions for You/We apps.');
    });
});
