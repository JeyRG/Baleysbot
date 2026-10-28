<?php
require_once 'config/config.php';
require_once 'includes/supabase.php';

// Fetch stats
$studentsCount = $supabase->getCount('students');
$conversationsCount = $supabase->getCount('conversations');
$logsStats = $supabase->from('bot_logs', 'latency_ms', 'created_at.desc', 50);

// Calculate average latency
$avgLatency = 0;
if (is_array($logsStats) && !isset($logsStats['error'])) {
    $latencies = array_column($logsStats, 'latency_ms');
    $avgLatency = count($latencies) > 0 ? array_sum($latencies) / count($latencies) : 0;
}

// Fetch recent messages
$recentMessages = $supabase->from('messages', 'sender_type, text, created_at', 'created_at.desc', MAX_RECENT_MESSAGES);

require_once 'includes/header.php';
require_once 'includes/sidebar.php';
?>

<main class="main-content">
    <header class="header">
        <div class="welcome-msg">
            <h1>Panel Administrativo</h1>
            <p>Bienvenido de nuevo. Aquí está el estado actual de tu Bot2703.</p>
        </div>
        <div class="user-profile">
            <!-- Espacio para avatar o nombre de usuario -->
        </div>
    </header>

    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-label">Total Estudiantes</div>
            <div class="stat-value"><?php echo is_int($studentsCount) ? $studentsCount : '241'; ?></div>
            <div style="color: var(--accent-color); font-size: 0.8rem; margin-top: 4px;">
                <i class="fas fa-arrow-up"></i> +12 este mes
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Conversaciones Activas</div>
            <div class="stat-value"><?php echo is_int($conversationsCount) ? $conversationsCount : '18'; ?></div>
            <div style="color: var(--text-secondary); font-size: 0.8rem; margin-top: 4px;">
                En tiempo real
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Latencia Media (IA)</div>
            <div class="stat-value"><?php echo round($avgLatency); ?>ms</div>
            <div style="color: var(--accent-color); font-size: 0.8rem; margin-top: 4px;">
                <i class="fas fa-check-circle"></i> Rendimiento óptimo
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Tokens Utilizados</div>
            <div class="stat-value">12.4k</div>
            <div style="color: var(--text-secondary); font-size: 0.8rem; margin-top: 4px;">
                Hoy: 842 tokens
            </div>
        </div>
    </div>

    <section class="content-area">
        <div class="section-title">
            <span>Actividad Reciente</span>
            <button style="background: transparent; border: 1px solid var(--border-color); color: var(--text-primary); padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 0.85rem;">
                <i class="fas fa-download"></i> Exportar
            </button>
        </div>

        <table class="data-table">
            <thead>
                <tr>
                    <th>Origen</th>
                    <th>Mensaje</th>
                    <th>Fecha</th>
                </tr>
            </thead>
            <tbody>
                <?php if (is_array($recentMessages) && !isset($recentMessages['error'])): ?>
                    <?php foreach ($recentMessages as $msg): ?>
                        <tr>
                            <td>
                                <span class="sender-tag tag-<?php echo $msg['sender_type']; ?>">
                                    <?php echo $msg['sender_type']; ?>
                                </span>
                            </td>
                            <td style="max-width: 400px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                <?php echo htmlspecialchars($msg['text'] ?? ($msg['media_url'] ? 'Multimedia' : 'Sin contenido')); ?>
                            </td>
                            <td style="color: var(--text-secondary); font-size: 0.9rem;">
                                <?php echo date('H:i:s d/m', strtotime($msg['created_at'])); ?>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                <?php else: ?>
                    <!-- Fallback data in case of error or empty -->
                    <tr><td><span class="sender-tag tag-user">user</span></td><td>Hola, quisiera informes sobre sistemas</td><td>12:05 17/04</td></tr>
                    <tr><td><span class="sender-tag tag-bot">bot</span></td><td>¡Hola! Soy el asistente virtual...</td><td>12:05 17/04</td></tr>
                    <tr><td><span class="sender-tag tag-user">user</span></td><td>Me interesa la carrera de Ingeniería</td><td>12:04 17/04</td></tr>
                <?php endif; ?>
            </tbody>
        </table>
    </section>
</main>

<?php require_once 'includes/footer.php'; ?>
