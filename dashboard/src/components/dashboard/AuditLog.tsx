'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
    handoff_pause_bot: { label: 'Pausó bot (Humano)', color: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20' },
    handoff_resume_bot: { label: 'Reactivó bot (IA)', color: 'bg-purple-500/10 text-purple-500 border-purple-500/20' },
};

export default function AuditLog() {
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [filterAction, setFilterAction] = useState<string>('all');
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

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

    const filteredLogs = useMemo(() => {
        return logs.filter(log => {
            const matchesAction = filterAction === 'all' || log.action === filterAction;
            const searchLower = searchQuery.toLowerCase().trim();
            const matchesSearch = !searchLower ||
                (log.actor_username && log.actor_username.toLowerCase().includes(searchLower)) ||
                (log.action && log.action.toLowerCase().includes(searchLower)) ||
                (log.target_id && String(log.target_id).toLowerCase().includes(searchLower)) ||
                (log.details && JSON.stringify(log.details).toLowerCase().includes(searchLower));
            return matchesAction && matchesSearch;
        });
    }, [logs, filterAction, searchQuery]);

    const availableActions = useMemo(() => {
        const set = new Set<string>();
        logs.forEach(l => { if (l.action) set.add(l.action); });
        return Array.from(set);
    }, [logs]);

    return (
        <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-foreground font-outfit tracking-tight">Registro de Auditoría</h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Trazabilidad inmutable de actividades: operadores, envíos, handover y gestión de acceso.
                    </p>
                </div>
                <button 
                    onClick={load} 
                    className="self-start sm:self-auto px-4 py-2 bg-secondary hover:bg-secondary/80 text-foreground rounded-xl font-bold text-sm transition-all shadow-sm border border-border"
                >
                    Actualizar Registros
                </button>
            </div>

            {error && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-500 px-4 py-3 rounded-xl text-sm font-medium">
                    {error}
                </div>
            )}

            {/* Filtros y Búsqueda */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
                <div className="flex-1 relative">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Buscar por usuario, acción, wa_id o detalle..."
                        className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={filterAction}
                        onChange={(e) => setFilterAction(e.target.value)}
                        className="bg-card border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                    >
                        <option value="all">Todas las acciones ({logs.length})</option>
                        {availableActions.map(action => (
                            <option key={action} value={action}>
                                {ACTION_LABELS[action]?.label || action}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Listado de Logs */}
            <div className="bg-card border border-border rounded-2xl shadow-lg overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center p-16 gap-3">
                        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                        <span className="text-xs text-muted-foreground font-medium">Cargando eventos de auditoría...</span>
                    </div>
                ) : filteredLogs.length === 0 ? (
                    <div className="px-6 py-16 text-center text-muted-foreground">
                        {searchQuery || filterAction !== 'all' 
                            ? 'No se encontraron registros que coincidan con los filtros aplicados.' 
                            : 'No hay actividad registrada todavía.'}
                    </div>
                ) : (
                    <div className="divide-y divide-border/50">
                        {filteredLogs.map(log => {
                            const meta = ACTION_LABELS[log.action] || { 
                                label: log.action, 
                                color: 'bg-secondary text-muted-foreground border-border' 
                            };
                            const isExpanded = expandedLogId === log.id;
                            const hasDetails = log.details && Object.keys(log.details).length > 0;

                            return (
                                <div 
                                    key={log.id} 
                                    className="px-6 py-4 hover:bg-secondary/20 transition-colors flex flex-col gap-2"
                                >
                                    <div className="flex items-center gap-4">
                                        <span className={'px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border shrink-0 ' + meta.color}>
                                            {meta.label}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className="text-sm font-bold text-foreground truncate">
                                                    {log.actor_username || 'Sistema'}
                                                </p>
                                                {log.target_type && (
                                                    <span className="text-[10px] bg-secondary/80 text-muted-foreground px-2 py-0.5 rounded font-mono">
                                                        {log.target_type}{log.target_id ? ` #${log.target_id}` : ''}
                                                    </span>
                                                )}
                                            </div>
                                            {hasDetails && (
                                                <p className="text-xs text-muted-foreground truncate font-mono mt-0.5">
                                                    {typeof log.details === 'string' ? log.details : JSON.stringify(log.details)}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 shrink-0">
                                            <span className="text-xs text-muted-foreground font-mono">
                                                {new Date(log.created_at).toLocaleString('es-PE')}
                                            </span>
                                            {hasDetails && (
                                                <button
                                                    onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                                                    className="text-xs font-semibold text-primary hover:underline"
                                                >
                                                    {isExpanded ? 'Ocultar' : 'Inspeccionar'}
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Panel expandido con detalles JSON estructurados */}
                                    {isExpanded && hasDetails && (
                                        <div className="mt-2 p-3 bg-secondary/40 border border-border/70 rounded-xl font-mono text-xs text-foreground overflow-x-auto">
                                            <pre>{JSON.stringify(log.details, null, 2)}</pre>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
