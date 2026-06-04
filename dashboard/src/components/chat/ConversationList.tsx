'use client';

import React, { useState, useMemo } from 'react';

interface ConversationListProps {
    conversations: any[];
    students: any[];
    activeId: string | undefined;
    filterMode: 'all' | 'support' | 'queue';
    onFilterChange: (mode: 'all' | 'support' | 'queue') => void;
    lastMessages: Record<string, any>;
    unreadCounts: Record<string, number>;
    onSelect: (conv: any) => void;
}

export function ConversationList({
    conversations,
    students,
    activeId,
    filterMode,
    onFilterChange,
    lastMessages,
    unreadCounts,
    onSelect,
}: ConversationListProps) {
    const [searchQuery, setSearchQuery] = useState('');

    const getStudentName = (waId: string) => {
        if (waId.includes('web')) return 'Visitante Web';
        const student = students.find(s => s.wa_id === waId);
        return student?.full_name || waId.split('@')[0];
    };

    const supportCount = conversations.filter(c => c.status === 'human_active').length;

    // Filter + sort logic
    const filteredConversations = useMemo(() => {
        let filtered = conversations;

        // Apply status filter
        if (filterMode === 'support' || filterMode === 'queue') {
            filtered = filtered.filter(c => c.status === 'human_active');
        }

        // Apply search
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(conv => {
                const name = getStudentName(conv.wa_id).toLowerCase();
                const phone = conv.wa_id.split('@')[0];
                return name.includes(q) || phone.includes(q);
            });
        }

        // Queue mode: sort FIFO (oldest first by updated_at)
        if (filterMode === 'queue') {
            filtered = [...filtered].sort(
                (a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
            );
        }

        return filtered;
    }, [conversations, filterMode, searchQuery, students]);

    const timeAgo = (dateStr: string) => {
        const now = new Date();
        const date = new Date(dateStr);
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Ahora';
        if (diffMins < 60) return `${diffMins}m`;
        if (diffHours < 24) return `${diffHours}h`;
        if (diffDays < 7) return `${diffDays}d`;
        return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
    };

    const waitTime = (dateStr: string) => {
        const diffMs = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diffMs / 60000);
        const hrs = Math.floor(mins / 60);

        let label = '';
        if (mins < 60) label = `${mins} min`;
        else if (hrs < 24) label = `${hrs}h ${mins % 60}m`;
        else label = `${Math.floor(hrs / 24)}d ${hrs % 24}h`;

        let colorClass = 'wait-green';
        if (mins >= 60) colorClass = 'wait-red';
        else if (mins >= 15) colorClass = 'wait-yellow';

        return { label, colorClass };
    };

    const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

    return (
        <div className="flex-1 overflow-hidden flex flex-col">
            {/* Search Bar */}
            <div className="px-4 pt-3 pb-1">
                <div className="relative">
                    <svg
                        xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Buscar por nombre o número..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full bg-secondary border border-border rounded-xl pl-10 pr-4 py-2.5 text-xs font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex p-1.5 bg-secondary mx-4 my-2 rounded-xl border border-border">
                <button
                    onClick={() => onFilterChange('all')}
                    className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-1 ${filterMode === 'all' ? 'glass-panel text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                    Todos
                    {totalUnread > 0 && (
                        <span className="min-w-[16px] h-[16px] bg-primary rounded-full flex items-center justify-center text-[8px] text-primary-foreground font-black px-1">
                            {totalUnread > 99 ? '99+' : totalUnread}
                        </span>
                    )}
                </button>
                <button
                    onClick={() => onFilterChange('support')}
                    className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-1 ${filterMode === 'support' ? 'glass-panel text-rose-600 shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                    Apoyo
                    {supportCount > 0 && (
                        <span className="min-w-[16px] h-[16px] bg-rose-500 rounded-full flex items-center justify-center text-[8px] text-white font-black animate-pulse px-1">
                            {supportCount}
                        </span>
                    )}
                </button>
                <button
                    onClick={() => onFilterChange('queue')}
                    className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-1 ${filterMode === 'queue' ? 'glass-panel text-amber-600 shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                    🔥 Cola
                    {supportCount > 0 && (
                        <span className="min-w-[16px] h-[16px] bg-amber-500 rounded-full flex items-center justify-center text-[8px] text-white font-black px-1">
                            {supportCount}
                        </span>
                    )}
                </button>
            </div>

            {/* Queue header info */}
            {filterMode === 'queue' && filteredConversations.length > 0 && (
                <div className="mx-4 mb-2 px-3 py-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
                    <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                        Ordenado por tiempo de espera: el primero que escribió aparece arriba
                    </p>
                </div>
            )}

            {/* Conversation Items */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {filteredConversations.length === 0 ? (
                    <div className="p-10 text-center space-y-3">
                        <div className="w-16 h-16 bg-secondary rounded-2xl flex items-center justify-center mx-auto mb-4 text-muted-foreground">
                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                        </div>
                        <p className="text-muted-foreground text-sm font-bold">
                            {searchQuery
                                ? 'Sin resultados'
                                : filterMode === 'support' || filterMode === 'queue'
                                    ? 'Sin solicitudes de apoyo'
                                    : 'No hay conversaciones'}
                        </p>
                        <p className="text-muted-foreground text-[10px] uppercase font-bold tracking-tighter">
                            {searchQuery
                                ? `No se encontraron resultados para "${searchQuery}"`
                                : filterMode === 'support' || filterMode === 'queue'
                                    ? 'Todas las conversaciones están siendo atendidas por el bot'
                                    : 'Esperando mensajes de WhatsApp...'}
                        </p>
                    </div>
                ) : (
                    filteredConversations.map((conv, index) => {
                        const isActive = activeId === conv.id;
                        const isHuman = conv.status === 'human_active';
                        const displayName = getStudentName(conv.wa_id);
                        const lastMsg = lastMessages[conv.wa_id];
                        const unread = unreadCounts[conv.wa_id] || 0;
                        const wait = filterMode === 'queue' ? waitTime(conv.updated_at) : null;

                        return (
                            <div
                                key={conv.id}
                                onClick={() => onSelect(conv)}
                                className={`px-4 py-4 border-b border-border/30 cursor-pointer transition-all duration-300 hover:bg-secondary/80 relative group ${isActive ? 'bg-secondary/60 ring-1 ring-primary/10' : 'bg-transparent'} ${isHuman && !isActive ? 'bg-amber-50/30 dark:bg-amber-500/5' : ''}`}
                            >
                                {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full shadow-lg shadow-primary/50" />}

                                {/* Queue position badge */}
                                {filterMode === 'queue' && (
                                    <div className="absolute top-2 right-3">
                                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-md border ${wait?.colorClass}`}>
                                            ⏱ {wait?.label}
                                        </span>
                                    </div>
                                )}

                                <div className="flex gap-3 items-start">
                                    <div className="relative shrink-0 flex items-center justify-center mt-0.5">
                                        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-white shadow-lg transition-transform group-hover:scale-105 text-sm ${isHuman ? 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-orange-500/20' : 'bg-gradient-to-br from-blue-500 to-indigo-600 shadow-blue-500/20'}`}>
                                            {displayName.charAt(0).toUpperCase()}
                                        </div>
                                        {/* Source Indicator */}
                                        <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-md border-2 border-card flex items-center justify-center shadow-sm ${conv.wa_id.includes('web') ? 'bg-slate-800' : 'bg-emerald-500'}`}>
                                            {conv.wa_id.includes('web') ? (
                                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                                            ) : (
                                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" /><path d="M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.334.101 11.893c-.001 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654c1.737.948 3.693 1.447 5.683 1.448h.005c6.579 0 11.94-5.335 11.943-11.893.002-3.176-1.233-6.162-3.473-8.452zM12.045 21.785h-.004c-1.774 0-3.513-.477-5.032-1.378l-.36-.214-3.742.981 1-3.648-.235-.374c-.99-1.574-1.512-3.393-1.511-5.26.002-5.45 4.437-9.884 9.889-9.884 2.64 0 5.122 1.03 6.988 2.898 1.866 1.869 2.893 4.352 2.892 6.993-.003 5.45-4.437 9.886-9.885 9.886z" /></svg>
                                            )}
                                        </div>
                                        {/* Unread badge */}
                                        {unread > 0 && (
                                            <div className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-primary rounded-full flex items-center justify-center text-[9px] text-primary-foreground font-black px-1 shadow-lg shadow-primary/30 z-10">
                                                {unread > 9 ? '9+' : unread}
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-center mb-1">
                                            <h3 className={`font-bold text-sm truncate tracking-tight ${unread > 0 ? 'text-foreground' : 'text-foreground/80'}`}>
                                                {filterMode === 'queue' && (
                                                    <span className="text-amber-500 mr-1">#{index + 1}</span>
                                                )}
                                                {displayName}
                                            </h3>
                                            {filterMode !== 'queue' && (
                                                <span className="text-[10px] font-medium text-muted-foreground tabular-nums shrink-0 ml-2">
                                                    {timeAgo(lastMsg?.created_at || conv.updated_at)}
                                                </span>
                                            )}
                                        </div>

                                        {/* Last message preview */}
                                        {lastMsg && (
                                            <p className={`text-[11px] truncate mb-1.5 leading-tight ${unread > 0 ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
                                                {lastMsg.sender_type === 'bot' && (
                                                    <span className="text-blue-400 font-semibold">Bot: </span>
                                                )}
                                                {lastMsg.sender_type === 'dashboard' && (
                                                    <span className="text-indigo-400 font-semibold">Tú: </span>
                                                )}
                                                {lastMsg.text?.substring(0, 60)}{lastMsg.text?.length > 60 ? '...' : ''}
                                            </p>
                                        )}

                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-1.5">
                                                {isHuman ? (
                                                    <div className="flex items-center gap-1 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-100 dark:border-amber-500/20">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                                        <span className="text-[9px] uppercase tracking-wider font-extrabold text-amber-600 dark:text-amber-400">Esperando Asesor</span>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                                        <span className="text-[9px] uppercase tracking-wider font-extrabold text-muted-foreground">Bot Activo</span>
                                                    </div>
                                                )}
                                            </div>
                                            {!conv.wa_id.includes('web') && displayName !== conv.wa_id.split('@')[0] && (
                                                <span className="text-[9px] text-muted-foreground font-medium">
                                                    {conv.wa_id.split('@')[0]}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
