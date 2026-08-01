/**
 * Generate realistic test cases so paging, search and totals can actually be
 * exercised. With a handful of cases every list fits on one page and none of the
 * Phase A–D behaviour is reachable.
 *
 *   npm run seed:cases -- --list          # who can be seeded (ids included)
 *   npm run seed:cases                    # 120 cases for the first agent by name
 *   npm run seed:cases -- --count 300
 *   npm run seed:cases -- --agent <uuid>  # a specific profile, admin or agent
 *   npm run seed:cases -- --all-agents    # spread across every insurance agent
 *   npm run seed:cases -- --clean         # delete everything this script made
 *
 * Seed to the account you actually LOG IN AS if you want to see the results on
 * agent-scoped screens. An admin sees every case on the lists and dashboards,
 * but the planner's drafts are owned — `mine=true` — so drafts seeded to someone
 * else will not appear there. `--agent` therefore accepts an admin's id too.
 *
 * Every generated row is tagged in `remarks` with SEED_TAG, and --clean deletes
 * exactly those. Nothing else is ever touched, so this is safe to run against a
 * database that already has real cases in it — but it DOES write, so do not
 * point it at production data you care about.
 */

import { readFileSync } from 'node:fs'

const SEED_TAG = '[seed-cases]'

// ─── env ─────────────────────────────────────────────────────────────────────
function loadEnv() {
    try {
        const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
        for (const line of raw.split('\n')) {
            const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
            if (m && !process.env[m[1]]) {
                process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
            }
        }
    } catch { /* fall back to the real environment */ }
}
loadEnv()

const URL_BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_BASE || !KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
}

/**
 * Plain fetch rather than supabase-js: createClient() boots a realtime client
 * that needs a native WebSocket, which Node 20 does not have — it throws before
 * a single row is written. PostgREST over fetch has no such dependency.
 */
const HEADERS = {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
}

async function rest(path, init = {}) {
    const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
        ...init,
        headers: { ...HEADERS, ...(init.headers ?? {}) },
    })
    const body = await res.text()
    if (!res.ok) throw new Error(`${res.status} ${body}`)
    return body ? JSON.parse(body) : null
}

// ─── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const flag = n => args.includes(n)
const value = (n, d) => {
    const i = args.indexOf(n)
    return i >= 0 && args[i + 1] ? args[i + 1] : d
}

// ─── fixtures ────────────────────────────────────────────────────────────────
const STAGES = ['Touched Base', 'Pending Docs', 'Pending Approval', 'Pending Signature', 'Closed Won', 'Closed Lost']
const TYPES = ['Purchase', 'Refinancing', 'Decouple', 'Equity Loan']
const BANKS = ['DBS', 'OCBC', 'UOB', 'Maybank', 'Standard Chartered', 'HSBC', 'CIMB']
const PROPERTY = ['HDB', 'Condo', 'Landed', 'EC']
const FIRST = ['Wei Ming', 'Siti', 'Rajesh', 'Grace', 'Kai', 'Hui Ling', 'Arun', 'Mei', 'Daniel', 'Nurul',
    'Jia Hao', 'Priya', 'Sarah', 'Zhi Yang', 'Farah', 'Marcus', 'Xin Yi', 'Ravi', 'Cheryl', 'Aisyah']
const LAST = ['Tan', 'Lim', 'Lee', 'Ng', 'Wong', 'Chan', 'Kumar', 'Rahman', 'Goh', 'Teo', 'Sim', 'Ong']

let seq = 0
const pick = a => a[Math.floor(Math.random() * a.length)]
const int = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1))
const chance = p => Math.random() < p

function isoDaysFromNow(days) {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d.toISOString().slice(0, 10)
}

function buildCase(agentId) {
    seq += 1
    const stage = pick(STAGES)
    const caseType = pick(TYPES)

    // ~8% drafts: no client name and still at the first stage. They exercise the
    // draft rule, which is inverted on the planner and hidden everywhere else.
    const isDraft = stage === 'Touched Base' && chance(0.35)

    const name = isDraft ? null : `${pick(FIRST)} ${pick(LAST)}`
    const loan = int(200, 1800) * 1000
    const refiLike = caseType === 'Refinancing' || caseType === 'Equity Loan'

    const row = {
        created_by: agentId,
        case_type: caseType,
        stage,
        client_name: name,
        client_mobile: isDraft ? null : `+65 ${int(8000, 9999)} ${int(1000, 9999)}`,
        client_email: isDraft ? null : `seed${seq}@example.test`,
        loan_size: refiLike ? null : loan,
        existing_loan_amount: refiLike ? loan : null,
        property_type: pick(PROPERTY),
        property_price: chance(0.7) ? loan + int(50, 400) * 1000 : null,
        current_bank: pick(BANKS),
        // Tagged so --clean can find exactly these rows and nothing else.
        remarks: `${SEED_TAG} generated fixture #${seq}`,
        // Spread over ~14 months so the six-month trend and month filters have
        // something on both sides of every boundary.
        created_at: new Date(Date.now() - int(0, 430) * 86400000).toISOString(),

        // NOTE: every key below is always present, even when null. PostgREST
        // rejects a bulk insert whose objects have differing key sets
        // ("All object keys must match"), so these cannot be added conditionally.

        // A third get a follow-up, deliberately split either side of today so the
        // overdue/upcoming halves both have rows.
        follow_up_date: chance(0.33) ? isoDaysFromNow(int(-45, 60)) : null,

        // Lock-ins inside and outside the 90-day window, to catch an off-by-one
        // at the boundary.
        lock_in_end_date: chance(0.4) ? isoDaysFromNow(int(-30, 200)) : null,

        // NOT NULL with a default in the schema, so send a real value rather
        // than null.
        commission_status: 'unpaid',
        closed_won_data: {},
    }

    if (stage === 'Closed Won') {
        row.commission_status = chance(0.5) ? 'paid' : 'unpaid'
        // Half of closed deals carry a Letter of Offer total that DIFFERS from the
        // estimate — that gap is exactly where caseLoanBase and the old
        // cases-page helper used to disagree.
        if (chance(0.5)) {
            row.closed_won_data = {
                original_loan_total: loan + int(-80, 120) * 1000,
                combined_outstanding: loan - int(10, 90) * 1000,
            }
        }
    }
    return row
}

// ─── run ─────────────────────────────────────────────────────────────────────
const TAG_FILTER = `remarks=like.${encodeURIComponent(SEED_TAG)}*`

async function main() {
    if (flag('--clean')) {
        const deleted = await rest(`cases?${TAG_FILTER}`, {
            method: 'DELETE',
            headers: { Prefer: 'return=representation' },
        })
        console.log(`Deleted ${deleted?.length ?? 0} seeded case(s).`)
        return
    }

    // Ordered by name so "the first agent" is at least deterministic, and every
    // candidate is printed — picking one silently is how a seed run ends up on
    // an account you are not logged in as.
    const profiles = await rest('profiles?select=id,name,full_name,role,status&app_type=eq.insurance&order=name.asc')
    const label = p => p.name || p.full_name || '(unnamed)'

    if (flag('--list') || (!profiles.length)) {
        console.log('Insurance profiles:')
        for (const p of profiles) console.log(`  ${p.id}  ${label(p)}  [${p.role}${p.status === 'disabled' ? ', disabled' : ''}]`)
        if (!profiles.length) console.error('\nNo insurance profiles found — create one first.')
        return
    }

    const agents = profiles.filter(p => p.role === 'agent' && p.status !== 'disabled')
    const explicit = value('--agent', null)

    // --agent accepts ANY insurance profile id, including an admin's: to see
    // seeded DRAFTS on the planner you must own them, and you may well be logged
    // in as an admin.
    let targets
    if (explicit) {
        const match = profiles.find(p => p.id === explicit)
        if (!match) {
            console.error(`No insurance profile with id ${explicit}. Run with --list to see them.`)
            process.exit(1)
        }
        targets = [match]
    } else if (flag('--all-agents')) {
        targets = agents
    } else {
        targets = agents.slice(0, 1)
    }

    if (!targets.length) {
        console.error('No target profile. Run with --list, then pass --agent <uuid>.')
        process.exit(1)
    }

    const count = Number.parseInt(value('--count', '120'), 10)
    const rows = []
    for (let i = 0; i < count; i++) {
        rows.push(buildCase(targets[i % targets.length].id))
    }

    console.log(`Seeding ${count} case(s) as:`)
    for (const t of targets) console.log(`  ${label(t)}  [${t.role}]  ${t.id}`)
    console.log()

    // Chunked: one 120-row insert is fine, but --count 5000 is not.
    let inserted = 0
    for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200)
        await rest('cases', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify(chunk),
        })
        inserted += chunk.length
        process.stdout.write(`\rInserted ${inserted}/${rows.length}`)
    }

    console.log(`\nDone.`)
    console.log(`Remove them with:  npm run seed:cases -- --clean`)
}

main().catch(err => {
    console.error('\nSeed failed:', err.message ?? err)
    process.exit(1)
})
