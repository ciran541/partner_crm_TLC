import { NextResponse } from 'next/server'

/**
 * Our SQL raises P0001 (and the follow-up rule 23514) with a message written for people; anything
 * else is a real fault and stays in the server log.
 */
export function rpcError(where: string, error: { code?: string; message: string }, fallback: string) {
    if (error.code === 'P0001' || error.code === '23514') return NextResponse.json({ error: error.message }, { status: 409 })
    console.error(`[${where}]`, error)
    return NextResponse.json({ error: fallback }, { status: 500 })
}
