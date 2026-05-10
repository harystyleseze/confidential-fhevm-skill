# SDK v3 frontend templates

For projects using `@zama-fhe/sdk` v3 and `@zama-fhe/react-sdk` v3 — the current API shipped with the official `fhevm-react-template`.

| File | Drop into |
| --- | --- |
| [`useFHEContract.tsx`](useFHEContract.tsx) | `packages/nextjs/hooks/<feature>/useMyContract.tsx` |
| [`page.tsx`](page.tsx) | `packages/nextjs/app/<route>/page.tsx` |

## Why SDK v3 instead of v2?

The SDK was rewritten end-to-end in v3. Reusable v2 patterns are gone; the v3 shape is the only one supported going forward by Zama's tooling.

| Concept | SDK v2 hook (removed) | SDK v3 hook (current) |
| --- | --- | --- |
| Encrypt | `useFHEEncryption` | `useEncrypt` |
| User-decrypt | `useFHEDecrypt` | `useUserDecrypt` + `useAllow` + `useIsAllowed` |
| Public-decrypt | not first-class | `usePublicDecrypt` *(returns proof ready for `FHE.checkSignatures`)* |
| Encrypted ERC-7984 token | `Token` class | `useToken`, `useShield`, `useUnshield`, `useConfidentialBalance`, `useConfidentialTransfer`, … |

`fhevm-lint` rule AP-019 flags v2 hook imports as deprecated.

## Critical conventions

1. **Always use `mutateAsync` inside `async` code.** All v3 mutation hooks (`useEncrypt`, `usePublicDecrypt`, `useAllow`, `useShield`, …) return TanStack Query mutation objects. `mutate(...)` is fire-and-forget; `await hook.mutateAsync(...)` returns the result. The template's `setValue` is the canonical pattern.

2. **Cap `gas` on FHE transactions.** FHE operations are expensive; Sepolia's block gas limit is 16,777,216. Set `gas: 15_000_000n` (or similar) on `useWriteContract.writeContractAsync` calls that trigger FHE ops, otherwise wagmi's auto-estimate may pick a value the network refuses.

3. **`usePublicDecrypt` returns everything you need to finalize on-chain.** The mutation result is `{ clearValues, abiEncodedClearValues, decryptionProof }`. Feed `decryptionProof` straight into `FHE.checkSignatures(...)` on-chain — no manual ABI-encoding required.

4. **The user-decrypt gate is two hooks.** `useAllow` triggers the EIP-712 keypair signing (one wallet popup, cached for the configured TTL). `useIsAllowed` is the query that tells you whether `useUserDecrypt` is ready to fire. The template's `decryptHandle` uses this pattern: enable, check `isAllowed`, allow if missing, otherwise let the query fetch.

5. **`ZERO_HANDLE` is the uninitialised value.** Re-export from `@zama-fhe/sdk`. Always check `handle === ZERO_HANDLE` before decrypting — `useUserDecrypt` errors on a zero handle.

6. **`deploymentFor(Contract, chainId)` is the canonical address/ABI lookup.** It comes from `~~/utils/contract` in the template and reads the auto-generated `<Name>.ts` + `<Name>.local.ts` files in `packages/nextjs/contracts/`. The `<Name>.local.ts` overlay file is auto-regenerated on every `pnpm deploy:localhost`.

7. **`.env.local` requires `NEXT_PUBLIC_ALCHEMY_API_KEY` for production builds.** Even when targeting localhost only, the prod build prerender enforces this. Use a placeholder for local builds; a real key only matters for live Sepolia traffic.

## Confidential ERC-7984 tokens

For wrap/unwrap/transfer/balance flows on confidential tokens, prefer the dedicated v3 hooks over rolling your own:

```typescript
import {
  useToken,                  // operations on a known confidential-token address
  useReadonlyToken,          // read-only token (no signer required)
  useShield,                 // wrap ERC-20 → confidential token
  useUnshield, useResumeUnshield, useFinalizeUnwrap, useUnwrap, useUnwrapAll,
  useConfidentialBalance,    // decrypt a user's balance on demand
  useConfidentialTransfer,   // private transfer
  useConfidentialApprove, useConfidentialIsApproved,
  useWrapperDiscovery,       // find the wrapper for a given ERC-20
} from "@zama-fhe/react-sdk";
```

`references/10-erc7984-confidential-tokens.md` covers the contract side; this template plus the hook list above cover the frontend side.

## When NOT to use SDK v3 hooks

If you're staying on `@zama-fhe/sdk` v2 inside an existing app — for example, a project already shipping `useFHEEncryption`/`useFHEDecrypt` against the older relayer — the patterns in `references/09-frontend-patterns.md` still apply but should be considered frozen. New work should migrate.
