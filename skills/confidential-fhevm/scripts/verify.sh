#!/usr/bin/env bash
# verify.sh — install, compile, test, and lint a generated FHEVM project.
# Designed to be invoked by an AI agent after generating contracts/tests/deploy code,
# so the agent can confirm "the work I produced actually builds".
#
# Usage:
#   verify.sh [project-root]
#
# If project-root is omitted, the current directory is used. Detects npm vs pnpm
# via the lockfile.

set -e
cd "${1:-.}"

PKG_MGR="npm"
if [ -f pnpm-lock.yaml ]; then PKG_MGR="pnpm"; fi
if [ -f yarn.lock ];        then PKG_MGR="yarn"; fi

echo "==> verify.sh: package manager = $PKG_MGR"

if [ ! -d node_modules ]; then
  echo "==> installing dependencies"
  "$PKG_MGR" install
fi

if [ -f hardhat.config.ts ] || [ -f hardhat.config.js ]; then
  echo "==> compiling contracts"
  npx hardhat compile

  if [ -d test ]; then
    echo "==> running tests (mock FHE)"
    npx hardhat test || {
      echo "==> tests failed; aborting"
      exit 1
    }
  fi
fi

# Locate fhevm-lint — works in three setups: npm bin, local script, or installed package.
LINT_BIN=""
if [ -x ./node_modules/.bin/fhevm-lint ]; then
  LINT_BIN="./node_modules/.bin/fhevm-lint"
elif [ -f scripts/fhevm-lint.js ]; then
  LINT_BIN="node scripts/fhevm-lint.js"
elif command -v fhevm-lint >/dev/null 2>&1; then
  LINT_BIN="fhevm-lint"
fi

if [ -z "$LINT_BIN" ]; then
  echo "==> fhevm-lint not found on PATH or in node_modules — skipping lint"
else
  if [ -d contracts ]; then
    echo "==> running fhevm-lint on contracts/"
    $LINT_BIN contracts || {
      echo "==> lint produced CRITICAL or HIGH findings; aborting"
      exit 1
    }
  fi
fi

echo "==> verify.sh: all checks passed"
