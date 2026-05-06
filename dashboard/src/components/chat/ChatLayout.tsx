import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { ConversationList } from './ConversationList';
import { MessageList } from './MessageList';
import DashboardOverview from '../dashboard/DashboardOverview';
import ConnectionStatus from '../dashboard/ConnectionStatus';
import KnowledgeManager from '../dashboard/KnowledgeManager';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';

export function ChatLayout() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [activeConv, setActiveConv] = useState<any | null>(null);
  const [activeView, setActiveView] = useState<'inbox' | 'dashboard' | 'connection' | 'training'>('dashboard');
  const [filterMode, setFilterMode] = useState<'all' | 'support'>('all');
  const [isNavOpen, setIsNavOpen] = useState(true);
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  const supportCount = conversations.filter(c => c.status === 'human_active').length;

  const handleLogout = () => {
    document.cookie = "auth_token=; path=/; max-age=0";
    router.push('/login');
  };

  const [lastMessages, setLastMessages] = useState<Record<string, any>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const prevSupportCountRef = React.useRef(0);

  const fetchConvs = async () => {
    const { data, error } = await supabase.from('conversations').select('*').order('updated_at', { ascending: false });
    if (error) {
      console.error('[Dashboard] Error fetching conversations:', error);
      return;
    }
    if (data) {
      setConversations(data);
      // Detectar nuevas solicitudes de soporte para notificación
      const newSupport = data.filter(c => c.status === 'human_active').length;
      if (newSupport > prevSupportCountRef.current && prevSupportCountRef.current > 0) {
        // Notificación sonora
        try { new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVggoqDdF5da4WNkH5oU1Bke4OFdGRYXXB+h4t/bFtZanqEh3xrXV1ufIWJf25cWmt9h4d9b1xca3yGiH5vXVxrfIaIfm9dXGt8hoh+b11ca3yGiH5vXVxrfIaIfm9d').play(); } catch(e) {}
      }
      prevSupportCountRef.current = newSupport;
    }
  };

  const fetchStudents = async () => {
    const { data } = await supabase.from('students').select('wa_id, full_name');
    if (data) setStudents(data);
  };

  // Obtener el último mensaje por cada conversación
  const fetchLastMessages = async (convs: any[]) => {
    if (!convs.length) return;
    const map: Record<string, any> = {};
    
    // Fetch últimos mensajes para todas las conversaciones de una vez
    const waIds = convs.map(c => c.wa_id);
    const { data: msgs } = await supabase
      .from('messages')
      .select('wa_id, text, sender_type, created_at')
      .in('wa_id', waIds)
      .order('created_at', { ascending: false });
    
    if (msgs) {
      // Agrupar: tomar solo el primer (más reciente) por wa_id
      for (const msg of msgs) {
        if (!map[msg.wa_id]) {
          map[msg.wa_id] = msg;
        }
      }
    }
    setLastMessages(map);
  };

  useEffect(() => {
    fetchConvs();
    fetchStudents();

    // Canal para cambios en conversaciones
    const convSub = supabase.channel('realtime:conversations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
         fetchConvs();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRealtimeStatus('connected');
        else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') setRealtimeStatus('error');
      });

    // Canal para nuevos mensajes (actualiza último mensaje y conversaciones)
    const msgSub = supabase.channel('realtime:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const newMsg = payload.new as any;
        // Actualizar último mensaje de esa conversación
        setLastMessages(prev => ({ ...prev, [newMsg.wa_id]: newMsg }));
        // Refrescar conversaciones (para actualizar el orden por updated_at)
        fetchConvs();
      })
      .subscribe();

    const studentSub = supabase.channel('realtime:students')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => {
         fetchStudents();
      })
      .subscribe();

    return () => { 
        supabase.removeChannel(convSub);
        supabase.removeChannel(msgSub);
        supabase.removeChannel(studentSub);
    };
  }, []);

  // Cuando conversations cambian, obtener los últimos mensajes
  useEffect(() => {
    if (conversations.length > 0) {
      fetchLastMessages(conversations);
    }
  }, [conversations]);


  return (
    <div className="flex h-screen bg-background overflow-hidden font-sans">
      {/* Mini Toggle for closed state */}
      {!isNavOpen && (
        <button 
          onClick={() => setIsNavOpen(true)}
          className="fixed bottom-6 left-6 w-12 h-12 bg-primary text-primary-foreground rounded-2xl flex items-center justify-center shadow-2xl z-50 hover:scale-110 transition-transform animate-in fade-in slide-in-from-left-4"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
      )}

      {/* Side Navigation */}
      <nav className={`bg-[var(--sidebar-bg)] border-r border-border/5 flex flex-col py-8 z-40 transition-all duration-500 ease-in-out ${isNavOpen ? 'w-64 px-4' : 'w-0 opacity-0 -translate-x-full overflow-hidden'}`}>
        <div className="flex items-center gap-3 px-4 mb-10 shrink-0">
            <div className="w-10 h-10 bg-primary rounded-2xl flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/30">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
            </div>
            <div className="flex flex-col">
                <span className="text-[var(--sidebar-text)] font-black text-sm tracking-tight">Bot2703</span>
                <span className="text-primary font-bold uppercase tracking-widest text-[10px]">Admin</span>
            </div>
            <button 
                onClick={() => setIsNavOpen(false)}
                className="ml-auto p-2 text-slate-500 hover:text-white transition-colors"
                title="Ocultar"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
        </div>
        
        <div className="space-y-2 flex-1">
            <button 
                onClick={() => setActiveView('dashboard')}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all duration-300 ${activeView === 'dashboard' ? 'bg-primary/20 text-primary shadow-inner' : 'text-[var(--sidebar-text)]/60 hover:text-[var(--sidebar-text)] hover:bg-card/5'}`}
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                <span className="font-bold text-sm">Dashboard</span>
            </button>

            <button 
                onClick={() => setActiveView('inbox')}
                className={`w-full flex items-center justify-between p-4 rounded-2xl transition-all duration-300 ${activeView === 'inbox' ? 'bg-primary/20 text-primary shadow-inner' : 'text-[var(--sidebar-text)]/60 hover:text-[var(--sidebar-text)] hover:bg-card/5'}`}
            >
                <div className="flex items-center gap-4">
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    <span className="font-bold text-sm">Inbox Mensajes</span>
                </div>
                {supportCount > 0 && (
                    <span className="w-5 h-5 bg-destructive rounded-full flex items-center justify-center text-[10px] text-destructive-foreground font-black animate-pulse shadow-lg shadow-destructive/20">
                        {supportCount}
                    </span>
                )}
            </button>

            <button 
                onClick={() => setActiveView('training')}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all duration-300 ${activeView === 'training' ? 'bg-primary/20 text-primary shadow-inner' : 'text-[var(--sidebar-text)]/60 hover:text-[var(--sidebar-text)] hover:bg-card/5'}`}
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                <span className="font-bold text-sm">Entrenamiento</span>
            </button>

            <button 
                onClick={() => setActiveView('connection')}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all duration-300 ${activeView === 'connection' ? 'bg-primary/20 text-primary shadow-inner' : 'text-[var(--sidebar-text)]/60 hover:text-[var(--sidebar-text)] hover:bg-card/5'}`}
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
                <span className="font-bold text-sm">Conexión QR</span>
            </button>
        </div>

        <div className="mt-auto space-y-2">
            <button 
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="w-full flex items-center gap-4 p-4 rounded-2xl text-[var(--sidebar-text)]/60 hover:text-[var(--sidebar-text)] hover:bg-card/5 transition-all duration-300"
            >
                {mounted ? (
                  <>
                    {theme === 'dark' ? <Sun size={22} strokeWidth={2}/> : <Moon size={22} strokeWidth={2}/>}
                    <span className="font-bold text-sm">Tema {theme === 'dark' ? 'Claro' : 'Oscuro'}</span>
                  </>
                ) : (
                  <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                )}
            </button>

            <button 
                onClick={handleLogout}
                className="w-full flex items-center gap-4 p-4 rounded-2xl text-[var(--sidebar-text)]/60 hover:text-destructive hover:bg-destructive/10 transition-all duration-300"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                <span className="font-bold text-sm">Cerrar Sesión</span>
            </button>
        </div>
      </nav>

      <AnimatePresence mode="wait">
        {activeView === 'inbox' ? (
          <motion.div 
            key="inbox"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="flex-1 flex overflow-hidden"
          >
              {/* Sidebar - Lista de Conversaciones */}
              <aside className="w-1/3 max-w-[400px] min-w-[300px] glass-panel border-l-0 border-y-0 flex flex-col z-30 transition-all duration-500 ease-in-out">
                  <div className="p-6 border-b border-border bg-card/50 backdrop-blur-md sticky top-0 z-10">
                      <div className="flex items-center justify-between">
                          <div>
                              <h1 className="font-black text-2xl text-foreground tracking-tight font-outfit">Inbox</h1>
                              <p className="text-[10px] text-primary font-bold uppercase tracking-widest mt-1">Gestión de Leads UNAC</p>
                          </div>
                          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border ${
                              realtimeStatus === 'connected' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
                              realtimeStatus === 'error' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                              'bg-amber-500/10 text-amber-500 border-amber-500/20'
                          }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${realtimeStatus === 'connected' ? 'bg-emerald-500' : realtimeStatus === 'error' ? 'bg-destructive' : 'bg-amber-500 animate-pulse'}`} />
                              {realtimeStatus === 'connected' ? 'En vivo' : realtimeStatus === 'error' ? 'Desconectado' : 'Conectando...'}
                          </div>
                      </div>
                  </div>
                  
                  <div className="flex-1 overflow-hidden flex flex-col">
                      <ConversationList 
                          conversations={conversations}
                          students={students} 
                          activeId={activeConv?.id} 
                          filterMode={filterMode}
                          onFilterChange={setFilterMode}
                          lastMessages={lastMessages}
                          onSelect={(conv: any) => {
                              setActiveConv(conv);
                          }} 
                      />
                  </div>
              </aside>

              {/* Main Chat Area */}
              <main className="flex-1 flex flex-col bg-background relative overflow-hidden">
                  {activeConv ? (
                  <MessageList conversation={activeConv} students={students} />
                  ) : (

                  <div className="m-auto flex flex-col items-center justify-center space-y-4 animate-in fade-in zoom-in duration-700">
                      <div className="w-24 h-24 bg-card rounded-[2rem] shadow-2xl flex items-center justify-center border border-border text-muted-foreground animate-float">
                          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>
                      </div>
                      <div className="text-center">
                          <h3 className="text-lg font-bold text-foreground font-outfit">Bienvenido al Centro de Control</h3>
                          <p className="text-sm text-muted-foreground">Selecciona un chat en la izquierda para comenzar a gestionar.</p>
                      </div>
                  </div>
                  )}
              </main>
          </motion.div>
        ) : activeView === 'dashboard' ? (
          <motion.main 
            key="dashboard"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="flex-1 overflow-y-auto"
          >
              <DashboardOverview />
          </motion.main>
        ) : activeView === 'training' ? (
          <motion.main 
            key="training"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="flex-1 overflow-y-auto"
          >
              <KnowledgeManager />
          </motion.main>
        ) : (
          <motion.main 
            key="connection"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="flex-1 overflow-y-auto"
          >
              <ConnectionStatus />
          </motion.main>
        )}
      </AnimatePresence>
    </div>
  );
}




