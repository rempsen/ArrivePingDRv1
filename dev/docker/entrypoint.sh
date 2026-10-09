#!/bin/sh
set -e

# Dependencies are installed by the `deps` service, which this service waits on
# via depends_on (service_completed_successfully) in compose.yaml.tftpl.

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
