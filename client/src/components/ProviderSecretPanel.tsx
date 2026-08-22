import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

type ProviderSecretStatus = { available: boolean; stored: boolean; backend: string | null; message: string };

export function ProviderSecretPanel({ provider }: { provider: "manus-built-in" | "openai-compatible" }) {
  const [status, setStatus] = useState<ProviderSecretStatus | null>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const desktop = window.codgramDesktop;

  useEffect(() => {
    let active = true;
    if (!desktop || provider !== "openai-compatible") { setStatus(null); return () => { active = false; }; }
    void desktop.getProviderSecretStatus().then(next => { if (active) setStatus(next); }).catch(() => { if (active) setStatus({ available: false, stored: false, backend: null, message: "Protected local storage could not be checked." }); });
    return () => { active = false; };
  }, [desktop, provider]);

  if (!desktop || provider !== "openai-compatible") return null;
  const save = async () => {
    if (!secret.trim()) return;
    setBusy(true);
    try { setStatus(await desktop.saveProviderSecret(secret)); setSecret(""); }
    catch { setStatus(current => ({ available: current?.available ?? false, stored: current?.stored ?? false, backend: current?.backend ?? null, message: "Codgram could not store that provider secret." })); }
    finally { setBusy(false); }
  };
  const clear = async () => {
    setBusy(true);
    try { setStatus(await desktop.clearProviderSecret()); }
    catch { setStatus(current => ({ available: current?.available ?? false, stored: current?.stored ?? false, backend: current?.backend ?? null, message: "Codgram could not clear protected provider-secret storage." })); }
    finally { setBusy(false); }
  };

  return <section className="border-t border-white/7 px-6 py-5"><div className="flex items-start gap-3"><div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-200"><ShieldCheck className="size-4" /></div><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-100">Protected local provider secret</p><p className="mt-1 text-xs leading-5 text-slate-500">Optional desktop-only storage. The value is sent once to Electron, encrypted with operating-system storage, and is never displayed, included in settings, history, or logs.</p>{status && <p className={status.available ? "mt-2 text-xs text-emerald-200/85" : "mt-2 text-xs text-amber-200/85"}>{status.stored ? <Check className="mr-1 inline size-3.5" /> : <KeyRound className="mr-1 inline size-3.5" />}{status.message}{status.stored ? " A local server restart is applied automatically." : ""}</p>}{status?.available && !status.stored && <div className="mt-4 flex flex-col gap-2 sm:flex-row"><Input aria-label="Protected provider secret" type="password" autoComplete="new-password" value={secret} onChange={event => setSecret(event.target.value)} placeholder="Paste a local provider secret" className="border-white/10 bg-black/20 text-slate-100 placeholder:text-slate-600" /><Button type="button" onClick={save} disabled={busy || !secret.trim()} className="shrink-0 rounded-xl bg-emerald-500 text-white hover:bg-emerald-400">{busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <ShieldCheck className="mr-2 size-4" />}Store securely</Button></div>}{status?.available && status.stored && <div className="mt-4"><Button type="button" variant="outline" onClick={clear} disabled={busy} className="rounded-xl border-rose-400/25 bg-rose-400/[0.04] text-rose-100 hover:bg-rose-400/10 hover:text-white">{busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Trash2 className="mr-2 size-4" />}Clear stored secret</Button></div>}</div></div></section>;
}
