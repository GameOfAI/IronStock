/**
 * Login page.
 *
 * Two-phase flow:
 *   Phase 1: username + password submitted.
 *   Phase 2: if server returns mfa_required, a TOTP dialog pops up over the
 *            login form — user enters the 6-digit code and clicks "Doğrula".
 *            The same username/password are reused; only totp_code is added.
 *
 * After server auth:
 *   3. GET /users/me/keypair      → keypair material
 *   4. Argon2id(master_pwd, kek_salt, kek_params)
 *   5. AES-GCM-decrypt(private_key_enc, KEK)
 *   6. authStore.setSession(...)
 *   7. navigate(state.from || '/inventory')
 *
 * Step 4 takes ~200-500ms on a modern CPU; we surface the substep label
 * ("Anahtar türetiliyor...") so the user knows we're not hung.
 */

import * as React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Key, Loader2, ShieldCheck, LogIn, Fingerprint } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useLoginMutation } from '@/api/auth';
import { fetchMyKeypair } from '@/api/me';
import {
  useWebAuthnLoginBeginMutation,
  useWebAuthnLoginFinishMutation,
} from '@/api/webauthn';
import { authenticateWithKey, isWebAuthnSupported } from '@/lib/webauthn';
import { useAuthStore } from '@/store/auth';
import type { SessionUser } from '@/store/auth';
import { decryptPrivateKey, deriveKEK, fromBase64 } from '@/lib/crypto';
import type { KEKParams } from '@/lib/crypto';
import { ApiError, ErrCode } from '@/api/errors';
import { usePublicSSOProvidersQuery } from '@/api/admin-sso';
import type { SSOProviderInfo } from '@/api/types';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { APP_VERSION } from '@/version';
import { userFriendlyError } from '@/lib/user-error';

// --- Password input with show/hide toggle ---

interface PasswordInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  value: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
}

function PasswordInput({ value, onChange, disabled, className, ...rest }: PasswordInputProps) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      {/* Lock icon on the left */}
      <Eye className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
      <input
        {...rest}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder="••••••••"
        className={className ?? 'w-full rounded-md border border-slate-700 bg-slate-950/60 py-2.5 pl-9 pr-10 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40 disabled:opacity-60'}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-300 disabled:opacity-40 transition-colors"
        aria-label={visible ? 'Parolayı gizle' : 'Parolayı göster'}
      >
        {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// ---

type Substep = 'idle' | 'authenticating' | 'fetching_keypair' | 'deriving_key' | 'unlocking';

function substepLabel(s: Substep): string {
  switch (s) {
    case 'authenticating':
      return 'Kimlik doğrulanıyor...';
    case 'fetching_keypair':
      return 'Anahtar paketi alınıyor...';
    case 'deriving_key':
      return 'Anahtar türetiliyor (yavaş olabilir)...';
    case 'unlocking':
      return 'Kasa açılıyor...';
    default:
      return 'Giriş Yap';
  }
}

// ─── LDAP login dialog ───

interface LDAPDialogProps {
  provider: SSOProviderInfo;
  open: boolean;
  onClose: () => void;
}

function LDAPDialog({ provider, open, onClose }: LDAPDialogProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const setBootstrapSession = useAuthStore((s) => s.setBootstrapSession);
  const [ldapUsername, setLdapUsername] = React.useState('');
  const [ldapPassword, setLdapPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function handleLDAPSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !ldapUsername || !ldapPassword) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/auth/ldap/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_id: provider.id,
          username: ldapUsername,
          password: ldapPassword,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'LDAP girişi başarısız.' }));
        throw new Error(body.message ?? 'LDAP girişi başarısız.');
      }
      const data = await res.json() as {
        access_token: string;
        refresh_token: string;
        user_id: string;
        roles: string[];
      };
      // LDAP users don't have a KEK-derived keypair → bootstrap session.
      setBootstrapSession({
        user: { id: data.user_id, username: ldapUsername, roles: data.roles ?? [] },
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
      });
      navigate('/inventory', { replace: true });
    } catch (err) {
      toast({
        title: 'LDAP girişi başarısız',
        description: userFriendlyError(err),
        variant: 'destructive',
      });
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="border-slate-800 bg-slate-900 sm:max-w-sm" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <LogIn className="h-5 w-5 text-blue-400" />
            {provider.name} ile Giriş
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Kurumsal LDAP / Active Directory kimlik bilgilerinizi girin.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleLDAPSubmit} className="flex flex-col gap-4 pt-2">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-wider text-slate-400">Kullanıcı Adı</label>
            <input
              value={ldapUsername}
              onChange={(e) => setLdapUsername(e.target.value)}
              placeholder="john.doe"
              autoComplete="username"
              required
              disabled={busy}
              className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40 disabled:opacity-60"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-wider text-slate-400">Parola</label>
            <PasswordInput
              value={ldapPassword}
              onChange={(e) => setLdapPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={busy}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-slate-700 bg-transparent px-4 py-2 text-[13px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={busy || !ldapUsername || !ldapPassword}
              className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Giriş yapılıyor…</> : 'Giriş Yap'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main LoginPage ───

export default function LoginPage() {
  useDocumentTitle('Giriş');
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const setSession = useAuthStore((s) => s.setSession);
  const setBootstrapSession = useAuthStore((s) => s.setBootstrapSession);
  const loginMut = useLoginMutation();

  // SSO providers (public endpoint — no auth required)
  const { data: ssoData } = usePublicSSOProvidersQuery();
  const ssoProviders = ssoData?.providers ?? [];
  const oidcProviders = ssoProviders.filter((p) => p.provider_type === 'oidc');
  const ldapProviders = ssoProviders.filter((p) => p.provider_type === 'ldap');

  // LDAP dialog state
  const [activeLDAPProvider, setActiveLDAPProvider] = React.useState<SSOProviderInfo | null>(null);

  // WebAuthn login state
  const waLoginBegin = useWebAuthnLoginBeginMutation();
  const waLoginFinish = useWebAuthnLoginFinishMutation();
  const [waUsername, setWaUsername] = React.useState('');
  const [waDialogOpen, setWaDialogOpen] = React.useState(false);
  const [waBusy, setWaBusy] = React.useState(false);
  // Server reports 501/not_configured when WebAuthn isn't enabled. Once we
  // learn that, hide the security-key UI for the rest of the session instead
  // of showing a scary error toast (browser support != server support).
  const [waUnavailable, setWaUnavailable] = React.useState(false);

  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');

  // TOTP dialog state
  const [totpDialogOpen, setTotpDialogOpen] = React.useState(false);
  const [totpCode, setTotpCode] = React.useState('');
  const [rememberDevice, setRememberDevice] = React.useState(false);

  const [substep, setSubstep] = React.useState<Substep>('idle');

  const busy = substep !== 'idle';

  const rawFrom = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;
  const fromPath = rawFrom && rawFrom !== '/change-password' ? rawFrom : undefined;

  // Core login flow — used by both Phase 1 (no TOTP) and Phase 2 (with TOTP)
  async function runLogin(opts: { totp?: string; remember?: boolean }) {
    setSubstep('authenticating');
    const loginRes = await loginMut.mutateAsync({
      username: username.toLowerCase(),
      master_password: password,
      totp_code: opts.totp || undefined,
      remember_device: opts.remember || undefined,
    });

    const sessionUser: SessionUser = {
      id: loginRes.user_id,
      username,
      roles: loginRes.roles,
    };

    setSubstep('fetching_keypair');
    let keypair: Awaited<ReturnType<typeof fetchMyKeypair>> | null = null;
    try {
      keypair = await fetchMyKeypair(loginRes.access_token);
    } catch {
      // Bootstrap admin or first-run: no keypair yet → bootstrap session.
    }

    if (!keypair || (keypair.kek_params as Record<string, unknown>)?.alg === 'none') {
      setBootstrapSession({
        user: sessionUser,
        accessToken: loginRes.access_token,
        refreshToken: loginRes.refresh_token,
        mustChangePassword: loginRes.must_change_password,
        mustSetupTOTP: loginRes.must_setup_totp,
      });
    } else {
      const kekParams = keypair.kek_params as unknown as KEKParams & { alg?: string };
      setSubstep('deriving_key');
      const kekSalt = fromBase64(keypair.kek_salt);
      const kek = await deriveKEK(password, kekSalt, kekParams);

      setSubstep('unlocking');
      const privateKeyEnc = fromBase64(keypair.private_key_enc);
      const privateKey = await decryptPrivateKey(privateKeyEnc, kek);

      setSession({
        user: sessionUser,
        accessToken: loginRes.access_token,
        refreshToken: loginRes.refresh_token,
        kek,
        privateKey,
        mustChangePassword: loginRes.must_change_password,
        mustSetupTOTP: loginRes.must_setup_totp,
      });
    }

    navigate(fromPath ?? '/inventory', { replace: true });
  }

  // WebAuthn login flow
  async function onWebAuthnLogin(e: React.FormEvent) {
    e.preventDefault();
    if (waBusy || !waUsername.trim()) return;
    setWaBusy(true);
    try {
      const beginRes = await waLoginBegin.mutateAsync(waUsername.trim().toLowerCase());
      const credentialJSON = await authenticateWithKey(
        beginRes.options as Parameters<typeof authenticateWithKey>[0],
      );
      const finishRes = await waLoginFinish.mutateAsync({
        user_id: beginRes.user_id,
        session_key: beginRes.session_key,
        credential: JSON.parse(credentialJSON),
      });
      // WebAuthn login returns tokens — but no KEK; bootstrap session (no E2E decrypt)
      setBootstrapSession({
        user: { id: finishRes.user_id, username: waUsername.trim(), roles: finishRes.roles ?? [] },
        accessToken: finishRes.access_token,
        refreshToken: finishRes.refresh_token,
      });
      navigate(fromPath ?? '/inventory', { replace: true });
    } catch (err) {
      // Server doesn't have WebAuthn configured — hide the option for this
      // session and inform the user gently instead of a destructive error.
      if (err instanceof ApiError && (err.status === 501 || err.code === 'not_configured')) {
        setWaUnavailable(true);
        setWaDialogOpen(false);
        setWaUsername('');
        toast({
          title: 'Güvenlik anahtarı bu sunucuda etkin değil',
          description: 'Lütfen kullanıcı adı ve parola ile giriş yapın.',
        });
        setWaBusy(false);
        return;
      }
      const msg = userFriendlyError(err);
      if (!msg.includes('NotAllowed') && !msg.includes('abort') && !msg.includes('cancelled')) {
        toast({
          title: 'Güvenlik anahtarı ile giriş başarısız',
          description: msg,
          variant: 'destructive',
        });
      }
      setWaBusy(false);
    }
  }

  // Phase 1: username + password form submit
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!username || !password) {
      toast({
        title: 'Eksik alan',
        description: 'Kullanıcı adı ve şifre zorunlu.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await runLogin({});
    } catch (err) {
      setSubstep('idle');
      // Server says 2FA is required → open TOTP dialog
      if (err instanceof ApiError && err.code === ErrCode.MFARequired) {
        setTotpCode('');
        setTotpDialogOpen(true);
        return;
      }
      toast({
        title: 'Giriş başarısız',
        description: userFriendlyError(err),
        variant: 'destructive',
      });
    }
  }

  // Phase 2: TOTP dialog submit
  async function onTotpSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!totpCode || totpCode.length < 6) {
      toast({
        title: 'Eksik kod',
        description: '6 haneli doğrulama kodunu girin.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await runLogin({ totp: totpCode, remember: rememberDevice });
      // Success → dialog closes automatically via navigation
    } catch (err) {
      setSubstep('idle');
      toast({
        title: 'Doğrulama başarısız',
        description: userFriendlyError(err),
        variant: 'destructive',
      });
    }
  }

  function handleTotpCancel() {
    setTotpDialogOpen(false);
    setTotpCode('');
    setRememberDevice(false);
    setSubstep('idle');
  }

  const totpBusy = totpDialogOpen && busy;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950">
      {/* Grid texture overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(148,163,184,1) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,1) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      {/* Blue glow */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600/10 blur-[120px]" />

      <div className="relative w-full max-w-sm px-4">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-blue-600 shadow-lg shadow-blue-600/30">
            <Key className="h-[22px] w-[22px] text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-tight text-slate-100">IronStock</h1>
            <p className="mt-0.5 font-mono text-[11px] text-slate-500">
              DevOps Credential Vault · v{APP_VERSION}
            </p>
          </div>
        </div>

        {/* LDAP dialog */}
        {activeLDAPProvider && (
          <LDAPDialog
            provider={activeLDAPProvider}
            open={!!activeLDAPProvider}
            onClose={() => setActiveLDAPProvider(null)}
          />
        )}

        {/* Main card */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-black/60 backdrop-blur-sm">
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <h2 className="text-[15px] font-semibold text-slate-100">Giriş Yap</h2>
              <p className="mt-0.5 text-[12px] text-slate-400">Yetkili kullanıcılar için.</p>
            </div>

            <div className="space-y-3">
              <div>
                <label
                  htmlFor="login-username"
                  className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate-400"
                >
                  Kullanıcı Adı
                </label>
                <div className="relative">
                  <Eye className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                  <input
                    id="login-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="admin"
                    autoComplete="username"
                    required
                    disabled={busy}
                    className="w-full rounded-md border border-slate-700 bg-slate-950/60 py-2.5 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40 disabled:opacity-60"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate-400"
                >
                  Master Parola
                </label>
                <PasswordInput
                  id="login-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  minLength={12}
                  disabled={busy}
                  className="w-full rounded-md border border-slate-700 bg-slate-950/60 py-2.5 pl-9 pr-10 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40 disabled:opacity-60"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 py-2.5 text-[13px] font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
            >
              {busy && !totpDialogOpen ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {substepLabel(substep)}
                </>
              ) : (
                'Devam Et →'
              )}
            </button>

            <div className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <span>Tüm oturumlar uçtan uca şifrelenir. İzinsiz giriş loglanır.</span>
            </div>

            <div className="flex items-center justify-center gap-3 text-center text-[12px]">
              <Link to="/recover" className="text-slate-500 hover:text-slate-300">
                Hesabınızı mı unuttunuz?
              </Link>
              <span className="text-slate-700">·</span>
              <Link to="/forgot-password" className="text-slate-500 hover:text-slate-300">
                Şifremi unuttum
              </Link>
            </div>
          </form>

          {/* SSO providers section */}
          {ssoProviders.length > 0 && (
            <div className="mt-5">
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-slate-800" />
                <span className="text-[11px] text-slate-500">veya SSO ile devam et</span>
                <span className="h-px flex-1 bg-slate-800" />
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {/* OIDC providers → browser redirect to /authorize */}
                {oidcProviders.map((p) => (
                  <a
                    key={p.id}
                    href={`/api/v1/auth/sso/${p.id}/authorize`}
                    className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-900 py-2.5 text-[13px] text-slate-300 transition hover:border-blue-600/60 hover:bg-slate-800 hover:text-slate-100"
                  >
                    <LogIn className="h-3.5 w-3.5 text-blue-400" />
                    {p.name} ile Giriş Yap
                  </a>
                ))}
                {/* LDAP providers → inline dialog */}
                {ldapProviders.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActiveLDAPProvider(p)}
                    className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-900 py-2.5 text-[13px] text-slate-300 transition hover:border-blue-600/60 hover:bg-slate-800 hover:text-slate-100"
                  >
                    <LogIn className="h-3.5 w-3.5 text-amber-400" />
                    {p.name} ile Giriş Yap (LDAP)
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* WebAuthn / Security Key section (PR-SEC4) */}
          {isWebAuthnSupported() && !waUnavailable && (
            <div className="mt-5">
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-slate-800" />
                <span className="text-[11px] text-slate-500">veya güvenlik anahtarı ile</span>
                <span className="h-px flex-1 bg-slate-800" />
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setWaDialogOpen(true)}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-900 py-2.5 text-[13px] text-slate-300 transition hover:border-indigo-600/60 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50"
                >
                  <Fingerprint className="h-3.5 w-3.5 text-indigo-400" />
                  Güvenlik Anahtarı ile Giriş Yap
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="mt-4 text-center font-mono text-[10px] text-slate-600">
          IronStock © 2026 · Tüm hakları saklıdır
        </p>
      </div>

      {/* WebAuthn login dialog (PR-SEC4) */}
      <Dialog open={waDialogOpen} onOpenChange={(o) => { if (!o && !waBusy) { setWaDialogOpen(false); setWaUsername(''); } }}>
        <DialogContent
          className="border-slate-800 bg-slate-900 sm:max-w-sm"
          onInteractOutside={(e) => { if (waBusy) e.preventDefault(); }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-100">
              <Fingerprint className="h-5 w-5 text-indigo-400" />
              Güvenlik Anahtarı ile Giriş
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Kullanıcı adınızı girin, ardından güvenlik anahtarınıza dokunun.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onWebAuthnLogin} className="flex flex-col gap-4 pt-2">
            <div className="flex flex-col gap-1.5">
              <label className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                Kullanıcı Adı
              </label>
              <input
                value={waUsername}
                onChange={(e) => setWaUsername(e.target.value)}
                placeholder="admin"
                autoComplete="username webauthn"
                required
                disabled={waBusy}
                autoFocus
                className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/40 disabled:opacity-60"
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <button
                type="button"
                onClick={() => { setWaDialogOpen(false); setWaUsername(''); }}
                disabled={waBusy}
                className="rounded-md border border-slate-700 bg-transparent px-4 py-2 text-[13px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                İptal
              </button>
              <button
                type="submit"
                disabled={waBusy || !waUsername.trim()}
                className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {waBusy ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Anahtara dokunun…
                  </>
                ) : (
                  <>
                    <Fingerprint className="h-3.5 w-3.5" />
                    Devam Et
                  </>
                )}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* TOTP dialog — appears after successful password auth when MFA is required */}
      <Dialog
        open={totpDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleTotpCancel();
        }}
      >
        <DialogContent
          className="border-slate-800 bg-slate-900 sm:max-w-sm"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-100">
              <ShieldCheck className="h-5 w-5 text-blue-400" />
              İki Faktörlü Doğrulama
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              <span className="font-mono text-slate-300">{username}</span> için TOTP kodunu girin.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onTotpSubmit} className="flex flex-col gap-4 pt-2">
            <div className="flex flex-col gap-1.5">
              <label className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                Doğrulayıcı Kodu
              </label>
              <input
                id="totp-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={8}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000 000"
                autoFocus
                required
                disabled={totpBusy}
                className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-4 py-2.5 text-center font-mono text-xl tracking-[0.4em] text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40 disabled:opacity-60"
              />
              <p className="text-[11px] text-slate-500">
                Google Authenticator veya uyumlu TOTP uygulamasını kullanın.
              </p>
            </div>

            <label className="flex cursor-pointer select-none items-center gap-2 text-[12px] text-slate-400">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-slate-700 accent-blue-600"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                disabled={totpBusy}
              />
              Bu cihazı 30 gün hatırla
            </label>

            <DialogFooter className="gap-2 sm:gap-0">
              <button
                type="button"
                onClick={handleTotpCancel}
                disabled={totpBusy}
                className="rounded-md border border-slate-700 bg-transparent px-4 py-2 text-[13px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                İptal
              </button>
              <button
                type="submit"
                disabled={totpBusy || totpCode.length < 6}
                className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {totpBusy ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {substepLabel(substep)}
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-3.5 w-3.5" /> Giriş Yap
                  </>
                )}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
