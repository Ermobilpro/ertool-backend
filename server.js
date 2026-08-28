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

/* ---------------- Datos de cada empresa ---------------- */
function archivoEmpresa(slug) { return path.join(EMPRESAS_DIR, slug + '.json'); }

app.get('/api/db', (req, res) => {
  const slug = req.query.empresa;
  const e = leerRegistro().find(x => x.slug === slug);
  if (!e) return res.status(404).json({ error: 'Empresa no encontrada. Pide a soporte que la cree.' });
  const archivo = archivoEmpresa(slug);
  if (!fs.existsSync(archivo)) return res.json({}); // el front completa con su defaultDB()
  try {
    res.json(JSON.parse(fs.readFileSync(archivo, 'utf-8')));
  } catch (e2) {
    res.status(500).json({ error: 'No se pudo leer la información de la empresa.' });
  }
});
app.post('/api/db', (req, res) => {
  const slug = req.query.empresa;
  const e = leerRegistro().find(x => x.slug === slug);
  if (!e) return res.status(404).json({ error: 'Empresa no encontrada.' });
  try {
    fs.writeFileSync(archivoEmpresa(slug), JSON.stringify(req.body));
    res.json({ ok: true });
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
