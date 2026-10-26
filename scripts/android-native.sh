#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
android_project_dir="$project_root/apps/android"
mode="${1:-build}"

if [[ "$mode" == "open" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    exec open -a "Android Studio" "$android_project_dir"
  fi
  exec studio "$android_project_dir"
fi

if [[ -z "${JAVA_HOME:-}" && -x /usr/libexec/java_home ]]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 21)"
  export JAVA_HOME
fi
if [[ -z "${ANDROID_HOME:-}" && -d "$HOME/Library/Android/sdk" ]]; then
  export ANDROID_HOME="$HOME/Library/Android/sdk"
fi

case "$mode" in
  build|dev) ;;
  *) printf 'Unknown Android command: %s\n' "$mode" >&2; exit 2 ;;
esac

"$android_project_dir/gradlew" -p "$android_project_dir" :app:assembleDebug

if [[ "$mode" == "dev" ]]; then
  adb_command="${ANDROID_HOME:-}/platform-tools/adb"
  if [[ ! -x "$adb_command" ]]; then adb_command="$(command -v adb)"; fi
  device="${ANDROID_SERIAL:-}"
  if [[ -z "$device" ]]; then
    device="$("$adb_command" devices | awk '$1 ~ /^emulator-/ && $2 == "device" {print $1; exit}')"
  fi
  if [[ -z "$device" ]]; then
    printf 'Start an Android emulator in Android Studio, then run pnpm android:dev again.\n' >&2
    exit 1
  fi
  "$adb_command" -s "$device" install -r "$android_project_dir/app/build/outputs/apk/debug/app-debug.apk"
  "$adb_command" -s "$device" shell am start -n com.ollaic.galagame_maker/.MainActivity
fi
