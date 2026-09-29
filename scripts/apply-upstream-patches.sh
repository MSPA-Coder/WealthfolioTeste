#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_dir=${1:-"$project_dir/../CodexTemp/wealthfolio-v3.9.1"}

if [ ! -d "$source_dir/apps/server" ]; then
  echo "Wealthfolio source checkout not found: $source_dir" >&2
  exit 1
fi

# Keep an application ledger beside the disposable upstream checkout. The upstream
# archive has no Git metadata on the VPS, so `git apply --reverse --check` alone
# cannot reliably distinguish an already applied patch from a CRLF mismatch.
ledger="$source_dir/.patrimonio-patches-applied"
touch "$ledger"

# The packaged upstream source has CRLF line endings on some deployments.
for patch_file in "$project_dir"/patches/*.patch; do
  patch_id=$(sha256sum "$patch_file" | awk '{print $1}')
  if grep -qx "$patch_id" "$ledger"; then
    continue
  fi
  if git -C "$source_dir" apply --ignore-space-change --reverse --check "$patch_file"; then
    printf '%s\n' "$patch_id" >> "$ledger"
    continue
  fi
  git -C "$source_dir" apply --ignore-space-change --check "$patch_file"
  git -C "$source_dir" apply --ignore-space-change "$patch_file"
  printf '%s\n' "$patch_id" >> "$ledger"
done
