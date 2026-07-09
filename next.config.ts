import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (via pdfjs-dist) dynamically loads a separate worker script at
  // runtime — bundling it breaks that file resolution ("Setting up fake
  // worker failed", confirmed live). Keeping it external lets Node resolve
  // it normally instead.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
