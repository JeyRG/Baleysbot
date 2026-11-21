class ChatAgent {
    constructor(options = {}) {
        this.options = {
            agentName: options.agentName || 'Baleys Bot',
            welcomeMessage: options.welcomeMessage || '¡Hola! ¿En qué puedo ayudarte hoy?',
            primaryColor: options.primaryColor || '#10b981',
            containerId: 'chat-agent-container'
        };
        this.isOpen = false;
        this.messages = [];
        this.init();
    }

    init() {
        this.injectStyles();
        this.createDOM();
        this.addEventListeners();
        this.addMessage('agent', this.options.welcomeMessage);
    }

    injectStyles() {
        // Assuming widget.css is loaded via <link>, but we could also inject it here
        // for maximum portability. For now, we rely on the user adding the CSS file.
    }

    createDOM() {
        const container = document.createElement('div');
        container.id = this.options.containerId;
        
        container.innerHTML = `
            <button class="chat-bubble-launcher" id="chat-launcher">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>
            </button>
            <div class="chat-window" id="chat-window">
                <div class="chat-header">
                    <div class="agent-avatar">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
                    </div>
                    <div class="agent-info">
                        <h3>${this.options.agentName}</h3>
                        <div class="agent-status">En línea</div>
                    </div>
                </div>
                <div class="chat-messages" id="chat-messages">
                    <!-- Messages will appear here -->
                </div>
                <div class="chat-input-area">
                    <input type="text" id="chat-input" placeholder="Escribe un mensaje..." autocomplete="off">
                    <button class="send-btn" id="chat-send">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(container);
    }

    addEventListeners() {
        const launcher = document.getElementById('chat-launcher');
        const input = document.getElementById('chat-input');
        const sendBtn = document.getElementById('chat-send');

        launcher.addEventListener('click', () => this.toggleChat());
        
        sendBtn.addEventListener('click', () => this.handleSendMessage());
        
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSendMessage();
        });
    }

    toggleChat() {
        this.isOpen = !this.isOpen;
        const window = document.getElementById('chat-window');
        const launcher = document.getElementById('chat-launcher');
        
        if (this.isOpen) {
            window.classList.add('active');
            launcher.classList.add('active');
            launcher.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
            document.getElementById('chat-input').focus();
        } else {
            window.classList.remove('active');
            launcher.classList.remove('active');
            launcher.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>`;
        }
    }

    handleSendMessage() {
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        
        if (text) {
            this.addMessage('user', text);
            input.value = '';
            
            // Simulate agent typing
            this.showTypingIndicator();
            
            // Mock API Logic - REPLACE THIS WITH YOUR REAL API CALL
            setTimeout(() => {
                this.hideTypingIndicator();
                this.mockAgentResponse(text);
            }, 1500);
        }
    }

    addMessage(sender, text) {
        const messagesContainer = document.getElementById('chat-messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        messageDiv.textContent = text;
        
        messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
    }

    showTypingIndicator() {
        const messagesContainer = document.getElementById('chat-messages');
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
        container.scrollTop = container.scrollHeight;
    }

    mockAgentResponse(userText) {
        let response = "Entiendo. ¿Hay algo más en lo que pueda ayudarte?";
        
        const text = userText.toLowerCase();
        if (text.includes('hola') || text.includes('buenos')) {
            response = "¡Hola! Estoy aquí para ayudarte. ¿Qué tienes en mente?";
        } else if (text.includes('precio') || text.includes('costo')) {
            response = "Nuestros planes son flexibles. Puedes consultar nuestra sección de precios en el dashboard principal.";
        } else if (text.includes('quien eres') || text.includes('ayuda')) {
            response = "Soy tu asistente inteligente. Puedo responder preguntas frecuentes o guiarte a través de la plataforma.";
        }
        
        this.addMessage('agent', response);
    }
}

// Initialize the widget
window.ChatAgent = ChatAgent;
