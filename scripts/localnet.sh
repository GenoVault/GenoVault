#!/usr/bin/env bash
# Локальна мережа GenoVault. Запускати з PowerShell:
#   wsl -d Ubuntu-24.04 -e bash /mnt/<диск>/<шлях>/GenoVault/scripts/localnet.sh
#
# Зупинити — Ctrl+C. Валідатор тримається на передньому плані навмисно: фонові
# валідатори переживають сесію й потім мовчки конфліктують портами з наступним
# запуском, і на це вже пішов час.
set -uo pipefail

PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$HOME/.arcium/bin:$PATH"
export PATH

# Порти нетипові навмисно. На цій машині вже працює локальний валідатор іншого
# проекту на 8899/9900/8000, і на типових портах ми б мовчки під'єднались до
# ЧУЖОЇ мережі замість своєї — програма просто «не знаходилась» би.
RPC_PORT=8909
FAUCET_PORT=9910
GOSSIP_PORT=8030
DYNAMIC_PORTS='8031-8060'

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cache/genovault/target}"
LEDGER="${GENOVAULT_LEDGER:-$HOME/.cache/genovault/ledger}"
PROGRAM_SO="$TARGET_DIR/deploy/genovault.so"

PROGRAM_ID="$(grep -oE 'declare_id!\("[^"]+"\)' "$REPO_DIR/programs/genovault/src/lib.rs" \
  | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}')"

if [ ! -f "$PROGRAM_SO" ]; then
  echo "немає $PROGRAM_SO — спершу scripts/wsl-build.sh" >&2
  exit 1
fi

# Реєстр поза /mnt/: там кожен файловий доступ іде через 9p, і валідатор,
# який пише блоки безперервно, стає непридатно повільним.
rm -rf "$LEDGER"
mkdir -p "$LEDGER"

echo "програма:  $PROGRAM_ID"
echo "RPC:       http://127.0.0.1:$RPC_PORT"
echo "реєстр:    $LEDGER"
echo

# Програма кладеться в генезис, а не деплоїться окремо: не потрібен ані фандинг
# гаманця, ані очікування підтверджень, і мережа одразу стартує з нею.
# --bind-address не задаємо: з ним валідатор слухає, але localhost віддає чуже.
exec solana-test-validator \
  --ledger "$LEDGER" \
  --rpc-port "$RPC_PORT" \
  --faucet-port "$FAUCET_PORT" \
  --gossip-port "$GOSSIP_PORT" \
  --dynamic-port-range "$DYNAMIC_PORTS" \
  --bpf-program "$PROGRAM_ID" "$PROGRAM_SO" \
  --reset
