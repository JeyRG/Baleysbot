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
      {/* Left Column: Official UNAC Institutional Brand Panel (Desktop) */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 bg-gradient-to-b from-[#060b18] via-[#0a1428] to-[#060b18] text-slate-100 border-r border-blue-900/40 overflow-hidden">
        {/* Subtle engineering grid background */}
        <div className="absolute inset-0 grid-subtle-pattern opacity-30 pointer-events-none" />
        
        {/* Deep blue & gold subtle ambient glows */}
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Top: Institution & Identity with Official Crest */}
        <div className="relative z-10 flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-950 to-slate-900 border border-blue-500/30 flex items-center justify-center p-2 shadow-lg shadow-blue-950/50">
            <img 
              src="https://posgradounac.edu.pe/img/logo_unac.png" 
              alt="UNAC Escudo" 
              className="w-full h-full object-contain drop-shadow"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-bold text-base tracking-tight text-white">Escuela de Posgrado UNAC</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-blue-950/80 text-blue-300 border border-blue-700/50">Admisión 2027-I</span>
            </div>
            <span className="text-xs text-slate-400 font-normal">Consola Central de Operaciones & Admisiones</span>
          </div>
        </div>

        {/* Middle: Key Capabilities / Architecture Notes */}
        <div className="relative z-10 my-auto py-12 space-y-8 max-w-lg">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Sistema Oficial de Atención en Línea
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white leading-tight">
              Gestión centralizada de postulantes y atención académica.
            </h1>
            <p className="text-slate-300 text-sm leading-relaxed">
              Supervisión en tiempo real de consultas por WhatsApp y Portal Web, derivación prioritaria a coordinadores de maestrías y doctorados, y analítica de admisión.
            </p>
          </div>

          <div className="grid gap-3 pt-2">
            <div className="flex items-start gap-3 p-3.5 rounded-lg border border-blue-900/40 bg-blue-950/30 backdrop-blur-xs">
              <MessageSquare className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-slate-100">Atención Multicanal Sincronizada</p>
                <p className="text-[11px] text-slate-400">Canal WhatsApp Oficial y Widget Institucional Web atendidos bajo un único inbox operativo.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3.5 rounded-lg border border-amber-500/30 bg-amber-950/20 backdrop-blur-xs">
              <Users className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-slate-100">Derivación y Alertas Prioritarias</p>
                <p className="text-[11px] text-slate-400">Detección y clasificación automática de postulantes, estudiantes y egresados para atención humana.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom: Institutional Note */}
        <div className="relative z-10 pt-6 border-t border-blue-900/40 text-xs text-slate-400 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-300">Universidad Nacional del Callao</span>
            <span className="text-slate-600">•</span>
            <span>Callao, Perú</span>
          </div>
          <span className="font-mono text-[11px] text-blue-400/80">Plataforma Segura SSL</span>
        </div>
      </div>

      {/* Right Column: Clean, Focused Login Form */}
      <div className="flex items-center justify-center p-6 sm:p-12 lg:p-16">
        <div className="w-full max-w-sm space-y-6">
          {/* Mobile institution header */}
          <div className="lg:hidden flex items-center gap-3 pb-3 border-b border-border/80">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-900 via-slate-900 to-blue-950 border border-blue-500/30 flex items-center justify-center p-1.5 shadow-sm">
              <img 
                src="https://posgradounac.edu.pe/img/logo_unac.png" 
                alt="UNAC" 
                className="w-full h-full object-contain drop-shadow"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>
            <div>
              <p className="font-bold text-sm leading-none text-foreground">Escuela de Posgrado UNAC</p>
              <p className="text-[11px] text-blue-600 dark:text-blue-400 font-medium mt-1">Consola de Operaciones & Admisiones</p>
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
