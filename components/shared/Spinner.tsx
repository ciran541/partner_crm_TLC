'use client';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  label?: string;
}

const SIZES = {
  sm: { width: 16, height: 16 },
  md: { width: 20, height: 20 },
  lg: { width: 28, height: 28 },
};

export default function Spinner({ size = 'md', color, label }: SpinnerProps) {
  const { width, height } = SIZES[size];
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: color ?? 'currentColor' }}
    >
      <span className="spinner" style={{ width, height }} />
      {label && (
        <span style={{ fontSize: 14, color: '#64748b', fontWeight: 500 }}>{label}</span>
      )}
    </span>
  );
}
