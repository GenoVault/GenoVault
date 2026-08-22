#!/usr/bin/env bash
# Установка тулчейну Arcium (arcup + arcium CLI + Arx node).
#
# Це виконання скрипта, завантаженого з мережі. Іншого способу немає: ані `arcup`,
# ані `arcium` не публікуються в crates.io чи npm — перевірено 2026-08-22. Тому
# крок свідомий і винесений в окремий файл, а не захований у ланцюжок команд.
#
# Передумови (їх перевіряє і сам інсталятор): Rust, Solana CLI 3.1.10,
# Anchor 1.0.2, Yarn, Docker із робочим демоном. Windows не підтримується —
# тільки WSL2. Перед запуском прожени scripts/check-toolchain.sh.
set -uo pipefail

PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.arcium/bin:$HOME/.avm/bin:$PATH"
export PATH
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1

if ! docker info >/dev/null 2>&1; then
  echo 'Docker недоступний. Інсталятор Arcium його вимагає — спершу ввімкни' >&2
  echo 'WSL Integration для цього дистрибутива в Docker Desktop.' >&2
  exit 1
fi

# Запускати з домашньої теки, а не з репозиторію на /mnt/: інсталятор пише
# тимчасові файли, і на /mnt/ це і повільно, і з чужими правами.
cd "$HOME" || exit 1

echo '== завантажую й запускаю інсталятор Arcium'
curl --proto '=https' --tlsv1.2 -sSfL https://install.arcium.com/ | bash
status=$?
if [ "$status" -ne 0 ]; then
  echo "Інсталятор завершився з кодом $status" >&2
  exit "$status"
fi

echo '== версії після установки:'
command -v arcup >/dev/null && arcup --version
command -v arcium >/dev/null && arcium --version
