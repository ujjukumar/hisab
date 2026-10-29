# Hisaab handoff

Updated: 30 Oct 2026

## Current state

`master` holds all work. The live install is the VM `myvm`; the Raspberry Pi is not
used for Hisaab. The 29 Oct Refract redesign replaced the look throughout;
`DESIGN.md` holds the system and the stamps at the top of `styles/tokens.css` and
`styles/globals.css` record what it kept and waived.

## VM deployment

- Connect with `ssh ujju@myvm -i "C:\Users\ujju\.ssh\myvm_ssh_key.pem"` (Ubuntu
  26.04, x86_64). The app lives in `/home/ujju/hisaab`, a Git checkout of `master`
  from `origin`; `.env` and `data/` are kept outside version control there. Never copy
  local `data/`, `*.db*` or `.env*`.
- Runs as `hisaab.service` (`/etc/systemd/system/hisaab.service`) on `127.0.0.1:8787`
  with Node 24 from `/home/ujju/.local/opt/node24/bin`. Tailscale Serve proxies the
  tailnet-only URL `https://myvm.tail276cc3.ts.net` to that port. Do not change
  Tailscale Serve or `tailscaled`.
- `.env` sets `SMS_PAIRING_URL` and `SMS_ENCRYPTION_KEY`, so SMS imports are on. Keep
  the key: changing it makes queued SMS unreadable.
- To deploy, run `scripts/pull-and-deploy-on-linux.bash` on the VM. It runs
  `git pull --ff-only`, `npm ci`, `npm run build` with
  `DATABASE_PATH=$HOME/hisaab/data/finance.db` (the build backs up and migrates), then
  `sudo systemctl restart hisaab`. The build replaces the `.next` the service is
  serving, so restart straight after it, then check the URL.
- Development: `npx next dev -H 127.0.0.1 -p 3123` with `DATABASE_PATH` on a temporary
  copy of the seed. It writes to `.next/dev` and leaves the live build alone.
- Keep `.next/cache` between builds; a fresh build on the VM once failed to resolve
  the Google font files under Turbopack until a previous cache was present.
- Do not run `npm audit fix --force` without approval.
- Copies from 22 Oct are in `~/hisaab-old-20261022T061013Z` and
  `~/hisaab-data-backup-20261022T061013Z`.

## Privacy

Never inspect, quote or commit the owner's data. Use a temporary `DATABASE_PATH`
with the invented seed (check the Sample data pill) for UI checks.
