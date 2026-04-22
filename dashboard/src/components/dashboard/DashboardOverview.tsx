'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar
} from 'recharts';

interface UrgentConv {
  id: string;
  wa_id: string;
  updated_at: string;
  studentName?: string;
  lastMessage?: string;
}

export default function DashboardOverview() {
  const [loading, setLoading] = useState(true);
  
  // KPIs
  const [studentCount, setStudentCount] = useState(0);
  const [convCount, setConvCount] = useState(0);
  const [supportCount, setSupportCount] = useState(0);
  const [msgToday, setMsgToday] = useState(0);
  
  // Charts
  const [dailyMessages, setDailyMessages] = useState<any[]>([]);
  const [senderDistribution, setSenderDistribution] = useState<any[]>([]);
  const [hourlyActivity, setHourlyActivity] = useState<any[]>([]);
  
  // Urgent
  const [urgentConvs, setUrgentConvs] = useState<UrgentConv[]>([]);
  
  // Recent
  const [recentActivity, setRecentActivity] = useState<any[]>([]);

  useEffect(() => {
    fetchData();

    // Real-time: refrescar cuando cambien conversaciones
    const sub = supabase.channel('dashboard-overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => fetchData())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => fetchData())
      .subscribe();

    return () => { supabase.removeChannel(sub); };
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      // === KPIs ===
      const [studentsRes, convsRes, supportRes] = await Promise.all([
        supabase.from('students').select('*', { count: 'exact', head: true }),
        supabase.from('conversations').select('*', { count: 'exact', head: true }),
        supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('status', 'human_active'),
      ]);
      setStudentCount(studentsRes.count || 0);
      setConvCount(convsRes.count || 0);
      setSupportCount(supportRes.count || 0);

      // Mensajes hoy
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { count: todayCount } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', todayStart.toISOString());
      setMsgToday(todayCount || 0);

      // === GRÁFICO 1: Mensajes por día (últimos 7 días) ===
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const { data: weekMsgs } = await supabase
        .from('messages')
        .select('created_at, sender_type')
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: true });

      if (weekMsgs) {
        const dayMap: Record<string, { user: number; bot: number; dashboard: number }> = {};
        const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        
        // Inicializar últimos 7 días
        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const key = d.toISOString().split('T')[0];
          dayMap[key] = { user: 0, bot: 0, dashboard: 0 };
        }

        weekMsgs.forEach(m => {
          const day = m.created_at.split('T')[0];
          if (dayMap[day]) {
            if (m.sender_type === 'user') dayMap[day].user++;
            else if (m.sender_type === 'bot') dayMap[day].bot++;
            else if (m.sender_type === 'dashboard') dayMap[day].dashboard++;
          }
        });

        setDailyMessages(Object.entries(dayMap).map(([date, counts]) => {
          const d = new Date(date + 'T12:00:00');
          return {
            name: dayNames[d.getDay()],
            Usuarios: counts.user,
            Bot: counts.bot,
            Humano: counts.dashboard,
          };
        }));
      }

      // === GRÁFICO 2: Distribución por tipo de remitente ===
      const { data: allMsgs } = await supabase
        .from('messages')
        .select('sender_type')
        .gte('created_at', sevenDaysAgo.toISOString());

      if (allMsgs) {
        const dist: Record<string, number> = { user: 0, bot: 0, dashboard: 0 };
        allMsgs.forEach(m => { if (dist[m.sender_type] !== undefined) dist[m.sender_type]++; });
        setSenderDistribution([
          { name: 'Usuarios', value: dist.user, color: '#10b981' },
          { name: 'Bot IA', value: dist.bot, color: '#3b82f6' },
          { name: 'Humano', value: dist.dashboard, color: '#8b5cf6' },
        ]);
      }

      // === GRÁFICO 3: Actividad por hora (hoy) ===
      const { data: todayMsgs } = await supabase
        .from('messages')
        .select('created_at')
        .gte('created_at', todayStart.toISOString());

      if (todayMsgs) {
        const hours: number[] = new Array(24).fill(0);
        todayMsgs.forEach(m => {
          const h = new Date(m.created_at).getHours();
          hours[h]++;
        });
        setHourlyActivity(hours.map((count, i) => ({
          hora: `${i.toString().padStart(2, '0')}h`,
          mensajes: count,
        })));
      }

      // === ATENCIÓN URGENTE ===
      const { data: urgentData } = await supabase
        .from('conversations')
        .select('id, wa_id, updated_at')
        .eq('status', 'human_active')
        .order('updated_at', { ascending: false });

      if (urgentData && urgentData.length > 0) {
        // Obtener nombres de estudiantes
        const { data: students } = await supabase.from('students').select('wa_id, full_name');
        const studentMap: Record<string, string> = {};
        students?.forEach(s => { studentMap[s.wa_id] = s.full_name; });

        // Obtener último mensaje de cada conversación urgente
        const waIds = urgentData.map(c => c.wa_id);
        const { data: lastMsgs } = await supabase
          .from('messages')
          .select('wa_id, text, sender_type')
          .in('wa_id', waIds)
          .order('created_at', { ascending: false });

        const lastMsgMap: Record<string, string> = {};
        lastMsgs?.forEach(m => {
          if (!lastMsgMap[m.wa_id]) {
            lastMsgMap[m.wa_id] = `${m.sender_type === 'user' ? '' : m.sender_type === 'bot' ? 'Bot: ' : 'Tú: '}${m.text?.substring(0, 50)}`;
          }
        });

        setUrgentConvs(urgentData.map(c => ({
          ...c,
          studentName: studentMap[c.wa_id] || c.wa_id.split('@')[0],
          lastMessage: lastMsgMap[c.wa_id] || 'Sin mensajes',
        })));
      } else {
        setUrgentConvs([]);
      }

      // === ACTIVIDAD RECIENTE ===
      const { data: recentMsgs } = await supabase
        .from('messages')
        .select('sender_type, text, created_at, wa_id')
        .order('created_at', { ascending: false })
        .limit(8);
      setRecentActivity(recentMsgs || []);

    } catch (error) {
      console.error('Error in dashboard fetch:', error);
    } finally {
      setLoading(false);
    }
  }

  const timeAgo = (dateStr: string) => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Ahora';
    if (mins < 60) return `Hace ${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `Hace ${hrs}h`;
    return `Hace ${Math.floor(hrs / 24)}d`;
  };

  const COLORS = ['#10b981', '#3b82f6', '#8b5cf6'];

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500 overflow-y-auto max-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight font-outfit">Panel de Control</h2>
          <p className="text-slate-400 text-sm mt-1">Analítica en tiempo real de tu bot de WhatsApp</p>
        </div>
        <button 
          onClick={() => fetchData()} 
          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
          Actualizar
        </button>
      </div>

      {/* ===== ALERTA URGENTE ===== */}
      {urgentConvs.length > 0 && (
        <div className="bg-gradient-to-r from-rose-50 via-orange-50 to-amber-50 border border-rose-200 rounded-3xl p-6 shadow-sm animate-in slide-in-from-top-2 duration-500">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-rose-500 rounded-2xl flex items-center justify-center shadow-lg shadow-rose-500/30 animate-pulse">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
            <div>
              <h3 className="font-black text-rose-800 text-lg tracking-tight">Atención Urgente</h3>
              <p className="text-rose-600/70 text-xs font-medium">{urgentConvs.length} {urgentConvs.length === 1 ? 'persona espera' : 'personas esperan'} respuesta humana</p>
            </div>
          </div>
          <div className="space-y-2">
            {urgentConvs.map(conv => (
              <div key={conv.id} className="flex items-center justify-between bg-white/80 backdrop-blur-sm rounded-2xl px-5 py-3.5 border border-rose-100 hover:shadow-md transition-all group">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-orange-500/20 shrink-0">
                    {conv.studentName?.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-slate-800 truncate">{conv.studentName}</p>
                    <p className="text-[11px] text-slate-400 truncate">{conv.lastMessage}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[10px] text-rose-500 font-bold">{timeAgo(conv.updated_at)}</span>
                  <span className="w-2 h-2 bg-rose-500 rounded-full animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== KPI CARDS ===== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        {[
          { label: 'Estudiantes', value: studentCount, icon: '👥', gradient: 'from-emerald-500 to-teal-600', shadow: 'shadow-emerald-500/20' },
          { label: 'Conversaciones', value: convCount, icon: '💬', gradient: 'from-blue-500 to-indigo-600', shadow: 'shadow-blue-500/20' },
          { label: 'Mensajes Hoy', value: msgToday, icon: '📨', gradient: 'from-violet-500 to-purple-600', shadow: 'shadow-violet-500/20' },
          { label: 'Soporte Activo', value: supportCount, icon: '🚨', gradient: 'from-rose-500 to-pink-600', shadow: 'shadow-rose-500/20' },
        ].map((kpi, idx) => (
          <div key={idx} className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 group">
            <div className="flex items-center justify-between mb-3">
              <div className={`bg-gradient-to-br ${kpi.gradient} w-11 h-11 rounded-2xl flex items-center justify-center text-lg shadow-lg ${kpi.shadow} group-hover:scale-110 transition-transform`}>
                {kpi.icon}
              </div>
              <span className="text-[9px] font-black text-emerald-500 bg-emerald-50 px-2 py-1 rounded-lg uppercase tracking-wider border border-emerald-100">Live</span>
            </div>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{kpi.label}</p>
            <h3 className="text-3xl font-black text-slate-900 mt-1 tabular-nums">{loading ? '—' : kpi.value}</h3>
          </div>
        ))}
      </div>

      {/* ===== GRÁFICOS ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Gráfico 1: Mensajes por día */}
        <div className="lg:col-span-2 bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Volumen de Mensajes</h3>
              <p className="text-[10px] text-slate-400 font-medium mt-0.5">Últimos 7 días</p>
            </div>
            <div className="flex items-center gap-4 text-[10px] font-bold">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Usuarios</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Bot</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-violet-500" /> Humano</span>
            </div>
          </div>
          {dailyMessages.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={dailyMessages}>
                <defs>
                  <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorBot" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorHuman" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 700 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#cbd5e1' }} width={30} />
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 10px 30px rgba(0,0,0,0.08)', fontSize: '12px', fontWeight: 600 }}
                  labelStyle={{ fontWeight: 800, color: '#1e293b' }}
                />
                <Area type="monotone" dataKey="Usuarios" stroke="#10b981" strokeWidth={2.5} fill="url(#colorUsers)" />
                <Area type="monotone" dataKey="Bot" stroke="#3b82f6" strokeWidth={2.5} fill="url(#colorBot)" />
                <Area type="monotone" dataKey="Humano" stroke="#8b5cf6" strokeWidth={2.5} fill="url(#colorHuman)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-slate-300 text-sm font-medium">
              Esperando datos de mensajes...
            </div>
          )}
        </div>

        {/* Gráfico 2: Distribución por tipo */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
          <h3 className="font-bold text-slate-900 text-sm mb-1">Distribución</h3>
          <p className="text-[10px] text-slate-400 font-medium mb-4">Quién responde más</p>
          {senderDistribution.some(d => d.value > 0) ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={senderDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={4}
                    dataKey="value"
                    stroke="none"
                  >
                    {senderDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '12px', fontWeight: 600 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 mt-2">
                {senderDistribution.map((item, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-xs font-semibold text-slate-600">{item.name}</span>
                    </div>
                    <span className="text-xs font-black text-slate-900 tabular-nums">{item.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-slate-300 text-sm font-medium">
              Sin datos aún
            </div>
          )}
        </div>
      </div>

      {/* ===== FILA 2: Actividad por hora + Actividad Reciente ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Gráfico 3: Horario pico */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
          <div className="mb-4">
            <h3 className="font-bold text-slate-900 text-sm">Horas Pico</h3>
            <p className="text-[10px] text-slate-400 font-medium mt-0.5">Actividad de mensajes por hora (hoy)</p>
          </div>
          {hourlyActivity.some(h => h.mensajes > 0) ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={hourlyActivity}>
                <XAxis 
                  dataKey="hora" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 9, fill: '#94a3b8', fontWeight: 600 }}
                  interval={2}
                />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#cbd5e1' }} width={25} />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '12px', fontWeight: 600 }}
                  labelStyle={{ fontWeight: 800, color: '#1e293b' }}
                />
                <Bar dataKey="mensajes" fill="#6366f1" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-slate-300 text-sm font-medium">
              Sin actividad hoy
            </div>
          )}
        </div>

        {/* Actividad Reciente */}
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-5 border-b border-slate-50 bg-slate-50/50">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              Actividad Reciente
            </h3>
          </div>
          <div className="divide-y divide-slate-50 max-h-[260px] overflow-y-auto">
            {loading ? (
              Array(4).fill(0).map((_, i) => (
                <div key={i} className="px-5 py-3.5 animate-pulse flex items-center gap-3">
                  <div className="w-8 h-8 bg-slate-100 rounded-xl" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-slate-100 rounded w-3/4" />
                    <div className="h-2 bg-slate-50 rounded w-1/2" />
                  </div>
                </div>
              ))
            ) : recentActivity.length === 0 ? (
              <div className="p-8 text-center text-slate-300 text-sm">Sin actividad reciente</div>
            ) : (
              recentActivity.map((msg, i) => (
                <div key={i} className="px-5 py-3 flex items-center gap-3 hover:bg-slate-50/50 transition-colors">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-white text-[10px] font-black shrink-0 ${
                    msg.sender_type === 'bot' ? 'bg-blue-500' : 
                    msg.sender_type === 'user' ? 'bg-emerald-500' : 
                    'bg-violet-500'
                  }`}>
                    {msg.sender_type === 'bot' ? 'IA' : msg.sender_type === 'user' ? 'US' : 'TÚ'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-700 truncate font-medium">{msg.text || 'Multimedia'}</p>
                    <p className="text-[10px] text-slate-400">{timeAgo(msg.created_at)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
