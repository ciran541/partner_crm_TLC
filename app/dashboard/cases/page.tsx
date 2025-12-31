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
        <div>
            {/* Page Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#052d4a', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Briefcase size={28} color="#03a9e7" />
                        Cases
                    </h1>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                        onClick={() => router.push('/dashboard/cases/new')}
                        className="btn-primary"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <Plus size={18} />
                        Create Case
                    </button>
                </div>
            </div>

            {/* Toolbar */}
            <div className="card" style={{ padding: '16px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b' }}>
                    <Filter size={18} />
                    <span style={{ fontWeight: '500', fontSize: '14px' }}>Filter:</span>
                </div>
                <select
                    value={filterStage}
                    onChange={(e) => setFilterStage(e.target.value as PipelineStage | 'all')}
                    style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: 'white',
                        color: '#0f172a',
                        fontSize: '14px',
                        minWidth: '200px'
                    }}
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
                        style={{
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid #cbd5e1',
                            background: 'white',
                            color: '#0f172a',
                            fontSize: '14px',
                            minWidth: '200px'
                        }}
                    >
                        <option value="all">All Agents</option>
                        {agentList.map(agent => (
                            <option key={agent.id} value={agent.id}>{agent.name}</option>
                        ))}
                    </select>
                )}

                {/* Search Placeholder (Visual only for now) */}
                <div style={{ marginLeft: 'auto', position: 'relative' }}>
                    <input
                        type="text"
                        placeholder="Search cases..."
                        style={{
                            padding: '8px 12px 8px 36px',
                            borderRadius: '6px',
                            border: '1px solid #cbd5e1',
                            fontSize: '14px',
                            width: '240px'
                        }}
                    />
                    <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
                </div>
            </div>

            {/* Cases Table */}
            <div className="card" style={{ overflow: 'hidden' }}>
                {cases.length === 0 ? (
                    <div style={{ padding: '48px', textAlign: 'center', color: '#64748b' }}>
                        <Briefcase size={48} style={{ opacity: 0.2, margin: '0 auto 16px' }} />
                        <p style={{ fontSize: '16px', fontWeight: '500' }}>No cases found</p>
                        <p style={{ fontSize: '14px' }}>Get started by creating a new case.</p>
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                            <tr>
                                <th style={{ padding: '16px', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Client Name</th>
                                {userRole === 'admin' && (
                                    <th style={{ padding: '16px', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Agent</th>
                                )}
                                <th style={{ padding: '16px', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Type</th>
                                <th style={{ padding: '16px', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Loan Amount / Size</th>
                                <th style={{ padding: '16px', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Stage</th>
                                <th style={{ padding: '16px', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Last Updated</th>
                                <th style={{ padding: '16px', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {cases.map((caseItem) => {
                                const stageStyle = getStageColor(caseItem.stage)
                                return (
                                    <tr
                                        key={caseItem.id}
                                        style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.1s' }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                                    >
                                        <td style={{ padding: '16px', fontWeight: '500', color: '#0f172a' }}>
                                            {caseItem.client_name || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Unnamed</span>}
                                        </td>
                                        {userRole === 'admin' && (
                                            <td style={{ padding: '16px', color: '#475569' }}>
                                                {caseItem.profiles?.name || profilesMap[caseItem.created_by] || 'Unknown Agent'}
                                            </td>
                                        )}
                                        <td style={{ padding: '16px', color: '#475569' }}>{caseItem.case_type}</td>
                                        <td style={{ padding: '16px', color: '#475569', fontFamily: 'monospace' }}>
                                            {(caseItem.case_type === 'Refinancing' || caseItem.case_type === 'Equity Loan')
                                                ? formatCurrency(caseItem.existing_loan_amount)
                                                : formatCurrency(caseItem.loan_size)
                                            }
                                        </td>
                                        <td style={{ padding: '16px' }}>
                                            <span
                                                className="status-badge"
                                                style={{ background: stageStyle.bg, color: stageStyle.text }}
                                            >
                                                {caseItem.stage}
                                            </span>
                                        </td>
                                        <td style={{ padding: '16px', color: '#94a3b8', fontSize: '13px' }}>
                                            {formatDate(caseItem.updated_at)}
                                        </td>
                                        <td style={{ padding: '16px', textAlign: 'right' }}>
                                            <button
                                                onClick={() => router.push(`/dashboard/cases/${caseItem.id}`)}
                                                style={{
                                                    padding: '6px',
                                                    background: 'transparent',
                                                    border: '1px solid #e2e8f0',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer',
                                                    color: '#64748b'
                                                }}
                                                title="View Details"
                                            >
                                                <Eye size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    )
}
