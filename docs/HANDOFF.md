# Hisaab handoff

Updated: 27 Oct 2026

## Current state

`master` holds all work. From 27 Oct 2026 the owner develops on the Raspberry Pi and
it is the live install; the owner's data was restored there from a backup through
Settings → Restore from backup. The UI polish from the 27 Oct Hallmark audit is done
(PLAN section 15); the stamp at the top of `styles/globals.css` records what it kept.

## Pi deployment

- `ujju@pi` (Debian 13, arm64). The app lives in `/home/ujju/repos/hisab`, a Git
  checkout of `master`; `.env` and `data/` are kept outside version control there.
  Never copy local `data/`, `*.db*` or `.env*`.
- Runs as `hisaab.service` (`/etc/systemd/system/hisaab.service`) on `127.0.0.1:8080`
  with Node 26 from nvm (`/home/ujju/.nvm/versions/node/v26.12.1`). Tailscale Serve
  proxies the tailnet-only URL `https://pi.tail276cc3.ts.net` to that port. Do not
  change Tailscale Serve or `tailscaled`.
- `.env` sets `SMS_PAIRING_URL=https://pi.tail276cc3.ts.net`. `SMS_ENCRYPTION_KEY` is
  empty, so SMS imports are off until the owner sets it (reuse the VM's key if pending
  SMS from the backup must stay readable), then pair the phone again.
- To deploy: `git pull` in the app folder, `npm ci`, `npm run build` with
  `DATABASE_PATH=/home/ujju/repos/hisab/data/finance.db` (the build backs up and
  migrates), then `sudo systemctl restart hisaab.service` and check the URL. The build
  replaces the `.next` the service is serving, so restart straight after it.
- Development: `npx next dev -H 127.0.0.1 -p 3123` with `DATABASE_PATH` on a temporary
  copy of the seed. It writes to `.next/dev` and leaves the live build alone.
- Keep `.next/cache` between builds; a fresh build on the VM once failed to resolve
  the Google font files under Turbopack until a previous cache was present.
- Chromium (`/usr/bin/chromium`) is installed for the Hallmark render checks.
- Do not run `npm audit fix --force` without approval.

## Earlier VM deployment

Until 27 Oct 2026 the live install was `ujju@myvm` in `/home/ujju/hisaab`
(`hisaab.service` on `127.0.0.1:8787`, `https://myvm.tail276cc3.ts.net`), with
copies from 22 Oct in `~/hisaab-old-20261022T061013Z` and
`~/hisaab-data-backup-20261022T061013Z`. Retire it once the owner is happy with the Pi,
so two copies of the data don't drift apart.

## Privacy

Never inspect, quote or commit the owner's data. Use a temporary `DATABASE_PATH`
with the invented seed (check the Sample data pill) for UI checks.
