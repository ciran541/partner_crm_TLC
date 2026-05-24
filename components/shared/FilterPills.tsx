'use client';

interface PillOption {
  value: string;
  label: string;
  count?: number;
}

interface FilterPillsProps {
  options: PillOption[];
  value: string;
  onChange: (value: string) => void;
  accentColor?: string;
  accentTextColor?: string;
}

export default function FilterPills({
  options,
  value,
  onChange,
  accentColor = '#059669',
  accentTextColor = 'white',
}: FilterPillsProps) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 14px',
              borderRadius: 9999,
              fontSize: 13,
              fontWeight: 600,
              border: active ? 'none' : '1px solid #e2e8f0',
              background: active ? accentColor : 'white',
              color: active ? accentTextColor : '#475569',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
          >
            {opt.label}
            {opt.count !== undefined && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 18,
                  height: 18,
                  borderRadius: 9999,
                  fontSize: 11,
                  fontWeight: 700,
                  background: active ? 'rgba(255,255,255,0.25)' : '#f1f5f9',
                  color: active ? 'white' : '#64748b',
                  padding: '0 4px',
                }}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
