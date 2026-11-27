// How each agency writes its own name; anything else is shown in capitals (IRAS, URA).
const NAMES: Record<string, string> = { moneysense: 'MoneySense', mynicehome: 'MyNiceHome', gobusiness: 'GoBusiness' }

/** "IRAS" for an iras.gov.sg link; null for anything that isn't a Singapore government site. Safe in the browser. */
export function officialName(url: string | null | undefined): string | null {
    if (!url || !URL.canParse(url)) return null
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (!host.endsWith('.gov.sg')) return null
    const label = host.split('.')[0]
    return NAMES[label] ?? label.toUpperCase()
}
