'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { adminApi } from '@/lib/adminApi';

interface StatRow {
    day: string;
    agent_name: string;
    agent_id: string | null;
    messages_sent: number;
}

export default function AgentStats() {
    const [rows, setRows] = useState<StatRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await adminApi.agentStats();
            if (res.ok && res.rows) setRows(res.rows);
            else setError(res.error || 'No se pudieron cargar las métricas');
        } catch (e: any) {
            setError(e?.message || 'Error de conexión');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Agrupar por día para el resumen
    const byDay = rows.reduce((acc: Record<string, number>, r) => {
        acc[r.day] = (acc[r.day] || 0) + Number(r.messages_sent);
        return acc;
    }, {});
    const days = Object.keys(byDay).sort((a, b) => (a < b ? 1 : -1)).slice(0, 14);

    // Agrupar por agente (total)
    const byAgent = rows.reduce((acc: Record<string, number>, r) => {
        acc[r.agent_name] = (acc[r.agent_name] || 0) + Number(r.messages_sent);
        return acc;
    }, {});
    const agents = Object.entries(byAgent).sort((a, b) => b[1] - a[1]);

    const totalToday = byDay[days[0]] || 0;

    return (
        <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-black text-foreground font-outfit tracking-tight">Actividad por Agente</h1>
                    <p className="text-muted-foreground mt-2">Mensajes respondidos por día y por agente.</p>
                </div>
                <button onClick={load} className="px-4 py-2 bg-secondary text-foreground rounded-xl font-bold text-sm hover:bg-secondary/70 transition-all">Actualizar</button>
            </div>

            {error && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-500 px-4 py-3 rounded-xl text-sm font-medium">{error}</div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-card border border-border rounded-2xl p-6 shadow-lg">
                    <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-2">Mensajes hoy</h3>
                    <p className="text-4xl font-black text-foreground font-outfit">{totalToday}</p>
                </div>
                <div className="bg-card border border-border rounded-2xl p-6 shadow-lg">
                    <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-2">Agentes activos</h3>
                    <p className="text-4xl font-black text-foreground font-outfit">{agents.length}</p>
                </div>
                <div className="bg-card border border-border rounded-2xl p-6 shadow-lg">
                    <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-2">Total histórico</h3>
                    <p className="text-4xl font-black text-foreground font-outfit">
                        {Object.values(byAgent).reduce((a, b) => a + b, 0)}
                    </p>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center p-12">
                    <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-card border border-border rounded-2xl shadow-lg p-6">
                        <h3 className="font-bold text-foreground mb-4">Total por agente</h3>
                        {agents.length === 0 ? (
                            <p className="text-muted-foreground text-sm">Sin datos todavía.</p>
                        ) : (
                            <div className="space-y-3">
                                {agents.map(([name, count]) => (
                                    <div key={name} className="flex items-center gap-3">
                                        <span className="text-sm font-medium text-foreground w-40 truncate">{name}</span>
                                        <div className="flex-1 h-3 bg-secondary rounded-full overflow-hidden">
                                            <div className="h-full bg-primary rounded-full"
                                                style={{ width: `${Math.min(100, (count / (agents[0][1] || 1)) * 100)}%` }} />
                                        </div>
                                        <span className="text-sm font-bold text-foreground w-10 text-right">{count}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="bg-card border border-border rounded-2xl shadow-lg p-6">
                        <h3 className="font-bold text-foreground mb-4">Últimos días</h3>
                        {days.length === 0 ? (
                            <p className="text-muted-foreground text-sm">Sin datos todavía.</p>
                        ) : (
                            <div className="space-y-2">
                                {days.map(day => (
                                    <div key={day} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                                        <span className="text-sm text-muted-foreground">
                                            {new Date(day).toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' })}
                                        </span>
                                        <span className="text-sm font-bold text-foreground">{byDay[day]} mensajes</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

