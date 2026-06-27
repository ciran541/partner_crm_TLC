import { existsSync } from 'node:fs'
import chromium from '@sparticuz/chromium-min'
import puppeteer from 'puppeteer-core'

// Remote Chromium binary used only in serverless (Vercel/Lambda), where no browser
// is installed. In local dev we auto-detect an installed Chrome/Edge instead.
const REMOTE_EXEC_PATH =
    process.env.CHROMIUM_REMOTE_EXEC_PATH ??
    'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar'

// True on Vercel / AWS Lambda — there we must use the downloaded serverless Chromium.
const IS_SERVERLESS = !!(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.AWS_EXECUTION_ENV
)

// Common install locations for a real Chrome/Edge, checked in dev when
// CHROMIUM_EXEC_PATH isn't set. First existing one wins.
function findLocalBrowser(): string | null {
    const home = process.env.LOCALAPPDATA
    const candidates = [
        // Windows
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        home ? `${home}\\Google\\Chrome\\Application\\chrome.exe` : '',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        // macOS
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        // Linux
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
    ].filter(Boolean) as string[]
    return candidates.find(p => existsSync(p)) ?? null
}

/**
 * Convert a self-contained HTML string to a PDF buffer (A4, portrait).
 * Strips any window.onload → print() scripts the HTML may contain.
 */
export async function generatePdf(html: string): Promise<Buffer> {
    const safeHtml = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')

    let executablePath: string
    let args: string[]

    if (process.env.CHROMIUM_EXEC_PATH) {
        // Explicit override always wins.
        executablePath = process.env.CHROMIUM_EXEC_PATH
        args = ['--no-sandbox', '--disable-setuid-sandbox']
    } else if (IS_SERVERLESS) {
        // Vercel / Lambda: use the downloaded serverless Chromium.
        executablePath = await chromium.executablePath(REMOTE_EXEC_PATH)
        args = chromium.args
    } else {
        // Local dev: use an installed Chrome/Edge.
        const local = findLocalBrowser()
        if (!local) {
            throw new Error(
                'No local Chrome/Edge found for PDF generation. Install Google Chrome, ' +
                'or set CHROMIUM_EXEC_PATH in .env.local to a Chrome/Edge executable path.',
            )
        }
        executablePath = local
        args = ['--no-sandbox', '--disable-setuid-sandbox']
    }

    const browser = await puppeteer.launch({ args, executablePath, headless: true })

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
