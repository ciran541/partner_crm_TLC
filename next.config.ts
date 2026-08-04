import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Pragmatic CSP: Next.js (RSC hydration payloads) and app/layout.tsx's own
// service-worker-registration snippet both rely on inline <script> tags, so
// script-src needs 'unsafe-inline' — a strict nonce-based CSP would require
// per-request nonce injection via middleware, a much bigger change. This
// still blocks the common case (loading a script/style/image/connection
// from an attacker-controlled origin) by restricting every source list to
// 'self' plus the specific external hosts this app actually uses.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// The browser SDK POSTs events to Sentry's ingest host, which connect-src must
// allow or the browser refuses the request outright — errors are captured by the
// SDK and then silently dropped, with nothing visible except a console warning
// nobody is watching in production. That was the state of this app until now.
//
// Derived from the DSN rather than hardcoded so the two can never drift: the
// ingest origin IS the DSN's origin (https://oXXXX.ingest.<region>.sentry.io).
// A missing or malformed DSN just leaves the directive unchanged.
let sentryIngestOrigin = "";
try {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (dsn) sentryIngestOrigin = new URL(dsn).origin;
} catch {
  console.warn("[csp] NEXT_PUBLIC_SENTRY_DSN is not a valid URL — Sentry ingest not added to connect-src");
}
// React's dev-mode debugging (stack-trace reconstruction) needs eval() —
// harmless to allow only in development since React never uses eval() in
// production (confirmed via the browser's own console warning without this).
const scriptSrc = process.env.NODE_ENV === "production"
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
const csp = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://theloanconnection.com.sg",
  "font-src 'self' data:",
  `connect-src ${["'self'", supabaseUrl, sentryIngestOrigin].filter(Boolean).join(" ")}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // pdf-parse (via pdfjs-dist) dynamically loads a separate worker script at
  // runtime — bundling it breaks that file resolution ("Setting up fake
  // worker failed", confirmed live). Keeping it external lets Node resolve
  // it normally instead.
  //
  // @napi-rs/canvas supplies the DOM globals pdfjs-dist expects (DOMMatrix,
  // ImageData, Path2D), which Node does not have. Without it pdf-parse throws
  // "DOMMatrix is not defined" at load on Vercel and every PDF read silently
  // falls through to Gemini — confirmed in production logs, and it had been
  // degrading Banks' Insights the same way. It is a native module, so it must
  // stay external too: bundling a .node binary breaks its resolution.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],

  // Installing @napi-rs/canvas is not enough on Vercel. pdfjs-dist require()s
  // it dynamically inside a try/catch, so Next's output file tracing never sees
  // a static import to follow and leaves it out of the deployed function —
  // producing "Cannot find module '@napi-rs/canvas'" from
  // /var/task/node_modules at runtime even though it is in package.json.
  // Force-include it for every route that reads a PDF. The glob covers the
  // whole @napi-rs scope on purpose: the platform binary installs as its OWN
  // package (@napi-rs/canvas-linux-x64-gnu on Vercel), so including only
  // @napi-rs/canvas would ship the wrapper without the .node it loads.
  //
  // pdfjs-dist/legacy/build is here for the same reason, one file over: pdfjs
  // loads pdf.worker.mjs by PATH at runtime rather than importing it, so the
  // tracer never sees it either. With canvas fixed, production then failed on
  // "Setting up fake worker failed: Cannot find module .../pdf.worker.mjs" —
  // the same class of miss. Scoped to legacy/build (what pdf-parse v2 uses)
  // rather than the whole package, to keep the function small; if a CJK PDF
  // ever fails on missing character maps, cmaps/ would need adding too.
  outputFileTracingIncludes: {
    "/api/insurance/cases/extract-lo": ["./node_modules/@napi-rs/**", "./node_modules/pdfjs-dist/legacy/build/**"],
    "/api/property/cases/extract-lo": ["./node_modules/@napi-rs/**", "./node_modules/pdfjs-dist/legacy/build/**"],
    "/api/cron/bank-intelligence": ["./node_modules/@napi-rs/**", "./node_modules/pdfjs-dist/legacy/build/**"],
    "/api/admin/insurance/bank-intelligence": ["./node_modules/@napi-rs/**", "./node_modules/pdfjs-dist/legacy/build/**"],
    "/api/admin/insurance/bank-intelligence/refresh": ["./node_modules/@napi-rs/**", "./node_modules/pdfjs-dist/legacy/build/**"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

// Source-map upload turns a minified production stack trace ("a.f is not a
// function" at bundle-3f2a.js:1:48210) into real file names and line numbers.
// Sentry.init() in instrumentation.ts/instrumentation-client.ts reports errors
// either way; this is purely about them being readable.
//
// Gated on SENTRY_AUTH_TOKEN rather than switched on outright: a local `npm run
// build` has no token and must not fail because of it. Set the token in Vercel
// and production builds start uploading; leave it unset anywhere else and the
// build behaves exactly as before.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

export default withSentryConfig(nextConfig, {
    silent: true,
    // Slugs, not secrets — they appear in the Sentry dashboard URL. Defaulted
    // here so the only thing that has to be configured in Vercel is the token.
    org: process.env.SENTRY_ORG ?? 'the-loan-connection',
    project: process.env.SENTRY_PROJECT ?? 'javascript-nextjs',
    authToken: sentryAuthToken,
    // Deliberately NOT pinned to a region. This org's data lives on Sentry's EU
    // instance, but an `sntrys_…` org token already carries its own region_url
    // and sentry-cli reads it — hardcoding de.sentry.io here would override the
    // token's own auth URL and can fail authentication instead of fixing it.
    // SENTRY_URL stays available as an escape hatch if upload ever 404s.
    sentryUrl: process.env.SENTRY_URL,
    sourcemaps: {
        disable: !sentryAuthToken,
        // Upload the maps to Sentry, then delete them from the build output.
        // Without this they are served publicly alongside the bundles and
        // anyone can reconstruct the entire source of the app.
        deleteSourcemapsAfterUpload: true,
    },
});
