#!/usr/bin/env bash
# Assembles the GitHub Pages site from the landing and the built app.
#
#   usage: scripts/assemble-pages.sh <app-base-path> <out-dir>
#   e.g.   scripts/assemble-pages.sh /GenoVault/app/ _site
#
# <app-base-path> is the BASE_PATH the app was built with; it must end in
# "app/". The site's base is that path without "app/": the landing goes there,
# `apps/web/dist` goes to <out-dir>/app. The landing's 404.html cannot use
# relative links (Pages serves it at any depth), so its __SITE_BASE__
# placeholder becomes the site's base path.
set -euo pipefail

app_base="${1:?app base path, e.g. /GenoVault/app/}"
out="${2:?output directory}"

case "$app_base" in
  */app/) ;;
  *) echo "app base path must end in /app/: got '$app_base'" >&2; exit 1 ;;
esac
site_base="${app_base%app/}"

if [ ! -f apps/web/dist/index.html ]; then
  echo "apps/web/dist/index.html is missing: build the app first" >&2
  exit 1
fi

rm -rf "$out"
mkdir -p "$out"
cp -r apps/landing/. "$out/"
cp -r apps/web/dist "$out/app"
sed -i "s#__SITE_BASE__#${site_base}#g" "$out/404.html"

if grep -q '__SITE_BASE__' "$out/404.html"; then
  echo "404.html still holds a placeholder" >&2
  exit 1
fi
echo "site base ${site_base}: landing at ${out}/, app at ${out}/app/"
