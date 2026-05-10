# 17 — UX patterns for FHEVM dApps

> Open this when building or reviewing the frontend of a confidential dApp. The patterns here are **what separates "it compiles and a button works" from "a stranger lands on `localhost:3000` and understands what to do in 10 seconds"**. Every pattern is generic — it applies to voting, auctions, tokens, payroll, anything you build on Zama.

The bounty grades **agent effectiveness**: can a developer go from prompt to a working dApp? A working dApp the user can't operate is a half-win. These patterns close that gap.

## Contents
1. Why FHEVM dApps need extra UX care
2. The lifecycle stepper
3. Role-aware empty states
4. Local-dev onboarding banner (anvil dev keys)
5. The "how does this stay private?" explainer
6. Copyable handles + addresses
7. Lifecycle-aware primary action (only one CTA at a time)
8. Finalized-result presentation
9. The collapsible "on-chain state" panel
10. Status messages without modal noise

---

## 1. Why FHEVM dApps need extra UX care

Confidential dApps surface concepts a typical Web3 user has never seen:
- Encrypted handles instead of plaintext numbers (`0x9bcc...` instead of `42`)
- Multi-step async flows for public reveal
- Different views per role (admin / member / spectator) on the same address
- Encryption that takes 1–3 seconds during which the UI must explain what's happening

The default scaffold (`fhevm-react-template`'s `FHECounter` demo) is fine for showing the **plumbing** but does not teach these UX patterns. Apply the patterns below on top of it.

## 2. The lifecycle stepper

Every confidential dApp has a state machine. Surface it at the top of the page so users see where they are.

```tsx
function LifecycleStepper({ stage }: { stage: "setup" | "active" | "reveal" | "done" }) {
  const steps = [
    { label: "Set up", key: "setup" },
    { label: "Active", key: "active" },
    { label: "Reveal", key: "reveal" },
  ] as const;
  const idx = stage === "setup" ? 0 : stage === "active" ? 1 : stage === "reveal" ? 2 : 3;

  return (
    <div className="flex items-start justify-center gap-3 sm:gap-6">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-start gap-3 sm:gap-6">
          <Step n={i + 1} label={s.label} active={idx === i} done={idx > i} />
          {i < steps.length - 1 && (
            <div className={`mt-5 h-0.5 w-8 sm:w-16 ${idx > i ? "bg-emerald-500" : "bg-black/15"}`} />
          )}
        </div>
      ))}
    </div>
  );
}
```

The stepper changes the user's mental model from *"what do all these cards mean?"* to *"I'm on step 2 of 3"*.

For an **auction**: `Open bids → Bidding closed → Winner revealed`. For an **ERC-7984 wrap flow**: `Approve → Shield → Confidential balance`. For a **payroll**: `Define salaries → Run payment cycle → Decrypt my paycheck`. Same component, different labels.

## 3. Role-aware empty states

If your contract has multiple roles (admin, member, anyone, etc.), every disconnected button is a wasted moment. Instead of greying out buttons the user can't use, **don't render them**, and tell the user why.

```tsx
function RoleBanner({ role, address }: { role: "admin" | "member" | "spectator"; address?: `0x${string}` }) {
  if (role === "admin") return (
    <Banner tone="gold" icon={<ShieldCheckIcon />}>
      <strong>You&apos;re the admin.</strong> You can create proposals and add members.
    </Banner>
  );
  if (role === "member") return (
    <Banner tone="green" icon={<HandRaisedIcon />}>
      <strong>You&apos;re a registered member.</strong> Cast one encrypted vote per proposal.
    </Banner>
  );
  return (
    <Banner tone="gray" icon={<EyeSlashIcon />}>
      <strong>You&apos;re a spectator.</strong> Your wallet ({shortAddr(address)}) isn&apos;t the admin and
      hasn&apos;t been added as a member, so you have read-only access. The admin needs to call{" "}
      <code>addMember</code> on your address before you can vote.
    </Banner>
  );
}
```

The spectator case is the most important one — without it, a user lands on the page, sees no buttons, and assumes the app is broken.

## 4. Local-dev onboarding banner (anvil dev keys)

When the user is on chain id 31337 and is NOT the admin, surface the anvil dev key so they can become the admin in one click. This pattern serves first-time builders who don't yet know what a "deployer wallet" is.

```tsx
{isLocalChain && !isAdmin && (
  <div className="rounded-xl border border-[#FFD208]/40 bg-white px-4 py-3 text-xs space-y-2">
    <div className="flex items-center gap-2 font-semibold">
      <KeyIcon className="w-4 h-4 text-[#FFD208]" />
      Testing locally? Become the admin in one click.
    </div>
    <p>Public dev key for chain id 31337 (anvil account #0). Never use on a real network.</p>
    <ol className="list-decimal pl-5 space-y-1">
      <li>MetaMask → account menu → <strong>Import account</strong>.</li>
      <li>Paste the key below.</li>
      <li>Switch to that account and refresh.</li>
    </ol>
    <CopyableCode value="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" />
  </div>
)}
```

**Render this only when `chainId === 31337`.** On Sepolia or mainnet, the anvil dev key is a stale piece of trivia that would confuse users.

## 5. The "how does this stay private?" explainer

FHE is unfamiliar. A short, collapsible explainer panel on the home page is the difference between "looks like a regular dApp" and "I understand why this matters".

```tsx
<Collapsible title="How does this stay private?">
  <p><strong>1.</strong> Your input is encrypted in your browser using Zama&apos;s FHE keys before the
  transaction is signed. The chain only ever sees a ciphertext handle.</p>
  <p><strong>2.</strong> The contract computes on ciphertexts using fully-homomorphic arithmetic.
  Neither the chain, the validators, nor anyone reading storage learns the values.</p>
  <p><strong>3.</strong> After the deadline, anyone can trigger a public reveal. A threshold-KMS
  ceremony produces a cryptographic proof that the cleartext matches the ciphertext handles.
  The proof is verified on-chain in <code>FHE.checkSignatures</code>.</p>
  <p><strong>4.</strong> Only the aggregate is revealed. Individual inputs stay private forever.</p>
</Collapsible>
```

Default to collapsed — power users skip it, new users click it.

## 6. Copyable handles + addresses

Encrypted handles are 32-byte hex strings. The frontend MUST surface them (proves the encryption is real) but they're too long to display naked. Use a copy-on-click chip:

```tsx
function CopyableCode({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-2 font-mono text-xs bg-black/5 hover:bg-black/10 border rounded px-2 py-1"
    >
      <span className="truncate max-w-[28ch] sm:max-w-[44ch]">{value}</span>
      {copied ? <CheckCircleIcon className="w-4 h-4 text-emerald-600" /> : <ClipboardIcon className="w-4 h-4 opacity-50" />}
    </button>
  );
}
```

Apply to: encrypted handles, contract addresses, the anvil dev key, Etherscan links, transaction hashes.

## 7. Lifecycle-aware primary action (only one CTA at a time)

Don't render every possible button on every state and rely on `disabled`. Render the one action the user **can** take, given their role and the contract's state.

```tsx
function PrimaryAction({ stage, role, ... }) {
  if (stage === "setup" && role === "admin") return <CreateProposalCard ... />;
  if (stage === "setup")                     return <WaitingForAdminCard />;
  if (stage === "active" && role === "member" && !hasVoted) return <VoteCard ... />;
  if (stage === "active" && hasVoted)        return <VoteSubmittedCard ... />;
  if (stage === "active")                    return <NotAMemberCard ... />;
  if (stage === "reveal")                    return <RevealCard ... />;  // anyone can call
  if (stage === "done")                      return <ResultCard ... />;
}
```

Each card explains its own state and only its own state. The user never sees three cards next to each other competing for attention.

## 8. Finalized-result presentation

After `finalize()` succeeds, the cleartext tallies are public. Don't display them as plain numbers in the same gray table as the encrypted handles. **Make the moment matter:**

```tsx
<div className="grid grid-cols-2 gap-4">
  <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-5 py-4">
    <div className="text-xs uppercase text-emerald-700">YES</div>
    <div className="text-4xl font-bold font-mono text-emerald-900">{yes.toString()}</div>
    <ProgressBar value={yesPct} tone="emerald" />
  </div>
  <div className="rounded-xl bg-rose-50 border border-rose-200 px-5 py-4">
    <div className="text-xs uppercase text-rose-700">NO</div>
    <div className="text-4xl font-bold font-mono text-rose-900">{no.toString()}</div>
    <ProgressBar value={noPct} tone="rose" />
  </div>
</div>
<Banner tone={passed ? "emerald" : "rose"}>
  Result: {passed ? "PASSED ✓" : "REJECTED ✗"}
</Banner>
```

Big numbers, colour-coded sides, an explicit pass/fail line. This is the screenshot a user will share — make it look like one.

## 9. The collapsible "on-chain state" panel

Power users and judges want to see the raw on-chain state (handles, addresses, deadlines). Hide it behind a collapsible so it doesn't dominate the page for everyone else. Keep handles in `CopyableCode` chips.

```tsx
<Collapsible title="On-chain state">
  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
    <Row label="Contract">       <CopyableCode value={contractAddress} /> </Row>
    <Row label="YES handle">     <CopyableCode value={yesHandle} />        </Row>
    <Row label="NO handle">      <CopyableCode value={noHandle} />         </Row>
    <Row label="Deadline">       {new Date(Number(deadline) * 1000).toLocaleString()} </Row>
    <Row label="Finalized?">     {finalized ? "yes" : "no"}                </Row>
  </dl>
  <button onClick={refresh}><ArrowPathIcon /> Refresh state</button>
</Collapsible>
```

## 10. Status messages without modal noise

Encryption + decryption flows take 1–3 seconds. Users will click again if they don't see feedback. Surface a single live status string from your hook (`message`) and render it as an inline banner — not a toast that disappears, not a modal that blocks.

```tsx
{v.message && (
  <div className="rounded-2xl border border-[#FFD208]/50 bg-[#FFD208]/10 px-6 py-4 text-sm">
    {v.message}
  </div>
)}
```

The hook updates `message` at every async beat: `"Encrypting (1/2: direction)…"` → `"Encrypting (2/2: weight)…"` → `"Submitting transaction…"` → `"Vote recorded."`. The user always knows the system is alive.

---

## Summary checklist for any FHEVM dApp

When building the frontend, audit the page against these:

- [ ] Disconnected state has a clear hero + Connect Wallet button (not just an empty page)
- [ ] Lifecycle stepper shows the current state-machine position
- [ ] Role banner explains what the current wallet can/can't do
- [ ] If the contract has roles, spectator state is explained (NOT empty)
- [ ] On chain 31337, local-dev onboarding banner is visible to non-admins
- [ ] "How it works" explainer is one click away from the home page
- [ ] Encrypted handles use copy-on-click chips, not naked text
- [ ] Only one primary CTA renders at a time, based on `(role × state)` matrix
- [ ] Finalized result is visually distinct from in-progress encrypted handles
- [ ] On-chain state is in a collapsible, not the primary view
- [ ] Status messages are inline banners, not toasts/modals

The skill's [`templates/sdk-v3/page.tsx`](../templates/sdk-v3/page.tsx) demonstrates each pattern in a generic, contract-agnostic form. Lift the components from there and rename for your domain.
