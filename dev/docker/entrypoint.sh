#!/bin/sh
set -e

# Install from the workspace root so root-level deps resolve for packages/web.
(cd /repo && bun install)

# Postgres may still be starting; retry migrations briefly before giving up.
tries=0
until bun db:migrate; do
  tries=$((tries + 1))
  if [ "$tries" -ge 10 ]; then
    echo "db:migrate failed after $tries attempts" >&2
    exit 1
  fi
  sleep 3
done

if [ $# -gt 0 ]; then
  exec "$@"
else
  exec bun dev --host
fi
