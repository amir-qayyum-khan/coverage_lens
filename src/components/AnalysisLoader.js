import React, { useState, useEffect } from 'react';

function AnalysisLoader({ loadingMessage }) {
    const [elapsedTime, setElapsedTime] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => {
            setElapsedTime(prev => prev + 1);
        }, 1000);

        return () => clearInterval(timer);
    }, []);

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="analysis-loader-overlay">
            <div className="analysis-loader-content">
                {/* Futuristic SVG Logo */}
                <div className="analysis-logo-container">
                    <svg className="analysis-logo" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                        {/* Outer rotating ring */}
                        <circle
                            className="logo-ring-outer"
                            cx="100"
                            cy="100"
                            r="85"
                            fill="none"
                            stroke="url(#gradient1)"
                            strokeWidth="2"
                            strokeDasharray="10 5"
                        />

                        {/* Middle rotating ring */}
                        <circle
                            className="logo-ring-middle"
                            cx="100"
                            cy="100"
                            r="70"
                            fill="none"
                            stroke="url(#gradient2)"
                            strokeWidth="1.5"
                            strokeDasharray="5 3"
                        />

                        {/* Inner pulsing hexagon */}
                        <polygon
                            className="logo-hexagon"
                            points="100,35 135,52.5 135,87.5 100,105 65,87.5 65,52.5"
                            fill="url(#gradient3)"
                            stroke="url(#gradient4)"
                            strokeWidth="2"
                        />

                        {/* Center lens/eye */}
                        <circle
                            className="logo-center-pulse"
                            cx="100"
                            cy="100"
                            r="25"
                            fill="url(#radialGradient)"
                        />

                        {/* Scanning line */}
                        <line
                            className="logo-scan-line"
                            x1="100"
                            y1="100"
                            x2="100"
                            y2="40"
                            stroke="url(#gradient5)"
                            strokeWidth="2"
                        />

                        {/* Corner brackets */}
                        <path
                            className="logo-bracket"
                            d="M 40 40 L 30 40 L 30 30 L 40 30"
                            fill="none"
                            stroke="cyan"
                            strokeWidth="2"
                        />
                        <path
                            className="logo-bracket"
                            d="M 160 40 L 170 40 L 170 30 L 160 30"
                            fill="none"
                            stroke="cyan"
                            strokeWidth="2"
                        />
                        <path
                            className="logo-bracket"
                            d="M 40 160 L 30 160 L 30 170 L 40 170"
                            fill="none"
                            stroke="cyan"
                            strokeWidth="2"
                        />
                        <path
                            className="logo-bracket"
                            d="M 160 160 L 170 160 L 170 170 L 160 170"
                            fill="none"
                            stroke="cyan"
                            strokeWidth="2"
                        />

                        {/* Gradients */}
                        <defs>
                            <linearGradient id="gradient1" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor="#06b6d4" />
                                <stop offset="100%" stopColor="#8b5cf6" />
                            </linearGradient>
                            <linearGradient id="gradient2" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#8b5cf6" />
                                <stop offset="100%" stopColor="#06b6d4" />
                            </linearGradient>
                            <linearGradient id="gradient3" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor="rgba(6, 182, 212, 0.2)" />
                                <stop offset="100%" stopColor="rgba(139, 92, 246, 0.2)" />
                            </linearGradient>
                            <linearGradient id="gradient4" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor="#06b6d4" />
                                <stop offset="50%" stopColor="#ffffff" />
                                <stop offset="100%" stopColor="#8b5cf6" />
                            </linearGradient>
                            <linearGradient id="gradient5" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor="rgba(6, 182, 212, 1)" />
                                <stop offset="100%" stopColor="rgba(6, 182, 212, 0)" />
                            </linearGradient>
                            <radialGradient id="radialGradient">
                                <stop offset="0%" stopColor="rgba(255, 255, 255, 0.8)" />
                                <stop offset="50%" stopColor="rgba(6, 182, 212, 0.6)" />
                                <stop offset="100%" stopColor="rgba(6, 182, 212, 0)" />
                            </radialGradient>
                        </defs>
                    </svg>

                    {/* Particle effects */}
                    <div className="particles">
                        {[...Array(12)].map((_, i) => (
                            <div
                                key={i}
                                className="particle"
                                style={{
                                    '--delay': `${i * 0.3}s`,
                                    '--angle': `${i * 30}deg`
                                }}
                            />
                        ))}
                    </div>
                </div>

                {/* Loading message */}
                <p className="analysis-loading-message">
                    {loadingMessage}
                </p>

                {/* Time counter */}
                <div className="analysis-time-counter">
                    <div className="time-display">
                        <span className="time-label">ELAPSED TIME</span>
                        <span className="time-value">{formatTime(elapsedTime)}</span>
                    </div>
                    <div className="time-bar">
                        <div className="time-bar-fill" />
                    </div>
                </div>

                {/* Status text */}
                <p className="analysis-status-text">
                    Analyzing {elapsedTime < 60 ? 'folder structure' : elapsedTime < 120 ? 'code metrics' : 'test coverage'}...
                </p>
            </div>
        </div>
    );
}

export default AnalysisLoader;
