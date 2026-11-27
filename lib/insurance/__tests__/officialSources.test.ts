import { describe, expect, it } from 'vitest'
import { fingerprint, htmlToText, mainText, robotsAllows } from '../officialPageText'
import { checkNotes, parseNotes } from '../officialNotes'
import { officialName } from '../officialName'
import { evidence, matchPages, suggestDays, titleFromUrl } from '../officialEvidence'
import { figureTokens } from '../figures'
import { isDue, siteFor, type OfficialSite } from '../officialSources'

describe('mainText', () => {
    it('keeps the main content and drops menus, footers and scripts', () => {
        const html = `<html><body><nav>Home Taxes</nav><main><h1>ABSD</h1><p>Foreigners pay 60%.</p>
            <script>var x=1</script><table><tr><th>Profile</th><th>Rate</th></tr><tr><td>Foreigner</td><td>60%</td></tr></table>
            <p>You are using an outdated browser. Please upgrade.</p></main><footer>© IRAS</footer></body></html>`
        const t = mainText(html)
        expect(t).toContain('Foreigners pay 60%.')
        expect(t).toContain('Foreigner | 60%')
        expect(t).not.toMatch(/Home Taxes|IRAS|var x|outdated browser/)
    })
    it('reads Next.js page data (HDB) and skips its menus', () => {
        const body = '<p>The HDB loan is up to 75% of the price or value, whichever is lower, for eligible buyers.</p>'
        const data = { props: { pageProps: {
            sidebarData: { menuData: [{ title: 'Renting a Flat', bodyContent: '<p>Menu text that should never be read as the rules of the page.</p>' }] },
            componentProps: { x: { props: { accordionItems: [{ title: 'Loan amount', bodyContentVal: body + body.replace('75%', '80%') + body.repeat(3) }] } } },
        } } }
        const t = mainText(`<html><body><div id="root">Loading</div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`)
        expect(t).toContain('Loan amount')
        expect(t).toContain('up to 75% of the price')
        expect(t).not.toContain('Menu text')
    })
    it('decodes entities', () => {
        expect(htmlToText('<p>Buyer&rsquo;s Stamp Duty &amp; ABSD&nbsp;rates</p>')).toBe('Buyer’s Stamp Duty & ABSD rates')
    })
})

describe('fingerprint', () => {
    it('ignores spacing and case, but not figures', () => {
        expect(fingerprint('ABSD  is 60%\nfor foreigners')).toBe(fingerprint('absd is 60% for foreigners'))
        expect(fingerprint('ABSD is 60%')).not.toBe(fingerprint('ABSD is 65%'))
    })
    it('a changed "last updated" line alone is not a change', () => {
        const page = (d: string) => mainText(`<main><p>Last updated: ${d}</p><p>The SSD holding period is 4 years for homes bought from 4 Jul 2025.</p></main>`)
        expect(fingerprint(page('1 Jan 2026'))).toBe(fingerprint(page('3 Mar 2026')))
    })
})

describe('robotsAllows', () => {
    const robots = 'User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /memberservices\nAllow: /memberservices/public\nCrawl-delay: 2'
    it('follows the rules for every crawler, longest match first', () => {
        expect(robotsAllows(robots, '/taxes/stamp-duty')).toBe(true)
        expect(robotsAllows(robots, '/memberservices/x')).toBe(false)
        expect(robotsAllows(robots, '/memberservices/public/y')).toBe(true)
        expect(robotsAllows('', '/anything')).toBe(true)
    })
})

describe('drafts', () => {
    const page = 'Foreigners buying any residential property: 60% from 27 Apr 2023 (previously 30%). Singapore Citizens buying a second property: 20%.'
    it('parses the reply and tidies the other wordings', () => {
        const notes = parseNotes('```json\n{"notes":[{"question":"What ABSD does a foreigner pay?","answer":"60% on any home bought from 27 Apr 2023.","asks":["ABSD Foreigner","absd foreigner","x"]},{"question":"Hi","answer":"no","asks":[]}]}\n```')
        expect(notes).toEqual([{ question: 'What ABSD does a foreigner pay?', answer: '60% on any home bought from 27 Apr 2023.', asks: ['absd foreigner'] }])
        expect(parseNotes('not json')).toEqual([])
    })
    it('drops a draft with a figure not on the page, or a question HUB already has', () => {
        const { keep, dropped } = checkNotes([
            { question: 'What ABSD does a foreigner pay?', answer: '60% from 27 Apr 2023.', asks: [] },
            { question: 'ABSD for PRs?', answer: 'PRs pay 5% on a first home.', asks: [] },
            { question: 'What ABSD does a citizen pay on a 2nd home?', answer: '20%.', asks: [] },
        ], page, ['What ABSD does a citizen pay on a 2nd home'])
        expect(keep.map(k => k.question)).toEqual(['What ABSD does a foreigner pay?'])
        expect(dropped.map(d => d.why)).toEqual(['a figure is not on the page', 'already in HUB'])
    })
})

describe('sites and schedule', () => {
    const sites = [{ id: '1', domain: 'iras.gov.sg', name: 'IRAS', bots_allowed: true, note: null }] as OfficialSite[]
    it('only pages of an approved site, over https', () => {
        expect(siteFor('https://www.iras.gov.sg/taxes/x', sites)?.name).toBe('IRAS')
        expect(siteFor('http://www.iras.gov.sg/taxes/x', sites)).toBeNull()
        expect(siteFor('https://iras.gov.sg.evil.com/x', sites)).toBeNull()
        expect(siteFor('https://www.hdb.gov.sg/x', sites)).toBeNull()
    })
    it('a page is due when never read or its interval has passed', () => {
        const now = Date.parse('2026-11-27T09:00:00Z')
        expect(isDue({ checked_at: null, check_days: 7 }, now)).toBe(true)
        expect(isDue({ checked_at: '2026-11-20T09:05:00Z', check_days: 7 }, now)).toBe(true)   // daily job runs a few minutes early or late
        expect(isDue({ checked_at: '2026-11-25T09:00:00Z', check_days: 7 }, now)).toBe(false)
    })
    it('names the agency for gov.sg links only', () => {
        expect(officialName('https://www.mas.gov.sg/regulation')).toBe('MAS')
        expect(officialName('https://www.dbs.com.sg/x')).toBeNull()
        expect(officialName(null)).toBeNull()
    })
})

describe('reviewing a draft', () => {
    const page = 'Loan-to-Value (LTV) limit\nUp to 75% of the flat purchase price for new flats.\nIncome ceiling | $16,000 for families\nApply online via the portal.'
    it('ticks figures on the page, crosses the rest, and finds the lines that hold them', () => {
        const e = evidence('What is the LTV limit?', 'Up to 75% of the price, and income up to $16,000. Tenure 30 years.', page)
        expect(e.figures).toEqual([{ text: '75%', found: true }, { text: '$16,000', found: true }, { text: '30 years', found: false }])
        expect(e.lines).toEqual(['Up to 75% of the flat purchase price for new flats.', 'Income ceiling | $16,000 for families'])
    })
    it('list numbering is not a figure', () => {
        expect(figureTokens('1. Pay 5% cash\n2. Rest by CPF')).toEqual(['5%'])
    })
})

describe('finding pages', () => {
    const urls = ['https://www.hdb.gov.sg/buying-a-flat/resale/financing', 'https://www.hdb.gov.sg/renting-a-flat', 'https://www.hdb.gov.sg/buying-a-flat/resale/financing', 'https://www.hdb.gov.sg/x/form.pdf']
    it('matches every word, skips pages already watched, files and repeats', () => {
        expect(matchPages(urls, 'resale financing', new Set())).toEqual([{ url: urls[0], title: 'Financing' }])
        expect(matchPages(urls, 'resale', new Set([urls[0]]))).toEqual([])
        expect(titleFromUrl('https://www.hdb.gov.sg/housing-loan-from-hdb/')).toBe('Housing loan from hdb')
        expect(suggestDays('Stamp duty: ABSD')).toBe(7)
        expect(suggestDays('Housing loan')).toBe(30)
    })
})
