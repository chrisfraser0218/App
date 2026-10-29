#!/bin/sh
# Operate only the existing persistent FinSight cluster. Never initialize or reset data.
set -eu
finsight_base=${FINSIGHT_DATA_HOME:-"$HOME/Library/Application Support/FinSight AI"}
finsight_pg_bin=${FINSIGHT_PG_BIN:-/opt/homebrew/opt/postgresql@15/bin}
finsight_cluster="$finsight_base/postgres"
finsight_action=${1:-status}
if [ ! -x "$finsight_pg_bin/pg_ctl" ]; then
  echo 'PostgreSQL 15 tools not found. Set FINSIGHT_PG_BIN to the installed PostgreSQL 15 bin directory.' >&2
  exit 1
fi
if [ ! -f "$finsight_cluster/PG_VERSION" ]; then
  echo 'Existing persistent cluster not found. Refusing to initialize an empty replacement; follow the recovery guide.' >&2
  exit 1
fi
if [ "$(cat "$finsight_cluster/PG_VERSION")" != 15 ]; then
  echo 'Cluster major version does not match these PostgreSQL 15 tools. Refusing to start.' >&2
  exit 1
fi
case "$finsight_action" in
  status)
    "$finsight_pg_bin/pg_ctl" -D "$finsight_cluster" status
    ;;
  start)
    if "$finsight_pg_bin/pg_ctl" -D "$finsight_cluster" status >/dev/null 2>&1; then
      echo 'Persistent FinSight PostgreSQL is already running.'
    else
      "$finsight_pg_bin/pg_ctl" -D "$finsight_cluster" -l "$finsight_base/logs/startup.log" start
    fi
    ;;
  stop)
    # Do not interrupt an active backend or another local database client.
    finsight_clients=$("$finsight_pg_bin/psql" -X -v ON_ERROR_STOP=1 -h "$finsight_base/run" -p 55432 -d postgres -Atc "SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid();")
    if [ "$finsight_clients" != 0 ]; then
      echo 'Database clients are still connected. Stop the FinSight backend and other clients before stopping PostgreSQL.' >&2
      exit 1
    fi
    "$finsight_pg_bin/pg_ctl" -D "$finsight_cluster" stop -m fast
    ;;
  *)
    echo 'Usage: sh scripts/local-postgres.sh [status|start|stop]' >&2
    exit 2
    ;;
esac
