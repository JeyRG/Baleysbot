-- =========================================================================
-- MIGRACIÓN: Métricas de Usuario y Condición (Postulante / Estudiante / Egresado)
-- =========================================================================

-- 1. Agregar columna de condición a la tabla 'students'
ALTER TABLE public.students 
ADD COLUMN IF NOT EXISTS student_condition TEXT;

CREATE INDEX IF NOT EXISTS idx_students_condition ON public.students(student_condition);

-- 2. Agregar nombre y condición del usuario a 'chatbot_interactions' para análisis analítico/métricas
ALTER TABLE public.chatbot_interactions 
ADD COLUMN IF NOT EXISTS user_name TEXT,
ADD COLUMN IF NOT EXISTS user_condition TEXT;

CREATE INDEX IF NOT EXISTS idx_chatbot_interactions_condition ON public.chatbot_interactions(user_condition);
CREATE INDEX IF NOT EXISTS idx_chatbot_interactions_user_name ON public.chatbot_interactions(user_name);

-- 3. Agregar nombre y condición a 'unresolved_queries'
ALTER TABLE public.unresolved_queries 
ADD COLUMN IF NOT EXISTS user_name TEXT,
ADD COLUMN IF NOT EXISTS user_condition TEXT;

-- 4. Vista analítica para consultas por condición/rol
CREATE OR REPLACE VIEW public.metrics_interactions_by_condition AS
SELECT 
    COALESCE(user_condition, 'no_especificado') AS condicion,
    COUNT(*) AS total_consultas,
    COUNT(DISTINCT wa_id) AS total_usuarios_unicos,
    COUNT(CASE WHEN reviewed THEN 1 END) AS consultas_revisadas,
    COUNT(CASE WHEN is_correct = true THEN 1 END) AS respuestas_correctas,
    COUNT(CASE WHEN is_correct = false THEN 1 END) AS respuestas_incorrectas
FROM public.chatbot_interactions
GROUP BY COALESCE(user_condition, 'no_especificado');
