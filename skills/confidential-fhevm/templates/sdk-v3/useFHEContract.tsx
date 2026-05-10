"use client";

// SDK v3 hook template — mirrors the official `fhevm-react-template`'s
// `useFHECounterWagmi` pattern. Drop into `packages/nextjs/hooks/<feature>/`.
//
// Key v3 hooks used here:
//   useEncrypt      — mutation; encrypt one or more values for a contract+user
//   useUserDecrypt  — query;    decrypt an array of handles after EIP-712 signing
//   usePublicDecrypt— mutation; threshold-decrypt handles via the relayer, returns
//                     `{ clearValues, abiEncodedClearValues, decryptionProof }` ready
//                     to feed straight into `FHE.checkSignatures(...)`
//   useAllow        — mutation; acquire keypair + EIP-712 signature for user decrypt
//   useIsAllowed    — query;    gates whether useUserDecrypt would succeed today
//
// All v3 mutation hooks return TanStack Query mutation objects — use
// `await hook.mutateAsync({...})` (NOT `hook.mutate(...)`) inside async code.

import { useCallback, useMemo, useState } from "react";
import { useAllow, useEncrypt, useIsAllowed, usePublicDecrypt, useUserDecrypt } from "@zama-fhe/react-sdk";
import { ZERO_HANDLE } from "@zama-fhe/sdk";
import { bytesToHex } from "viem";
import { useAccount, useChainId, useReadContract, useWriteContract } from "wagmi";
import { MyContract } from "~~/contracts/MyContract";
import { deploymentFor } from "~~/utils/contract";

export const useMyContract = () => {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const deployment = useMemo(() => deploymentFor(MyContract, chainId), [chainId]);

  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const hasContract = Boolean(deployment?.address && deployment?.abi);

  /* ---------------- reads ---------------- */

  const handleQuery = useReadContract({
    address: hasContract ? deployment!.address : undefined,
    abi: hasContract ? deployment!.abi : undefined,
    functionName: "getValue" as const,
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: hasContract && isConnected, refetchOnWindowFocus: false },
  });
  const handle = handleQuery.data as `0x${string}` | undefined;

  /* ---------------- writes ---------------- */

  const encrypt = useEncrypt();
  const publicDecrypt = usePublicDecrypt();
  const { writeContractAsync } = useWriteContract();

  // User-decryption gate (EIP-712 keypair + cached credentials). The first call
  // pops a wallet signature; subsequent calls reuse credentials for the configured TTL.
  const contractAddr = (deployment?.address ?? "0x0000000000000000000000000000000000000000") as `0x${string}`;
  const { mutate: allow, isPending: isAllowing } = useAllow();
  const { data: isAllowed } = useIsAllowed({ contractAddresses: [contractAddr] });

  const [decryptEnabled, setDecryptEnabled] = useState(false);
  const decrypt = useUserDecrypt(
    { handles: handle && handle !== ZERO_HANDLE ? [{ handle, contractAddress: contractAddr }] : [] },
    { enabled: decryptEnabled && Boolean(isAllowed) && Boolean(handle) && handle !== ZERO_HANDLE },
  );

  const clearValue = useMemo(() => {
    if (!handle) return undefined;
    if (handle === ZERO_HANDLE) return 0n;
    return decrypt.data?.[handle];
  }, [handle, decrypt.data]);

  const decryptHandle = useCallback(() => {
    if (!handle || handle === ZERO_HANDLE) return;
    setDecryptEnabled(true);
    if (!isAllowed) {
      setMessage("Authorising decryption (one-time wallet signature)…");
      allow([contractAddr]);
    } else {
      setMessage("Starting user decryption…");
    }
  }, [handle, isAllowed, allow, contractAddr]);

  /* ---------------- write: setValue ---------------- */

  const setValue = useCallback(
    async (value: number) => {
      if (!hasContract || !isConnected || !address || value < 0) return;
      setIsProcessing(true);
      try {
        setMessage("Encrypting…");
        const enc = await encrypt.mutateAsync({
          values: [{ value: BigInt(value), type: "euint64" }],
          contractAddress: deployment!.address,
          userAddress: address,
        });

        setMessage("Sending transaction…");
        await writeContractAsync({
          address: deployment!.address,
          abi: deployment!.abi,
          functionName: "setValue",
          args: [bytesToHex(enc.handles[0]!), bytesToHex(enc.inputProof)],
          // FHE ops are gas-intensive; cap below Sepolia's 16,777,216 block-gas limit.
          gas: 15_000_000n,
        });

        setMessage("Transaction confirmed.");
        await handleQuery.refetch();
      } catch (e) {
        setMessage(`setValue failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setIsProcessing(false);
      }
    },
    [hasContract, isConnected, address, encrypt, writeContractAsync, deployment, handleQuery],
  );

  /* ---------------- public-decrypt + on-chain finalize (illustrative) ---------------- */

  // Example helper showing how usePublicDecrypt returns a proof ready for
  // FHE.checkSignatures. Adapt to your contract's finalize function.
  const finalizeFromPublicDecrypt = useCallback(
    async (handles: `0x${string}`[], finalizeArgsBuilder: (clearValues: Record<`0x${string}`, bigint>, proof: `0x${string}`) => unknown[]) => {
      if (!hasContract) return;
      setIsProcessing(true);
      try {
        setMessage("Asking relayer to publicly decrypt…");
        const result = await publicDecrypt.mutateAsync(handles);
        setMessage("Submitting on-chain finalize…");
        await writeContractAsync({
          address: deployment!.address,
          abi: deployment!.abi,
          functionName: "finalize",
          args: finalizeArgsBuilder(result.clearValues as Record<`0x${string}`, bigint>, result.decryptionProof),
        });
        setMessage("Finalized.");
        await handleQuery.refetch();
      } catch (e) {
        setMessage(`finalize failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setIsProcessing(false);
      }
    },
    [hasContract, publicDecrypt, writeContractAsync, deployment, handleQuery],
  );

  return {
    address,
    contractAddress: deployment?.address,
    handle,
    clearValue,
    isDecrypted: clearValue !== undefined,
    isAllowed,
    isAllowing,
    isDecrypting: decrypt.isFetching,
    isProcessing,
    message,
    decryptHandle,
    setValue,
    finalizeFromPublicDecrypt,
  };
};
