# FHEVM Type System

## Choosing the Right Type

Every encrypted value costs gas proportional to its bit width. A comparison on `euint8` is significantly cheaper than on `euint128`. The decision matrix:

| Data represents | Recommended type | Why |
|----------------|-----------------|-----|
| True/false flag | `ebool` | 2-bit, cheapest. Only supports boolean operations (and, or, xor, not, eq, ne, select). |
| Percentage, score, small enum | `euint8` | 8-bit, fits 0-255. Full arithmetic + comparison + bitwise. |
| Token amounts, prices, balances | `euint64` | 64-bit, fits up to ~1.8e19. Standard for ERC-7984 tokens (6 decimals = 18.4T max). |
| Timestamps, large counters | `euint64` | Ethereum timestamps fit comfortably in 64 bits through 2554 AD. |
| Ethereum addresses | `eaddress` | 160-bit. Only supports eq, ne, select. Cannot do arithmetic on addresses. |
| Cryptographic hashes, bitfields | `euint256` | 256-bit. Only bitwise + equality ops. No arithmetic (too expensive for the coprocessor). |
| Medium-range values | `euint16`, `euint32` | Use when data exceeds euint8 but doesn't need euint64 range. |
| Very large values | `euint128` | 128-bit. Full arithmetic but more expensive than euint64. Use only when 64-bit overflows. |

## Complete Type Catalog

| Type | Bits | External Variant | Encrypt Method | FhevmType Enum | Max Value |
|------|------|-----------------|----------------|----------------|-----------|
| `ebool` | 2 | `externalEbool` | `addBool(val)` | `FhevmType.ebool` | true/false |
| `euint8` | 8 | `externalEuint8` | `add8(val)` | `FhevmType.euint8` | 255 |
| `euint16` | 16 | `externalEuint16` | `add16(val)` | `FhevmType.euint16` | 65,535 |
| `euint32` | 32 | `externalEuint32` | `add32(val)` | `FhevmType.euint32` | ~4.3e9 |
| `euint64` | 64 | `externalEuint64` | `add64(val)` | `FhevmType.euint64` | ~1.8e19 |
| `euint128` | 128 | `externalEuint128` | `add128(val)` | `FhevmType.euint128` | ~3.4e38 |
| `euint256` | 256 | `externalEuint256` | `add256(val)` | `FhevmType.euint256` | ~1.2e77 |
| `eaddress` | 160 | `externalEaddress` | `addAddress(val)` | `FhevmType.eaddress` | any address |

## Operation Matrix

Operations vary by type. This matrix shows exactly what is supported:

### Full operations (euint8, euint16, euint32, euint64, euint128)

| Category | Operations | Notes |
|----------|-----------|-------|
| Arithmetic | `add`, `sub`, `mul`, `div`, `rem`, `neg`, `min`, `max` | div/rem: plaintext right operand only |
| Comparison | `eq`, `ne`, `ge`, `gt`, `le`, `lt` | All return `ebool` |
| Bitwise | `and`, `or`, `xor`, `not`, `shl`, `shr`, `rotl`, `rotr` | Shift amount: `uint8` or `euint8`, computed mod bit-width |
| Conditional | `select` | `FHE.select(ebool, ifTrue, ifFalse)` |
| Random | `randEuintNN()`, `randEuintNN(bound)` | Bound must be power of 2 |

### Limited operations (ebool)

`and`, `or`, `xor`, `not`, `eq`, `ne`, `select`, `randEbool`

No arithmetic, no comparison beyond equality, no bitwise shift/rotate.

### Limited operations (eaddress / euint160)

`eq`, `ne`, `select`

No arithmetic, no bitwise, no ordering comparisons.

### Limited operations (euint256)

`and`, `or`, `xor`, `not`, `shl`, `shr`, `rotl`, `rotr`, `eq`, `ne`, `neg`, `select`, `randEuint256`, `randEuint256(bound)`

No arithmetic operations (add, sub, mul, div, rem, min, max). The coprocessor does not support arithmetic at 256-bit width due to computational cost.

## Casting Between Types

```solidity
// Trivial encryption: plaintext to encrypted (value is publicly visible on-chain)
euint64 val = FHE.asEuint64(7262);
ebool flag = FHE.asEbool(true);
eaddress addr = FHE.asEaddress(someAddress);

// Upcasting: safe, preserves value
euint64 big = FHE.asEuint64(smallEuint32);

// Downcasting: TRUNCATES without warning
euint32 small = FHE.asEuint32(largeEuint64);
// If the euint64 held a value > 2^32, the upper bits are silently dropped.

// Convert to bytes32 handle (for use in checkSignatures)
bytes32 handle = FHE.toBytes32(encryptedValue);
```

## Import Pattern

Always import the specific types you need:
```solidity
import {FHE, euint64, externalEuint64, ebool, eaddress} from "@fhevm/solidity/lib/FHE.sol";
```

Do not import `*` — explicit imports make dependencies clear and help the compiler optimize.
