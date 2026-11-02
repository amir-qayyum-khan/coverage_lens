/**
 * @jest-environment node
 */
const path = require('path');
const { EventEmitter } = require('events');
const { createAssistantServerManager } = require('./assistantServer');

const serverDir = path.join('x', 'assistant');
const okRes = (body) => ({ ok: true, json: async () => body });

function makeChild() {
    const child = new EventEmitter();
    child.kill = jest.fn();
    return child;
}

describe('assistantServer manager', () => {
    test('reuses running server', async () => {
        const spawn = jest.fn();
        const fetch = jest.fn().mockResolvedValue(okRes({ ok: true, ready: true, error: null }));
        const m = createAssistantServerManager({ serverDir, spawn, fetch });
        const s = await m.ensureRunning();
        expect(spawn).not.toHaveBeenCalled();
        expect(s).toEqual({ running: true, url: 'http://127.0.0.1:7071', ready: true, error: null });
        m.stop();
    });

    test('spawns when not running', async () => {
        const child = makeChild();
        const spawn = jest.fn().mockReturnValue(child);
        const fetch = jest.fn()
            .mockRejectedValueOnce(new Error('refused'))
            .mockRejectedValueOnce(new Error('refused'))
            .mockResolvedValue(okRes({ ok: true, ready: false, error: null }));
        const m = createAssistantServerManager({ serverDir, spawn, fetch, pollMs: 5, startTimeoutMs: 1000 });
        const s = await m.ensureRunning();
        expect(spawn).toHaveBeenCalledTimes(1);
        expect(spawn).toHaveBeenCalledWith(
            'node',
            [path.join(serverDir, 'packages', 'server', 'src', 'index.js'), '--config', path.join(serverDir, 'server.config.yaml')],
            { cwd: serverDir, windowsHide: true }
        );
        expect(s).toMatchObject({ running: true, ready: false });
        m.stop();
    });

    test('spawn error reported', async () => {
        const child = makeChild();
        const spawn = jest.fn().mockImplementation(() => {
            setTimeout(() => child.emit('error', new Error('spawn node ENOENT')), 1);
            return child;
        });
        const fetch = jest.fn().mockRejectedValue(new Error('refused'));
        const m = createAssistantServerManager({ serverDir, spawn, fetch, pollMs: 5, startTimeoutMs: 1000 });
        const s = await m.ensureRunning();
        expect(s.running).toBe(false);
        expect(s.error).toMatch(/^Could not start assistant server/);
    });

    test('child exit before health is reported', async () => {
        const child = makeChild();
        const spawn = jest.fn().mockImplementation(() => {
            setTimeout(() => child.emit('exit', 1, null), 1);
            return child;
        });
        const fetch = jest.fn().mockRejectedValue(new Error('refused'));
        const m = createAssistantServerManager({ serverDir, spawn, fetch, pollMs: 5, startTimeoutMs: 1000 });
        const s = await m.ensureRunning();
        expect(s.running).toBe(false);
        expect(s.error).toMatch(/^Could not start assistant server/);
    });

    test('timeout reported', async () => {
        const spawn = jest.fn().mockReturnValue(makeChild());
        const fetch = jest.fn().mockRejectedValue(new Error('refused'));
        const m = createAssistantServerManager({ serverDir, spawn, fetch, pollMs: 5, startTimeoutMs: 40 });
        const s = await m.ensureRunning();
        expect(s.running).toBe(false);
        expect(s.error).toMatch(/^Could not start assistant server: .*timed out/);
        m.stop();
    });

    test('concurrent ensureRunning spawns once', async () => {
        const spawn = jest.fn().mockReturnValue(makeChild());
        let up = false;
        const fetch = jest.fn().mockImplementation(async () => {
            if (!up) throw new Error('refused');
            return okRes({ ok: true, ready: true, error: null });
        });
        spawn.mockImplementation(() => { setTimeout(() => { up = true; }, 10); return makeChild(); });
        const m = createAssistantServerManager({ serverDir, spawn, fetch, pollMs: 5, startTimeoutMs: 1000 });
        const [a, b] = await Promise.all([m.ensureRunning(), m.ensureRunning()]);
        expect(spawn).toHaveBeenCalledTimes(1);
        expect(a).toEqual(b);
        expect(a.running).toBe(true);
        m.stop();
    });

    test('status reports not running without spawning', async () => {
        const spawn = jest.fn();
        const fetch = jest.fn().mockRejectedValue(new Error('refused'));
        const m = createAssistantServerManager({ serverDir, spawn, fetch });
        expect(await m.status()).toEqual({ running: false, url: 'http://127.0.0.1:7071', ready: false, error: null });
        expect(spawn).not.toHaveBeenCalled();
    });

    test('stop kills only spawned child', async () => {
        const reuse = createAssistantServerManager({
            serverDir,
            spawn: jest.fn(),
            fetch: jest.fn().mockResolvedValue(okRes({ ok: true, ready: true }))
        });
        await reuse.ensureRunning();
        expect(() => reuse.stop()).not.toThrow();

        const child = makeChild();
        const fetch = jest.fn()
            .mockRejectedValueOnce(new Error('refused'))
            .mockResolvedValue(okRes({ ok: true, ready: true }));
        const m = createAssistantServerManager({ serverDir, spawn: jest.fn().mockReturnValue(child), fetch, pollMs: 5 });
        await m.ensureRunning();
        expect(child.kill).not.toHaveBeenCalled();
        m.stop();
        expect(child.kill).toHaveBeenCalledTimes(1);
    });
});
