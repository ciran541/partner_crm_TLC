import chromium from '@sparticuz/chromium-min'
import puppeteer from 'puppeteer-core'

// Remote Chromium binary (Vercel serverless). In local dev, override with
// CHROMIUM_EXEC_PATH pointing to a locally-installed Chrome / Chromium.
const REMOTE_EXEC_PATH =
    process.env.CHROMIUM_REMOTE_EXEC_PATH ??
    'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar'

/**
 * Convert a self-contained HTML string to a PDF buffer (A4, portrait).
 * Strips any window.onload → print() scripts the HTML may contain.
 */
export async function generatePdf(html: string): Promise<Buffer> {
    const safeHtml = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')

    const executablePath =
        process.env.CHROMIUM_EXEC_PATH ??
        await chromium.executablePath(REMOTE_EXEC_PATH)

    const browser = await puppeteer.launch({
        args: chromium.args,
        executablePath,
        headless: true,
    })

    try {
        const page = await browser.newPage()
        await page.setContent(safeHtml, { waitUntil: 'load' })
        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '16mm', right: '16mm', bottom: '16mm', left: '16mm' },
        })
        return Buffer.from(pdf)
    } finally {
        await browser.close()
    }
}
