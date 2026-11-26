/**
 * Widget Oficial de Chat Web - UNAC Posgrado
 * Soporta persistencia en localStorage, contexto continuo,
 * respuesta con IA (Grok) y recepción en vivo de asesores humanos.
 */
class ChatAgent {
    constructor(options = {}) {
        // Detectar URL base de la API desde el script tag o parámetro
        const currentScript = document.currentScript || Array.from(document.querySelectorAll('script')).pop();
        const scriptApiUrl = currentScript?.getAttribute('data-api-url');

        this.options = {
            apiUrl: options.apiUrl || scriptApiUrl || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : window.location.origin),
            agentName: options.agentName || 'Asesor UNAC',
            welcomeMessage: options.welcomeMessage || '¡Hola! 👋 Soy el Asesor Virtual de Posgrado de la UNAC. ¿En qué programa de posgrado estás interesado hoy?',
            containerId: 'chat-agent-container',
            storageKey: 'unac_posgrado_chat_session'
        };

        this.apiUrl = this.options.apiUrl.replace(/\/$/, '');
        this.isOpen = false;
        this.visitorId = this.getStoredVisitorId();
        this.chatStatus = 'bot'; // 'bot' | 'human_active'
        this.messages = [];
        this.pollInterval = null;
        this.isSending = false;

        this.init();
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
            // Ignorar bloqueo de storage en modo incógnito estricto
        }
    }

    async init() {
        this.createDOM();
        this.addEventListeners();
        await this.syncSession();
    }

    createDOM() {
        if (document.getElementById(this.options.containerId)) return;

        const container = document.createElement('div');
        container.id = this.options.containerId;

        container.innerHTML = `
            <button class="chat-bubble-launcher" id="chat-launcher" aria-label="Abrir chat de consultas" title="Consultar con Posgrado UNAC">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>
            </button>
            <div class="chat-window" id="chat-window" role="region" aria-label="Ventana de chat de admisiones">
                <!-- Header -->
                <div class="chat-header">
                    <div class="agent-avatar">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                    </div>
                    <div class="agent-info">
                        <div class="agent-title-row">
                            <h3>${this.options.agentName}</h3>
                            <span class="agent-badge" id="agent-type-badge">Virtual</span>
                        </div>
                        <div class="agent-status" id="agent-status-label">En línea</div>
                    </div>
                    <div class="chat-header-actions">
                        <button class="header-action-btn" id="chat-reset-btn" title="Nueva consulta (Reiniciar conversación)" aria-label="Nueva consulta">
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                        </button>
                        <button class="header-action-btn" id="chat-close-btn" title="Cerrar chat" aria-label="Cerrar">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                </div>

                <!-- Messages container -->
                <div class="chat-messages" id="chat-messages" aria-live="polite">
                    <!-- Dynamic messages -->
                </div>

                <!-- Quick actions / Suggestions bar -->
                <div class="chat-quick-suggestions" id="chat-quick-suggestions">
                    <button class="quick-chip" data-query="¿Cuáles son las maestrías disponibles?">Maestrías</button>
                    <button class="quick-chip" data-query="¿Cuáles son las fechas de admisión?">Fechas de Admisión</button>
                    <button class="quick-chip" data-query="¿Cuáles son los costos y pagos?">Costos</button>
                    <button class="quick-chip" data-query="Quiero hablar con un asesor">Hablar con Asesor</button>
                </div>

                <!-- Input Area -->
                <div class="chat-input-area">
                    <input type="text" id="chat-input" placeholder="Escribe tu consulta sobre posgrado..." autocomplete="off" maxlength="1000">
                    <button class="send-btn" id="chat-send" aria-label="Enviar mensaje" title="Enviar">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(container);
    }

    addEventListeners() {
        const launcher = document.getElementById('chat-launcher');
        const closeBtn = document.getElementById('chat-close-btn');
        const resetBtn = document.getElementById('chat-reset-btn');
        const input = document.getElementById('chat-input');
        const sendBtn = document.getElementById('chat-send');
        const suggestions = document.getElementById('chat-quick-suggestions');

        launcher?.addEventListener('click', () => this.toggleChat());
        closeBtn?.addEventListener('click', () => this.toggleChat(false));
        resetBtn?.addEventListener('click', () => this.confirmResetChat());

        sendBtn?.addEventListener('click', () => this.handleSendMessage());
        input?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSendMessage();
        });

        // Quick chips
        suggestions?.addEventListener('click', (e) => {
            const chip = e.target.closest('.quick-chip');
            if (chip && chip.dataset.query) {
                const queryText = chip.dataset.query;
                if (input) input.value = queryText;
                this.handleSendMessage();
            }
        });
    }

    toggleChat(forceState) {
        this.isOpen = typeof forceState === 'boolean' ? forceState : !this.isOpen;
        const windowEl = document.getElementById('chat-window');
        const launcher = document.getElementById('chat-launcher');

        if (this.isOpen) {
            windowEl?.classList.add('active');
            launcher?.classList.add('active');
            launcher.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
            document.getElementById('chat-input')?.focus();
            this.startPolling();
        } else {
            windowEl?.classList.remove('active');
            launcher?.classList.remove('active');
            launcher.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>`;
            this.stopPolling();
        }
    }

    /**
     * Sincroniza o valida la sesión con el backend
     */
    async syncSession() {
        try {
            const res = await fetch(`${this.apiUrl}/v1/chat/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ visitorId: this.visitorId })
            });

            if (!res.ok) throw new Error('Error de conexión');

            const data = await res.json();
            if (data.session_id) {
                this.setStoredVisitorId(data.session_id);
            }

            this.updateStatusUI(data.status || 'bot');

            // Renderizar mensajes recuperados
            const messagesContainer = document.getElementById('chat-messages');
            if (messagesContainer) messagesContainer.innerHTML = '';

            if (Array.isArray(data.messages) && data.messages.length > 0) {
                this.messages = [];
                data.messages.forEach(msg => {
                    const sender = msg.sender_type === 'user' ? 'user' : (msg.sender_type === 'dashboard' ? 'human' : 'agent');
                    this.appendMessageToDOM(sender, msg.text, msg.created_at);
                });
            } else {
                this.appendMessageToDOM('agent', this.options.welcomeMessage);
            }
        } catch (err) {
            console.warn('[ChatWidget] Modo sin conexión directa:', err.message);
            const messagesContainer = document.getElementById('chat-messages');
            if (messagesContainer && messagesContainer.children.length === 0) {
                this.appendMessageToDOM('agent', this.options.welcomeMessage);
            }
        }
    }

    /**
     * Envío de mensaje del usuario al backend
     */
    async handleSendMessage() {
        if (this.isSending) return;
        const input = document.getElementById('chat-input');
        const text = input?.value.trim();
        if (!text) return;

        input.value = '';
        this.appendMessageToDOM('user', text);
        this.showTypingIndicator();
        this.isSending = true;

        try {
            const res = await fetch(`${this.apiUrl}/v1/chat/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    visitorId: this.visitorId,
                    text
                })
            });

            this.hideTypingIndicator();

            if (!res.ok) {
                throw new Error('No se pudo entregar el mensaje');
            }

            const data = await res.json();
            if (data.session_id && data.session_id !== this.visitorId) {
                this.setStoredVisitorId(data.session_id);
            }

            if (data.status) {
                this.updateStatusUI(data.status);
            }

            if (data.reply) {
                this.appendMessageToDOM('agent', data.reply);
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
     * Polling periódico para recibir respuestas de asesores humanos en tiempo real
     */
    startPolling() {
        this.stopPolling();
        this.pollInterval = setInterval(async () => {
            if (!this.isOpen || !this.visitorId) return;
            try {
                const res = await fetch(`${this.apiUrl}/v1/chat/history?visitorId=${encodeURIComponent(this.visitorId)}`);
                if (!res.ok) return;

                const data = await res.json();
                if (data.status) this.updateStatusUI(data.status);

                if (Array.isArray(data.messages)) {
                    const currentCount = document.querySelectorAll('#chat-messages .message:not(.system)').length;
                    if (data.messages.length > currentCount) {
                        const newMsgs = data.messages.slice(currentCount);
                        newMsgs.forEach(m => {
                            const sender = m.sender_type === 'user' ? 'user' : (m.sender_type === 'dashboard' ? 'human' : 'agent');
                            this.appendMessageToDOM(sender, m.text, m.created_at);
                        });
                    }
                }
            } catch (e) {
                // Polling silencioso
            }
        }, 3000);
    }

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    /**
     * Reiniciar chat ("Nueva consulta")
     */
    async confirmResetChat() {
        if (!confirm('¿Deseas iniciar una nueva consulta? Se abrirá una conversación fresca.')) {
            return;
        }

        try {
            const res = await fetch(`${this.apiUrl}/v1/chat/reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ visitorId: this.visitorId })
            });

            if (res.ok) {
                const data = await res.json();
                this.setStoredVisitorId(data.session_id);
                this.updateStatusUI('bot');

                const messagesContainer = document.getElementById('chat-messages');
                if (messagesContainer) messagesContainer.innerHTML = '';

                const welcome = data.messages?.[0]?.text || this.options.welcomeMessage;
                this.appendMessageToDOM('agent', welcome);
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
                statusLabel.textContent = 'Asesor conectado';
            }
        } else {
            if (badge) {
                badge.textContent = 'Virtual';
                badge.className = 'agent-badge';
            }
            if (statusLabel) {
                statusLabel.textContent = 'En línea';
            }
        }
    }

    appendMessageToDOM(sender, text, timestamp) {
        const messagesContainer = document.getElementById('chat-messages');
        if (!messagesContainer || !text) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;

        if (sender === 'human') {
            messageDiv.innerHTML = `
                <div class="message-sender-tag">Asesor Académico</div>
                <div class="message-body">${this.escapeHTML(text)}</div>
            `;
        } else {
            messageDiv.textContent = text;
        }

        messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
    }

    escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    showTypingIndicator() {
        const messagesContainer = document.getElementById('chat-messages');
        if (!messagesContainer || document.getElementById('typing-indicator')) return;

        const typingDiv = document.createElement('div');
        typingDiv.className = 'typing';
        typingDiv.id = 'typing-indicator';
        typingDiv.innerHTML = `
            <div class="dot"></div>
            <div class="dot"></div>
            <div class="dot"></div>
        `;
        messagesContainer.appendChild(typingDiv);
        this.scrollToBottom();
    }

    hideTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) indicator.remove();
    }

    scrollToBottom() {
        const container = document.getElementById('chat-messages');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }
}

// Auto-inicialización
if (typeof window !== 'undefined') {
    window.ChatAgent = ChatAgent;
    window.addEventListener('DOMContentLoaded', () => {
        if (!window.chatAgentInstance) {
            window.chatAgentInstance = new ChatAgent();
        }
    });
}
