"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Badge, Button, Card, Field, LinkButton, SectionTitle, Skeleton, Stat, inputClass } from "@/components/ui";
import {
  AEAD_TAG_BITS,
  IV_BYTES,
  KEYPAIR_JSON_HINT,
  MIN_ACCEPTED_ITERATIONS,
  MAX_ACCEPTED_ITERATIONS,
  PBKDF2_HASH,
  PBKDF2_ITERATIONS,
  PBKDF2_ROUNDS_LABEL,
  SALT_BYTES,
  STORAGE_KEY,
  VAULT_VERSION,
  VaultError,
  type VaultKey,
  clearStoredEnvelope,
  decryptVault,
  encryptVault,
  envelopeBytes,
  parseEnvelope,
  parseKeypairJson,
  readStoredEnvelope,
  saveEnvelope,
  webCryptoAvailable,
} from "./vault-crypto";

/**
 * "Your keys, in this browser" — the browser-local vault.
 *
 * This is NOT the platform treasury. The treasury (the "Platform treasury" section above) is a
 * server-side wallet whose key the user never sees; this section holds the user's OWN grinded mint
 * keypairs, encrypted in this tab with a passphrase, and never sent anywhere.
 *
 * The honest contract, printed on screen because it is the whole risk:
 *  - there is no recovery. Forget the passphrase and the ciphertext in this browser is unreadable.
 *  - the vault lives in this one browser's localStorage. Another device, another browser, or a
 *    cleared site-data folder does not have it.
 *  - the passphrase is never stored. While unlocked it is held in this tab's memory (React state)
 *    so a save can re-encrypt; locking, reloading or closing the tab drops it.
 *  - every save re-encrypts the whole payload with a fresh salt and a fresh IV, and is read back and
 *    compared before the UI claims it was saved.
 *
 * localStorage is an EXTERNAL store, not React state, so it is read through useSyncExternalStore:
 * the server snapshot is null (no storage exists while prerendering, which is what renders the
 * skeleton), and the browser snapshot is the real thing. A second tab that writes the same slot
 * shows up as a normal store change instead of being silently clobbered.
 */

const MIN_PASSPHRASE = 12;

type Session = {
  passphrase: string;
  keys: VaultKey[];
  /** The exact ciphertext text this session was unlocked from, to detect a cross-tab change. */
  from: string;
};

type StoredSnapshot = { text: string | null; error: string | null };

/* ----------------------------------------------------- the localStorage external store */

let latestSnapshot: StoredSnapshot | null = null;
const vaultListeners = new Set<() => void>();

/**
 * Reads the slot and returns a stable object between renders: useSyncExternalStore re-renders only
 * when the returned value changes identity, so an uncached fresh object here would loop forever.
 */
function readSnapshot(): StoredSnapshot | null {
  if (typeof window === "undefined") return null; // prerender: this browser does not exist yet
  const { text, error } = readStoredEnvelope();
  if (latestSnapshot && latestSnapshot.text === text && latestSnapshot.error === error) return latestSnapshot;
  latestSnapshot = { text, error };
  return latestSnapshot;
}

function getServerSnapshot(): StoredSnapshot | null {
  return null;
}

function subscribeToStorage(onStoreChange: () => void): () => void {
  vaultListeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange); // writes from another tab of this origin
  return () => {
    vaultListeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

/** This tab wrote or cleared the slot — tell React to re-read it. */
function notifyStorage() {
  for (const listener of vaultListeners) listener();
}

/* ------------------------------------------------------------------------ small helpers */

function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function LocalVault() {
  const stored = useSyncExternalStore(subscribeToStorage, readSnapshot, getServerSnapshot);

  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [unlockPass, setUnlockPass] = useState("");
  const [restorePass, setRestorePass] = useState("");
  const [restoreText, setRestoreText] = useState("");
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [pasteKey, setPasteKey] = useState("");
  const [keyNotes, setKeyNotes] = useState<string[]>([]);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [confirmDestroy, setConfirmDestroy] = useState(false);
  const keyFile = useRef<HTMLInputElement | null>(null);
  const restoreFile = useRef<HTMLInputElement | null>(null);

  const usable = webCryptoAvailable();

  const storedText = stored?.text ?? null;
  const parsed = useMemo(
    () => (storedText ? parseEnvelope(storedText) : { envelope: null, error: null as string | null }),
    [storedText],
  );
  const envelope = parsed.envelope;
  const cipherBytes = useMemo(() => (envelope ? envelopeBytes(envelope) : null), [envelope]);

  const clearMessages = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  /** The unlocked session no longer matches what is stored (another tab replaced it). */
  const stale = session !== null && storedText !== session.from;

  /** Encrypt the whole payload with a fresh salt + IV, save it, verify it, and adopt the result. */
  const persist = useCallback(async (passphrase: string, keys: VaultKey[]): Promise<boolean> => {
    const env = await encryptVault(passphrase, { vault: VAULT_VERSION, keys });
    const text = JSON.stringify(env, null, 2);
    const saved = saveEnvelope(text);
    if (!saved.ok) {
      setError(saved.error);
      return false;
    }
    notifyStorage();
    setSession({ passphrase, keys, from: text });
    return true;
  }, []);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof VaultError || err instanceof Error ? err.message : "the vault operation failed");
    } finally {
      setBusy(false);
    }
  }, []);

  async function copy(what: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 1600);
    } catch {
      setError("the browser blocked clipboard access — select the text and copy it by hand");
    }
  }

  async function createVault() {
    clearMessages();
    if (!usable) {
      setError("WebCrypto is unavailable on this origin, so a vault cannot be created here");
      return;
    }
    if (pass.length < MIN_PASSPHRASE) {
      setError(`use at least ${MIN_PASSPHRASE} characters — this passphrase is the only way back in`);
      return;
    }
    if (pass !== pass2) {
      setError("the two passphrases do not match");
      return;
    }
    await run(async () => {
      const ok = await persist(pass, []);
      if (ok) {
        setNotice("vault created and saved in this browser — nothing was uploaded");
        setPass("");
        setPass2("");
      }
    });
  }

  async function unlock() {
    clearMessages();
    if (!envelope || !storedText) return;
    await run(async () => {
      const payload = await decryptVault(envelope, unlockPass);
      setSession({ passphrase: unlockPass, keys: payload.keys, from: storedText });
      setUnlockPass("");
    });
  }

  async function addKeypairs(text: string) {
    clearMessages();
    if (!session || stale) return;
    const { keys, errors } = parseKeypairJson(text);
    setKeyNotes(errors);
    if (keys.length === 0) {
      setError("no usable mint keypair in that input — nothing was added");
      return;
    }
    const merged = [...session.keys];
    let added = 0;
    for (const k of keys) {
      if (!merged.some((m) => m.address === k.address)) {
        merged.push(k);
        added++;
      }
    }
    if (added === 0) {
      setError("every key in that input is already in the vault");
      return;
    }
    await run(async () => {
      const ok = await persist(session.passphrase, merged);
      if (ok) {
        setNotice(`${added} key${added === 1 ? "" : "s"} encrypted and saved in this browser`);
        setPasteKey("");
        if (keyFile.current) keyFile.current.value = "";
      }
    });
  }

  async function removeKey(address: string) {
    clearMessages();
    if (!session || stale) return;
    if (pendingRemove !== address) {
      setPendingRemove(address);
      return;
    }
    const remaining = session.keys.filter((k) => k.address !== address);
    setPendingRemove(null);
    if (revealed === address) setRevealed(null);
    await run(async () => {
      const ok = await persist(session.passphrase, remaining);
      if (ok) setNotice("key removed — the vault was re-encrypted without it");
    });
  }

  async function reEncrypt() {
    clearMessages();
    if (!session || stale) return;
    await run(async () => {
      const ok = await persist(session.passphrase, session.keys);
      if (ok) setNotice("re-encrypted with a fresh salt and IV — the previous ciphertext is gone");
    });
  }

  async function restoreBackup() {
    clearMessages();
    if (!usable) {
      setError("WebCrypto is unavailable on this origin, so a backup cannot be opened here");
      return;
    }
    if (envelope && !replaceConfirmed) {
      setError("tick the box to confirm replacing the vault already stored in this browser");
      return;
    }
    const { envelope: incoming, error: parseError } = parseEnvelope(restoreText);
    if (!incoming) {
      setError(parseError ?? "could not read that backup");
      return;
    }
    await run(async () => {
      const payload = await decryptVault(incoming, restorePass);
      // Store the normalised blob, not the raw paste — same key material, predictable shape.
      const text = JSON.stringify(incoming, null, 2);
      const saved = saveEnvelope(text);
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      notifyStorage();
      setSession({ passphrase: restorePass, keys: payload.keys, from: text });
      setRestoreText("");
      setRestorePass("");
      setReplaceConfirmed(false);
      if (restoreFile.current) restoreFile.current.value = "";
      setNotice(
        `backup restored — ${payload.keys.length} key${payload.keys.length === 1 ? "" : "s"} decrypted and saved in this browser`,
      );
      if (incoming.kdf.iterations !== PBKDF2_ITERATIONS) {
        setKeyNotes([
          `this backup was written with ${incoming.kdf.iterations.toLocaleString("en-US")} PBKDF2 rounds, not the ${PBKDF2_ROUNDS_LABEL} this build writes. It opened, and it will keep opening, because the round count is read from the file.`,
        ]);
      }
    });
  }

  async function destroyVault() {
    clearMessages();
    if (!confirmDestroy) {
      setConfirmDestroy(true);
      return;
    }
    const cleared = clearStoredEnvelope();
    setConfirmDestroy(false);
    setSession(null);
    setRevealed(null);
    setPendingRemove(null);
    if (!cleared.ok) {
      setError(cleared.error);
      return;
    }
    notifyStorage();
    setNotice("the vault was deleted from this browser. If you did not export a backup, those keys are gone.");
  }

  async function readFile(file: File | undefined | null): Promise<string | null> {
    if (!file) return null;
    try {
      return await file.text();
    } catch {
      setError("the browser could not read that file");
      return null;
    }
  }

  const iterationsDiffer = envelope !== null && envelope.kdf.iterations !== PBKDF2_ITERATIONS;
  const keyCount = session?.keys.length ?? null;

  /* ------------------------------------------------------------------ before the first read */

  if (stored === null) {
    return (
      <div className="mt-3 space-y-3">
        <Skeleton className="h-24" />
        <p className="text-[11px] text-white/40">reading this browser&apos;s storage…</p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <Alert tone="warn" title="Local encrypted storage — keys you grind, locked down">
        <p>
          AES-256-GCM, key derived from your passphrase with {PBKDF2_ROUNDS_LABEL} PBKDF2-{PBKDF2_HASH}{" "}
          rounds. Stored in <span className="text-white/85">this browser only</span> — lose the passphrase
          and the keys are gone. There is no recovery, no reset, and no server copy: clearing this
          browser&apos;s site data destroys the vault. This vault is not the platform treasury above, and
          nothing here is ever sent to the server.
        </p>
      </Alert>

      {!usable ? (
        <Alert tone="error" title="WebCrypto is unavailable in this context">
          The browser exposes <span className="font-mono">crypto.subtle</span> only in a secure context —
          https, or http on localhost. On this origin no key can be derived, created, opened or exported.
          Nothing below will do anything until the page is served over https or localhost.
        </Alert>
      ) : null}

      {stored.error ? (
        <Alert tone="error" title="This browser will not store a vault">
          {stored.error}
        </Alert>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="ok">{notice}</Alert> : null}
      {keyNotes.length > 0 ? (
        <Alert tone="info" title="About the last input">
          <ul className="list-disc space-y-1 pl-4">
            {keyNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {stale ? (
        <Alert tone="warn" title="This vault changed in another tab">
          The ciphertext in this browser is not the one this tab unlocked. Saving from here would overwrite
          that change, so the write buttons are off until you lock and unlock again.
        </Alert>
      ) : null}

      {envelope && !session ? (
        <Card className="p-4">
          <SectionTitle aside="locked">Vault found in this browser</SectionTitle>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <Stat
              label="Cipher"
              value={envelope.cipher.name}
              hint={`${AEAD_TAG_BITS}-bit authentication tag, appended to the ciphertext`}
            />
            <Stat
              label="Key derivation"
              value={`PBKDF2-${envelope.kdf.hash}`}
              hint={
                envelope.kdf.iterations === PBKDF2_ITERATIONS
                  ? `${envelope.kdf.iterations.toLocaleString("en-US")} rounds — the same count this build writes`
                  : `${envelope.kdf.iterations.toLocaleString("en-US")} rounds, not the ${PBKDF2_ROUNDS_LABEL} this build writes`
              }
            />
            <Stat
              label="Salt"
              value={`${SALT_BYTES} bytes`}
              hint="random, stored in the clear — it is not a secret"
            />
            <Stat label="IV" value={`${IV_BYTES} bytes`} hint="fresh on every save" />
            <Stat
              label="Ciphertext"
              value={cipherBytes === null ? "—" : `${cipherBytes.toLocaleString("en-US")} bytes`}
              hint="the keys are inside this, unreadable without the passphrase"
            />
            <Stat
              label="Written"
              value={whenLabel(envelope.createdAt)}
              hint="when the current ciphertext was produced"
            />
            <Stat
              label="Keys stored"
              value="—"
              hint="the count is inside the ciphertext; nothing about the keys is readable while locked"
            />
            <Stat
              label="Where it lives"
              value="this browser"
              hint={`localStorage of this origin, slot ${STORAGE_KEY} — not the server, not the platform treasury`}
            />
          </dl>

          {iterationsDiffer ? (
            <div className="mt-3">
              <Alert tone="warn" title="This vault declares a different round count">
                It is stored with {envelope.kdf.iterations.toLocaleString("en-US")} PBKDF2 rounds while this
                build writes {PBKDF2_ROUNDS_LABEL}. It will still open, because the count is read from the
                blob, and this vault refuses anything outside{" "}
                {MIN_ACCEPTED_ITERATIONS.toLocaleString("en-US")}–
                {MAX_ACCEPTED_ITERATIONS.toLocaleString("en-US")} rounds.
              </Alert>
            </div>
          ) : null}

          <form
            className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
          >
            <Field
              label="Passphrase"
              id="vault-unlock"
              hint="checked by AES-GCM authentication — a wrong passphrase fails, it does not return junk keys"
            >
              <input
                id="vault-unlock"
                name="vault-passphrase"
                type="password"
                autoComplete="current-password"
                value={unlockPass}
                onChange={(e) => setUnlockPass(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Button type="submit" disabled={busy || unlockPass.length === 0}>
              {busy ? "opening…" : "Unlock"}
            </Button>
          </form>
        </Card>
      ) : null}

      {!envelope ? (
        <Card className="p-4">
          <SectionTitle aside="nothing stored yet">Create your vault</SectionTitle>
          <p className="mt-2 text-xs leading-relaxed text-white/45">
            Pick a long passphrase. There is no recovery if you forget it — no reset link, no support path,
            no server that could decrypt this for you.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field
              label="Passphrase"
              id="vault-new"
              hint={`at least ${MIN_PASSPHRASE} characters — it is kept in this tab's memory only, never stored`}
            >
              <input
                id="vault-new"
                name="new-passphrase"
                type="password"
                autoComplete="new-password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field
              label="Repeat passphrase"
              id="vault-new2"
              error={pass2.length > 0 && pass2 !== pass ? "the two passphrases do not match" : null}
            >
              <input
                id="vault-new2"
                name="new-passphrase-confirm"
                type="password"
                autoComplete="new-password"
                value={pass2}
                onChange={(e) => setPass2(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              onClick={() => void createVault()}
              disabled={busy || !usable || pass.length === 0 || pass2.length === 0}
            >
              {busy ? "deriving key…" : "Create vault"}
            </Button>
            <Badge tone="neutral">
              {PBKDF2_ROUNDS_LABEL} rounds · PBKDF2-{PBKDF2_HASH}
            </Badge>
            <LinkButton href="/grinder" size="sm">
              Grind a mint first
            </LinkButton>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-white/40">
            Creating a vault produces an empty one: a random {SALT_BYTES}-byte salt, one encrypted payload,
            and nothing else. It is saved in this browser&apos;s localStorage under{" "}
            <span className="font-mono">{STORAGE_KEY}</span>.
          </p>
        </Card>
      ) : null}

      {session ? (
        <>
          <Card className="p-4">
            <SectionTitle aside={keyCount === null ? "—" : `${keyCount} key${keyCount === 1 ? "" : "s"} · unlocked`}>
              Keys in this vault
            </SectionTitle>

            {session.keys.length === 0 ? (
              <p className="mt-3 text-xs leading-relaxed text-white/45">
                The vault is empty. Paste a grinded mint keypair below, or upload the{" "}
                <span className="font-mono">.json</span> the grinder downloaded.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {session.keys.map((k) => (
                  <li key={k.address} className="rounded-md border border-white/10 bg-white/[0.015] p-3">
                    <div className="min-w-0">
                      <p className="break-all font-mono text-xs text-white/85">{k.address}</p>
                      <p className="mt-1 text-[11px] text-white/40">
                        {k.label ? `${k.label} · ` : ""}
                        added {whenLabel(k.addedAt)}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => void copy(`addr:${k.address}`, k.address)}>
                        {copied === `addr:${k.address}` ? "copied" : "Copy address"}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setRevealed((r) => (r === k.address ? null : k.address))}
                      >
                        {revealed === k.address ? "Hide secret key" : "Show secret key"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void copy(`json:${k.address}`, JSON.stringify(k.secretKey))}
                      >
                        {copied === `json:${k.address}` ? "copied" : "Copy keypair JSON"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void removeKey(k.address)} disabled={stale}>
                        {pendingRemove === k.address ? "Confirm remove" : "Remove"}
                      </Button>
                    </div>
                    {revealed === k.address ? (
                      <>
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded border border-amber-500/25 bg-amber-500/5 p-2 font-mono text-[11px] text-amber-100">
                          {JSON.stringify(k.secretKey)}
                        </pre>
                        <p className="mt-1 text-[11px] text-amber-200/80">
                          That is the private key, on screen. It signs the launch; anyone who can read this
                          screen can take it.
                        </p>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setSession(null)}>
                Lock
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void reEncrypt()} disabled={busy || stale}>
                Re-encrypt now
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  storedText
                    ? download(`claw-vault-backup-${new Date().toISOString().slice(0, 10)}.json`, storedText)
                    : undefined
                }
                disabled={!storedText}
              >
                Export backup
              </Button>
              <Button size="sm" variant="secondary" onClick={() => storedText && void copy("blob", storedText)}>
                {copied === "blob" ? "copied" : "Copy backup blob"}
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/40">
              The backup is the same encrypted blob that sits in this browser — it contains no plaintext
              keys, and restoring it elsewhere still needs the passphrase. There is no unencrypted export:
              that is the point of the vault, and it is also why losing the passphrase is final.
            </p>
          </Card>

          <Card className="p-4">
            <SectionTitle aside="encrypted before it is written">Add a mint keypair</SectionTitle>
            <div className="mt-3 grid gap-3">
              <Field
                label="Paste keypair JSON"
                id="vault-add"
                hint={`${KEYPAIR_JSON_HINT} — a { "secretKey": [...] } object works too, and a list of either adds several at once`}
              >
                <textarea
                  id="vault-add"
                  name="keypair-json"
                  rows={4}
                  spellCheck={false}
                  value={pasteKey}
                  onChange={(e) => setPasteKey(e.target.value)}
                  placeholder="[12,34,56,… 64 numbers]"
                  className={`font-mono text-xs ${inputClass}`}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => void addKeypairs(pasteKey)}
                  disabled={busy || stale || pasteKey.trim().length === 0}
                >
                  {busy ? "encrypting…" : "Encrypt and store"}
                </Button>
                <label
                  htmlFor="vault-key-file"
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1 text-[12px] font-medium text-white/85 transition-colors hover:border-white/30 hover:bg-white/5"
                >
                  Upload keypair .json
                </label>
                <input
                  ref={keyFile}
                  id="vault-key-file"
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  onChange={(e) => {
                    void (async () => {
                      const text = await readFile(e.target.files?.[0]);
                      if (text) await addKeypairs(text);
                    })();
                  }}
                />
              </div>
              <p className="text-[11px] leading-relaxed text-white/40">
                Every key is re-derived from its own bytes before it is stored, and a keypair whose bytes
                disagree with a <span className="font-mono">publicKey</span> in the same JSON is refused. The
                grinder on this site writes exactly this format with its{" "}
                <span className="font-mono">Download keypair JSON</span> button — paste it here, or upload the
                file.
              </p>
            </div>
          </Card>

          <Card className="p-4">
            <SectionTitle aside="irreversible">Delete this vault</SectionTitle>
            <p className="mt-2 text-xs leading-relaxed text-white/45">
              This erases the encrypted blob from this browser. Any key that was never written down or
              exported is unrecoverable after this — the ciphertext is the only copy.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant={confirmDestroy ? "primary" : "secondary"}
                size="sm"
                onClick={() => void destroyVault()}
                disabled={busy}
              >
                {confirmDestroy ? "Yes — delete the vault from this browser" : "Delete vault"}
              </Button>
              {confirmDestroy ? (
                <Button variant="ghost" size="sm" onClick={() => setConfirmDestroy(false)}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </Card>
        </>
      ) : null}

      <Card className="p-4">
        <SectionTitle aside="replaces what is in this browser">Restore backup</SectionTitle>
        <p className="mt-2 text-xs leading-relaxed text-white/45">
          Open a backup blob exported from this vault (or one from another machine) with the passphrase it
          was written with. Restoring stores it here; it does not touch the platform treasury.
        </p>
        <div className="mt-3 grid gap-3">
          <Field
            label="Backup JSON"
            id="vault-restore"
            hint="the whole .json file, pasted as text — or use the upload button below"
          >
            <textarea
              id="vault-restore"
              name="backup-json"
              rows={4}
              spellCheck={false}
              value={restoreText}
              onChange={(e) => setRestoreText(e.target.value)}
              placeholder='{ "format": "claw-local-vault", … }'
              className={`font-mono text-xs ${inputClass}`}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Passphrase for that backup" id="vault-restore-pass">
              <input
                id="vault-restore-pass"
                name="restore-passphrase"
                type="password"
                autoComplete="off"
                value={restorePass}
                onChange={(e) => setRestorePass(e.target.value)}
                className={inputClass}
              />
            </Field>
            <div className="flex items-end">
              <div className="flex flex-wrap items-center gap-2">
                <label
                  htmlFor="vault-restore-file"
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1 text-[12px] font-medium text-white/85 transition-colors hover:border-white/30 hover:bg-white/5"
                >
                  Upload backup .json
                </label>
                <input
                  ref={restoreFile}
                  id="vault-restore-file"
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  onChange={(e) => {
                    void (async () => {
                      const text = await readFile(e.target.files?.[0]);
                      if (text) setRestoreText(text);
                    })();
                  }}
                />
              </div>
            </div>
          </div>
          {envelope ? (
            <label className="flex items-start gap-2 text-xs text-white/55">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={replaceConfirmed}
                onChange={(e) => setReplaceConfirmed(e.target.checked)}
              />
              Replace the vault already stored in this browser. Nothing can undo this unless the current
              vault was exported first.
            </label>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => void restoreBackup()}
              disabled={busy || !usable || restoreText.trim().length === 0 || restorePass.length === 0}
            >
              {busy ? "opening…" : "Restore backup"}
            </Button>
            <Badge tone="neutral">
              {MIN_ACCEPTED_ITERATIONS.toLocaleString("en-US")}–
              {MAX_ACCEPTED_ITERATIONS.toLocaleString("en-US")} rounds accepted
            </Badge>
          </div>
          <p className="text-[11px] leading-relaxed text-white/40">
            A backup declares its own round count, and this vault reads it from the file rather than
            assuming {PBKDF2_ROUNDS_LABEL} — so a blob written by a build with different parameters still
            opens. Anything outside the accepted window above is refused instead of being run.
          </p>
        </div>
      </Card>

      <p className="text-[11px] leading-relaxed text-white/40">
        Summary of what this section can and cannot do: it stores keypairs you paste or upload, encrypted
        with a passphrase, in this browser&apos;s localStorage; it exports and restores that encrypted blob;
        it never uploads anything, never sends a transaction, and has no path to the platform treasury
        above. A passphrase that is forgotten, or a browser whose site data is cleared, takes the keys with
        it — no exceptions and no recovery.
      </p>
    </div>
  );
}
