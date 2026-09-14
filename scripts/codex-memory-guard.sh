#!/bin/zsh

# Guard an already-running Codex process. If it crosses the configured memory
# ceiling, hand the session to codex-resilient.sh in a detached tmux session.

set -u

script_dir=${0:A:h}
repo_dir=${CODEX_GUARD_WORKDIR:-${script_dir:h}}
session_id=${1:-${CODEX_GUARD_SESSION_ID:-}}
target_pid=${CODEX_GUARD_PID:-}
warn_gb=${CODEX_GUARD_WARN_GB:-4}
restart_gb=${CODEX_GUARD_RESTART_GB:-8}
interval_sec=${CODEX_GUARD_INTERVAL_SEC:-10}
tmux_name=${CODEX_GUARD_TMUX_NAME:-spooty-codex-resilient}
log_file=${CODEX_GUARD_LOG:-${repo_dir}/data/codex-memory-guard.log}

if [[ -z ${session_id} ]]; then
  print -u2 "usage: $0 SESSION_ID [PID]"
  exit 64
fi

if [[ $# -ge 2 ]]; then
  target_pid=$2
fi

if [[ -z ${target_pid} ]]; then
  target_pid=$(ps -axo pid=,comm= | awk '$2 == "codex" { print $1 }' | tail -1)
fi

if [[ ${target_pid} != <-> ]] || ! kill -0 ${target_pid} 2>/dev/null; then
  print -u2 "no live Codex PID found"
  exit 69
fi

mkdir -p ${log_file:h}

to_bytes() {
  local gb=$1
  awk -v gb=${gb} 'BEGIN { printf "%.0f", gb * 1024 * 1024 * 1024 }'
}

process_footprint_bytes() {
  /usr/bin/footprint -p $1 --noCategories --format bytes 2>/dev/null |
    awk '/phys_footprint:/ { print $2; exit }'
}

guard_log() {
  print -r -- "$(date '+%Y-%m-%dT%H:%M:%S%z') $*" >> ${log_file}
}

warn_bytes=$(to_bytes ${warn_gb})
restart_bytes=$(to_bytes ${restart_gb})
warned=0
sample_count=0

guard_log "attach pid=${target_pid} session=${session_id} warn_gb=${warn_gb} restart_gb=${restart_gb}"

while kill -0 ${target_pid} 2>/dev/null; do
  footprint_bytes=$(process_footprint_bytes ${target_pid})
  if [[ ${footprint_bytes} == <-> ]]; then
    (( sample_count++ ))
    if (( sample_count % 6 == 0 )); then
      footprint_mb=$(( footprint_bytes / 1024 / 1024 ))
      guard_log "sample pid=${target_pid} footprint_mb=${footprint_mb}"
    fi
    if (( ! warned && footprint_bytes >= warn_bytes )); then
      warned=1
      footprint_mb=$(( footprint_bytes / 1024 / 1024 ))
      guard_log "warning pid=${target_pid} footprint_mb=${footprint_mb}"
    fi
    if (( footprint_bytes >= restart_bytes )); then
      footprint_mb=$(( footprint_bytes / 1024 / 1024 ))
      guard_log "handoff pid=${target_pid} footprint_mb=${footprint_mb} tmux=${tmux_name}"
      kill -TERM ${target_pid} 2>/dev/null
      for _ in {1..10}; do
        kill -0 ${target_pid} 2>/dev/null || break
        sleep 1
      done
      kill -0 ${target_pid} 2>/dev/null && kill -KILL ${target_pid} 2>/dev/null
      sleep 2
      if ! tmux has-session -t ${tmux_name} 2>/dev/null; then
        tmux new-session -d -s ${tmux_name} -c ${repo_dir} \
          "${repo_dir}/scripts/codex-resilient.sh ${session_id}"
        guard_log "handoff_started tmux=${tmux_name}"
      else
        guard_log "handoff_skipped tmux=${tmux_name} reason=already_exists"
      fi
      exit 0
    fi
  fi
  sleep ${interval_sec}
done

guard_log "target_exited pid=${target_pid} no_handoff=true"
