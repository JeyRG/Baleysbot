'use client';

import { useState, useEffect } from 'react';

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
      const botUrl = process.env.NEXT_PUBLIC_BOT_URL || 'http://localhost:3000';
      const res = await fetch(`${botUrl}/bot/status`);
      if (!res.ok) throw new Error('Servidor del bot no disponible');
      const data: BotStatus = await res.json();
      setStatus(data);
      
      if (data.qr_base64) {
        setQrUrl(data.qr_base64);
      } else if (data.waiting_qr) {
        // Fallback al endpoint de imagen si no viene base64
        setQrUrl(`${botUrl}/bot/qr?t=${new Date().getTime()}`);
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
    const interval = setInterval(fetchStatus, 5000); // Poll cada 5 segundos
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500 max-w-4xl mx-auto">
      <div className="flex flex-col space-y-1">
        <h2 className="text-3xl font-black text-slate-900 tracking-tight font-outfit">Conexión de WhatsApp</h2>
        <p className="text-slate-500 text-sm">Gestiona la vinculación de tu bot con el servicio oficial.</p>
      </div>

      <div className="bg-white rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden min-h-[400px] flex flex-col justify-center items-center p-12 text-center">
        {loading && !status ? (
          <div className="animate-pulse space-y-6 flex flex-col items-center">
            <div className="w-64 h-64 bg-slate-100 rounded-3xl"></div>
            <div className="h-4 bg-slate-100 rounded w-48"></div>
          </div>
        ) : error ? (
          <div className="space-y-4">
            <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center text-rose-500 mx-auto mb-6">
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
            </div>
            <h3 className="text-xl font-bold text-slate-900">Bot fuera de línea</h3>
            <p className="text-slate-500 max-w-xs mx-auto">No se pudo contactar con el servidor del bot en el puerto 3000. Asegúrate de que el bot esté encendido.</p>
            <button 
                onClick={fetchStatus}
                className="mt-4 px-6 py-2 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-colors"
            >
                Reintentar
            </button>
          </div>
        ) : status?.connected ? (
          <div className="space-y-6 animate-in zoom-in duration-500">
            <div className="w-24 h-24 bg-emerald-500 rounded-[2rem] flex items-center justify-center text-white mx-auto shadow-2xl shadow-emerald-500/40 relative">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                <div className="absolute -top-1 -right-1 w-6 h-6 bg-white rounded-full flex items-center justify-center">
                    <div className="w-3 h-3 bg-emerald-500 rounded-full animate-ping"></div>
                </div>
            </div>
            <div className="space-y-2">
                <h3 className="text-2xl font-black text-slate-900">¡Bot Conectado!</h3>
                <p className="text-slate-500">El sistema se encuentra activo y respondiendo mensajes.</p>
            </div>
            <div className="pt-8 flex gap-4 justify-center">
                <div className="px-6 py-3 bg-slate-50 rounded-2xl border border-slate-100">
                    <p className="text-[10px] uppercase font-black text-slate-400 tracking-widest mb-1">Estado</p>
                    <p className="font-bold text-emerald-600 text-sm">Online & Listo</p>
                </div>
            </div>
          </div>
        ) : status?.waiting_qr ? (
          <div className="space-y-8 animate-in fade-in zoom-in duration-500">
            <div className="space-y-2">
                <h3 className="text-2xl font-black text-slate-900">Vincular Dispositivo</h3>
                <p className="text-slate-500 text-sm">Escanea este código QR con tu aplicación de WhatsApp</p>
            </div>

            <div className="relative group max-w-[300px] mx-auto">
                <div className="absolute -inset-4 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-[3rem] blur-xl opacity-20 group-hover:opacity-40 transition-opacity"></div>
                <div className="relative bg-white p-4 rounded-[2.5rem] border border-slate-100 shadow-2xl">
                    <img 
                        src={qrUrl} 
                        alt="WhatsApp QR Code" 
                        className="w-full h-auto rounded-2xl"
                    />
                </div>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-3xl p-6 text-left max-w-md mx-auto">
                <h4 className="font-bold text-blue-900 text-sm flex items-center gap-2 mb-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                    Instrucciones:
                </h4>
                <ul className="text-xs text-blue-800/80 space-y-2">
                    <li>1. Abre WhatsApp en tu teléfono.</li>
                    <li>2. Toca <b>Menú</b> o <b>Configuración</b> y selecciona <b>Dispositivos vinculados</b>.</li>
                    <li>3. Toca en <b>Vincular un dispositivo</b>.</li>
                    <li>4. Apunta tu teléfono hacia esta pantalla para escanear el código.</li>
                </ul>
            </div>
          </div>
        ) : (
          <p className="text-slate-400">Determinando estado...</p>
        )}
      </div>
    </div>
  );
}
