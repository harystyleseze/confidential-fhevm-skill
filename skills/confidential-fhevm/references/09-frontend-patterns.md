# 09 — Frontend Patterns for FHEVM dApps (SDK v2)

> **For SDK v3 (the current canonical, shipped with `fhevm-react-template` today), see [`14-sdk-v3-frontend.md`](14-sdk-v3-frontend.md).** This document covers `@zama-fhe/sdk` v2 patterns — the older `Token` class API and the removed `useFhevm` / `useFHEEncryption` / `useFHEDecrypt` hooks. Use it when maintaining an existing v2 codebase or porting a v2 app forward.
>
> The credential-lifecycle, loading-state, and two-phase-unshield principles below apply to both SDK versions; only the API names change.

## Credential Lifecycle

The SDK manages FHE keypairs and EIP-712 signatures automatically, but understanding the lifecycle helps design better UX.

**First interaction**: When the user first calls `token.balanceOf()` or any decrypt operation:
1. SDK generates an FHE keypair (public + private key)
2. SDK creates an EIP-712 message authorizing the KMS to decrypt
3. User sees a **wallet popup** asking them to sign the EIP-712 message
4. SDK encrypts the private key with AES-GCM (key derived from signature via PBKDF2, 600K iterations) and stores it in IndexedDB
5. SDK caches the signature in session storage

**Subsequent interactions** (same session): No wallet popup. The cached credentials are reused.

**After TTL expires** (default 30 days): The keypair expires. Next decrypt triggers a new keypair generation and a new wallet popup.

**UX recommendation**: Tell users upfront that they'll see one wallet signature request. Display a message like "Sign to authorize encrypted data access" before the popup appears.

```typescript
const sdk = new ZamaSDK({
  // ...
  keypairTTL: 30 * 24 * 60 * 60 * 1000, // 30 days
  sessionTTL: 30 * 24 * 60 * 60 * 1000, // 30 days
  // sessionTTL: 0  → re-sign every operation (high security, bad UX)
  // sessionTTL: "infinite" → never re-sign (low security, good UX)
  onEvent: (event) => {
    if (event.type === "credentials:creating") {
      showNotification("Please sign in your wallet to authorize encrypted data access");
    }
    if (event.type === "credentials:created") {
      dismissNotification();
    }
  },
});
```

## Loading States During Encryption

FHE encryption runs in a Web Worker (browser) using WASM. Typical latency is 1-3 seconds depending on the number and size of encrypted values. Always show a loading indicator.

```tsx
function TransferForm() {
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const handleTransfer = async () => {
    try {
      setIsEncrypting(true);
      // Encryption happens here (1-3s)
      const result = await token.confidentialTransfer(recipientAddress, amount);
      setIsEncrypting(false);
      setIsSending(true);
      // Wait for transaction confirmation
      // result.txHash is available immediately
      setIsSending(false);
    } catch (err) {
      setIsEncrypting(false);
      setIsSending(false);
      handleError(err);
    }
  };

  return (
    <div>
      <button
        onClick={handleTransfer}
        disabled={isEncrypting || isSending}
        className="btn btn-primary"
      >
        {isEncrypting ? (
          <><span className="loading loading-spinner loading-sm" /> Encrypting...</>
        ) : isSending ? (
          <><span className="loading loading-spinner loading-sm" /> Confirming...</>
        ) : (
          "Transfer"
        )}
      </button>
    </div>
  );
}
```

## Two-Phase Unshield with Page-Reload Persistence

Unshielding (unwrapping confidential tokens back to ERC-20) is a two-phase async process. If the user closes the browser between phases, the pending unshield is lost unless you persist it.

```typescript
import {
  savePendingUnshield,
  loadPendingUnshield,
  clearPendingUnshield,
} from "@zama-fhe/sdk";

// On page load: check for pending unshields
async function resumePendingUnshields(sdk: ZamaSDK, storage: GenericStorage) {
  const pending = await loadPendingUnshield(storage, tokenAddress);
  if (pending) {
    const token = sdk.createToken(tokenAddress);
    try {
      await token.resumeUnshield(pending, {
        onPhase2Started: () => showToast("Resuming unshield..."),
        onPhase2Submitted: () => {
          clearPendingUnshield(storage, tokenAddress);
          showToast("Unshield complete!");
        },
      });
    } catch (err) {
      // Handle error — the pending unshield may have already been finalized
      clearPendingUnshield(storage, tokenAddress);
    }
  }
}

// When starting a new unshield
async function handleUnshield(amount: bigint) {
  const token = sdk.createToken(tokenAddress);
  await token.unshield(amount, {
    onPhase1Submitted: (txHash) => {
      // CRITICAL: persist immediately after phase 1
      savePendingUnshield(storage, tokenAddress, txHash);
      showToast("Phase 1 submitted, decrypting...");
    },
    onPhase2Started: () => showToast("Decryption received, finalizing..."),
    onPhase2Submitted: () => {
      clearPendingUnshield(storage, tokenAddress);
      showToast("Unshield complete!");
    },
  });
}
```

## Error Handling with Typed SDK Errors

The SDK provides specific error classes for each failure mode. Catch them explicitly for user-friendly messages.

```typescript
import {
  SigningRejectedError,
  InsufficientConfidentialBalanceError,
  InsufficientERC20BalanceError,
  EncryptionFailedError,
  DecryptionFailedError,
  TransactionRevertedError,
  ApprovalFailedError,
  NoCiphertextError,
  AclPausedError,
} from "@zama-fhe/sdk";

function handleError(err: unknown) {
  if (err instanceof SigningRejectedError) {
    showToast("Signature cancelled. Please try again.", "warning");
  } else if (err instanceof InsufficientConfidentialBalanceError) {
    showToast("Not enough encrypted balance for this transfer.", "error");
  } else if (err instanceof InsufficientERC20BalanceError) {
    showToast("Not enough tokens to shield. Check your wallet balance.", "error");
  } else if (err instanceof EncryptionFailedError) {
    showToast("Encryption failed. Please refresh and try again.", "error");
  } else if (err instanceof NoCiphertextError) {
    showToast("No encrypted balance found. Shield tokens first.", "info");
  } else if (err instanceof AclPausedError) {
    showToast("The protocol is currently paused for maintenance.", "warning");
  } else {
    showToast("An unexpected error occurred.", "error");
    console.error(err);
  }
}
```

## Batch Operations for Multiple Tokens

Pre-authorize multiple tokens with a single wallet signature:

```typescript
const tokens = [
  sdk.createReadonlyToken(tokenA),
  sdk.createReadonlyToken(tokenB),
  sdk.createReadonlyToken(tokenC),
];

// One signature covers all three tokens
await ReadonlyToken.allow(...tokens);

// Now decrypt all balances without additional popups
const balances = await ReadonlyToken.batchDecryptBalances(tokens);
// balances = { [tokenA]: 1000n, [tokenB]: 5000n, [tokenC]: 200n }
```

## Delegation Pattern

One user authorizes another to decrypt their balances (e.g., a portfolio manager viewing client balances).

```typescript
// Client grants manager permission to view their token balances
const token = sdk.createToken(tokenAddress);
await token.delegateDecryption({
  delegateAddress: managerAddress,
  expirationDate: new Date("2025-12-31"),
});

// Manager decrypts client's balance
const managerToken = sdk.createReadonlyToken(tokenAddress);
const clientBalance = await managerToken.decryptBalanceAs({
  delegatorAddress: clientAddress,
});
```

Revoke delegation:
```typescript
await token.revokeDelegation({delegateAddress: managerAddress});
```

## Responsive Dashboard Pattern

A complete responsive layout for a confidential token dashboard:

```tsx
export default function Dashboard() {
  return (
    <div className="min-h-screen bg-base-200 p-4 md:p-8">
      {/* Header with wallet connection */}
      <div className="navbar bg-base-100 rounded-box mb-6 shadow-lg">
        <div className="flex-1">
          <span className="text-xl font-bold text-primary">My dApp</span>
        </div>
        <div className="flex-none">
          <ConnectButton />
        </div>
      </div>

      {/* Stats row — 1 column on mobile, 3 on desktop */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard title="Encrypted Balance" value={balance} loading={isDecrypting} />
        <StatCard title="Public Balance" value={publicBalance} />
        <StatCard title="Pending Unshields" value={pendingCount} />
      </div>

      {/* Action cards — stack on mobile, side-by-side on tablet+ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ShieldCard onShield={handleShield} />
        <TransferCard onTransfer={handleTransfer} />
      </div>
    </div>
  );
}

function StatCard({title, value, loading}: {title: string; value?: bigint; loading?: boolean}) {
  return (
    <div className="card bg-base-100 shadow-md">
      <div className="card-body p-4">
        <h3 className="card-title text-sm text-base-content/60">{title}</h3>
        {loading ? (
          <span className="loading loading-dots loading-md text-primary" />
        ) : (
          <p className="text-2xl font-bold">{value?.toString() ?? "---"}</p>
        )}
      </div>
    </div>
  );
}
```

## COOP/COEP Headers — When to Use (and When NOT to)

The relayer SDK uses WASM with optional multi-threading via `wasm-bindgen-rayon`. Multi-threading requires these HTTP headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**However, these headers break many common integrations:**
- CDN-hosted fonts (Google Fonts, Fontshare) are blocked unless they send `Cross-Origin-Resource-Policy: cross-origin`
- Coinbase Wallet SDK popup communication fails (requires COOP to NOT be `same-origin`)
- Any cross-origin image, script, or stylesheet without explicit CORP headers is blocked

**Recommendation for most dApps: Do NOT add these headers.** Single-threaded WASM works correctly — encryption takes 1-3 seconds instead of sub-second. This is perfectly acceptable for demos, hackathons, and most production apps.

**If you need multi-threading in production:**
- Use `Cross-Origin-Embedder-Policy: credentialless` instead of `require-corp` (more permissive, still enables SharedArrayBuffer in some browsers)
- Or apply COEP only to specific routes that don't load cross-origin resources
- Or self-host all fonts and external resources

The official `fhevm-react-template` does NOT include COOP/COEP headers and works correctly out of the box.
