#!/bin/sh
set -eu
cd "$(dirname "$0")"
: "${CONFIG_DIR:?Export CONFIG_DIR as an absolute private directory outside git}"
case "$CONFIG_DIR" in /*) ;; *) echo 'CONFIG_DIR must be absolute' >&2;exit 1;; esac
exec docker compose -f compose.yaml "$@"
