/**
 * Widget Oficial de Chat Web - UNAC Posgrado
 * - Prevención de duplicados mediante Dual-Key Deduplication (ID de BD + Firma temporal de contenido).
 * - Captura obligatoria de perfil del consultante (Nombre, Celular, Condición: Postulante / Estudiante / Egresado).
 * - Sincronización garantizada en cada interacción hacia Supabase (conversations, students y chatbot_interactions).
 */
class ChatAgent {
    constructor(options = {}) {
        if (window.__activeChatAgentInstance) {
            window.__activeChatAgentInstance.updateOptions(options);
            return window.__activeChatAgentInstance;
        }
        window.__activeChatAgentInstance = this;

        const currentScript = document.currentScript || Array.from(document.querySelectorAll('script')).pop();
        const scriptApiUrl = currentScript?.getAttribute('data-api-url');

        this.options = {
            apiUrl: options.apiUrl || scriptApiUrl || (window.location.hostname === 'localhost' ? 'http://localhost:3000' : window.location.origin),
            agentName: options.agentName || 'Escuela de Posgrado',
            agentSubtitle: options.agentSubtitle || 'UNAC Callao',
            welcomeMessage: options.welcomeMessage || '¡Hola! 👋 Soy el Asesor Virtual de la Escuela de Posgrado de la UNAC.\n\n¿En qué maestría, doctorado o trámite académico puedo ayudarte hoy?',
            containerId: 'chat-agent-container',
            storageKey: 'unac_posgrado_chat_session',
            profileStorageKey: 'unac_posgrado_user_profile'
        };

        this.apiUrl = this.options.apiUrl.replace(/\/$/, '');
        this.isOpen = false;
        this.visitorId = this.getStoredVisitorId();
        this.userProfile = this.getStoredProfile();
        this.selectedCondition = this.userProfile?.condicion || 'postulante';
        this.chatStatus = 'bot';
        this.pollInterval = null;
        this.isSending = false;
        this.eventsBound = false;

        // Sets de deduplicación dual (ID de base de datos + clave normalizada de contenido)
        this.renderedIds = new Set();
        this.renderedContentTimestamps = new Map(); // clave "sender:texto" -> timestamp ms

        this.init();
    }

    updateOptions(newOptions = {}) {
        Object.assign(this.options, newOptions);
        if (newOptions.apiUrl) {
            this.apiUrl = newOptions.apiUrl.replace(/\/$/, '');
        }
    }

    getStoredVisitorId() {
        try {
            return localStorage.getItem(this.options.storageKey) || null;
        } catch (e) {
            return null;
        }
    }

    setStoredVisitorId(id) {
        this.visitorId = id;
        try {
            if (id) {
                localStorage.setItem(this.options.storageKey, id);
            } else {
                localStorage.removeItem(this.options.storageKey);
            }
        } catch (e) {
            // Ignorar en modo incógnito restringido
        }
    }

    getStoredProfile() {
        try {
            const raw = localStorage.getItem(this.options.profileStorageKey);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (parsed && parsed.nombre && parsed.telefono && parsed.condicion) {
                return parsed;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    setStoredProfile(profile) {
        this.userProfile = profile;
        try {
            if (profile) {
                localStorage.setItem(this.options.profileStorageKey, JSON.stringify(profile));
            } else {
                localStorage.removeItem(this.options.profileStorageKey);
            }
        } catch (e) {
            // Ignorar
        }
        this.updateProfileGateUI();
    }

    hasCompleteProfile() {
        return Boolean(
            this.userProfile &&
            this.userProfile.nombre &&
            this.userProfile.telefono &&
            this.userProfile.condicion
        );
    }

    async init() {
        this.createDOM();
        this.addEventListeners();
        this.updateProfileGateUI();
        await this.syncSession();
    }

    getAssetUrl(relativePath) {
        if (typeof window !== 'undefined') {
            const scripts = document.querySelectorAll('script');
            for (let i = scripts.length - 1; i >= 0; i--) {
                const src = scripts[i].src || '';
                if (src.includes('widget.js')) {
                    const baseDir = src.substring(0, src.lastIndexOf('/') + 1);
                    return baseDir + relativePath;
                }
            }
        }
        return 'https://posgradounac.edu.pe/' + relativePath;
    }

    createDOM() {
        if (document.getElementById(this.options.containerId)) return;

        const container = document.createElement('div');
        container.id = this.options.containerId;

        const logoUrl = this.getAssetUrl('img/logo_unac.png');

        container.innerHTML = `
            <button class="chat-bubble-launcher" id="chat-launcher" aria-label="Abrir chat de consultas" title="Consultar con Posgrado UNAC">
                <span class="chat-launcher-badge"></span>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
            </button>
            <div class="chat-window" id="chat-window" role="region" aria-label="Ventana de chat de admisiones">
                <!-- Header Institucional -->
                <div class="chat-header">
                    <div class="agent-avatar" aria-hidden="true">
                        <img src="${logoUrl}" alt="UNAC" onerror="this.onerror=null; this.src='https://posgradounac.edu.pe/img/logo_unac.png';">
                    </div>
                    <div class="agent-info">
                        <div class="agent-title-row">
                            <h3>${this.options.agentName}</h3>
                            <span class="agent-badge" id="agent-type-badge">Virtual</span>
                        </div>
                        <div class="agent-status" id="agent-status-label">
                            <span class="agent-status-dot"></span>
                            <span>${this.options.agentSubtitle} • En línea</span>
                        </div>
                    </div>
                    <div class="chat-header-actions">
                        <button class="header-action-btn" id="chat-reset-btn" title="Nueva consulta (Reiniciar)" aria-label="Nueva consulta">
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                            </svg>
                        </button>
                        <button class="header-action-btn" id="chat-close-btn" title="Minimizar chat" aria-label="Cerrar">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- Barra de Perfil Activo -->
                <div class="chat-profile-bar hidden" id="chat-profile-bar">
                    <div class="profile-summary">
                        <span class="profile-name-phone" id="profile-summary-text"></span>
                        <span class="profile-condition-pill postulante" id="profile-condition-pill">Postulante</span>
                    </div>
                    <button class="profile-edit-btn" id="profile-edit-btn" type="button">Editar</button>
                </div>

                <!-- Formulario Obligatorio de Identificación (Lead Gate) -->
                <div class="chat-lead-gate hidden" id="chat-lead-gate">
                    <div class="lead-gate-card">
                        <div class="lead-gate-header">
                            <h4>Identificación de Consulta</h4>
                            <p>Para brindarte atención personalizada y registrar tu consulta, completa tus datos:</p>
                        </div>
                        <form id="chat-lead-form" novalidate>
                            <div class="lead-field">
                                <label for="lead-nombre">Nombres y Apellidos *</label>
                                <input type="text" id="lead-nombre" placeholder="Ej. Juan Pérez Gómez" required maxlength="100" autocomplete="name">
                            </div>
                            <div class="lead-field">
                                <label for="lead-telefono">Número de Celular / WhatsApp *</label>
                                <input type="tel" id="lead-telefono" placeholder="Ej. 987654321" required maxlength="15" autocomplete="tel">
                            </div>
                            <div class="lead-field">
                                <label>Condición Académica *</label>
                                <div class="lead-condition-grid" id="lead-condition-grid">
                                    <button type="button" class="condition-option-btn selected" data-condition="postulante">
                                        <span class="cond-icon">🎓</span>
                                        <span>Postulante</span>
                                    </button>
                                    <button type="button" class="condition-option-btn" data-condition="estudiante">
                                        <span class="cond-icon">📚</span>
                                        <span>Estudiante</span>
                                    </button>
                                    <button type="button" class="condition-option-btn" data-condition="egresado">
                                        <span class="cond-icon">🏅</span>
                                        <span>Egresado</span>
                                    </button>
                                </div>
                            </div>
                            <div class="lead-error-msg" id="lead-error-msg"></div>
                            <button type="submit" class="lead-submit-btn" id="lead-submit-btn">Iniciar Consulta →</button>
                        </form>
                    </div>
                </div>

                <!-- Contenedor de Mensajes -->
                <div class="chat-messages" id="chat-messages" aria-live="polite"></div>

                <!-- Sugerencias Rápidas -->
                <div class="chat-quick-suggestions" id="chat-quick-suggestions">
                    <button class="quick-chip" data-query="¿Cuáles son las maestrías disponibles?">🎓 Maestrías</button>
                    <button class="quick-chip" data-query="¿Cuáles son las fechas de admisión?">📅 Fechas de Admisión</button>
                    <button class="quick-chip" data-query="¿Cuáles son los costos y formas de pago?">💳 Costos</button>
                    <button class="quick-chip" data-query="Deseo comunicarme con un asesor">👨‍💼 Contactar Asesor</button>
                </div>

                <!-- Barra de Entrada -->
                <div class="chat-input-area" id="chat-input-area">
                    <input type="text" id="chat-input" placeholder="Escribe tu consulta sobre posgrado..." autocomplete="off" maxlength="1000">
                    <button class="send-btn" id="chat-send" aria-label="Enviar mensaje" title="Enviar consulta">
                        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13"/>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(container);
    }

    addEventListeners() {
        if (this.eventsBound) return;
        this.eventsBound = true;

        const launcher = document.getElementById('chat-launcher');
        const closeBtn = document.getElementById('chat-close-btn');
        const resetBtn = document.getElementById('chat-reset-btn');
        const input = document.getElementById('chat-input');
        const sendBtn = document.getElementById('chat-send');
        const suggestions = document.getElementById('chat-quick-suggestions');
        const leadForm = document.getElementById('chat-lead-form');
        const conditionGrid = document.getElementById('lead-condition-grid');
        const profileEditBtn = document.getElementById('profile-edit-btn');

        launcher?.addEventListener('click', () => this.toggleChat());
        closeBtn?.addEventListener('click', () => this.toggleChat(false));
        resetBtn?.addEventListener('click', () => this.confirmResetChat());

        sendBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this.handleSendMessage();
        });

        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.handleSendMessage();
            }
        });

        suggestions?.addEventListener('click', (e) => {
            const chip = e.target.closest('.quick-chip');
            if (chip && chip.dataset.query) {
                const queryText = chip.dataset.query;
                if (input) input.value = queryText;
                this.handleSendMessage();
            }
        });

        conditionGrid?.addEventListener('click', (e) => {
            const btn = e.target.closest('.condition-option-btn');
            if (!btn) return;
            this.selectedCondition = btn.dataset.condition || 'postulante';
            conditionGrid.querySelectorAll('.condition-option-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });

        leadForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLeadSubmit();
        });

        profileEditBtn?.addEventListener('click', () => {
            this.openLeadEditor();
        });
    }

    /**
     * Controla si se muestra el formulario obligatorio de perfil o la vista de chat
     */
    updateProfileGateUI(forceEditMode = false) {
        const leadGate = document.getElementById('chat-lead-gate');
        const profileBar = document.getElementById('chat-profile-bar');
        const messagesEl = document.getElementById('chat-messages');
        const suggestionsEl = document.getElementById('chat-quick-suggestions');
        const inputAreaEl = document.getElementById('chat-input-area');

        const isRegistered = this.hasCompleteProfile() && !forceEditMode;

        if (!isRegistered) {
            leadGate?.classList.remove('hidden');
            profileBar?.classList.add('hidden');
            messagesEl?.classList.add('hidden');
            suggestionsEl?.classList.add('hidden');
            inputAreaEl?.classList.add('hidden');

            // Pre-llenar si existen datos parciales
            if (this.userProfile) {
                const nameInput = document.getElementById('lead-nombre');
                const phoneInput = document.getElementById('lead-telefono');
                if (nameInput && this.userProfile.nombre) nameInput.value = this.userProfile.nombre;
                if (phoneInput && this.userProfile.telefono) phoneInput.value = this.userProfile.telefono;
                if (this.userProfile.condicion) {
                    this.selectedCondition = this.userProfile.condicion;
                    const grid = document.getElementById('lead-condition-grid');
                    grid?.querySelectorAll('.condition-option-btn').forEach(b => {
                        b.classList.toggle('selected', b.dataset.condition === this.selectedCondition);
                    });
                }
            }
        } else {
            leadGate?.classList.add('hidden');
            profileBar?.classList.remove('hidden');
            messagesEl?.classList.remove('hidden');
            suggestionsEl?.classList.remove('hidden');
            inputAreaEl?.classList.remove('hidden');

            const summaryText = document.getElementById('profile-summary-text');
            const condPill = document.getElementById('profile-condition-pill');
            if (summaryText) {
                summaryText.textContent = `👤 ${this.userProfile.nombre} • 📱 ${this.userProfile.telefono}`;
            }
            if (condPill) {
                const cond = (this.userProfile.condicion || 'postulante').toLowerCase();
                condPill.textContent = cond;
                condPill.className = `profile-condition-pill ${cond}`;
            }
        }
    }

    openLeadEditor() {
        this.updateProfileGateUI(true);
    }

    async handleLeadSubmit() {
        const nameInput = document.getElementById('lead-nombre');
        const phoneInput = document.getElementById('lead-telefono');
        const errorEl = document.getElementById('lead-error-msg');
        const submitBtn = document.getElementById('lead-submit-btn');

        const nombre = (nameInput?.value || '').trim();
        const rawPhone = (phoneInput?.value || '').replace(/\D/g, '');
        const condicion = this.selectedCondition || 'postulante';

        if (nombre.length < 3) {
            if (errorEl) {
                errorEl.textContent = 'Por favor ingresa tu nombre y apellido completo.';
                errorEl.style.display = 'block';
            }
            nameInput?.focus();
            return;
        }

        if (rawPhone.length < 9) {
            if (errorEl) {
                errorEl.textContent = 'Por favor ingresa un número de celular válido (mínimo 9 dígitos).';
                errorEl.style.display = 'block';
            }
            phoneInput?.focus();
            return;
        }

        if (errorEl) errorEl.style.display = 'none';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Guardando...';
        }

        const profileData = {
            nombre,
            telefono: rawPhone,
            condicion
        };

        try {
            if (!this.visitorId) {
                await this.syncSession(profileData);
            } else {
                await fetch(`${this.apiUrl}/v1/chat/lead`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        visitorId: this.visitorId,
                        ...profileData
                    })
                });
            }
        } catch (err) {
            console.warn('[ChatWidget] Guardado local de perfil activado:', err.message);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Iniciar Consulta →';
            }
        }

        this.setStoredProfile(profileData);
        document.getElementById('chat-input')?.focus();
        this.scrollToBottom();
    }

    toggleChat(forceState) {
        this.isOpen = typeof forceState === 'boolean' ? forceState : !this.isOpen;
        const windowEl = document.getElementById('chat-window');
        const launcher = document.getElementById('chat-launcher');

        if (this.isOpen) {
            windowEl?.classList.add('active');
            launcher?.classList.add('active');
            launcher.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>`;
            if (this.hasCompleteProfile()) {
                document.getElementById('chat-input')?.focus();
            } else {
                document.getElementById('lead-nombre')?.focus();
            }
            this.startPolling();
        } else {
            windowEl?.classList.remove('active');
            launcher?.classList.remove('active');
            launcher.innerHTML = `
                <span class="chat-launcher-badge"></span>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>`;
            this.stopPolling();
        }
    }

    /**
     * Sincroniza la sesión con el backend
     */
    async syncSession(customProfile = null) {
        try {
            const activeProfile = customProfile || this.userProfile;
            const res = await fetch(`${this.apiUrl}/v1/chat/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    visitorId: this.visitorId,
                    userProfile: activeProfile
                })
            });

            if (!res.ok) throw new Error('Error al sincronizar sesión');

            const data = await res.json();
            if (data.session_id) {
                this.setStoredVisitorId(data.session_id);
            }

            // Recuperar perfil si la sesión en BD ya lo tenía
            if (data.metadata && data.metadata.name && data.metadata.phone && data.metadata.user_condition) {
                this.setStoredProfile({
                    nombre: data.metadata.name,
                    telefono: data.metadata.phone,
                    condicion: data.metadata.user_condition
                });
            }

            this.updateStatusUI(data.status || 'bot');

            const messagesContainer = document.getElementById('chat-messages');
            if (messagesContainer) {
                messagesContainer.innerHTML = '';
                this.renderedIds.clear();
                this.renderedContentTimestamps.clear();
            }

            if (Array.isArray(data.messages) && data.messages.length > 0) {
                data.messages.forEach(msg => {
                    const sender = msg.sender_type === 'user' ? 'user' : (msg.sender_type === 'dashboard' ? 'human' : 'agent');
                    this.appendMessageToDOM(sender, msg.text, msg.created_at, msg.id);
                });
            } else {
                this.appendMessageToDOM('agent', this.options.welcomeMessage);
            }
        } catch (err) {
            console.warn('[ChatWidget] Modo offline o backend en espera:', err.message);
            const messagesContainer = document.getElementById('chat-messages');
            if (messagesContainer && messagesContainer.children.length === 0) {
                this.appendMessageToDOM('agent', this.options.welcomeMessage);
            }
        }
    }

    /**
     * Envío de mensaje adjuntando siempre el perfil del usuario (Nombre, Celular, Condición)
     */
    async handleSendMessage() {
        if (this.isSending) return;

        // Verificar que tenga perfil registrado antes de enviar
        if (!this.hasCompleteProfile()) {
            this.updateProfileGateUI(true);
            return;
        }

        const input = document.getElementById('chat-input');
        const text = input?.value.trim();
        if (!text) return;

        input.value = '';
        const optimisticNow = new Date().toISOString();

        // Renderizado optimista del mensaje del usuario
        this.appendMessageToDOM('user', text, optimisticNow, null);
        this.showTypingIndicator();
        this.isSending = true;

        try {
            const res = await fetch(`${this.apiUrl}/v1/chat/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    visitorId: this.visitorId,
                    text,
                    userProfile: this.userProfile
                })
            });

            this.hideTypingIndicator();

            if (!res.ok) {
                throw new Error('Error en el servicio de mensajería');
            }

            const data = await res.json();
            if (data.session_id && data.session_id !== this.visitorId) {
                this.setStoredVisitorId(data.session_id);
            }

            // Registrar el ID de base de datos del mensaje del usuario para que el polling jamás lo duplique
            if (data.user_message?.id) {
                this.renderedIds.add(String(data.user_message.id));
            }

            if (data.status) {
                this.updateStatusUI(data.status);
            }

            if (data.reply) {
                const botMsgId = data.bot_message?.id || null;
                const botCreatedAt = data.bot_message?.created_at || new Date().toISOString();
                this.appendMessageToDOM('agent', data.reply, botCreatedAt, botMsgId);
            } else if (data.notice) {
                this.appendMessageToDOM('system', data.notice);
            }
        } catch (err) {
            this.hideTypingIndicator();
            this.appendMessageToDOM('system', 'Hubo una dificultad de conexión. Por favor reintenta en unos instantes.');
            console.error('[ChatWidget] Error al enviar:', err);
        } finally {
            this.isSending = false;
        }
    }

    /**
     * Polling para respuestas en tiempo real (inmune a duplicados por Dual-Key)
     */
    startPolling() {
        this.stopPolling();
        this.pollInterval = setInterval(async () => {
            if (!this.isOpen || !this.visitorId || this.isSending) return;
            try {
                const res = await fetch(`${this.apiUrl}/v1/chat/history?visitorId=${encodeURIComponent(this.visitorId)}`);
                if (!res.ok) return;

                const data = await res.json();
                if (data.status) this.updateStatusUI(data.status);

                if (Array.isArray(data.messages)) {
                    data.messages.forEach(m => {
                        const sender = m.sender_type === 'user' ? 'user' : (m.sender_type === 'dashboard' ? 'human' : 'agent');
                        this.appendMessageToDOM(sender, m.text, m.created_at, m.id);
                    });
                }
            } catch (e) {
                // Silencioso
            }
        }, 4000);
    }

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    /**
     * Reiniciar chat conservando el perfil registrado
     */
    async confirmResetChat() {
        if (!confirm('¿Deseas iniciar una nueva consulta? Se abrirá una conversación limpia.')) {
            return;
        }

        try {
            const res = await fetch(`${this.apiUrl}/v1/chat/reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    visitorId: this.visitorId,
                    userProfile: this.userProfile
                })
            });

            if (res.ok) {
                const data = await res.json();
                this.setStoredVisitorId(data.session_id);
                this.updateStatusUI('bot');

                const messagesContainer = document.getElementById('chat-messages');
                if (messagesContainer) {
                    messagesContainer.innerHTML = '';
                    this.renderedIds.clear();
                    this.renderedContentTimestamps.clear();
                }

                const welcomeMsg = data.messages?.[0];
                this.appendMessageToDOM(
                    'agent',
                    welcomeMsg?.text || this.options.welcomeMessage,
                    welcomeMsg?.created_at,
                    welcomeMsg?.id
                );
            }
        } catch (e) {
            console.error('[ChatWidget] Error reiniciando chat:', e);
        }
    }

    updateStatusUI(status) {
        this.chatStatus = status;
        const badge = document.getElementById('agent-type-badge');
        const statusLabel = document.getElementById('agent-status-label');

        if (status === 'human_active') {
            if (badge) {
                badge.textContent = 'Asesor Humano';
                badge.className = 'agent-badge human';
            }
            if (statusLabel) {
                statusLabel.innerHTML = '<span class="agent-status-dot" style="background:#10b981"></span><span>Asesor Académico Conectado</span>';
            }
        } else {
            if (badge) {
                badge.textContent = 'Virtual';
                badge.className = 'agent-badge';
            }
            if (statusLabel) {
                statusLabel.innerHTML = `<span class="agent-status-dot"></span><span>${this.options.agentSubtitle} • En línea</span>`;
            }
        }
    }

    /**
     * Inserción en DOM con Deduplicación Dual (ID de BD + Firma de Contenido)
     */
    appendMessageToDOM(sender, text, timestamp, id = null) {
        const messagesContainer = document.getElementById('chat-messages');
        if (!messagesContainer || !text) return;

        const cleanText = text.trim();
        const contentKey = `${sender}:${cleanText}`;
        const idStr = id ? String(id) : null;
        const msgTimeMs = timestamp ? new Date(timestamp).getTime() : Date.now();

        // 1. Si ya tenemos registrado este ID exacto de base de datos, ignorar
        if (idStr && this.renderedIds.has(idStr)) {
            return;
        }

        // 2. Si el mismo emisor y texto ya fue renderizado hace menos de 60 segundos (ej. optimista vs polling),
        // vinculamos el nuevo ID de base de datos y evitamos duplicar la burbuja en el DOM
        if (this.renderedContentTimestamps.has(contentKey)) {
            const lastRenderedMs = this.renderedContentTimestamps.get(contentKey);
            if (Math.abs(msgTimeMs - lastRenderedMs) < 60000) {
                if (idStr) this.renderedIds.add(idStr);
                return;
            }
        }

        if (idStr) this.renderedIds.add(idStr);
        this.renderedContentTimestamps.set(contentKey, msgTimeMs);

        const timeStr = this.formatTime(timestamp);
        const rowDiv = document.createElement('div');
        rowDiv.className = `message-row ${sender}`;

        if (sender === 'system') {
            rowDiv.innerHTML = `
                <div class="message-bubble">${this.escapeHTML(cleanText)}</div>
            `;
        } else if (sender === 'user') {
            rowDiv.innerHTML = `
                <div class="message-wrapper">
                    <div class="message-bubble">
                        <div class="message-body">${this.escapeHTML(cleanText)}</div>
                        <div class="message-meta">
                            <span>${timeStr}</span>
                            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                                <path d="M12.354 4.354a.5.5 0 0 0-.708-.708L5 10.293 1.854 7.146a.5.5 0 1 0-.708.708l3.5 3.5a.5.5 0 0 0 .708 0l7-7zm-3.5 0a.5.5 0 0 0-.708-.708L5 6.793l.646.647 3.208-3.086z"/>
                            </svg>
                        </div>
                    </div>
                </div>
            `;
        } else {
            const logoUrl = this.getAssetUrl('img/logo_unac.png');
            const avatarHtml = sender === 'human'
                ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
                : `<img src="${logoUrl}" alt="UNAC" onerror="this.onerror=null; this.src='https://posgradounac.edu.pe/img/logo_unac.png';">`;

            const senderTag = sender === 'human'
                ? `<div class="message-sender-tag"><span>👨‍💼 Asesor Académico</span></div>`
                : '';

            const formattedHtml = this.formatRichText(cleanText);

            rowDiv.innerHTML = `
                <div class="message-wrapper">
                    <div class="message-avatar-mini" aria-hidden="true">${avatarHtml}</div>
                    <div class="message-bubble">
                        ${senderTag}
                        <div class="message-body">${formattedHtml}</div>
                        <div class="message-meta">
                            <span>${timeStr}</span>
                        </div>
                    </div>
                </div>
            `;
        }

        messagesContainer.appendChild(rowDiv);
        this.scrollToBottom();
    }

    formatRichText(raw) {
        if (!raw) return '';

        if (/cierre de inscripciones|evaluaci[óo]n y entrevistas|inicio de clases/i.test(raw)) {
            return this.formatAdmissionDates(raw);
        }

        let safe = this.escapeHTML(raw);
        safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        safe = safe.replace(/(^|[^\*])\*([^\*]+)\*([^\*]|$)/g, '$1<strong>$2</strong>$3');
        safe = safe.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="chat-link">$1</a>');

        const lines = safe.split('\n');
        let inList = false;
        let html = '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || trimmed.startsWith('* ')) {
                if (!inList) {
                    html += '<ul class="chat-list">';
                    inList = true;
                }
                html += `<li>${trimmed.replace(/^[-•*]\s*/, '')}</li>`;
            } else {
                if (inList) {
                    html += '</ul>';
                    inList = false;
                }
                if (trimmed) {
                    html += `<p>${trimmed}</p>`;
                }
            }
        }

        if (inList) html += '</ul>';
        return html || safe;
    }

    formatAdmissionDates(text) {
        const parts = text.split(/(?<=[.!?])\s+/);
        let itemsHtml = '';
        let extraText = '';

        for (const part of parts) {
            const match = part.match(/(cierre de inscripciones|evaluaci[óo]n y entrevistas|inicio de clases)[\s:]+([^.!?]+)/i);
            if (match) {
                const label = match[1].charAt(0).toUpperCase() + match[1].slice(1);
                const val = match[2].trim();
                itemsHtml += `
                    <div class="date-highlight-item">
                        <span class="date-label">📅 ${this.escapeHTML(label)}</span>
                        <span class="date-val">${this.escapeHTML(val)}</span>
                    </div>
                `;
            } else {
                const cleanExtra = part.replace(/🗓️/g, '').trim();
                if (cleanExtra) {
                    extraText += `<p>${this.escapeHTML(cleanExtra)}</p>`;
                }
            }
        }

        if (itemsHtml) {
            return `
                <div class="date-highlight-card">
                    ${itemsHtml}
                </div>
                ${extraText}
            `;
        }

        return this.escapeHTML(text);
    }

    formatTime(isoString) {
        try {
            const d = isoString ? new Date(isoString) : new Date();
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return '';
        }
    }

    escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    showTypingIndicator() {
        const messagesContainer = document.getElementById('chat-messages');
        if (!messagesContainer || document.getElementById('typing-indicator-row')) return;

        const typingRow = document.createElement('div');
        typingRow.className = 'message-row agent typing-row';
        typingRow.id = 'typing-indicator-row';
        typingRow.innerHTML = `
            <div class="message-wrapper">
                <div class="message-avatar-mini" aria-hidden="true">
                    <img src="${this.getAssetUrl('img/logo_unac.png')}" alt="UNAC" onerror="this.onerror=null; this.src='https://posgradounac.edu.pe/img/logo_unac.png';">
                </div>
                <div class="typing-bubble">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        `;
        messagesContainer.appendChild(typingRow);
        this.scrollToBottom();
    }

    hideTypingIndicator() {
        const indicator = document.getElementById('typing-indicator-row');
        if (indicator) indicator.remove();
    }

    scrollToBottom() {
        const container = document.getElementById('chat-messages');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }
}

if (typeof window !== 'undefined') {
    window.ChatAgent = ChatAgent;

    const scheduleInit = () => {
        if (!window.__activeChatAgentInstance) {
            window.__activeChatAgentInstance = new ChatAgent();
        }
    };

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', scheduleInit, { once: true });
    } else {
        scheduleInit();
    }
}
