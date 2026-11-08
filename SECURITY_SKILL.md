REGLAS DE SEGURIDAD (SHIFT-LEFT): 
1. Siempre parametriza las consultas a bases de datos (especialmente en MySQL) para prevenir inyecciones SQL. 
2. Sanitiza todos los inputs del usuario antes de procesarlos en el backend (Node.js) o renderizarlos en el frontend (XSS prevention). 
3. No expongas claves de API en el código cliente; usa variables de entorno del lado del servidor. 
4. Antes de instalar un nuevo paquete de dependencias, verifica su legitimidad para evitar vulnerabilidades en la cadena de suministro.
