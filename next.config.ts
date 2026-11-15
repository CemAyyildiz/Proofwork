import type { NextConfig } from "next";
import { NETWORKS, parseNetwork } from "./src/config/network";

/**
 * Hosts the browser talks to, for the network this build is for: Horizon for
 * wallet reads and trustlines, the Soroban RPC for sealed reviews. Friendbot
 * exists on testnet only.
 */
const facts = NETWORKS[parseNetwork(process.env.NEXT_PUBLIC_STELLAR_NETWORK)];
const STELLAR_HOSTS =
  facts.network === "mainnet"
    ? [facts.horizonUrl, "https://mainnet.sorobanrpc.com"]
    : [facts.horizonUrl, "https://soroban-testnet.stellar.org", "https://dev.api.trustlesswork.com", "https://friendbot.stellar.org"];

const csp = [
  "default-src 'self'",
  // Next.js dev needs inline/eval; production build strips them via nonces later if needed.
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  `connect-src 'self' ${STELLAR_HOSTS.join(" ")} wss://*.walletconnect.com https://*.walletconnect.com`,
  "frame-src 'self' https://*.walletconnect.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
