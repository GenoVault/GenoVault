#!/usr/bin/env bash
# Тести ончейн-програми на mollusk-svm. Запускати з PowerShell:
#   wsl -d Ubuntu-24.04 -e bash /mnt/<диск>/<шлях>/GenoVault/scripts/wsl-test-program.sh
#
# З Git Bash не кликати — він перетворює /mnt/... на власний шлях.
#
# Mollusk виконує вже зібраний `genovault.so`, а не хост-збірку крейта. Тому
# перед тестами потрібен `anchor build`: інакше стенд або не знайде програму,
# або прожене вчорашню. Пропустити збірку — `SKIP_BUILD=1`.
set -uo pipefail

# PATH прописується тут навмисно: скрипт запускають як `bash scripts/...`, а
# такий шел не читає профіль, тож ані cargo, ані solana в ньому немає.
PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$HOME/.arcium/bin:$PATH"
export PATH

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/wsl-dirs.sh"
setup_target_dir "$REPO_DIR"

cd "$REPO_DIR" || exit 1

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "== збірка SBF =="
  anchor build || exit 1
  echo
fi

SO_PATH="$CARGO_TARGET_DIR/deploy/genovault.so"
if [ ! -f "$SO_PATH" ]; then
  echo "немає $SO_PATH — спершу прожени збірку без SKIP_BUILD=1" >&2
  exit 1
fi

# Mollusk шукає програму саме тут.
export SBF_OUT_DIR="$CARGO_TARGET_DIR/deploy"

echo "== тести програми =="
echo "програма: $SO_PATH"
cargo test -p genovault --tests "$@"
