#!/bin/sh
# Rebuild this homebrew copy only. No network, original source or commercial ROM.
set -eu
homebrew_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# Native mode is the tested route; N64_INST names the isolated toolchain prefix.
if [ -n "${N64_INST:-}" ]; then
  if [ ! -r "$N64_INST/include/n64.mk" ] || [ ! -x "$N64_INST/bin/mips64-elf-gcc" ]; then
    echo 'N64_INST ne contient pas une installation libdragon complète.' >&2
    exit 2
  fi
  cd "$homebrew_dir"
  exec make all
fi
# Optional Docker route is not validated in this delivery (GHCR pull denied).
image_lock="$homebrew_dir/libdragon-image.txt"
if [ ! -s "$image_lock" ]; then
  echo 'Définir N64_INST vers le préfixe natif préparé. Docker optionnel exige libdragon-image.txt @sha256 vérifié.' >&2
  exit 2
fi
libdragon_image=$(cat "$image_lock")
case "$libdragon_image" in
  *@sha256:*) ;;
  *) echo 'Refus de construire depuis un tag non figé.' >&2; exit 2 ;;
esac
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
  docker --host=unix:///var/run/docker.sock run --rm --network none \
  --user "$(id -u):$(id -g)" --entrypoint /bin/sh \
  --mount "type=bind,src=$homebrew_dir,dst=/work" --workdir /work \
  "$libdragon_image" -c 'make all'
