#!/bin/sh
# Resolve symlinks to find the real script location
SCRIPT="$0"
while [ -L "$SCRIPT" ]; do
  DIR="$(cd -P "$(dirname "$SCRIPT")" && pwd)"
  SCRIPT="$(readlink "$SCRIPT")"
  case "$SCRIPT" in /*) ;; *) SCRIPT="$DIR/$SCRIPT" ;; esac
done
DIR="$(cd -P "$(dirname "$SCRIPT")" && pwd)"

exec node "$DIR/../server/index.js" "$@"
