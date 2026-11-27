'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { adminApi, BotSettings } from '@/lib/adminApi';

interface BotSettingsManagerProps {
    onNavigateToTraining?: () => void;
}

type SettingsTab = 'admision' | 'pagos' | 'modalidad' | 'enlaces' | 'mensaje_api';

const DEFAULT_MENSAJE_API = {
    saludo_bienvenida: '🎓 ¡Hola {nombre}! Felicidades.\n*Somos de la Escuela de Posgrado de la UNAC*\n🚀 Ya te encuentras registrado para nuestro programa de *{programa}*.',
    titulo_detalles: '💥 *Detalles de Inscripción ({proceso_actual}):*',
    requisitos_texto: '📝 *REQUISITOS DE INSCRIPCIÓN:*\n1️⃣ Ficha de Postulante y Hoja de Vida llenadas virtualmente en nuestro sistema.\n2️⃣ Copia legible del DNI o Pasaporte.\n3️⃣ Foto actual a color (opcional).\n4️⃣ {documento_grado}\n\n*Nota:* Los grados del extranjero deben estar registrados en SUNEDU.',
    aviso_brochure: '📄 Te adjunto el brochure oficial del programa:',
    aviso_sin_brochure: '📍 Si deseas el brochure de este programa, escríbeme el nombre exacto o solicita un asesor.',
    pasos_inscripcion: '👉 *PASOS PARA FORMALIZAR TU INSCRIPCIÓN:*\n1️⃣ Realiza el pago en {banco} (Cta: {cuenta} / CCI: {cci}).\n2️⃣ Registra tus datos en el portal: {portal_inscripcion}\n3️⃣ Sube tu expediente digital en la plataforma GED: {portal_ged}\n\n¡Muchos éxitos en tu postulación!'
};

export default function BotSettingsManager({ onNavigateToTraining }: BotSettingsManagerProps) {
    const [settings, setSettings] = useState<BotSettings | null>(null);
    const [savedSnapshot, setSavedSnapshot] = useState<string>('');
    const [meta, setMeta] = useState<{ updated_at: string | null; updated_by_name: string | null; source: string } | null>(null);
    const [catalogSummary, setCatalogSummary] = useState<{
        faculties: number;
        maestrias: number;
        doctorados: number;
        especialidades: number;
        total_programs: number;
        with_brochure: number;
    } | null>(null);

    const [activeSection, setActiveSection] = useState<SettingsTab>('admision');
    const [previewMode, setPreviewMode] = useState<'cronograma' | 'api_mensaje'>('cronograma');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncingCatalog, setSyncingCatalog] = useState(false);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);

    const showFeedback = (type: 'success' | 'error' | 'warning', message: string) => {
        setFeedback({ type, message });
        setTimeout(() => setFeedback(null), 5000);
    };

    const normalizeWithDefaults = (raw: any): BotSettings => {
        return {
            ...raw,
            mensaje_api: {
                ...DEFAULT_MENSAJE_API,
                ...(raw?.mensaje_api || {})
            }
        };
    };

    const loadSettings = async () => {
        setLoading(true);
        try {
            const res = await adminApi.getBotSettings();
            if (res?.settings) {
                const normalized = normalizeWithDefaults(res.settings);
                setSettings(normalized);
                setSavedSnapshot(JSON.stringify(normalized));
                setMeta(res.meta || null);
                setCatalogSummary(res.catalog_summary || null);
            }
        } catch (err: any) {
            showFeedback('error', err.message || 'No se pudo cargar la configuración del bot');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadSettings();
    }, []);

    const isDirty = useMemo(() => {
        if (!settings || !savedSnapshot) return false;
        return JSON.stringify(settings) !== savedSnapshot;
    }, [settings, savedSnapshot]);

    const updateField = <K extends keyof BotSettings>(
        section: K,
        field: keyof BotSettings[K],
        value: string | number
    ) => {
        setSettings((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                [section]: {
                    ...prev[section],
                    [field]: value,
                },
            };
        });
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!settings) return;
        setSaving(true);
        try {
            const res = await adminApi.updateBotSettings(settings);
            if (res?.settings) {
                const normalized = normalizeWithDefaults(res.settings);
                setSettings(normalized);
                setSavedSnapshot(JSON.stringify(normalized));
                setMeta(res.meta || null);
            }
            if (res?.warning) {
                showFeedback('warning', `Aplicado en memoria del bot con advertencia de BD: ${res.warning}`);
            } else {
                showFeedback('success', 'Parámetros actualizados. El bot ya responde con la nueva información.');
            }
        } catch (err: any) {
            showFeedback('error', err.message || 'Error al guardar cambios');
        } finally {
            setSaving(false);
        }
    };

    const handleDiscard = () => {
        if (!savedSnapshot) return;
        setSettings(JSON.parse(savedSnapshot));
        showFeedback('warning', 'Cambios locales descartados.');
    };

    const handleSyncCatalog = async () => {
        setSyncingCatalog(true);
        try {
            await adminApi.syncCatalog();
            await loadSettings();
            showFeedback('success', 'Catálogo de programas y facultades recargado desde Supabase.');
        } catch (err: any) {
            showFeedback('error', err.message || 'Error sincronizando catálogo');
        } finally {
            setSyncingCatalog(false);
        }
    };

    if (loading && !settings) {
        return (
            <div className="p-8 max-w-7xl mx-auto space-y-6 animate-pulse">
                <div className="h-8 w-72 bg-secondary rounded-lg" />
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-8 h-[520px] bg-secondary rounded-2xl" />
                    <div className="lg:col-span-4 h-[520px] bg-secondary rounded-2xl" />
                </div>
            </div>
        );
    }

    if (!settings) {
        return (
            <div className="p-8 max-w-3xl mx-auto text-center space-y-4">
                <h2 className="text-xl font-bold text-foreground">No se pudo conectar con el motor del Bot</h2>
                <p className="text-sm text-muted-foreground">Verifica que el servicio de Node.js esté activo en el puerto 3000 y tu sesión esté vigente.</p>
                <button
                    onClick={loadSettings}
                    className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:opacity-90"
                >
                    Reintentar carga
                </button>
            </div>
        );
    }

    return (
        <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
            {/* Banner de estado en vivo */}
            {feedback && (
                <div
                    role="status"
                    aria-live="polite"
                    className={`px-4 py-3 rounded-xl border text-sm font-semibold flex items-center justify-between ${
                        feedback.type === 'success'
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                            : feedback.type === 'warning'
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
                            : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                    }`}
                >
                    <span>{feedback.message}</span>
                    <button
                        type="button"
                        onClick={() => setFeedback(null)}
                        className="text-xs font-bold opacity-75 hover:opacity-100 ml-4"
                        aria-label="Cerrar notificación"
                    >
                        Cerrar
                    </button>
                </div>
            )}

            {/* Encabezado técnico de alta densidad */}
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border">
                <div>
                    <div className="flex items-center gap-2.5">
                        <h1 className="text-2xl font-black text-foreground tracking-tight font-outfit">
                            Parámetros Institucionales del Bot
                        </h1>
                        <span className="px-2.5 py-0.5 rounded-md text-[11px] font-mono font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            {settings.admision.proceso_actual}
                        </span>
                        {isDirty && (
                            <span className="px-2.5 py-0.5 rounded-md text-[11px] font-mono font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                Sin guardar
                            </span>
                        )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                        Edita las fechas de admisión, cuentas bancarias, aranceles y enlaces oficiales que el bot inyecta en sus respuestas automáticas y en el contexto de IA.
                    </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {onNavigateToTraining && (
                        <button
                            type="button"
                            onClick={onNavigateToTraining}
                            className="px-3.5 py-2 bg-secondary border border-border text-foreground rounded-xl text-xs font-bold hover:bg-muted transition-colors focus-visible:ring-2 focus-visible:ring-primary"
                        >
                            Ir a Base RAG / Memoria
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleSyncCatalog}
                        disabled={syncingCatalog}
                        className="px-3.5 py-2 bg-secondary border border-border text-foreground rounded-xl text-xs font-bold hover:bg-muted transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary"
                    >
                        {syncingCatalog ? 'Sincronizando...' : 'Recargar Catálogo'}
                    </button>
                </div>
            </header>

            {/* Layout asimétrico: Formulario estructurado (8 cols) + Vista previa WhatsApp y estado del catálogo (4 cols) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <form onSubmit={handleSave} className="lg:col-span-8 bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                    {/* Navegación por secciones */}
                    <div className="flex flex-wrap gap-1 p-2 bg-secondary/50 border-b border-border" role="tablist" aria-label="Secciones de configuración del bot">
                        {([
                            { id: 'admision', label: '1. Fechas y Admisión' },
                            { id: 'pagos', label: '2. Cuentas y Aranceles' },
                            { id: 'modalidad', label: '3. Modalidad y Horarios' },
                            { id: 'enlaces', label: '4. Enlaces y Grupos' },
                            { id: 'mensaje_api', label: '5. Plantilla API Enviar Mensaje' },
                        ] as { id: SettingsTab; label: string }[]).map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                aria-selected={activeSection === tab.id}
                                onClick={() => {
                                    setActiveSection(tab.id);
                                    if (tab.id === 'mensaje_api') {
                                        setPreviewMode('api_mensaje');
                                    }
                                }}
                                className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors focus-visible:ring-2 focus-visible:ring-primary ${
                                    activeSection === tab.id
                                        ? 'bg-card text-foreground shadow-sm border border-border'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    <div className="p-6 space-y-5">
                        {activeSection === 'admision' && (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="proceso_actual" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                                            Código del Proceso Vigente
                                        </label>
                                        <input
                                            id="proceso_actual"
                                            type="text"
                                            value={settings.admision.proceso_actual}
                                            onChange={(e) => updateField('admision', 'proceso_actual', e.target.value)}
                                            className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                            placeholder="Ej. 2026-II"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="cierre_inscripciones" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                                            Cierre de Inscripciones
                                        </label>
                                        <input
                                            id="cierre_inscripciones"
                                            type="text"
                                            value={settings.admision.cierre_inscripciones}
                                            onChange={(e) => updateField('admision', 'cierre_inscripciones', e.target.value)}
                                            className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                            placeholder="Ej. Hasta el 10 de Agosto del 2026"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="fecha_examen" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                                            Fecha de Evaluación / Examen
                                        </label>
                                        <input
                                            id="fecha_examen"
                                            type="text"
                                            value={settings.admision.fecha_examen}
                                            onChange={(e) => updateField('admision', 'fecha_examen', e.target.value)}
                                            className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="fecha_entrevistas" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                                            Fecha de Entrevistas Personales
                                        </label>
                                        <input
                                            id="fecha_entrevistas"
                                            type="text"
                                            value={settings.admision.fecha_entrevistas}
                                            onChange={(e) => updateField('admision', 'fecha_entrevistas', e.target.value)}
                                            className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label htmlFor="inicio_clases" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                                            Inicio de Clases
                                        </label>
                                        <input
                                            id="inicio_clases"
                                            type="text"
                                            value={settings.admision.inicio_clases}
                                            onChange={(e) => updateField('admision', 'inicio_clases', e.target.value)}
                                            className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label htmlFor="nota_evaluacion" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                                        Explicación sobre el Examen / Evaluación de Admisión
                                    </label>
                                    <textarea
                                        id="nota_evaluacion"
                                        rows={3}
                                        value={settings.admision.nota_evaluacion}
                                        onChange={(e) => updateField('admision', 'nota_evaluacion', e.target.value)}
                                        className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                                    />
                                </div>
                            </div>
                        )}

                        {activeSection === 'pagos' && (
                            <div className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <label htmlFor="banco" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                                            Entidad Bancaria
                                        </label>
                                        <input
                                            id="banco"
                                            type="text"
                                            value={settings.pagos.banco}
                                            onChange={(e) => updateField('pagos', 'banco', e.target.value)}
                                            className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="cuenta_general" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                                            Cuenta Maestrías / Doctorados
                                        </label>
                                        <input
                                            id="cuenta_general"
                                            type="text"
                                            value={settings.pagos.cuenta_general}
                                            onChange={(e) => updateField('pagos', 'cuenta_general', e.target.value)}
                                            className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="cci_general" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                                            CCI Maestrías / Doctorados
                                        </label>
                                        <input
                                            id="cci_general"
                                            type="text"
                                            value={settings.pagos.cci_general}
                                            onChange={(e) => updateField('pagos', 'cci_general', e.target.value)}
                                            className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                        />
                                    </div>
                                    <div className="md:col-span-1">
                                        <label htmlFor="cuenta_especialidad" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                                            Cuenta Segundas Especialidades
                                        </label>
                                        <input
                                            id="cuenta_especialidad"
                                            type="text"
                                            value={settings.pagos.cuenta_especialidad}
                                            onChange={(e) => updateField('pagos', 'cuenta_especialidad', e.target.value)}
                                            className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label htmlFor="cci_especialidad" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                                            CCI Segundas Especialidades
                                        </label>
                                        <input
                                            id="cci_especialidad"
                                            type="text"
                                            value={settings.pagos.cci_especialidad}
                                            onChange={(e) => updateField('pagos', 'cci_especialidad', e.target.value)}
                                            className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                        />
                                    </div>
                                </div>

                                <div className="border-t border-border pt-4 space-y-4">
                                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                        Aranceles Base por Nivel Académico (Respaldo si no figura en tabla tipos_programas)
                                    </p>
                                    {([
                                        { label: 'Maestrías', insc: 'inscripcion_maestria', mat: 'matricula_maestria', sem: 'semestre_maestria', dur: 'duracion_maestria' },
                                        { label: 'Doctorados', insc: 'inscripcion_doctorado', mat: 'matricula_doctorado', sem: 'semestre_doctorado', dur: 'duracion_doctorado' },
                                        { label: 'Segundas Especialidades', insc: 'inscripcion_especialidad', mat: 'matricula_especialidad', sem: 'semestre_especialidad', dur: 'duracion_especialidad' },
                                    ] as const).map((row) => (
                                        <div key={row.label} className="p-3.5 rounded-xl bg-secondary/40 border border-border space-y-2.5">
                                            <span className="text-xs font-bold text-foreground">{row.label}</span>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                <div>
                                                    <label className="block text-[11px] text-muted-foreground mb-1">Inscripción</label>
                                                    <input
                                                        type="text"
                                                        value={settings.pagos[row.insc]}
                                                        onChange={(e) => updateField('pagos', row.insc, e.target.value)}
                                                        className="w-full px-3 py-2 bg-card border border-border rounded-lg text-xs font-mono text-foreground"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[11px] text-muted-foreground mb-1">Matrícula</label>
                                                    <input
                                                        type="text"
                                                        value={settings.pagos[row.mat]}
                                                        onChange={(e) => updateField('pagos', row.mat, e.target.value)}
                                                        className="w-full px-3 py-2 bg-card border border-border rounded-lg text-xs font-mono text-foreground"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[11px] text-muted-foreground mb-1">Costo Semestre</label>
                                                    <input
                                                        type="text"
                                                        value={settings.pagos[row.sem]}
                                                        onChange={(e) => updateField('pagos', row.sem, e.target.value)}
                                                        className="w-full px-3 py-2 bg-card border border-border rounded-lg text-xs font-mono text-foreground"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[11px] text-muted-foreground mb-1">Duración</label>
                                                    <input
                                                        type="text"
                                                        value={settings.pagos[row.dur]}
                                                        onChange={(e) => updateField('pagos', row.dur, e.target.value)}
                                                        className="w-full px-3 py-2 bg-card border border-border rounded-lg text-xs text-foreground"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeSection === 'modalidad' && (
                            <div className="space-y-4">
                                <div>
                                    <label htmlFor="modalidad_titulo" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                                        Denominación Oficial de Modalidad
                                    </label>
                                    <input
                                        id="modalidad_titulo"
                                        type="text"
                                        value={settings.modalidad_atencion.modalidad_titulo}
                                        onChange={(e) => updateField('modalidad_atencion', 'modalidad_titulo', e.target.value)}
                                        className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="modalidad_resumen" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                                        Detalle de Modalidad y Reconocimiento SUNEDU
                                    </label>
                                    <textarea
                                        id="modalidad_resumen"
                                        rows={3}
                                        value={settings.modalidad_atencion.modalidad_resumen}
                                        onChange={(e) => updateField('modalidad_atencion', 'modalidad_resumen', e.target.value)}
                                        className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                                    />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <label htmlFor="horario_ged" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                                            Horario Mesa de Partes GED
                                        </label>
                                        <input
                                            id="horario_ged"
                                            type="text"
                                            value={settings.modalidad_atencion.horario_ged}
                                            onChange={(e) => updateField('modalidad_atencion', 'horario_ged', e.target.value)}
                                            className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-sm text-foreground"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="telefono_soporte" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                                            Teléfono de Orientación
                                        </label>
                                        <input
                                            id="telefono_soporte"
                                            type="text"
                                            value={settings.modalidad_atencion.telefono_soporte}
                                            onChange={(e) => updateField('modalidad_atencion', 'telefono_soporte', e.target.value)}
                                            className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-sm font-mono text-foreground"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="limite_leads_diario" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                                            Cupo Diario Cola Web (/v1)
                                        </label>
                                        <input
                                            id="limite_leads_diario"
                                            type="number"
                                            min={1}
                                            max={2000}
                                            value={settings.modalidad_atencion.limite_leads_diario}
                                            onChange={(e) => updateField('modalidad_atencion', 'limite_leads_diario', Number(e.target.value))}
                                            className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-sm font-mono text-foreground"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeSection === 'enlaces' && (
                            <div className="space-y-4">
                                {([
                                    { id: 'whatsapp_admision_general', label: 'Grupo Oficial de WhatsApp (Admisión General)' },
                                    { id: 'portal_inscripcion', label: 'Enlace de Inscripción en Línea' },
                                    { id: 'portal_ged', label: 'Portal Mesa de Partes / GED' },
                                    { id: 'portal_ged_login', label: 'Acceso Directo Login GED (Carga de Carpeta)' },
                                    { id: 'portal_requisitos', label: 'Página Oficial de Requisitos de Admisión' },
                                    { id: 'portal_sga', label: 'Sistema de Gestión Académica (SGA Matrícula)' },
                                ] as const).map((item) => (
                                    <div key={item.id}>
                                        <label htmlFor={item.id} className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                                            {item.label}
                                        </label>
                                        <input
                                            id={item.id}
                                            type="url"
                                            value={settings.enlaces[item.id]}
                                            onChange={(e) => updateField('enlaces', item.id, e.target.value)}
                                            className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                        />
                                    </div>
                                ))}
                            </div>
                        )}

                        {activeSection === 'mensaje_api' && (
                            <div className="space-y-6">
                                {/* Alerta informativa y variables disponibles */}
                                <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-900 dark:text-blue-200 text-xs space-y-2">
                                    <div className="font-bold flex items-center gap-1.5 text-sm text-blue-700 dark:text-blue-300">
                                        <span>📲 Plantilla de Secuencia Automatizada (API /v1/enviar-datos)</span>
                                    </div>
                                    <p className="leading-relaxed">
                                        Personaliza los mensajes directos que envía el Bot a WhatsApp cuando un postulante completa su registro en los formularios web institucionales.
                                    </p>
                                    <div className="pt-2 border-t border-blue-500/20">
                                        <p className="font-bold text-[11px] uppercase tracking-wider mb-1 text-blue-600 dark:text-blue-400">
                                            Variables dinámicas sustituidas automáticamente:
                                        </p>
                                        <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                                            <span className="px-2 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 font-semibold">{'{nombre}'}</span>
                                            <span className="px-2 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 font-semibold">{'{programa}'}</span>
                                            <span className="px-2 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 font-semibold">{'{proceso_actual}'}</span>
                                            <span className="px-2 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 font-semibold">{'{banco}'}</span>
                                            <span className="px-2 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 font-semibold">{'{cuenta}'}</span>
                                            <span className="px-2 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 font-semibold">{'{cci}'}</span>
                                            <span className="px-2 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 font-semibold">{'{documento_grado}'}</span>
                                            <span className="px-2 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 font-semibold">{'{portal_inscripcion}'}</span>
                                            <span className="px-2 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 font-semibold">{'{portal_ged}'}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Campo 1: Saludo y Confirmación */}
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <label htmlFor="saludo_bienvenida" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                            1. Mensaje de Saludo y Confirmación
                                        </label>
                                        <span className="text-[11px] text-muted-foreground font-mono">Soporta {'{nombre}'} y {'{programa}'}</span>
                                    </div>
                                    <textarea
                                        id="saludo_bienvenida"
                                        rows={3}
                                        value={settings.mensaje_api.saludo_bienvenida}
                                        onChange={(e) => updateField('mensaje_api', 'saludo_bienvenida', e.target.value)}
                                        className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                                        placeholder="Ej. 🎓 ¡Hola {nombre}! Felicidades..."
                                    />
                                </div>

                                {/* Campo 2: Título de Detalles */}
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <label htmlFor="titulo_detalles" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                            2. Encabezado de la Ficha de Inscripción
                                        </label>
                                        <span className="text-[11px] text-muted-foreground font-mono">Soporta {'{proceso_actual}'}</span>
                                    </div>
                                    <input
                                        id="titulo_detalles"
                                        type="text"
                                        value={settings.mensaje_api.titulo_detalles}
                                        onChange={(e) => updateField('mensaje_api', 'titulo_detalles', e.target.value)}
                                        className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                        placeholder="Ej. 💥 *Detalles de Inscripción ({proceso_actual}):*"
                                    />
                                </div>

                                {/* Campo 3: Requisitos de Inscripción */}
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <label htmlFor="requisitos_texto" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                            3. Lista de Requisitos de Admisión
                                        </label>
                                        <span className="text-[11px] text-muted-foreground font-mono">{'{documento_grado}'} (Bachiller / Maestro / Título)</span>
                                    </div>
                                    <textarea
                                        id="requisitos_texto"
                                        rows={4}
                                        value={settings.mensaje_api.requisitos_texto}
                                        onChange={(e) => updateField('mensaje_api', 'requisitos_texto', e.target.value)}
                                        className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                                        placeholder="Ej. 📝 *REQUISITOS DE INSCRIPCIÓN:*\n1️⃣ Ficha..."
                                    />
                                </div>

                                {/* Campo 4: Textos de Brochure */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label htmlFor="aviso_brochure" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                            4.1 Texto al Adjuntar Brochure PDF
                                        </label>
                                        <input
                                            id="aviso_brochure"
                                            type="text"
                                            value={settings.mensaje_api.aviso_brochure}
                                            onChange={(e) => updateField('mensaje_api', 'aviso_brochure', e.target.value)}
                                            className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-xs font-mono text-foreground"
                                            placeholder="Ej. 📄 Te adjunto el brochure oficial del programa:"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label htmlFor="aviso_sin_brochure" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                            4.2 Mensaje Si No Hay PDF Disponible
                                        </label>
                                        <input
                                            id="aviso_sin_brochure"
                                            type="text"
                                            value={settings.mensaje_api.aviso_sin_brochure}
                                            onChange={(e) => updateField('mensaje_api', 'aviso_sin_brochure', e.target.value)}
                                            className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-xs font-mono text-foreground"
                                            placeholder="Ej. 📍 Si deseas el brochure de este programa..."
                                        />
                                    </div>
                                </div>

                                {/* Campo 5: Pasos de Formalización y Cierre */}
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <label htmlFor="pasos_inscripcion" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                            5. Pasos de Formalización y Mensaje de Cierre
                                        </label>
                                        <span className="text-[11px] text-muted-foreground font-mono">{'{banco}'}, {'{cuenta}'}, {'{portal_inscripcion}'}, {'{portal_ged}'}</span>
                                    </div>
                                    <textarea
                                        id="pasos_inscripcion"
                                        rows={4}
                                        value={settings.mensaje_api.pasos_inscripcion}
                                        onChange={(e) => updateField('mensaje_api', 'pasos_inscripcion', e.target.value)}
                                        className="w-full px-3.5 py-2.5 bg-secondary border border-border rounded-xl text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                                        placeholder="Ej. 👉 *PASOS PARA FORMALIZAR TU INSCRIPCIÓN:*\n1️⃣ Realiza el pago en..."
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Pie de acciones */}
                    <div className="px-6 py-4 bg-secondary/40 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="text-xs text-muted-foreground">
                            {meta?.updated_at ? (
                                <span>
                                    Última modificación: <strong className="text-foreground">{meta.updated_by_name || 'Sistema'}</strong> ({new Date(meta.updated_at).toLocaleString('es-PE')})
                                </span>
                            ) : (
                                <span>Valores iniciales activos en memoria del bot</span>
                            )}
                        </div>
                        <div className="flex items-center gap-2.5">
                            {isDirty && (
                                <button
                                    type="button"
                                    onClick={handleDiscard}
                                    className="px-4 py-2.5 rounded-xl border border-border bg-card text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    Descartar
                                </button>
                            )}
                            <button
                                type="submit"
                                disabled={saving || !isDirty}
                                className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                            >
                                {saving ? 'Guardando en el Bot...' : 'Guardar y Aplicar en Vivo'}
                            </button>
                        </div>
                    </div>
                </form>

                {/* Columna lateral: Estado de Fuentes de Datos + Previsualización Real en WhatsApp */}
                <aside className="lg:col-span-4 space-y-5">
                    {catalogSummary && (
                        <section className="bg-card border border-border rounded-2xl p-5 space-y-3 shadow-sm" aria-label="Resumen de catálogo sincronizado">
                            <div className="flex items-center justify-between">
                                <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                    Catálogo Académico Activo
                                </h2>
                                <span className="text-[11px] font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                    {catalogSummary.faculties} facultades
                                </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2.5 pt-1">
                                <div className="p-3 rounded-xl bg-secondary/60 border border-border">
                                    <p className="text-[11px] text-muted-foreground">Total Programas</p>
                                    <p className="text-lg font-black font-mono text-foreground">{catalogSummary.total_programs}</p>
                                </div>
                                <div className="p-3 rounded-xl bg-secondary/60 border border-border">
                                    <p className="text-[11px] text-muted-foreground">Con Brochure PDF</p>
                                    <p className="text-lg font-black font-mono text-emerald-600 dark:text-emerald-400">{catalogSummary.with_brochure}</p>
                                </div>
                            </div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 font-mono">
                                <span>Maestrías: {catalogSummary.maestrias}</span>
                                <span>Doctorados: {catalogSummary.doctorados}</span>
                                <span>Espec.: {catalogSummary.especialidades}</span>
                            </div>
                        </section>
                    )}

                    <section className="bg-card border border-border rounded-2xl p-5 space-y-3 shadow-sm" aria-label="Vista previa de respuesta en WhatsApp">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Vista Previa en WhatsApp
                            </h2>
                            <div className="flex items-center p-0.5 rounded-lg bg-secondary border border-border">
                                <button
                                    type="button"
                                    onClick={() => setPreviewMode('cronograma')}
                                    className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                                        previewMode === 'cronograma' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                                    }`}
                                >
                                    Cronograma
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPreviewMode('api_mensaje')}
                                    className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                                        previewMode === 'api_mensaje' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                                    }`}
                                >
                                    Mensaje API
                                </button>
                            </div>
                        </div>

                        {previewMode === 'cronograma' ? (
                            <div className="p-4 rounded-xl bg-slate-900 text-slate-100 text-xs leading-relaxed space-y-2 border border-slate-800 font-sans whitespace-pre-line shadow-inner">
                                <p className="font-bold text-emerald-400">
                                    CRONOGRAMA OFICIAL DE ADMISIÓN ({settings.admision.proceso_actual}) - UNAC
                                </p>
                                <p>
                                    • Cierre de Inscripciones: {settings.admision.cierre_inscripciones}{'\n'}
                                    • Examen / Evaluación: {settings.admision.fecha_examen}{'\n'}
                                    • Entrevistas: {settings.admision.fecha_entrevistas}{'\n'}
                                    • Inicio de Clases: {settings.admision.inicio_clases}
                                </p>
                                <p className="pt-1 border-t border-slate-800 text-slate-300">
                                    Banco {settings.pagos.banco}: Cta {settings.pagos.cuenta_general} (Maestría {settings.pagos.inscripcion_maestria} · Doctorado {settings.pagos.inscripcion_doctorado} · Especialidad {settings.pagos.inscripcion_especialidad})
                                </p>
                                <p className="text-sky-400 break-all font-mono text-[11px]">
                                    {settings.enlaces.portal_inscripcion}
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2.5 max-h-[500px] overflow-y-auto p-3 rounded-xl bg-slate-950 border border-slate-800">
                                {/* Burbuja 1: Saludo */}
                                <div className="p-3 rounded-xl bg-emerald-950/70 border border-emerald-800/40 text-slate-100 text-xs font-sans whitespace-pre-line">
                                    {settings.mensaje_api.saludo_bienvenida
                                        .replace('{nombre}', 'Juan Pérez')
                                        .replace('{programa}', 'Maestría en Ingeniería de Sistemas')}
                                </div>

                                {/* Burbuja 2: Detalles */}
                                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs font-sans whitespace-pre-line">
                                    <p className="font-bold text-emerald-400 mb-1">
                                        {settings.mensaje_api.titulo_detalles.replace('{proceso_actual}', settings.admision.proceso_actual)}
                                    </p>
                                    <p>
                                        📌 Inscripción: {settings.pagos.inscripcion_maestria}{'\n'}
                                        🏦 Banco: {settings.pagos.banco} (Cta: {settings.pagos.cuenta_general} / CCI: {settings.pagos.cci_general}){'\n'}
                                        ⏳ Duración: {settings.pagos.duracion_maestria}{'\n'}
                                        📌 Matrícula: {settings.pagos.matricula_maestria}{'\n'}
                                        💵 Costo Semestre: {settings.pagos.semestre_maestria}
                                    </p>
                                    <p className="pt-1.5 border-t border-slate-800 text-slate-300 mt-1.5">
                                        📅 Fechas: Cierre {settings.admision.cierre_inscripciones} | Inicio {settings.admision.inicio_clases}
                                    </p>
                                </div>

                                {/* Burbuja 3: Requisitos */}
                                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs font-sans whitespace-pre-line">
                                    {settings.mensaje_api.requisitos_texto.replace('{documento_grado}', 'Copia del Grado Académico de Bachiller.')}
                                </div>

                                {/* Burbuja 4: Brochure */}
                                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs font-sans">
                                    <p>{settings.mensaje_api.aviso_brochure}</p>
                                    <div className="mt-2 p-2 rounded-lg bg-slate-800/80 border border-slate-700/60 flex items-center gap-2">
                                        <span className="text-base">📄</span>
                                        <span className="text-[11px] font-mono text-sky-400 truncate">brochure-Maestria-Sistemas.pdf</span>
                                    </div>
                                </div>

                                {/* Burbuja 5: Pasos de Inscripción */}
                                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs font-sans whitespace-pre-line">
                                    {settings.mensaje_api.pasos_inscripcion
                                        .replace('{banco}', settings.pagos.banco)
                                        .replace('{cuenta}', settings.pagos.cuenta_general)
                                        .replace('{cci}', settings.pagos.cci_general)
                                        .replace('{portal_inscripcion}', settings.enlaces.portal_inscripcion)
                                        .replace('{portal_ged}', settings.enlaces.portal_ged)}
                                </div>
                            </div>
                        )}
                    </section>
                </aside>
            </div>
        </div>
    );
}
