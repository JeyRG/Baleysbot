'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

interface MessageListProps {
    conversation: any;
    students: any[];
}

const QUICK_REPLIES = [
    'Te envío el brochure en un momento 📄',
    'Un asesor te contactará en breve 👋',
    'Gracias por tu interés en nuestra universidad 🎓',
    '¿Podrías indicarme tu nombre completo?',
    '¿En qué maestría estás interesado/a?',
    'Te comparto el enlace de inscripción 📝',
];

const PAGE_SIZE = 50;

export function MessageList({ conversation, students }: MessageListProps) {
    const [messages, setMessages] = useState<any[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [isHumanMode, setIsHumanMode] = useState(conversation.status === 'human_active');
    const [uploading, setUploading] = useState(false);
    const [showContactInfo, setShowContactInfo] = useState(false);
    const [showQuickReplies, setShowQuickReplies] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    // Infinite scroll state
    const [hasMore, setHasMore] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [initialLoad, setInitialLoad] = useState(true);

    const endRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const student = students.find(s => s.wa_id === conversation.wa_id);
    const displayName = student?.full_name || (conversation.wa_id.includes('web') ? 'Visitante Web' : conversation.wa_id.split('@')[0]);
    const phoneNumber = conversation.wa_id.split('@')[0];

    // Fetch initial messages (latest PAGE_SIZE)
    const fetchMessages = useCallback(async () => {
        setInitialLoad(true);
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('wa_id', conversation.wa_id)
            .order('created_at', { ascending: false })
            .limit(PAGE_SIZE);

        if (data && !error) {
            const sorted = data.reverse();
            setMessages(sorted);
            setHasMore(data.length === PAGE_SIZE);
        }
        setInitialLoad(false);
    }, [conversation.wa_id]);

    // Load older messages (infinite scroll)
    const loadOlderMessages = useCallback(async () => {
        if (loadingMore || !hasMore || messages.length === 0) return;

        setLoadingMore(true);
        const oldestMsg = messages[0];

        const { data } = await supabase
            .from('messages')
            .select('*')
            .eq('wa_id', conversation.wa_id)
            .lt('created_at', oldestMsg.created_at)
            .order('created_at', { ascending: false })
            .limit(PAGE_SIZE);

        if (data && data.length > 0) {
            const container = scrollContainerRef.current;
            const prevScrollHeight = container?.scrollHeight || 0;

            setMessages(prev => [...data.reverse(), ...prev]);
            setHasMore(data.length === PAGE_SIZE);

            // Maintain scroll position after prepending
            requestAnimationFrame(() => {
                if (container) {
                    const newScrollHeight = container.scrollHeight;
                    container.scrollTop = newScrollHeight - prevScrollHeight;
                }
            });
        } else {
            setHasMore(false);
        }
        setLoadingMore(false);
    }, [loadingMore, hasMore, messages, conversation.wa_id]);

    // Handle scroll to load more
    const handleScroll = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) return;
        if (container.scrollTop < 100 && hasMore && !loadingMore) {
            loadOlderMessages();
        }
    }, [hasMore, loadingMore, loadOlderMessages]);

    useEffect(() => {
        setIsHumanMode(conversation.status === 'human_active');
        fetchMessages();

        const sub = supabase.channel(`chat:${conversation.wa_id}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `wa_id=eq.${conversation.wa_id}`
            }, (payload) => {
                setMessages(prev => [...prev, payload.new]);
                setIsTyping(false);
            })
            .on('postgres_changes', {
                event: 'DELETE',
                schema: 'public',
                table: 'messages'
            }, (payload) => {
                setMessages(prev => prev.filter(m => m.id !== payload.old.id));
            })
            .subscribe();

        return () => { supabase.removeChannel(sub); };
    }, [conversation.wa_id, conversation.status, fetchMessages]);

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        if (!initialLoad) {
            endRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages.length, initialLoad]);

    // Scroll to bottom on first load
    useEffect(() => {
        if (!initialLoad && messages.length > 0) {
            endRef.current?.scrollIntoView({ behavior: 'auto' });
        }
    }, [initialLoad]);

    const sendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newMessage.trim()) return;

        setIsTyping(true);
        const { error } = await supabase.from('messages').insert({
            wa_id: conversation.wa_id,
            text: newMessage,
            sender_type: 'dashboard'
        });

        if (!error) setNewMessage('');
        setTimeout(() => setIsTyping(false), 3000);
    };

    const sendQuickReply = async (text: string) => {
        setShowQuickReplies(false);
        const { error } = await supabase.from('messages').insert({
            wa_id: conversation.wa_id,
            text,
            sender_type: 'dashboard'
        });
        if (error) console.error('Error sending quick reply:', error);
    };

    const deleteMessage = async (id: string) => {
        if (!confirm('¿Eliminar este mensaje?')) return;
        const { error } = await supabase.from('messages').delete().eq('id', id);
        if (error) console.error('Error deleting message:', error);
    };

    const toggleHandoff = async () => {
        const newStatus = !isHumanMode;
        const { error } = await supabase
            .from('conversations')
            .update({ status: newStatus ? 'human_active' : 'bot' })
            .eq('id', conversation.id);

        if (!error) setIsHumanMode(newStatus);
    };

    const resolveQuery = async () => {
        if (!confirm('¿Marcar consulta como resuelta y volver a IA?')) return;
        
        // Enviar mensaje de cierre
        const { error: msgError } = await supabase.from('messages').insert({
            wa_id: conversation.wa_id,
            text: '✅ Tu consulta ha sido resuelta por un asesor. Si tienes más dudas en el futuro, no dudes en escribirnos.',
            sender_type: 'dashboard'
        });
        
        // Volver a modo bot
        if (!msgError) {
            const { error } = await supabase
                .from('conversations')
                .update({ status: 'bot' })
                .eq('id', conversation.id);
            if (!error) setIsHumanMode(false);
        }
    };


    const processFile = async (file: File) => {
        setUploading(true);
        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${Math.random()}.${fileExt}`;
            const filePath = `${conversation.wa_id}/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('chat-media')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('chat-media')
                .getPublicUrl(filePath);

            await supabase.from('messages').insert({
                wa_id: conversation.wa_id,
                text: `Archivo enviado: ${file.name}`,
                media_url: publicUrl,
                sender_type: 'dashboard'
            });
        } catch (error: any) {
            alert('Error al subir: ' + error.message);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        await processFile(file);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (!file) return;
        
        // Validar que sea imagen o pdf
        if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
            alert('Solo se permiten imágenes o PDFs');
            return;
        }

        await processFile(file);
    };

    // Date separator helpers
    const formatDateSeparator = (dateStr: string): string => {
        const date = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) return 'Hoy';
        if (date.toDateString() === yesterday.toDateString()) return 'Ayer';
        return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    };

    const shouldShowDateSeparator = (msg: any, prevMsg: any): boolean => {
        if (!prevMsg) return true;
        const d1 = new Date(msg.created_at).toDateString();
        const d2 = new Date(prevMsg.created_at).toDateString();
        return d1 !== d2;
    };

    return (
        <div 
            className="flex flex-col h-full relative"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Drag Overlay */}
            {isDragging && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-xl">
                    <div className="text-center animate-in zoom-in duration-200 pointer-events-none">
                        <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 text-primary">
                            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                        </div>
                        <h3 className="text-xl font-bold text-foreground">Suelta tu archivo aquí</h3>
                        <p className="text-sm text-muted-foreground mt-2">Imágenes o PDFs serán subidos automáticamente</p>
                    </div>
                </div>
            )}
            {/* Header */}
            <div className="px-6 py-4 bg-card/80 backdrop-blur-md border-b border-border flex justify-between items-center z-20 sticky top-0">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center font-bold text-foreground shadow-sm border border-border">
                        {displayName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <button
                            onClick={() => setShowContactInfo(!showContactInfo)}
                            className="font-bold text-foreground leading-tight hover:text-primary transition-colors flex items-center gap-1"
                        >
                            {displayName}
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${showContactInfo ? 'rotate-180' : ''}`}>
                                <path d="m6 9 6 6 6-6" />
                            </svg>
                        </button>
                        <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${isHumanMode ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`} />
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                {isHumanMode ? 'Modo Manual' : 'IA Respondiendo'}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {isHumanMode && (
                        <button
                            onClick={resolveQuery}
                            className="px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-300 shadow-sm border bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700 shadow-emerald-600/20 hover:-translate-y-0.5"
                        >
                            ✓ Consulta Resuelta
                        </button>
                    )}
                    <button
                        onClick={toggleHandoff}
                        className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-300 shadow-sm border ${isHumanMode ? 'bg-card text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-500/20 dark:hover:bg-rose-500/10' : 'bg-slate-900 dark:bg-primary text-white border-slate-900 dark:border-primary hover:bg-slate-800 dark:hover:bg-primary/90 shadow-slate-900/10 hover:-translate-y-0.5'}`}
                    >
                        {isHumanMode ? 'Volver a IA (Sin msj)' : 'Intervenir Chat'}
                    </button>
                </div>
            </div>

            {/* Contact Info Panel */}
            {showContactInfo && (
                <div className="px-6 py-4 bg-secondary/50 border-b border-border animate-in slide-in-from-top-2 duration-300">
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Nombre</p>
                            <p className="text-sm font-semibold text-foreground">{displayName}</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Teléfono</p>
                            <p className="text-sm font-semibold text-foreground">{phoneNumber}</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Primer contacto</p>
                            <p className="text-sm font-semibold text-foreground">
                                {new Date(conversation.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                        </div>
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Estado</p>
                            <p className={`text-sm font-semibold ${isHumanMode ? 'text-amber-500' : 'text-emerald-500'}`}>
                                {isHumanMode ? 'Esperando asesor' : 'Bot activo'}
                            </p>
                        </div>
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Canal</p>
                            <p className="text-sm font-semibold text-foreground">
                                {conversation.wa_id.includes('web') ? '🌐 Web' : '📱 WhatsApp'}
                            </p>
                        </div>
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Total mensajes</p>
                            <p className="text-sm font-semibold text-foreground">{messages.length}{hasMore ? '+' : ''}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Bubble Area */}
            <div
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto p-8 space-y-1 chat-bg-pattern"
            >
                {/* Loading more indicator */}
                {loadingMore && (
                    <div className="flex justify-center py-4">
                        <div className="flex items-center gap-2 px-4 py-2 bg-secondary rounded-full text-xs font-medium text-muted-foreground">
                            <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                            Cargando mensajes anteriores...
                        </div>
                    </div>
                )}

                {!hasMore && messages.length > 0 && (
                    <div className="flex justify-center py-4">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-secondary px-3 py-1 rounded-full">
                            Inicio de la conversación
                        </span>
                    </div>
                )}

                {messages.map((msg, i) => {
                    const prevMsg = i > 0 ? messages[i - 1] : null;
                    const isUser = msg.sender_type === 'user';
                    const isDashboard = msg.sender_type === 'dashboard';
                    const isBot = msg.sender_type === 'bot';

                    return (
                        <div key={msg.id}>
                            {/* Date Separator */}
                            {shouldShowDateSeparator(msg, prevMsg) && (
                                <div className="chat-date-separator">
                                    <span>{formatDateSeparator(msg.created_at)}</span>
                                </div>
                            )}

                            {/* Message Bubble */}
                            <div className={`flex ${isUser ? 'justify-start' : 'justify-end'} mb-3 animate-in fade-in slide-in-from-bottom-1 duration-200 group`}>
                                <div className={`max-w-[75%] rounded-2xl p-4 shadow-sm border ${
                                    isUser ? 'bg-card text-foreground border-border rounded-tl-none' :
                                    isDashboard ? 'bg-blue-600 text-white border-blue-700 rounded-tr-none shadow-blue-600/20' :
                                    'bg-slate-800 text-slate-100 border-slate-700 rounded-tr-none shadow-lg'
                                }`}>
                                    {msg.media_url && (
                                        <div className="mb-3 overflow-hidden rounded-xl border border-white/10">
                                            {msg.media_url.match(/\.(jpeg|jpg|gif|png|webp)/i) || msg.media_url.includes('image') ? (
                                                <img
                                                    src={msg.media_url}
                                                    alt="Media content"
                                                    className="w-full h-auto max-h-80 object-cover hover:scale-105 transition-transform duration-500 cursor-zoom-in"
                                                    onClick={() => window.open(msg.media_url, '_blank')}
                                                />
                                            ) : (
                                                <a
                                                    href={msg.media_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                                                        isUser ? 'bg-secondary border-border hover:bg-muted' : 'bg-white/10 border-white/20 hover:bg-white/20'
                                                    }`}
                                                >
                                                    <div className="w-12 h-12 flex items-center justify-center bg-blue-500 rounded-xl text-white shadow-lg">
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs font-bold truncate">Documento Adjunto</p>
                                                        <p className="text-[10px] opacity-60 font-medium">Click para descargar</p>
                                                    </div>
                                                </a>
                                            )}
                                        </div>
                                    )}
                                    {msg.text && <p className="text-sm leading-relaxed font-medium">{msg.text}</p>}
                                    <div className={`flex items-center justify-between gap-2 mt-2 pt-2 border-t ${isUser ? 'border-border/50 text-muted-foreground' : 'border-white/10 text-white/60'}`}>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[9px] font-bold uppercase tracking-tighter">
                                                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                            <span className="w-1 h-1 rounded-full bg-current opacity-30" />
                                            <span className="text-[9px] font-black uppercase tracking-widest bg-current/10 px-1.5 py-0.5 rounded">
                                                {msg.sender_type === 'user' ? 'usuario' : msg.sender_type === 'bot' ? 'bot' : msg.sender_type === 'dashboard' ? 'tú' : msg.sender_type}
                                            </span>
                                        </div>

                                        <button
                                            onClick={() => deleteMessage(msg.id)}
                                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-rose-500 hover:text-white rounded transition-all duration-200"
                                            title="Eliminar mensaje"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}

                {/* Typing indicator */}
                {isTyping && (
                    <div className="flex justify-end mb-3 animate-in fade-in duration-300">
                        <div className="bg-secondary rounded-2xl rounded-tr-none px-5 py-4 border border-border">
                            <div className="flex gap-1.5">
                                <span className="typing-dot" />
                                <span className="typing-dot" />
                                <span className="typing-dot" />
                            </div>
                        </div>
                    </div>
                )}

                <div ref={endRef} />
            </div>

            {/* Quick Replies Bar */}
            {showQuickReplies && (
                <div className="px-6 py-3 border-t border-border bg-secondary/50 backdrop-blur-sm animate-in slide-in-from-bottom-2 duration-300">
                    <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-1">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground shrink-0 mr-1">Rápidas:</span>
                        {QUICK_REPLIES.map((reply, i) => (
                            <button
                                key={i}
                                onClick={() => sendQuickReply(reply)}
                                className="quick-reply-btn"
                            >
                                {reply}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Input Area */}
            <div className="p-6 bg-card border-t border-border z-10">
                <form onSubmit={sendMessage} className="flex gap-3 items-end">
                    <div className="relative flex-1">
                        <textarea
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    sendMessage(e);
                                }
                            }}
                            placeholder="Escribe un mensaje aquí..."
                            className="w-full bg-secondary border-none rounded-2xl px-6 py-4 text-sm text-foreground focus:ring-2 focus:ring-primary/20 transition-all min-h-[56px] max-h-32 resize-none placeholder:text-muted-foreground"
                        />
                        <div className="absolute right-3 bottom-3 flex items-center gap-1">
                            {/* Quick replies toggle */}
                            <button
                                type="button"
                                onClick={() => setShowQuickReplies(!showQuickReplies)}
                                className={`p-2 rounded-lg transition-colors ${showQuickReplies ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                                title="Respuestas rápidas"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m13 2-2 2.5h3L12 7" /><path d="M10 14v-3" /><path d="M14 14v-3" /><path d="M11 19c-1.7 0-3-1.3-3-3v-2h8v2c0 1.7-1.3 3-3 3Z" /><path d="M12 22v-3" /></svg>
                            </button>
                            {/* File upload */}
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileUpload}
                                className="hidden"
                                accept="image/*,application/pdf"
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                                className={`p-2 rounded-lg hover:bg-secondary transition-colors ${uploading ? 'animate-pulse text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                                title="Adjuntar archivo"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.51a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                            </button>
                        </div>
                    </div>
                    <button
                        type="submit"
                        disabled={!newMessage.trim() || uploading}
                        className="h-14 w-14 flex items-center justify-center bg-primary text-primary-foreground rounded-2xl shadow-lg shadow-primary/20 hover:opacity-90 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:translate-y-0"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="rotate-45 -translate-y-0.5"><line x1="22" y1="2" x2="11" y2="13" /><polyline points="22 2 15 22 11 13 2 9 22 2" /></svg>
                    </button>
                </form>
            </div>
        </div>
    );
}
