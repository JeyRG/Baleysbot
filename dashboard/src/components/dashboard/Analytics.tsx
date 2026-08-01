import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function Analytics() {
    const [tokenUsage, setTokenUsage] = useState<number>(0);
    const [queriesCount, setQueriesCount] = useState<number>(0);
    const [cacheHits, setCacheHits] = useState<number>(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadMetrics() {
            try {
                // Total Interactions (Assuming 'chatbot_interactions' table exists based on app.js logs)
                const { count: totalQueries } = await supabase
                    .from('chatbot_interactions')
                    .select('*', { count: 'exact', head: true });
                
                // Fetch recent logs to estimate tokens/cache usage
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
                
                setQueriesCount(totalQueries || 0);
            } catch (error) {
                console.error("Error loading metrics:", error);
            } finally {
                setLoading(false);
            }
        }
        
        loadMetrics();
    }, []);

    return (
        <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
                <h1 className="text-3xl font-black text-foreground font-outfit tracking-tight">Métricas y Analíticas</h1>
                <p className="text-muted-foreground mt-2">Monitorea el uso de tokens, caché y el rendimiento general del bot.</p>
            </div>

            {loading ? (
                <div className="flex justify-center p-12">
                    <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-card border border-border rounded-2xl p-6 shadow-lg shadow-black/5 hover:shadow-xl transition-shadow relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 0 1 9-9" /></svg>
                        </div>
                        <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-2">Total Consultas</h3>
                        <p className="text-4xl font-black text-foreground">{queriesCount}</p>
                    </div>

                    <div className="bg-card border border-border rounded-2xl p-6 shadow-lg shadow-black/5 hover:shadow-xl transition-shadow relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 text-emerald-500 transition-opacity">
                            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                        </div>
                        <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-2">Tokens Usados (Aprox)</h3>
                        <p className="text-4xl font-black text-foreground">{tokenUsage.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground mt-2">En los últimos 1000 mensajes</p>
                    </div>

                    <div className="bg-card border border-border rounded-2xl p-6 shadow-lg shadow-black/5 hover:shadow-xl transition-shadow relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 text-primary transition-opacity">
                            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                        </div>
                        <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-2">Ahorro por Caché</h3>
                        <p className="text-4xl font-black text-foreground">{cacheHits}</p>
                        <p className="text-xs text-muted-foreground mt-2">Mensajes respondidos sin consumir tokens</p>
                    </div>
                </div>
            )}
        </div>
    );
}
