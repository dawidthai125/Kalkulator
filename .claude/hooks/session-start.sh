#!/bin/bash
set -euo pipefail

# Tylko w sesjach chmurowych
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Marketplace'y i wtyczki zgodne z .claude/settings.json
claude plugin marketplace add obra/superpowers-marketplace || true
claude plugin marketplace add affaan-m/everything-claude-code || true

installed="$(claude plugin list 2>/dev/null || true)"
for p in superpowers@superpowers-marketplace ecc@ecc; do
  if ! grep -q "${p%@*}" <<<"$installed"; then
    claude plugin install "$p"
  fi
done
