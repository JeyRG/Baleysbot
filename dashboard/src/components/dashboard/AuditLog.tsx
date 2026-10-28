'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { adminApi } from '@/lib/adminApi';

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
    login: { label: 'Inicio de sesión', color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' },
    login_failed: { label: 'Login fallido', color: 'bg-rose-500/10 text-rose-500 border-rose-500/20' },
    logout: { label: 'Cerró sesión', color: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
    create_user: { label: 'Creó usuario', color: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
    update_user: { label: 'Modificó usuario', color: 'bg-amber-500/10 text-amber-500 border-amber-500/20' },
    delete_user: { label: 'Eliminó usuario', color: 'bg-rose-500/10 text-rose-500 border-rose-500/20' },
    send_message: { label: 'Envió mensaje', color: 'bg-primary/10 text-primary border-primary/20' },
    resolve_query: { label: 'Resolvió consulta', color: 'bg-teal-500/10 text-teal-500 border-teal-500/20' },
};

export default function AuditLog() {
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await adminApi.audit(200);
            if (res.ok && res.logs) setLogs(res.logs);
            else setError(res.error || 'No se pudo cargar la auditoría');
        } catch (e: any) {
            setError(e?.message || 'Error de conexión');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    return (
        <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-black text-foreground font-outfit tracking-tight">Auditoría</h1>
                    <p className="text-muted-foreground mt-2">Registro de las acciones de cada usuario del panel.</p>
                </div>
                <button onClick={load} className="px-4 py-2 bg-secondary text-foreground rounded-xl font-bold text-sm hover:bg-secondary/70 transition-all">Actualizar</button>
            </div>

            {error && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-500 px-4 py-3 rounded-xl text-sm font-medium">{error}</div>
            )}

            <div className="bg-card border border-border rounded-2xl shadow-lg overflow-hidden">
                {loading ? (
                    <div className="flex justify-center p-12">
                        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                    </div>
                ) : logs.length === 0 ? (
                    <div className="px-6 py-12 text-center text-muted-foreground">No hay actividad registrada todavía.</div>
                ) : (
                    <div className="divide-y divide-border/50">
                        {logs.map(log => {
                            const meta = ACTION_LABELS[log.action] || { label: log.action, color: 'bg-secondary text-muted-foreground border-border' };
                            return (
                                <div key={log.id} className="px-6 py-4 flex items-center gap-4 hover:bg-secondary/20 transition-colors">
                                    <span className={'px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border shrink-0 ' + meta.color}>
                                        {meta.label}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-foreground truncate">{log.actor_username || 'Sistema'}</p>
                                        {log.details && Object.keys(log.details).length > 0 && (
                                            <p className="text-xs text-muted-foreground truncate">{JSON.stringify(log.details)}</p>
                                        )}
                                    </div>
                                    <span className="text-xs text-muted-foreground shrink-0">
                                        {new Date(log.created_at).toLocaleString('es-PE')}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
