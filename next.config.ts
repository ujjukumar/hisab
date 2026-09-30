import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module; Next must not try to bundle it.
  serverExternalPackages: ['better-sqlite3'],
  // CLAUDE.md is written by hand from docs/PLAN.md, so Next must not generate it.
  agentRules: false,
  // Restore from backup uploads the whole .db file through a server action (1 MB by default).
  experimental: { serverActions: { bodySizeLimit: '200mb' } },
};

export default nextConfig;
