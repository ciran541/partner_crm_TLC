'use client';

import { Flame, ArrowRight } from 'lucide-react';

interface UrgencyBannerProps {
  count: number;
  label?: string;
  onAction: () => void;
  actionLabel?: string;
}

export default function UrgencyBanner({
  count,
  label,
  onAction,
  actionLabel = 'View Now',
}: UrgencyBannerProps) {
  if (count <= 0) return null;

  const message = label ?? `${count} case${count > 1 ? 's' : ''} with expiring lock-ins need${count === 1 ? 's' : ''} your attention`;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 20px',
        borderRadius: 12,
        border: '1px solid #fed7aa',
        backgroundColor: '#fff7ed',
        marginBottom: 20,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          backgroundColor: '#ea580c15',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Flame size={18} color="#ea580c" />
      </div>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: '#7c2d12' }}>
        <strong style={{ fontWeight: 700, color: '#9a3412' }}>{count}</strong>{' '}
        {message.replace(String(count) + ' ', '')}
      </span>
      <button
        onClick={onAction}
        className="pressable"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: '#ea580c',
          fontWeight: 700,
          fontSize: 13,
          padding: '6px 10px',
          borderRadius: 6,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
      >
        {actionLabel}
        <ArrowRight size={14} />
      </button>
    </div>
  );
}
