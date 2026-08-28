#!/usr/bin/env bash
# Спільний шар для збірки й локальної мережі: виносить робочі теки з /mnt/.
#
# Репозиторій лежить на диску Windows, змонтованому як v9fs. Це має два
# наслідки, і другий фатальний:
#
#  1. Кожен файловий доступ іде через 9p, тож збірка помітно повільніша.
#  2. **На v9fs не створюються unix-сокети.** solana-test-validator робить
#     `admin.rpc` у теці реєстру, і на /mnt/ це падає з
#     "Operation not supported". Anchor бачить лише наслідок — "Unable to
#     connect to validator: admin.rpc does not exist" — і повідомляє про
#     таймаут валідатора, хоча причина зовсім інша.
#
# Тому і target/, і .anchor/ у репозиторії — симлінки на теки у файловій
# системі WSL. Шляхи збігаються з тим, чого чекають anchor і arcium, а самі
# файли лежать там, де працюють сокети.
#
# Підключати через `. "$(dirname "${BASH_SOURCE[0]}")/wsl-dirs.sh"`.

_link_out_of_mnt() {
  local repo_dir="$1" name="$2" cache_dir="$3"

  mkdir -p "$cache_dir"

  if [ -L "$repo_dir/$name" ]; then
    return 0
  fi

  if [ -d "$repo_dir/$name" ]; then
    # Реальна тека від попередніх запусків. Ключі переносимо: keypair програми
    # дає право задеплоїти під той самий адрес. Наявні у призначенні файли не
    # чіпаємо — вони новіші за походженням.
    if [ -d "$repo_dir/$name/deploy" ]; then
      mkdir -p "$cache_dir/deploy"
      find "$repo_dir/$name/deploy" -maxdepth 1 -name '*.json' \
        -exec cp -n {} "$cache_dir/deploy/" \; 2>/dev/null
    fi
    rm -rf "$repo_dir/$name"
  fi

  ln -s "$cache_dir" "$repo_dir/$name"
}

setup_target_dir() {
  local repo_dir="$1"
  local cache_target="${GENOVAULT_TARGET:-$HOME/.cache/genovault/target}"
  _link_out_of_mnt "$repo_dir" target "$cache_target"
  export CARGO_TARGET_DIR="$cache_target"
}

setup_anchor_dir() {
  local repo_dir="$1"
  _link_out_of_mnt "$repo_dir" .anchor "${GENOVAULT_ANCHOR_DIR:-$HOME/.cache/genovault/.anchor}"
}
