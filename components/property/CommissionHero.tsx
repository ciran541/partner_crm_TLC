'use client';

import { ArrowRight, TrendingUp } from 'lucide-react';
import Spinner from '@/components/shared/Spinner';

interface CommissionHeroProps {
  total: number;
  pending: number;
  confirmed: number;
  paid: number;
  loading?: boolean;
  onViewEarnings?: () => void;
}

function fmt(n: number) {
  return n.toLocaleString('en-SG', { style: 'currency', currency: 'SGD', maximumFractionDigits: 0 });
}

export default function CommissionHero({
  total,
  pending,
  confirmed,
  paid,
  loading = false,
  onViewEarnings,
}: CommissionHeroProps) {
  return (
    <div
      className="card"
      style={{
        padding: '28px 32px',
        borderLeft: '4px solid #059669',
        marginBottom: 20,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TrendingUp size={16} color="#059669" />
          <span className="metric-label" style={{ color: '#059669' }}>Your Earnings</span>
        </div>
        {onViewEarnings && (
          <button
            onClick={onViewEarnings}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#059669',
              fontWeight: 600,
              fontSize: 13,
              padding: 0,
            }}
          >
            View Earnings <ArrowRight size={14} />
          </button>
        )}
      </div>
      {loading ? (
        <Spinner size="md" color="#059669" label="Loading earnings…" />
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px 48px', alignItems: 'flex-end' }}>
          <div>
            <div
              style={{
                fontSize: 'clamp(2rem, 5vw, 3rem)',
                fontWeight: 800,
                color: '#0f172a',
                letterSpacing: '-0.04em',
                lineHeight: 1,
                marginBottom: 6,
              }}
            >
              {fmt(total)}
            </div>
            <div className="metric-label">Total Portfolio</div>
          </div>
          <div style={{ display: 'flex', gap: 36, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#d97706', letterSpacing: '-0.02em', lineHeight: 1, marginBottom: 5 }}>
                {fmt(pending)}
              </div>
              <div className="metric-label">Pending</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#059669', letterSpacing: '-0.02em', lineHeight: 1, marginBottom: 5 }}>
                {fmt(paid)}
              </div>
              <div className="metric-label">Paid Out</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
