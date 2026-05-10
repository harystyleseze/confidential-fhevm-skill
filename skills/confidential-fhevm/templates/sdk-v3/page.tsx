"use client";

// SDK v3 page template. Demonstrates the UX patterns from
// references/17-ux-patterns.md in a generic, contract-agnostic shell:
//
//   - Disconnected hero with Connect Wallet
//   - Lifecycle stepper (rename labels for your domain)
//   - RoleBanner pattern (admin / member / spectator)
//   - Local-dev onboarding (anvil dev key, chain id 31337 only)
//   - CopyableCode chips for handles and addresses
//   - Single primary action card driven by (role × stage)
//   - Collapsible "How does this stay private?" explainer
//   - Collapsible on-chain state panel
//   - Inline status banner (no toasts/modals)
//
// Replace `useMyContract` with your hook (see useFHEContract.tsx).

import { useState } from "react";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ClipboardIcon,
  EyeSlashIcon,
  KeyIcon,
  LockClosedIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import { useAccount, useChainId } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/helper/RainbowKitCustomConnectButton";
import { useMyContract } from "~~/hooks/my-feature/useMyContract";

const ANVIL_DEPLOYER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ANVIL_DEPLOYER_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

/* ---------------------------- styling primitives ---------------------------- */

const buttonBase =
  "inline-flex items-center justify-center gap-2 px-5 py-3 font-semibold rounded-lg shadow-sm transition-all duration-200 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed";
const primary = `${buttonBase} bg-[#FFD208] text-[#1a1a1a] hover:bg-[#e6bd00] focus-visible:ring-[#1a1a1a] cursor-pointer`;
const ghost = `${buttonBase} bg-white text-[#1a1a1a] border border-[#1a1a1a]/15 hover:border-[#1a1a1a]/40 hover:bg-[#1a1a1a]/[0.03] cursor-pointer`;

const card = "bg-white rounded-2xl border border-[#1a1a1a]/10 shadow-sm";
const cardHeader = "px-6 pt-5 pb-3 flex items-center gap-2 text-lg font-semibold text-[#1a1a1a]";
const cardBody = "px-6 pb-6";

function shortAddr(a?: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—";
}

/* ---------------------------- reusable components ---------------------------- */

export function CopyableCode({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="group inline-flex items-center gap-2 font-mono text-xs bg-[#1a1a1a]/5 hover:bg-[#1a1a1a]/10 border border-[#1a1a1a]/10 rounded px-2 py-1 transition cursor-pointer"
      title="Click to copy"
    >
      <span className="truncate max-w-[28ch] sm:max-w-[44ch]">{value}</span>
      {copied ? (
        <CheckCircleIcon className="w-4 h-4 text-emerald-600 shrink-0" />
      ) : (
        <ClipboardIcon className="w-4 h-4 text-[#1a1a1a]/50 group-hover:text-[#1a1a1a] shrink-0" />
      )}
    </button>
  );
}

/** Three-step lifecycle indicator. Rename labels per your contract's state machine. */
export function LifecycleStepper({
  stage,
  labels = ["Set up", "Active", "Reveal"],
}: {
  stage: "setup" | "active" | "reveal" | "done";
  labels?: [string, string, string];
}) {
  const idx = stage === "setup" ? 0 : stage === "active" ? 1 : stage === "reveal" ? 2 : 3;
  const circleBase = "w-10 h-10 rounded-full flex items-center justify-center font-bold border-2 transition-all";
  return (
    <div className="flex items-start justify-center gap-3 sm:gap-6">
      {labels.map((label, i) => {
        const active = idx === i;
        const done = idx > i;
        const circle = done
          ? `${circleBase} bg-emerald-500 border-emerald-500 text-white`
          : active
            ? `${circleBase} bg-[#FFD208] border-[#FFD208] text-[#1a1a1a] shadow-lg shadow-[#FFD208]/30`
            : `${circleBase} bg-white border-[#1a1a1a]/20 text-[#1a1a1a]/40`;
        const text = active ? "text-[#1a1a1a] font-semibold" : done ? "text-emerald-700" : "text-[#1a1a1a]/40";
        return (
          <div key={label} className="flex items-start gap-3 sm:gap-6">
            <div className="flex flex-col items-center text-center min-w-[7rem]">
              <div className={circle}>{done ? <CheckCircleIcon className="w-6 h-6" /> : i + 1}</div>
              <div className={`mt-2 text-sm ${text}`}>{label}</div>
            </div>
            {i < labels.length - 1 && (
              <div className={`mt-5 h-0.5 w-8 sm:w-16 ${done ? "bg-emerald-500" : "bg-[#1a1a1a]/15"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Role-aware empty state. Always render — don't hide a role's section behind a disabled button. */
export function RoleBanner({
  role,
  address,
  isLocalChain,
  isAdmin,
}: {
  role: "admin" | "member" | "spectator";
  address?: `0x${string}`;
  isLocalChain: boolean;
  isAdmin: boolean;
}) {
  if (role === "admin")
    return (
      <div className="rounded-2xl border border-[#FFD208]/60 bg-[#FFD208]/15 px-6 py-4 flex items-center gap-3">
        <ShieldCheckIcon className="w-6 h-6 text-[#1a1a1a] shrink-0" />
        <div className="text-sm text-[#1a1a1a]">
          <strong>You&apos;re the admin.</strong> Replace this copy with the admin actions for your contract.
        </div>
      </div>
    );
  if (role === "member")
    return (
      <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-6 py-4 flex items-center gap-3">
        <CheckCircleIcon className="w-6 h-6 text-emerald-700 shrink-0" />
        <div className="text-sm text-emerald-900">
          <strong>You&apos;re a registered member.</strong> Replace with member-specific actions.
        </div>
      </div>
    );
  return (
    <div className="rounded-2xl border border-[#1a1a1a]/15 bg-[#1a1a1a]/[0.03] px-6 py-4 space-y-3">
      <div className="flex items-start gap-3">
        <EyeSlashIcon className="w-6 h-6 text-[#1a1a1a]/60 shrink-0 mt-0.5" />
        <div className="text-sm text-[#1a1a1a]/80">
          <strong>You&apos;re a spectator.</strong> Wallet <span className="font-mono">{shortAddr(address)}</span> has
          read-only access. Explain how the user can become a member here — e.g. "ask the admin to call addMember
          on your address".
        </div>
      </div>
      {isLocalChain && !isAdmin && (
        <div className="rounded-xl border border-[#FFD208]/40 bg-white px-4 py-3 text-xs space-y-2">
          <div className="flex items-center gap-2 font-semibold text-[#1a1a1a]">
            <KeyIcon className="w-4 h-4 text-[#FFD208]" />
            Testing locally? Become the admin in one click.
          </div>
          <p className="text-[#1a1a1a]/70">
            This is the deployer (anvil dev account #0 on chain id 31337). Public dev key — never use on a real network.
          </p>
          <ol className="list-decimal pl-5 text-[#1a1a1a]/80 space-y-1">
            <li>
              MetaMask → account menu → <strong>Import account</strong>.
            </li>
            <li>Paste the private key below.</li>
            <li>Switch to that account and refresh.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[#1a1a1a]/60">Address:</span>
            <CopyableCode value={ANVIL_DEPLOYER_ADDR} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[#1a1a1a]/60">Private key:</span>
            <CopyableCode value={ANVIL_DEPLOYER_PK} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Collapsible "how does this stay private?" explainer — always include on the home page. */
export function HowItWorks() {
  const [open, setOpen] = useState(false);
  return (
    <div className={card}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-6 py-4 flex items-center justify-between gap-3 cursor-pointer"
      >
        <div className="flex items-center gap-2 text-lg font-semibold text-[#1a1a1a]">
          <SparklesIcon className="w-5 h-5 text-[#FFD208]" />
          How does this stay private?
        </div>
        <ChevronDownIcon className={`w-5 h-5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-6 pb-6 -mt-1 text-sm text-[#1a1a1a]/80 space-y-3">
          <p>
            <strong>1. Inputs are encrypted in the browser</strong> using Zama&apos;s FHE keys. The chain only sees
            a ciphertext handle.
          </p>
          <p>
            <strong>2. The contract computes on ciphertexts</strong> using FHE arithmetic. Validators and storage
            readers learn nothing.
          </p>
          <p>
            <strong>3. Reveal is explicit and proof-backed.</strong> A threshold-KMS ceremony produces a proof
            verified on-chain in <code className="bg-[#1a1a1a]/5 px-1 rounded">FHE.checkSignatures</code>.
          </p>
          <p>
            <strong>4. Only aggregates are revealed.</strong> Individual inputs stay private forever.
          </p>
        </div>
      )}
    </div>
  );
}

/* ---------------------------- main page ---------------------------- */

export default function Page() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const c = useMyContract();
  const [showState, setShowState] = useState(false);
  const [input, setInput] = useState(1);

  const isLocalChain = chainId === 31337;
  // Derive the role from your hook's outputs. The template assumes booleans isAdmin/isMember; rename for your contract.
  const role: "admin" | "member" | "spectator" =
    (c as { isAdmin?: boolean }).isAdmin
      ? "admin"
      : (c as { isMember?: boolean }).isMember
        ? "member"
        : "spectator";
  // Pick a stage label set that matches your domain (voting, auction, token wrap, payroll, etc.).
  const stage: "setup" | "active" | "reveal" | "done" = "active"; // replace with your derivation

  if (!isConnected) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-16">
        <div className="max-w-2xl w-full text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#FFD208]/20 text-[#1a1a1a] mb-6">
            <LockClosedIcon className="w-8 h-8" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-[#1a1a1a] tracking-tight mb-4">
            My Confidential dApp
          </h1>
          <p className="text-lg text-[#1a1a1a]/70 max-w-xl mx-auto mb-8">
            One-line value prop. Mention the encrypted bit. Mention what gets revealed and when.
          </p>
          <div className="flex justify-center">
            <RainbowKitCustomConnectButton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-3 sm:px-6 py-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="text-center pt-4 pb-2">
          <h1 className="text-3xl sm:text-4xl font-bold text-[#1a1a1a] tracking-tight mb-2 flex items-center justify-center gap-3">
            <LockClosedIcon className="w-8 h-8 text-[#FFD208]" />
            My Confidential dApp
          </h1>
          <p className="text-[#1a1a1a]/70 max-w-2xl mx-auto">One-line value prop.</p>
        </header>

        <div className={card}>
          <div className="px-6 py-6">
            <LifecycleStepper stage={stage} labels={["Set up", "Active", "Reveal"]} />
          </div>
        </div>

        <RoleBanner role={role} address={address} isLocalChain={isLocalChain} isAdmin={role === "admin"} />

        {/* PRIMARY ACTION — render exactly one card based on (role × stage). */}
        <div className={card}>
          <div className={cardHeader}>
            <LockClosedIcon className="w-5 h-5 text-[#FFD208]" />
            Primary action for this state
          </div>
          <div className={cardBody}>
            <p className="text-sm text-[#1a1a1a]/70 mb-4">
              Replace this card with the action the current user can take, given <code>role</code> and{" "}
              <code>stage</code>. Only render the one CTA that&apos;s reachable now — never render disabled buttons.
            </p>
            <div className="flex flex-wrap items-end gap-4">
              <label className="block">
                <span className="block text-xs uppercase tracking-wide text-[#1a1a1a]/50 mb-1">Value</span>
                <input
                  type="number"
                  min={0}
                  value={input}
                  onChange={e => setInput(Math.max(0, Number(e.target.value) | 0))}
                  className="border border-[#1a1a1a]/20 rounded-lg px-3 py-2 w-40 font-mono text-sm"
                />
              </label>
              <button className={primary} onClick={() => c.setValue?.(input)} disabled={c.isProcessing}>
                {c.isProcessing ? (
                  <>
                    <ArrowPathIcon className="w-4 h-4 animate-spin" /> Encrypting…
                  </>
                ) : (
                  <>
                    <LockClosedIcon className="w-4 h-4" /> Submit encrypted ({input})
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* COLLAPSIBLE on-chain state */}
        <div className={card}>
          <button
            type="button"
            onClick={() => setShowState(!showState)}
            className="w-full px-6 py-4 flex items-center justify-between gap-3 cursor-pointer"
          >
            <div className="flex items-center gap-2 text-lg font-semibold text-[#1a1a1a]">
              <EyeSlashIcon className="w-5 h-5 text-[#1a1a1a]/60" />
              On-chain state {showState ? "" : "(click to expand)"}
            </div>
            <ChevronDownIcon className={`w-5 h-5 transition-transform ${showState ? "rotate-180" : ""}`} />
          </button>
          {showState && (
            <div className={cardBody}>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <dt className="text-[#1a1a1a]/50 uppercase tracking-wide text-xs mb-1">Contract</dt>
                  <dd>
                    <CopyableCode value={c.contractAddress ?? "no deployment"} />
                  </dd>
                </div>
                <div>
                  <dt className="text-[#1a1a1a]/50 uppercase tracking-wide text-xs mb-1">Handle (encrypted)</dt>
                  <dd>
                    <CopyableCode value={c.handle ?? "—"} />
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>

        <HowItWorks />

        {c.message && (
          <div className="rounded-2xl border border-[#FFD208]/50 bg-[#FFD208]/10 px-6 py-4 text-sm text-[#1a1a1a]">
            {c.message}
          </div>
        )}
      </div>
    </div>
  );
}
