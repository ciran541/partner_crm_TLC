/**
 * Backward compatibility shim.
 * All existing imports of '@/lib/types' continue to work.
 * New code should import from '@/lib/types/shared', '@/lib/types/insurance', or '@/lib/types/property'.
 */
export * from './types/index'
