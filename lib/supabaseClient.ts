/**
 * Backward compatibility shim.
 * All existing imports of '@/lib/supabaseClient' continue to work.
 * New code should import from '@/lib/supabase/client' directly.
 */
export { supabase } from './supabase/client'