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
  `connect-src 'self' ${supabaseUrl}`,
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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

// Source-map upload needs SENTRY_ORG/SENTRY_PROJECT/SENTRY_AUTH_TOKEN, which
// aren't set up yet — disabled for now so the build never depends on them.
// Sentry.init() in instrumentation.ts/instrumentation-client.ts still
// captures and reports errors regardless.
export default withSentryConfig(nextConfig, {
    silent: true,
    sourcemaps: { disable: true },
});
