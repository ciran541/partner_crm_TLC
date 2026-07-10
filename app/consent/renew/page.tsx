'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { CheckCircle2, Circle } from 'lucide-react'
import LegalConsentModal from '@/components/shared/LegalConsentModal'
import Spinner from '@/components/shared/Spinner'
import { insuranceTerms, insurancePrivacy } from '@/lib/legal/insuranceLegalContent'
import { propertyTerms, propertyPrivacy } from '@/lib/legal/propertyLegalContent'
import { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } from '@/lib/legal/consentVersions'
import type { AppType } from '@/lib/types/shared'

export default function ConsentRenewPage() {
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [userId, setUserId] = useState<string | null>(null)
    const [appType, setAppType] = useState<AppType>('insurance')
    const [termsAccepted, setTermsAccepted] = useState(false)
    const [privacyAccepted, setPrivacyAccepted] = useState(false)
    const [activeModal, setActiveModal] = useState<'terms' | 'privacy' | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let active = true
        supabase.auth.getUser().then(async ({ data: { user } }) => {
            if (!user) { router.replace('/insurance/login'); return }
            const { data: profile } = await supabase.from('profiles').select('app_type').eq('id', user.id).single()
            if (!active) return
            setUserId(user.id)
            setAppType((profile?.app_type as AppType) ?? 'insurance')
            setLoading(false)
        })
        return () => { active = false }
    }, [router])

    const isInsurance = appType === 'insurance'
    const accent = isInsurance ? '#03a9e7' : '#059669'
    const terms = isInsurance ? insuranceTerms : propertyTerms
    const privacy = isInsurance ? insurancePrivacy : propertyPrivacy
    const dashboardPath = isInsurance ? '/insurance/dashboard' : '/property/dashboard'
    const allAgreed = termsAccepted && privacyAccepted

    const handleContinue = async () => {
        if (!userId || !allAgreed) return
        setSaving(true)
        setError(null)
        const { error: insertError } = await supabase.from('user_consents').insert({
            user_id: userId,
            terms_accepted: true,
            privacy_accepted: true,
            terms_version: CURRENT_TERMS_VERSION,
            privacy_version: CURRENT_PRIVACY_VERSION,
        })
        if (insertError) {
            setError(insertError.message)
            setSaving(false)
            return
        }
        router.replace(dashboardPath)
    }

    if (loading) {
        return (
            <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Spinner size="md" color={accent} label="Loading…" />
            </div>
        )
    }

    return (
        <div
            style={{
                minHeight: '100dvh',
                background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                padding: 'calc(48px + env(safe-area-inset-top)) 16px calc(48px + env(safe-area-inset-bottom))',
            }}
        >
            <div style={{ maxWidth: 480, width: '100%', margin: '0 auto' }}>
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                    <h1 style={{ fontSize: 22, fontWeight: 800, color: '#052d4a', marginBottom: 6 }}>
                        Our Terms & Privacy Policy have been updated
                    </h1>
                    <p style={{ fontSize: 14, color: '#64748b' }}>
                        Please review and accept the latest version to continue.
                    </p>
                </div>

                <div className="card-elevated" style={{ padding: '36px 32px' }}>
                    {error && (
                        <div style={{
                            padding: '10px 14px', borderRadius: 9, marginBottom: 20,
                            background: '#fef2f2', border: '1px solid #fecaca',
                            color: '#991b1b', fontSize: 13, fontWeight: 500,
                        }}>
                            {error}
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {([
                            { key: 'terms' as const, label: 'Terms & Conditions', accepted: termsAccepted },
                            { key: 'privacy' as const, label: 'Privacy Policy', accepted: privacyAccepted },
                        ]).map(({ key, label, accepted }) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setActiveModal(key)}
                                className="pressable"
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: '14px 16px', borderRadius: 10,
                                    border: `1px solid ${accepted ? `${accent}55` : '#e2e8f0'}`,
                                    background: accepted ? `${accent}0f` : 'white',
                                    cursor: 'pointer',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    {accepted
                                        ? <CheckCircle2 size={20} color={accent} />
                                        : <Circle size={20} color="#d1d5db" />
                                    }
                                    <span style={{ fontSize: 14, fontWeight: 600, color: accepted ? accent : '#374151' }}>{label}</span>
                                </div>
                                <span style={{ fontSize: 11, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                    {accepted ? 'Review' : 'Read →'}
                                </span>
                            </button>
                        ))}
                    </div>

                    <button
                        type="button"
                        onClick={handleContinue}
                        disabled={!allAgreed || saving}
                        style={{
                            width: '100%', marginTop: 24,
                            padding: '12px 24px', borderRadius: 10, border: 'none',
                            background: accent, color: 'white', fontSize: 15, fontWeight: 600,
                            opacity: (!allAgreed || saving) ? 0.4 : 1,
                            cursor: (!allAgreed || saving) ? 'not-allowed' : 'pointer',
                        }}
                    >
                        {saving ? 'Saving…' : 'Continue'}
                    </button>
                </div>
            </div>

            <LegalConsentModal
                isOpen={activeModal === 'terms'}
                title="Terms & Conditions"
                content={terms}
                alreadyAccepted={termsAccepted}
                onClose={() => setActiveModal(null)}
                onAccept={() => { setTermsAccepted(true); setActiveModal(null) }}
            />
            <LegalConsentModal
                isOpen={activeModal === 'privacy'}
                title="Privacy Policy"
                content={privacy}
                alreadyAccepted={privacyAccepted}
                onClose={() => setActiveModal(null)}
                onAccept={() => { setPrivacyAccepted(true); setActiveModal(null) }}
            />
        </div>
    )
}
