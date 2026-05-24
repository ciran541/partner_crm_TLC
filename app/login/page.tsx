'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { Mail, Lock, Loader2, ArrowRight } from 'lucide-react'

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
        <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden bg-[#052d4a]">
            {/* Background Effects - Brand Aligned */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0">
                <div className="absolute -top-[20%] -right-[10%] w-[600px] h-[600px] rounded-full bg-[#03a9e7]/20 blur-[100px]" />
                <div className="absolute -bottom-[20%] -left-[10%] w-[500px] h-[500px] rounded-full bg-[#03a9e7]/10 blur-[80px]" />
            </div>

            {/* Login Card */}
            <div className="w-full max-w-md p-8 relative z-10 m-4 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl">
                <div className="text-center mb-8">
                    <div className="flex justify-center mb-6">
                        <img
                            src="https://theloanconnection.com.sg/wp-content/uploads/2025/02/TLC-Square-1.png"
                            alt="The Loan Connection Logo"
                            className="w-20 h-20 rounded-xl shadow-lg"
                        />
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2">Welcome Back</h1>
                    <p className="text-[#94a3b8]">Sign in to your Partner CRM account</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-6">
                    <div className="space-y-2">
                        <label htmlFor="email" className="text-sm font-medium text-[#cbd5e1] ml-1">
                            Email Address
                        </label>
                        <div className="relative group">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#64748b] group-focus-within:text-[#03a9e7] transition-colors">
                                <Mail size={20} />
                            </div>
                            <input
                                id="email"
                                type="email"
                                placeholder="you@company.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full bg-[#0f172a]/50 border border-[#334155] text-white rounded-xl py-3.5 pl-12 pr-4 outline-none focus:border-[#03a9e7] focus:ring-1 focus:ring-[#03a9e7] transition-all placeholder:text-[#475569]"
                                required
                                disabled={isLoading}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between ml-1">
                            <label htmlFor="password" className="text-sm font-medium text-[#cbd5e1]">
                                Password
                            </label>
                            <a href="#" className="text-sm text-[#03a9e7] hover:text-[#38bdf8] transition-colors">
                                Forgot password?
                            </a>
                        </div>
                        <div className="relative group">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#64748b] group-focus-within:text-[#03a9e7] transition-colors">
                                <Lock size={20} />
                            </div>
                            <input
                                id="password"
                                type="password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-[#0f172a]/50 border border-[#334155] text-white rounded-xl py-3.5 pl-12 pr-4 outline-none focus:border-[#03a9e7] focus:ring-1 focus:ring-[#03a9e7] transition-all placeholder:text-[#475569]"
                                required
                                disabled={isLoading}
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        className="w-full bg-[#03a9e7] hover:bg-[#0284c7] text-white font-semibold py-3.5 rounded-xl transition-all shadow-[0_0_20px_rgba(3,169,231,0.3)] hover:shadow-[0_0_30px_rgba(3,169,231,0.5)] transform hover:-translate-y-0.5 disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <>
                                <Loader2 size={20} className="animate-spin" />
                                Signing in...
                            </>
                        ) : (
                            <>
                                Sign In
                                <ArrowRight size={20} />
                            </>
                        )}
                    </button>
                </form>

                <div className="mt-8 text-center text-sm text-[#64748b]">
                    <p>&copy; {new Date().getFullYear()} The Loan Connection. All rights reserved.</p>
                </div>
            </div>
        </div>
    )
}
