#!/usr/bin/env bash
# Установка тулчейну Arcium (arcup + arcium CLI + Arx node).
#
# Це виконання скрипта, завантаженого з мережі. Іншого способу немає: ані `arcup`,
# ані `arcium` не публікуються в crates.io чи npm — перевірено 2026-08-22. Тому
# крок свідомий і винесений в окремий файл, а не захований у ланцюжок команд.
#
# Передумови: Rust, Solana CLI 3.1.10, Anchor 1.0.2, Yarn, Docker із робочим
# демоном. Windows не підтримується — тільки WSL2. Перед запуском прожени
# scripts/check-toolchain.sh.
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

# Справжня перевірка системних пакетів.
#
# Вона тут тому, що власна перевірка інсталятора питає не про пакети, а про
# безпарольний sudo: `install_linux_deps` викликається безумовно і виходить із
# помилкою, навіть коли все давно встановлено. Ми перевіряємо наявність по суті
# і лише тоді знешкоджуємо ту функцію — тобто нічого не пропускаємо, а замінюємо
# грубу перевірку точною.
missing=()
for package in pkg-config build-essential libudev-dev libssl-dev; do
  dpkg -s "$package" >/dev/null 2>&1 || missing+=("$package")
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "Бракує системних пакетів: ${missing[*]}" >&2
  echo 'Постав їх власноруч, я не маю пароля sudo:' >&2
  echo "  sudo apt-get update && sudo apt-get install -y ${missing[*]}" >&2
  exit 1
fi

cd "$HOME" || exit 1

CACHE="$HOME/.cache/genovault"
INSTALLER="$CACHE/arcium-install.sh"
PATCHED="$CACHE/arcium-install.local.sh"
mkdir -p "$CACHE"

echo '== завантажую інсталятор'
curl --proto '=https' --tlsv1.2 -sSfL https://install.arcium.com/ -o "$INSTALLER" || exit 1

# Єдина правка: install_linux_deps стає пустою. Решта скрипта не змінюється, і
# оригінал лишається поруч для звірки.
sed 's/^install_linux_deps() {$/install_linux_deps() { return 0/' "$INSTALLER" > "$PATCHED"

if ! diff -q "$INSTALLER" "$PATCHED" >/dev/null; then
  echo '== знешкоджено install_linux_deps (пакети вже стоять):'
  diff "$INSTALLER" "$PATCHED" | head -6
else
  echo 'УВАГА: правка не застосувалась — інсталятор змінився, перевір його вручну' >&2
  exit 1
fi

echo '== запускаю'
bash "$PATCHED"
status=$?
if [ "$status" -ne 0 ]; then
  echo "Інсталятор завершився з кодом $status" >&2
  exit "$status"
fi

echo '== версії після установки:'
command -v arcup >/dev/null && arcup --version
command -v arcium >/dev/null && arcium --version
