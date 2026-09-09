#!/usr/bin/env bash
# Швидка перевірка компіляції ончейн-частини без SBF-збірки. Запускати з
# PowerShell:
#   wsl -d Ubuntu-24.04 -e bash /mnt/<диск>/<шлях>/GenoVault/scripts/wsl-check.sh
#
# `anchor build` тягне SBF-тулчейн і хвилини часу; поки правиться Rust, від
# нього потрібне тільки «чи компілюється». Вивід іде у файл цілком: прогрес
# cargo затирає рядки, і в фоновому лозі від причини падіння не лишається
# нічого.
set -uo pipefail

PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$HOME/.arcium/bin:$PATH"
export PATH

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/wsl-dirs.sh"
setup_target_dir "$REPO_DIR"

cd "$REPO_DIR" || exit 1

LOG="${CHECK_LOG:-$CARGO_TARGET_DIR/check.log}"
cargo check -p genovault --all-targets >"$LOG" 2>&1
status=$?
tail -n 120 "$LOG"
exit "$status"
