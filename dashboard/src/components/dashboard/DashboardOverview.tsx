'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar
} from 'recharts';
import {
  Users, MessageSquare, Send, AlertTriangle, CheckCircle2,
  RefreshCw, Clock, ArrowRight, Activity, MessageCircle
} from 'lucide-react';

interface UrgentConv {
  id: string;
  wa_id: string;
  updated_at: string;
  studentName?: string;
  lastMessage?: string;
  [key: string]: any;
}

interface DashboardOverviewProps {
  onSelectConversation?: (conv: any) => void;
}

export default function DashboardOverview({ onSelectConversation }: DashboardOverviewProps) {
  const [loading, setLoading] = useState(true);
  
  // KPIs
  const [studentCount, setStudentCount] = useState(0);
  const [convCount, setConvCount] = useState(0);
  const [supportCount, setSupportCount] = useState(0);
  const [msgToday, setMsgToday] = useState(0);
  const [resolvedToday, setResolvedToday] = useState(0);
  
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

    // Real-time: refrescar cuando cambien conversaciones o mensajes
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

      // Consultas resueltas hoy
      const { count: resolvedCount } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', todayStart.toISOString())
        .eq('sender_type', 'dashboard')
        .ilike('text', '%tu consulta ha sido resuelta%');
      setResolvedToday(resolvedCount || 0);

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
          { name: 'Bot IA', value: dist.bot, color: '#2563eb' },
          { name: 'Operador', value: dist.dashboard, color: '#64748b' },
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
        .select('id, wa_id, updated_at, status, meta, bot_enabled, channel')
        .eq('status', 'human_active')
        .order('updated_at', { ascending: true })
        .limit(5);

      if (urgentData && urgentData.length > 0) {
        const { data: students } = await supabase.from('students').select('wa_id, full_name');
        const studentMap: Record<string, string> = {};
        students?.forEach(s => { studentMap[s.wa_id] = s.full_name; });

        const waIds = urgentData.map(c => c.wa_id);
        const { data: lastMsgs } = await supabase
          .from('messages')
          .select('wa_id, text, sender_type')
          .in('wa_id', waIds)
          .order('created_at', { ascending: false });

        const lastMsgMap: Record<string, string> = {};
        lastMsgs?.forEach(m => {
          if (!lastMsgMap[m.wa_id]) {
            lastMsgMap[m.wa_id] = `${m.sender_type === 'user' ? '' : m.sender_type === 'bot' ? 'Bot: ' : 'Tú: '}${m.text?.substring(0, 60)}`;
          }
        });

        setUrgentConvs(urgentData.slice(0, 5).map(c => ({
          ...c,
          studentName: studentMap[c.wa_id] || (c.meta as any)?.name || c.wa_id.split('@')[0],
          lastMessage: lastMsgMap[c.wa_id] || 'Sin mensajes recientes',
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
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  const COLORS = ['#10b981', '#2563eb', '#64748b'];

  return (
    <div className="p-6 md:p-8 space-y-6 overflow-y-auto max-h-screen">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-foreground tracking-tight">Consola de Control</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Telemetría operativa y atención estudiantil en tiempo real</p>
        </div>
        <button 
          onClick={() => fetchData()} 
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-md text-xs font-medium text-foreground hover:bg-secondary hover:text-foreground transition-colors shadow-sm self-start sm:self-auto cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Sincronizar</span>
        </button>
      </div>

      {/* ===== ALERTA DE ATENCIÓN URGENTE (Crafted / Anti-AI) ===== */}
      {urgentConvs.length > 0 && (
        <div className="border border-rose-500/30 bg-rose-500/5 dark:bg-rose-950/20 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="p-1.5 bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-md">
                <AlertTriangle className="w-4 h-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-rose-900 dark:text-rose-200">
                  Cola de Atención Humana Prioritaria
                </h2>
                <p className="text-[11px] text-rose-700/80 dark:text-rose-400/80">
                  {urgentConvs.length} {urgentConvs.length === 1 ? 'conversación requiere' : 'conversaciones requieren'} intervención inmediata
                </p>
              </div>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-wider font-semibold px-2 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/20">
              Urgente
            </span>
          </div>

          <div className="divide-y divide-rose-500/10 border border-rose-500/20 rounded-md bg-card/60 overflow-hidden">
            {urgentConvs.map(conv => (
              <div 
                key={conv.id} 
                onClick={() => onSelectConversation?.(conv)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectConversation?.(conv); }}
                className="flex items-center justify-between px-3.5 py-2.5 hover:bg-rose-500/5 transition-colors cursor-pointer group text-left"
              >
                <div className="flex items-center gap-3 min-w-0 pr-4">
                  <div className="w-7 h-7 rounded bg-zinc-200 dark:bg-zinc-800 text-foreground text-xs font-mono font-medium flex items-center justify-center shrink-0">
                    {conv.studentName?.charAt(0).toUpperCase() || '?'}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-xs text-foreground truncate group-hover:text-primary transition-colors">
                        {conv.studentName}
                      </p>
                      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded border border-border text-muted-foreground">
                        {conv.wa_id.includes('@web') ? 'WEB' : 'WA'}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{conv.lastMessage}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[10px] font-mono text-rose-600 dark:text-rose-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {timeAgo(conv.updated_at)}
                  </span>
                  <span className="text-[11px] text-foreground font-medium flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                    <span>Atender</span>
                    <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== KPI CARDS (Densa, Modular, High-Craft) ===== */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {[
          { label: 'Estudiantes', value: studentCount, icon: Users, meta: 'Registrados' },
          { label: 'Conversaciones', value: convCount, icon: MessageSquare, meta: 'Histórico' },
          { label: 'Mensajes Hoy', value: msgToday, icon: Send, meta: 'Tráfico día' },
          { label: 'Soporte Activo', value: supportCount, icon: AlertTriangle, meta: 'En espera', alert: supportCount > 0 },
          { label: 'Resueltas Hoy', value: resolvedToday, icon: CheckCircle2, meta: 'Cerradas hoy' },
        ].map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <div 
              key={idx} 
              className={`rounded-lg border bg-card p-4 transition-colors ${
                kpi.alert ? 'border-amber-500/40 bg-amber-500/5' : 'border-border hover:border-zinc-300 dark:hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground">{kpi.label}</span>
                <span className={`p-1.5 rounded-md ${kpi.alert ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-muted text-muted-foreground'}`}>
                  <Icon className="w-3.5 h-3.5" />
                </span>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-2xl font-semibold tracking-tight text-foreground font-mono tabular-nums">
                  {loading ? '—' : kpi.value}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">{kpi.meta}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ===== CHARTS SECTION ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Gráfico 1: Mensajes por día */}
        <div className="lg:col-span-2 rounded-lg border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Volumen de Mensajes</h2>
              <p className="text-[11px] text-muted-foreground">Distribución diaria de los últimos 7 días</p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-medium">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Usuarios</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-600" /> Bot</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-500" /> Operador</span>
            </div>
          </div>

          {dailyMessages.length > 0 ? (
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={dailyMessages}>
                <defs>
                  <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorBot" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#71717a' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#71717a' }} width={25} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    borderRadius: '6px', 
                    border: '1px solid hsl(var(--border))', 
                    fontSize: '12px',
                    color: 'hsl(var(--foreground))'
                  }}
                />
                <Area type="monotone" dataKey="Usuarios" stroke="#10b981" strokeWidth={1.5} fill="url(#colorUsers)" />
                <Area type="monotone" dataKey="Bot" stroke="#2563eb" strokeWidth={1.5} fill="url(#colorBot)" />
                <Area type="monotone" dataKey="Humano" stroke="#64748b" strokeWidth={1.5} fill="transparent" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[210px] flex items-center justify-center text-muted-foreground text-xs font-mono">
              Recopilando telemetría...
            </div>
          )}
        </div>

        {/* Gráfico 2: Distribución por tipo */}
        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Distribución de Respuestas</h2>
            <p className="text-[11px] text-muted-foreground">Proporción por remitente</p>
          </div>

          {senderDistribution.some(d => d.value > 0) ? (
            <>
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie
                    data={senderDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={38}
                    outerRadius={58}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                  >
                    {senderDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      borderRadius: '6px', 
                      border: '1px solid hsl(var(--border))', 
                      fontSize: '12px' 
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 pt-1 border-t border-border">
                {senderDistribution.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-muted-foreground">{item.name}</span>
                    </div>
                    <span className="font-mono font-medium text-foreground tabular-nums">{item.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-muted-foreground text-xs font-mono">
              Sin datos registrados
            </div>
          )}
        </div>
      </div>

      {/* ===== FILA 2: Horarios Pico + Actividad Reciente ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Gráfico 3: Horas Pico */}
        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Horas Pico de Tráfico</h2>
            <p className="text-[11px] text-muted-foreground">Volumen de interacción por hora (hoy)</p>
          </div>
          {hourlyActivity.some(h => h.mensajes > 0) ? (
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={hourlyActivity}>
                <XAxis 
                  dataKey="hora" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 9, fill: '#71717a' }}
                  interval={3}
                />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#71717a' }} width={20} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    borderRadius: '6px', 
                    border: '1px solid hsl(var(--border))', 
                    fontSize: '12px' 
                  }}
                />
                <Bar dataKey="mensajes" fill="#2563eb" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[170px] flex items-center justify-center text-muted-foreground text-xs font-mono">
              Sin mensajes registrados el día de hoy
            </div>
          )}
        </div>

        {/* Actividad Reciente */}
        <div className="rounded-lg border border-border bg-card flex flex-col overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-primary" />
              <span>Actividad Reciente</span>
            </h2>
            <span className="text-[10px] font-mono text-muted-foreground">Últimos eventos</span>
          </div>

          <div className="divide-y divide-border/60 max-h-[220px] overflow-y-auto">
            {loading ? (
              Array(4).fill(0).map((_, i) => (
                <div key={i} className="px-4 py-2.5 animate-pulse flex items-center gap-3">
                  <div className="w-6 h-6 bg-muted rounded" />
                  <div className="flex-1 space-y-1">
                    <div className="h-2.5 bg-muted rounded w-3/4" />
                    <div className="h-2 bg-muted/60 rounded w-1/3" />
                  </div>
                </div>
              ))
            ) : recentActivity.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-xs font-mono">Sin actividad registrada</div>
            ) : (
              recentActivity.map((msg, i) => (
                <div key={i} className="px-4 py-2.5 flex items-center gap-3 hover:bg-secondary/40 transition-colors">
                  <span className={`w-5 h-5 rounded text-[9px] font-mono font-bold flex items-center justify-center shrink-0 ${
                    msg.sender_type === 'bot' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20' : 
                    msg.sender_type === 'user' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' : 
                    'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20'
                  }`}>
                    {msg.sender_type === 'bot' ? 'IA' : msg.sender_type === 'user' ? 'US' : 'OP'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground truncate font-normal">{msg.text || 'Mensaje multimedia'}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{timeAgo(msg.created_at)}</p>
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
