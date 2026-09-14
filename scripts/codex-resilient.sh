#!/bin/zsh

# Run a resumable Codex session with a bounded-memory recycle loop.
# This is a workaround for Codex CLI processes that retain tens of GB during
# long, tool-heavy sessions on macOS. It never manages Spooty processes.

set -u

script_dir=${0:A:h}
repo_dir=${CODEX_GUARD_WORKDIR:-${script_dir:h}}
session_id=${1:-${CODEX_GUARD_SESSION_ID:-}}
codex_bin=${CODEX_GUARD_CODEX_BIN:-$(command -v codex 2>/dev/null)}
warn_gb=${CODEX_GUARD_WARN_GB:-4}
restart_gb=${CODEX_GUARD_RESTART_GB:-8}
interval_sec=${CODEX_GUARD_INTERVAL_SEC:-10}
max_restart_attempts=${CODEX_GUARD_MAX_RESTARTS:-30}
log_file=${CODEX_GUARD_LOG:-${repo_dir}/data/codex-memory-guard.log}
restart_prompt=${CODEX_GUARD_RESTART_PROMPT:-Continue working toward the active goal. The Codex process was safely recycled by the memory guard; resume from durable state and do not restart or interrupt the live Spooty queues.}

if [[ -z ${session_id} ]]; then
  print -u2 "usage: $0 SESSION_ID"
  exit 64
fi

if [[ -z ${codex_bin} || ! -x ${codex_bin} ]]; then
  print -u2 "codex executable not found"
  exit 69
fi

mkdir -p ${log_file:h}

to_bytes() {
  local gb=$1
  awk -v gb=${gb} 'BEGIN { printf "%.0f", gb * 1024 * 1024 * 1024 }'
}

process_footprint_bytes() {
  local pid=$1
  /usr/bin/footprint -p ${pid} --noCategories --format bytes 2>/dev/null |
    awk '/phys_footprint:/ { print $2; exit }'
}

guard_log() {
  print -r -- "$(date '+%Y-%m-%dT%H:%M:%S%z') $*" >> ${log_file}
}

warn_bytes=$(to_bytes ${warn_gb})
restart_bytes=$(to_bytes ${restart_gb})
restart_marker=${repo_dir}/data/.codex-memory-restart
restart_attempts=0

trap '[[ -n ${child_pid:-} ]] && kill -TERM ${child_pid} 2>/dev/null; exit 130' INT TERM

while true; do
  rm -f ${restart_marker}
  guard_log "launch session=${session_id} warn_gb=${warn_gb} restart_gb=${restart_gb}"

  ${codex_bin} resume ${session_id} "${restart_prompt}" &
  child_pid=$!

  (
    warned=0
    sample_count=0
    while kill -0 ${child_pid} 2>/dev/null; do
      footprint_bytes=$(process_footprint_bytes ${child_pid})
      if [[ ${footprint_bytes} == <-> ]]; then
        (( sample_count++ ))
        if (( sample_count % 6 == 0 )); then
          footprint_mb=$(( footprint_bytes / 1024 / 1024 ))
          guard_log "sample pid=${child_pid} footprint_mb=${footprint_mb}"
        fi
        if (( ! warned && footprint_bytes >= warn_bytes )); then
          warned=1
          footprint_mb=$(( footprint_bytes / 1024 / 1024 ))
          guard_log "warning pid=${child_pid} footprint_mb=${footprint_mb}"
        fi
        if (( footprint_bytes >= restart_bytes )); then
          footprint_mb=$(( footprint_bytes / 1024 / 1024 ))
          guard_log "recycle pid=${child_pid} footprint_mb=${footprint_mb}"
          : > ${restart_marker}
          kill -TERM ${child_pid} 2>/dev/null
          for _ in {1..10}; do
            kill -0 ${child_pid} 2>/dev/null || exit 0
            sleep 1
          done
          kill -KILL ${child_pid} 2>/dev/null
          exit 0
        fi
      fi
      sleep ${interval_sec}
    done
  ) &
  monitor_pid=$!

  wait ${child_pid}
  child_status=$?
  kill ${monitor_pid} 2>/dev/null
  wait ${monitor_pid} 2>/dev/null
  child_pid=

  if [[ -f ${restart_marker} || ${child_status} -eq 137 || ${child_status} -eq 143 ]]; then
    restart_attempts=0
    guard_log "restart previous_status=${child_status}"
    sleep 3
    continue
  fi

  if (( child_status != 0 && restart_attempts < max_restart_attempts )); then
    (( restart_attempts++ ))
    retry_delay=$(( 3 + restart_attempts * 2 ))
    (( retry_delay > 30 )) && retry_delay=30
    guard_log "restart_unexpected status=${child_status} attempt=${restart_attempts}/${max_restart_attempts} delay_sec=${retry_delay}"
    sleep ${retry_delay}
    continue
  fi

  guard_log "stop status=${child_status}"
  exit ${child_status}
done
