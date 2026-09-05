#!/usr/bin/env bash
# Тести рецептів Arcis. Запускати з PowerShell:
#   wsl -d Ubuntu-24.04 -e bash /mnt/<диск>/<шлях>/GenoVault/scripts/wsl-test-circuits.sh
#
# З Git Bash не кликати — він перетворює /mnt/... на власний шлях.
#
# Тести виконують скомпільований контур (`build/<name>.arcis.ir`), а не функцію
# мовою Rust, тому збірка рецептів — не зручність, а передумова: без неї
# `get_instruction` не знайде IR і тест впаде на панікі, а не на асерті.
# Пропустити збірку — `SKIP_BUILD=1`.
set -uo pipefail

PATH="$HOME/.arcium/bin:$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
export PATH

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/wsl-dirs.sh"
setup_target_dir "$REPO_DIR"

cd "$REPO_DIR" || exit 1

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "== збірка рецептів =="
  "$REPO_DIR/scripts/wsl-build-circuits.sh" || exit 1
  echo
fi

echo "== тести рецептів =="
cargo test -p encrypted-ixs --tests "$@"
