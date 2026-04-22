'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    // Simular latencia para efecto premium
    setTimeout(() => {
        if (password === (process.env.NEXT_PUBLIC_ADMIN_PIN || 'admin123')) {
            document.cookie = `auth_token=valid; path=/; max-age=86400`;
            router.push('/');
          } else {
            setError('PIN de acceso incorrecto');
            setIsLoading(false);
          }
    }, 800);
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center font-sans overflow-hidden">
      {/* Background Image with Dark Overlay */}
      <div 
        className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform duration-[20s] scale-110 animate-pulse-slow" 
        style={{ backgroundImage: "url('/bg-login.png')" }}
      />
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />

      <div className="container mx-auto px-6 z-10 flex flex-col md:flex-row items-center justify-between gap-12 lg:gap-24">
        
        {/* Left Side: Brand/Logo */}
        <div className="flex-1 text-center md:text-left space-y-4 animate-in fade-in slide-in-from-left-8 duration-1000">
            <h1 className="text-7xl lg:text-9xl font-black text-white tracking-tighter italic font-outfit drop-shadow-2xl">
                UNAC <br />
                <span className="text-4xl lg:text-5xl not-italic font-medium opacity-80 tracking-normal">Posgrado</span>
            </h1>
            <p className="text-white/60 text-lg font-medium max-w-md">
                Excelencia académica con rostro humano. <br />
                Gestiona tus leads y admisiones desde un solo lugar.
            </p>
        </div>

        {/* Right Side: Glassmorphism Login Card */}
        <div className="w-full max-w-[480px] animate-in fade-in slide-in-from-right-8 duration-1000 delay-150">
            <div className="relative bg-white/10 backdrop-blur-2xl border border-white/20 rounded-[2.5rem] p-8 lg:p-12 shadow-2xl overflow-hidden group">
                {/* Header within card */}
                <div className="flex justify-between items-center mb-10">
                    <h2 className="text-3xl font-bold text-white tracking-tight">Log In</h2>
                    <div className="flex gap-3 text-[10px] font-bold text-white/50 uppercase tracking-widest">
                        <span className="text-white">Log In</span>
                        <span>/</span>
                        <span className="hover:text-white cursor-pointer transition-colors">Sign Up</span>
                    </div>
                </div>

                <form onSubmit={handleLogin} className="space-y-8">
                    <div className="space-y-6">
                        {/* PIN field (Acting as Email/Password per design) */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-white/80 ml-1">Pin de Acceso Maestro</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Ingresa tu clave de acceso"
                                className="w-full px-6 py-4 bg-white/10 border border-white/10 rounded-xl text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-white/30 transition-all font-medium backdrop-blur-md"
                                required
                            />
                            <div className="flex justify-between px-1">
                                <span className="text-[10px] text-white/40 font-medium hover:text-white/70 cursor-pointer transition-colors">¿Olvidaste tu PIN?</span>
                            </div>
                        </div>
                        
                        {error && (
                            <div className="bg-rose-500/20 border border-rose-500/30 py-3 rounded-xl px-4 flex items-center gap-3">
                                <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                                <p className="text-rose-200 text-xs font-bold">{error}</p>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end pt-2">
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="px-10 py-3 bg-white text-slate-900 rounded-xl font-black text-xs uppercase tracking-widest shadow-xl hover:bg-slate-100 hover:-translate-y-0.5 active:scale-95 transition-all disabled:opacity-50"
                        >
                            {isLoading ? '...' : 'Log In'}
                        </button>
                    </div>

                    {/* Social/Bottom Divider */}
                    <div className="pt-8 space-y-8">
                        <div className="relative flex items-center justify-center">
                            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10" /></div>
                            <span className="relative px-4 text-[10px] font-black text-white/30 uppercase tracking-[0.2em] bg-transparent">OR</span>
                        </div>

                        <div className="flex justify-center gap-6">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/50 hover:bg-white/10 hover:text-white transition-all cursor-pointer">
                                    {i === 1 && <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>}
                                    {i === 2 && <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>}
                                    {i === 3 && <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"/></svg>}
                                </div>
                            ))}
                        </div>

                        <p className="text-center text-[10px] font-bold text-white/30 uppercase tracking-widest">
                            Don't have an account? <span className="text-white cursor-pointer hover:underline">Sign up</span>
                        </p>
                    </div>
                </form>
            </div>
        </div>
      </div>
    </div>
  );
}
