'use client';

import { ElementType } from 'react';

interface EmptyStateProps {
  icon: ElementType;
  title: string;
  description: string;
  iconColor?: string;
  action?: { label: string; onClick: () => void };
}

export default function EmptyState({ icon: Icon, title, description, iconColor = '#64748b', action }: EmptyStateProps) {
  return (
    <div className="card" style={{ padding: '56px 32px', textAlign: 'center' }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          backgroundColor: `${iconColor}15`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 20px',
        }}
      >
        <Icon size={28} color={iconColor} />
      </div>
      <h3 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>{title}</h3>
      <p style={{ fontSize: 14, color: '#64748b', maxWidth: 360, margin: '0 auto', lineHeight: 1.6 }}>{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="btn-emerald"
          style={{ marginTop: 24 }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
