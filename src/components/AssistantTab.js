import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createAssistant } from '@ai-assistant/client';
import { buildHostConfig } from '../assistant/hostConfig';
import { createToolHandlers } from '../assistant/toolHandlers';
import { formatRunSummary } from '../assistant/runSummary';
import { fetchAppCoverage, sumLoadedTestCounts } from '../services/remoteCoverage';
import { YOU_APPS, WE_APPS } from '../data/appsCatalog';
import './AssistantTab.css';

const POLL_MS = 2000;

function toolStatusText(tool, params) {
    const app = params && params.app;
    switch (tool) {
        case 'run_unit_tests':
            return `Opening test run for ${app}…`;
        case 'get_coverage':
            return `Fetching coverage for ${app}…`;
        case 'get_group_coverage':
            return 'Summing coverage…';
        case 'get_test_totals':
            return 'Summing unit tests…';
        case 'get_run_summary':
            return 'Reading the open test run…';
        case 'get_run_path_coverage':
            return `Summing run coverage for ${params && params.path}…`;
        case 'get_run_failures':
            return 'Looking at the failing tests…';
        case 'get_run_gaps':
            return 'Looking for coverage gaps in the run…';
        default:
            return '';
    }
}

function registerHandlers(assistant, knownClonePaths, launchedRuns) {
    const handlers = createToolHandlers({
        electronAPI: window.electronAPI,
        youApps: YOU_APPS,
        weApps: WE_APPS,
        knownClonePaths,
        fetchAppCoverage,
        sumLoadedTestCounts,
        listRuns: () => window.electronAPI.listRuns()
    });
    Object.entries(handlers).forEach(([name, fn]) => {
        if (name !== 'run_unit_tests') return assistant.registerTool(name, fn);
        // Remember runs launched from the chat so their summary is posted when they finish.
        return assistant.registerTool(name, async (...args) => {
            const result = await fn(...args);
            if (launchedRuns && result) launchedRuns.push({ app: result.app, branch: result.branch });
            return result;
        });
    });
}

function AssistantTab({ knownClonePaths = [] }) {
    // phase: 'starting' | 'down' | 'loading' | 'modelError' | 'ready'
    const [phase, setPhase] = useState('starting');
    const [serverError, setServerError] = useState('');
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [toolStatus, setToolStatus] = useState('');
    const assistantRef = useRef(null);
    const clonePathsRef = useRef(knownClonePaths);
    const mountedRef = useRef(true);
    const listEndRef = useRef(null);
    const launchedRunsRef = useRef([]);

    clonePathsRef.current = knownClonePaths;

    const applyStatus = useCallback((status) => {
        if (!mountedRef.current) return;
        const s = status || {};
        setServerError(s.error || '');
        if (!s.running) {
            setPhase('down');
            return;
        }
        // One assistant instance for the life of the tab so the session survives.
        if (!assistantRef.current && s.url) {
            const assistant = createAssistant({
                serverUrl: s.url,
                config: buildHostConfig({ youApps: YOU_APPS, weApps: WE_APPS })
            });
            assistantRef.current = assistant;
            registerHandlers(assistant, clonePathsRef.current, launchedRunsRef.current);
        }
        if (s.ready) setPhase('ready');
        else setPhase(s.error ? 'modelError' : 'loading');
    }, []);

    const ensure = useCallback(async () => {
        setPhase('starting');
        try {
            applyStatus(await window.electronAPI.assistantEnsure());
        } catch (err) {
            if (!mountedRef.current) return;
            setServerError(err && err.message ? err.message : String(err));
            setPhase('down');
        }
    }, [applyStatus]);

    useEffect(() => {
        mountedRef.current = true;
        ensure();
        return () => {
            mountedRef.current = false;
        };
    }, [ensure]);

    // Poll while the model is loading
    useEffect(() => {
        if (phase !== 'loading') return undefined;
        const timer = setInterval(async () => {
            try {
                applyStatus(await window.electronAPI.assistantStatus());
            } catch (err) {
                if (!mountedRef.current) return;
                setServerError(err && err.message ? err.message : String(err));
            }
        }, POLL_MS);
        return () => clearInterval(timer);
    }, [phase, applyStatus]);

    // Handlers capture knownClonePaths by value: re-register (overwrites) when it changes.
    useEffect(() => {
        if (assistantRef.current) registerHandlers(assistantRef.current, knownClonePaths, launchedRunsRef.current);
    }, [knownClonePaths]);

    // Post a summary to the chat when a run launched from the chat finishes.
    useEffect(() => {
        const api = window.electronAPI;
        if (!api || typeof api.onRunFinished !== 'function') return undefined;
        return api.onRunFinished((run) => {
            if (!mountedRef.current || !run) return;
            const launched = launchedRunsRef.current;
            const i = launched.findIndex((l) => l.app === run.app && (l.branch || '') === (run.branch || ''));
            if (i < 0) return;
            launched.splice(i, 1);
            setMessages((prev) => [...prev, { role: 'assistant', text: formatRunSummary(run) }]);
        });
    }, []);

    useEffect(() => {
        if (listEndRef.current && listEndRef.current.scrollIntoView) {
            listEndRef.current.scrollIntoView({ block: 'end' });
        }
    }, [messages, toolStatus]);

    const send = useCallback(async (text) => {
        const message = String(text || '').trim();
        if (message.toLowerCase() === '/clear') {
            if (busy || phase !== 'ready') return;
            setMessages([]);
            setInput('');
            return;
        }
        const assistant = assistantRef.current;
        if (!message || !assistant || busy || phase !== 'ready') return;
        setMessages((prev) => [...prev, { role: 'user', text: message }]);
        setInput('');
        setBusy(true);
        try {
            const reply = await assistant.send(message, {
                onToolStart: ({ tool, params }) => setToolStatus(toolStatusText(tool, params)),
                onToolEnd: () => setToolStatus('')
            });
            if (!mountedRef.current) return;
            const entry = { role: 'assistant', text: reply.text };
            if (reply.type === 'clarify' && Array.isArray(reply.options)) entry.options = reply.options;
            setMessages((prev) => [...prev, entry]);
        } catch (err) {
            if (!mountedRef.current) return;
            setMessages((prev) => [...prev, { role: 'assistant', text: `⚠️ ${err && err.message ? err.message : err}` }]);
            if (err && err.code === 'SERVER_UNREACHABLE') {
                setServerError(err.message);
                setPhase('down');
            }
        } finally {
            if (mountedRef.current) {
                setBusy(false);
                setToolStatus('');
            }
        }
    }, [busy, phase]);

    const canType = phase === 'ready' && !busy;

    return (
        <div className="assistant-tab fade-in">
            {phase === 'down' && (
                <div className="error-banner assistant-banner">
                    <span>Assistant server not running{serverError ? `: ${serverError}` : ''}</span>
                    <button className="btn btn-secondary" onClick={ensure}>Retry</button>
                </div>
            )}
            {phase === 'modelError' && (
                <div className="error-banner assistant-banner">
                    <span>Model not installed / cannot load: {serverError}</span>
                    <button className="btn btn-secondary" onClick={ensure}>Retry</button>
                </div>
            )}
            {phase === 'loading' && (
                <div className="assistant-loading">
                    Loading model…{serverError ? ` ${serverError}` : ''}
                </div>
            )}
            <div className="assistant-messages">
                {messages.map((m, i) => (
                    <div key={i} className={`assistant-msg assistant-msg-${m.role}`}>
                        <div className="assistant-msg-text">{m.text}</div>
                        {m.options && m.options.length > 0 && (
                            <div className="assistant-options">
                                {m.options.map((o) => (
                                    <button key={o} className="btn btn-secondary" disabled={busy} onClick={() => send(o)}>
                                        {o}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
                {toolStatus && <div className="assistant-status">{toolStatus}</div>}
                <div ref={listEndRef} />
            </div>
            <div className="assistant-input-row">
                <input
                    type="text"
                    className="assistant-input"
                    placeholder="Ask about unit tests or coverage… (/clear to clear the chat)"
                    value={input}
                    disabled={!canType}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') send(input);
                    }}
                />
                <button className="btn btn-primary" disabled={!canType || !input.trim()} onClick={() => send(input)}>
                    Send
                </button>
            </div>
        </div>
    );
}

export default AssistantTab;
