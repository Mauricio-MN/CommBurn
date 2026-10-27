#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-4173}"
PID_FILE="$ROOT_DIR/.commburn-server.pid"
LOG_FILE="$ROOT_DIR/.commburn-server.log"
SERVER_URL="http://127.0.0.1:$PORT/"

if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "PORT must be an integer between 1 and 65535." >&2
  exit 2
fi

if ! command -v ss > /dev/null; then
  echo "The ss command is required to safely identify the server listening port." >&2
  exit 1
fi

listener_pids() {
  local output
  output="$(ss -ltnp "sport = :$PORT" 2>/dev/null || true)"
  [[ -n "$output" ]] || return 0
  printf '%s\n' "$output" | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true
}

stop_server_pid() {
  local pid="$1"
  local process_cwd process_args
  process_cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  process_args="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  if [[ "$process_cwd" != "$ROOT_DIR" || "$process_args" != *"node server.mjs"* ]]; then
    echo "Refusing to stop PID $pid: it is not CommBurn's server process." >&2
    return 1
  fi

  kill -TERM "$pid"
  for _ in {1..25}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.2
  done
  echo "CommBurn server PID $pid did not stop after SIGTERM." >&2
  return 1
}

if [[ -f "$PID_FILE" ]]; then
  read -r server_pid < "$PID_FILE"
  if [[ ! "$server_pid" =~ ^[0-9]+$ ]]; then
    echo "The CommBurn PID file is invalid; refusing to continue." >&2
    exit 1
  fi
  if kill -0 "$server_pid" 2>/dev/null; then
    stop_server_pid "$server_pid"
  fi
  rm -f "$PID_FILE"
fi

while IFS= read -r server_pid; do
  [[ "$server_pid" =~ ^[0-9]+$ ]] || continue
  if kill -0 "$server_pid" 2>/dev/null; then
    stop_server_pid "$server_pid"
  fi
done < <(listener_pids)

cd "$ROOT_DIR"
PORT="$PORT" nohup node server.mjs >> "$LOG_FILE" 2>&1 < /dev/null &
server_pid=$!
printf '%s\n' "$server_pid" > "$PID_FILE"

for _ in {1..50}; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "CommBurn server exited during startup. See $LOG_FILE." >&2
    rm -f "$PID_FILE"
    exit 1
  fi
  if listener_pids | grep -qx "$server_pid"; then
    if curl --fail --silent --show-error --max-time 1 "$SERVER_URL" > /dev/null 2>&1; then
      echo "CommBurn restarted at $SERVER_URL (PID $server_pid)."
      exit 0
    fi
  fi
  sleep 0.2
done

echo "CommBurn did not respond at $SERVER_URL. See $LOG_FILE." >&2
exit 1
