'use client';

import { useState, useEffect, useRef, useMemo } from 'react';

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

const CATEGORIES = [
  { value: '', label: 'Sin categoría', color: 'bg-slate-500' },
  { value: 'maestrias', label: 'Maestrías', color: 'bg-blue-500' },
  { value: 'doctorados', label: 'Doctorados', color: 'bg-purple-500' },
  { value: 'especialidades', label: 'Especialidades', color: 'bg-teal-500' },
  { value: 'inscripcion', label: 'Inscripción', color: 'bg-amber-500' },
  { value: 'horarios', label: 'Horarios', color: 'bg-emerald-500' },
  { value: 'costos', label: 'Costos', color: 'bg-rose-500' },
  { value: 'general', label: 'Info General', color: 'bg-indigo-500' },
];

const PAGE_SIZE = 15;

export default function KnowledgeManager() {
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [unresolved, setUnresolved] = useState<UnresolvedQuery[]>([]);
  const [cache, setCache] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingChunk, setEditingChunk] = useState<KnowledgeChunk | null>(null);
  const [editingCache, setEditingCache] = useState<any | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [newContent, setNewContent] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'trained' | 'pending' | 'cache'>('trained');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [isImporting, setIsImporting] = useState(false);

  // Toast system
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const toastTimeout = useRef<NodeJS.Timeout | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    setToast({ message, type });
    toastTimeout.current = setTimeout(() => setToast(null), 4000);
  };

  const botUrl = process.env.NEXT_PUBLIC_BOT_URL || 'http://localhost:3000';

  const fetchKnowledge = async () => {
    try {
      const res = await fetch(`${botUrl}/bot/knowledge`);
      if (!res.ok) throw new Error('Error al cargar la base de conocimientos');
      setChunks(await res.json());
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const fetchUnresolved = async () => {
    try {
      const res = await fetch(`${botUrl}/bot/unresolved`);
      if (!res.ok) throw new Error('Error al cargar dudas pendientes');
      setUnresolved(await res.json());
    } catch (err: any) {
      console.error(err);
    }
  };

  const fetchCache = async () => {
    try {
      const res = await fetch(`${botUrl}/bot/cache`);
      if (!res.ok) throw new Error('Error al cargar memoria semántica');
      setCache(await res.json());
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

  // Reset page when tab or search changes
  useEffect(() => { setCurrentPage(1); }, [activeTab, searchTerm]);

  // Filtered data with global search
  const filteredChunks = useMemo(() => {
    if (!searchTerm.trim()) return chunks;
    const q = searchTerm.toLowerCase();
    return chunks.filter(c =>
      c.content.toLowerCase().includes(q) ||
      (c.metadata?.category || '').toLowerCase().includes(q)
    );
  }, [chunks, searchTerm]);

  const filteredUnresolved = useMemo(() => {
    if (!searchTerm.trim()) return unresolved;
    const q = searchTerm.toLowerCase();
    return unresolved.filter(u => u.query.toLowerCase().includes(q));
  }, [unresolved, searchTerm]);

  const filteredCache = useMemo(() => {
    if (!searchTerm.trim()) return cache;
    const q = searchTerm.toLowerCase();
    return cache.filter(item =>
      item.question?.toLowerCase().includes(q) ||
      item.answer?.toLowerCase().includes(q)
    );
  }, [cache, searchTerm]);

  // Current tab's filtered data
  const currentData = activeTab === 'trained' ? filteredChunks : activeTab === 'pending' ? filteredUnresolved : filteredCache;
  const totalPages = Math.max(1, Math.ceil(currentData.length / PAGE_SIZE));
  const paginatedData = currentData.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // KPIs
  const resolvedCount = chunks.length;
  const pendingCount = unresolved.length;
  const cacheCount = cache.length;
  const resolutionRate = resolvedCount + pendingCount > 0
    ? Math.round((resolvedCount / (resolvedCount + pendingCount)) * 100)
    : 100;

  const handleSave = async () => {
    if (!newContent.trim()) return;
    setIsSaving(true);

    try {
      let url = '';
      let method = 'POST';

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

      const body: any = {};
      if (activeTab === 'cache' || editingCache) {
        body.answer = newContent;
      } else {
        body.content = newContent;
        body.metadata = { category: selectedCategory };
      }
      if (resolvingId) body.id = resolvingId;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Error al guardar');
      }

      setNewContent('');
      setEditingChunk(null);
      setEditingCache(null);
      setResolvingId(null);
      setSelectedCategory('');
      await Promise.all([fetchKnowledge(), fetchUnresolved(), fetchCache()]);

      showToast(
        resolvingId ? 'Duda resuelta y bot entrenado ✅' :
        editingChunk ? 'Fragmento actualizado correctamente' :
        editingCache ? 'Respuesta de caché actualizada' :
        'Nuevo conocimiento añadido al bot 🧠',
        'success'
      );
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este registro?')) return;

    try {
      const url = activeTab === 'cache'
        ? `${botUrl}/bot/cache/${id}`
        : `${botUrl}/bot/knowledge/${id}`;

      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al eliminar');

      if (activeTab === 'cache') await fetchCache();
      else await fetchKnowledge();

      showToast('Registro eliminado', 'info');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleClearCache = async () => {
    if (!confirm('¿Estás seguro de que quieres vaciar TODA la memoria aprendida? Esto no se puede deshacer.')) return;

    try {
      const res = await fetch(`${botUrl}/bot/cache/all`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al vaciar la memoria');
      await fetchCache();
      showToast('Memoria limpiada exitosamente', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
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

  const startEditingChunk = (chunk: KnowledgeChunk) => {
    setEditingChunk(chunk);
    setEditingCache(null);
    setResolvingId(null);
    setNewContent(chunk.content);
    setSelectedCategory(chunk.metadata?.category || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetForm = () => {
    setEditingChunk(null);
    setEditingCache(null);
    setResolvingId(null);
    setNewContent('');
    setSelectedCategory('');
  };

  // Bulk import from file
  const handleBulkImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const text = await file.text();
      // Split by double newlines (paragraphs) or by lines starting with "---"
      const fragments = text.split(/\n{2,}|^---$/m)
        .map(f => f.trim())
        .filter(f => f.length > 20); // Filter out very short fragments

      if (fragments.length === 0) {
        showToast('No se encontraron fragmentos válidos en el archivo', 'error');
        return;
      }

      let success = 0;
      let failed = 0;

      for (const fragment of fragments) {
        try {
          const res = await fetch(`${botUrl}/bot/knowledge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: fragment, metadata: { category: selectedCategory || 'general', imported: true } })
          });
          if (res.ok) success++;
          else failed++;
        } catch {
          failed++;
        }
      }

      await fetchKnowledge();
      showToast(`Importación completa: ${success} añadidos, ${failed} fallidos`, success > 0 ? 'success' : 'error');
    } catch (err: any) {
      showToast('Error al leer el archivo: ' + err.message, 'error');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const getCategoryInfo = (cat: string) => CATEGORIES.find(c => c.value === cat) || CATEGORIES[0];

  const getQualityIndicator = (answer: string) => {
    const len = answer?.length || 0;
    if (len > 200) return { label: 'Completa', color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10', icon: '●' };
    if (len > 80) return { label: 'Buena', color: 'text-blue-500 bg-blue-50 dark:bg-blue-500/10', icon: '●' };
    return { label: 'Corta', color: 'text-amber-500 bg-amber-50 dark:bg-amber-500/10', icon: '●' };
  };

  const timeAgo = (dateStr: string) => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `Hace ${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `Hace ${hrs}h`;
    return `Hace ${Math.floor(hrs / 24)}d`;
  };

  return (
    <div className="p-8 space-y-6 animate-in fade-in duration-500 max-w-7xl mx-auto">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-2xl shadow-2xl text-sm font-bold flex items-center gap-2 animate-in slide-in-from-top-4 fade-in duration-300 ${
          toast.type === 'success' ? 'bg-emerald-600 text-white shadow-emerald-600/30' :
          toast.type === 'error' ? 'bg-rose-600 text-white shadow-rose-600/30' :
          'bg-blue-600 text-white shadow-blue-600/30'
        }`}>
          <span>{toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : 'ℹ️'}</span>
          {toast.message}
          <button onClick={() => setToast(null)} className="ml-2 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-3xl font-black text-foreground tracking-tight font-outfit">Gestión de Cerebro</h2>
          <p className="text-muted-foreground text-sm">Controla la información base y lo que el bot aprende dinámicamente.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="file" ref={fileInputRef} onChange={handleBulkImport} className="hidden" accept=".txt,.csv,.md" />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="px-4 py-3 bg-secondary border border-border text-foreground rounded-2xl font-bold text-xs hover:bg-muted transition-all flex items-center gap-2"
          >
            {isImporting ? (
              <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            )}
            Importar archivo
          </button>
          <button
            onClick={resetForm}
            className="px-5 py-3 bg-primary text-primary-foreground rounded-2xl font-bold text-xs shadow-lg shadow-primary/20 hover:opacity-90 transition-all flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
            Nueva Información
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Base de Conocimiento', value: resolvedCount, icon: '🧠', gradient: 'from-blue-500 to-indigo-600', shadow: 'shadow-blue-500/20' },
          { label: 'Dudas Pendientes', value: pendingCount, icon: '❓', gradient: 'from-rose-500 to-pink-600', shadow: 'shadow-rose-500/20' },
          { label: 'Memoria Aprendida', value: cacheCount, icon: '💾', gradient: 'from-violet-500 to-purple-600', shadow: 'shadow-violet-500/20' },
          { label: 'Tasa Resolución', value: `${resolutionRate}%`, icon: '📊', gradient: 'from-emerald-500 to-teal-600', shadow: 'shadow-emerald-500/20' },
        ].map((kpi, idx) => (
          <div key={idx} className="glass-panel rounded-2xl p-4 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 group">
            <div className="flex items-center gap-3">
              <div className={`bg-gradient-to-br ${kpi.gradient} w-10 h-10 rounded-xl flex items-center justify-center text-base shadow-lg ${kpi.shadow} group-hover:scale-110 transition-transform shrink-0`}>
                {kpi.icon}
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">{kpi.label}</p>
                <h3 className="text-2xl font-black text-foreground tabular-nums">{loading ? '—' : kpi.value}</h3>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Editor Form */}
        <div className="lg:col-span-1">
          <div className="glass-panel rounded-3xl p-6 border border-border shadow-xl sticky top-8">
            <h3 className="text-lg font-bold text-foreground mb-5 flex items-center gap-2">
              {resolvingId ? '🎯 Resolver Duda' : editingChunk ? '✏️ Corregir Base' : editingCache ? '✏️ Editar Memoria' : '➕ Añadir Base'}
              <span className="w-2 h-2 bg-primary rounded-full animate-pulse"></span>
            </h3>

            <div className="space-y-4">
              {editingCache && (
                <div className="p-3 bg-blue-50 dark:bg-blue-500/10 rounded-xl border border-blue-200 dark:border-blue-500/20 text-xs text-blue-700 dark:text-blue-300 font-medium">
                  <span className="font-black block mb-1">Pregunta del usuario:</span>
                  &quot;{editingCache.question}&quot;
                </div>
              )}

              {/* Category selector (only for knowledge base) */}
              {!editingCache && activeTab !== 'cache' && (
                <div>
                  <label className="text-[10px] uppercase font-black text-muted-foreground tracking-widest mb-2 block px-1">
                    Categoría
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {CATEGORIES.filter(c => c.value).map(cat => (
                      <button
                        key={cat.value}
                        onClick={() => setSelectedCategory(cat.value)}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border transition-all ${
                          selectedCategory === cat.value
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-secondary text-muted-foreground border-border hover:border-primary/50'
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="text-[10px] uppercase font-black text-muted-foreground tracking-widest mb-2 block px-1">
                  {editingCache ? 'Respuesta del Bot' : 'Texto de Entrenamiento'}
                </label>
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder={editingCache ? "Modifica cómo debe responder el bot..." : "Escribe información para la base de conocimientos..."}
                  className="w-full h-64 p-4 bg-secondary border-0 rounded-2xl text-sm text-foreground focus:ring-2 focus:ring-primary/20 transition-all resize-none outline-none placeholder:text-muted-foreground"
                />
                <p className="text-[10px] text-muted-foreground mt-1 px-1 tabular-nums">{newContent.length} caracteres</p>
              </div>

              <button
                onClick={handleSave}
                disabled={isSaving || !newContent.trim()}
                className={`w-full py-3.5 rounded-2xl font-bold text-sm transition-all shadow-lg ${isSaving || !newContent.trim() ? 'bg-muted text-muted-foreground cursor-not-allowed shadow-none' : 'bg-primary text-primary-foreground hover:opacity-90 shadow-primary/20'}`}
              >
                {isSaving ? 'Guardando...' : resolvingId ? '✓ Completar' : editingChunk ? 'Actualizar' : editingCache ? 'Guardar Cambios' : '🧠 Entrenar Bot'}
              </button>

              {(editingChunk || resolvingId || editingCache) && (
                <button
                  onClick={resetForm}
                  className="w-full py-2.5 text-muted-foreground text-xs font-bold hover:text-foreground transition-colors"
                >
                  Cancelar
                </button>
              )}
            </div>
          </div>
        </div>

        {/* List Tables */}
        <div className="lg:col-span-3 space-y-4">
          {/* Tabs + Search + Actions */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex gap-1 p-1 bg-secondary w-fit rounded-xl border border-border">
              <button
                onClick={() => setActiveTab('trained')}
                className={`px-4 py-2 rounded-lg text-[10px] font-black transition-all ${activeTab === 'trained' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                BASE ({chunks.length})
              </button>
              <button
                onClick={() => setActiveTab('pending')}
                className={`px-4 py-2 rounded-lg text-[10px] font-black transition-all flex items-center gap-1.5 ${activeTab === 'pending' ? 'bg-card text-rose-600 shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                DUDAS
                {unresolved.length > 0 && <span className="w-2 h-2 bg-rose-500 rounded-full animate-ping"></span>}
              </button>
              <button
                onClick={() => setActiveTab('cache')}
                className={`px-4 py-2 rounded-lg text-[10px] font-black transition-all ${activeTab === 'cache' ? 'bg-card text-blue-600 shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                MEMORIA ({cache.length})
              </button>
            </div>

            <div className="flex items-center gap-2">
              {activeTab === 'cache' && cache.length > 0 && (
                <button
                  onClick={handleClearCache}
                  className="px-3 py-2 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-all flex items-center gap-1.5 border border-rose-200 dark:border-rose-500/20"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                  Limpiar
                </button>
              )}
              {/* Global Search */}
              <div className="relative w-full md:w-56">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                <input
                  type="text"
                  placeholder="Buscar en todo..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 bg-secondary border border-border rounded-xl text-xs font-medium text-foreground focus:ring-2 focus:ring-primary/20 outline-none transition-all placeholder:text-muted-foreground"
                />
                {searchTerm && (
                  <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="glass-panel rounded-3xl border border-border shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-secondary/50">
                  {activeTab === 'cache' ? (
                    <tr>
                      <th className="px-6 py-3.5 text-left text-[10px] uppercase font-black text-muted-foreground tracking-widest w-1/3">Pregunta</th>
                      <th className="px-6 py-3.5 text-left text-[10px] uppercase font-black text-muted-foreground tracking-widest">Respuesta</th>
                      <th className="px-6 py-3.5 text-center text-[10px] uppercase font-black text-muted-foreground tracking-widest w-20">Calidad</th>
                      <th className="px-6 py-3.5 text-right text-[10px] uppercase font-black text-muted-foreground tracking-widest w-24">Acciones</th>
                    </tr>
                  ) : activeTab === 'pending' ? (
                    <tr>
                      <th className="px-6 py-3.5 text-left text-[10px] uppercase font-black text-muted-foreground tracking-widest">Duda sin Respuesta</th>
                      <th className="px-6 py-3.5 text-center text-[10px] uppercase font-black text-muted-foreground tracking-widest w-24">Tiempo</th>
                      <th className="px-6 py-3.5 text-right text-[10px] uppercase font-black text-muted-foreground tracking-widest w-24">Acciones</th>
                    </tr>
                  ) : (
                    <tr>
                      <th className="px-6 py-3.5 text-left text-[10px] uppercase font-black text-muted-foreground tracking-widest w-20">Categoría</th>
                      <th className="px-6 py-3.5 text-left text-[10px] uppercase font-black text-muted-foreground tracking-widest">Contenido</th>
                      <th className="px-6 py-3.5 text-right text-[10px] uppercase font-black text-muted-foreground tracking-widest w-24">Acciones</th>
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-border/30">
                  {loading ? (
                    Array(5).fill(0).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        <td className="px-6 py-5"><div className="h-4 bg-muted rounded w-24" /></td>
                        <td className="px-6 py-5"><div className="h-4 bg-muted rounded w-full" /></td>
                        <td className="px-6 py-5 text-right"><div className="h-8 bg-muted rounded-lg w-16 ml-auto" /></td>
                      </tr>
                    ))
                  ) : paginatedData.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-16 text-center">
                        <div className="text-muted-foreground">
                          <p className="text-sm font-bold">{searchTerm ? 'Sin resultados' : 'Sin datos'}</p>
                          <p className="text-xs mt-1">{searchTerm ? `No se encontraron coincidencias para "${searchTerm}"` : 'Añade información para entrenar al bot'}</p>
                        </div>
                      </td>
                    </tr>
                  ) : activeTab === 'trained' ? (
                    (paginatedData as KnowledgeChunk[]).map((chunk) => {
                      const cat = getCategoryInfo(chunk.metadata?.category || '');
                      return (
                        <tr key={chunk.id} className="group hover:bg-secondary/50 transition-colors">
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold text-white ${cat.color}`}>
                              {cat.label}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm text-foreground font-medium line-clamp-2 group-hover:line-clamp-none transition-all duration-500">{chunk.content}</p>
                            <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(chunk.created_at)}</p>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => startEditingChunk(chunk)} className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-all" title="Editar">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></svg>
                              </button>
                              <button onClick={() => handleDelete(chunk.id)} className="p-2 text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 rounded-lg transition-all" title="Eliminar">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : activeTab === 'pending' ? (
                    (paginatedData as UnresolvedQuery[]).map((item) => (
                      <tr key={item.id} className="group hover:bg-rose-500/5 transition-colors">
                        <td className="px-6 py-4">
                          <p className="text-sm text-foreground font-bold italic">&quot;{item.query}&quot;</p>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="text-[10px] font-bold text-muted-foreground">{timeAgo(item.created_at)}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button onClick={() => startResolving(item)} className="px-3 py-1.5 bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-widest rounded-lg hover:opacity-90 transition-all shadow-sm">
                            Entrenar
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    (paginatedData as any[]).map((item) => {
                      const quality = getQualityIndicator(item.answer);
                      return (
                        <tr key={item.id} className="group hover:bg-blue-500/5 transition-colors">
                          <td className="px-6 py-4">
                            <p className="text-xs text-foreground font-bold italic">&quot;{item.question}&quot;</p>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm text-muted-foreground line-clamp-2 group-hover:line-clamp-none transition-all duration-300 leading-relaxed">{item.answer}</p>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold border ${quality.color}`}>
                              {quality.icon} {quality.label}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => startEditingCache(item)} className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-all" title="Editar">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></svg>
                              </button>
                              <button onClick={() => handleDelete(item.id)} className="p-2 text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 rounded-lg transition-all" title="Eliminar">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-3 border-t border-border bg-secondary/30">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  Mostrando {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, currentData.length)} de {currentData.length}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-lg hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-all text-muted-foreground"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let page: number;
                    if (totalPages <= 5) page = i + 1;
                    else if (currentPage <= 3) page = i + 1;
                    else if (currentPage >= totalPages - 2) page = totalPages - 4 + i;
                    else page = currentPage - 2 + i;

                    return (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${currentPage === page ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-secondary'}`}
                      >
                        {page}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded-lg hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-all text-muted-foreground"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Import help text */}
          <div className="px-4 py-3 bg-secondary/50 border border-border rounded-2xl">
            <p className="text-[10px] font-bold text-muted-foreground flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
              <span><strong>Tip de importación:</strong> Sube un archivo .txt separando cada fragmento de información con una línea en blanco o con &quot;---&quot;. Cada fragmento se añadirá individualmente a la base.</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
