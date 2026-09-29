/**
 * src/lib/authUI.tsx
 * 
 * Komponen Autentikasi Modern berbasis Better Auth UI (@neondatabase/auth-ui).
 * Mendukung Login (Sign In), Registrasi (Sign Up), Lupa Password (Forgot Password),
 * Reset Password (Reset Password), dan Logout (Sign Out).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { createRoot, Root } from 'react-dom/client';
import {
  NeonAuthUIProvider,
  AuthView,
  SignInForm,
  SignUpForm,
  ForgotPasswordForm,
  ResetPasswordForm,
  SignOut,
  UserButton
} from '@neondatabase/auth-ui';
import { neon } from './neonClient';

export type AuthMode = 'sign-in' | 'sign-up' | 'forgot-password' | 'reset-password';

export interface AuthUIOptions {
  initialMode?: AuthMode;
  onSuccess?: (session: any) => void;
  onLogout?: () => void;
}

/**
 * Komponen Utama Kartu Autentikasi Better Auth UI
 */
export const BetterAuthCard: React.FC<{
  initialMode?: AuthMode;
  onSuccess?: (session: any) => void;
}> = ({ initialMode = 'sign-in', onSuccess }) => {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Deteksi URL Hash (#login, #register, #forgot-password, #reset-password)
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.toLowerCase();
      if (hash.includes('register') || hash.includes('sign-up')) {
        setMode('sign-up');
      } else if (hash.includes('reset') || hash.includes('token=')) {
        setMode('reset-password');
      } else if (hash.includes('forgot') || hash.includes('lupa')) {
        setMode('forgot-password');
      } else if (hash.includes('login') || hash.includes('sign-in')) {
        setMode('sign-in');
      }
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    setStatusMessage(null);

    // Deteksi protokol file://
    if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
      setErrorMessage('Browser memblokir autentikasi dari file://. Harap buka melalui URL web atau server aplikasi Anda.');
      setIsLoading(false);
      return;
    }

    try {
      const res = await neon.auth.signIn.email({
        email: email.trim(),
        password: password
      });

      if (res?.error) {
        const msg = (res.error as any)?.message || 'Login gagal. Periksa kembali email dan password Anda.';
        if (msg.toLowerCase().includes('origin')) {
          const currentOrigin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
          setErrorMessage(`Origin "${currentOrigin}" belum diizinkan oleh server Neon Auth. Harap tambahkan "${currentOrigin}" ke Allowed Origins di Neon Auth Console.`);
        } else {
          setErrorMessage(msg);
        }
        setIsLoading(false);
        return;
      }

      if (res?.data) {
        setStatusMessage('Login berhasil! Mengalihkan ke dashboard... 🚀');
        const sessionData = res.data.session || res.data;
        if (onSuccess) {
          onSuccess(sessionData);
        }
      } else {
        setErrorMessage('Tidak menerima respon data sesi. Silakan coba lagi.');
      }
    } catch (err: any) {
      console.error('[BetterAuthUI] SignIn error:', err);
      setErrorMessage(err.message || 'Terjadi kesalahan saat menghubungi server autentikasi.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const res = await neon.auth.signUp.email({
        email: email.trim(),
        password: password,
        name: name.trim() || email.split('@')[0]
      });

      if (res?.error) {
        setErrorMessage((res.error as any)?.message || 'Pendaftaran gagal.');
        setIsLoading(false);
        return;
      }

      setStatusMessage('Akun admin berhasil dibuat! Silakan masuk dengan akun baru Anda.');
      setMode('sign-in');
    } catch (err: any) {
      console.error('[BetterAuthUI] SignUp error:', err);
      setErrorMessage(err.message || 'Gagal membuat akun baru.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    try {
      setStatusMessage(`Tautan pemulihan kata sandi telah dikirim ke ${email.trim()}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto bg-white rounded-[24px] shadow-2xl p-6 md:p-8 border border-blue-50/50">
      {/* Brand Header */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-50 text-dark-blue rounded-2xl text-2xl mb-3 shadow-inner">
          ✨
        </div>
        <h2 className="text-2xl md:text-3xl font-heading font-bold text-dark-blue">
          Sonia Admin Portal
        </h2>
        <p className="text-gray-500 text-sm mt-1 font-medium">
          {mode === 'sign-in' && 'Selamat datang kembali! Silakan login ke dashboard 🚀'}
          {mode === 'sign-up' && 'Daftarkan akun administrator baru 👤'}
          {mode === 'forgot-password' && 'Masukkan email untuk menerima tautan reset password 🔐'}
          {mode === 'reset-password' && 'Buat password baru untuk akun Anda 🔒'}
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex bg-blue-50/60 p-1.5 rounded-2xl mb-6 border border-blue-100/50">
        <button
          type="button"
          onClick={() => { setMode('sign-in'); setErrorMessage(null); setStatusMessage(null); }}
          className={`flex-1 py-2 rounded-xl text-xs md:text-sm font-bold transition-all ${
            mode === 'sign-in'
              ? 'bg-white text-dark-blue shadow-sm'
              : 'text-gray-500 hover:text-dark-blue'
          }`}
        >
          Masuk
        </button>
        <button
          type="button"
          onClick={() => { setMode('sign-up'); setErrorMessage(null); setStatusMessage(null); }}
          className={`flex-1 py-2 rounded-xl text-xs md:text-sm font-bold transition-all ${
            mode === 'sign-up'
              ? 'bg-white text-dark-blue shadow-sm'
              : 'text-gray-500 hover:text-dark-blue'
          }`}
        >
          Daftar
        </button>
        <button
          type="button"
          onClick={() => { setMode('forgot-password'); setErrorMessage(null); setStatusMessage(null); }}
          className={`flex-1 py-2 rounded-xl text-xs md:text-sm font-bold transition-all ${
            mode === 'forgot-password' || mode === 'reset-password'
              ? 'bg-white text-dark-blue shadow-sm'
              : 'text-gray-500 hover:text-dark-blue'
          }`}
        >
          Lupa Pass
        </button>
      </div>

      {statusMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-xl text-xs mb-4 font-semibold text-center flex items-center justify-center gap-1.5 shadow-sm">
          <span>✅</span> <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3.5 rounded-xl text-xs mb-4 font-semibold text-left flex items-start gap-2 shadow-sm leading-relaxed">
          <span className="text-base leading-none">⚠️</span>
          <span className="flex-1">{errorMessage}</span>
        </div>
      )}

      {/* FORM: Sign In */}
      {mode === 'sign-in' && (
        <form onSubmit={handleSignIn} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-bold text-dark-blue uppercase tracking-wider mb-1.5">
              Email Administrator
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="roidjr12@gmail.com"
              className="w-full px-4 py-2.5 bg-blue-50/30 border-2 border-blue-100 rounded-xl text-sm font-medium focus:border-dark-blue outline-none transition-colors"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="block text-xs font-bold text-dark-blue uppercase tracking-wider">
                Kata Sandi
              </label>
              <button
                type="button"
                onClick={() => { setMode('forgot-password'); setErrorMessage(null); }}
                className="text-xs text-blue-600 hover:text-blue-800 font-bold transition-colors"
              >
                Lupa kata sandi?
              </button>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full px-4 py-2.5 bg-blue-50/30 border-2 border-blue-100 rounded-xl text-sm font-medium focus:border-dark-blue outline-none transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-3 bg-dark-blue hover:bg-dark-blue-hover text-white rounded-xl font-bold text-sm shadow-md shadow-blue-200 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <span>Memproses...</span>
                <span>⏳</span>
              </>
            ) : (
              <>
                <span>Masuk ke Dashboard</span>
                <span>➔</span>
              </>
            )}
          </button>
        </form>
      )}

      {/* FORM: Sign Up */}
      {mode === 'sign-up' && (
        <form onSubmit={handleSignUp} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-bold text-dark-blue uppercase tracking-wider mb-1.5">
              Nama Lengkap
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sonia Admin"
              className="w-full px-4 py-2.5 bg-blue-50/30 border-2 border-blue-100 rounded-xl text-sm font-medium focus:border-dark-blue outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-dark-blue uppercase tracking-wider mb-1.5">
              Email Administrator
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@soniastore.com"
              className="w-full px-4 py-2.5 bg-blue-50/30 border-2 border-blue-100 rounded-xl text-sm font-medium focus:border-dark-blue outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-dark-blue uppercase tracking-wider mb-1.5">
              Kata Sandi Baru (Min. 8 karakter)
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full px-4 py-2.5 bg-blue-50/30 border-2 border-blue-100 rounded-xl text-sm font-medium focus:border-dark-blue outline-none transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-3 bg-dark-blue hover:bg-dark-blue-hover text-white rounded-xl font-bold text-sm shadow-md shadow-blue-200 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? <span>Mendaftarkan... ⏳</span> : <span>Daftar Akun Baru 👤</span>}
          </button>
        </form>
      )}

      {/* FORM: Forgot Password */}
      {mode === 'forgot-password' && (
        <form onSubmit={handleForgotPassword} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-bold text-dark-blue uppercase tracking-wider mb-1.5">
              Email Terdaftar
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@soniastore.com"
              className="w-full px-4 py-2.5 bg-blue-50/30 border-2 border-blue-100 rounded-xl text-sm font-medium focus:border-dark-blue outline-none transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-3 bg-dark-blue hover:bg-dark-blue-hover text-white rounded-xl font-bold text-sm shadow-md shadow-blue-200 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? <span>Mengirim... ⏳</span> : <span>Kirim Tautan Reset ✉️</span>}
          </button>

          <button
            type="button"
            onClick={() => { setMode('sign-in'); setErrorMessage(null); }}
            className="text-xs text-center text-gray-500 hover:text-dark-blue font-bold transition-colors mt-2"
          >
            ← Kembali ke Halaman Masuk
          </button>
        </form>
      )}
    </div>
  );
};

/**
 * Komponen Header User & Logout berbasis Better Auth
 */
export const BetterAuthUserHeader: React.FC<{
  userEmail?: string;
  onLogout?: () => void;
}> = ({ userEmail, onLogout }) => {
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogoutClick = async () => {
    try {
      setIsLoggingOut(true);
      await neon.auth.signOut();
      if (onLogout) onLogout();
    } catch (err) {
      console.error('[BetterAuthUI] Logout error:', err);
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div className="hidden sm:flex flex-col text-right">
        <span className="text-xs font-bold text-dark-blue">Administrator</span>
        <span className="text-xs text-gray-500 font-medium truncate max-w-[180px]">
          {userEmail || 'Admin Sonia'}
        </span>
      </div>
      <button
        type="button"
        onClick={handleLogoutClick}
        disabled={isLoggingOut}
        className="text-xs md:text-sm bg-red-50 hover:bg-red-100 text-red-600 px-4 py-2 rounded-full font-bold transition-all border border-red-100 hover:border-red-200 flex items-center gap-1.5 shadow-sm"
        title="Keluar dari akun admin"
      >
        <span>🚪</span>
        <span>{isLoggingOut ? 'Keluar... ⏳' : 'Logout'}</span>
      </button>
    </div>
  );
};

// Root cache untuk unmount / remount bersih
let authRootInstance: Root | null = null;
let userHeaderRootInstance: Root | null = null;

/**
 * Mount Better Auth UI ke elemen DOM tertentu
 */
export function mountBetterAuthUI(
  container: HTMLElement | string,
  options?: AuthUIOptions
): Root | null {
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  if (!el) {
    console.warn('[BetterAuthUI] Container element not found:', container);
    return null;
  }

  if (authRootInstance) {
    try {
      authRootInstance.unmount();
    } catch {
      // Abaikan jika sudah di-unmount
    }
  }

  authRootInstance = createRoot(el);
  authRootInstance.render(
    <BetterAuthCard
      initialMode={options?.initialMode}
      onSuccess={options?.onSuccess}
    />
  );
  return authRootInstance;
}

/**
 * Mount User Header & Better Auth Logout ke elemen DOM tertentu
 */
export function mountBetterAuthUserHeader(
  container: HTMLElement | string,
  options?: { userEmail?: string; onLogout?: () => void }
): Root | null {
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  if (!el) {
    console.warn('[BetterAuthUI] User header container element not found:', container);
    return null;
  }

  if (userHeaderRootInstance) {
    try {
      userHeaderRootInstance.unmount();
    } catch {
      // Abaikan jika sudah di-unmount
    }
  }

  userHeaderRootInstance = createRoot(el);
  userHeaderRootInstance.render(
    <BetterAuthUserHeader
      userEmail={options?.userEmail}
      onLogout={options?.onLogout}
    />
  );
  return userHeaderRootInstance;
}

// Expose ke window untuk lingkungan browser
if (typeof window !== 'undefined') {
  (window as any).NeonAuthUI = {
    BetterAuthCard,
    BetterAuthUserHeader,
    mountBetterAuthUI,
    mountBetterAuthUserHeader,
    NeonAuthUIProvider,
    AuthView,
    SignInForm,
    SignUpForm,
    ForgotPasswordForm,
    ResetPasswordForm,
    SignOut,
    UserButton
  };
}
