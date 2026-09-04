#!/usr/bin/env bash
# Перепис вендореного IDL із target/types. Запускати з PowerShell:
#   wsl -d Ubuntu-24.04 -e bash /mnt/<диск>/<шлях>/GenoVault/scripts/wsl-sync-idl.sh
#
# Чому з WSL: `target/` — симлінк на ext4, і з Windows він не читається взагалі.
# З Git Bash не кликати — він перетворює /mnt/... на власний шлях.
set -uo pipefail

# PATH прописується тут навмисно: `bash scripts/...` не читає профіль.
PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$HOME/.arcium/bin:$PATH"
export PATH
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TYPES="$REPO_DIR/target/types/genovault.ts"

if [ ! -f "$TYPES" ]; then
  echo "немає $TYPES — спершу scripts/wsl-build.sh" >&2
  exit 1
fi

node "$REPO_DIR/scripts/sync-idl.mjs" --from "$TYPES"
