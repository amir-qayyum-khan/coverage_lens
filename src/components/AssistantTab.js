import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createAssistant } from '@ai-assistant/client';
import { buildHostConfig } from '../assistant/hostConfig';
import { createToolHandlers } from '../assistant/toolHandlers';
import { fetchAppCoverage, sumLoadedTestCounts } from '../services/remoteCoverage';
import { YOU_APPS, WE_APPS } from '../data/appsCatalog';
import './AssistantTab.css';

const POLL_MS = 2000;

function toolStatusText(tool, params) {
    const app = params && params.app;
    switch (tool) {
        case 'run_unit_tests':
            return `Running tests for ${app}…`;
        case 'get_coverage':
            return `Fetching coverage for ${app}…`;
        case 'get_test_totals':
            return 'Summing unit tests…';
        default:
            return '';
    }
}

function registerHandlers(assistant, knownClonePaths) {
    const handlers = createToolHandlers({
        electronAPI: window.electronAPI,
        youApps: YOU_APPS,
        weApps: WE_APPS,
        knownClonePaths,
        fetchAppCoverage,
        sumLoadedTestCounts
    });
    Object.entries(handlers).forEach(([name, fn]) => assistant.registerTool(name, fn));
}

function AssistantTab({ knownClonePaths = [] }) {
    // phase: 'starting' | 'down' | 'loading' | 'ready'
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
            registerHandlers(assistant, clonePathsRef.current);
        }
        setPhase(s.ready ? 'ready' : 'loading');
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
        if (assistantRef.current) registerHandlers(assistantRef.current, knownClonePaths);
    }, [knownClonePaths]);

    useEffect(() => {
        if (listEndRef.current && listEndRef.current.scrollIntoView) {
            listEndRef.current.scrollIntoView({ block: 'end' });
        }
    }, [messages, toolStatus]);

    const send = useCallback(async (text) => {
        const message = String(text || '').trim();
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
                    placeholder="Ask about unit tests or coverage…"
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
