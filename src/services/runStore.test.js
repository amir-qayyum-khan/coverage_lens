const store = require('./runStore');

const payload = {
    tests: { total: 5, passed: 4, failed: 1, suites: 2, failedSuites: 1 },
    coverage: { lines: { covered: 1, total: 2, pct: 50 } },
    files: [{ path: 'src/a.js', hasCoverage: true }]
};

beforeEach(() => {
    store.list().forEach((r) => store.remove(r.id));
});

describe('runStore', () => {
    it('registers a running entry', () => {
        const id = store.register({ app: 'CommonUI', branch: 'developV2' });
        const run = store.get(id);
        expect(run).toMatchObject({ id, app: 'CommonUI', branch: 'developV2', status: 'running', error: null });
        expect(typeof run.startedAt).toBe('number');
    });

    it('honours a supplied id', () => {
        expect(store.register({ id: 'abc', app: 'X' })).toBe('abc');
    });

    it('completes a run with results', () => {
        const id = store.register({ app: 'A' });
        expect(store.complete(id, payload)).toBe(true);
        const run = store.get(id);
        expect(run.status).toBe('done');
        expect(run.tests).toEqual(payload.tests);
        expect(run.files).toEqual(payload.files);
        expect(run.finishedAt).not.toBeNull();
    });

    it('fails a run with a message', () => {
        const id = store.register({ app: 'A' });
        expect(store.fail(id, 'boom')).toBe(true);
        expect(store.get(id)).toMatchObject({ status: 'error', error: 'boom' });
    });

    it('returns false for unknown ids', () => {
        expect(store.complete('nope', payload)).toBe(false);
        expect(store.fail('nope', 'x')).toBe(false);
    });

    it('removes a run', () => {
        const id = store.register({ app: 'A' });
        store.remove(id);
        expect(store.get(id)).toBeUndefined();
    });

    it('lists newest first', () => {
        const a = store.register({ app: 'A' });
        const b = store.register({ app: 'B' });
        expect(store.list().map((r) => r.id)).toEqual([b, a]);
    });

    it('caps at 10 entries dropping the oldest', () => {
        const ids = Array.from({ length: 12 }, (_, i) => store.register({ app: `A${i}` }));
        const list = store.list();
        expect(list).toHaveLength(10);
        expect(store.get(ids[0])).toBeUndefined();
        expect(store.get(ids[1])).toBeUndefined();
        expect(list[0].id).toBe(ids[11]);
    });
});
