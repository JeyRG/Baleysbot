-- =========================================================================
-- ESQUEMA SQL LOCAL PARA BASE DE DATOS DE INSCRIPCIONES (POSTGRESQL / MYSQL COMPATIBLE)
-- Archivo: base-js-baileys-memory/migrations/schema_local_sql.sql
-- =========================================================================

-- 1. Tabla de Personas
CREATE TABLE IF NOT EXISTS personas (
    id_persona VARCHAR(64) PRIMARY KEY,
    id_usuario VARCHAR(64) UNIQUE,
    dni VARCHAR(20) NOT NULL UNIQUE,
    nombres VARCHAR(150) NOT NULL,
    apellidos VARCHAR(150) NOT NULL,
    fecha_nacimiento DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla de Teléfonos de Personas
CREATE TABLE IF NOT EXISTS persona_telefonos (
    id_telefono VARCHAR(64) PRIMARY KEY,
    id_persona VARCHAR(64) REFERENCES personas(id_persona) ON DELETE CASCADE,
    numero VARCHAR(30) NOT NULL,
    tipo VARCHAR(30) DEFAULT 'movil',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabla de Unidades Académicas / Facultades
CREATE TABLE IF NOT EXISTS unidades (
    id_unidad VARCHAR(64) PRIMARY KEY,
    nombre_unidad VARCHAR(255) NOT NULL,
    director_unidad VARCHAR(150),
    acronimo_facultad VARCHAR(50),
    link_recursos VARCHAR(255),
    correo_unidad TEXT,
    telefono_unidad VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tipos de Programas (Maestría, Doctorado, etc.)
CREATE TABLE IF NOT EXISTS tipos_programas (
    id_tipoprograma VARCHAR(64) PRIMARY KEY,
    nombre_tipoprograma VARCHAR(100),
    costos TEXT,
    requisitos TEXT,
    numero_cuenta VARCHAR(100),
    duracion_programa VARCHAR(100),
    creditos_programa VARCHAR(50),
    costo_per_ciclo VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Programas Académicos
CREATE TABLE IF NOT EXISTS programas (
    id_programa VARCHAR(64) PRIMARY KEY,
    id_unidad VARCHAR(64) REFERENCES unidades(id_unidad) ON DELETE SET NULL,
    id_tipoprograma VARCHAR(64) REFERENCES tipos_programas(id_tipoprograma) ON DELETE SET NULL,
    nombre_programa VARCHAR(255) NOT NULL,
    descripcion TEXT,
    link_ws VARCHAR(255),
    perfiles_programa JSON,
    malla_curricular JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Inscripciones a Programas
CREATE TABLE IF NOT EXISTS inscripciones (
    id_inscrito VARCHAR(64) PRIMARY KEY,
    id_persona VARCHAR(64) NOT NULL REFERENCES personas(id_persona) ON DELETE CASCADE,
    id_programa VARCHAR(64) REFERENCES programas(id_programa) ON DELETE SET NULL,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    medio_conocimiento VARCHAR(100),
    notificado_ws BOOLEAN DEFAULT FALSE,
    notificado_email BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Catálogo de Estados de Seguimiento
CREATE TABLE IF NOT EXISTS estados_seguimiento (
    id_estadoseguimiento VARCHAR(64) PRIMARY KEY,
    nombre_estado VARCHAR(100) NOT NULL
);

-- 8. Postulantes y Expedientes
CREATE TABLE IF NOT EXISTS postulantes (
    id_postulante VARCHAR(64) PRIMARY KEY,
    id_inscrito VARCHAR(64) UNIQUE REFERENCES inscripciones(id_inscrito) ON DELETE CASCADE,
    id_estadoseguimiento VARCHAR(64) REFERENCES estados_seguimiento(id_estadoseguimiento) ON DELETE SET NULL,
    carpeta_postulante VARCHAR(255),
    mensaje_estado TEXT,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expediente_json JSON,
    ultima_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revision_ai JSON,
    nota_admin TEXT
);

-- 9. Recursos y Documentos del Postulante
CREATE TABLE IF NOT EXISTS postulantes_recursos (
    id_recurso VARCHAR(64) PRIMARY KEY,
    id_postulante VARCHAR(64) REFERENCES postulantes(id_postulante) ON DELETE CASCADE,
    nombre_archivo VARCHAR(255),
    url_archivo VARCHAR(500),
    tipo_documento VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices de alto rendimiento para consultas
CREATE INDEX IF NOT EXISTS idx_personas_dni ON personas(dni);
CREATE INDEX IF NOT EXISTS idx_inscripciones_persona ON inscripciones(id_persona);
CREATE INDEX IF NOT EXISTS idx_inscripciones_programa ON inscripciones(id_programa);
CREATE INDEX IF NOT EXISTS idx_postulantes_inscrito ON postulantes(id_inscrito);
CREATE INDEX IF NOT EXISTS idx_postulantes_estado ON postulantes(id_estadoseguimiento);
