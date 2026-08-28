#!/usr/bin/env bash
# Локальна мережа GenoVault: валідатор + MPC-кластер Arcium однією командою.
# Запускати з PowerShell:
#   wsl -d Ubuntu-24.04 -e bash /mnt/<диск>/<шлях>/GenoVault/scripts/localnet.sh
#
# Зупинити — Ctrl+C. Кластер тримається на передньому плані навмисно: фонові
# валідатори переживають сесію й потім мовчки конфліктують портами.
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
setup_anchor_dir "$REPO_DIR"

cd "$REPO_DIR" || exit 1

# Порт 8899 не налаштовується. arcium localnet зашиває host.docker.internal:8899
# у конфіги ARX-вузлів і rpc_port з Anchor.toml ігнорує. Якщо порт зайнятий
# чужою локальною мережею, вузли підключаються ДО НЕЇ і падають з
# AccountNotFound — це виглядає як поламаний кластер, хоча це конфлікт портів.
if ss -ltn 2>/dev/null | grep -q ':8899'; then
  echo 'Порт 8899 зайнятий. Найімовірніше — локальна мережа іншого проекту.' >&2
  echo 'Дві локальні мережі одночасно не працюють; зупини ту, що не потрібна:' >&2
  echo '  pkill -f solana-test-validator' >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo 'Docker недоступний — MPC-вузли не піднімуться.' >&2
  echo 'Docker Desktop → Settings → Resources → WSL Integration → Ubuntu-24.04' >&2
  exit 1
fi

echo "репозиторій: $REPO_DIR"
echo "target:      $CARGO_TARGET_DIR"
echo "RPC:         http://127.0.0.1:8899"
echo

exec arcium localnet "$@"
