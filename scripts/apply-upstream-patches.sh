#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_dir=${1:-"$project_dir/../CodexTemp/wealthfolio-v3.9.1"}

if [ ! -d "$source_dir/apps/server" ]; then
  echo "Wealthfolio source checkout not found: $source_dir" >&2
  exit 1
fi

# The packaged upstream source has CRLF line endings on some deployments.
# Each patch is either fully present or applied as a whole; partial patches fail.
for patch_file in "$project_dir"/patches/*.patch; do
  if git -C "$source_dir" apply --ignore-space-change --reverse --check "$patch_file"; then
    continue
  fi
  git -C "$source_dir" apply --ignore-space-change --check "$patch_file"
  git -C "$source_dir" apply --ignore-space-change "$patch_file"
done