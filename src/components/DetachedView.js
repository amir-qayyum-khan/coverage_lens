import React, { useState, useEffect, useCallback } from 'react';
import CoverageDetails from './CoverageDetails';

function DetachedView() {
    const [params] = useState(() => {
        const p = new URLSearchParams(window.location.search);
        return {
            repoName: p.get('repoName'),
            repoUrl: p.get('repoUrl'),
            branch: p.get('branch'),
            targetDir: p.get('targetDir')
        };
    });

    const [status, setStatus] = useState({
        state: 'loading',
        stage: 'initializing',
        message: 'Initializing...',
        percent: 0
    });
    const [testResults, setTestResults] = useState(null);
    const [analysisResults, setAnalysisResults] = useState(null);
    const [executionTime, setExecutionTime] = useState(null);
    const [clonePath, setClonePath] = useState(null);
    const [error, setError] = useState(null);

    const getGitCredentials = useCallback(() => {
        try {
            const saved = localStorage.getItem('git_credentials');
            return saved ? JSON.parse(saved) : null;
        } catch { return null; }
    }, []);

    useEffect(() => {
        const runProcess = async () => {
            const startTime = Date.now();
            const creds = getGitCredentials();

            // 1. Listen for progress events
            const removeListener = window.electronAPI.onAppProgress((progress) => {
                setStatus(prev => ({
                    ...prev,
                    stage: progress.stage || prev.stage,
                    message: progress.message || prev.message,
                    percent: progress.percent !== undefined ? progress.percent : prev.percent
                }));
            });

            try {
                // 2. Start Clone & Test
                const result = await window.electronAPI.cloneAndTest(
                    params.repoUrl,
                    params.targetDir,
                    creds,
                    params.branch,
                    params.repoName
                );

                if (!result.success) {
                    setError(result.message || 'Clone & Test failed');
                    setStatus(s => ({ ...s, state: 'error' }));
                    return;
                }

                setTestResults(result.data.testResults);
                setClonePath(result.data.clonePath);

                // 3. Analyze Code structure for file list
                setStatus(s => ({ ...s, stage: 'analyzing', message: 'Analyzing code structure...', percent: 95 }));
                const analysisResult = await window.electronAPI.analyzeFolder(result.data.clonePath);
                
                if (analysisResult.success) {
                    setAnalysisResults(analysisResult.data);
                }

                setExecutionTime(((Date.now() - startTime) / 1000).toFixed(1));
                setStatus(s => ({ ...s, state: 'complete', percent: 100 }));

            } catch (err) {
                setError(err.message);
                setStatus(s => ({ ...s, state: 'error' }));
            } finally {
                removeListener();
            }
        };

        runProcess();
    }, [params, getGitCredentials]);

    if (error) {
        return (
            <div className="detached-view error fade-in" style={{ padding: '40px', textAlign: 'center' }}>
                <div style={{ fontSize: '48px', marginBottom: '20px' }}>⚠️</div>
                <h2 style={{ color: 'var(--error)' }}>Operation Failed</h2>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>{error}</p>
                <button className="btn btn-primary" onClick={() => window.close()}>Close Window</button>
            </div>
        );
    }

    if (status.state === 'complete' && testResults && analysisResults) {
        return (
            <div className="detached-view fade-in" style={{ padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <div className="badge badge-success">✓ Analysis Complete</div>
                    <button className="sd-link-btn" onClick={() => window.close()}>Close Window</button>
                </div>
                <CoverageDetails
                    coverageResults={testResults}
                    analysisResults={analysisResults}
                    folderPath={clonePath}
                    executionTime={executionTime}
                    branch={params.branch}
                />
            </div>
        );
    }

    return (
        <div className="detached-view loading fade-in" style={{ 
            height: '100vh', 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center',
            padding: '40px'
        }}>
            <div style={{ width: '100%', maxWidth: '500px' }}>
                <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                    <h2 style={{ marginBottom: '10px' }}>{params.repoName}</h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
                        Cloning into {params.targetDir}
                    </p>
                </div>

                <div className="progress-container" style={{ gap: '12px' }}>
                    <div className="progress-label">
                        <span style={{ textTransform: 'capitalize', fontWeight: 'bold' }}>{status.stage}</span>
                        <span>{status.percent}%</span>
                    </div>
                    <div className="progress-bar" style={{ height: '10px' }}>
                        <div 
                            className="progress-bar-fill" 
                            style={{ width: `${status.percent}%` }}
                        />
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '10px' }}>
                        {status.message}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default DetachedView;
