'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { adminApi, AdminUser } from '@/lib/adminApi';

export default function UsersManager() {
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ username: '', password: '', full_name: '', role: 'agent' });
    const [saving, setSaving] = useState(false);

    const [editingId, setEditingId] = useState<string | null>(null);
    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await adminApi.listUsers();
            if (res.ok && res.users) setUsers(res.users);
            else setError(res.error || 'No se pudieron cargar los usuarios');
        } catch (e: any) {
            setError(e?.message || 'Error de conexión');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const flash = (msg: string) => { setSuccess(msg); setError(''); setTimeout(() => setSuccess(''), 3000); };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        try {
            const res = await adminApi.createUser(form);
            if (res.ok) {
                flash('Usuario creado correctamente');
                setForm({ username: '', password: '', full_name: '', role: 'agent' });
                setShowForm(false);
                load();
            } else {
                setError(res.error || 'No se pudo crear el usuario');
            }
        } catch (e: any) {
            setError(e?.message || 'Error de conexión');
        } finally {
            setSaving(false);
        }
    };

    const startEdit = (u: AdminUser) => {
        setEditingId(u.id);
        setEditForm({ full_name: u.full_name || '', role: u.role, active: u.active, password: '' });
    };

    const handleUpdate = async (id: string) => {
        setError('');
        try {
            const payload: any = { full_name: editForm.full_name, role: editForm.role, active: editForm.active };
            if (editForm.password.trim()) payload.password = editForm.password.trim();
            const res = await adminApi.updateUser(id, payload);
            if (res.ok) { flash('Usuario actualizado'); setEditingId(null); load(); }
            else setError(res.error || 'No se pudo actualizar');
        } catch (e: any) {
            setError(e?.message || 'Error de conexión');
        }
    };

    const handleDelete = async (u: AdminUser) => {
        if (!confirm('¿Eliminar al usuario "' + u.username + '"? Esta acción no se puede deshacer.')) return;
        setError('');
        try {
            const res = await adminApi.deleteUser(u.id);
            if (res.ok) { flash('Usuario eliminado'); load(); }
            else setError(res.error || 'No se pudo eliminar');
        } catch (e: any) {
            setError(e?.message || 'Error de conexión');
        }
    };

    const toggleActive = async (u: AdminUser) => {
        setError('');
        try {
            const res = await adminApi.updateUser(u.id, { active: !u.active });
            if (res.ok) { flash(u.active ? 'Cuenta desactivada' : 'Cuenta activada'); load(); }
            else setError(res.error || 'No se pudo cambiar el estado');
        } catch (e: any) {
            setError(e?.message || 'Error de conexión');
        }
    };

    const roleBadge = (role: string) => (
        <span className={'px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border ' + (role === 'superadmin'
            ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
            : 'bg-primary/10 text-primary border-primary/20')}>
            {role === 'superadmin' ? 'Super Admin' : 'Agente'}
        </span>
    );


    const [editForm, setEditForm] = useState({ full_name: '', role: 'agent', active: true, password: '' });
    return (
        <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-black text-foreground font-outfit tracking-tight">Gestión de Cuentas</h1>
                    <p className="text-muted-foreground mt-2">Crea y administra los agentes que responden mensajes.</p>
                </div>
                <button
                    onClick={() => setShowForm(!showForm)}
                    className="px-6 py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm shadow-lg shadow-primary/20 hover:opacity-90 transition-all"
                >
                    {showForm ? 'Cancelar' : '+ Nuevo usuario'}
                </button>
            </div>

            {error && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-500 px-4 py-3 rounded-xl text-sm font-medium">{error}</div>
            )}
            {success && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 px-4 py-3 rounded-xl text-sm font-medium">{success}</div>
            )}

            {showForm && (
                <form onSubmit={handleCreate} className="bg-card border border-border rounded-2xl p-6 shadow-lg space-y-4">
                    <h3 className="font-bold text-foreground">Crear nueva cuenta</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Usuario</label>
                            <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
                                className="w-full px-4 py-3 bg-secondary border border-border rounded-xl text-sm text-foreground focus:ring-2 focus:ring-primary/20 outline-none" required />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Contraseña (mín. 6)</label>
                            <input type="text" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                                className="w-full px-4 py-3 bg-secondary border border-border rounded-xl text-sm text-foreground focus:ring-2 focus:ring-primary/20 outline-none" required />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Nombre completo</label>
                            <input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })}
                                className="w-full px-4 py-3 bg-secondary border border-border rounded-xl text-sm text-foreground focus:ring-2 focus:ring-primary/20 outline-none" />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Rol</label>
                            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
                                className="w-full px-4 py-3 bg-secondary border border-border rounded-xl text-sm text-foreground focus:ring-2 focus:ring-primary/20 outline-none">
                                <option value="agent">Agente</option>
                                <option value="superadmin">Super Admin</option>
                            </select>
                        </div>
                    </div>
                    <button type="submit" disabled={saving}
                        className="px-6 py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm shadow-lg disabled:opacity-50">
                        {saving ? 'Creando...' : 'Crear cuenta'}
                    </button>
                </form>
            )}


            <div className="bg-card border border-border rounded-2xl shadow-lg overflow-hidden">
                {loading ? (
                    <div className="flex justify-center p-12">
                        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                    </div>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-left text-xs font-bold text-muted-foreground uppercase tracking-wider">
                                <th className="px-6 py-4">Usuario</th>
                                <th className="px-6 py-4">Nombre</th>
                                <th className="px-6 py-4">Rol</th>
                                <th className="px-6 py-4">Estado</th>
                                <th className="px-6 py-4">Último acceso</th>
                                <th className="px-6 py-4 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(u => (
                                <tr key={u.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                                    {editingId === u.id ? (
                                        <>
                                            <td className="px-6 py-4 font-bold text-foreground">{u.username}</td>
                                            <td className="px-6 py-4">
                                                <input value={editForm.full_name} onChange={e => setEditForm({ ...editForm, full_name: e.target.value })}
                                                    className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm outline-none" />
                                            </td>
                                            <td className="px-6 py-4">
                                                <select value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                                                    className="px-3 py-2 bg-secondary border border-border rounded-lg text-sm outline-none">
                                                    <option value="agent">Agente</option>
                                                    <option value="superadmin">Super Admin</option>
                                                </select>
                                            </td>
                                            <td className="px-6 py-4">
                                                <label className="flex items-center gap-2 text-sm">
                                                    <input type="checkbox" checked={editForm.active} onChange={e => setEditForm({ ...editForm, active: e.target.checked })} />
                                                    Activo
                                                </label>
                                            </td>
                                            <td className="px-6 py-4">
                                                <input type="text" placeholder="Nueva contraseña" value={editForm.password} onChange={e => setEditForm({ ...editForm, password: e.target.value })}
                                                    className="w-40 px-3 py-2 bg-secondary border border-border rounded-lg text-sm outline-none" />
                                            </td>
                                            <td className="px-6 py-4 text-right space-x-2">
                                                <button onClick={() => handleUpdate(u.id)} className="px-3 py-1.5 bg-emerald-500/10 text-emerald-500 rounded-lg text-xs font-bold hover:bg-emerald-500/20">Guardar</button>
                                                <button onClick={() => setEditingId(null)} className="px-3 py-1.5 bg-secondary text-muted-foreground rounded-lg text-xs font-bold hover:bg-secondary/70">Cancelar</button>
                                            </td>
                                        </>
                                    ) : (

                                        <>
                                            <td className="px-6 py-4 font-bold text-foreground">{u.username}</td>
                                            <td className="px-6 py-4 text-muted-foreground">{u.full_name || '—'}</td>
                                            <td className="px-6 py-4">{roleBadge(u.role)}</td>
                                            <td className="px-6 py-4">
                                                <button onClick={() => toggleActive(u)}
                                                    className={'px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border ' + (u.active
                                                        ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                                                        : 'bg-rose-500/10 text-rose-500 border-rose-500/20')}>
                                                    {u.active ? 'Activo' : 'Inactivo'}
                                                </button>
                                            </td>
                                            <td className="px-6 py-4 text-muted-foreground text-xs">
                                                {u.last_login_at ? new Date(u.last_login_at).toLocaleString('es-PE') : 'Nunca'}
                                            </td>
                                            <td className="px-6 py-4 text-right space-x-2">
                                                <button onClick={() => startEdit(u)} className="px-3 py-1.5 bg-primary/10 text-primary rounded-lg text-xs font-bold hover:bg-primary/20">Editar</button>
                                                <button onClick={() => handleDelete(u)} className="px-3 py-1.5 bg-rose-500/10 text-rose-500 rounded-lg text-xs font-bold hover:bg-rose-500/20">Eliminar</button>
                                            </td>
                                        </>
                                    )}
                                </tr>
                            ))}
                            {users.length === 0 && (
                                <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No hay usuarios registrados.</td></tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

