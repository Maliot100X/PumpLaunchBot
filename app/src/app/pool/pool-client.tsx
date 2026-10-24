"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { absoluteUrl } from "@/lib/links";
import { Alert, Badge, Button, Card, EmptyState, Field, SectionTitle, inputClass } from "@/components/ui";
import {
  PBKDF2_HASH,
  PBKDF2_ITERATIONS,
  POOL_FORMAT_VERSION,
  PoolCryptoError,
  aadFor,
  buildJoinPayload,
  cryptoAvailable,
  cryptoUnavailableReason,
  derivePoolKey,
  joinLinkPath,
  joinValueFrom,
  newPoolId,
  newPoolKey,
  newSalt,
  openSealed,
  parseJoinPayload,
  sealJson,
  type JoinPayload,
} from "./pool-crypto";
import {
  VanityError,
  expectedAttempts,
  grindVanity,
  keypairFromResult,
  validatePattern,
  type GrindResult,
} from "@/lib/vanity/grind";

/**
 * Team Grind Pool — the interactive half of /pool.
 *
 * The three things this tab actually does, and the limits of each:
 *
 *  1. CREATE. The browser generates a pool id, a pool key and a salt, derives an AES-256-GCM key from
 *     them with PBKDF2-HMAC-SHA256 at 600,000 iterations (measured on this device and shown), seals a
 *     witness blob as proof, and emits /pool?join=<base64url JSON>. The LINK carries the pattern, the
 *     salt, the iteration count and the witness. The KEY does not travel in the link — send it yourself.
 *
 *  2. CONTRIBUTE. A browser that opens the link shows the same pattern read-only, takes the pool key,
 *     checks it against the witness (a real AES-GCM open, not a string comparison), then runs the SAME
 *     engine as /grinder — grindVanity() out of src/lib/vanity/grind.ts — and seals the resulting
 *     keypair JSON before it can leave the page. It then re-opens its own blob locally to prove the
 *     seal is readable, and hands back a file the contributor sends to the lead by hand.
 *
 *  3. OPEN. The lead pastes the sealed files back in; each one is opened with the local key and its
 *     secret key is re-checked against its own public key (keypairFromResult, the engine's own guard).
 *
 * What this is NOT, said here and on the page: there is no pool server. Nothing is uploaded, and
 * nothing is counted as a participant unless its sealed file was actually opened in this tab. Every
 * number rendered below is either measured in this tab or absent.
 */

/* ------------------------------------------------------------------ this-browser store */

/**
 * localStorage holds a POOL's key material and nothing else: the passphrase that seals ground
 * keypairs on their way between teammates, its salt, and the iteration count. It must never hold the
 * key of a funded wallet, a treasury signer or a seed phrase — none of those exist on this page, and
 * /grinder keeps found keypairs in memory for exactly one download instead of writing them anywhere.
 */
const STORE_KEY = "pumplaunchbot.pool.v1";
const STORE_EVENT = "pumplaunchbot:pool-store";
const EMPTY_POOLS: StoredPool[] = [];

type StoredPool = {
  id: string;
  prefix: string;
  suffix: string;
  exactCase: boolean;
  /** The pool key. Empty when this browser only opened a link and has not been given the key yet. */
  poolKey: string;
  salt: string;
  iterations: number;
  witness: string;
  role: "creator" | "contributor";
  createdAt: string;
  from?: string;
};

type PoolState = StoredPool & { keyMs: number | null };

function parseStore(raw: string): StoredPool[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return EMPTY_POOLS;
  }
  if (!Array.isArray(json)) return EMPTY_POOLS;
  const out: StoredPool[] = [];
  for (const entry of json) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || typeof e.poolKey !== "string" || typeof e.salt !== "string") continue;
    out.push({
      id: e.id,
      prefix: typeof e.prefix === "string" ? e.prefix : "",
      suffix: typeof e.suffix === "string" ? e.suffix : "",
      exactCase: e.exactCase === true,
      poolKey: e.poolKey,
      salt: e.salt,
      iterations: typeof e.iterations === "number" ? e.iterations : PBKDF2_ITERATIONS,
      witness: typeof e.witness === "string" ? e.witness : "",
      role: e.role === "creator" ? "creator" : "contributor",
      createdAt: typeof e.createdAt === "string" ? e.createdAt : "",
      ...(typeof e.from === "string" && e.from !== "" ? { from: e.from } : {}),
    });
  }
  return out;
}

/* getSnapshot has to return a cached reference for a given raw string, or React re-renders forever. */
let storeCache: { raw: string | null; pools: StoredPool[] } = { raw: null, pools: EMPTY_POOLS };

function getStoreSnapshot(): StoredPool[] {
  if (typeof window === "undefined") return EMPTY_POOLS;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== storeCache.raw) storeCache = { raw, pools: raw ? parseStore(raw) : EMPTY_POOLS };
  return storeCache.pools;
}

function getServerStoreSnapshot(): StoredPool[] {
  return EMPTY_POOLS;
}

function subscribeStore(onChange: () => void): () => void {
  window.addEventListener("storage", onChange); // another tab changed it
  window.addEventListener(STORE_EVENT, onChange); // this tab changed it
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(STORE_EVENT, onChange);
  };
}

function writeStore(pools: StoredPool[]): { ok: boolean; error?: string } {
  if (typeof window === "undefined") return { ok: false, error: "no browser storage in this render pass." };
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(pools));
  } catch {
    return {
      ok: false,
      error:
        "This browser refused to write to localStorage — private mode, or storage is full. The pool still works, but its key is gone the moment the tab is closed, so copy the key by hand.",
    };
  }
  window.dispatchEvent(new Event(STORE_EVENT));
  return { ok: true };
}

function persistPool(pool: PoolState): { ok: boolean; error?: string } {
  const others = getStoreSnapshot().filter((p) => p.id !== pool.id);
  const entry: StoredPool = {
    id: pool.id,
    prefix: pool.prefix,
    suffix: pool.suffix,
    exactCase: pool.exactCase,
    poolKey: pool.poolKey,
    salt: pool.salt,
    iterations: pool.iterations,
    witness: pool.witness,
    role: pool.role,
    createdAt: pool.createdAt,
    ...(pool.from ? { from: pool.from } : {}),
  };
  return writeStore([...others, entry]);
}

function forgetPool(id: string): { ok: boolean; error?: string } {
  return writeStore(getStoreSnapshot().filter((p) => p.id !== id));
}

/* ------------------------------------------------------------------ small helpers */

let rowSeq = 0;
function nextRowId(): string {
  rowSeq += 1;
  return `r${rowSeq}`;
}

/**
 * ui.tsx's inputClass carries `outline-none`, which sets `outline-style: none` for an input — and the
 * app's focus ring is the base-layer `:focus-visible { outline: 2px solid #828fff }` in globals.css.
 * Utilities beat the base layer, so the ring would never show here; `focus-visible:outline-solid!`
 * re-asserts the style with !important, which wins whatever order Tailwind emits. Same fix as /pool's
 * previous pass and /splits.
 */
const input = `${inputClass} focus-visible:outline-solid!`;
const monoInput = `${input} font-mono text-xs`;

/** Absolute for sharing; relative when the deployment has no NEXT_PUBLIC_APP_URL (local dev). */
function shareableLink(path: string): string {
  const configured = absoluteUrl(path);
  if (configured.startsWith("http")) return configured;
  return typeof window === "undefined" ? configured : new URL(path, window.location.origin).toString();
}

function humanTime(expected: number, perSecond: number): string {
  if (perSecond <= 0) return "not measured here yet";
  const s = expected / perSecond;
  if (s < 1) return "under a second";
  if (s < 60) return `${s.toFixed(1)} s`;
  if (s < 3600) return `${(s / 60).toFixed(1)} min`;
  if (s < 86_400) return `${(s / 3600).toFixed(1)} h`;
  if (s < 31_536_000) return `${(s / 86_400).toFixed(1)} d`;
  return `${(s / 31_536_000).toFixed(1)} y`;
}

function download(name: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function isWitness(value: unknown, poolId: string): boolean {
  if (typeof value !== "object" || value === null) return false;
  const w = value as Record<string, unknown>;
  return w.v === POOL_FORMAT_VERSION && w.kind === "witness" && w.id === poolId;
}

/** The plaintext a contributor seals. Its shape is checked again on the way back in. */
type Contribution = {
  v: number;
  kind: "keypair";
  pool: string;
  pattern: { p: string; s: string; cs: boolean };
  address: string;
  secretKey: number[];
  attempts: number;
  elapsedMs: number;
  by: string;
  note: string;
  sealedAt: string;
};

type ParsedContribution = { ok: true; value: Contribution } | { ok: false; error: string };

function parseContribution(value: unknown): ParsedContribution {
  if (typeof value !== "object" || value === null) return { ok: false, error: "the plaintext is not an object." };
  const c = value as Record<string, unknown>;
  if (c.v !== POOL_FORMAT_VERSION) return { ok: false, error: `it says format version ${String(c.v)}.` };
  if (c.kind !== "keypair") return { ok: false, error: `it is a "${String(c.kind)}" payload, not a keypair.` };
  if (typeof c.pool !== "string") return { ok: false, error: "it does not name a pool." };
  if (typeof c.address !== "string" || c.address === "") return { ok: false, error: "it carries no address." };
  if (!Array.isArray(c.secretKey) || c.secretKey.length !== 64 || c.secretKey.some((n) => typeof n !== "number")) {
    return { ok: false, error: "its secret key is not a 64-byte array." };
  }
  const pattern = typeof c.pattern === "object" && c.pattern !== null ? (c.pattern as Record<string, unknown>) : {};
  return {
    ok: true,
    value: {
      v: POOL_FORMAT_VERSION,
      kind: "keypair",
      pool: c.pool,
      pattern: {
        p: typeof pattern.p === "string" ? pattern.p : "",
        s: typeof pattern.s === "string" ? pattern.s : "",
        cs: pattern.cs === true,
      },
      address: c.address,
      secretKey: c.secretKey as number[],
      attempts: typeof c.attempts === "number" ? c.attempts : 0,
      elapsedMs: typeof c.elapsedMs === "number" ? c.elapsedMs : 0,
      by: typeof c.by === "string" ? c.by : "",
      note: typeof c.note === "string" ? c.note : "",
      sealedAt: typeof c.sealedAt === "string" ? c.sealedAt : "",
    },
  };
}

function payloadToPool(payload: JoinPayload): PoolState {
  return {
    id: payload.id,
    prefix: payload.prefix,
    suffix: payload.suffix,
    exactCase: payload.exactCase,
    poolKey: "", // the key does not travel in the link; the contributor supplies it
    salt: payload.salt,
    iterations: payload.iterations,
    witness: payload.witness,
    role: "contributor",
    createdAt: new Date().toISOString(),
    keyMs: null,
    ...(payload.from ? { from: payload.from } : {}),
  };
}

/* ------------------------------------------------------------------ the studio */

type Progress = { attempts: number; rate: number; elapsedMs: number; expected: number };

type SealedOutcome = {
  blob: string;
  address: string;
  attempts: number;
  elapsedMs: number;
  reopened: boolean;
  json: string;
};

type OpenedRow = {
  row: string;
  blob: string;
  by: string;
  note: string;
  address: string;
  attempts: number;
  elapsedMs: number;
  sealedAt: string;
  ed25519: boolean;
  json: string;
};

export function PoolStudio() {
  const params = useSearchParams();

  /* The link is parsed in a lazy initializer, never in an effect: opening a pool link paints already
     seeded, and the seed is pure so it is safe if this subtree is ever rendered on the server. */
  const [pool, setPool] = useState<PoolState | null>(() => {
    const value = params.get("join");
    if (!value) return null;
    const parsed = parseJoinPayload(value);
    return parsed.ok ? payloadToPool(parsed.payload) : null;
  });

  const joinParam = params.get("join");
  const joinParse = useMemo(() => (joinParam ? parseJoinPayload(joinParam) : null), [joinParam]);

  const saved = useSyncExternalStore(subscribeStore, getStoreSnapshot, getServerStoreSnapshot);

  /* create */
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [exactCase, setExactCase] = useState(true);
  const [sender, setSender] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  /* join */
  const [linkInput, setLinkInput] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [keyState, setKeyState] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [verifying, setVerifying] = useState(false);

  /* contribute */
  const [who, setWho] = useState("");
  const [note, setNote] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [measuredRate, setMeasuredRate] = useState(0);
  const [grindError, setGrindError] = useState<string | null>(null);
  const [sealed, setSealed] = useState<SealedOutcome | null>(null);
  const abort = useRef<AbortController | null>(null);

  /* open */
  const [blobText, setBlobText] = useState("");
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [opened, setOpened] = useState<OpenedRow[]>([]);

  /* chrome */
  const [status, setStatus] = useState<string | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      abort.current?.abort();
    },
    [],
  );

  const cryptoOk = cryptoAvailable();
  const cryptoWhy = useMemo(() => cryptoUnavailableReason(), []);
  const ignoreCase = !exactCase;

  /* Derived keys are cached by pool + key so a re-seal does not pay the 600,000 iterations again. */
  const keyCache = useRef(new Map<string, CryptoKey>());

  const keyFor = useCallback(async (target: PoolState): Promise<CryptoKey> => {
    const cacheId = `${target.id}|${target.salt}|${target.iterations}|${target.poolKey}`;
    const hit = keyCache.current.get(cacheId);
    if (hit) return hit;
    const key = await derivePoolKey(target.poolKey, target.salt, target.iterations);
    keyCache.current.set(cacheId, key);
    return key;
  }, []);

  const patternCheck = useMemo(() => {
    try {
      validatePattern(prefix, suffix);
      return { ok: true as const, expected: expectedAttempts(prefix, suffix, ignoreCase), error: null };
    } catch (err) {
      return { ok: false as const, expected: null, error: err instanceof VanityError ? err.message : "invalid pattern" };
    }
  }, [prefix, suffix, ignoreCase]);

  const inviteCost = useMemo(() => {
    if (!pool) return null;
    try {
      validatePattern(pool.prefix, pool.suffix);
      return expectedAttempts(pool.prefix, pool.suffix, !pool.exactCase);
    } catch {
      return null;
    }
  }, [pool]);

  const linkPath = useMemo(() => {
    if (!pool || pool.role !== "creator" || pool.witness === "") return null;
    return joinLinkPath(
      buildJoinPayload({
        id: pool.id,
        prefix: pool.prefix,
        suffix: pool.suffix,
        exactCase: pool.exactCase,
        salt: pool.salt,
        iterations: pool.iterations,
        witness: pool.witness,
        ...(pool.from ? { from: pool.from } : {}),
      }),
    );
  }, [pool]);

  /* ---------------------------------------------------------------- copy / clipboard */

  function flash(key: string) {
    setCopied(key);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(null), 2000);
  }

  async function copy(text: string, key: string) {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(text);
      flash(key);
    } catch {
      setCopyError("This browser refused clipboard access — the value is on screen and selectable, so copy it by hand.");
    }
  }

  /* ---------------------------------------------------------------- create */

  async function createPool() {
    setCreateError(null);
    setStatus(null);
    if (!cryptoOk) {
      setCreateError(cryptoWhy);
      return;
    }
    try {
      validatePattern(prefix, suffix);
    } catch (err) {
      setCreateError(err instanceof VanityError ? err.message : "invalid pattern");
      return;
    }

    setCreating(true);
    try {
      const id = newPoolId();
      const poolKey = newPoolKey();
      const salt = newSalt();
      const started = performance.now();
      const key = await derivePoolKey(poolKey, salt, PBKDF2_ITERATIONS);
      const witness = await sealJson(key, { v: POOL_FORMAT_VERSION, kind: "witness", id }, aadFor(id, "witness"));
      const keyMs = Math.round(performance.now() - started);

      const next: PoolState = {
        id,
        prefix,
        suffix,
        exactCase,
        poolKey,
        salt,
        iterations: PBKDF2_ITERATIONS,
        witness,
        role: "creator",
        createdAt: new Date().toISOString(),
        keyMs,
        ...(sender.trim() ? { from: sender.trim() } : {}),
      };
      setPool(next);
      setKeyInput("");
      setKeyState(null);
      setSealed(null);
      setOpened([]);
      setBlobText("");

      const stored = persistPool(next);
      setStoreError(stored.ok ? null : (stored.error ?? null));
      setStatus(
        stored.ok
          ? "Pool created and stored in this browser. Send the link, then send the pool key separately."
          : "Pool created. It could not be stored in this browser — copy the pool key before you leave this tab.",
      );
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "pool creation failed");
    } finally {
      setCreating(false);
    }
  }

  /* ---------------------------------------------------------------- join */

  function openFromText(raw: string) {
    setLinkError(null);
    setStatus(null);
    const value = joinValueFrom(raw);
    if (value === "") {
      setLinkError("That text carries no join= value. Paste the whole pool link your team lead sent, or the join= value on its own.");
      return;
    }
    const parsed = parseJoinPayload(value);
    if (!parsed.ok) {
      setLinkError(parsed.error);
      return;
    }
    const next = payloadToPool(parsed.payload);
    setPool(next);
    setPrefix(next.prefix);
    setSuffix(next.suffix);
    setExactCase(next.exactCase);
    setKeyInput("");
    setKeyState(null);
    setSealed(null);
    setGrindError(null);
    setProgress(null);
    setOpened([]);
    setBlobText("");
    setStatus(
      next.from
        ? `Pool ${next.id} loaded — the link says it came from ${next.from}. Your results stay in this tab until you seal and send them.`
        : `Pool ${next.id} loaded. The link carried no sender name, so this page will not name one.`,
    );
  }

  function loadStored(target: StoredPool) {
    const next: PoolState = { ...target, keyMs: null };
    setPool(next);
    setPrefix(next.prefix);
    setSuffix(next.suffix);
    setExactCase(next.exactCase);
    setKeyInput("");
    setKeyState(null);
    setSealed(null);
    setOpened([]);
    setStatus(
      next.poolKey
        ? `Pool ${next.id} restored from this browser, key included.`
        : `Pool ${next.id} restored — this browser never had its key, so paste the key to seal with it.`,
    );
  }

  /* ---------------------------------------------------------------- verify the pool key */

  async function verifyKey() {
    if (!pool) return;
    setKeyState(null);
    setStatus(null);
    const candidate = keyInput.trim();
    if (!cryptoOk) {
      setKeyState({ tone: "error", message: cryptoWhy });
      return;
    }
    if (candidate === "") {
      setKeyState({ tone: "error", message: "Paste the pool key here first — it is the string your team lead sends separately from the link." });
      return;
    }
    if (pool.witness === "") {
      setKeyState({ tone: "error", message: "This pool carries no sealed witness, so there is nothing to check a key against. Ask your team lead to re-create the link." });
      return;
    }
    setVerifying(true);
    try {
      const started = performance.now();
      const key = await derivePoolKey(candidate, pool.salt, pool.iterations);
      const derivedMs = Math.round(performance.now() - started);
      const openedWitness = await openSealed(key, pool.witness, aadFor(pool.id, "witness"));
      if (!isWitness(openedWitness, pool.id)) {
        setKeyState({ tone: "error", message: "That key opened the witness but the plaintext was not this pool's witness — refusing to use it." });
        return;
      }
      keyCache.current.set(`${pool.id}|${pool.salt}|${pool.iterations}|${candidate}`, key);
      const next: PoolState = { ...pool, poolKey: candidate, keyMs: derivedMs };
      setPool(next);
      setKeyState({
        tone: "ok",
        message: `Key verified: the sealed witness opened and its GCM tag checked out. Deriving it took ${derivedMs} ms on this device.`,
      });
    } catch (err) {
      setKeyState({ tone: "error", message: err instanceof Error ? err.message : "the key could not be checked." });
    } finally {
      setVerifying(false);
    }
  }

  /* ---------------------------------------------------------------- grind + seal */

  async function grindAndSeal() {
    if (!pool) return;
    setGrindError(null);
    setSealed(null);
    setStatus(null);
    if (!cryptoOk) {
      setGrindError(cryptoWhy);
      return;
    }
    if (pool.poolKey === "") {
      setGrindError("This browser does not hold the pool key, so it cannot seal anything for this pool. Paste the key above and verify it first.");
      return;
    }
    try {
      validatePattern(pool.prefix, pool.suffix);
    } catch (err) {
      setGrindError(err instanceof VanityError ? err.message : "invalid pattern");
      return;
    }

    setRunning(true);
    setProgress(null);
    abort.current = new AbortController();
    try {
      /* Re-check the witness before spending CPU: a wrong key would otherwise seal a blob nobody can
         open, which is worse than refusing to start. */
      const key = await keyFor(pool);
      if (pool.witness !== "") {
        const openedWitness = await openSealed(key, pool.witness, aadFor(pool.id, "witness"));
        if (!isWitness(openedWitness, pool.id)) {
          setGrindError("The pool key in this browser does not open this pool's witness — sealing now would produce a blob nobody can open. Check the key with your team lead.");
          return;
        }
      }

      const result: GrindResult | null = await grindVanity({
        prefix: pool.prefix,
        suffix: pool.suffix,
        ignoreCase: !pool.exactCase,
        signal: abort.current.signal,
        onProgress: (p) => {
          setProgress({ attempts: p.attempts, rate: p.rate, elapsedMs: p.elapsedMs, expected: p.expectedAttempts });
          if (p.rate > 0) setMeasuredRate(p.rate);
        },
      });
      if (!result) {
        setGrindError("The grind stopped without a match — you stopped it, or the engine's attempt budget ran out. Nothing was sealed.");
        return;
      }

      const kp = keypairFromResult(result);
      const plaintext: Contribution = {
        v: POOL_FORMAT_VERSION,
        kind: "keypair",
        pool: pool.id,
        pattern: { p: pool.prefix, s: pool.suffix, cs: pool.exactCase },
        address: result.publicKey,
        secretKey: Array.from(kp.secretKey),
        attempts: result.attempts,
        elapsedMs: result.elapsedMs,
        by: who.trim(),
        note: note.trim(),
        sealedAt: new Date().toISOString(),
      };
      const blob = await sealJson(key, plaintext, aadFor(pool.id, "result"));

      /* Prove the seal is readable before offering it: open our own blob and compare the address. */
      let reopened = false;
      try {
        const check = parseContribution(await openSealed(key, blob, aadFor(pool.id, "result")));
        reopened = check.ok && check.value.address === result.publicKey && check.value.secretKey.join(",") === plaintext.secretKey.join(",");
      } catch {
        reopened = false;
      }

      setSealed({
        blob,
        address: result.publicKey,
        attempts: result.attempts,
        elapsedMs: result.elapsedMs,
        reopened,
        json: JSON.stringify(plaintext.secretKey),
      });
      setStatus(
        reopened
          ? "Sealed and re-opened locally — the address and the secret key both survived the round trip. Send the sealed line back to your team lead."
          : "Sealed, but re-opening it locally did NOT match — do not send this blob. Report it instead.",
      );
    } catch (err) {
      setGrindError(err instanceof PoolCryptoError || err instanceof Error ? err.message : "the grind failed.");
    } finally {
      setRunning(false);
      abort.current = null;
    }
  }

  function stopGrind() {
    abort.current?.abort();
  }

  /* ---------------------------------------------------------------- open sealed results */

  async function openSealedResults() {
    setOpenError(null);
    setStatus(null);
    if (!pool) {
      setOpenError("Load a pool first — a sealed result can only be opened against the pool it was sealed for.");
      return;
    }
    if (pool.poolKey === "") {
      setOpenError("This browser does not hold this pool's key. Paste the key above and verify it, or load the pool from the list below if this browser created it.");
      return;
    }
    const blobs = blobText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "");
    if (blobs.length === 0) {
      setOpenError("Paste at least one sealed result — one per line.");
      return;
    }

    setOpening(true);
    const rows: OpenedRow[] = [];
    const failures: string[] = [];
    try {
      const key = await keyFor(pool);
      for (const blob of blobs) {
        try {
          const parsed = parseContribution(await openSealed(key, blob, aadFor(pool.id, "result")));
          if (!parsed.ok) {
            failures.push(`a blob opened but its plaintext is not a pool result: ${parsed.error}`);
            continue;
          }
          if (parsed.value.pool !== pool.id) {
            failures.push(`a blob opened here but its contents name pool ${parsed.value.pool} — refusing it.`);
            continue;
          }
          /* The engine's own guard: the secret key must derive the public key it claims. */
          let ed25519 = true;
          try {
            keypairFromResult({
              publicKey: parsed.value.address,
              secretKey: Uint8Array.from(parsed.value.secretKey),
              attempts: parsed.value.attempts,
              elapsedMs: parsed.value.elapsedMs,
            });
          } catch {
            ed25519 = false;
          }
          rows.push({
            row: nextRowId(),
            blob,
            by: parsed.value.by,
            note: parsed.value.note,
            address: parsed.value.address,
            attempts: parsed.value.attempts,
            elapsedMs: parsed.value.elapsedMs,
            sealedAt: parsed.value.sealedAt,
            ed25519,
            json: JSON.stringify(parsed.value.secretKey),
          });
        } catch (err) {
          failures.push(err instanceof Error ? err.message : "a blob failed to open.");
        }
      }
      if (rows.length > 0) setOpened((prev) => [...prev, ...rows]);
      setBlobText("");
      if (rows.length === 0) {
        setOpenError(failures.join(" "));
      } else {
        setStatus(
          `Opened ${rows.length} sealed result${rows.length === 1 ? "" : "s"} in this tab${failures.length > 0 ? `, and ${failures.length} did not open` : ""}.`,
        );
        setOpenError(failures.length > 0 ? failures.join(" ") : null);
      }
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : "opening failed.");
    } finally {
      setOpening(false);
    }
  }

  /* ---------------------------------------------------------------- render */

  const poolInStore = pool ? saved.find((p) => p.id === pool.id) : undefined;
  const canContribute = pool !== null;
  const keyHeld = pool !== null && pool.poolKey !== "";

  return (
    <div className="space-y-6">
      {!cryptoOk ? (
        <Alert tone="error" title="This context cannot run the pool">
          {cryptoWhy}
        </Alert>
      ) : null}

      {joinParse && !joinParse.ok ? (
        <Alert tone="error" title="This pool link did not parse">
          {joinParse.error}
        </Alert>
      ) : null}

      {storeError ? (
        <Alert tone="warn" title="This browser would not store the pool key">
          {storeError}
        </Alert>
      ) : null}

      {/* ------------------------------------------------------------ create */}
      <Card className="p-4">
        <SectionTitle aside={pool ? (pool.role === "creator" ? `you created ${pool.id}` : `joined ${pool.id}`) : "no pool loaded"}>
          Create a pool
        </SectionTitle>
        <p className="mt-1 text-xs leading-relaxed text-white/50">
          Your browser generates the pool key, derives an AES-256-GCM key from it, seals a witness and
          writes the link. The key is not in the link — you send it yourself.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field id="pool-start" label="Starts with" hint="base58 only — no 0, O, I or l. Empty means any start.">
            <input
              id="pool-start"
              name="start"
              autoComplete="off"
              spellCheck={false}
              maxLength={6}
              className={monoInput}
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.trim())}
              placeholder="e.g. moo"
            />
          </Field>
          <Field
            id="pool-end"
            label="Ends with"
            hint="The grinder caps the whole pattern at 6 characters, both ends together — a launch suffix like pump needs a short start."
          >
            <input
              id="pool-end"
              name="end"
              autoComplete="off"
              spellCheck={false}
              maxLength={6}
              className={monoInput}
              value={suffix}
              onChange={(e) => setSuffix(e.target.value.trim())}
              placeholder="e.g. pump"
            />
          </Field>
          <Field id="pool-sender" label="Your name (optional)" hint="Travels in the link as the sender. A link that carries none says so.">
            <input
              id="pool-sender"
              name="sender"
              autoComplete="off"
              className={input}
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              placeholder="e.g. kai"
            />
          </Field>
          <div className="flex items-end pb-1.5">
            <label className="flex items-center gap-2 text-xs text-white/60" htmlFor="pool-case">
              <input id="pool-case" type="checkbox" checked={exactCase} onChange={(e) => setExactCase(e.target.checked)} />
              Match exact case
            </label>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void createPool()}
            disabled={creating || !patternCheck.ok || !cryptoOk}
            title={
              !cryptoOk
                ? cryptoWhy
                : !patternCheck.ok
                  ? (patternCheck.error ?? "a pool needs a valid pattern")
                  : "Generate the pool key, seal a witness and build the link"
            }
          >
            {creating ? "Deriving the key…" : pool?.role === "creator" ? "Create a new pool link" : "Create pool link"}
          </Button>
          <Badge tone={patternCheck.ok ? "ok" : "warn"}>
            {patternCheck.ok && patternCheck.expected !== null
              ? exactCase
                ? `${patternCheck.expected.toExponential(1)} keypairs, case-exact`
                : `${patternCheck.expected.toExponential(1)} keypairs, case-insensitive`
              : "no runnable pattern yet"}
          </Badge>
        </div>

        {patternCheck.error ? (
          <p className="mt-2 text-[11px] leading-relaxed text-white/45">
            The grinder&apos;s own check says: {patternCheck.error}.
          </p>
        ) : null}
        {creating ? (
          <p className="mt-2 text-[11px] leading-relaxed text-white/45">
            Deriving {PBKDF2_HASH} at {PBKDF2_ITERATIONS.toLocaleString()} iterations, then sealing the
            witness. This is deliberate work — the delay is the point.
          </p>
        ) : null}
        {createError ? (
          <div className="mt-3">
            <Alert tone="error">{createError}</Alert>
          </div>
        ) : null}

        {pool && pool.role === "creator" && linkPath ? (
          <div className="mt-4 space-y-3 rounded-md border border-white/10 bg-white/[0.015] p-3">
            <div>
              <p className="text-xs font-medium text-white/70">Send this link to your team</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  aria-label="Pool link"
                  readOnly
                  spellCheck={false}
                  className={`${monoInput} min-w-0 sm:flex-1`}
                  value={linkPath}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button type="button" variant="secondary" size="sm" onClick={() => void copy(shareableLink(linkPath), "link")}>
                  {copied === "link" ? "Copied" : "Copy link"}
                </Button>
              </div>
              <p className="mt-2 break-all text-[11px] leading-relaxed text-white/40">
                The link carries the pattern, the pool id, the salt, the {PBKDF2_ITERATIONS.toLocaleString()}-iteration
                count, your label if you typed one, and one sealed witness. It does not carry the key.
              </p>
            </div>

            <div className="border-t border-white/10 pt-3">
              <p className="text-xs font-medium text-white/70">Send this key on a channel you trust</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  aria-label="Pool key"
                  readOnly
                  spellCheck={false}
                  className={`${monoInput} min-w-0 sm:flex-1`}
                  value={pool.poolKey}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button type="button" variant="secondary" size="sm" onClick={() => void copy(pool.poolKey, "key")}>
                  {copied === "key" ? "Copied" : "Copy key"}
                </Button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-white/40">
                Anyone holding this key can open every result sealed for this pool, so invite people you
                trust with it. Its derived key is what actually seals — {PBKDF2_HASH},{" "}
                {PBKDF2_ITERATIONS.toLocaleString()} iterations, AES-256-GCM, salt{" "}
                <span className="break-all font-mono">{pool.salt}</span>
                {pool.keyMs !== null ? `, derived in ${pool.keyMs} ms on this device` : ""}. The key itself
                is stored in this browser&apos;s localStorage and nowhere else — and localStorage is used for
                pool key material only, never for a funded wallet&apos;s key.
              </p>
            </div>
          </div>
        ) : null}
      </Card>

      {/* ------------------------------------------------------------ contribute */}
      <Card className="p-4">
        <SectionTitle aside={pool ? `pool ${pool.id}` : "no pool loaded"}>Contribute to a pool</SectionTitle>
        <p className="mt-1 text-xs leading-relaxed text-white/50">
          Open a pool link from your team lead, or paste it here.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field id="pool-link-input" label="Pool link" error={linkError}>
              <input
                id="pool-link-input"
                name="pool-link"
                autoComplete="off"
                spellCheck={false}
                className={monoInput}
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                placeholder="https://…/pool?join=…"
              />
            </Field>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => openFromText(linkInput)} disabled={linkInput.trim() === ""}>
            Open pool
          </Button>
        </div>

        {canContribute && pool ? (
          <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-white/10 bg-white/[0.015] p-3">
                <p className="text-[11px] text-white/40">Requester</p>
                <p className="mt-1 break-words text-xs">
                  {pool.from ? (
                    <span className="text-white/85">{pool.from}</span>
                  ) : (
                    <span className="text-white/45">the link carried no sender name</span>
                  )}
                </p>
              </div>
              <div className="rounded-md border border-white/10 bg-white/[0.015] p-3">
                <p className="text-[11px] text-white/40">Pattern every browser grinds</p>
                <p className="mt-1 break-all font-mono text-xs tabular text-white/85">
                  starts {pool.prefix === "" ? "—" : pool.prefix} · ends {pool.suffix === "" ? "—" : pool.suffix}
                </p>
                <p className="mt-1 text-[11px] text-white/40">
                  {pool.exactCase ? "exact case" : "case-insensitive"}
                  {inviteCost !== null ? ` · ~${inviteCost.toExponential(1)} keypairs on average` : ""}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field
                  id="pool-key-input"
                  label="Pool key (sent separately from the link)"
                  hint="It is not in the link. Paste the string your team lead sent and check it against the pool's sealed witness."
                >
                  <input
                    id="pool-key-input"
                    name="pool-key"
                    autoComplete="off"
                    spellCheck={false}
                    className={monoInput}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder="paste the pool key"
                  />
                </Field>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={() => void verifyKey()} disabled={verifying || keyInput.trim() === ""}>
                {verifying ? "Checking…" : "Verify key"}
              </Button>
            </div>
            {keyState ? (
              <Alert tone={keyState.tone === "ok" ? "ok" : "error"}>{keyState.message}</Alert>
            ) : null}
            {keyHeld && !keyState ? (
              <p className="text-[11px] leading-relaxed text-white/45">
                This browser holds a key for pool {pool.id}
                {poolInStore ? " and it is stored here" : " (not yet stored — use Remember below)"}.
              </p>
            ) : null}

            <div className="border-t border-white/10 pt-3">
              <p className="text-xs font-medium text-white/70">Grind the pool pattern and seal the result</p>
              <p className="mt-1 text-[11px] leading-relaxed text-white/45">
                This runs the same engine as the Grinder tab in this browser — no server, no shared work
                queue. Whatever this tab finds, it found itself.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field id="pool-who" label="Your name or handle (goes inside the sealed result)">
                  <input
                    id="pool-who"
                    name="who"
                    autoComplete="off"
                    className={input}
                    value={who}
                    onChange={(e) => setWho(e.target.value)}
                    placeholder="e.g. kai"
                  />
                </Field>
                <Field id="pool-note" label="Note (optional)">
                  <input
                    id="pool-note"
                    name="note"
                    autoComplete="off"
                    className={input}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="hit the pattern after 2 minutes"
                  />
                </Field>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {running ? (
                  <Button type="button" variant="secondary" size="sm" onClick={stopGrind}>
                    Stop grinding
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void grindAndSeal()}
                    disabled={!keyHeld || !cryptoOk}
                    title={
                      !cryptoOk
                        ? cryptoWhy
                        : !keyHeld
                          ? "Paste and verify the pool key first — sealing needs it"
                          : "Grind the pool pattern and seal the found keypair"
                    }
                  >
                    Grind &amp; seal
                  </Button>
                )}
                {keyHeld && !poolInStore ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (!pool) return;
                      const stored = persistPool(pool);
                      setStoreError(stored.ok ? null : (stored.error ?? null));
                      setStatus(stored.ok ? `Pool ${pool.id} and its key are now stored in this browser.` : null);
                    }}
                    title="Keep this pool and its key in this browser across reloads"
                  >
                    Remember this pool
                  </Button>
                ) : null}
                {poolInStore ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (!pool) return;
                      const removed = forgetPool(pool.id);
                      setStoreError(removed.ok ? null : (removed.error ?? null));
                      setStatus(removed.ok ? `Pool ${pool.id} forgotten — its key is no longer in this browser.` : null);
                    }}
                  >
                    Forget this pool
                  </Button>
                ) : null}
              </div>

              {progress ? (
                <p className="mt-3 font-mono text-[11px] tabular text-white/55">
                  {progress.attempts.toLocaleString()} attempts · {progress.rate.toLocaleString()}/s · budget ~
                  {progress.expected.toLocaleString()}
                </p>
              ) : null}
              {measuredRate > 0 ? (
                <p className="mt-1 text-[11px] text-white/40">
                  Measured {measuredRate.toLocaleString()} keys/s on this device
                  {inviteCost !== null ? ` → about ${humanTime(inviteCost, measuredRate)} for this pattern` : ""}.
                </p>
              ) : null}
              {grindError ? (
                <div className="mt-3">
                  <Alert tone="error">{grindError}</Alert>
                </div>
              ) : null}

              {sealed ? (
                <div className="mt-3 rounded-md border border-white/10 bg-white/[0.015] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium text-white/70">Sealed result</p>
                    <Badge tone={sealed.reopened ? "ok" : "warn"}>
                      {sealed.reopened ? "re-opened locally, matches" : "re-open failed — do not send"}
                    </Badge>
                  </div>
                  <p className="mt-2 break-all font-mono text-[11px] tabular text-white/85">{sealed.address}</p>
                  <p className="mt-1 text-[11px] text-white/40 tabular">
                    {sealed.attempts.toLocaleString()} attempts · {sealed.elapsedMs.toLocaleString()} ms in this tab
                  </p>
                  <textarea
                    aria-label="Sealed result"
                    readOnly
                    rows={3}
                    spellCheck={false}
                    className={`${monoInput} mt-2`}
                    value={sealed.blob}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={() => void copy(sealed.blob, "blob")}>
                      {copied === "blob" ? "Copied" : "Copy sealed result"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => download(`${pool.id}-${sealed.address}.plbp`, sealed.blob, "text/plain")}
                    >
                      Download .plbp
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => download(`${sealed.address}.json`, sealed.json, "application/json")}
                      title="The plain 64-byte keypair array — for your own use, not for the pool"
                    >
                      Download keypair JSON
                    </Button>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-white/40">
                    Nothing was uploaded. This blob is the contribution — send it back to your team lead,
                    who opens it with the pool key. The keypair JSON next to it is the secret key in the
                    clear; keep it if you want the mint yourself.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-white/40">
            Open a link above, or create a pool in the card above this one, before contributing.
          </p>
        )}
      </Card>

      {/* ------------------------------------------------------------ open sealed results */}
      <Card className="p-4">
        <SectionTitle aside={`${opened.length} opened in this tab`}>Open sealed results</SectionTitle>
        <p className="mt-1 text-xs leading-relaxed text-white/50">
          Paste the sealed lines your team sent back, one per line. Each one is opened with the pool key
          held in this browser, and its secret key is checked against the address it claims.
        </p>

        <div className="mt-3">
          <Field
            id="pool-blobs"
            label="Sealed results"
            hint="One plbp1.… line per line. Failures are reported with their reason; nothing is dropped silently."
          >
            <textarea
              id="pool-blobs"
              name="blobs"
              rows={3}
              spellCheck={false}
              className={monoInput}
              value={blobText}
              onChange={(e) => setBlobText(e.target.value)}
              placeholder="plbp1.…"
            />
          </Field>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void openSealedResults()}
              disabled={opening || blobText.trim() === "" || !pool}
              title={!pool ? "Load a pool first" : "Decrypt and check each line"}
            >
              {opening ? "Opening…" : "Open sealed results"}
            </Button>
            <span className="self-center text-[11px] text-white/40">
              {pool ? `Opening against pool ${pool.id} with ${keyHeld ? "the key in this browser" : "no key loaded"}.` : "No pool loaded."}
            </span>
          </div>
        </div>
        {openError ? (
          <div className="mt-3">
            <Alert tone="warn" title="Some lines did not open">{openError}</Alert>
          </div>
        ) : null}

        {opened.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="Nothing opened yet">
              No contributor is counted here until a sealed file from them is opened in this tab. This is
              not a roster — it is a list of files you have actually read.
            </EmptyState>
          </div>
        ) : (
          <ol className="mt-4 space-y-2">
            {opened.map((row) => (
              <li key={row.row} className="rounded-md border border-white/10 bg-white/[0.015] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2 text-xs text-white/50">
                    <span className="font-mono text-[11px]">{row.by || "sealed with no name"}</span>
                    <Badge tone={row.ed25519 ? "ok" : "warn"}>{row.ed25519 ? "secret matches address" : "secret does NOT match address"}</Badge>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => download(`${row.address}.json`, row.json, "application/json")}
                    >
                      Download JSON
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpened((prev) => prev.filter((r) => r.row !== row.row))}
                    >
                      Remove
                    </Button>
                  </span>
                </div>
                <p className="mt-2 break-all font-mono text-xs tabular text-white/85">{row.address}</p>
                <p className="mt-1 text-[11px] tabular text-white/40">
                  {row.attempts.toLocaleString()} attempts · {row.elapsedMs.toLocaleString()} ms on the
                  contributor&apos;s machine{row.sealedAt ? ` · sealed ${row.sealedAt}` : ""}
                </p>
                {row.note ? <p className="mt-1 text-[11px] leading-relaxed text-white/45">{row.note}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* ------------------------------------------------------------ pools in this browser */}
      <Card className="p-4">
        <SectionTitle aside={`${saved.length} stored`}>Pools in this browser</SectionTitle>
        <p className="mt-1 text-xs leading-relaxed text-white/50">
          Pool key material this browser keeps under{" "}
          <span className="font-mono text-[11px]">localStorage[{JSON.stringify(STORE_KEY)}]</span>. Nothing
          else is written there — no wallet key, no seed phrase, no session.
        </p>

        {saved.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No pools stored in this browser">
              Create a pool, or verify a key for a pool you were sent, and it can be kept here across
              reloads.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {saved.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[0.015] p-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-white/70">
                    <span className="font-mono">{entry.id}</span>
                    <Badge tone={entry.role === "creator" ? "ok" : "neutral"}>{entry.role}</Badge>
                    <Badge tone={entry.poolKey ? "ok" : "warn"}>{entry.poolKey ? "key held" : "key missing"}</Badge>
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] text-white/45">
                    starts {entry.prefix === "" ? "—" : entry.prefix} · ends {entry.suffix === "" ? "—" : entry.suffix} ·{" "}
                    {entry.exactCase ? "exact case" : "case-insensitive"}
                    {entry.from ? ` · from ${entry.from}` : ""}
                    {entry.createdAt ? ` · ${entry.createdAt}` : ""}
                  </p>
                </div>
                <span className="flex flex-wrap gap-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => loadStored(entry)}>
                    Load
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const removed = forgetPool(entry.id);
                      setStoreError(removed.ok ? null : (removed.error ?? null));
                    }}
                  >
                    Forget
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {status ? (
        <p aria-live="polite" className="text-[11px] leading-relaxed text-white/50">
          {status}
        </p>
      ) : null}

      {copyError ? (
        <Alert tone="warn" title="Clipboard unavailable">
          {copyError}
        </Alert>
      ) : null}
    </div>
  );
}
