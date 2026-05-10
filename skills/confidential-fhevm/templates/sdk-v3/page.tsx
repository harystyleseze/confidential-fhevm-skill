"use client";

// SDK v3 Next.js page template. Mirrors the `fhevm-react-template`'s default
// `app/page.tsx` shape but uses our `useMyContract` hook. Three states:
//   - wallet disconnected → connect button
//   - connected, no value yet → encrypt + submit form
//   - connected, value set → handle + decrypt button + cleartext

import { useState } from "react";
import { useAccount } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/helper/RainbowKitCustomConnectButton";
import { useMyContract } from "~~/hooks/my-feature/useMyContract";

const buttonBase =
  "inline-flex items-center justify-center px-6 py-3 font-semibold shadow-lg transition-all duration-200 hover:scale-105 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 " +
  "disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed";
const primary = `${buttonBase} bg-[#FFD208] text-[#2D2D2D] hover:bg-[#A38025] focus-visible:ring-[#2D2D2D] cursor-pointer`;
const secondary = `${buttonBase} bg-black text-[#F4F4F4] hover:bg-[#1F1F1F] focus-visible:ring-[#FFD208] cursor-pointer`;

export default function Page() {
  const { isConnected } = useAccount();
  const c = useMyContract();
  const [input, setInput] = useState(1);

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center w-full px-3">
        <div className="max-w-2xl mx-auto p-6 mt-12 bg-white shadow-xl text-center">
          <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Connect your wallet</h2>
          <p className="text-gray-700 mb-6">Connect to interact with the encrypted contract.</p>
          <div className="flex justify-center"><RainbowKitCustomConnectButton /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center w-full px-3">
      <div className="max-w-3xl mx-auto p-6 space-y-6 text-gray-900">
        <h1 className="text-3xl font-bold text-center mb-2">My Confidential Contract</h1>

        <div className="bg-[#f4f4f4] shadow-lg p-6">
          <h3 className="font-bold text-xl mb-4 border-b pb-2">Encrypted handle</h3>
          <div className="flex justify-between items-center py-2 px-3 bg-white border w-full">
            <span className="font-medium">Handle</span>
            <span className="ml-2 font-mono text-sm break-all">{c.handle ?? "—"}</span>
          </div>
          <div className="flex justify-between items-center py-2 px-3 bg-white border w-full mt-2">
            <span className="font-medium">Cleartext</span>
            <span className="ml-2 font-mono text-sm">{c.isDecrypted ? String(c.clearValue) : "(encrypted)"}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            className={primary}
            onClick={c.decryptHandle}
            disabled={c.isProcessing || c.isDecrypting || !c.handle || c.handle === "0x0000000000000000000000000000000000000000000000000000000000000000"}
          >
            {c.isDecrypting ? "⏳ Decrypting…" : c.isAllowing ? "⏳ Authorising…" : "🔓 Decrypt"}
          </button>

          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              value={input}
              onChange={e => setInput(Math.max(0, Number(e.target.value) | 0))}
              className="border border-gray-300 px-3 py-2 w-32"
            />
            <button className={secondary} onClick={() => c.setValue(input)} disabled={c.isProcessing}>
              {c.isProcessing ? "⏳ Encrypting…" : `Encrypt & set (${input})`}
            </button>
          </div>
        </div>

        {c.message && (
          <div className="bg-white border p-4 text-sm text-gray-800 break-words">{c.message}</div>
        )}
      </div>
    </div>
  );
}
