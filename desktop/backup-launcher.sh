#!/bin/sh
# The existing backup-only job invokes this stable local payload; no server is started.
set -eu
finsight_runtime=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
export PYTHONHOME="$finsight_runtime/python/Python.framework/Versions/3.11"
export PYTHONPATH="$finsight_runtime/site-packages:$finsight_runtime/scripts"
export PYTHONNOUSERSITE=1
export PYTHONDONTWRITEBYTECODE=1
export FINSIGHT_PG_BIN="$finsight_runtime/postgres/bin"
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
exec "$PYTHONHOME/bin/python3.11" "$finsight_runtime/scripts/backup_manager.py" tick
