#!/bin/bash
#
# WashTrack — daily mobile sync
# Pulls the latest web-app code from GitHub (what Lovable pushes) and re-syncs it
# into the native iOS/Android projects. Does NOT build a release or submit to the
# app stores — that stays a deliberate, tested step you run yourself.
#
set -uo pipefail

REPO="$HOME/Downloads/washtrack"
BRANCH="main"
LOG="$REPO/mobile-sync.log"

# launchd runs with a bare environment — make sure tool paths + node are found.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

log()    { echo "[$(date '+%F %T')] $1" >> "$LOG"; }
notify() { /usr/bin/osascript -e "display notification \"$2\" with title \"$1\"" >/dev/null 2>&1 || true; }

cd "$REPO" 2>/dev/null || { log "ERROR: repo not found at $REPO"; exit 1; }
command -v node >/dev/null 2>&1 || { log "ERROR: node not on PATH"; notify "WashTrack sync warning" "node not found - tell Claude your node path"; exit 1; }

log "===== sync run ====="

# Discard regenerated build artifacts so the merge stays clean (cap sync recreates them).
git checkout -- ios/App/App/public android/app/src/main/assets/public 2>/dev/null || true

git fetch origin "$BRANCH" >> "$LOG" 2>&1 || { log "ERROR: git fetch failed"; notify "WashTrack sync warning" "git fetch failed - check network/auth"; exit 1; }

if git merge-base --is-ancestor "origin/$BRANCH" HEAD 2>/dev/null; then
  log "already up to date - nothing new upstream"
  exit 0
fi

log "new upstream commits found - merging"
if ! git -c user.email="mobile-sync@washtrack.local" -c user.name="WashTrack Mobile Sync" \
        merge --no-edit "origin/$BRANCH" >> "$LOG" 2>&1; then
  git merge --abort 2>/dev/null || true
  log "MERGE CONFLICT - aborted, no changes applied"
  notify "WashTrack sync needs you" "Update needs a manual merge. Open the repo or ping Claude."
  exit 1
fi

log "merge OK - installing deps + syncing native projects"
npm install --no-audit --no-fund >> "$LOG" 2>&1
if ! npm run mobile:sync >> "$LOG" 2>&1; then
  log "ERROR: build/sync failed after merge"
  notify "WashTrack sync needs you" "Code merged but the build failed - check mobile-sync.log"
  exit 1
fi

log "SUCCESS - native projects updated to latest"
notify "WashTrack synced" "Lovable's latest is merged and synced. Ready to build and test."
