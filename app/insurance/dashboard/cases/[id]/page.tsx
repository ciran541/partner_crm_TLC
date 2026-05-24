'use client'

import React, { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Case, PipelineStage } from '@/lib/types'
import {
    ArrowLeft,
    Save,
    Edit2,
    X,
    User,
    Home,
    DollarSign,
    Briefcase,
    Calendar,
    CheckCircle2
} from 'lucide-react'

export default function CaseDetailPage() {
    const router = useRouter()
    const params = useParams()
    const caseId = params?.id as string

    const [caseData, setCaseData] = useState<Case | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [isEditing, setIsEditing] = useState(false)
    const [userRole, setUserRole] = useState<string | null>(null)

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
        if (caseId) {
            loadCase()
        }
    }, [caseId])

    const loadCase = async () => {
        setLoading(true)

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }

        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()

        setUserRole(profile?.role)

        const { data, error } = await supabase
            .from('cases')
            .select('*')
            .eq('id', caseId)
            .eq('id', caseId)
            .single()

        if (error) {
            console.error('Error loading case:', error)
            alert('Failed to load case')
            router.push('/insurance/dashboard/cases')
        } else {
            setCaseData(data)
        }

        setLoading(false)
    }

    const handleUpdate = async (updates: Partial<Case>) => {
        if (!caseData) return

        setSaving(true)

        let updateError = null

        if (userRole === 'admin') {
            try {
                const res = await fetch('/api/admin/update-case', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: caseId,
                        updates: {
                            ...updates,
                            updated_at: new Date().toISOString()
                        }
                    })
                })
                if (!res.ok) {
                    const data = await res.json()
                    updateError = { message: data.error || 'Failed to update via API' }
                }
            } catch (err) {
                updateError = { message: 'Network error calling Admin API' }
            }
        } else {
            const { error } = await supabase
                .from('cases')
                .update({
                    ...updates,
                    updated_at: new Date().toISOString()
                })
                .eq('id', caseId)

            updateError = error
        }

        if (updateError) {
            console.error('Error updating case:', updateError)
            alert('Failed to update case: ' + updateError.message)
        } else {
            await loadCase()
            setIsEditing(false)
        }

        setSaving(false)
    }

    const handleFieldChange = (field: keyof Case, value: any) => {
        if (!caseData) return
        setCaseData({ ...caseData, [field]: value })
    }

    const handleSave = () => {
        if (!caseData) return

        const updates: Partial<Case> = {
            stage: caseData.stage,
            client_name: caseData.client_name,
            client_mobile: caseData.client_mobile,
            client_email: caseData.client_email,
            loan_size: caseData.loan_size,
            property_type: caseData.property_type,
            property_price: caseData.property_price,
            current_bank: caseData.current_bank,
            existing_loan_amount: caseData.existing_loan_amount,
            lock_in_end_date: caseData.lock_in_end_date,
        }

        if (caseData.stage === 'Closed Won') {
            updates.closed_package_details = caseData.closed_package_details
            updates.closed_interest_rate = caseData.closed_interest_rate
            updates.closed_tenure = caseData.closed_tenure
            updates.subsidy_provided = caseData.subsidy_provided
            updates.clawback_end_date = caseData.clawback_end_date
            updates.remarks = caseData.remarks
        }

        handleUpdate(updates)
    }

    const [isClosedWonModalOpen, setIsClosedWonModalOpen] = useState(false)
    const [prevStage, setPrevStage] = useState<PipelineStage | null>(null)

    const handleStageChange = (newStage: string) => {
        if (!caseData) return
        const stage = newStage as PipelineStage
        if (stage === 'Closed Won') {
            setPrevStage(caseData.stage)
            setIsClosedWonModalOpen(true)
        } else {
            handleFieldChange('stage', stage)
        }
    }

    const handleClosedWonSubmit = (details: Partial<Case>) => {
        if (!caseData) return
        setCaseData({
            ...caseData,
            ...details,
            stage: 'Closed Won'
        })
        setIsClosedWonModalOpen(false)
    }

    if (loading) return <div style={{ padding: 20 }}>Loading...</div>
    if (!caseData) return <div style={{ padding: 20 }}>Case not found</div>

    const isClosedWon = caseData.stage === 'Closed Won'

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            {/* Header */}
            <div style={{ marginBottom: '24px' }}>
                <button
                    onClick={() => router.push('/insurance/dashboard/cases')}
                    style={{
                        background: 'none', border: 'none', color: '#64748b',
                        display: 'flex', alignItems: 'center', gap: '8px',
                        marginBottom: '12px', cursor: 'pointer', fontWeight: '500'
                    }}
                >
                    <ArrowLeft size={16} />
                    Back to Pipeline
                </button>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                            <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: '#052d4a', margin: 0 }}>
                                {caseData.client_name || 'Unnamed Case'}
                            </h1>
                            <span className="status-badge" style={{ background: '#e0f2fe', color: '#0369a1' }}>
                                {caseData.case_type}
                            </span>
                        </div>
                        <p style={{ color: '#64748b', fontSize: '14px' }}>
                            Created on {new Date(caseData.created_at).toLocaleDateString()}
                        </p>
                    </div>

                    <div style={{ display: 'flex', gap: '12px' }}>
                        {/* Sales Assistant Button - Refinancing Only */}
                        {(caseData.case_type === 'Refinancing' || caseData.case_type === 'Equity Loan') && (
                            <button
                                onClick={() => router.push(`/insurance/dashboard/cases/${caseId}/assistant`)}
                                className="btn-outline"
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #03a9e7', color: '#0369a1' }}
                            >
                                <Briefcase size={16} /> Sales Assistant
                            </button>
                        )}
                        {!isEditing ? (
                            <button className="btn-primary" onClick={() => setIsEditing(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Edit2 size={16} /> Edit Details
                            </button>
                        ) : (
                            <>
                                <button className="btn-outline" onClick={() => { setIsEditing(false); loadCase(); }}>
                                    <X size={16} style={{ marginRight: 6 }} /> Cancel
                                </button>
                                <button className="btn-primary" onClick={handleSave} disabled={saving}>
                                    {saving ? 'Saving...' : <><Save size={16} style={{ marginRight: 6 }} /> Save Changes</>}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Pipeline Stage Bar */}
            <div className="card" style={{ padding: '20px', marginBottom: '24px', background: 'linear-gradient(to right, #052d4a, #0f4a75)', color: 'white' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <label style={{ display: 'block', textTransform: 'uppercase', fontSize: '11px', fontWeight: '600', opacity: 0.8, letterSpacing: '1px', marginBottom: '4px' }}>
                            Current Stage
                        </label>
                        {isEditing ? (
                            <select
                                value={caseData.stage}
                                onChange={(e) => handleStageChange(e.target.value)}
                                style={{
                                    background: 'rgba(255,255,255,0.1)',
                                    color: 'white',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    padding: '8px 12px',
                                    borderRadius: '6px',
                                    fontSize: '16px',
                                    fontWeight: '600'
                                }}
                            >
                                {pipelineStages.map(stage => (
                                    <option key={stage} value={stage} style={{ color: 'black' }}>{stage}</option>
                                ))}
                            </select>
                        ) : (
                            <div style={{ fontSize: '20px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                {caseData.stage}
                                {caseData.stage === 'Closed Won' && <CheckCircle2 color="#4ade80" />}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }}>

                {/* Client Info Card */}
                <SectionCard title="Client Information" icon={User}>
                    <GridField label="Name" isEditing={isEditing}>
                        <input
                            type="text"
                            value={caseData.client_name || ''}
                            onChange={(e) => handleFieldChange('client_name', e.target.value)}
                            className="input-field-std"
                        />
                        {!isEditing && (caseData.client_name || '-')}
                    </GridField>
                    <GridField label="Mobile" isEditing={isEditing}>
                        <input
                            type="tel"
                            value={caseData.client_mobile || ''}
                            onChange={(e) => handleFieldChange('client_mobile', e.target.value)}
                            className="input-field-std"
                        />
                        {!isEditing && (caseData.client_mobile || '-')}
                    </GridField>
                    <GridField label="Email" isEditing={isEditing}>
                        <input
                            type="email"
                            value={caseData.client_email || ''}
                            onChange={(e) => handleFieldChange('client_email', e.target.value)}
                            className="input-field-std"
                        />
                        {!isEditing && (caseData.client_email || '-')}
                    </GridField>
                </SectionCard>

                {/* Property & Loan Info */}
                <SectionCard title="Property & Loan Details" icon={Home}>
                    <GridField label="Property Type" isEditing={isEditing}>
                        <input
                            type="text"
                            value={caseData.property_type || ''}
                            onChange={(e) => handleFieldChange('property_type', e.target.value)}
                            placeholder="e.g. HDB 4-Room"
                            className="input-field-std"
                        />
                        {!isEditing && (caseData.property_type || '-')}
                    </GridField>

                    <GridField label="Property Price" isEditing={isEditing}>
                        <div style={{ position: 'relative' }}>
                            {isEditing && <span style={{ position: 'absolute', left: 10, top: 9, color: '#94a3b8' }}>$</span>}
                            <input
                                type="number"
                                value={caseData.property_price || ''}
                                onChange={(e) => handleFieldChange('property_price', e.target.value)}
                                className="input-field-std"
                                style={isEditing ? { paddingLeft: 24 } : {}}
                            />
                        </div>
                        {!isEditing && (caseData.property_price ? `$${caseData.property_price.toLocaleString()}` : '-')}
                    </GridField>

                    {(caseData.case_type === 'Refinancing' || caseData.case_type === 'Equity Loan') ? (
                        <>
                            <GridField label="Existing Loan Amount" isEditing={isEditing}>
                                <div style={{ position: 'relative' }}>
                                    {isEditing && <span style={{ position: 'absolute', left: 10, top: 9, color: '#94a3b8' }}>$</span>}
                                    <input
                                        type="number"
                                        value={caseData.existing_loan_amount || ''}
                                        onChange={(e) => handleFieldChange('existing_loan_amount', e.target.value)}
                                        className="input-field-std"
                                        style={isEditing ? { paddingLeft: 24 } : {}}
                                    />
                                </div>
                                {!isEditing && (caseData.existing_loan_amount ? `$${caseData.existing_loan_amount.toLocaleString()}` : '-')}
                            </GridField>

                            <GridField label="Current Bank" isEditing={isEditing}>
                                <input
                                    type="text"
                                    value={caseData.current_bank || ''}
                                    onChange={(e) => handleFieldChange('current_bank', e.target.value)}
                                    placeholder="e.g. DBS"
                                    className="input-field-std"
                                />
                                {!isEditing && (caseData.current_bank || '-')}
                            </GridField>

                            <GridField label="Lock-in End Date" isEditing={isEditing}>
                                <input
                                    type="date"
                                    value={caseData.lock_in_end_date || ''}
                                    onChange={(e) => handleFieldChange('lock_in_end_date', e.target.value)}
                                    className="input-field-std"
                                />
                                {!isEditing && (caseData.lock_in_end_date ? new Date(caseData.lock_in_end_date).toLocaleDateString() : '-')}
                            </GridField>
                        </>
                    ) : (
                        <GridField label="Loan Amount" isEditing={isEditing}>
                            <div style={{ position: 'relative' }}>
                                {isEditing && <span style={{ position: 'absolute', left: 10, top: 9, color: '#94a3b8' }}>$</span>}
                                <input
                                    type="number"
                                    value={caseData.loan_size || ''}
                                    onChange={(e) => handleFieldChange('loan_size', e.target.value)}
                                    className="input-field-std"
                                    style={isEditing ? { paddingLeft: 24 } : {}}
                                />
                            </div>
                            {!isEditing && (caseData.loan_size ? `$${caseData.loan_size.toLocaleString()}` : '-')}
                        </GridField>
                    )}
                </SectionCard>

                {/* Closure Details */}
                {isClosedWon && (
                    <div className="card" style={{ padding: '24px', border: '1px solid #86efac', background: '#f0fdf4' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', color: '#166534' }}>
                            <CheckCircle2 size={20} />
                            <h3 style={{ margin: 0, fontWeight: '700' }}>Closed Won Details</h3>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                            <GridField label="Package Details" isEditing={isEditing} fullWidth>
                                <input
                                    type="text"
                                    value={caseData.closed_package_details || ''}
                                    onChange={(e) => handleFieldChange('closed_package_details', e.target.value)}
                                    placeholder="e.g. 2-Year Fixed @ 3.5%"
                                    className="input-field-std"
                                />
                                {!isEditing && (caseData.closed_package_details || '-')}
                            </GridField>
                            <GridField label="Interest Rate (%)" isEditing={isEditing}>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={caseData.closed_interest_rate || ''}
                                    onChange={(e) => handleFieldChange('closed_interest_rate', e.target.value)}
                                    className="input-field-std"
                                />
                                {!isEditing && (caseData.closed_interest_rate ? `${caseData.closed_interest_rate}%` : '-')}
                            </GridField>
                            <GridField label="Tenure (Years)" isEditing={isEditing}>
                                <input
                                    type="number"
                                    value={caseData.closed_tenure || ''}
                                    onChange={(e) => handleFieldChange('closed_tenure', e.target.value)}
                                    className="input-field-std"
                                />
                                {!isEditing && (caseData.closed_tenure || '-')}
                            </GridField>
                            <GridField label="Subsidy Provided" isEditing={isEditing}>
                                <input
                                    type="text"
                                    value={caseData.subsidy_provided || ''}
                                    onChange={(e) => handleFieldChange('subsidy_provided', e.target.value)}
                                    placeholder="e.g. $2,000"
                                    className="input-field-std"
                                />
                                {!isEditing && (caseData.subsidy_provided || '-')}
                            </GridField>
                            <GridField label="Clawback End Date" isEditing={isEditing}>
                                <input
                                    type="date"
                                    value={caseData.clawback_end_date || ''}
                                    onChange={(e) => handleFieldChange('clawback_end_date', e.target.value)}
                                    className="input-field-std"
                                />
                                {!isEditing && (caseData.clawback_end_date ? new Date(caseData.clawback_end_date).toLocaleDateString() : '-')}
                            </GridField>
                            <GridField label="Remarks" isEditing={isEditing} fullWidth>
                                <textarea
                                    value={caseData.remarks || ''}
                                    onChange={(e) => handleFieldChange('remarks', e.target.value)}
                                    rows={3}
                                    className="input-field-std"
                                    style={{ fontFamily: 'inherit' }}
                                />
                                {!isEditing && (caseData.remarks || '-')}
                            </GridField>
                        </div>
                    </div>
                )}
            </div>

            {isClosedWonModalOpen && (
                <ClosedWonModal
                    initialData={caseData}
                    onConfirm={handleClosedWonSubmit}
                    onCancel={() => setIsClosedWonModalOpen(false)}
                />
            )}

            <style jsx global>{`
                .input-field-std {
                    width: 100%;
                    padding: 8px 12px;
                    border: 1px solid #cbd5e1;
                    border-radius: 6px;
                    font-size: 14px;
                    color: #0f172a;
                    background: white;
                }
                .label-text {
                    display: block;
                    font-size: 13px;
                    font-weight: 600;
                    color: #64748b;
                    margin-bottom: 6px;
                    text-transform: uppercase;
                    letter-spacing: 0.02em;
                }
            `}</style>
        </div>
    )
}

function SectionCard({ title, icon: Icon, children }: { title: string, icon: any, children: React.ReactNode }) {
    return (
        <div className="card" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px', borderBottom: '1px solid #f1f5f9', paddingBottom: '16px' }}>
                <div style={{ padding: 8, background: '#f1f5f9', borderRadius: 6, color: '#64748b' }}>
                    <Icon size={18} />
                </div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: '#0f172a' }}>{title}</h3>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '24px' }}>
                {children}
            </div>
        </div>
    )
}

function GridField({ label, children, isEditing, fullWidth }: { label: string, children: React.ReactNode, isEditing: boolean, fullWidth?: boolean }) {
    const childArray = React.Children.toArray(children)
    const inputComponent = childArray[0]
    const displayComponent = childArray[1]

    return (
        <div style={{ gridColumn: fullWidth ? '1 / -1' : 'auto' }}>
            <label className="label-text">{label}</label>
            {isEditing ? inputComponent : (
                <div style={{ fontSize: '15px', fontWeight: '500', color: '#0f172a', minHeight: '24px' }}>
                    {displayComponent}
                </div>
            )}
        </div>
    )
}

function ClosedWonModal({ initialData, onConfirm, onCancel }: {
    initialData: Partial<Case>,
    onConfirm: (details: Partial<Case>) => void,
    onCancel: () => void
}) {
    const [details, setDetails] = useState({
        closed_package_details: initialData.closed_package_details || '',
        closed_interest_rate: initialData.closed_interest_rate || '',
        closed_tenure: initialData.closed_tenure || '',
        subsidy_provided: initialData.subsidy_provided || '',
        clawback_end_date: initialData.clawback_end_date || '',
        remarks: initialData.remarks || '',
    })

    const handleChange = (field: string, value: any) => {
        setDetails(prev => ({ ...prev, [field]: value }))
    }

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(5, 45, 74, 0.7)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
            padding: '20px'
        }}>
            <div className="card" style={{ width: '100%', maxWidth: '600px', padding: '32px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', color: '#166534' }}>
                    <div style={{ background: '#dcfce7', padding: '8px', borderRadius: '8px' }}>
                        <CheckCircle2 size={24} />
                    </div>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#052d4a' }}>Closed Won Details</h2>
                        <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>Please provide the final loan package information</p>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                    <div style={{ gridColumn: '1 / -1' }}>
                        <label className="label-text">Package Details</label>
                        <input
                            type="text"
                            value={details.closed_package_details}
                            onChange={(e) => handleChange('closed_package_details', e.target.value)}
                            placeholder="e.g. 2-Year Fixed @ 3.5%"
                            className="input-field-std"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="label-text">Interest Rate (%)</label>
                        <input
                            type="number"
                            step="0.01"
                            value={details.closed_interest_rate}
                            onChange={(e) => handleChange('closed_interest_rate', e.target.value)}
                            className="input-field-std"
                        />
                    </div>
                    <div>
                        <label className="label-text">Tenure (Years)</label>
                        <input
                            type="number"
                            value={details.closed_tenure}
                            onChange={(e) => handleChange('closed_tenure', e.target.value)}
                            className="input-field-std"
                        />
                    </div>
                    <div>
                        <label className="label-text">Subsidy Provided</label>
                        <input
                            type="text"
                            value={details.subsidy_provided}
                            onChange={(e) => handleChange('subsidy_provided', e.target.value)}
                            placeholder="e.g. $2,000"
                            className="input-field-std"
                        />
                    </div>
                    <div>
                        <label className="label-text">Clawback End Date</label>
                        <input
                            type="date"
                            value={details.clawback_end_date}
                            onChange={(e) => handleChange('clawback_end_date', e.target.value)}
                            className="input-field-std"
                        />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                        <label className="label-text">Remarks</label>
                        <textarea
                            value={details.remarks}
                            onChange={(e) => handleChange('remarks', e.target.value)}
                            rows={3}
                            className="input-field-std"
                            style={{ fontFamily: 'inherit' }}
                        />
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
                    <button
                        className="btn-outline"
                        style={{ flex: 1, justifyContent: 'center' }}
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        className="btn-primary"
                        style={{ flex: 2, justifyContent: 'center', background: '#166534', borderColor: '#166534' }}
                        onClick={() => onConfirm({
                            ...details,
                            closed_interest_rate: details.closed_interest_rate ? parseFloat(details.closed_interest_rate as string) : undefined,
                            closed_tenure: details.closed_tenure ? parseInt(details.closed_tenure as string) : undefined,
                        })}
                    >
                        Save Closure Details
                    </button>
                </div>
            </div>
        </div>
    )
}
