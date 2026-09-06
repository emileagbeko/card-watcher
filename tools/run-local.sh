#!/bin/sh
# Mac half of the watcher: runs the browser-based Topps catalog check (needs
# real headed Chrome + a residential IP to pass Cloudflare, so it can't live in
# GitHub Actions) and pushes its state, which triggers a status-page rebuild.
# Cron this every 30-60 min; it exits quietly when there's nothing to push.
set -e
cd "$(dirname "$0")/.."

git pull --rebase --quiet
node watcher.js --targets topps-catalog

git add state
if ! git diff --cached --quiet; then
  git commit -qm "state: topps-catalog $(date -u '+%Y-%m-%d %H:%M')"
  git pull --rebase --quiet
  git push --quiet
fi
