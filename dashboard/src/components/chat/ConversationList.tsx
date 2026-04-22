'use client';

import React from 'react';

interface ConversationListProps {
    conversations: any[];
    students: any[];
    activeId: string | undefined;
    filterMode: 'all' | 'support';
    onFilterChange: (mode: 'all' | 'support') => void;
    lastMessages: Record<string, any>;
    onSelect: (conv: any) => void;
}

export function ConversationList({ conversations, students, activeId, filterMode, onFilterChange, lastMessages, onSelect }: ConversationListProps) {
    const getStudentName = (waId: string) => {
        if (waId.includes('web')) return 'Visitante Web';
        const student = students.find(s => s.wa_id === waId);
        return student?.full_name || waId.split('@')[0];
    };

    const filteredConversations = conversations.filter(conv => {
        if (filterMode === 'support') return conv.status === 'human_active';
        return true;
    });

    const supportCount = conversations.filter(c => c.status === 'human_active').length;

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

    return (
        <div className="flex-1 overflow-hidden flex flex-col">
            {/* Filter Tabs */}
            <div className="flex p-2 bg-slate-50 mx-4 my-3 rounded-xl border border-slate-100">
                <button 
                    onClick={() => onFilterChange('all')}
                    className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${filterMode === 'all' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    Todos ({conversations.length})
                </button>
                <button 
                    onClick={() => onFilterChange('support')}
                    className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-2 ${filterMode === 'support' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    Apoyo Humano
                    {supportCount > 0 && (
                        <span className="min-w-[18px] h-[18px] bg-rose-500 rounded-full flex items-center justify-center text-[9px] text-white font-black animate-pulse px-1">
                            {supportCount}
                        </span>
                    )}
                </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {filteredConversations.length === 0 ? (
                    <div className="p-10 text-center space-y-3">
                        <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-slate-200">
                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        </div>
                        <p className="text-slate-400 text-sm font-bold">
                            {filterMode === 'support' ? 'Sin solicitudes de apoyo' : 'No hay conversaciones'}
                        </p>
                        <p className="text-slate-300 text-[10px] uppercase font-bold tracking-tighter">
                            {filterMode === 'support' ? 'Todas las conversaciones están siendo atendidas por el bot' : 'Esperando mensajes de WhatsApp...'}
                        </p>
                    </div>
                ) : (
                    filteredConversations.map((conv) => {
                        const isActive = activeId === conv.id;
                        const isHuman = conv.status === 'human_active';
                        const displayName = getStudentName(conv.wa_id);
                        const lastMsg = lastMessages[conv.wa_id];
                        
                        return (
                            <div 
                                key={conv.id} 
                                onClick={() => onSelect(conv)}
                                className={`px-4 py-4 border-b border-gray-50 cursor-pointer transition-all duration-300 hover:bg-white hover:shadow-md relative group ${isActive ? 'bg-white shadow-sm ring-1 ring-blue-500/10' : 'bg-transparent'} ${isHuman && !isActive ? 'bg-amber-50/30' : ''}`}
                            >
                                {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-600 rounded-r-full shadow-lg shadow-blue-500/50" />}
                                
                                <div className="flex gap-3 items-start">
                                    <div className="relative shrink-0 flex items-center justify-center mt-0.5">
                                        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-white shadow-lg transition-transform group-hover:scale-105 text-sm ${isHuman ? 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-orange-500/20' : 'bg-gradient-to-br from-blue-500 to-indigo-600 shadow-blue-500/20'}`}>
                                            {displayName.charAt(0).toUpperCase()}
                                        </div>
                                        {/* Source Indicator */}
                                        <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-md border-2 border-white flex items-center justify-center shadow-sm ${conv.wa_id.includes('web') ? 'bg-slate-800' : 'bg-emerald-500'}`}>
                                            {conv.wa_id.includes('web') ? (
                                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                                            ) : (
                                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.334.101 11.893c-.001 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654c1.737.948 3.693 1.447 5.683 1.448h.005c6.579 0 11.94-5.335 11.943-11.893.002-3.176-1.233-6.162-3.473-8.452zM12.045 21.785h-.004c-1.774 0-3.513-.477-5.032-1.378l-.36-.214-3.742.981 1-3.648-.235-.374c-.99-1.574-1.512-3.393-1.511-5.26.002-5.45 4.437-9.884 9.889-9.884 2.64 0 5.122 1.03 6.988 2.898 1.866 1.869 2.893 4.352 2.892 6.993-.003 5.45-4.437 9.886-9.885 9.886z"/></svg>
                                            )}
                                        </div>
                                    </div>
                                    
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-center mb-1">
                                            <h3 className="font-bold text-sm text-gray-900 truncate tracking-tight">
                                                {displayName}
                                            </h3>
                                            <span className="text-[10px] font-medium text-gray-400 tabular-nums shrink-0 ml-2">
                                                {timeAgo(lastMsg?.created_at || conv.updated_at)}
                                            </span>
                                        </div>
                                        
                                        {/* Último mensaje preview */}
                                        {lastMsg && (
                                            <p className="text-[11px] text-slate-400 truncate mb-1.5 leading-tight">
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
                                                    <div className="flex items-center gap-1 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-100">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                                        <span className="text-[9px] uppercase tracking-wider font-extrabold text-amber-600">Esperando Asesor</span>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                                        <span className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400">Bot Activo</span>
                                                    </div>
                                                )}
                                            </div>
                                            {!conv.wa_id.includes('web') && displayName !== conv.wa_id.split('@')[0] && (
                                                <span className="text-[9px] text-slate-300 font-medium">
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
