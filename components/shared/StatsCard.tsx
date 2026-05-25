'use client';

import { ElementType } from 'react';

type StatsCardVariant = 'default' | 'money' | 'alert';

interface TrendBadge {
  value: string;
  up: boolean;
}

interface StatsCardProps {
  title: string;
  value: number | string;
  icon: ElementType;
  color: string;
  subtitle?: string;
  onClick?: () => void;
  variant?: StatsCardVariant;
  trend?: TrendBadge;
  urgent?: boolean;
}

export default function StatsCard({
  title,
  value,
  icon: Icon,
  color,
  subtitle,
  onClick,
  variant = 'default',
  trend,
  urgent = false,
}: StatsCardProps) {
  const isMoney = variant === 'money';
  const isAlert = variant === 'alert' || urgent;

  return (
    <div
      className={onClick ? 'card pressable' : 'card'}
      style={{
        padding: '22px 24px',
        cursor: onClick ? 'pointer' : 'default',
        position: 'relative',
        overflow: 'hidden',
        ...(isAlert && Number(value) > 0 ? { borderLeft: '3px solid #f59e0b' } : {}),
      }}
      onClick={onClick}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 11,
            background: `${color}18`,
            color: color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon size={20} />
        </div>
        {trend && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '3px 7px',
              borderRadius: 6,
              background: trend.up ? '#f0fdf4' : '#fef2f2',
              color: trend.up ? '#166534' : '#991b1b',
            }}
          >
            {trend.up ? '↑' : '↓'} {trend.value}
          </span>
        )}
        {isAlert && Number(value) > 0 && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#f59e0b',
              display: 'inline-block',
              boxShadow: '0 0 0 3px rgba(245,158,11,0.2)',
            }}
          />
        )}
      </div>
      <div
        style={{
          fontSize: isMoney ? 34 : 32,
          fontWeight: 800,
          color: isMoney ? color : '#0f172a',
          lineHeight: 1,
          letterSpacing: '-0.03em',
          marginBottom: 6,
        }}
      >
        {value}
      </div>
      <div className="metric-label">{title}</div>
      {subtitle && (
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{subtitle}</div>
      )}
    </div>
  );
}
