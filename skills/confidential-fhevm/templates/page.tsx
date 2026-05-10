"use client";

import {useState} from "react";
import {useAccount, useWalletClient} from "wagmi";
import {ConnectButton} from "@rainbow-me/rainbowkit";

export default function MyContractPage() {
  const {address, isConnected} = useAccount();
  const {data: walletClient} = useWalletClient();

  const [balance, setBalance] = useState<bigint | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-base-200 flex items-center justify-center p-4">
        <div className="card bg-base-100 shadow-xl max-w-md w-full">
          <div className="card-body items-center text-center">
            <h2 className="card-title text-2xl mb-4">Connect Your Wallet</h2>
            <p className="text-base-content/60 mb-6">
              Connect your wallet to interact with encrypted data.
            </p>
            <ConnectButton />
          </div>
        </div>
      </div>
    );
  }

  const handleDecrypt = async () => {
    if (!walletClient || !address) return;
    setIsDecrypting(true);
    setStatusMessage("Decrypting… you may need to sign a message in your wallet.");
    try {
      // Replace with actual SDK decryption — see references/09-frontend-patterns.md
      // Example with @zama-fhe/sdk:
      //   const token = sdk.createToken(contractAddress);
      //   const clear = await token.balanceOf();
      //   setBalance(clear);
      setStatusMessage("Balance decrypted.");
    } catch (err) {
      setStatusMessage("Decryption failed. Check console.");
      console.error(err);
    } finally {
      setIsDecrypting(false);
    }
  };

  const handleSubmit = async () => {
    if (!walletClient || !address || !inputValue) return;
    const parsedValue = Math.floor(Number(inputValue));
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      setStatusMessage("Please enter a non-negative whole number.");
      return;
    }

    setIsProcessing(true);
    setStatusMessage("Encrypting your value…");
    try {
      // Encryption + tx submission. Example with the relayer SDK:
      //   const enc = await fhevm
      //     .createEncryptedInput(contractAddress, address)
      //     .add64(parsedValue)
      //     .encrypt();
      //   setStatusMessage("Sending transaction…");
      //   const tx = await contract.setValue(enc.handles[0], enc.inputProof);
      //   await tx.wait();
      setStatusMessage("Transaction confirmed.");
      setInputValue("");
    } catch (err) {
      setStatusMessage("Transaction failed. Check console.");
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-base-200 p-4 md:p-8">
      <div className="navbar bg-base-100 rounded-box mb-6 shadow-lg">
        <div className="flex-1">
          <span className="text-xl font-bold text-primary">My dApp</span>
        </div>
        <div className="flex-none">
          <ConnectButton />
        </div>
      </div>

      <div className="max-w-4xl mx-auto">
        <div className="card bg-base-100 shadow-xl mb-6">
          <div className="card-body">
            <h2 className="card-title">Encrypted Balance</h2>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="text-3xl font-bold text-primary">
                {isDecrypting ? (
                  <span className="loading loading-dots loading-lg" />
                ) : balance !== null ? (
                  balance.toString()
                ) : (
                  <span className="text-base-content/30">Encrypted</span>
                )}
              </div>
              <button
                className="btn btn-outline btn-primary btn-sm"
                onClick={handleDecrypt}
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting…" : "Decrypt"}
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h2 className="card-title">Set Value</h2>
              <p className="text-sm text-base-content/60">
                Your value is encrypted in your browser before submission.
              </p>
              <div className="form-control mt-4">
                <input
                  type="number"
                  placeholder="Enter a value"
                  className="input input-bordered w-full"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  disabled={isProcessing}
                  min="0"
                />
              </div>
              <div className="card-actions mt-4">
                <button
                  className="btn btn-primary w-full"
                  onClick={handleSubmit}
                  disabled={isProcessing || !inputValue}
                >
                  {isProcessing ? (
                    <>
                      <span className="loading loading-spinner loading-sm" /> Processing…
                    </>
                  ) : (
                    "Encrypt & Submit"
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h2 className="card-title">How It Works</h2>
              <ul className="steps steps-vertical text-sm">
                <li className="step step-primary">Enter your value</li>
                <li className="step step-primary">Value is encrypted in your browser</li>
                <li className="step">Encrypted value sent to the blockchain</li>
                <li className="step">Only you can decrypt and view it</li>
              </ul>
            </div>
          </div>
        </div>

        {statusMessage && (
          <div className="alert mt-6 shadow-lg">
            <span>{statusMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}
