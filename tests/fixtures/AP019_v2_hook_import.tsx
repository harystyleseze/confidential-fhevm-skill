"use client";

// Should fire: AP-019 (deprecated SDK v2 hook imports).
import { useFhevm, useFHEEncryption, useFHEDecrypt } from "@zama-fhe/react-sdk";

export function BadComponent() {
  // intentionally minimal — the import alone is the bug
  const _a = useFhevm;
  const _b = useFHEEncryption;
  const _c = useFHEDecrypt;
  return null;
}
