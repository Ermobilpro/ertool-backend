/**
 * ER TOOL — servidor backend
 * -----------------------------------------------------------------------
 * Guarda los datos de cada empresa en un archivo JSON (uno por empresa) y
 * mantiene un "registro" central de empresas (nombre, código/slug, si está
 * activa, hasta cuándo). El registro es lo que controla el acceso: cuando
 * soporte activa/extiende/bloquea una empresa desde el Panel de Soporte de
 * ER TOOL, el cambio queda aquí y aplica al instante en todos los
 * dispositivos de esa empresa (no depende de repartir una clave).
 *
 * IMPORTANTE — persistencia en Railway: por defecto este servidor guarda
 * los archivos en ./data, que en Railway vive en un disco EFÍMERO (se
 * borra en cada redeploy). Para no perder datos, monta un Volume de
 * Railway en la ruta que apunte la variable de entorno DATA_DIR (o en
 * /app/data si la dejas por defecto). Está explicado en el README.
 */
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' })); // las fotos KYC van en base64, pueden pesar

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const EMPRESAS_DIR = path.join(DATA_DIR, 'empresas');
const REGISTRY_FILE = path.join(DATA_DIR, 'registry.json');
const SOPORTE_MASTER_KEY = process.env.SOPORTE_MASTER_KEY || '';

if (!fs.existsSync(EMPRESAS_DIR)) fs.mkdirSync(EMPRESAS_DIR, { recursive: true });
if (!fs.existsSync(REGISTRY_FILE)) fs.writeFileSync(REGISTRY_FILE, '[]');

function leerRegistro() {
  try { return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8')); } catch (e) { return []; }
}
function guardarRegistro(lista) {
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(lista, null, 2));
}
function slugValido(slug) {
  return typeof slug === 'string' && /^[a-z0-9-]{2,40}$/.test(slug) && slug !== '_soporte';
}
function empresaActiva(e) {
  if (!e) return false;
  if (e.activa === false) return false;
  if (e.permanente) return true;
  if (!e.vence) return false;
  const hoy = new Date().toISOString().slice(0, 10);
  return e.vence >= hoy;
}
function requiereSoporte(req, res, next) {
  if (!SOPORTE_MASTER_KEY) {
    return res.status(500).json({ error: 'El servidor no tiene configurada SOPORTE_MASTER_KEY. Ver README.' });
  }
  const key = req.header('X-Soporte-Key') || '';
  if (key !== SOPORTE_MASTER_KEY) return res.status(401).json({ error: 'Clave de soporte incorrecta.' });
  next();
}

app.get('/health', (req, res) => res.json({ ok: true }));

/* ---------------- Registro de empresas (solo soporte) ---------------- */
app.get('/api/registry', requiereSoporte, (req, res) => {
  res.json(leerRegistro());
});
app.post('/api/registry', requiereSoporte, (req, res) => {
  const { slug, nombre, vence, permanente } = req.body || {};
  if (!slugValido(slug) || !nombre) {
    return res.status(400).json({ error: 'Datos inválidos. El código solo puede tener minúsculas, números y guiones.' });
  }
  const lista = leerRegistro();
  if (lista.some(e => e.slug === slug)) return res.status(409).json({ error: 'Ese código ya existe.' });
  const nueva = { slug, nombre, vence: vence || null, permanente: !!permanente, activa: true, creada: new Date().toISOString().slice(0, 10) };
  lista.push(nueva);
  guardarRegistro(lista);
  res.json(nueva);
});
app.patch('/api/registry/:slug', requiereSoporte, (req, res) => {
  const lista = leerRegistro();
  const e = lista.find(x => x.slug === req.params.slug);
  if (!e) return res.status(404).json({ error: 'No existe esa empresa.' });
  const { activa, vence, permanente, nombre } = req.body || {};
  if (typeof activa === 'boolean') e.activa = activa;
  if (typeof permanente === 'boolean') e.permanente = permanente;
  if (vence !== undefined) e.vence = vence || null;
  if (nombre) e.nombre = nombre;
  guardarRegistro(lista);
  res.json(e);
});

/* ---------------- Licencia pública (la consulta el front al arrancar) ---------------- */
app.get('/api/licencia', (req, res) => {
  const slug = req.query.empresa;
  const e = leerRegistro().find(x => x.slug === slug);
  if (!e) return res.status(404).json({ error: 'Empresa no encontrada.' });
  res.json({ nombre: e.nombre, activa: empresaActiva(e), vence: e.vence, permanente: e.permanente });
});

/* ---------------- Datos de cada empresa ----------------
   Escritura ATÓMICA con respaldo: primero se escribe en un archivo temporal,
   luego se copia el archivo actual (si existe) a ".bak", y solo al final se
   renombra el temporal al nombre real — así, si el proceso se cae justo en
   medio de un guardado, nunca queda un archivo a medio escribir. Si al leer
   el archivo principal resulta que quedó corrupto de todas formas, se cae
   automáticamente al ".bak" antes de rendirse.

   Control de versión (para que dos cobradores guardando casi al mismo
   tiempo no se pisen el trabajo uno al otro): cada empresa guarda un
   contador "_version" dentro de su propio JSON. El cliente manda la
   versión con la que cargó los datos; si alguien más ya guardó una versión
   más nueva mientras tanto, se rechaza el guardado con 409 en vez de
   sobrescribir en silencio lo que el otro acaba de guardar. Datos viejos
   sin "_version" (de antes de este cambio) se dejan pasar una vez, para
   no bloquear empresas que ya tenían información. */
function archivoEmpresa(slug) { return path.join(EMPRESAS_DIR, slug + '.json'); }
function leerDatosEmpresaConRespaldo(slug) {
  const archivo = archivoEmpresa(slug);
  if (!fs.existsSync(archivo)) return null; // empresa registrada pero sin datos guardados todavía
  try {
    return JSON.parse(fs.readFileSync(archivo, 'utf-8'));
  } catch (e) {
    const bak = archivo + '.bak';
    if (fs.existsSync(bak)) {
      try { return JSON.parse(fs.readFileSync(bak, 'utf-8')); } catch (e2) { /* el respaldo también está corrupto */ }
    }
    throw e;
  }
}
function guardarDatosEmpresaAtomico(slug, datos) {
  const archivo = archivoEmpresa(slug);
  const tmp = archivo + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(datos));
  if (fs.existsSync(archivo)) {
    try { fs.copyFileSync(archivo, archivo + '.bak'); } catch (e) { /* si falla la copia de respaldo, se sigue igual con el guardado */ }
  }
  fs.renameSync(tmp, archivo);
}

app.get('/api/db', (req, res) => {
  const slug = req.query.empresa;
  const e = leerRegistro().find(x => x.slug === slug);
  if (!e) return res.status(404).json({ error: 'Empresa no encontrada. Pide a soporte que la cree.' });
  try {
    const datos = leerDatosEmpresaConRespaldo(slug);
    res.json(datos || {}); // sin datos todavía: el front completa con su defaultDB()
  } catch (e2) {
    res.status(500).json({ error: 'No se pudo leer la información de la empresa (archivo dañado, y el respaldo también).' });
  }
});
app.post('/api/db', (req, res) => {
  const slug = req.query.empresa;
  const e = leerRegistro().find(x => x.slug === slug);
  if (!e) return res.status(404).json({ error: 'Empresa no encontrada.' });
  let actual;
  try {
    actual = leerDatosEmpresaConRespaldo(slug);
  } catch (e2) {
    return res.status(500).json({ error: 'No se pudo verificar la información actual antes de guardar.' });
  }
  const versionActual = (actual && typeof actual._version === 'number') ? actual._version : 0;
  const versionCliente = (req.body && typeof req.body._version === 'number') ? req.body._version : null;
  if (versionActual > 0 && versionCliente !== null && versionCliente < versionActual) {
    return res.status(409).json({ error: 'CONFLICTO_VERSION', mensaje: 'Alguien más ya guardó cambios más nuevos de esta empresa.', versionActual });
  }
  const nuevaVersion = versionActual + 1;
  const datosAGuardar = Object.assign({}, req.body, { _version: nuevaVersion });
  try {
    guardarDatosEmpresaAtomico(slug, datosAGuardar);
    res.json({ ok: true, version: nuevaVersion });
  } catch (e2) {
    res.status(500).json({ error: 'No se pudo guardar.' });
  }
});

// Sirve la app (ER_TOOL.html) desde este mismo servidor, para que todo quede
// en una sola URL: la API y el programa comparten dominio y no hay que
// configurar CORS aparte ni alojarlo en otro sitio.
app.use(express.static(__dirname));
app.get('/', (req, res) => res.redirect('/ER_TOOL.html' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')));

const PORT = process.env.PORT || 8788;
app.listen(PORT, () => console.log('ER TOOL backend escuchando en puerto ' + PORT));
