'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminApi, setSession } from '@/lib/adminApi';
import { ShieldCheck, MessageSquare, Users, Lock, User, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Por favor ingresa usuario y contraseña');
      return;
    }

    setError('');
    setIsLoading(true);
    try {
      const res = await adminApi.login(username.trim(), password);
      if (res.ok && res.token && res.user) {
        setSession(res.token, res.user);
        router.push('/');
      } else {
        setError(res.error || 'Credenciales incorrectas o usuario no autorizado');
        setIsLoading(false);
      }
    } catch (err: any) {
      setError(err?.message || 'Error de conexión con el servidor de autenticación');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 bg-background font-sans">
      {/* Left Column: Technical Enterprise Brand Panel (Desktop) */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 bg-zinc-950 text-zinc-100 border-r border-zinc-800/80 overflow-hidden">
        {/* Subtle engineering grid background */}
        <div className="absolute inset-0 grid-subtle-pattern opacity-40 pointer-events-none" />
        
        {/* Subtle corner light accent, not overwhelming */}
        <div className="absolute -top-40 -left-40 w-80 h-80 bg-zinc-800/30 rounded-full blur-3xl pointer-events-none" />

        {/* Top: Institution & Identity */}
        <div className="relative z-10 flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-700/80 flex items-center justify-center text-zinc-100 shadow-sm">
            <ShieldCheck className="w-5 h-5 text-zinc-200" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-base tracking-tight text-white">UNAC Posgrado</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-zinc-800 text-zinc-300 border border-zinc-700">v2.4</span>
            </div>
            <span className="text-xs text-zinc-400 font-normal">Consola de Operaciones & Admisiones</span>
          </div>
        </div>

        {/* Middle: Key Capabilities / Architecture Notes */}
        <div className="relative z-10 my-auto py-12 space-y-8 max-w-lg">
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-white leading-tight">
              Plataforma de gestión de leads y atención estudiantil.
            </h1>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Sistema centralizado para supervisión de conversaciones WhatsApp, derivación a soporte humano y gestión de admisiones académicas en tiempo real.
            </p>
          </div>

          <div className="grid gap-3 pt-2">
            <div className="flex items-start gap-3 p-3.5 rounded-lg border border-zinc-800/80 bg-zinc-900/50">
              <MessageSquare className="w-4 h-4 text-zinc-300 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-zinc-200">Atención Multicanal Activa</p>
                <p className="text-[11px] text-zinc-400">Canal WhatsApp Oficial y Widget Web sincronizados bajo un único inbox.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3.5 rounded-lg border border-zinc-800/80 bg-zinc-900/50">
              <Users className="w-4 h-4 text-zinc-300 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-zinc-200">Intervención Humana Inmediata</p>
                <p className="text-[11px] text-zinc-400">Detección de solicitudes prioritarias con alertas sonoras y de escritorio.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom: Institutional Note */}
        <div className="relative z-10 pt-6 border-t border-zinc-800/80 text-xs text-zinc-400 flex items-center justify-between">
          <span>Universidad Nacional del Callao</span>
          <span className="font-mono text-[11px] text-zinc-400">Ambiente Seguro TLS 1.3</span>
        </div>
      </div>

      {/* Right Column: Clean, Focused Login Form */}
      <div className="flex items-center justify-center p-6 sm:p-12 lg:p-16">
        <div className="w-full max-w-sm space-y-6">
          {/* Mobile institution header */}
          <div className="lg:hidden flex items-center gap-2.5 pb-2">
            <div className="w-8 h-8 rounded-md bg-foreground text-background flex items-center justify-center font-bold text-xs">
              UN
            </div>
            <div>
              <p className="font-semibold text-sm leading-none text-foreground">UNAC Posgrado</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Consola de Operaciones</p>
            </div>
          </div>

          {/* Form Header */}
          <div className="space-y-1.5">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              Iniciar Sesión
            </h2>
            <p className="text-sm text-muted-foreground">
              Ingresa tus credenciales para acceder al panel de control.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-3.5">
              {/* Usuario */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground flex items-center justify-between">
                  <span>Usuario</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
                    <User className="h-4 w-4" />
                  </div>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="usuario.admin"
                    autoComplete="username"
                    disabled={isLoading}
                    className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring transition-colors disabled:opacity-50"
                    required
                  />
                </div>
              </div>

              {/* Contraseña */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground flex items-center justify-between">
                  <span>Contraseña</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
                    <Lock className="h-4 w-4" />
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    autoComplete="current-password"
                    disabled={isLoading}
                    className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring transition-colors disabled:opacity-50 font-mono"
                    required
                  />
                </div>
              </div>

              {/* Error Alert */}
              {error && (
                <div 
                  role="alert" 
                  className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs flex items-start gap-2.5 animate-in fade-in-50 duration-200"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-destructive" />
                  <span className="font-medium">{error}</span>
                </div>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-10 px-4 py-2 mt-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md font-medium text-sm flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed shadow-sm cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Validando credenciales...</span>
                </>
              ) : (
                <>
                  <span>Ingresar a la Consola</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Institutional Advisory */}
          <div className="pt-4 border-t border-border">
            <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
              Acceso restringido únicamente a operadores y personal autorizado de la Escuela de Posgrado UNAC.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
