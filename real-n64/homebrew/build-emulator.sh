#!/bin/sh
# Experimental emulator-only bootstrap; no physical N64 compatibility claim.
set -eu
homebrew_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -z "${N64_INST:-}" ] || [ ! -r "$N64_INST/include/n64.mk" ]; then
  echo 'Définir N64_INST vers le préfixe libdragon natif préparé.' >&2
  exit 2
fi
make -C "$homebrew_dir/emulator-boot" all
make -C "$homebrew_dir" -f Makefile.emulator all
