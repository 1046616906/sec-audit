'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useStore } from '@/lib/store';

const inputCls =
  'rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 backdrop-blur-xl focus:border-cyan-500 focus:outline-none';
const labelCls = 'text-xs text-zinc-400 font-mono';

export function AuthModal() {
  const scanStatus = useStore((s) => s.scanStatus);
  const authPageUrl = useStore((s) => s.authPageUrl);
  const currentTaskId = useStore((s) => s.currentTaskId);
  const captchaType = useStore((s) => s.captchaType);
  const captchaImageBase64 = useStore((s) => s.captchaImageBase64);
  const setScanStatus = useStore((s) => s.setScanStatus);
  const setAuthPageUrl = useStore((s) => s.setAuthPageUrl);
  const setCaptchaType = useStore((s) => s.setCaptchaType);
  const setCaptchaImageBase64 = useStore((s) => s.setCaptchaImageBase64);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captchaCode, setCaptchaCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const open = scanStatus === 'paused';

  // Slider: auto-close when scan resumes
  useEffect(() => {
    if (captchaType === 'slider' && scanStatus === 'running') {
      setAuthPageUrl(null);
      setCaptchaType(null);
      setCaptchaImageBase64(null);
    }
  }, [scanStatus, captchaType, setAuthPageUrl, setCaptchaType, setCaptchaImageBase64]);

  function handleOpenChange(next: boolean) {
    if (!next) return; // prevent external close
  }

  function clearState() {
    setUsername('');
    setPassword('');
    setCaptchaCode('');
    setError(null);
    setAuthPageUrl(null);
    setCaptchaType(null);
    setCaptchaImageBase64(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!currentTaskId) return;
    setError(null);
    setSubmitting(true);

    try {
      const payload: Record<string, string> = { taskId: currentTaskId };

      if (captchaType === 'sms' || captchaType === 'email') {
        payload.captchaCode = captchaCode;
      } else if (captchaType === 'image') {
        if (username) payload.username = username;
        if (password) payload.password = password;
        payload.captchaCode = captchaCode;
      } else {
        // unknown / null
        if (username) payload.username = username;
        if (password) payload.password = password;
        if (captchaCode) payload.captchaCode = captchaCode;
      }

      const res = await fetch('/api/worker/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? 'Resume request failed');
        return;
      }

      clearState();
      setScanStatus('running');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border border-zinc-700 bg-zinc-900/90 backdrop-blur-xl text-zinc-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-cyan-400 font-mono text-base">
            Authentication Required
          </DialogTitle>
          {authPageUrl && (
            <DialogDescription className="text-zinc-400 font-mono text-xs break-all">
              {authPageUrl}
            </DialogDescription>
          )}
        </DialogHeader>

        {captchaType === 'slider' ? (
          <SliderStatus />
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3 mt-2">
            {captchaType === 'image' ? (
              <ImageCaptchaFields
                captchaImageBase64={captchaImageBase64}
                username={username}
                password={password}
                captchaCode={captchaCode}
                onUsername={setUsername}
                onPassword={setPassword}
                onCode={setCaptchaCode}
              />
            ) : captchaType === 'sms' ? (
              <CodeOnlyFields
                message="A verification code was sent to your phone. Enter it below."
                label="SMS Code"
                value={captchaCode}
                onChange={setCaptchaCode}
              />
            ) : captchaType === 'email' ? (
              <CodeOnlyFields
                message="A verification code was sent to your email. Enter it below."
                label="Email Code"
                value={captchaCode}
                onChange={setCaptchaCode}
              />
            ) : (
              <DefaultFields
                username={username}
                password={password}
                captchaCode={captchaCode}
                onUsername={setUsername}
                onPassword={setPassword}
                onCode={setCaptchaCode}
              />
            )}

            {error && <p className="text-xs text-red-400 font-mono">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-400 backdrop-blur-xl transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? 'Resuming…' : 'Submit & Resume Scan'}
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SliderStatus() {
  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <motion.div
        className="h-10 w-10 rounded-full border-2 border-cyan-400"
        animate={{ scale: [1, 1.25, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <p className="text-sm text-zinc-300 font-mono">Auto-handling slider captcha…</p>
      <p className="text-xs text-zinc-500 font-mono">This window will close automatically</p>
    </div>
  );
}

function ImageCaptchaFields({
  captchaImageBase64,
  username,
  password,
  captchaCode,
  onUsername,
  onPassword,
  onCode,
}: {
  captchaImageBase64: string | null;
  username: string;
  password: string;
  captchaCode: string;
  onUsername: (v: string) => void;
  onPassword: (v: string) => void;
  onCode: (v: string) => void;
}) {
  return (
    <>
      {captchaImageBase64 && (
        <div className="flex justify-center rounded-lg border border-zinc-700 bg-zinc-800/40 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/png;base64,${captchaImageBase64}`}
            alt="Captcha"
            className="max-h-20 rounded"
          />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="auth-username" className={labelCls}>Username (optional)</label>
        <input id="auth-username" type="text" autoComplete="username" value={username}
          onChange={(e) => onUsername(e.target.value)} className={inputCls} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="auth-password" className={labelCls}>Password (optional)</label>
        <input id="auth-password" type="password" autoComplete="current-password" value={password}
          onChange={(e) => onPassword(e.target.value)} className={inputCls} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="auth-captcha-code" className={labelCls}>Captcha Text</label>
        <input id="auth-captcha-code" type="text" autoComplete="off" value={captchaCode}
          onChange={(e) => onCode(e.target.value)} required className={inputCls} />
      </div>
    </>
  );
}

function CodeOnlyFields({
  message,
  label,
  value,
  onChange,
}: {
  message: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <>
      <p className="text-sm text-zinc-300 font-mono">{message}</p>
      <div className="flex flex-col gap-1">
        <label htmlFor="auth-code" className={labelCls}>{label}</label>
        <input id="auth-code" type="text" autoComplete="one-time-code" value={value}
          onChange={(e) => onChange(e.target.value)} required className={inputCls} />
      </div>
    </>
  );
}

function DefaultFields({
  username,
  password,
  captchaCode,
  onUsername,
  onPassword,
  onCode,
}: {
  username: string;
  password: string;
  captchaCode: string;
  onUsername: (v: string) => void;
  onPassword: (v: string) => void;
  onCode: (v: string) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor="auth-username" className={labelCls}>Username</label>
        <input id="auth-username" type="text" autoComplete="username" value={username}
          onChange={(e) => onUsername(e.target.value)} required className={inputCls} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="auth-password" className={labelCls}>Password</label>
        <input id="auth-password" type="password" autoComplete="current-password" value={password}
          onChange={(e) => onPassword(e.target.value)} required className={inputCls} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="auth-captcha-code" className={labelCls}>Captcha Code (if shown)</label>
        <input id="auth-captcha-code" type="text" autoComplete="off" value={captchaCode}
          onChange={(e) => onCode(e.target.value)} className={inputCls} />
      </div>
    </>
  );
}
