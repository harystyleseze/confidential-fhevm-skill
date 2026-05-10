"use client";

// Should fire: AP-020 (awaited fire-and-forget mutate calls).
import { useEncrypt } from "@zama-fhe/react-sdk";

export function BadAwait() {
  const encrypt = useEncrypt();

  return {
    async run() {
      // BUG: mutate() returns void; awaiting it gives undefined.
      const result = await encrypt.mutate({
        values: [{ value: 1n, type: "euint64" }],
        contractAddress: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        userAddress: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      });
      return result;
    },
  };
}
