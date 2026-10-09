#!/usr/bin/env bash
# Local pre-push check: gitleaks over the full git history and the working tree,
# plus a grep for private network addresses and any extra patterns you keep
# outside the repo (EXTRA_PATTERNS_FILE: one extended regex per line).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
status=0

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks git --redact --no-banner . || status=1
  gitleaks dir --redact --no-banner . || status=1
else
  echo "gitleaks not found: install it from https://github.com/gitleaks/gitleaks/releases" >&2
  status=1
fi

# Private IPv4 ranges (RFC 1918 and the 100.64/10 shared range) in tracked files.
private_ip='\b(10\.[0-9]{1,3}|192\.168|172\.(1[6-9]|2[0-9]|3[01])|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7]))\.[0-9]{1,3}(\.[0-9]{1,3})?\b'
if git ls-files -z | xargs -0 grep -nIE "$private_ip" -- ; then
  echo "private IP address found (see above)" >&2
  status=1
fi

if [ -n "${EXTRA_PATTERNS_FILE:-}" ] && [ -f "$EXTRA_PATTERNS_FILE" ]; then
  if git ls-files -z | xargs -0 grep -nIiE -f "$EXTRA_PATTERNS_FILE" -- ; then
    echo "match from EXTRA_PATTERNS_FILE (see above)" >&2
    status=1
  fi
  # Commit messages and author data too.
  if git log --all --format='%an %ae %cn %ce %B' | grep -iE -f "$EXTRA_PATTERNS_FILE"; then
    echo "match in git history metadata" >&2
    status=1
  fi
fi

[ "$status" -eq 0 ] && echo "secret scan: clean"
exit "$status"
