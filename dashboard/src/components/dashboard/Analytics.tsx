'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface ConditionMetric {
    condicion: string;
    total_consultas: number;
    total_usuarios_unicos: number;
}

interface InteractionLog {
    id: string;
    wa_id: string;
    user_name: string | null;
    user_condition: string | null;
    user_query: string;
    bot_response: string;
    source: string;
    created_at: string;
}

export default function Analytics() {
    const [tokenUsage, setTokenUsage] = useState<number>(0);
    const [queriesCount, setQueriesCount] = useState<number>(0);
    const [cacheHits, setCacheHits] = useState<number>(0);
    const [conditionMetrics, setConditionMetrics] = useState<ConditionMetric[]>([]);
    const [recentInteractions, setRecentInteractions] = useState<InteractionLog[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadMetrics() {
            try {
                // 1. Total de interacciones
                const { count: totalQueries } = await supabase
                    .from('chatbot_interactions')
                    .select('*', { count: 'exact', head: true });

                // 2. Tokens y ahorro de caché
                const { data: recentLogs } = await supabase
                    .from('bot_logs')
                    .select('tokens_used, is_cache_hit')
                    .order('created_at', { ascending: false })
                    .limit(1000);

                if (recentLogs) {
                    const tokens = recentLogs.reduce((acc, log) => acc + (log.tokens_used || 0), 0);
                    const hits = recentLogs.filter(log => log.is_cache_hit).length;
                    setTokenUsage(tokens);
                    setCacheHits(hits);
                }

                // 3. Métricas por Condición (Postulante / Estudiante / Egresado)
                const { data: condData } = await supabase
                    .from('metrics_interactions_by_condition')
                    .select('*');

                if (condData) {
                    setConditionMetrics(condData);
                }

                // 4. Últimas 15 interacciones con nombre y condición
                const { data: logsData } = await supabase
                    .from('chatbot_interactions')
                    .select('id, wa_id, user_name, user_condition, user_query, bot_response, source, created_at')
                    .order('created_at', { ascending: false })
                    .limit(15);

                if (logsData) {
                    setRecentInteractions(logsData);
                }

                setQueriesCount(totalQueries || 0);
            } catch (error) {
                console.error("Error loading metrics:", error);
            } finally {
                setLoading(false);
            }
        }

        loadMetrics();
    }, []);

    const getConditionBadge = (condition: string | null) => {
        switch (condition?.toLowerCase()) {
            case 'postulante':
                return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-300 dark:border-sky-800">Postulante</span>;
            case 'estudiante':
                return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">Estudiante</span>;
            case 'egresado':
                return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">Egresado</span>;
            default:
                return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-muted-foreground border border-border">Sin calificar</span>;
        }
    };

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-300">
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Métricas y Analítica de Consultas</h1>
                <p className="text-sm text-muted-foreground mt-1">Supervisión en tiempo real de volumen, consumo de LLM y segmentación por condición de usuario.</p>
            </div>

            {loading ? (
                <div className="flex justify-center p-12" role="status" aria-label="Cargando métricas">
                    <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                </div>
            ) : (
                <>
                    {/* Tarjetas Superiores de Métricas Generales */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
                            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total Consultas</span>
                            <div className="mt-2 flex items-baseline gap-2">
                                <span className="text-3xl font-extrabold text-foreground">{queriesCount.toLocaleString()}</span>
                            </div>
                        </div>

                        <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
                            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Postulantes Identificados</span>
                            <div className="mt-2 flex items-baseline gap-2">
                                <span className="text-3xl font-extrabold text-sky-600 dark:text-sky-400">
                                    {conditionMetrics.find(c => c.condicion === 'postulante')?.total_consultas || 0}
                                </span>
                                <span className="text-xs text-muted-foreground">consultas</span>
                            </div>
                        </div>

                        <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
                            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Estudiantes / Egresados</span>
                            <div className="mt-2 flex items-baseline gap-2">
                                <span className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
                                    {(conditionMetrics.find(c => c.condicion === 'estudiante')?.total_consultas || 0) +
                                     (conditionMetrics.find(c => c.condicion === 'egresado')?.total_consultas || 0)}
                                </span>
                                <span className="text-xs text-muted-foreground">consultas</span>
                            </div>
                        </div>

                        <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
                            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Tokens Incurridos (Aprox.)</span>
                            <div className="mt-2 flex items-baseline gap-2">
                                <span className="text-3xl font-extrabold text-foreground">{tokenUsage.toLocaleString()}</span>
                                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">({cacheHits} en caché)</span>
                            </div>
                        </div>
                    </div>

                    {/* Desglose por Condición */}
                    <div className="bg-card border border-border rounded-xl p-6 shadow-xs space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-base font-bold text-foreground">Distribución de Consultas por Rol</h2>
                            <span className="text-xs text-muted-foreground">Base de datos de interacciones</span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {['postulante', 'estudiante', 'egresado'].map(rol => {
                                const row = conditionMetrics.find(c => c.condicion === rol);
                                const total = row?.total_consultas || 0;
                                const uniqueUsers = row?.total_usuarios_unicos || 0;
                                const pct = queriesCount > 0 ? ((total / queriesCount) * 100).toFixed(1) : '0';

                                return (
                                    <div key={rol} className="border border-border/70 rounded-lg p-4 bg-secondary/30 space-y-2">
                                        <div className="flex items-center justify-between">
                                            {getConditionBadge(rol)}
                                            <span className="text-xs font-mono font-semibold text-muted-foreground">{pct}%</span>
                                        </div>
                                        <div className="flex items-baseline justify-between pt-1">
                                            <span className="text-xl font-bold text-foreground">{total} consultas</span>
                                            <span className="text-xs text-muted-foreground">{uniqueUsers} usuarios</span>
                                        </div>
                                        <div className="w-full bg-border rounded-full h-1.5 overflow-hidden">
                                            <div className="bg-primary h-1.5 rounded-full" style={{ width: `${Math.min(parseFloat(pct), 100)}%` }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Tabla de Últimas Consultas con Autor y Condición */}
                    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-xs">
                        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                            <div>
                                <h2 className="text-base font-bold text-foreground">Registro de Consultas Recientes</h2>
                                <p className="text-xs text-muted-foreground">Detalle de quién realizó la consulta y su condición para auditoría.</p>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-secondary/60 text-muted-foreground uppercase tracking-wider font-semibold border-b border-border">
                                    <tr>
                                        <th scope="col" className="px-4 py-3">Fecha</th>
                                        <th scope="col" className="px-4 py-3">Usuario / Nombre</th>
                                        <th scope="col" className="px-4 py-3">Condición</th>
                                        <th scope="col" className="px-4 py-3">Consulta</th>
                                        <th scope="col" className="px-4 py-3">Respuesta Bot</th>
                                        <th scope="col" className="px-4 py-3">Origen</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/60">
                                    {recentInteractions.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                                                No hay registros de interacciones aún.
                                            </td>
                                        </tr>
                                    ) : (
                                        recentInteractions.map(item => (
                                            <tr key={item.id} className="hover:bg-secondary/40 transition-colors">
                                                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground font-mono">
                                                    {new Date(item.created_at).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                                </td>
                                                <td className="px-4 py-3 font-medium text-foreground">
                                                    <div>{item.user_name || 'Sin nombre'}</div>
                                                    <div className="text-[10px] text-muted-foreground font-mono">{item.wa_id}</div>
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    {getConditionBadge(item.user_condition)}
                                                </td>
                                                <td className="px-4 py-3 max-w-xs truncate text-foreground font-medium" title={item.user_query}>
                                                    {item.user_query}
                                                </td>
                                                <td className="px-4 py-3 max-w-xs truncate text-muted-foreground" title={item.bot_response}>
                                                    {item.bot_response}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground uppercase">
                                                        {item.source}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
