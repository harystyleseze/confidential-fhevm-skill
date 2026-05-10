#!/usr/bin/env node
/*
 * fhevm-lint — static linter for FHEVM Solidity contracts
 *
 * Usage:
 *   npx fhevm-lint <path-to-file.sol-or-dir> [--info] [--json] [--quiet]
 *
 * Exit codes:
 *   0 — no findings of severity >= HIGH (LOW / MEDIUM may still be reported)
 *   1 — at least one CRITICAL or HIGH finding
 *   2 — usage error / file not found / parse error
 *
 * Severity ladder:
 *   CRITICAL  — broken code (won't compile, won't run, silently corrupts state)
 *   HIGH      — runtime breakage that compiles cleanly (missing user-decrypt allow, gas bomb)
 *   MEDIUM    — bugs and inefficiencies that need attention
 *   LOW       — config/style issues
 *   INFO      — heuristic suggestions; off by default, opt-in via --info
 *
 * Heuristic boundaries (this is a single-file static checker, not a CFG):
 *   AP-001 confirms "any function that writes an encrypted-typed identifier into
 *          storage also calls FHE.allowThis(...) somewhere in its body". Multi-step
 *          code paths and helper-call delegation are not modelled.
 *   AP-007 verifies same-contract co-presence of FHE.checkSignatures and
 *          FHE.makePubliclyDecryptable, NOT argument ordering.
 *   AP-006 fires only when the function has zero FHE.* calls.
 *
 *   When in doubt, the linter prefers false negatives over false positives.
 */

const fs = require("fs");
const path = require("path");

let parser;
try {
  parser = require("@solidity-parser/parser");
} catch (_) {
  console.error(
    "fhevm-lint: missing dependency `@solidity-parser/parser`. " +
      "Run: npm install @solidity-parser/parser --save-dev",
  );
  process.exit(2);
}

// ---------- CLI argument parsing ---------------------------------------------

const args = process.argv.slice(2);
const opts = {info: false, json: false, quiet: false, paths: []};
for (const a of args) {
  if (a === "--info") opts.info = true;
  else if (a === "--json") opts.json = true;
  else if (a === "--quiet") opts.quiet = true;
  else if (a === "-h" || a === "--help") {
    printHelp();
    process.exit(0);
  } else opts.paths.push(a);
}

if (opts.paths.length === 0) {
  printHelp();
  process.exit(2);
}

// ---------- Constants --------------------------------------------------------

const ENCRYPTED_TYPES = new Set([
  "ebool",
  "euint8",
  "euint16",
  "euint32",
  "euint64",
  "euint128",
  "euint256",
  "eaddress",
]);
const EXTERNAL_TYPES = new Set([
  "externalEbool",
  "externalEuint8",
  "externalEuint16",
  "externalEuint32",
  "externalEuint64",
  "externalEuint128",
  "externalEuint256",
  "externalEaddress",
]);
const FHE_CONFIG_BASES = new Set([
  "ZamaEthereumConfig",
  "ZamaEthereumConfigUpgradeable",
  "ZamaConfig",
  "ZamaFHEVMConfig",
]);

const SEVERITY_RANK = {CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0};

// ---------- File walker ------------------------------------------------------

function collectFiles(targets) {
  const out = [];
  for (const t of targets) {
    if (!fs.existsSync(t)) {
      console.error(`fhevm-lint: not found: ${t}`);
      process.exit(2);
    }
    const stat = fs.statSync(t);
    if (stat.isDirectory()) walkDir(t, out);
    else if (/\.(sol|tsx?|jsx?)$/.test(t)) out.push(t);
  }
  return out;
}

function walkDir(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "artifacts" || name === "cache" || name === ".next" || name === "dist" || name === "out")
      continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walkDir(full, out);
    else if (
      name.endsWith(".sol") ||
      name.endsWith(".ts")  ||
      name.endsWith(".tsx") ||
      name.endsWith(".js")  ||
      name.endsWith(".jsx")
    ) out.push(full);
  }
}

// ---------- Per-file analysis ------------------------------------------------

function analyseFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const findings = [];

  // Frontend (TS/TSX/JS/JSX) rules — regex-only, no AST.
  if (/\.(tsx?|jsx?)$/.test(filePath)) {
    findings.push(...checkAP019_DeprecatedV2Hooks(source, filePath));
    findings.push(...checkAP020_FireAndForgetMutate(source, filePath));
    findings.push(...checkAP021_MissingAlchemyEnv(source, filePath));
    return findings; // no Solidity AST for frontend files
  }

  // ---- Pre-AST regex checks (work even on un-parseable files) ----
  findings.push(...checkAP013_TFHENamespace(source, filePath));
  findings.push(...checkAP014_DeprecatedImport(source, filePath));
  findings.push(...checkAP015_BytecodeHash(source, filePath));
  findings.push(...checkAP016_OldSolidity(source, filePath));

  let ast;
  try {
    ast = parser.parse(source, {loc: true, range: true, tolerant: true});
  } catch (err) {
    findings.push({
      file: filePath,
      line: err.location?.start?.line ?? 1,
      col: err.location?.start?.column ?? 0,
      code: "PARSE-ERROR",
      severity: "CRITICAL",
      message: `Solidity parse error: ${err.message}`,
      fix: "Fix the syntax error and re-run.",
    });
    return findings;
  }

  parser.visit(ast, {
    ContractDefinition(node) {
      analyseContract(node, source, filePath, findings);
    },
  });

  return findings;
}

function analyseContract(contract, source, filePath, findings) {
  // Skip pure interfaces/libraries unless they import FHE
  const isInterface = contract.kind === "interface";
  if (isInterface) return;

  const baseNames = contract.baseContracts.map((b) => b.baseName.namePath);
  const inheritsFheConfig = baseNames.some((n) => FHE_CONFIG_BASES.has(n));
  const usesFhe = source.includes("@fhevm/solidity") || /\bFHE\./.test(source);

  // AP-003: contract uses FHE but doesn't inherit ZamaEthereumConfig
  if (usesFhe && !inheritsFheConfig && contract.kind === "contract") {
    findings.push({
      file: filePath,
      line: contract.loc.start.line,
      col: contract.loc.start.column,
      code: "AP-003",
      severity: "CRITICAL",
      message: `contract '${contract.name}' uses FHE but does not inherit ZamaEthereumConfig (or *Upgradeable variant)`,
      fix: "Add `is ZamaEthereumConfig` to the contract declaration, or `is ZamaEthereumConfigUpgradeable` for proxy contracts.",
    });
  }

  // collect encrypted-typed state variables for AP-001
  const encryptedStateVars = collectEncryptedStateVars(contract);

  // collect encrypted FIELD names from struct definitions on this contract
  // (so AP-001 catches `state.encField = …` and `state[key].encField = …` writes,
  //  not just direct top-level assignments)
  const encryptedStructFields = collectEncryptedStructFields(contract);

  // Slice the contract source once; per-function analysis re-uses it for AP-008's
  // "is the whole contract using public decryption?" guard.
  const contractSource = sliceContract(contract, source);

  // AP-006: collect view/pure functions with encrypted params and plaintext return
  parser.visit(contract, {
    FunctionDefinition(fn) {
      if (!fn.body) return; // abstract / interface fn
      analyseFunction(fn, source, filePath, findings, {encryptedStateVars, encryptedStructFields, contractSource});
    },
  });

  // AP-007: contract calls FHE.checkSignatures but never FHE.makePubliclyDecryptable
  const sourceText = contractSource;
  const usesCheckSignatures = /\bFHE\.checkSignatures\b/.test(sourceText);
  const usesMakePublic = /\bFHE\.makePubliclyDecryptable\b/.test(sourceText);
  if (usesCheckSignatures && !usesMakePublic) {
    findings.push({
      file: filePath,
      line: contract.loc.start.line,
      col: contract.loc.start.column,
      code: "AP-007",
      severity: "HIGH",
      message: `contract '${contract.name}' calls FHE.checkSignatures but never FHE.makePubliclyDecryptable — public-decrypt 3-step is incomplete`,
      fix: "Step 1 of public decryption is to call FHE.makePubliclyDecryptable(handle) on the handles you intend to reveal. Without this, KMS will not produce a valid signature for checkSignatures.",
      heuristic: "Same-contract co-presence check; argument ordering across calls is not verified.",
    });
  }
}

function collectEncryptedStateVars(contract) {
  const map = new Map(); // name -> typeName
  for (const sub of contract.subNodes) {
    if (sub.type === "StateVariableDeclaration") {
      for (const v of sub.variables) {
        const tn = typeNameToString(v.typeName);
        if (typeIsEncrypted(tn)) map.set(v.name, tn);
        // mapping(...) => encrypted-type
        if (
          v.typeName?.type === "Mapping" &&
          typeIsEncrypted(typeNameToString(v.typeName.valueType))
        ) {
          map.set(v.name, "mapping->" + typeNameToString(v.typeName.valueType));
        }
      }
    }
  }
  return map;
}

/**
 * Walk the contract for `struct X { … euint64 field; … }` declarations and
 * collect the names of fields that are encrypted (or arrays/mappings of
 * encrypted types). Used by AP-001 to catch `state.encField = …` writes.
 *
 * Heuristic limitation: this is a NAME-based check. If a contract declares
 * two unrelated structs that both have a field literally called `value` and
 * one is encrypted while the other is not, AP-001 may flag a write to the
 * non-encrypted field. In practice this is rare; finding output documents
 * the heuristic so users can suppress when intentional.
 */
function collectEncryptedStructFields(contract) {
  const fields = new Set();
  parser.visit(contract, {
    StructDefinition(node) {
      for (const m of node.members ?? []) {
        const tn = typeNameToString(m.typeName);
        if (typeIsEncrypted(tn)) fields.add(m.name);
        // arrays/mappings of encrypted types still expose the field name itself
        if (
          m.typeName?.type === "ArrayTypeName" &&
          typeIsEncrypted(typeNameToString(m.typeName.baseTypeName))
        ) {
          fields.add(m.name);
        }
        if (
          m.typeName?.type === "Mapping" &&
          typeIsEncrypted(typeNameToString(m.typeName.valueType))
        ) {
          fields.add(m.name);
        }
      }
    },
  });
  return fields;
}

function typeNameToString(tn) {
  if (!tn) return "";
  if (tn.type === "ElementaryTypeName") return tn.name;
  if (tn.type === "UserDefinedTypeName") return tn.namePath;
  if (tn.type === "Mapping") return `mapping(${typeNameToString(tn.keyType)} => ${typeNameToString(tn.valueType)})`;
  if (tn.type === "ArrayTypeName") return typeNameToString(tn.baseTypeName) + "[]";
  return "";
}
function typeIsEncrypted(tn) {
  return ENCRYPTED_TYPES.has(tn) || ENCRYPTED_TYPES.has(tn.replace(/^mapping->/, ""));
}
function typeIsExternal(tn) {
  return EXTERNAL_TYPES.has(tn);
}

function sliceContract(contract, source) {
  const lines = source.split("\n");
  return lines.slice(contract.loc.start.line - 1, contract.loc.end.line).join("\n");
}

function analyseFunction(fn, source, filePath, findings, ctx) {
  const isView = fn.stateMutability === "view" || fn.stateMutability === "pure";
  const fnTextRaw = sliceFunction(fn, source);
  const fnText = stripComments(fnTextRaw); // important: comments must not satisfy regex checks
  const hasFheCall = /\bFHE\.[A-Za-z_]\w*/.test(fnText);

  // AP-006 (HIGH): view/pure with encrypted params and plaintext return, no FHE.* calls.
  if (isView && !hasFheCall) {
    const hasEncryptedParam = (fn.parameters || []).some((p) => {
      const tn = typeNameToString(p.typeName);
      return typeIsEncrypted(tn) || typeIsExternal(tn);
    });
    const hasPlainReturn = (fn.returnParameters || []).some((r) => {
      const tn = typeNameToString(r.typeName);
      // plaintext = not an encrypted/external type and not bytes/bytes32
      return tn && !typeIsEncrypted(tn) && !typeIsExternal(tn) && !/^bytes/.test(tn);
    });
    if (hasEncryptedParam && hasPlainReturn) {
      findings.push({
        file: filePath,
        line: fn.loc.start.line,
        col: fn.loc.start.column,
        code: "AP-006",
        severity: "HIGH",
        message: `view/pure function '${fn.name ?? "<unnamed>"}' takes encrypted input, returns plaintext, and never calls FHE.* — it cannot derive cleartext from a handle on-chain`,
        fix: "Either return the encrypted handle (bytes32 / euintNN) for off-chain decryption, or remove the `view`/`pure` modifier and use the public decryption flow (FHE.makePubliclyDecryptable + FHE.checkSignatures).",
      });
    }
  }

  // AP-002: if/require on ebool
  parser.visit(fn, {
    IfStatement(node) {
      if (looksLikeEbool(node.condition, source)) {
        findings.push({
          file: filePath,
          line: node.loc.start.line,
          col: node.loc.start.column,
          code: "AP-002",
          severity: "CRITICAL",
          message: "if statement on an encrypted boolean (ebool) — the EVM cannot evaluate ciphertexts",
          fix: "Replace with FHE.select(condition, valueIfTrue, valueIfFalse). Both branches execute; the coprocessor selects the result inside the ciphertext.",
        });
      }
    },
    FunctionCall(node) {
      const callee = exprName(node.expression);
      if ((callee === "require" || callee === "assert") && node.arguments?.length > 0) {
        if (looksLikeEbool(node.arguments[0], source)) {
          findings.push({
            file: filePath,
            line: node.loc.start.line,
            col: node.loc.start.column,
            code: "AP-002",
            severity: "CRITICAL",
            message: `${callee}() called with an encrypted boolean — the EVM cannot evaluate ciphertexts`,
            fix: "Replace with encrypted error codes: store an euint8 status, grant FHE.allow to the user, and let them decrypt the code off-chain.",
          });
        }
      }
    },
  });

  // AP-005: encrypted division/remainder (right operand is encrypted)
  parser.visit(fn, {
    FunctionCall(node) {
      const callee = exprName(node.expression);
      if (callee === "FHE.div" || callee === "FHE.rem") {
        const args = node.arguments || [];
        if (args.length >= 2) {
          const rhs = args[1];
          // Reject when RHS is an identifier referring to an encrypted-typed name we can detect.
          const rhsName = rhs.type === "Identifier" ? rhs.name : null;
          const rhsIsEncIdent =
            rhsName && (ctx.encryptedStateVars.has(rhsName) || /^_?euint/i.test(rhsName));
          // Reject when RHS is a FHE.* call (which yields a ciphertext)
          const rhsIsFheCall =
            rhs.type === "FunctionCall" && /^FHE\./.test(exprName(rhs.expression) ?? "");
          if (rhsIsEncIdent || rhsIsFheCall) {
            findings.push({
              file: filePath,
              line: node.loc.start.line,
              col: node.loc.start.column,
              code: "AP-005",
              severity: "CRITICAL",
              message: `${callee} called with an encrypted divisor — only plaintext divisors are supported`,
              fix: "Pass a uint literal or plaintext variable as the second argument: FHE.div(encryptedX, plaintextDivisor).",
            });
          }
        }
      }
    },
  });

  // AP-004: function takes externalEuintNN parameter but its body never calls FHE.fromExternal
  const externalParams = (fn.parameters || []).filter((p) =>
    typeIsExternal(typeNameToString(p.typeName)),
  );
  if (externalParams.length > 0 && !/\bFHE\.fromExternal\s*\(/.test(fnText)) {
    findings.push({
      file: filePath,
      line: fn.loc.start.line,
      col: fn.loc.start.column,
      code: "AP-004",
      severity: "CRITICAL",
      message: `function '${fn.name}' takes externalEuint* input but never calls FHE.fromExternal()`,
      fix: "Validate the input proof: `euintNN x = FHE.fromExternal(externalParam, inputProof);` before using x.",
    });
  }

  // AP-011: FHE.rand* in view/pure
  if (isView && /\bFHE\.rand\w*\s*\(/.test(fnText)) {
    findings.push({
      file: filePath,
      line: fn.loc.start.line,
      col: fn.loc.start.column,
      code: "AP-011",
      severity: "MEDIUM",
      message: `function '${fn.name}' is view/pure but calls FHE.rand* — the PRNG state must persist on-chain`,
      fix: "Remove the view/pure modifier and call FHE.rand* from a state-changing function.",
    });
  }

  // AP-017: FHE.encrypt* / FHE.asEuint* inside a loop body
  parser.visit(fn, {
    ForStatement(loopNode) {
      checkLoopBodyForEncrypt(loopNode, source, filePath, findings, fn);
    },
    WhileStatement(loopNode) {
      checkLoopBodyForEncrypt(loopNode, source, filePath, findings, fn);
    },
  });

  // AP-018: direct FHE.decrypt(...) call site (production contracts must use async gateway)
  parser.visit(fn, {
    FunctionCall(node) {
      const callee = exprName(node.expression);
      if (callee === "FHE.decrypt") {
        findings.push({
          file: filePath,
          line: node.loc.start.line,
          col: node.loc.start.column,
          code: "AP-018",
          severity: "MEDIUM",
          message: "direct FHE.decrypt() call in production contract — decryption must go through the async gateway / public-decrypt flow",
          fix: "Replace with: (1) FHE.makePubliclyDecryptable(handle), (2) off-chain instance.publicDecrypt(...), (3) on-chain FHE.checkSignatures(handles, abiEncoded, proof). For user-side reveal, grant FHE.allow(handle, user) and let the user decrypt off-chain.",
        });
      }
    },
  });

  // AP-001 (heuristic): function writes encrypted-typed identifier into storage but never calls FHE.allowThis
  const writesEncrypted = detectEncryptedStateWrite(fn, ctx);
  const callsAllowThis = /\bFHE\.allowThis\s*\(/.test(fnText);
  if (writesEncrypted && !callsAllowThis) {
    findings.push({
      file: filePath,
      line: fn.loc.start.line,
      col: fn.loc.start.column,
      code: "AP-001",
      severity: "CRITICAL",
      message: `function '${fn.name}' writes an encrypted handle to state but never calls FHE.allowThis(...)`,
      fix: "Add `FHE.allowThis(stateVar);` after each encrypted state write so the contract can read its own state in subsequent transactions. Heuristic check: verify all state-writing functions manually.",
      heuristic: "Single-function scope; cross-function helper calls are not modelled.",
    });
  }

  // AP-008 (heuristic): writes encrypted-typed handle but never calls FHE.allow(_, _).
  // Skip the rule when the enclosing contract itself uses FHE.makePubliclyDecryptable —
  // that's a strong signal the app exposes data via public decryption only, not user
  // decryption. (Without this guard, AP-008 false-positives on every confidential
  // voting / auction / DAO contract that reveals tallies publicly after a deadline.)
  const usesPublicDecrypt = ctx.contractSource && /\bFHE\.makePubliclyDecryptable\b/.test(ctx.contractSource);
  if (writesEncrypted && callsAllowThis && !/\bFHE\.allow\s*\(/.test(fnText) && !usesPublicDecrypt) {
    findings.push({
      file: filePath,
      line: fn.loc.start.line,
      col: fn.loc.start.column,
      code: "AP-008",
      severity: "HIGH",
      message: `function '${fn.name}' writes encrypted state and calls allowThis but never FHE.allow(handle, user) — the user cannot decrypt`,
      fix: "Add FHE.allow(stateVar, msg.sender) (or the relevant user address) after the state write so they can user-decrypt off-chain. If decryption is intentionally not exposed to users, suppress this finding.",
      heuristic: "Suppressed when the enclosing contract uses FHE.makePubliclyDecryptable (signals public-decrypt-only design).",
    });
  }

  // AP-010 (heuristic): scalar literal on LHS of an FHE op
  parser.visit(fn, {
    FunctionCall(node) {
      const callee = exprName(node.expression);
      if (
        callee &&
        /^FHE\.(add|sub|mul|min|max|and|or|xor|eq|ne|lt|le|gt|ge)$/.test(callee)
      ) {
        const args = node.arguments || [];
        if (args.length >= 2 && args[0].type === "NumberLiteral") {
          findings.push({
            file: filePath,
            line: node.loc.start.line,
            col: node.loc.start.column,
            code: "AP-010",
            severity: "MEDIUM",
            message: `${callee} has a numeric literal on the left-hand side — put the ciphertext on the LHS for the cheaper scalar path`,
            fix: `Swap the arguments: ${callee}(encrypted, plaintext) instead of ${callee}(plaintext, encrypted).`,
          });
        }
      }
    },
  });

  // AP-012 (heuristic): a state-changing function returns an encrypted handle but never
  // calls FHE.allowTransient — caller can't use the handle in the same transaction.
  // Skip view/pure: those can't write transient storage anyway, and the caller decrypts
  // off-chain via the user's FHE.allow grant from the original write.
  const returnsEncrypted = (fn.returnParameters || []).some((r) =>
    typeIsEncrypted(typeNameToString(r.typeName)),
  );
  if (
    returnsEncrypted &&
    !isView &&
    fn.visibility !== "internal" &&
    fn.visibility !== "private" &&
    !/\bFHE\.allowTransient\s*\(/.test(fnText) &&
    !/\bFHE\.allow\s*\(/.test(fnText)
  ) {
    findings.push({
      file: filePath,
      line: fn.loc.start.line,
      col: fn.loc.start.column,
      code: "AP-012",
      severity: "MEDIUM",
      message: `function '${fn.name}' returns an encrypted handle but never grants permission to the caller`,
      fix: "Before returning, call FHE.allowTransient(handle, msg.sender) so the calling contract can use the handle within the same transaction.",
      heuristic: "Internal pure pass-through helpers may not need this; suppress if the caller is the same contract.",
    });
  }

  // AP-009 (INFO, opt-in): oversized type for narrow domains — heuristic, off by default
  if (opts.info) {
    parser.visit(fn, {
      VariableDeclaration(v) {
        const tn = typeNameToString(v.typeName);
        if (tn === "euint256") {
          findings.push({
            file: filePath,
            line: v.loc.start.line,
            col: v.loc.start.column,
            code: "AP-009",
            severity: "INFO",
            message: "variable typed `euint256` — verify this domain truly needs 256 bits; smaller types are cheaper on the coprocessor",
            fix: "If the value fits, prefer euint64 (max ~1.8e19) or smaller. Suppress this notice if 256 bits is intentional.",
          });
        }
      },
    });
  }
}

function checkLoopBodyForEncrypt(loopNode, source, filePath, findings, enclosingFn) {
  parser.visit(loopNode.body, {
    FunctionCall(node) {
      const callee = exprName(node.expression);
      if (callee && /^FHE\.(asE(uint\d+|address|bool)|encrypt\w*)$/.test(callee)) {
        findings.push({
          file: filePath,
          line: node.loc.start.line,
          col: node.loc.start.column,
          code: "AP-017",
          severity: "HIGH",
          message: `${callee} called inside a loop body in '${enclosingFn.name}' — gas-bomb anti-pattern`,
          fix: "Move the encryption out of the loop, or precompute encrypted constants once in the constructor and reuse handles.",
        });
      }
    },
  });
}

function detectEncryptedStateWrite(fn, ctx) {
  let found = false;
  const visitor = (node) => {
    // @solidity-parser/parser may emit `BinaryOperation` (operator='=') or
    // `Assignment` depending on version — handle both.
    if (
      (node.type === "BinaryOperation" || node.type === "Assignment") &&
      ["=", "+=", "-=", "|=", "&=", "^="].includes(node.operator)
    ) {
      const lhsName = exprBaseName(node.left);
      if (lhsName && ctx.encryptedStateVars.has(lhsName)) {
        found = true;
        return;
      }
      // struct-member write: LHS like `proposals[id].yesTallyEnc` or `p.yesTallyEnc`.
      // We can't always resolve which struct type p refers to from the AST alone,
      // but if the field name is in our set of known encrypted struct fields,
      // treat it as an encrypted write.
      const lhsLeafField = lhsLeafMemberName(node.left);
      if (lhsLeafField && ctx.encryptedStructFields?.has(lhsLeafField)) {
        found = true;
      }
    }
  };
  parser.visit(fn, {
    BinaryOperation: visitor,
    Assignment: visitor,
  });
  return found;
}

/**
 * For an assignment LHS, return the *leaf* member name being assigned.
 *   p.yesTallyEnc           → "yesTallyEnc"
 *   proposals[id].yesTally  → "yesTally"
 *   proposals[id]           → null  (no member access at the leaf)
 *   foo                     → null  (just an identifier)
 */
function lhsLeafMemberName(expr) {
  if (!expr) return null;
  if (expr.type === "MemberAccess") return expr.memberName;
  return null;
}

function stripComments(src) {
  // Remove /* … */ block comments and // line comments. Keeps line numbers stable
  // by replacing matched chars with spaces (newlines preserved).
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  out = out.replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
  return out;
}

function exprName(expr) {
  if (!expr) return null;
  if (expr.type === "Identifier") return expr.name;
  if (expr.type === "MemberAccess")
    return (exprName(expr.expression) ?? "?") + "." + expr.memberName;
  return null;
}
function exprBaseName(expr) {
  if (!expr) return null;
  if (expr.type === "Identifier") return expr.name;
  if (expr.type === "IndexAccess") return exprBaseName(expr.base);
  if (expr.type === "MemberAccess") return exprBaseName(expr.expression);
  return null;
}

function looksLikeEbool(condition, source) {
  if (!condition) return false;
  // Identifier whose name suggests an ebool
  if (condition.type === "Identifier" && /^_?(e|enc|encrypted)?[Bb]ool/.test(condition.name))
    return true;
  // FHE.eq/ne/lt/le/gt/ge return an ebool — these are the most common cases
  if (condition.type === "FunctionCall") {
    const callee = exprName(condition.expression);
    if (callee && /^FHE\.(eq|ne|lt|le|gt|ge|and|or|xor)$/.test(callee)) return true;
  }
  return false;
}

function sliceFunction(fn, source) {
  const lines = source.split("\n");
  return lines.slice(fn.loc.start.line - 1, fn.loc.end.line).join("\n");
}

// ---------- Source-level (non-AST) rules -------------------------------------

function checkAP013_TFHENamespace(source, filePath) {
  const findings = [];
  const lines = source.split("\n");
  lines.forEach((line, i) => {
    if (/\bTFHE\.[A-Za-z_]\w*/.test(line)) {
      findings.push({
        file: filePath,
        line: i + 1,
        col: line.indexOf("TFHE."),
        code: "AP-013",
        severity: "MEDIUM",
        message: "deprecated `TFHE.*` namespace in use — current Zama protocol uses `FHE.*`",
        fix: "Replace TFHE.foo(...) with FHE.foo(...) and update the import to `@fhevm/solidity/lib/FHE.sol`.",
      });
    }
  });
  return findings;
}

function checkAP014_DeprecatedImport(source, filePath) {
  const findings = [];
  const lines = source.split("\n");
  lines.forEach((line, i) => {
    if (/import\s+["'](fhevm\/lib\/TFHE\.sol|fhevm\/abstracts\/EIP712WithModifier\.sol)["']/.test(line)) {
      findings.push({
        file: filePath,
        line: i + 1,
        col: 0,
        code: "AP-014",
        severity: "MEDIUM",
        message: "deprecated import path — `fhevm/lib/TFHE.sol` is replaced by `@fhevm/solidity/lib/FHE.sol`",
        fix: "Update the import: `import {FHE, euint64, …} from \"@fhevm/solidity/lib/FHE.sol\";`",
      });
    }
  });
  return findings;
}

function checkAP015_BytecodeHash(source, filePath) {
  // This rule only meaningful in hardhat.config.* — skip pure .sol files
  if (!/hardhat\.config\.(ts|js|cjs|mjs)$/.test(filePath)) return [];
  if (/bytecodeHash\s*:\s*["']none["']/.test(source)) return [];
  return [
    {
      file: filePath,
      line: 1,
      col: 0,
      code: "AP-015",
      severity: "LOW",
      message: "hardhat.config does not set `metadata.bytecodeHash: \"none\"` — keeping it enabled bloats deployments and complicates verification",
      fix: "Add `metadata: { bytecodeHash: \"none\" }` under `solidity.settings`.",
    },
  ];
}

function checkAP019_DeprecatedV2Hooks(source, filePath) {
  // Match imports from @zama-fhe/react-sdk that pull in v2-only hook names.
  const findings = [];
  const v2Hooks = new Set(["useFhevm", "useFHEEncryption", "useFHEDecrypt"]);
  const importRe = /import\s*\{([^}]+)\}\s*from\s*["']@zama-fhe\/(react-sdk|sdk)["']/g;
  let m;
  while ((m = importRe.exec(source)) !== null) {
    const names = m[1].split(",").map((s) => s.trim().split(/\s+/)[0]);
    for (const n of names) {
      if (v2Hooks.has(n)) {
        const lineNum = source.slice(0, m.index).split("\n").length;
        findings.push({
          file: filePath,
          line: lineNum,
          col: 0,
          code: "AP-019",
          severity: "HIGH",
          message: `deprecated SDK v2 hook '${n}' imported from @zama-fhe/react-sdk — removed in v3`,
          fix: "Use the v3 equivalents: useEncrypt, useUserDecrypt + useAllow + useIsAllowed, the <ZamaProvider>. See references/14-sdk-v3-frontend.md.",
        });
      }
    }
  }
  return findings;
}

function checkAP020_FireAndForgetMutate(source, filePath) {
  // `await someHook.mutate(...)` — should be mutateAsync.
  const findings = [];
  const re = /\bawait\s+(\w+)\.mutate\s*\(/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const lineNum = source.slice(0, m.index).split("\n").length;
    findings.push({
      file: filePath,
      line: lineNum,
      col: 0,
      code: "AP-020",
      severity: "MEDIUM",
      message: `awaited '${m[1]}.mutate(...)' — mutate is fire-and-forget, await returns undefined`,
      fix: `Use ${m[1]}.mutateAsync(...) when you need the result of the mutation.`,
    });
  }
  return findings;
}

function checkAP021_MissingAlchemyEnv(source, filePath) {
  if (!/NEXT_PUBLIC_ALCHEMY_API_KEY/.test(source)) return [];
  let dir = path.dirname(filePath);
  for (let i = 0; i < 6 && dir !== "/"; i++) {
    if (fs.existsSync(path.join(dir, ".env.local")) || fs.existsSync(path.join(dir, ".env"))) {
      return [];
    }
    dir = path.dirname(dir);
  }
  return [
    {
      file: filePath,
      line: 1,
      col: 0,
      code: "AP-021",
      severity: "LOW",
      message: "code references NEXT_PUBLIC_ALCHEMY_API_KEY but no .env / .env.local found up the tree",
      fix: "Create packages/nextjs/.env.local with NEXT_PUBLIC_ALCHEMY_API_KEY=local_placeholder for builds; a real Alchemy key is only needed for Sepolia traffic.",
    },
  ];
}

function checkAP016_OldSolidity(source, filePath) {
  const m = source.match(/pragma\s+solidity\s+\^?([\d.]+)\s*;/);
  if (!m) return [];
  const v = m[1];
  const [maj, min, patch] = v.split(".").map((n) => parseInt(n, 10));
  if (maj < 0 || (maj === 0 && (min < 8 || (min === 8 && patch < 24)))) {
    return [
      {
        file: filePath,
        line: 1,
        col: 0,
        code: "AP-016",
        severity: "LOW",
        message: `Solidity ${v} is below the recommended floor (0.8.24) for FHEVM contracts`,
        fix: "Bump pragma to ^0.8.24 (templates use 0.8.27 with EVM `cancun`).",
      },
    ];
  }
  return [];
}

// ---------- Reporter ---------------------------------------------------------

function reportText(findings) {
  if (findings.length === 0) {
    if (!opts.quiet) console.log("fhevm-lint: 0 findings ✓");
    return;
  }
  // group by file
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, fs] of byFile) {
    console.log(file);
    for (const f of fs) {
      const tag = `[${f.severity}/${f.code}]`.padEnd(20);
      console.log(`  ${file}:${f.line}:${f.col}  ${tag}  ${f.message}`);
      if (f.fix) console.log(`      fix: ${f.fix}`);
      if (f.heuristic) console.log(`      note: ${f.heuristic}`);
    }
  }
  // summary
  const counts = {CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  console.log(
    `\nSummary: ${findings.length} finding(s) — ` +
      `${counts.CRITICAL} CRITICAL, ${counts.HIGH} HIGH, ${counts.MEDIUM} MEDIUM, ${counts.LOW} LOW, ${counts.INFO} INFO`,
  );
}

function reportJson(findings) {
  console.log(JSON.stringify({findings}, null, 2));
}

function printHelp() {
  console.log(`fhevm-lint — static linter for FHEVM Solidity contracts

Usage:
  fhevm-lint <path> [...paths] [--info] [--json] [--quiet]

Options:
  --info     include INFO-level heuristic suggestions (off by default)
  --json     emit machine-readable JSON
  --quiet    suppress success message when no findings
  -h, --help print this help

Exit codes:
  0  no CRITICAL or HIGH findings
  1  at least one CRITICAL or HIGH finding
  2  usage error / file not found / parse error`);
}

// ---------- Main -------------------------------------------------------------

function main() {
  const files = collectFiles(opts.paths);
  if (files.length === 0) {
    console.error("fhevm-lint: no .sol files found in input paths");
    process.exit(2);
  }

  const all = [];
  for (const f of files) all.push(...analyseFile(f));

  // filter INFO unless --info
  const shown = all.filter((f) => f.severity !== "INFO" || opts.info);

  if (opts.json) reportJson(shown);
  else reportText(shown);

  const blocking = shown.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK.HIGH);
  process.exit(blocking ? 1 : 0);
}

main();
