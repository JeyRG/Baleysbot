// Dashboard Interactivity
document.addEventListener('DOMContentLoaded', () => {
    console.log('Bot2703 Dashboard Initialized');

    // Add hover effects or dynamic updates here if needed
    const statCards = document.querySelectorAll('.stat-card');
    
    statCards.forEach(card => {
        card.addEventListener('mouseenter', () => {
            card.style.borderColor = 'var(--accent-color)';
            card.style.boxShadow = '0 10px 30px rgba(35, 134, 54, 0.1)';
        });

        card.addEventListener('mouseleave', () => {
            card.style.borderColor = 'var(--border-color)';
            card.style.boxShadow = 'none';
        });
    });

    // Auto-refresh logic could go here (polling PHP endpoint)
});
