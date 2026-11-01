#!/bin/bash
set -euo pipefail

# Tylko w sesjach chmurowych
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Tryb asynchroniczny: sesja startuje od razu, hook działa w tle (limit 5 min).
# Musi to być pierwsza linia na stdout.
echo '{"async": true, "asyncTimeout": 300000}'

cd "${CLAUDE_PROJECT_DIR:-.}"

# Opcje wtyczki ecc@ecc (userConfig). Claude Code czyta pluginConfigs tylko
# z ustawień użytkownika, --settings lub zarządzanych, nie z ustawień projektu,
# więc dopisujemy je do ~/.claude/settings.json (merge, inne klucze zostają).
# Przed instalacją wtyczek, żeby install widział ustawione opcje.
node - "$HOME/.claude/settings.json" <<'JS'
const fs = require('fs');
const path = require('path');
const file = process.argv[2];
let s = {};
if (fs.existsSync(file)) {
  s = JSON.parse(fs.readFileSync(file, 'utf8')); // błędny JSON przerywa hook zamiast go nadpisać
}
const want = { hooks_enabled: true, hook_profile: 'standard' };
s.pluginConfigs = s.pluginConfigs || {};
const entry = (s.pluginConfigs['ecc@ecc'] = s.pluginConfigs['ecc@ecc'] || {});
const before = JSON.stringify(entry.options || {});
entry.options = { ...(entry.options || {}), ...want };
if (JSON.stringify(entry.options) !== before) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
}
JS

# Marketplace'y i wtyczki zgodne z .claude/settings.json
claude plugin marketplace add obra/superpowers-marketplace || true
claude plugin marketplace add affaan-m/everything-claude-code || true

installed="$(claude plugin list 2>/dev/null || true)"
for p in superpowers@superpowers-marketplace ecc@ecc; do
  if ! grep -q "${p%@*}" <<<"$installed"; then
    claude plugin install "$p"
  fi
done
