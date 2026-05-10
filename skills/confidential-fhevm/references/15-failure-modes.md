# 15 — Failure modes catalog

> Open this when something goes wrong during setup, build, test, deploy, or frontend. Every entry below is a real failure mode encountered while running this skill end-to-end against the official `fhevm-react-template`. Each one has a one-line cause and a one-line fix.

## Contents
1. Setup / install
2. Forge / soldeer / Foundry tests
3. Local chain (`pnpm chain`, anvil, cleartext host)
4. Deploy (`pnpm deploy:localhost`, `pnpm deploy:sepolia`)
5. Frontend ABI generation
6. Next.js build + dev
7. SDK v3 runtime errors

---

## 1. Setup / install

### `packages/hardhat/` or `packages/foundry/` is empty after `git clone`
**Cause:** Submodules not initialised. Older `fhevm-react-template` revisions used a git submodule for `fhevm-hardhat-template`; the current Foundry-based revision does not, but a leftover submodule pointer can still leave the directory empty.
**Fix:** `git submodule update --init --recursive`. If you don't need submodules, confirm the template revision you cloned actually ships the contracts dir inline.

### `pnpm install` runs but `npx fhevm-lint` says "command not found"
**Cause:** The skill was installed with `npm install --save-dev` inside a pnpm workspace. npm writes `package-lock.json` next to the existing `pnpm-lock.yaml`; pnpm then doesn't link the binary into `node_modules/.bin/`.
**Fix:** Delete the stray `package-lock.json`, then `pnpm add -w --save-dev github:harystyleseze/confidential-fhevm-skill`.

### `Command "dev" not found` when running `pnpm dev`
**Cause:** The workspace root doesn't expose `dev`; it exposes `start`, which delegates to the Next.js package.
**Fix:** Use `pnpm start` from the workspace root, or `pnpm --filter ./packages/nextjs dev` to invoke directly.

### `corepack prepare` asks for `pnpm@10.18.3`
**Cause:** The root `package.json` pins `packageManager: "pnpm@10.18.3"`.
**Fix:** `corepack prepare pnpm@10.18.3 --activate`. Alternative: install matching pnpm globally.

---

## 2. Forge / soldeer / Foundry tests

### `forge soldeer install` errors with `git: command not found`
**Cause:** Soldeer needs `git` for git-revision dependencies (e.g. `forge-fhevm`).
**Fix:** Install git. On macOS: `xcode-select --install`.

### Forge build prints `note[unwrapped-modifier-logic]` warnings and looks like a failure
**Cause:** `forge fmt`-level style suggestions, not errors. The build succeeded if `out/<Name>.sol/<Name>.json` exists.
**Fix:** Ignore. Optionally apply the suggestions or silence the lint rule in `foundry.toml`.

### `InvalidInputHandle()` errors when a function takes multiple encrypted inputs sharing one proof
**Cause:** forge-fhevm's cleartext-mode `encryptBool` / `encryptUint64` helpers produce one proof per ciphertext. If the contract function expects a single shared proof to validate multiple ciphertexts, the second `FHE.fromExternal` reverts with `InvalidInputHandle()`.
**Fix:** Redesign the contract function to take one `bytes calldata proof` per ciphertext. See `references/13-foundry-toolchain.md` §4 for the rationale and the canonical two-proof signature. This is also the pattern `fhevm-lint` was written against.

### `forge test` says "Nothing to compile"
**Cause:** Forge thinks nothing changed since the last build because the sources are byte-identical. Sometimes appears after a partial filesystem move.
**Fix:** `forge clean && forge test`.

### Tests pass but `cast call <addr> <fn>()` against the local node returns zeros
**Cause:** The local cleartext executor doesn't broadcast events the way Sepolia does; reading via `cast call` for a state variable that lives in a struct may need the explicit getter.
**Fix:** Use the auto-generated getter for `public` state variables; for `internal` state, expose a view function.

---

## 3. Local chain (`pnpm chain`, anvil, cleartext host)

### `pnpm chain` fails: `forge-fhevm not found under packages/foundry/dependencies/`
**Cause:** Soldeer dependencies haven't been installed.
**Fix:** `pnpm contracts:install`. The root `postinstall` doesn't run it; it's a separate step.

### `pnpm chain` runs but port 8545 is already in use
**Cause:** Another anvil instance (or a forgotten previous run) is still listening.
**Fix:** `lsof -ti :8545 | xargs kill -9`. If the previous run was something else, `ANVIL_PORT=8546 pnpm chain` to relocate.

### MetaMask nonce mismatch after restarting anvil
**Cause:** MetaMask caches nonces per address per chain. A fresh anvil restart resets nonces; MetaMask thinks the account is several txs ahead.
**Fix:** MetaMask → Settings → Advanced → "Clear activity tab data". Confirms for the right network.

---

## 4. Deploy (`pnpm deploy:localhost`, `pnpm deploy:sepolia`)

### `HardhatError: HH1008 - required variable MNEMONIC is not set`
**Cause:** Hardhat-track only — the canonical Hardhat config reads `MNEMONIC` from `hardhat vars` even for localhost deploys.
**Fix:** `npx hardhat vars set MNEMONIC "test test test test test test test test test test test junk"` (the standard dev mnemonic; no funds).

### `forge script ... failed` with `Sepolia RPC URL not set` even on localhost
**Cause:** `foundry.toml`'s `[rpc_endpoints]` / `[etherscan]` blocks reference `${SEPOLIA_RPC_URL}` / `${ETHERSCAN_API_KEY}`. Forge 1.x refuses to load the config if those env vars are unset.
**Fix:** The template's `deploy-localhost.sh` already stubs both with `: "${SEPOLIA_RPC_URL:=unset}"`. If you're invoking forge directly, set those env vars (any value) before the call.

### After Sepolia deploy, contract verification fails on Etherscan
**Cause:** Etherscan V2 (May 2025+) requires a single API key under `etherscan.apiKey` (not per-network). Older configs with `apiKey: { sepolia: ... }` are deprecated.
**Fix:** `etherscan: { apiKey: vars.get("ETHERSCAN_API_KEY", "") }` (Hardhat) or `[etherscan] sepolia = { key = "${ETHERSCAN_API_KEY}" }` (Foundry — same key string, no per-network object). Add `sourcify: { enabled: true }` as a fallback verifier.

---

## 5. Frontend ABI generation

### Vote page renders but `useReadContract` returns nothing
**Cause:** `packages/nextjs/contracts/<Name>.local.ts` doesn't have an entry for chain 31337 (or the entry has a stale address from a previous anvil run that's been restarted).
**Fix:** `pnpm deploy:localhost` regenerates the sidecar. If the address still doesn't match what's on chain, restart anvil and redeploy. Verify with `cat packages/nextjs/contracts/<Name>.local.ts`.

### `Contract address is not a valid address`
**Cause:** Relayer SDK requires EIP-55 checksummed addresses; a stale `<Name>.local.ts` may have a lowercase address.
**Fix:** `pnpm generate` rewrites the sidecar with checksummed addresses. If it doesn't, manually convert via `viem.getAddress(...)` in `scripts/generateTsAbis.ts`.

### `<Name>.local.ts` is a stub with no address
**Cause:** Fresh clone, no deploys yet.
**Fix:** Run `pnpm chain` then `pnpm deploy:localhost` once. The stub is normal until the first deploy.

---

## 6. Next.js build + dev

### `pnpm next:build` fails: `Environment variable NEXT_PUBLIC_ALCHEMY_API_KEY is required in production`
**Cause:** The wagmi config has a runtime guard that throws on production rendering if the var is unset, even when the build only targets a local anvil.
**Fix:** Create `packages/nextjs/.env.local` with `NEXT_PUBLIC_ALCHEMY_API_KEY=local_placeholder`. The real key is only needed for live Sepolia traffic. `fhevm-lint` AP-021 catches the missing file.

### `react/no-unescaped-entities` error on `'` in JSX
**Cause:** Next's default ESLint config forbids raw apostrophes in JSX text nodes.
**Fix:** `&apos;` or `&rsquo;` in JSX text; double-quote the entire string in a JS context.

### Prettier "Insert ⏎" warnings break `next:build`
**Cause:** `eslint-plugin-prettier` reports formatting diffs as errors during `next lint`, which `next build` runs.
**Fix:** `npx prettier --write packages/nextjs/path/to/file` then rebuild.

### Dev server starts but `curl http://localhost:3000/<route>` returns 000 / connection refused
**Cause:** The dev server hasn't finished compiling the route yet; first request to a route triggers on-demand compilation.
**Fix:** `until curl -sf http://localhost:3000/<route> > /dev/null; do sleep 2; done` then re-request, or check the dev-server log for "Compiled successfully".

---

## 7. SDK v3 runtime errors

### `useUserDecrypt` errors immediately with `Handle is zero / uninitialised`
**Cause:** Called on a `ZERO_HANDLE` (the value returned by `useReadContract` when no state has been written yet).
**Fix:** Gate the decrypt query with `enabled: handle !== undefined && handle !== ZERO_HANDLE`. The template's `useFHECounterWagmi` is the canonical pattern.

### `usePublicDecrypt` returns `InvalidProof` when fed back into `FHE.checkSignatures`
**Cause:** Handle ordering passed to `publicDecrypt.mutateAsync([...])` doesn't match the order the contract uses inside `FHE.checkSignatures(handles, abiEncoded, proof)`.
**Fix:** Emit a `RevealRequested(handle1, handle2)` event from the contract's `requestReveal`; consume the same order in the frontend.

### Transaction reverts with `out of gas` but trace shows no gas spike
**Cause:** Wagmi's auto gas estimation picked a value above Sepolia's block gas limit (16,777,216).
**Fix:** Pass `gas: 15_000_000n` to `useWriteContract.writeContractAsync` for FHE-heavy calls.

### `await encrypt.mutate({...})` resolves to `undefined`
**Cause:** TanStack Query mutations: `mutate(...)` is fire-and-forget; only `mutateAsync(...)` returns the result.
**Fix:** Switch to `mutateAsync`. `fhevm-lint` AP-020 catches this.

### Frontend hangs at "Initializing SDK..." for 30+ seconds on Sepolia
**Cause:** First-time relayer key fetch over the network. Expected; show a loading indicator with explicit phases (`idle → loading → sdk-initializing → sdk-initialized → creating → ready`).
**Fix:** Use the SDK event hooks (`ZamaSDKEvents.CredentialsLoading`, `CredentialsCached`) to display granular status to the user. See `references/14-sdk-v3-frontend.md` §6.

### Page loads in MetaMask but `useAccount` returns disconnected
**Cause:** MetaMask is connected to a chain the wagmi config doesn't enumerate (e.g. mainnet by default, but the app only declares hardhat + sepolia).
**Fix:** Switch network in MetaMask, or extend `chains` / `targetNetworks` in `scaffold.config.ts` (and `services/web3/wagmiConfig.tsx`).
