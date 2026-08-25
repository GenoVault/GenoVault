#!/usr/bin/env bash
# Збірка ончейн-частини. Запускати з PowerShell:
#   wsl -d Ubuntu-24.04 -e bash /mnt/<диск>/<шлях>/GenoVault/scripts/wsl-build.sh
#
# З Git Bash не кликати — він перетворює /mnt/... на власний шлях і збірка
# не знаходить репозиторій.
set -uo pipefail

# PATH прописується тут навмисно: скрипт запускають як `bash scripts/...`, а
# такий шел не читає профіль, тож ані cargo, ані solana в ньому немає.
PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$HOME/.arcium/bin:$PATH"
export PATH
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Тека збірки й реєстр cargo виносяться з /mnt/ у файлову систему WSL. На /mnt/
# кожен файловий доступ іде через 9p, і збірка сповільнюється на порядок.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cache/genovault/target}"
mkdir -p "$CARGO_TARGET_DIR"

cd "$REPO_DIR" || exit 1

echo "репозиторій:  $REPO_DIR"
echo "target:       $CARGO_TARGET_DIR"
echo "anchor:       $(anchor --version 2>/dev/null || echo 'немає')"
echo "solana:       $(solana --version 2>/dev/null || echo 'немає')"
echo

anchor build "$@"
status=$?

if [ "$status" -eq 0 ]; then
  echo
  echo "артефакт: $CARGO_TARGET_DIR/deploy/genovault.so"
fi
exit "$status"
