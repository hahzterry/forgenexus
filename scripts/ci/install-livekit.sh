#!/usr/bin/env bash
set -euo pipefail
# Official LiveKit 1.13.10 linux/amd64 release; verify before extraction/execution.
install_dir="${RUNNER_TEMP:?}/forgenexus-livekit"
mkdir -p "$install_dir"
archive="$install_dir/livekit.tar.gz"
curl --fail --location --retry 3 --output "$archive" https://github.com/livekit/livekit/releases/download/v1.13.10/livekit_1.13.10_linux_amd64.tar.gz
printf '%s  %s\n' c25a3e45fb922e9a93c6443d10c0ed041ba64342097e38632331736630283165 "$archive" | sha256sum --check -
tar -xzf "$archive" -C "$install_dir" livekit-server
printf 'LIVEKIT_SERVER_PATH=%s/livekit-server\n' "$install_dir" >> "${GITHUB_ENV:?}"
