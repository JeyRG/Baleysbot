'use client';

import { useState, useEffect } from 'react';

interface KnowledgeChunk {
  id: string;
  content: string;
  metadata: any;
  created_at: string;
}

interface UnresolvedQuery {
  id: string;
  query: string;
  created_at: string;
}

export default function KnowledgeManager() {
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [unresolved, setUnresolved] = useState<UnresolvedQuery[]>([]);
  const [cache, setCache] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingChunk, setEditingChunk] = useState<KnowledgeChunk | null>(null);
  const [editingCache, setEditingCache] = useState<any | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [newContent, setNewContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'trained' | 'pending' | 'cache'>('trained');
  const [searchTerm, setSearchTerm] = useState('');

  const fetchKnowledge = async () => {
    try {
      const botUrl = process.env.NEXT_PUBLIC_BOT_URL || 'http://localhost:3000';
      const res = await fetch(`${botUrl}/bot/knowledge`);
      if (!res.ok) throw new Error('Error al cargar la base de conocimientos');
      const data = await res.json();
      setChunks(data);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const fetchUnresolved = async () => {
    try {
      const botUrl = process.env.NEXT_PUBLIC_BOT_URL || 'http://localhost:3000';
      const res = await fetch(`${botUrl}/bot/unresolved`);
      if (!res.ok) throw new Error('Error al cargar dudas pendientes');
      const data = await res.json();
      setUnresolved(data);
    } catch (err: any) {
      console.error(err);
    }
  };

  const fetchCache = async () => {
    try {
      const botUrl = process.env.NEXT_PUBLIC_BOT_URL || 'http://localhost:3000';
      const res = await fetch(`${botUrl}/bot/cache`);
      if (!res.ok) throw new Error('Error al cargar memoria semántica');
      const data = await res.json();
      setCache(data);
    } catch (err: any) {
      console.error(err);
    }
  };

  useEffect(() => {
    const init = async () => {
        setLoading(true);
        await Promise.all([fetchKnowledge(), fetchUnresolved(), fetchCache()]);
        setLoading(false);
    };
    init();
  }, []);

  const handleSave = async () => {
    if (!newContent.trim()) return;
    setIsSaving(true);
    setError(null);

    try {
      let url = '';
      let method = 'POST';
      const botUrl = process.env.NEXT_PUBLIC_BOT_URL || 'http://localhost:3000';

      if (resolvingId) {
        url = `${botUrl}/bot/resolve`;
      } else if (editingChunk) {
        url = `${botUrl}/bot/knowledge/${editingChunk.id}`;
        method = 'PUT';
      } else if (editingCache) {
        url = `${botUrl}/bot/cache/${editingCache.id}`;
        method = 'PUT';
      } else {
        url = `${botUrl}/bot/knowledge`;
      }
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            content: activeTab === 'cache' ? undefined : newContent,
            answer: activeTab === 'cache' ? newContent : undefined,
            id: resolvingId 
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Error al guardar el entrenamiento');
      }

      setNewContent('');
      setEditingChunk(null);
      setEditingCache(null);
      setResolvingId(null);
      await Promise.all([fetchKnowledge(), fetchUnresolved(), fetchCache()]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este entrenamiento?')) return;
    
    try {
      const botUrl = process.env.NEXT_PUBLIC_BOT_URL || 'http://localhost:3000';
      const url = activeTab === 'cache' 
        ? `${botUrl}/bot/cache/${id}`
        : `${botUrl}/bot/knowledge/${id}`;

      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al eliminar');
      
      if (activeTab === 'cache') await fetchCache();
      else await fetchKnowledge();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleClearCache = async () => {
    if (!confirm('¿Estás seguro de que quieres vaciar TODA la memoria aprendida? Esto no se puede deshacer.')) return;
    
    try {
      const botUrl = process.env.NEXT_PUBLIC_BOT_URL || 'http://localhost:3000';
      const res = await fetch(`${botUrl}/bot/cache/all`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al vaciar la memoria');
      
      await fetchCache();
      alert('Memoria limpiada exitosamente');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const startResolving = (item: UnresolvedQuery) => {
      setResolvingId(item.id);
      setEditingChunk(null);
      setEditingCache(null);
      setNewContent(`Pregunta del usuario: ${item.query}\n\nRespuesta recomendada: `);
      window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const startEditingCache = (item: any) => {
      setEditingCache(item);
      setEditingChunk(null);
      setResolvingId(null);
      setNewContent(item.answer);
      window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Filtrado de búsqueda
  const filteredCache = cache.filter(item => 
    item.question?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    item.answer?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
            <h2 className="text-3xl font-black text-slate-900 tracking-tight font-outfit">Gestión de Cerebro</h2>
            <p className="text-slate-500 text-sm">Controla la información base y lo que el bot aprende dinámicamente.</p>
        </div>
        <button 
            onClick={() => { setEditingChunk(null); setEditingCache(null); setResolvingId(null); setNewContent(''); }}
            className="px-6 py-3 bg-blue-600 text-white rounded-2xl font-bold shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-all flex items-center gap-2 w-fit"
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            Nueva Información
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Editor Form */}
        <div className="lg:col-span-1">
            <div className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-xl shadow-slate-200/50 sticky top-8">
                <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                    {resolvingId ? 'Resolver Duda' : editingChunk ? 'Corregir Base' : editingCache ? 'Editar Memoria' : 'Añadir Base'}
                    <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
                </h3>
                
                <div className="space-y-4">
                    {editingCache && (
                        <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 text-xs text-blue-700 font-medium mb-2">
                            <span className="font-black block mb-1">Pregunta del usuario:</span>
                            "{editingCache.question}"
                        </div>
                    )}
                    <div>
                        <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest mb-2 block px-2">
                            {editingCache ? 'Respuesta del Bot' : 'Texto de Entrenamiento'}
                        </label>
                        <textarea 
                            value={newContent}
                            onChange={(e) => setNewContent(e.target.value)}
                            placeholder={editingCache ? "Modifica cómo debe responder el bot..." : "Escribe información para la base de conocimientos..."}
                            className="w-full h-80 p-6 bg-slate-50 border-0 rounded-3xl text-sm text-slate-700 focus:ring-2 focus:ring-blue-500 transition-all resize-none outline-none"
                        />
                    </div>
                    
                    <button 
                        onClick={handleSave}
                        disabled={isSaving || !newContent.trim()}
                        className={`w-full py-4 rounded-[1.5rem] font-bold transition-all shadow-xl ${isSaving || !newContent.trim() ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-slate-900 text-white hover:bg-slate-800 shadow-slate-900/10'}`}
                    >
                        {isSaving ? 'Guardando...' : resolvingId ? 'Completar' : editingChunk ? 'Actualizar' : editingCache ? 'Guardar Cambios' : 'Entrenar Bot'}
                    </button>
                    
                    {(editingChunk || resolvingId || editingCache) && (
                        <button 
                            onClick={() => { setEditingChunk(null); setEditingCache(null); setResolvingId(null); setNewContent(''); }}
                            className="w-full py-3 text-slate-400 text-sm font-bold hover:text-slate-600 transition-colors"
                        >
                            Cancelar
                        </button>
                    )}
                </div>

                {error && (
                    <div className="mt-6 p-4 bg-rose-50 rounded-2xl border border-rose-100 text-rose-600 text-xs font-bold flex items-start gap-2 animate-in slide-in-from-top-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                        {error}
                    </div>
                )}
            </div>
        </div>

        {/* List Tables */}
        <div className="lg:col-span-3 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex gap-2 p-1 bg-slate-100 w-fit rounded-2xl">
                    <button 
                        onClick={() => setActiveTab('trained')}
                        className={`px-6 py-2 rounded-xl text-xs font-black transition-all ${activeTab === 'trained' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        BASE CONOCIMIENTO ({chunks.length})
                    </button>
                    <button 
                        onClick={() => setActiveTab('pending')}
                        className={`px-6 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${activeTab === 'pending' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        DUDAS
                        {unresolved.length > 0 && <span className="w-2 h-2 bg-rose-500 rounded-full animate-ping"></span>}
                    </button>
                    <button 
                        onClick={() => setActiveTab('cache')}
                        className={`px-6 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${activeTab === 'cache' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        MEMORIA APRENDIDA ({cache.length})
                    </button>
                </div>

                <div className="flex items-center gap-4">
                    {activeTab === 'cache' && cache.length > 0 && (
                        <button 
                            onClick={handleClearCache}
                            className="px-4 py-2 bg-rose-50 text-rose-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-100 transition-all flex items-center gap-2 border border-rose-100"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                            Limpiar Memoria
                        </button>
                    )}

                    {activeTab === 'cache' && (
                        <div className="relative w-full md:w-64">
                            <input 
                                type="text" 
                                placeholder="Buscar en la memoria..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-3 bg-white border border-slate-100 rounded-2xl text-xs focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm"
                            />
                            <svg className="absolute left-3 top-3.5 text-slate-300" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                        </div>
                    )}
                </div>
            </div>

            <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-xl shadow-slate-200/50 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-50/50">
                            {activeTab === 'cache' ? (
                                <tr>
                                    <th className="px-8 py-4 text-left text-[10px] uppercase font-black text-slate-400 tracking-widest w-1/3">Pregunta del Usuario</th>
                                    <th className="px-8 py-4 text-left text-[10px] uppercase font-black text-slate-400 tracking-widest w-1/2">Respuesta del Bot</th>
                                    <th className="px-8 py-4 text-right text-[10px] uppercase font-black text-slate-400 tracking-widest">Acciones</th>
                                </tr>
                            ) : (
                                <tr>
                                    <th className="px-8 py-4 text-left text-[10px] uppercase font-black text-slate-400 tracking-widest">
                                        {activeTab === 'trained' ? 'Contenido Informativo' : 'Duda sin Respuesta'}
                                    </th>
                                    <th className="px-8 py-4 text-right text-[10px] uppercase font-black text-slate-400 tracking-widest">Acciones</th>
                                </tr>
                            )}
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {loading ? (
                                Array(5).fill(0).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="px-8 py-6"><div className="h-4 bg-slate-100 rounded w-full"></div></td>
                                        <td className="px-8 py-6 text-right"><div className="h-8 bg-slate-100 rounded-lg w-20 ml-auto"></div></td>
                                    </tr>
                                ))
                            ) : activeTab === 'trained' ? (
                                chunks.map((chunk) => (
                                    <tr key={chunk.id} className="group hover:bg-slate-50/50 transition-colors">
                                        <td className="px-8 py-6">
                                            <p className="text-sm text-slate-700 font-medium line-clamp-3 group-hover:line-clamp-none transition-all duration-500">{chunk.content}</p>
                                        </td>
                                        <td className="px-8 py-6 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button onClick={() => { setEditingChunk(chunk); setEditingCache(null); setResolvingId(null); setNewContent(chunk.content); }} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button>
                                                <button onClick={() => handleDelete(chunk.id)} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : activeTab === 'pending' ? (
                                unresolved.map((item) => (
                                    <tr key={item.id} className="group hover:bg-rose-50/30 transition-colors">
                                        <td className="px-8 py-6">
                                            <p className="text-sm text-slate-700 font-bold italic">"{item.query}"</p>
                                        </td>
                                        <td className="px-8 py-6 text-right">
                                            <button onClick={() => startResolving(item)} className="px-4 py-2 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-blue-600 transition-all shadow-lg shadow-slate-900/10">Entrenar</button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                filteredCache.length === 0 ? (
                                    <tr>
                                        <td colSpan={3} className="px-8 py-20 text-center text-slate-300 text-sm">No se encontraron resultados para tu búsqueda.</td>
                                    </tr>
                                ) : (
                                    filteredCache.map((item) => (
                                        <tr key={item.id} className="group hover:bg-blue-50/30 transition-colors">
                                            <td className="px-8 py-6">
                                                <p className="text-xs text-slate-800 font-black italic">"{item.question}"</p>
                                            </td>
                                            <td className="px-8 py-6">
                                                <p className="text-sm text-slate-600 line-clamp-2 group-hover:line-clamp-none transition-all duration-300 leading-relaxed">{item.answer}</p>
                                            </td>
                                            <td className="px-8 py-6 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button onClick={() => startEditingCache(item)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button>
                                                    <button onClick={() => handleDelete(item.id)} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}

