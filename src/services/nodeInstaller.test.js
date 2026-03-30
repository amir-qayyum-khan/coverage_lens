const EventEmitter = require('events');
const { spawn } = require('child_process');

jest.mock('child_process', () => ({
    spawn: jest.fn()
}));

const { installPackages } = require('./nodeInstaller');

describe('installPackages', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('invokes onProgress with (stage, message, percent) for gitOperations sendProgress', async () => {
        const onProgress = jest.fn();
        const mockChild = new EventEmitter();
        mockChild.stderr = { on: jest.fn() };
        spawn.mockReturnValue(mockChild);

        const done = installPackages('/fake/project', onProgress);
        mockChild.emit('close', 0);
        await done;

        expect(onProgress).toHaveBeenCalledWith(
            'installing_deps',
            'Installing dependencies (this may take a while)...',
            75
        );
        expect(onProgress.mock.calls[0].length).toBe(3);
    });

    test('resolves success when npm exits 0', async () => {
        const mockChild = new EventEmitter();
        mockChild.stderr = { on: jest.fn() };
        spawn.mockReturnValue(mockChild);

        const resultPromise = installPackages('/fake/project', null);
        mockChild.emit('close', 0);
        const result = await resultPromise;

        expect(result.success).toBe(true);
    });
});
