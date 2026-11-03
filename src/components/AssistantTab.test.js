import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
        expect(await screen.findByText('Opening test run for CommonUI…')).toBeInTheDocument();
        release({ type: 'answer', text: 'done' });
        await waitFor(() => expect(screen.queryByText('Opening test run for CommonUI…')).not.toBeInTheDocument());
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

    test('model load error stops polling and shows retry state', async () => {
        jest.useFakeTimers();
        try {
            const failed = { running: true, url: 'http://127.0.0.1:7071', ready: false, error: 'model file missing' };
            window.electronAPI.assistantEnsure.mockResolvedValue(failed);
            window.electronAPI.assistantStatus.mockResolvedValue(failed);
            render(<AssistantTab knownClonePaths={[]} />);
            expect(await screen.findByText("Model not installed / cannot load: model file missing")).toBeInTheDocument();
            expect(screen.queryByText(/Loading model/)).not.toBeInTheDocument();
            act(() => { jest.advanceTimersByTime(10000); });
            expect(window.electronAPI.assistantStatus).not.toHaveBeenCalled();
            expect(screen.getByPlaceholderText(/ask about/i)).toBeDisabled();
            window.electronAPI.assistantEnsure.mockResolvedValue(READY);
            fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
            await waitFor(() => expect(screen.getByPlaceholderText(/ask about/i)).not.toBeDisabled());
        } finally {
            jest.useRealTimers();
        }
    });

    test('send rejection shows warning message; SERVER_UNREACHABLE shows banner', async () => {
        const err = Object.assign(new Error('server went away'), { code: 'SERVER_UNREACHABLE' });
        mockSend.mockRejectedValue(err);
        render(<AssistantTab knownClonePaths={[]} />);
        await waitFor(() => expect(screen.getByPlaceholderText(/ask about/i)).not.toBeDisabled());
        ask('hello');
        expect(await screen.findByText('⚠️ server went away')).toBeInTheDocument();
        expect(await screen.findByText(/Assistant server not running: server went away/)).toBeInTheDocument();
    });

    test('other send rejection shows warning without banner', async () => {
        mockSend.mockRejectedValue(new Error('bad reply'));
        render(<AssistantTab knownClonePaths={[]} />);
        await waitFor(() => expect(screen.getByPlaceholderText(/ask about/i)).not.toBeDisabled());
        ask('hello');
        expect(await screen.findByText('⚠️ bad reply')).toBeInTheDocument();
        expect(screen.queryByText(/Assistant server not running/)).not.toBeInTheDocument();
    });

    test('input and Send are disabled while busy and Enter does not resend', async () => {
        let release;
        mockSend.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
        render(<AssistantTab knownClonePaths={[]} />);
        await waitFor(() => expect(screen.getByPlaceholderText(/ask about/i)).not.toBeDisabled());
        ask('first');
        const input = screen.getByPlaceholderText(/ask about/i);
        await waitFor(() => expect(input).toBeDisabled());
        expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
        fireEvent.change(input, { target: { value: 'second' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        expect(mockSend).toHaveBeenCalledTimes(1);
        release({ type: 'answer', text: 'done' });
        await waitFor(() => expect(input).not.toBeDisabled());
    });

    test('/clear removes the messages without sending to the assistant', async () => {
        mockSend.mockResolvedValue({ type: 'answer', text: 'an answer' });
        render(<AssistantTab knownClonePaths={[]} />);
        await waitFor(() => expect(screen.getByPlaceholderText(/ask about/i)).not.toBeDisabled());
        ask('hello');
        expect(await screen.findByText('an answer')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByPlaceholderText(/ask about/i)).not.toBeDisabled());
        ask('  /CLEAR ');
        await waitFor(() => expect(screen.queryByText('an answer')).not.toBeInTheDocument());
        expect(screen.queryByText('hello')).not.toBeInTheDocument();
        expect(screen.getByPlaceholderText(/ask about/i).value).toBe('');
        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('placeholder mentions /clear', async () => {
        render(<AssistantTab knownClonePaths={[]} />);
        expect(await screen.findByPlaceholderText(/\/clear to clear the chat/)).toBeInTheDocument();
    });

    test('shows status text for the run tools', async () => {
        mockSend.mockImplementation((msg, opts) => {
            opts.onToolStart({ tool: 'get_run_path_coverage', params: { path: 'booking' } });
            return new Promise(() => {});
        });
        render(<AssistantTab knownClonePaths={[]} />);
        await waitFor(() => expect(screen.getByPlaceholderText(/ask about/i)).not.toBeDisabled());
        ask('coverage of booking');
        expect(await screen.findByText('Summing run coverage for booking…')).toBeInTheDocument();
    });
});
