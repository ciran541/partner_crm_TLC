/**
 * Regenerates supabase/schema/full_current_schema.sql from the live Supabase project.
 * Run after any SQL change made directly in Supabase SQL Editor.
 *
 * Usage:
 *   npm run sync-schema
 *
 * Requires in .env.local (or as env vars):
 *   SUPABASE_PROJECT_REF   — e.g. umkewxijcnlljqohmsyi
 *   SUPABASE_ACCESS_TOKEN  — personal access token from supabase.com/dashboard/account/tokens
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// ── Load env from .env.local ─────────────────────────────────
function loadEnv() {
    try {
        const raw = readFileSync(resolve(ROOT, '.env.local'), 'utf8')
        for (const line of raw.split('\n')) {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith('#')) continue
            const eq = trimmed.indexOf('=')
            if (eq === -1) continue
            const key = trimmed.slice(0, eq).trim()
            const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
            if (!process.env[key]) process.env[key] = val
        }
    } catch {
        // No .env.local — rely on actual env vars
    }
}

loadEnv()

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN

if (!PROJECT_REF || !ACCESS_TOKEN) {
    console.error('Missing required env vars: SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN')
    console.error('Get your access token at: https://supabase.com/dashboard/account/tokens')
    process.exit(1)
}

const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`

async function query(sql) {
    const res = await fetch(API, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
    })
    if (!res.ok) {
        const text = await res.text()
        throw new Error(`API error ${res.status}: ${text}`)
    }
    return res.json()
}

// ── Introspection queries ────────────────────────────────────

const ENUM_SQL = `
SELECT
    t.typname AS enum_name,
    string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS labels
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
GROUP BY t.typname
ORDER BY t.typname;
`

const TABLE_SQL = `
SELECT
    c.table_name,
    c.column_name,
    c.ordinal_position,
    c.column_default,
    c.is_nullable,
    c.data_type,
    c.udt_name,
    c.character_maximum_length
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name NOT IN (
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename NOT IN (
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        )
  )
ORDER BY c.table_name, c.ordinal_position;
`

const FK_SQL = `
SELECT
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table,
    ccu.column_name AS foreign_column,
    tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;
`

const PK_SQL = `
SELECT
    tc.table_name,
    kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
ORDER BY tc.table_name;
`

const UNIQUE_SQL = `
SELECT
    tc.table_name,
    kcu.column_name,
    tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;
`

const RLS_SQL = `
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
`

const POLICY_SQL = `
SELECT
    tablename,
    policyname,
    permissive,
    array_to_string(roles, ', ') AS roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
`

// ── SQL generation helpers ───────────────────────────────────

function pgType(col) {
    if (col.data_type === 'ARRAY') return `${col.udt_name.replace(/^_/, '')}[]`
    if (col.data_type === 'USER-DEFINED') return col.udt_name
    if (col.data_type === 'character varying') {
        return col.character_maximum_length
            ? `varchar(${col.character_maximum_length})`
            : 'text'
    }
    if (col.data_type === 'character') return `char(${col.character_maximum_length ?? 1})`
    return col.data_type
}

function buildEnums(rows) {
    if (!rows.length) return ''
    return rows
        .map(r => {
            const vals = r.labels.split(',').map(v => `'${v}'`).join(', ')
            return `CREATE TYPE public.${r.enum_name} AS ENUM (${vals});`
        })
        .join('\n') + '\n'
}

function buildTables(colRows, pkRows, uniqueRows) {
    const tables = {}
    for (const col of colRows) {
        if (!tables[col.table_name]) tables[col.table_name] = []
        tables[col.table_name].push(col)
    }

    const pks = {}
    for (const pk of pkRows) {
        if (!pks[pk.table_name]) pks[pk.table_name] = []
        pks[pk.table_name].push(pk.column_name)
    }

    const uniques = {}
    for (const u of uniqueRows) {
        if (!uniques[u.table_name]) uniques[u.table_name] = []
        uniques[u.table_name].push({ col: u.column_name, name: u.constraint_name })
    }

    return Object.entries(tables)
        .map(([table, cols]) => {
            const lines = cols.map(col => {
                const type = pgType(col)
                const nullable = col.is_nullable === 'YES' ? '' : ' NOT NULL'
                const def = col.column_default
                    ? ` DEFAULT ${col.column_default}`
                    : ''
                return `    ${col.column_name} ${type}${nullable}${def}`
            })

            const tablePks = pks[table] ?? []
            if (tablePks.length) {
                lines.push(`    PRIMARY KEY (${tablePks.join(', ')})`)
            }

            const tableUniques = uniques[table] ?? []
            for (const u of tableUniques) {
                lines.push(`    CONSTRAINT ${u.name} UNIQUE (${u.col})`)
            }

            return `CREATE TABLE IF NOT EXISTS public.${table} (\n${lines.join(',\n')}\n);`
        })
        .join('\n\n') + '\n'
}

function buildFKs(rows) {
    if (!rows.length) return ''
    return rows
        .map(r =>
            `ALTER TABLE public.${r.table_name}\n` +
            `    ADD CONSTRAINT ${r.constraint_name}\n` +
            `    FOREIGN KEY (${r.column_name}) REFERENCES public.${r.foreign_table}(${r.foreign_column});`
        )
        .join('\n') + '\n'
}

function buildRls(rlsRows, policyRows) {
    const enables = rlsRows
        .filter(r => r.rowsecurity)
        .map(r => `ALTER TABLE public.${r.tablename} ENABLE ROW LEVEL SECURITY;`)
        .join('\n')

    const policies = policyRows
        .map(p => {
            const lines = [`CREATE POLICY "${p.policyname}" ON public.${p.tablename}`]
            if (p.permissive !== 'PERMISSIVE') lines.push(`    AS ${p.permissive}`)
            lines.push(`    FOR ${p.cmd} TO ${p.roles}`)
            if (p.qual) lines.push(`    USING (${p.qual})`)
            if (p.with_check) lines.push(`    WITH CHECK (${p.with_check})`)
            return lines.join('\n') + ';'
        })
        .join('\n\n')

    return `${enables}\n\n${policies}\n`
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
    console.log(`Fetching schema from project ${PROJECT_REF}...`)

    const [enums, columns, fks, pks, uniques, rlsFlags, policies] = await Promise.all([
        query(ENUM_SQL),
        query(TABLE_SQL),
        query(FK_SQL),
        query(PK_SQL),
        query(UNIQUE_SQL),
        query(RLS_SQL),
        query(POLICY_SQL),
    ])

    const now = new Date().toISOString()
    const output = [
        `-- ============================================================`,
        `-- Full schema — auto-generated by scripts/sync-schema.mjs`,
        `-- Project: ${PROJECT_REF}`,
        `-- Generated: ${now}`,
        `-- Run "npm run sync-schema" after any SQL Editor change`,
        `-- ============================================================`,
        ``,
        `-- Extensions`,
        `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`,
        ``,
        `-- Enums`,
        buildEnums(enums),
        `-- Tables`,
        buildTables(columns, pks, uniques),
        `-- Foreign Keys`,
        buildFKs(fks),
        `-- Row Level Security (policies live in the DB — schema changes to them`,
        `-- must still go through migration files, this section is reference only)`,
        buildRls(rlsFlags, policies),
    ].join('\n')

    const outPath = resolve(ROOT, 'supabase/schema/full_current_schema.sql')
    writeFileSync(outPath, output, 'utf8')

    console.log(`\nDone. Schema written to supabase/schema/full_current_schema.sql`)
    console.log(`  Enums:   ${enums.length}`)
    console.log(`  Tables:  ${[...new Set(columns.map(r => r.table_name))].length}`)
    console.log(`  Columns: ${columns.length}`)
    console.log(`  FKs:     ${fks.length}`)
    console.log(`  RLS policies: ${policies.length}`)
}

main().catch(err => {
    console.error('Error:', err.message)
    process.exit(1)
})
