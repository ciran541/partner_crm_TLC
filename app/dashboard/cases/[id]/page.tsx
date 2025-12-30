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

        const { data, error } = await supabase
            .from('cases')
            .select('*')
            .eq('id', caseId)
            .eq('created_by', user.id)
            .single()

        if (error) {
            console.error('Error loading case:', error)
            alert('Failed to load case')
            router.push('/dashboard/cases')
        } else {
            setCaseData(data)
        }

        setLoading(false)
    }

    const handleUpdate = async (updates: Partial<Case>) => {
        if (!caseData) return

        setSaving(true)

        const { error } = await supabase
            .from('cases')
            .update({
                ...updates,
                updated_at: new Date().toISOString()
            })
            .eq('id', caseId)

        if (error) {
            console.error('Error updating case:', error)
            alert('Failed to update case: ' + error.message)
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

    if (loading) return <div style={{ padding: 20 }}>Loading...</div>
    if (!caseData) return <div style={{ padding: 20 }}>Case not found</div>

    const isClosedWon = caseData.stage === 'Closed Won'

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            {/* Header */}
            <div style={{ marginBottom: '24px' }}>
                <button
                    onClick={() => router.push('/dashboard/cases')}
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
                                onChange={(e) => handleFieldChange('stage', e.target.value)}
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

                    <GridField label="Total Loan Size" isEditing={isEditing}>
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
