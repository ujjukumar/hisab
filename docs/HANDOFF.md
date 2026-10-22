# Hisaab handoff

Updated: 22 Oct 2026

## Current state

`master` holds all work, including the investment chart changes (smooth lines,
rupee value, range gain split into booked/dividends/on paper, automatic benchmark
history from mfapi.in, and dragging a range to open it on the Performance tab).
From 22 Oct 2026 the owner works directly on the VM; the Windows checkout is no
longer the main copy.

## VM deployment

- `ujju@myvm` (Ubuntu), reachable with the owner's SSH key. The app lives in
  `/home/ujju/hisaab` as a clean Git checkout of `master`; `.env` and `data/` are
  kept outside version control there. Never copy local `data/`, `*.db*` or `.env*`.
- Runs as `hisaab.service` on `127.0.0.1:8787` with Node 24 from
  `/home/ujju/.local/opt/node24`; system Node is untouched. Tailscale Serve proxies
  the tailnet-only URL `https://myvm.tail276cc3.ts.net` to that port. Do not change
  Tailscale Serve, `tailscaled` or `ac-daemon.service`.
- To deploy: `git pull` in the app folder, `npm ci`, `npm run build` with
  `DATABASE_PATH=/home/ujju/hisaab/data/finance.db` (the build backs up and
  migrates), then `sudo systemctl restart hisaab.service` and check the URL.
- A fresh build on the VM failed to resolve the Google font files under Turbopack;
  it succeeded once `.next/cache` from a previous build was present. Keep
  `.next/cache` between builds (`git pull` does not touch it).
- The pre-checkout folder and a copy of `data/` from 22 Oct are in
  `~/hisaab-old-20261022T061013Z` and `~/hisaab-data-backup-20261022T061013Z`;
  remove them once the owner is happy.
- `HISAAB_PRICE_DEBUG=1` in the service environment logs price lookups to the journal.
- Do not run `npm audit fix --force` without approval.

## Privacy

Never inspect, quote or commit the owner's data. Use a temporary `DATABASE_PATH`
with the invented seed (check the Sample data pill) for UI checks.
