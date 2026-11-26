'use client';

import { useState, useEffect } from 'react';
import { getBotUrl, authFetch, getToken } from '@/lib/adminApi';

interface BotStatus {
  connected: boolean;
  waiting_qr: boolean;
  qr_base64: string | null;
  timestamp: string;
}

export default function ConnectionStatus() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [qrUrl, setQrUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const botUrl = getBotUrl();
      const res = await authFetch(`${botUrl}/bot/status`);
      if (!res.ok) throw new Error('Servidor del bot no disponible o sesión expirada');
      const data: BotStatus = await res.json();
      setStatus(data);

      if (data.qr_base64) {
        setQrUrl(data.qr_base64);
      } else if (data.waiting_qr) {
        const token = getToken() || '';
        setQrUrl(`${botUrl}/bot/qr?t=${Date.now()}&token=${encodeURIComponent(token)}`);
      } else {
        setQrUrl('');
      }

      setError(null);
    } catch (err: any) {
      setError(err.message);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500 max-w-4xl mx-auto">
      <div className="flex flex-col space-y-1">
        <h2 className="text-3xl font-black text-foreground tracking-tight font-outfit">Conexión de WhatsApp</h2>
        <p className="text-muted-foreground text-sm">Gestiona la vinculación del bot con la línea institucional de atención.</p>
      </div>

      <div className="bg-card rounded-3xl shadow-sm border border-border overflow-hidden min-h-[400px] flex flex-col justify-center items-center p-12 text-center">
        {loading && !status ? (
          <div className="animate-pulse space-y-6 flex flex-col items-center">
            <div className="w-64 h-64 bg-secondary rounded-2xl"></div>
            <div className="h-4 bg-secondary rounded w-48"></div>
          </div>
        ) : error ? (
          <div className="space-y-4">
            <div className="w-20 h-20 bg-rose-500/10 rounded-full flex items-center justify-center text-rose-500 mx-auto mb-6 border border-rose-500/20">
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
            </div>
            <h3 className="text-xl font-bold text-foreground">Bot fuera de línea</h3>
            <p className="text-muted-foreground text-sm max-w-xs mx-auto">{error}</p>
            <button
                onClick={fetchStatus}
                className="mt-4 px-6 py-2.5 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:opacity-90 transition-opacity focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
                Reintentar conexión
            </button>
          </div>
        ) : status?.connected ? (
          <div className="space-y-6 animate-in zoom-in duration-500">
            <div className="w-24 h-24 bg-emerald-600 rounded-2xl flex items-center justify-center text-white mx-auto shadow-lg shadow-emerald-600/20 relative">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                <div className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-card border border-border rounded-full flex items-center justify-center">
                    <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-ping"></div>
                </div>
            </div>
            <div className="space-y-2">
                <h3 className="text-2xl font-black text-foreground">Línea Vinculada</h3>
                <p className="text-muted-foreground text-sm">El servicio Baileys se encuentra activo y despachando mensajes en tiempo real.</p>
            </div>
            <div className="pt-4 flex gap-4 justify-center">
                <div className="px-6 py-3 bg-secondary rounded-xl border border-border">
                    <p className="text-[11px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Estado</p>
                    <p className="font-bold text-emerald-600 dark:text-emerald-400 text-sm font-mono">ONLINE · READY</p>
                </div>
            </div>
          </div>
        ) : status?.waiting_qr ? (
          <div className="space-y-8 animate-in fade-in zoom-in duration-500">
            <div className="space-y-2">
                <h3 className="text-2xl font-black text-foreground">Vincular Dispositivo</h3>
                <p className="text-muted-foreground text-sm">Escanea este código QR desde la aplicación de WhatsApp institucional</p>
            </div>

            <div className="max-w-[280px] mx-auto bg-white p-4 rounded-2xl border border-border shadow-md">
                <img
                    src={qrUrl}
                    alt="Código QR de vinculación de WhatsApp"
                    className="w-full h-auto rounded-xl"
                />
            </div>

            <div className="bg-secondary/60 border border-border rounded-2xl p-6 text-left max-w-md mx-auto">
                <h4 className="font-bold text-foreground text-sm flex items-center gap-2 mb-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                    Instrucciones de vinculación:
                </h4>
                <ol className="text-xs text-muted-foreground space-y-2 list-decimal list-inside">
                    <li>Abre WhatsApp en el teléfono institucional.</li>
                    <li>Entra en <b>Configuración</b> → <b>Dispositivos vinculados</b>.</li>
                    <li>Pulsa <b>Vincular un dispositivo</b>.</li>
                    <li>Escanea el código QR mostrado arriba.</li>
                </ol>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Verificando estado del socket...</p>
        )}
      </div>
    </div>
  );
}
