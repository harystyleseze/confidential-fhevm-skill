#!/usr/bin/env bash
# Multi-contract Sepolia deploy. Drop this into `scripts/deploy-sepolia.sh`
# of the official fhevm-react-template (it already ships a single-contract
# version that only deploys FHECounter; this template extends it).
#
# To add another contract, duplicate the run_forge call at the bottom and
# point it at the new Deploy<Name>.s.sol script.
#
# Required env vars (.env.local at the repo root, or shell-exported):
#   SEPOLIA_RPC_URL       - Sepolia JSON-RPC endpoint
#   DEPLOYER_PRIVATE_KEY  - 0x-prefixed private key, funded with ≥0.05 Sepolia ETH
# Optional:
#   ETHERSCAN_API_KEY     - if set, verifies the contract on Etherscan V2
#                           (one key works for all chains since May 2025)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FOUNDRY_DIR="$REPO_ROOT/packages/foundry"

# Auto-load repo-root .env.local if present, so users don't have to source it.
if [[ -f "$REPO_ROOT/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env.local"
  set +a
fi

: "${SEPOLIA_RPC_URL:?SEPOLIA_RPC_URL is required (set in .env.local or shell)}"
: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is required (set in .env.local or shell)}"

cd "$FOUNDRY_DIR"

run_forge() {
  local script_path="$1"
  local name="$2"
  local args=(
    "$script_path"
    --rpc-url "$SEPOLIA_RPC_URL"
    --private-key "$DEPLOYER_PRIVATE_KEY"
    --broadcast
  )
  if [[ -n "${ETHERSCAN_API_KEY:-}" ]]; then
    args+=(--verify --etherscan-api-key "$ETHERSCAN_API_KEY")
  fi
  echo
  echo "▸ Deploying $name to Sepolia"
  forge script "${args[@]}"
}

if [[ -z "${ETHERSCAN_API_KEY:-}" ]]; then
  echo "note: ETHERSCAN_API_KEY not set — skipping Etherscan verification (Sourcify still indexes)"
fi

# One run_forge call per contract. Add new ones here as the project grows.
run_forge "script/DeployFHECounter.s.sol:DeployFHECounter"            "FHECounter"
run_forge "script/Deploy<Name>.s.sol:Deploy<Name>"                    "<Name>"

echo
echo "▸ Regenerating frontend ABIs + addresses"
cd "$REPO_ROOT"
pnpm generate

echo
echo "✅  Sepolia deploy complete."
echo "Next steps:"
echo "  1. Paste each deployed address into your README's '## Live demo' block."
echo "  2. Set NEXT_PUBLIC_ALCHEMY_API_KEY in packages/nextjs/.env.local before"
echo "     'pnpm next:build' if you intend to deploy the frontend to Vercel."
