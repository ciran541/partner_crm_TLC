'use client';

import { useEffect } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

type AlertType = 'success' | 'error' | 'warning' | 'info';

interface InlineAlertProps {
  type: AlertType;
  message: string;
  onDismiss?: () => void;
}

const CONFIG: Record<AlertType, { bg: string; border: string; text: string; icon: typeof CheckCircle }> = {
  success: { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534', icon: CheckCircle },
  error:   { bg: '#fef2f2', border: '#fecaca', text: '#991b1b', icon: XCircle },
  warning: { bg: '#fffbeb', border: '#fde68a', text: '#92400e', icon: AlertTriangle },
  info:    { bg: '#eff6ff', border: '#bfdbfe', text: '#1e40af', icon: Info },
};

export default function InlineAlert({ type, message, onDismiss }: InlineAlertProps) {
  const { bg, border, text, icon: Icon } = CONFIG[type];

  useEffect(() => {
    if (type === 'success' && onDismiss) {
      const t = setTimeout(onDismiss, 4000);
      return () => clearTimeout(t);
    }
  }, [type, onDismiss]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 16px',
        borderRadius: 10,
        border: `1px solid ${border}`,
        backgroundColor: bg,
        color: text,
        fontSize: 14,
        fontWeight: 500,
        marginBottom: 16,
      }}
    >
      <Icon size={16} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: text, padding: 2, opacity: 0.7, display: 'flex' }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
