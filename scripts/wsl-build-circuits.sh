#!/usr/bin/env bash
# Збірка тільки рецептів Arcis — без ончейн-програми. Запускати з PowerShell:
#   wsl -d Ubuntu-24.04 -e bash /mnt/<диск>/<шлях>/GenoVault/scripts/wsl-build-circuits.sh
#
# З Git Bash не кликати — він перетворює /mnt/... на власний шлях.
#
# Окремий скрипт від `wsl-build.sh` навмисно: `arcium build` цілком тягне ще й
# `anchor build`, а він при кожній правці рецепта не потрібен і коштує хвилини.
# Артефакти лягають у `build/` — саме звідти їх читає і `#[arcium_program]`
# (генерує типи виходів), і `get_instruction` у тестах рецептів.
set -uo pipefail

PATH="$HOME/.arcium/bin:$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
export PATH
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/wsl-dirs.sh"
setup_target_dir "$REPO_DIR"

cd "$REPO_DIR" || exit 1

echo "репозиторій: $REPO_DIR"
echo "arcium:      $(arcium --version 2>/dev/null || echo 'немає')"
echo

arcium build --skip-program "$@"
status=$?

if [ "$status" -eq 0 ]; then
  echo
  echo "== вага контурів =="
  # `weight` — оцінка вартості прогону, яку рахує сам компілятор. Дивитись на
  # неї варто щоразу: рецепт легко зробити вдесятеро дорожчим, не помітивши.
  for weight in "$REPO_DIR"/build/*.weight; do
    [ -f "$weight" ] || continue
    name="$(basename "$weight" .weight)"
    printf '%-24s %s\n' "$name" \
      "$(sed -n 's/.*"weight":\([0-9]*\).*/\1/p' "$weight")"
  done
fi

exit "$status"
