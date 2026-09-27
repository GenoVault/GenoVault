#!/usr/bin/env bash
# A bare validator with GenoVault in genesis — no Arcium, no Docker.
#
# Run from PowerShell:
#   wsl -d Ubuntu-24.04 -e bash /mnt/<drive>/<path>/GenoVault/scripts/validator.sh
#
# This is the stand for measurements that stop before the MPC queue: the
# consent matrix (`T041`) orders runs and opens them, and neither needs a
# cluster. Everything that folds, reveals or settles needs `localnet.sh`.
#
# `GENOVAULT_SO` swaps the program binary. That is how the negative control of
# `SC-004` runs: the same matrix against a build with a check removed, on a
# validator that is otherwise identical. The default is the canonical artifact.
#
# The ledger starts empty on every run (`--reset`): the matrix seeds its own
# world, and a ledger left over from yesterday is state nobody measured.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/wsl-dirs.sh"
setup_target_dir "$REPO_DIR"

# The validator follows `solana_version` in Anchor.toml, not `active_release`:
# other projects switch the symlink, and 4.2.0 refuses the v0 artifact this
# repository builds.
SOLANA_VERSION="$(sed -n 's/^solana_version = "\(.*\)"/\1/p' "$REPO_DIR/Anchor.toml")"
RELEASE_BIN="$HOME/.local/share/solana/install/releases/$SOLANA_VERSION/solana-release/bin"
if [ ! -x "$RELEASE_BIN/solana-test-validator" ]; then
  echo "no solana-test-validator for $SOLANA_VERSION at $RELEASE_BIN" >&2
  exit 1
fi
PATH="$RELEASE_BIN:$PATH"
export PATH

PROGRAM_ID="$(sed -n 's/^genovault = "\(.*\)"/\1/p' "$REPO_DIR/Anchor.toml" | head -1)"
SO_PATH="${GENOVAULT_SO:-$CARGO_TARGET_DIR/deploy/genovault.so}"
if [ ! -f "$SO_PATH" ]; then
  echo "no program binary at $SO_PATH" >&2
  exit 1
fi

# Port 8899 is shared with `arcium localnet` and with other Arena projects.
if ss -ltn 2>/dev/null | grep -q ':8899 '; then
  echo 'port 8899 is taken — another local network is running; stop it first' >&2
  exit 1
fi

# The ledger lives in the WSL filesystem: on /mnt the admin socket cannot be
# created and the validator never reports ready.
LEDGER="${GENOVAULT_LEDGER:-$HOME/.cache/genovault/validator-ledger}"
mkdir -p "$(dirname "$LEDGER")"

echo "solana:  $SOLANA_VERSION"
echo "program: $PROGRAM_ID"
echo "binary:  $SO_PATH ($(sha256sum "$SO_PATH" | cut -c1-16))"
echo "ledger:  $LEDGER"
echo "RPC:     http://127.0.0.1:8899"
echo

exec solana-test-validator \
  --reset \
  --quiet \
  --ledger "$LEDGER" \
  --bpf-program "$PROGRAM_ID" "$SO_PATH"
