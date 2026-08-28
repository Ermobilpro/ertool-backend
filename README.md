# ertool-backend — servidor de ER TOOL

Backend pequeño e independiente para **ER TOOL** (control de préstamos diarios por ruta).
Guarda los datos de cada empresa y controla cuáles empresas están activas — es la pieza que
hace posible que soporte (tú) le dé o le quite acceso a una empresa al instante, sin tener que
generar ni repartir ninguna clave.

## 1. Instalar y probar localmente

```bash
cd backend
npm install
SOPORTE_MASTER_KEY=escoge-una-clave-larga npm start
```

Queda escuchando en `http://localhost:8788`. Pruébalo con `curl http://localhost:8788/health`.

## 2. Variables de entorno

| Variable | Obligatoria | Para qué |
|---|---|---|
| `SOPORTE_MASTER_KEY` | Sí | La clave que usarás para entrar al Panel de Soporte dentro de ER TOOL (crear empresas, activarlas/desactivarlas). Escoge una larga y guárdala en un lugar seguro — quien la tenga puede crear y gestionar cualquier empresa. |
| `PORT` | No | Puerto donde escucha (Railway la define solo). |
| `DATA_DIR` | No | Dónde se guardan los archivos de datos. Por defecto `./data`. **Ver aviso abajo.** |

## 3. Desplegar en Railway (recomendado)

1. Sube el contenido de esta carpeta `backend/` a un repositorio de Git.
2. En [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** → selecciona el repositorio.
3. En **Variables**, agrega `SOPORTE_MASTER_KEY` con tu clave.
4. En **Settings → Networking**, genera un dominio público.
5. **Muy importante — persistencia:** por defecto los datos se guardan en un archivo dentro del
   propio contenedor, y Railway borra ese disco cada vez que se vuelve a desplegar. Antes de usar
   esto con datos reales, ve a **Settings → Volumes**, crea un volumen y móntalo por ejemplo en
   `/app/data`, y agrega la variable `DATA_DIR=/app/data`. Así los préstamos, clientes y fotos
   sobreviven a cada actualización del programa.

## 4. Conectar ER TOOL con este backend

Ya no tienes que hacer nada para este paso: `ER_TOOL.html` viene incluido dentro de esta misma
carpeta `backend/`, y el servidor ya está configurado para servirlo. Programa y API quedan en el
mismo dominio (sin CORS que configurar ni sitios aparte que mantener). Si algún día prefieres
alojar el archivo en otro lugar (Netlify, Vercel, etc.), solo cambia las llamadas `fetch('/api/...')`
del archivo por la URL completa de este backend.

## 5. Primeros pasos una vez desplegado

1. Abre `https://tu-backend.up.railway.app/?empresa=_soporte` e ingresa tu `SOPORTE_MASTER_KEY`.
2. Crea tu primera empresa (nombre + código corto para el link).
3. Copia el link que te da ("Copiar link") y ábrelo — esa es la app para esa empresa.
4. Dentro, inicia sesión con el usuario de soporte que trae por defecto cada empresa nueva
   (usuario `soporte`, clave `cambiar-esta-clave`) **y cámbiala de inmediato** desde
   Usuarios → editar, o crea tu propio usuario administrador y desactiva el de soporte que no
   quede en uso.
5. Desde el usuario administrador de esa empresa, crea las rutas, los cobradores, los clientes
   (con sus fotos de verificación) y empieza a registrar préstamos.

## 6. Seguridad — qué es liviano en esta primera versión

- Las claves de los usuarios de cada empresa se comparan con un hash simple calculado en el
  propio navegador (igual de robusto que el que ya usa ER Mobile Pro). No es cifrado de nivel
  bancario; para un negocio pequeño es razonable, pero si más adelante manejas muchos usuarios o
  datos más sensibles, vale la pena mover esa validación al backend.
- La clave de soporte (`SOPORTE_MASTER_KEY`) protege la creación/activación de empresas, pero
  viaja en un header simple — usa siempre HTTPS (Railway lo da por defecto) y no la compartas.
- Las fotos de cédula/selfie se guardan como imagen dentro del mismo archivo de datos de la
  empresa (comprimidas en el navegador antes de subirlas). Para volúmenes grandes de clientes,
  a futuro conviene moverlas a un almacenamiento de archivos aparte (ej. S3/Cloudinary) en vez
  de guardarlas incrustadas.
