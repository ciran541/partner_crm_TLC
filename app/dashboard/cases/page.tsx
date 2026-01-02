'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Case, PipelineStage } from '@/lib/types'
import { Plus, Filter, Search, Briefcase, Eye, MoreHorizontal } from 'lucide-react'

export default function CasesPage() {
    const router = useRouter()
    const [cases, setCases] = useState<Case[]>([])
    const [loading, setLoading] = useState(true)
    const [filterStage, setFilterStage] = useState<PipelineStage | 'all'>('all')
    const [user, setUser] = useState<any>(null)
    const [userRole, setUserRole] = useState<string | null>(null)
    const [profilesMap, setProfilesMap] = useState<Record<string, string>>({})
    const [agentList, setAgentList] = useState<{ id: string, name: string }[]>([])
    const [filterAgent, setFilterAgent] = useState<string>('all')

    const pipelineStages: PipelineStage[] = [
        'Touched Base',
        'Proposal Given',
        'Referred to Bank',
        'Pending Approval',
        'Pending Signature',
        'Closed Won',
        'Closed Lost'
    ]

    useEffect(() => {
        loadCases()
    }, [filterStage, filterAgent])

    const loadCases = async () => {
        setLoading(true)

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }
        setUser(user)

        // Fetch user role
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()

        setUserRole(profile?.role)

        if (profile?.role === 'admin') {
            try {
                const res = await fetch('/api/admin/get-profiles')
                if (res.ok) {
                    const allProfiles = await res.json()
                    if (Array.isArray(allProfiles)) {
                        const map: Record<string, string> = {}
                        allProfiles.forEach((p: any) => {
                            map[p.id] = p.name
                        })
                        setProfilesMap(map)
                        setAgentList(allProfiles)
                    }
                }
            } catch (err) {
                console.error('Failed to fetch profiles via admin API', err)
            }
        }

        let query = supabase
            .from('cases')
            .select(`
                *,
                profiles (
                    id,
                    name,
                    role
                )
            `)
            .order('updated_at', { ascending: false })

        if (filterStage !== 'all') {
            query = query.eq('stage', filterStage)
        }

        if (filterAgent !== 'all') {
            query = query.eq('created_by', filterAgent)
        }

        const { data, error } = await query

        if (error) {
            console.error('Error loading cases:', JSON.stringify(error, null, 2))
            alert('Failed to load cases: ' + (error.message || 'Unknown error'))
        } else {
            setCases(data || [])
        }

        setLoading(false)
    }

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        })
    }

    const formatCurrency = (amount?: number) => {
        if (!amount) return '-'
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0
        }).format(amount)
    }

    const getStageColor = (stage: string) => {
        switch (stage) {
            case 'Closed Won': return { bg: '#d1fae5', text: '#065f46' }
            case 'Closed Lost': return { bg: '#fee2e2', text: '#991b1b' }
            case 'Pending Approval': return { bg: '#fff7ed', text: '#9a3412' }
            case 'Pending Signature': return { bg: '#fef3c7', text: '#92400e' }
            default: return { bg: '#e0f2fe', text: '#0369a1' } // Default blueish
        }
    }

    if (loading) {
        return <div style={{ color: '#052d4a', padding: '20px' }}>Loading cases...</div>
    }

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[#052d4a] flex items-center gap-2">
                        <Briefcase size={28} className="text-[#03a9e7]" />
                        <span>Cases</span>
                    </h1>
                </div>
                <button
                    onClick={() => router.push('/dashboard/cases/new')}
                    className="btn-primary flex items-center justify-center gap-2 w-full sm:w-auto"
                >
                    <Plus size={18} />
                    <span>Create Case</span>
                </button>
            </div>

            {/* Toolbar */}
            <div className="card p-4 flex flex-col lg:flex-row lg:items-center gap-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 flex-1">
                    <div className="flex items-center gap-2 text-slate-500 shrink-0">
                        <Filter size={18} />
                        <span className="font-medium text-sm">Filter:</span>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
                        <select
                            value={filterStage}
                            onChange={(e) => setFilterStage(e.target.value as PipelineStage | 'all')}
                            className="p-2.5 rounded-lg border border-slate-200 bg-white text-slate-900 text-sm min-w-0 sm:min-w-[200px] outline-none focus:ring-2 focus:ring-[#03a9e7]/20 transition-all"
                        >
                            <option value="all">All Pipeline Stages</option>
                            {pipelineStages.map(stage => (
                                <option key={stage} value={stage}>{stage}</option>
                            ))}
                        </select>

                        {userRole === 'admin' && (
                            <select
                                value={filterAgent}
                                onChange={(e) => setFilterAgent(e.target.value)}
                                className="p-2.5 rounded-lg border border-slate-200 bg-white text-slate-900 text-sm min-w-0 sm:min-w-[200px] outline-none focus:ring-2 focus:ring-[#03a9e7]/20 transition-all"
                            >
                                <option value="all">All Agents</option>
                                {agentList.map(agent => (
                                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                                ))}
                            </select>
                        )}
                    </div>
                </div>

                <div className="relative w-full lg:w-64">
                    <input
                        type="text"
                        placeholder="Search cases..."
                        className="w-full p-2.5 pl-10 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-[#03a9e7]/20 transition-all"
                    />
                    <Search size={16} className="text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                </div>
            </div>

            {/* Cases Table */}
            <div className="card overflow-hidden">
                {cases.length === 0 ? (
                    <div className="p-12 text-center text-slate-500">
                        <Briefcase size={48} className="opacity-10 mx-auto mb-4" />
                        <p className="text-lg font-semibold text-slate-900">No cases found</p>
                        <p className="text-sm">Get started by creating a new case.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[800px]">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Client Name</th>
                                    {userRole === 'admin' && (
                                        <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Agent</th>
                                    )}
                                    <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Type</th>
                                    <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Loan Amount</th>
                                    <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Stage</th>
                                    <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Last Updated</th>
                                    <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {cases.map((caseItem) => {
                                    const stageStyle = getStageColor(caseItem.stage)
                                    return (
                                        <tr
                                            key={caseItem.id}
                                            className="hover:bg-slate-50 transition-colors group"
                                        >
                                            <td className="p-4 font-semibold text-slate-900">
                                                {caseItem.client_name || <span className="text-slate-400 italic font-normal">Unnamed</span>}
                                            </td>
                                            {userRole === 'admin' && (
                                                <td className="p-4 text-slate-600">
                                                    {caseItem.profiles?.name || profilesMap[caseItem.created_by] || 'Unknown Agent'}
                                                </td>
                                            )}
                                            <td className="p-4 text-slate-600">{caseItem.case_type}</td>
                                            <td className="p-4 text-slate-600 font-medium">
                                                {(caseItem.case_type === 'Refinancing' || caseItem.case_type === 'Equity Loan')
                                                    ? formatCurrency(caseItem.existing_loan_amount)
                                                    : formatCurrency(caseItem.loan_size)
                                                }
                                            </td>
                                            <td className="p-4">
                                                <span
                                                    className="status-badge inline-block"
                                                    style={{ background: stageStyle.bg, color: stageStyle.text }}
                                                >
                                                    {caseItem.stage}
                                                </span>
                                            </td>
                                            <td className="p-4 text-slate-400 text-xs">
                                                {formatDate(caseItem.updated_at)}
                                            </td>
                                            <td className="p-4 text-right">
                                                <button
                                                    onClick={() => router.push(`/dashboard/cases/${caseItem.id}`)}
                                                    className="p-2 text-slate-400 hover:text-[#03a9e7] hover:bg-sky-50 rounded-lg transition-all"
                                                    title="View Details"
                                                >
                                                    <Eye size={18} />
                                                </button>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
