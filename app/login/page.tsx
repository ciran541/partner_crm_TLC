'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function LoginPage() {
    const router = useRouter()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        setIsLoading(true)

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        })

        if (error) {
            setError(error.message)
            setIsLoading(false)
            return
        }

        router.push('/redirect')
    }

    return (
        <div className="login-container">
            {/* Animated Background */}
            <div className="login-bg">
                <div className="gradient-orb orb-1"></div>
                <div className="gradient-orb orb-2"></div>
                <div className="gradient-orb orb-3"></div>
            </div>

            {/* Login Card */}
            <div className="login-card glass-card fade-in">
                <div className="login-header">
                    <div className="logo-container">
                        <div className="logo-icon gradient-bg">
                            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                                <path d="M16 2L4 8V14C4 22 10 28 16 30C22 28 28 22 28 14V8L16 2Z" fill="white" opacity="0.9" />
                            </svg>
                        </div>
                    </div>
                    <h1 className="login-title">Welcome Back</h1>
                    <p className="login-subtitle">Sign in to your Partner CRM account</p>
                </div>

                <form onSubmit={handleLogin} className="login-form">
                    <div className="form-group">
                        <label htmlFor="email" className="form-label">
                            Email Address
                        </label>
                        <div className="input-wrapper">
                            <svg className="input-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
                                <path d="M3 4H17C17.55 4 18 4.45 18 5V15C18 15.55 17.55 16 17 16H3C2.45 16 2 15.55 2 15V5C2 4.45 2.45 4 3 4Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M18 5L10 11L2 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <input
                                id="email"
                                type="email"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="input-field"
                                required
                                disabled={isLoading}
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label htmlFor="password" className="form-label">
                            Password
                        </label>
                        <div className="input-wrapper">
                            <svg className="input-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
                                <path d="M15 8V6C15 3.79 13.21 2 11 2H9C6.79 2 5 3.79 5 6V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M14 18H6C4.9 18 4 17.1 4 16V10C4 8.9 4.9 8 6 8H14C15.1 8 16 8.9 16 10V16C16 17.1 15.1 18 14 18Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                <circle cx="10" cy="13" r="1.5" fill="currentColor" />
                            </svg>
                            <input
                                id="password"
                                type="password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="input-field"
                                required
                                disabled={isLoading}
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="error-message fade-in">
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
                                <path d="M10 6V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                <circle cx="10" cy="14" r="0.5" fill="currentColor" />
                            </svg>
                            <span>{error}</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        className="btn-primary login-btn"
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <>
                                <span className="spinner"></span>
                                Signing in...
                            </>
                        ) : (
                            'Sign In'
                        )}
                    </button>
                </form>

                <div className="login-footer">
                    <a href="#" className="forgot-password">Forgot password?</a>
                </div>
            </div>

            <style jsx>{`
                .login-container {
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                    position: relative;
                    overflow: hidden;
                }

                .login-bg {
                    position: absolute;
                    inset: 0;
                    overflow: hidden;
                    z-index: 0;
                }

                .gradient-orb {
                    position: absolute;
                    border-radius: 50%;
                    filter: blur(80px);
                    opacity: 0.6;
                    animation: float 6s ease-in-out infinite;
                }

                .orb-1 {
                    width: 400px;
                    height: 400px;
                    background: linear-gradient(135deg, #6366f1, #ec4899);
                    top: -200px;
                    left: -200px;
                    animation-delay: 0s;
                }

                .orb-2 {
                    width: 350px;
                    height: 350px;
                    background: linear-gradient(135deg, #14b8a6, #6366f1);
                    bottom: -150px;
                    right: -150px;
                    animation-delay: 2s;
                }

                .orb-3 {
                    width: 300px;
                    height: 300px;
                    background: linear-gradient(135deg, #f59e0b, #ec4899);
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    animation-delay: 4s;
                }

                .login-card {
                    width: 100%;
                    max-width: 440px;
                    padding: 48px;
                    position: relative;
                    z-index: 1;
                }

                .login-header {
                    text-align: center;
                    margin-bottom: 40px;
                }

                .logo-container {
                    display: flex;
                    justify-content: center;
                    margin-bottom: 24px;
                }

                .logo-icon {
                    width: 64px;
                    height: 64px;
                    border-radius: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: var(--shadow-lg);
                }

                .login-title {
                    font-size: 32px;
                    font-weight: 700;
                    margin-bottom: 8px;
                    background: var(--gradient-primary);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                }

                .login-subtitle {
                    color: var(--text-secondary);
                    font-size: 15px;
                }

                .login-form {
                    display: flex;
                    flex-direction: column;
                    gap: 24px;
                }

                .form-group {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .form-label {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--text-secondary);
                }

                .input-wrapper {
                    position: relative;
                }

                .input-icon {
                    position: absolute;
                    left: 18px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: var(--text-muted);
                    pointer-events: none;
                }

                .input-wrapper .input-field {
                    padding-left: 48px;
                }

                .error-message {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 12px 16px;
                    background: rgba(239, 68, 68, 0.1);
                    border: 1px solid rgba(239, 68, 68, 0.3);
                    border-radius: 12px;
                    color: #fca5a5;
                    font-size: 14px;
                }

                .error-message svg {
                    flex-shrink: 0;
                }

                .login-btn {
                    width: 100%;
                    padding: 16px;
                    font-size: 16px;
                    margin-top: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 10px;
                }

                .login-btn:disabled {
                    opacity: 0.7;
                    cursor: not-allowed;
                }

                .spinner {
                    width: 16px;
                    height: 16px;
                    border: 2px solid rgba(255, 255, 255, 0.3);
                    border-top-color: white;
                    border-radius: 50%;
                    animation: spin 0.6s linear infinite;
                }

                @keyframes spin {
                    to { transform: rotate(360deg); }
                }

                .login-footer {
                    margin-top: 24px;
                    text-align: center;
                }

                .forgot-password {
                    color: var(--primary-light);
                    text-decoration: none;
                    font-size: 14px;
                    font-weight: 500;
                    transition: color 0.3s ease;
                }

                .forgot-password:hover {
                    color: var(--primary);
                }

                @media (max-width: 640px) {
                    .login-card {
                        padding: 32px 24px;
                    }

                    .login-title {
                        font-size: 28px;
                    }
                }
            `}</style>
        </div>
    )
}