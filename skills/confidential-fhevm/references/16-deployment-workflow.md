# 16 — Deployment workflow (env files, Sepolia, Vercel, post-deploy doc updates)

> Open this when an agent has finished generating contracts/tests/frontend and needs to actually ship the dApp. The agent must not invent secrets — it asks the user to provide them, then runs the deploy and updates the docs.

> **First-time builders welcome.** §0 below walks through wallet creation, getting Sepolia ETH, and finding a free RPC — for anyone who's never deployed a contract before. Skip to §1 if you already have a funded deployer wallet.

## Contents
0. **First-time builder onboarding** (wallet → faucet → RPC → Etherscan key)
1. The contract: what the agent does vs. what the user provides
2. The env-file pre-flight checklist
3. Wiring a new contract into the deploy scripts
4. Running the Sepolia deploy
5. Vercel deploy of the frontend
6. Post-deploy: update README "Live demo" + commit deployed addresses
7. The exact prompt the agent uses to ask the user for env values

---

## 0. First-time builder onboarding

If the user is new to deploying smart contracts, the agent should detect that (they'll ask "what's a deployer wallet?" or "where do I get Sepolia ETH?") and walk them through these four steps **once**. After this, the user has everything needed for §1–§6.

### 0.1 Install MetaMask + create a dedicated deployer account

1. Install MetaMask: <https://metamask.io/download>
2. In MetaMask: account menu → **+ Add account or hardware wallet** → **Add new account** → name it "deployer (test)". This is a fresh account you'll use only for testnet deploys. **Never put real funds in it.**
3. Export the private key: click the deployer account → ⋮ menu → **Account details** → **Show private key** → paste your MetaMask password → copy the 0x-prefixed string.

The `DEPLOYER_PRIVATE_KEY` env var in §2 wants that 0x-prefixed string. Keep it in `.env.local` only (which is gitignored); never paste it into a chat, a screenshot, or a commit message.

### 0.2 Get Sepolia ETH from a faucet (free)

The deployer account needs ≥0.05 Sepolia ETH to cover gas for both the FHEVM host setup and your contract deploy. Faucets that work today (one of these is enough):

- **Alchemy** — <https://www.alchemy.com/faucets/ethereum-sepolia> (free, requires Alchemy account; 0.1 ETH per day)
- **Google Cloud** — <https://cloud.google.com/application/web3/faucet/ethereum/sepolia> (free, requires Google account)
- **PoW faucet** — <https://sepolia-faucet.pk910.de> (free, no signup; mines in-browser, takes 5–10 min for 0.05 ETH)

Paste the deployer address (`0x…`) into the faucet, wait for the tx to confirm, then confirm the balance in MetaMask. If the faucet says "this address looks unused on mainnet, please link a github account" — that's normal anti-abuse; pick a different faucet or link your account.

### 0.3 Choose a Sepolia RPC URL (free, no signup)

Two options:
- **Public RPC, no account** — `https://ethereum-sepolia-rpc.publicnode.com`. Recommended for first deploys. Rate-limited but fine for one transaction.
- **Alchemy app** — `https://eth-sepolia.g.alchemy.com/v2/<key>`. Recommended for the live frontend (the relayer SDK does many calls per session). Sign up at <https://dashboard.alchemy.com>, create an app, set chain = Sepolia, copy the HTTPS URL.

Both go in the `SEPOLIA_RPC_URL` env var.

### 0.4 (Optional) Get an Etherscan V2 API key

Used only to verify the contract source on Etherscan (`/address/0x…#code` shows your Solidity). Skip if you don't care about verification — Sourcify indexes anyway.

1. Sign up at <https://etherscan.io/register>
2. <https://etherscan.io/myapikey> → **+ Add** → name it "fhevm-deploy" → copy the key.
3. Goes in `ETHERSCAN_API_KEY`. One key works for all networks under Etherscan V2 (since May 2025).

After steps 0.1–0.3, the user has the three required values for `.env.local`. Move on to §1.

---

## 1. The contract: agent vs. user

| Phase | Agent does | User provides |
| --- | --- | --- |
| Generate code | contract + test + deploy script + frontend hook + page | the prompt |
| Wire deploy scripts | extends `scripts/deploy-localhost.sh` AND `scripts/deploy-sepolia.sh` to deploy the new contract; ships matching `.env.example` and a `## Live demo` placeholder block in README | nothing |
| Local verify | `forge test`, `npx fhevm-lint`, `pnpm next:build`, `pnpm chain && pnpm deploy:localhost`, `pnpm start` smoke test | nothing |
| Sepolia deploy | runs `pnpm deploy:sepolia`, captures deployed addresses from `broadcast/`, runs `pnpm generate` to update `<Name>.ts` sidecars, captures Etherscan link, updates README's "Live demo" block | `.env.local` with `SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY` (funded ≥0.05 ETH), optional `ETHERSCAN_API_KEY` |
| Vercel deploy | `pnpm vercel:yolo` (or `vercel --prod`) inside `packages/nextjs/`, pastes the resulting URL into README's "Live demo" block | logged-in `vercel` CLI; `NEXT_PUBLIC_ALCHEMY_API_KEY` in `packages/nextjs/.env.local` |

**The agent does not invent secrets.** If a required env var is missing, the agent prints a clear "fill these in your `.env.local`, then re-run me" message and stops — it does not guess, fake, or use placeholder values that would silently corrupt the broadcast log.

## 2. The env-file pre-flight checklist

Before running `pnpm deploy:sepolia` (or before claiming the Vercel build will work), confirm:

| Where | Var | What it must be |
| --- | --- | --- |
| `<repo-root>/.env.local` | `SEPOLIA_RPC_URL` | a working JSON-RPC endpoint (`https://eth-sepolia.g.alchemy.com/v2/<key>` or `https://ethereum-sepolia-rpc.publicnode.com` for free, no-key access) |
| `<repo-root>/.env.local` | `DEPLOYER_PRIVATE_KEY` | 0x-prefixed; funded with ≥0.05 Sepolia ETH (faucet: <https://www.alchemy.com/faucets/ethereum-sepolia>) |
| `<repo-root>/.env.local` | `ETHERSCAN_API_KEY` *(optional)* | one key works for all networks under Etherscan V2 (since May 2025); without it, Sourcify still indexes the contract |
| `packages/nextjs/.env.local` | `NEXT_PUBLIC_ALCHEMY_API_KEY` | required for the Next.js production build; a placeholder is enough for local-only builds, a real key is required for live Sepolia traffic |

The agent's `.env.example` files in the repo root and `packages/nextjs/` show exactly these variables with one-line comments — copy-paste, fill in, save as `.env.local`.

## 3. Wiring a new contract into the deploy scripts

The official `fhevm-react-template` ships two shell wrappers, `scripts/deploy-localhost.sh` and `scripts/deploy-sepolia.sh`. Both deploy `FHECounter` only. When the agent generates a new contract `<Name>`, it must extend BOTH scripts. The diff is the same for both — append after the existing `FHECounter` block:

```bash
# scripts/deploy-localhost.sh — append after the FHECounter block
echo
echo "▸ Deploying <Name>"
voting_log="$(mktemp)"
trap 'rm -f "$deploy_log" "$voting_log"' EXIT
if ! PRIVATE_KEY="$ANVIL_PK" forge script script/Deploy<Name>.s.sol:Deploy<Name> \
    --rpc-url "$RPC_URL" \
    --private-key "$ANVIL_PK" \
    --broadcast \
    >"$voting_log" 2>&1; then
    echo "❌  forge script failed:" >&2
    cat "$voting_log" >&2
    exit 1
fi
grep -E "<Name>|Admin|===" "$voting_log" || true
```

For `scripts/deploy-sepolia.sh`, the same pattern — but factor the forge invocation into a helper so adding additional contracts becomes a one-liner. See [`templates/foundry/deploy-sepolia.sh`](../templates/foundry/deploy-sepolia.sh) for the canonical multi-contract version.

## 4. Running the Sepolia deploy

```bash
# from repo root
cp .env.example .env.local
# fill in SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, optional ETHERSCAN_API_KEY
pnpm deploy:sepolia
```

The script prints the deployed address for each contract. It then runs `pnpm generate`, which walks `packages/foundry/broadcast/<Script>.sol/11155111/run-latest.json` and writes the new address into `packages/nextjs/contracts/<Name>.ts` — the frontend now points at Sepolia automatically.

Common failures and fixes are catalogued in [`15-failure-modes.md`](15-failure-modes.md) §4.

## 5. Vercel deploy of the frontend

```bash
cd packages/nextjs
pnpm vercel:yolo                     # first run prompts for project linking
# follow prompts; default settings work
```

`vercel:yolo` (defined in the template's `package.json`) sets `NEXT_PUBLIC_IGNORE_BUILD_ERROR=true` so a stray ESLint warning doesn't fail the deploy. `vercel:login` is the auth gate if not already logged in.

Before the first deploy, set `NEXT_PUBLIC_ALCHEMY_API_KEY` in the Vercel project settings (Environment Variables → Production). The local `.env.local` is gitignored and is not used by Vercel.

## 6. Post-deploy: update README "Live demo" + commit deployed addresses

After every successful Sepolia deploy, the agent must update the project's README. The "Live demo" block in `templates/foundry/README.md` (and in the worked examples) reserves space for these:

```markdown
## Live demo

- **Sepolia contract (<Name>):** [0x…](https://sepolia.etherscan.io/address/0x…)
- **Etherscan verified:** ✓ / ✗
- **Live frontend:** https://<vercel-project>.vercel.app
- **Deployer:** 0x… (funded for redeploys)
```

Commit:
- the updated README,
- `packages/nextjs/contracts/<Name>.ts` (the non-local sidecar — chain 11155111 entries are tracked),
- the broadcast manifest `packages/foundry/broadcast/Deploy<Name>.s.sol/11155111/run-latest.json`.

Do NOT commit:
- `.env.local` (gitignored),
- `packages/foundry/broadcast/<...>/dry-run/*.json` (local artefacts),
- `packages/nextjs/contracts/<Name>.local.ts` (chain 31337 overlay — gitignored).

---

## 7. The exact prompt the agent uses to ask the user for env values

When the agent has finished generating code and the user wants to deploy, it must print this checklist verbatim (or paraphrased — but no values fabricated):

```
The dApp is built and tested locally. To deploy to Sepolia I need three values
from you. Create a file at <repo-root>/.env.local with:

  SEPOLIA_RPC_URL=        # e.g. https://ethereum-sepolia-rpc.publicnode.com
  DEPLOYER_PRIVATE_KEY=   # 0x-prefixed; funded with ≥0.05 Sepolia ETH
  ETHERSCAN_API_KEY=      # (optional) for Etherscan verification

If you've never done this before, open
`references/16-deployment-workflow.md §0` for a step-by-step walkthrough of
wallet creation, faucets, and free RPC choices.

Once `.env.local` is filled in, tell me to proceed and I'll run:
    pnpm deploy:sepolia
    pnpm generate
…capture the deployed addresses, and update the README's "Live demo" block.
```

If the user asks for help with any of the four (wallet / faucet / RPC / Etherscan key), the agent walks them through §0 step-by-step rather than guessing. If the user supplies a value that fails preflight (e.g. private key without `0x` prefix, RPC URL that returns 401), the agent surfaces the precise failure mode from `references/15-failure-modes.md` rather than retrying blindly.
