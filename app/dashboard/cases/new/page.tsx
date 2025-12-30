'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { CaseType } from '@/lib/types'
import { ArrowLeft, Save, Info } from 'lucide-react'

export default function NewCasePage() {
    const router = useRouter()
    const [loading, setLoading] = useState(false)
    const [formData, setFormData] = useState({
        case_type: 'Refinancing' as CaseType,
        client_name: '',
        loan_size: ''
    })

    const caseTypes: CaseType[] = ['Refinancing', 'Purchase', 'Decouple', 'Equity Loan', 'Divorce']

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)

        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                router.push('/login')
                return
            }

            const { data, error } = await supabase
                .from('cases')
                .insert({
                    case_type: formData.case_type,
                    client_name: formData.client_name || null,
                    loan_size: formData.loan_size ? parseFloat(formData.loan_size) : null,
                    stage: 'Touched Base',
                    created_by: user.id
                })
                .select()
                .single()

            if (error) {
                console.error('Error creating case:', error)
                alert('Failed to create case: ' + error.message)
            } else {
                router.push(`/dashboard/cases/${data.id}`)
            }
        } catch (err) {
            console.error('Unexpected error:', err)
            alert('An unexpected error occurred')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            {/* Header */}
            <div style={{ marginBottom: '24px' }}>
                <button
                    onClick={() => router.back()}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: '#64748b',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '16px',
                        cursor: 'pointer',
                        fontWeight: '500'
                    }}
                >
                    <ArrowLeft size={16} />
                    Back to Cases
                </button>
                <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#052d4a' }}>Create New Case</h1>
            </div>

            {/* Form Card */}
            <div className="card" style={{ padding: '32px' }}>
                <form onSubmit={handleSubmit}>
                    {/* Info Alert */}
                    <div style={{
                        padding: '16px',
                        background: '#eff6ff',
                        borderRadius: '8px',
                        marginBottom: '24px',
                        display: 'flex',
                        gap: '12px',
                        border: '1px solid #dbeafe'
                    }}>
                        <Info size={20} color="#3b82f6" style={{ flexShrink: 0 }} />
                        <div>
                            <p style={{ margin: 0, fontSize: '14px', color: '#1e3a8a', fontWeight: '500' }}>Initial Setup</p>
                            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#3b82f6' }}>
                                The case will start at the <strong>"Touched Base"</strong> stage. You can add detailed property and pipeline information after creation.
                            </p>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gap: '24px' }}>
                        {/* Case Type */}
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: '#334155' }}>
                                Case Type <span style={{ color: '#ef4444' }}>*</span>
                            </label>
                            <select
                                value={formData.case_type}
                                onChange={(e) => setFormData({ ...formData, case_type: e.target.value as CaseType })}
                                required
                                style={{
                                    width: '100%',
                                    padding: '10px 12px',
                                    borderRadius: '6px',
                                    border: '1px solid #cbd5e1',
                                    fontSize: '15px',
                                    color: '#0f172a',
                                    background: '#f8fafc'
                                }}
                            >
                                {caseTypes.map(type => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </div>

                        {/* Client Name */}
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: '#334155' }}>
                                Client Name (Optional)
                            </label>
                            <input
                                type="text"
                                value={formData.client_name}
                                onChange={(e) => setFormData({ ...formData, client_name: e.target.value })}
                                placeholder="e.g. John Doe"
                                style={{
                                    width: '100%',
                                    padding: '10px 12px',
                                    borderRadius: '6px',
                                    border: '1px solid #cbd5e1',
                                    fontSize: '15px',
                                    color: '#0f172a',
                                    background: '#f8fafc'
                                }}
                            />
                        </div>

                        {/* Loan Size */}
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: '#334155' }}>
                                Estimated Loan Size
                            </label>
                            <div style={{ position: 'relative' }}>
                                <span style={{ position: 'absolute', left: '12px', top: '10px', color: '#94a3b8' }}>$</span>
                                <input
                                    type="number"
                                    value={formData.loan_size}
                                    onChange={(e) => setFormData({ ...formData, loan_size: e.target.value })}
                                    placeholder="0.00"
                                    min="0"
                                    style={{
                                        width: '100%',
                                        padding: '10px 12px 10px 32px',
                                        borderRadius: '6px',
                                        border: '1px solid #cbd5e1',
                                        fontSize: '15px',
                                        color: '#0f172a',
                                        background: '#f8fafc'
                                    }}
                                />
                            </div>
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '12px', marginTop: '8px', paddingTop: '24px', borderTop: '1px solid #f1f5f9' }}>
                            <button
                                type="submit"
                                disabled={loading}
                                className="btn-primary"
                                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                            >
                                {loading ? 'Creating...' : (
                                    <>
                                        <Save size={18} />
                                        Create Case
                                    </>
                                )}
                            </button>
                            <button
                                type="button"
                                onClick={() => router.back()}
                                className="btn-outline"
                                disabled={loading}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    )
}
