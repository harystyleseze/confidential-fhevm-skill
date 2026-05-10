# 12 — Production Edge Cases

> Open when polishing a dApp for real use. These are gotchas not obvious from the docs alone — each one was discovered in production debugging.

## Contents
1. Encrypted integers are whole numbers
2. `buildParamsFromAbi` only works for encryption-only functions
3. Decryption is async — results land on re-render
4. Decode contract error selectors for users
5. COOP/COEP headers break external resources
6. `scaffold.config.ts` network order matters
7. FHEVM init takes 10–30s on Sepolia
8. Etherscan V2 API migration
9. Decimals: `euint64` max ≈ 1.8e19, ERC-7984 ≤6 decimals
10. Initial state is `ethers.ZeroHash`, not encrypted-zero

---

## 1. Encrypted integers are whole numbers

`euint64` stores integers, not decimals. A user typing `0.01` becomes `0` after `parseInt`. Always validate before encryption:

```typescript
const amount = Math.floor(Number(userInput));
if (!Number.isFinite(amount) || amount <= 0) {
  showError("Amount must be a whole number greater than 0");
  return;
}
```

For ERC-7984 tokens, the encrypted balance is in *token units of 6 decimals*. A user-facing amount of `1.5` → `1_500_000` on the wire.

## 2. `buildParamsFromAbi` only works for encryption-only functions

`buildParamsFromAbi` from `@fhevm-sdk` works for functions where ALL parameters are encrypted (e.g. `increment(externalEuint32, bytes)`). For mixed signatures, pass handles and proof directly:

```typescript
// DON'T: crashes on non-encrypted params (BigInt conversion error)
const params = buildParamsFromAbi(enc, abi, "createInvoice");
const tx = await contract.createInvoice(...params, maturityDate);

// DO: pass handles and proof explicitly
const tx = await contract.createInvoice(enc.handles[0], enc.inputProof, maturityDate);
```

## 3. Decryption is async — results land on re-render

`useFHEDecrypt.decrypt()` initiates the EIP-712 + KMS round-trip. The `results` object is NOT populated when `decrypt()` returns — it updates asynchronously via React re-render. Watch with `useEffect`:

```typescript
const { decrypt, results, isDecrypting } = useFHEDecrypt({ instance, ethersSigner, ... });

useEffect(() => {
  if (results[handle] !== undefined) {
    setDecryptedValue(BigInt(results[handle].toString()));
  }
}, [results, handle]);
```

## 4. Decode contract error selectors

When a contract reverts with a custom error, ethers.js shows `missing revert data` plus a hex selector. Map known selectors to user-friendly messages:

```typescript
const KNOWN_ERRORS: Record<string, string> = {
  "0x5d5a323c": "You are not registered as an auditor.",
  "0xbaf3f0f7": "This invoice is not in the correct state for this action.",
};

function decodeError(err: any): string {
  const data = err?.data || err?.error?.data;
  if (typeof data === "string") {
    const selector = data.slice(0, 10);
    if (KNOWN_ERRORS[selector]) return KNOWN_ERRORS[selector];
  }
  return err?.reason || err?.shortMessage || "Transaction failed";
}
```

## 5. COOP/COEP headers break external resources

Adding `Cross-Origin-Embedder-Policy: require-corp` enables multi-threaded WASM encryption but blocks CDN fonts, Coinbase Wallet, and any cross-origin resource without explicit CORP headers. **For most dApps, skip these headers** — single-threaded encryption (1–3s) is fine. The official `fhevm-react-template` does NOT include them.

## 6. `scaffold.config.ts` network order matters

The first network in `targetNetworks` is the default. If testing on Sepolia, put Sepolia first. If `chains.hardhat` is first and no local node is running, the frontend spams `ERR_CONNECTION_REFUSED` errors trying to reach `localhost:8545`.

## 7. FHEVM init takes 10–30 seconds on Sepolia

The `useFhevm` hook walks through: `idle → loading → sdk-initializing → sdk-initialized → creating → ready`. Show a loading indicator throughout. The `creating` step fetches the FHE public key from the relayer — this is the slowest part.

## 8. Etherscan V2 API migration

Since May 2025, `etherscan.apiKey` must be a single string, not a per-network object. Add `sourcify: { enabled: true }` as a fallback verifier — no API key required.

## 9. Decimals overflow

`euint64` max = 18 446 744 073 709 551 615 ≈ 1.8 × 10^19. With 6 decimals, that supports ~18.4 trillion tokens. Going to 7+ decimals risks overflow on basic adds.

When wrapping an 18-decimal ERC-20 into a 6-decimal ERC-7984, scale down at the wrapper boundary: `confidentialAmount = userInput / 10^12`. Refund any dust below 10^12.

## 10. Initial state is `ethers.ZeroHash`, not encrypted-zero

An `euint64` mapping entry that was never written reads back as `bytes32(0)`, not as an encryption of zero. **Always check `handle === ethers.ZeroHash` before attempting decryption** — calling `userDecryptEuint` on a zero-hash handle throws.

```typescript
if (handle === ethers.ZeroHash) {
  return 0n;   // never set
}
const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddress, signer);
```
