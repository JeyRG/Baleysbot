'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

interface MessageListProps {
    conversation: any;
    students: any[];
}

export function MessageList({ conversation, students }: MessageListProps) {
    const [messages, setMessages] = useState<any[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [isHumanMode, setIsHumanMode] = useState(conversation.status === 'human_active');
    const [uploading, setUploading] = useState(false);
    const endRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const displayName = students.find(s => s.wa_id === conversation.wa_id)?.full_name || conversation.wa_id.split('@')[0];


    useEffect(() => {
        setIsHumanMode(conversation.status === 'human_active');
        const fetchMessages = async () => {
            const { data } = await supabase
                .from('messages')
                .select('*')
                .eq('wa_id', conversation.wa_id)
                .order('created_at', { ascending: true });
            if (data) setMessages(data);
        };
        fetchMessages();

        const sub = supabase.channel(`chat:${conversation.wa_id}`)
            .on('postgres_changes', { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'messages',
                filter: `wa_id=eq.${conversation.wa_id}`
            }, (payload) => {
                setMessages(prev => [...prev, payload.new]);
            })
            .on('postgres_changes', {
                event: 'DELETE',
                schema: 'public',
                table: 'messages'
            }, (payload) => {
                setMessages(prev => prev.filter(m => m.id !== payload.old.id));
            })
            .subscribe();

        return () => { supabase.removeChannel(sub) };
    }, [conversation.wa_id, conversation.status]);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const sendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newMessage.trim()) return;

        const { error } = await supabase.from('messages').insert({
            wa_id: conversation.wa_id,
            text: newMessage,
            sender_type: 'dashboard'
        });

        if (!error) setNewMessage('');
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

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

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

    return (
        <div className="flex flex-col h-full relative">
            {/* Header del Chat */}
            <div className="px-6 py-4 bg-white/80 backdrop-blur-md border-b border-gray-100 flex justify-between items-center z-20 sticky top-0">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center font-bold text-gray-700 shadow-sm border border-slate-100">
                        {displayName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                    <h2 className="font-bold text-gray-900 leading-tight">{displayName}</h2>

                    <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${isHumanMode ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`} />
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            {isHumanMode ? 'Modo Manual' : 'IA Respondiendo'}
                        </p>
                    </div>
                    </div>
                </div>
                <button 
                    onClick={toggleHandoff}
                    className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-300 shadow-sm border ${isHumanMode ? 'bg-white text-rose-600 border-rose-100 hover:bg-rose-50 hover:border-rose-200' : 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800 shadow-slate-900/10 hover:-translate-y-0.5'}`}
                >
                    {isHumanMode ? 'Volver a Modo IA' : 'Intervenir Chat'}
                </button>
            </div>

            {/* Bubble Area */}
            <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-opacity-5">
                {messages.map((msg, i) => {
                    const isUser = msg.sender_type === 'user';
                    const isDashboard = msg.sender_type === 'dashboard';
                    const isMobile = msg.sender_type === 'mobile';
                    const isBot = msg.sender_type === 'bot';
                    
                    return (
                        <div key={msg.id} className={`flex ${isUser ? 'justify-start' : 'justify-end'} animate-in fade-in slide-in-from-bottom-2 duration-300 group`}>
                            <div className={`max-w-[80%] rounded-2xl p-4 shadow-sm border ${
                                isUser ? 'bg-white text-slate-800 border-slate-100 rounded-tl-none' : 
                                isDashboard ? 'bg-blue-600 text-white border-blue-700 rounded-tr-none shadow-blue-600/20' : 
                                isMobile ? 'bg-teal-600 text-white border-teal-700 rounded-tr-none shadow-teal-600/20' :
                                'bg-slate-800 text-slate-100 border-slate-700 rounded-tr-none shadow-lg' /* bot */
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
                                                    isUser ? 'bg-slate-50 border-slate-200 hover:bg-slate-100' : 'bg-white/10 border-white/20 hover:bg-white/20'
                                                }`}
                                            >
                                                <div className="w-12 h-12 flex items-center justify-center bg-blue-500 rounded-xl text-white shadow-lg">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
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
                                <div className={`flex items-center justify-between gap-2 mt-2 pt-2 border-t border-current/10 ${isUser ? 'text-gray-400' : 'text-white/60'}`}>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[9px] font-bold uppercase tracking-tighter">
                                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                        <span className="w-1 h-1 rounded-full bg-current opacity-30" />
                                        <span className="text-[9px] font-black uppercase tracking-widest bg-current/10 px-1.5 py-0.5 rounded">
                                            {msg.sender_type}
                                        </span>
                                    </div>
                                    
                                    <button 
                                        onClick={() => deleteMessage(msg.id)}
                                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-rose-500 hover:text-white rounded transition-all duration-200"
                                        title="Eliminar mensaje"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
                <div ref={endRef} />
            </div>

            {/* Input Area */}
            <div className="p-6 bg-white border-t border-gray-100 z-10">
                <form onSubmit={sendMessage} className="flex gap-4 items-end">
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
                            className="w-full bg-slate-50 border-none rounded-2xl px-6 py-4 text-sm focus:ring-2 focus:ring-blue-500/20 transition-all min-h-[56px] max-h-32 resize-none"
                        />
                        <div className="absolute right-4 bottom-4 flex items-center gap-2">
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
                                className={`p-2 rounded-lg hover:bg-slate-200 transition-colors ${uploading ? 'animate-pulse text-blue-500' : 'text-slate-400'}`}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.51a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                            </button>
                        </div>
                    </div>
                    <button
                        type="submit"
                        disabled={!newMessage.trim() || uploading}
                        className="h-14 w-14 flex items-center justify-center bg-blue-600 text-white rounded-2xl shadow-lg shadow-blue-600/20 hover:bg-blue-700 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:translate-y-0"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="rotate-45 -translate-y-0.5"><line x1="22" y1="2" x2="11" y2="13"/><polyline points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    </button>
                </form>
            </div>
        </div>
    );
}
