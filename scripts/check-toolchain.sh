#!/usr/bin/env bash
# Перевірка тулчейну GenoVault. Запускати всередині Linux-оточення (WSL).
#
# Скрипт нічого не встановлює і нічого не змінює — тільки повідомляє стан.
# Виходить із кодом 1, якщо бракує чогось, без чого не збереться ончейн-частина
# або не підніметься MPC-кластер.
set -uo pipefail

# PATH прописуємо тут, а не покладаємось на профіль: скрипт має однаково
# працювати і з логін-шелу, і коли його кличуть як `bash scripts/...` із
# PowerShell — а в другому випадку ~/.bashrc не читається взагалі.
PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.arcium/bin:$HOME/.avm/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
export PATH

# node і yarn стоять через nvm, а він живе виключно у функції з профілю.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1

ANCHOR_REQUIRED='1.0.2'   # arcium-anchor 0.14.1 залежить від anchor-lang =1.0.2
RUST_REQUIRED='1.97.1'
SOLANA_REQUIRED='3.1.10'  # версія, яку називає інсталятор Arcium як передумову

fail=0
warn=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail + 1)); }
soft() { printf '  \033[33m!\033[0m %s\n' "$1"; warn=$((warn + 1)); }

version_of() { "$@" 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1; }

echo
echo '── Rust ──'
if command -v rustc >/dev/null; then
  v=$(version_of rustc --version)
  [ "$v" = "$RUST_REQUIRED" ] && ok "rustc $v" || soft "rustc $v — очікувався $RUST_REQUIRED (rust-toolchain.toml підтягне потрібний)"
else
  bad 'rustc не знайдено'
fi
command -v cargo >/dev/null && ok "cargo $(version_of cargo --version)" || bad 'cargo не знайдено'

echo
echo '── Solana ──'
if command -v solana >/dev/null; then
  v=$(version_of solana --version)
  if [ "$v" = "$SOLANA_REQUIRED" ]; then
    ok "solana $v"
  else
    # Arcium збирався проти 3.1.10; anchor-cli 1.0.2 теж тягне solana-* 3.1.10.
    # Розходження мажора тут — не косметика, а різні крейти під тим самим іменем.
    bad "solana $v — Arcium очікує $SOLANA_REQUIRED"
  fi
else
  bad 'solana CLI не знайдено'
fi
command -v cargo-build-sbf >/dev/null && ok 'cargo-build-sbf' || soft 'cargo-build-sbf не в PATH — scripts/wsl-build.sh прописує його сам'

echo
echo '── Anchor ──'
if command -v anchor >/dev/null; then
  v=$(version_of anchor --version)
  if [ "$v" = "$ANCHOR_REQUIRED" ]; then
    ok "anchor $v"
  else
    bad "anchor $v — потрібен рівно $ANCHOR_REQUIRED (arcium-anchor 0.14.1 пінить anchor-lang =$ANCHOR_REQUIRED точною рівністю)"
  fi
else
  bad "anchor CLI не знайдено — потрібен $ANCHOR_REQUIRED"
fi
command -v avm >/dev/null && ok "avm є — перемикання версій без переустановки" || soft 'avm не знайдено'

echo
echo '── Docker ──'
# MPC-вузли Arcium піднімаються контейнерами. Без доступу до демона з ЦЬОГО
# дистрибутива не виконується FR-014a, а SC-001/002/003 нічим міряти.
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  ok "docker $(version_of docker --version), демон відповідає"
elif [ -S /mnt/wsl/docker-desktop/shared-sockets/guest-services/docker.proxy.sock ]; then
  bad 'Docker Desktop працює, але інтеграція з цим дистрибутивом вимкнена — Settings → Resources → WSL Integration'
else
  bad 'docker недоступний — MPC-кластер не підніметься'
fi

echo
echo '── Arcium ──'
command -v arcup >/dev/null && ok "arcup $(version_of arcup --version)" || bad 'arcup не знайдено — менеджер версій Arcium'
if command -v arcium >/dev/null; then
  v=$(version_of arcium --version)
  case "$v" in
    0.14.*) ok "arcium $v" ;;
    *)      bad "arcium $v — очікувалась гілка 0.14.x під arcium-anchor 0.14.1" ;;
  esac
else
  bad 'arcium CLI не знайдено'
fi

echo
echo '── Node ──'
# Yarn потрібен інсталятору Arcium і його шаблонам проектів.
yarn_v=$(version_of yarn --version)
[ -n "$yarn_v" ] && ok "yarn $yarn_v" || bad 'yarn не знайдено — його вимагає інсталятор Arcium'
command -v node >/dev/null && ok "node $(version_of node --version)" || bad 'node не знайдено'
# Порожня версія = це Windows-шим, підхоплений через interop, а не робочий бінар.
pnpm_v=$(version_of pnpm --version)
if [ -n "$pnpm_v" ]; then
  ok "pnpm $pnpm_v"
else
  soft 'pnpm недоступний у WSL — TS-частина живе на боці Windows, це нормально'
fi

echo
if [ "$fail" -gt 0 ]; then
  printf '\033[31mНе готово: %d критичних, %d попереджень.\033[0m\n\n' "$fail" "$warn"
  exit 1
fi
printf '\033[32mТулчейн готовий'; [ "$warn" -gt 0 ] && printf ' (%d попереджень)' "$warn"; printf '.\033[0m\n\n'
