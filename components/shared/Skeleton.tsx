'use client'

import type { CSSProperties } from 'react'

interface SkeletonProps {
    width?: number | string
    height?: number | string
    radius?: number | string
    className?: string
    style?: CSSProperties
}

/**
 * A single shimmering placeholder block. Compose these into content-shaped
 * skeletons so screens look populated instantly instead of showing a blank
 * spinner. Styling (`.skeleton` + shimmer keyframes) lives in globals.css.
 */
export default function Skeleton({ width = '100%', height = 16, radius, className, style }: SkeletonProps) {
    return (
        <span
            className={`skeleton${className ? ` ${className}` : ''}`}
            style={{ width, height, ...(radius != null ? { borderRadius: radius } : null), ...style }}
        />
    )
}
