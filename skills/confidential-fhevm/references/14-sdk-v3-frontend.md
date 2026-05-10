# 14 — `@zama-fhe/react-sdk` v3 reference (current frontend stack)

> Open this when the project ships `@zama-fhe/sdk` v3 / `@zama-fhe/react-sdk` v3 — the SDK shipped with the official `fhevm-react-template`. For the older `@zama-fhe/sdk` v2 / `@zama-fhe/relayer-sdk` 0.4.x patterns, see `references/09-frontend-patterns.md`.

## Contents
1. Mental model of v3
2. Encrypting inputs (`useEncrypt`)
3. User decryption (`useAllow` + `useIsAllowed` + `useUserDecrypt`)
4. Public decryption (`usePublicDecrypt`) and on-chain finalize
5. Confidential ERC-7984 token hooks
6. SDK events you can listen for
7. Common mistakes (and how AP rules flag them)

---

## 1. Mental model of v3

Everything in v3 is a TanStack Query hook (mutation or query). The SDK does not expose a top-level imperative client to your components; instead, you compose hooks. Mental anchors:

- **Mutations** (`useEncrypt`, `useAllow`, `usePublicDecrypt`, `useShield`, `useConfidentialTransfer`, …) — call `.mutateAsync(payload)` to get the result. Returns `{ mutate, mutateAsync, isPending, data, error }`.
- **Queries** (`useUserDecrypt`, `useIsAllowed`, `useConfidentialBalance`, `useMetadata`, `useWrapperDiscovery`, …) — auto-fire when `enabled` is true; return `{ data, isFetching, error, refetch }`.
- **Provider** — wrap your app in `<ZamaProvider>` once (typically in `DappWrapperWithProviders.tsx`). It owns the `ZamaSDK` instance and the credential lifecycle.

Two SDK packages cooperate:

| Package | Where you import from |
| --- | --- |
| `@zama-fhe/react-sdk` | hooks (`useEncrypt`, `useUserDecrypt`, …), `<ZamaProvider>` |
| `@zama-fhe/sdk` | non-hook utilities (`ZERO_HANDLE`, `RelayerWeb`, `MainnetConfig`, `SepoliaConfig`, error classes, decoders) |

## 2. Encrypting inputs (`useEncrypt`)

```typescript
const encrypt = useEncrypt();

const result = await encrypt.mutateAsync({
  values: [
    { value: true,   type: "ebool" },
    { value: 100n,   type: "euint64" },
  ],
  contractAddress: "0x…" as `0x${string}`,
  userAddress:     "0x…" as `0x${string}`,
});

// result.handles[0] → bytes32 handle for the ebool
// result.handles[1] → bytes32 handle for the euint64
// result.inputProof → SINGLE bytes proof covering both handles
```

Supported `type` values: `"ebool"`, `"euint8"`, `"euint16"`, `"euint32"`, `"euint64"`, `"euint128"`, `"euint256"`, `"eaddress"`.

**Key fact:** `useEncrypt` always produces ONE batched proof per call. If your contract takes separate proofs per ciphertext (recommended for Foundry testability — see `references/13-foundry-toolchain.md` §4), call `encrypt.mutateAsync` twice and pass each result's `handles[0]` + `inputProof` independently.

**Always use `mutateAsync`** when `await`-ing the result. `mutate(...)` returns nothing; it just fires the mutation and you have to subscribe to `encrypt.data` via re-render.

## 3. User decryption (`useAllow` + `useIsAllowed` + `useUserDecrypt`)

User decryption requires two on-chain prerequisites:
1. The contract must have called `FHE.allow(handle, user)` for the user requesting decryption (skill rule 2).
2. The user must have an active KMS credential bound to the contract (an EIP-712-signed keypair, valid for 30 days by default).

The 3-hook pattern handles both:

```typescript
const contractAddr = deployment.address as `0x${string}`;

// 1. Probe credential state. Returns true if the user has a fresh signature for this contract.
const { data: isAllowed } = useIsAllowed({ contractAddresses: [contractAddr] });

// 2. Acquire credential on demand. Pops a single wallet popup; result cached for the TTL.
const { mutate: allow, isPending: isAllowing } = useAllow();

// 3. Decrypt one or more handles after the credential is in place.
const [enabled, setEnabled] = useState(false);
const decrypt = useUserDecrypt(
  { handles: [{ handle, contractAddress: contractAddr }] },
  { enabled: enabled && Boolean(isAllowed) },
);

// Trigger the chain: enable; if not allowed yet, acquire credential; otherwise the query fires.
const startDecrypt = () => {
  setEnabled(true);
  if (!isAllowed) allow([contractAddr]);
};

// Read the cleartext after the query resolves
const cleartext = decrypt.data?.[handle];   // bigint | undefined
```

`useUserDecrypt` takes an array so you can batch many handles in one EIP-712 round-trip.

## 4. Public decryption (`usePublicDecrypt`) and on-chain finalize

`usePublicDecrypt` is the killer hook for "reveal-after-deadline" patterns. It does the full off-chain decryption ceremony in one call and returns the proof bytes ready for `FHE.checkSignatures(...)`:

```typescript
const publicDecrypt = usePublicDecrypt();
const { writeContractAsync } = useWriteContract();

const result = await publicDecrypt.mutateAsync([yesHandle, noHandle]);
// result.clearValues          → { "0xyesHandle": 100n, "0xnoHandle": 25n }
// result.abiEncodedClearValues → "0x..." matches abi.encode(yesTally, noTally)
// result.decryptionProof       → "0x..." accepted by FHE.checkSignatures on-chain

const yesClear = result.clearValues[yesHandle] as bigint;
const noClear  = result.clearValues[noHandle]  as bigint;

await writeContractAsync({
  address: contractAddr,
  abi: contractAbi,
  functionName: "finalize",
  args: [proposalId, yesClear, noClear, result.decryptionProof],
});
```

The handle ordering you pass to `mutateAsync` MUST match the order your contract uses inside `FHE.checkSignatures(handles, abiEncoded, proof)` (skill rule 11). The simplest reliable pattern: emit a `RevealRequested(handle1, handle2)` event from the on-chain `requestReveal` and consume the same order on the frontend.

## 5. Confidential ERC-7984 token hooks

The SDK ships first-class hooks for the ERC-7984 confidential-token standard. Use these instead of hand-rolling shield/transfer/unshield flows:

| Hook | What it does |
| --- | --- |
| `useToken({ tokenAddress })` | mutation surface for one confidential token (signer required) |
| `useReadonlyToken(address)` | read-only token (no signer) — for spectator views |
| `useShield(...)` | wrap ERC-20 → confidential token (single call; handles approve + wrap) |
| `useUnshield(...)` | unwrap confidential → ERC-20 (two-phase; persists pending state across page reloads via `savePendingUnshield`/`loadPendingUnshield`) |
| `useResumeUnshield(...)` | resume an interrupted unshield after a page refresh |
| `useFinalizeUnwrap(...)` / `useUnwrap(...)` / `useUnwrapAll(...)` | wrapper-side unwrap flow |
| `useConfidentialBalance({ tokenAddress })` | decrypt the user's balance on demand |
| `useConfidentialBalances({...})` | batch balance decrypts across tokens |
| `useConfidentialTransfer(...)` | confidential transfer to a recipient |
| `useConfidentialTransferFrom(...)` | operator transfer |
| `useConfidentialApprove(...)` / `useConfidentialIsApproved(...)` | operator approve/check |
| `useWrapperDiscovery(...)` | find the confidential wrapper for a given underlying ERC-20 |
| `useMetadata(tokenAddress)` | name/symbol/decimals/etc. |
| `useActivityFeed(...)` | parsed activity feed of confidential events |

See `references/10-erc7984-confidential-tokens.md` for the contract side and the worked patterns.

## 6. SDK events you can listen for

The SDK emits browser events via `window.dispatchEvent`. Subscribe via the `ZamaSDKEvents` constants:

```typescript
import { ZamaSDKEvents } from "@zama-fhe/sdk";

useEffect(() => {
  const ctrl = new AbortController();
  const { CredentialsCached, DecryptStart, DecryptEnd, EncryptStart, EncryptEnd } = ZamaSDKEvents;
  window.addEventListener(CredentialsCached, () => setStatus("ready"), { signal: ctrl.signal });
  window.addEventListener(DecryptStart, () => setStatus("decrypting"), { signal: ctrl.signal });
  window.addEventListener(DecryptEnd, () => setStatus("decrypted"), { signal: ctrl.signal });
  return () => ctrl.abort();
}, []);
```

Useful for status banners that span hook boundaries.

## 7. Common mistakes (and how AP rules flag them)

| Mistake | Why it fails | Fix | Lint |
| --- | --- | --- | --- |
| `useFhevm` / `useFHEEncryption` / `useFHEDecrypt` imports | Those are SDK v2 hooks; removed from v3 | Use `useEncrypt`, `useUserDecrypt`, `useAllow`, `useIsAllowed` | AP-019 (frontend) |
| `encrypt.mutate({...})` then immediately read `encrypt.data` | `mutate` is fire-and-forget; `data` is undefined until re-render | Use `await encrypt.mutateAsync({...})` | AP-020 (frontend) |
| Missing `NEXT_PUBLIC_ALCHEMY_API_KEY` | Template's prod build prerender throws | Add a placeholder for local builds; real key for Sepolia | AP-021 (env) |
| Calling `useUserDecrypt` on `ZERO_HANDLE` | Errors; the handle is uninitialised | Always gate with `handle !== ZERO_HANDLE` | — |
| Wrong handle order in `publicDecrypt.mutateAsync([...])` | `FHE.checkSignatures` reverts | Emit a `RevealRequested(h1, h2)` event from `requestReveal`; consume the same order on the frontend | — |
| No `gas` cap on FHE writes | Wagmi auto-estimates above the network's block gas limit | `gas: 15_000_000n` on `useWriteContract.writeContractAsync` | — |
| Tying the relayer to a single chain | The provider's `network` config is per-chain | Read `useChainId()` and route to `MainnetConfig` / `SepoliaConfig` from `@zama-fhe/sdk` | — |

The frontend-targeted AP rules (AP-019, AP-020, AP-021) are documented in `references/15-failure-modes.md` and detected by `fhevm-lint` once you pass a `.ts`/`.tsx` directory (the linter scans regex patterns in JS/TS for these specific anti-patterns; the Solidity AST checks remain `.sol`-only).
