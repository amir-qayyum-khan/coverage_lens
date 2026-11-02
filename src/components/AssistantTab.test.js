import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AssistantTab from './AssistantTab';

const mockSend = jest.fn();
const mockRegisterTool = jest.fn();
jest.mock('@ai-assistant/client', () => ({
    createAssistant: jest.fn(() => ({
        registerTool: (...a) => mockRegisterTool(...a),
        start: jest.fn(),
        send: (...a) => mockSend(...a),
        health: jest.fn()
    }))
}));

const READY = { running: true, url: 'http://127.0.0.1:7071', ready: true };

function ask(text) {
    const input = screen.getByPlaceholderText(/ask about/i);
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
}

beforeEach(() => {
    jest.clearAllMocks();
    window.electronAPI = {
        assistantEnsure: jest.fn().mockResolvedValue(READY),
        assistantStatus: jest.fn().mockResolvedValue(READY)
    };
});

describe('AssistantTab', () => {
    test('not running shows banner and retry', async () => {
        window.electronAPI.assistantEnsure.mockResolvedValue({ running: false, error: 'boom' });
        render(<AssistantTab knownClonePaths={[]} />);
        expect(await screen.findByText(/Assistant server not running/)).toBeInTheDocument();
        expect(screen.getByText(/boom/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(window.electronAPI.assistantEnsure).toHaveBeenCalledTimes(2));
    });

    test('renders answer', async () => {
        mockSend.mockResolvedValue({ type: 'answer', text: 'CoreUI: 80,499 / 106,235 lines covered (75.8%)' });
        render(<AssistantTab knownClonePaths={[]} />);
        await waitFor(() => expect(screen.getByPlaceholderText(/ask about/i)).not.toBeDisabled());
        ask('total number of lines cover in wecore');
        expect(await screen.findByText('CoreUI: 80,499 / 106,235 lines covered (75.8%)')).toBeInTheDocument();
        expect(mockSend).toHaveBeenCalledWith('total number of lines cover in wecore', expect.any(Object));
        expect(mockRegisterTool).toHaveBeenCalledWith('run_unit_tests', expect.any(Function));
    });

    test('shows tool status', async () => {
        let release;
        mockSend.mockImplementation((msg, opts) => {
            opts.onToolStart({ tool: 'run_unit_tests', params: { app: 'CommonUI' } });
            return new Promise((resolve) => { release = resolve; });
        });
        render(<AssistantTab knownClonePaths={[]} />);
        await waitFor(() => expect(screen.getByPlaceholderText(/ask about/i)).not.toBeDisabled());
        ask('execute we common test');
        expect(await screen.findByText('Running tests for CommonUI…')).toBeInTheDocument();
        release({ type: 'answer', text: 'done' });
        await waitFor(() => expect(screen.queryByText('Running tests for CommonUI…')).not.toBeInTheDocument());
    });

    test('clarify options clickable', async () => {
        mockSend
            .mockResolvedValueOnce({ type: 'clarify', text: 'Which app?', options: ['CommonUI', 'CoreUI'] })
            .mockResolvedValueOnce({ type: 'answer', text: 'ok' });
        render(<AssistantTab knownClonePaths={[]} />);
        await waitFor(() => expect(screen.getByPlaceholderText(/ask about/i)).not.toBeDisabled());
        ask('run tests');
        fireEvent.click(await screen.findByRole('button', { name: 'CommonUI' }));
        await waitFor(() => expect(mockSend).toHaveBeenCalledWith('CommonUI', expect.any(Object)));
    });
});
