/**
 * Exports the full current Supabase schema to supabase/schema/full_current_schema.sql
 * Usage: node scripts/export-schema.mjs <your-personal-access-token>
 * Generate token at: https://supabase.com/dashboard/account/tokens
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const PROJECT_REF = 'umkewxijcnlljqohmsyi'
const BASE_URL = 'https://api.supabase.com/v1'
const TOKEN = process.argv[2]
const __dirname = dirname(fileURLToPath(import.meta.url))

if (!TOKEN) {
    console.error('Usage: node scripts/export-schema.mjs <personal-access-token>')
    console.error('Generate one at: https://supabase.com/dashboard/account/tokens')
    process.exit(1)
}

const headers = {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
}

async function api(path) {
    const res = await fetch(`${BASE_URL}${path}`, { headers })
    if (!res.ok) throw new Error(`API error ${res.status} at ${path}: ${await res.text()}`)
    return res.json()
}

async function main() {
    console.log('Fetching schema from Supabase Management API...')

    const [tables, columns, relationships] = await Promise.all([
        api(`/projects/${PROJECT_REF}/database/tables`),
        api(`/projects/${PROJECT_REF}/database/columns`),
        api(`/projects/${PROJECT_REF}/database/foreign-tables`).catch(() => []),
    ])

    const publicTables = tables.filter(t => t.schema === 'public')
    const publicColumns = columns.filter(c => c.table_schema === 'public')

    console.log(`Found ${publicTables.length} tables, ${publicColumns.length} columns`)

    // Group columns by table
    const colsByTable = {}
    for (const col of publicColumns) {
        if (!colsByTable[col.table_name]) colsByTable[col.table_name] = []
        colsByTable[col.table_name].push(col)
    }
    for (const cols of Object.values(colsByTable)) {
        cols.sort((a, b) => a.ordinal_position - b.ordinal_position)
    }

    const lines = []
    lines.push('-- =============================================================')
    lines.push('-- Full schema export from Supabase Management API')
    lines.push(`-- Project: ${PROJECT_REF}`)
    lines.push(`-- Exported at: ${new Date().toISOString()}`)
    lines.push('-- =============================================================')
    lines.push('')

    // Extensions (commonly used in Supabase)
    lines.push('-- Extensions')
    lines.push('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')
    lines.push('CREATE EXTENSION IF NOT EXISTS "pgcrypto";')
    lines.push('')

    // Tables
    for (const table of publicTables) {
        const cols = colsByTable[table.name] ?? []
        lines.push(`-- Table: ${table.name}`)
        lines.push(`CREATE TABLE IF NOT EXISTS public.${quote(table.name)} (`)

        const colDefs = cols.map(col => {
            let def = `    ${quote(col.name)} ${col.format || col.data_type}`
            if (col.default_value !== null && col.default_value !== undefined) {
                def += ` DEFAULT ${col.default_value}`
            }
            if (!col.is_nullable) def += ' NOT NULL'
            return def
        })

        // Add primary key inline if single-column
        const pkCols = cols.filter(c => c.is_primary_key)
        if (pkCols.length === 1) {
            const pkIdx = colDefs.findIndex((_, i) => cols[i]?.is_primary_key)
            if (pkIdx !== -1) colDefs[pkIdx] += ' PRIMARY KEY'
        } else if (pkCols.length > 1) {
            colDefs.push(`    PRIMARY KEY (${pkCols.map(c => quote(c.name)).join(', ')})`)
        }

        lines.push(colDefs.join(',\n'))
        lines.push(');')
        lines.push('')
    }

    // Indexes (fetched separately)
    try {
        const indexes = await api(`/projects/${PROJECT_REF}/database/indexes`)
        const publicIndexes = (indexes || []).filter(i => i.schema === 'public' && !i.is_primary)
        if (publicIndexes.length > 0) {
            lines.push('-- Indexes')
            for (const idx of publicIndexes) {
                lines.push(`CREATE INDEX IF NOT EXISTS ${quote(idx.name)} ON public.${quote(idx.table_name)} (${idx.columns?.join(', ') ?? ''});`)
            }
            lines.push('')
        }
    } catch {
        lines.push('-- Note: Index definitions could not be fetched automatically.')
        lines.push('')
    }

    lines.push('-- =============================================================')
    lines.push('-- NOTE: RLS policies, triggers, and custom functions are not')
    lines.push('-- included in this export. Re-apply them from phase1_property_platform.sql')
    lines.push('-- or recreate them manually after verifying tables are correct.')
    lines.push('-- =============================================================')

    const outPath = join(__dirname, '..', 'supabase', 'schema', 'full_current_schema.sql')
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, lines.join('\n'), 'utf8')

    console.log(`✓ Schema exported to: supabase/schema/full_current_schema.sql`)
    console.log(`  Tables: ${publicTables.length}`)
    console.log(`  Columns: ${publicColumns.length}`)
}

function quote(name) {
    return `"${name}"`
}

main().catch(err => {
    console.error('Error:', err.message)
    process.exit(1)
})
