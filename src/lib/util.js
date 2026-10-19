export const slug = (s) =>
  s.toString().toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export const cop = (n) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

const TZ = "America/Bogota";
// Una fecha sin hora ("2026-10-19") se toma a mediodía UTC para que no cambie de día en Colombia
const aFecha = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00Z`) : new Date(d));
export const fechaCO = (d) => aFecha(d).toLocaleDateString("es-CO", { timeZone: TZ });
export const fechaLargaCO = (d) => aFecha(d).toLocaleDateString("es-CO", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
export const fechaHoraCO = (d) =>
  new Date(d).toLocaleString("es-CO", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
export const fechaISO = (d = new Date()) => new Date(d).toLocaleDateString("en-CA", { timeZone: TZ });

export const numeroCot = (n) => String(n).padStart(3, "0");

export const textoWhatsApp = (cel) => `https://wa.me/57${cel.replace(/\D/g, "").replace(/^57(?=\d{10}$)/, "")}`;

// ---------- Valor en letras (pesos colombianos) ----------
const UNIDADES = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
  "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte",
  "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const DECENAS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const CENTENAS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

// "uno" pierde la o delante de mil, millones y pesos: veintiún mil, un millón, ciento un pesos
const apocope = (s) => s.replace(/veintiuno$/, "veintiún").replace(/uno$/, "un");

function menorMil(n) {
  if (n === 100) return "cien";
  const r = n % 100;
  const dec = r < 30 ? UNIDADES[r] : `${DECENAS[Math.floor(r / 10)]}${r % 10 ? ` y ${UNIDADES[r % 10]}` : ""}`;
  return [CENTENAS[Math.floor(n / 100)], dec].filter(Boolean).join(" ");
}

function menorMillon(n) {
  const miles = Math.floor(n / 1000), resto = n % 1000;
  return [miles === 1 ? "mil" : miles ? `${apocope(menorMil(miles))} mil` : "", resto ? menorMil(resto) : ""].filter(Boolean).join(" ");
}

export function enLetras(valor) {
  const n = Math.floor(Math.abs(Number(valor) || 0));
  if (n === 0) return "Cero pesos m/cte.";
  const millones = Math.floor(n / 1e6), resto = n % 1e6;
  let s = [
    millones === 1 ? "un millón" : millones ? `${apocope(menorMillon(millones))} millones` : "",
    resto ? menorMillon(resto) : "",
  ].filter(Boolean).join(" ");
  if (!resto) s += " de";
  s = `${apocope(s)} ${n === 1 ? "peso" : "pesos"} m/cte.`;
  return s[0].toUpperCase() + s.slice(1);
}

// ---------- Estado de una cotización (se deriva de sus datos) ----------
export const ESTADOS = {
  cotizada: { etiqueta: "Cotizada", fondo: "#eef0ec", color: "#4a534d" },
  aprobada: { etiqueta: "Aprobada", fondo: "#e6f1fb", color: "#0c447c" },
  entregada: { etiqueta: "Entregada", fondo: "#eaf3de", color: "#27500a" },
  cobrada: { etiqueta: "Cobrada", fondo: "#faeeda", color: "#633806" },
  pagada: { etiqueta: "Pagada", fondo: "#1f2a24", color: "#fff" },
};

export function estadoCotizacion(cot, entrega, cuenta) {
  if (cot.cuenta_cobro_id) return cuenta?.estado === "pagada" ? "pagada" : "cobrada";
  if (entrega) return "entregada";
  return cot.aprobada_en ? "aprobada" : "cotizada";
}

export const PISOS = Array.from({ length: 50 }, (_, i) => i + 1);

// Agrupa una lista de {torre, piso} en texto tipo "Torre 1: Pisos 1, 5, 6 · Torre 2: Pisos 2, 3"
export function agruparPorTorre(pisos) {
  const porTorre = {};
  pisos.forEach((p) => { (porTorre[p.torre] = porTorre[p.torre] || []).push(p.piso); });
  return Object.keys(porTorre).map(Number).sort((a, b) => a - b)
    .map((t) => `Torre ${t}: Pisos ${porTorre[t].slice().sort((a, b) => a - b).join(", ")}`)
    .join("\n");
}

// Agrupa entradas de rociadores {torre, cuartoBasuras, ultimoPiso} por torre
export function agruparRociadores(entradas) {
  const porTorre = {};
  entradas.forEach((e) => { (porTorre[e.torre] = porTorre[e.torre] || []).push(e); });
  return Object.keys(porTorre).map(Number).sort((a, b) => a - b)
    .map((t) => {
      const ubicaciones = [];
      if (porTorre[t].some((e) => e.cuartoBasuras)) ubicaciones.push("Cuarto de basuras");
      if (porTorre[t].some((e) => e.ultimoPiso)) ubicaciones.push("Último piso");
      return `Torre ${t}: ${ubicaciones.join(", ")}`;
    })
    .join("\n");
}

const cargarImagen = (file) => new Promise((resolve) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = e.target.result;
  };
  reader.onerror = () => resolve(null);
  reader.readAsDataURL(file);
});

// Comprime y marca una foto con copropiedad/torre/piso/fecha. Devuelve null si el navegador no puede leerla.
export async function tagPhoto(file, { copName, torre, piso, fecha }) {
  const img = await cargarImagen(file);
  if (!img) return null;
  const maxW = 1200;
  const scale = Math.min(1, maxW / img.width);
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const bandH = Math.max(36, h * 0.08);
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, h - bandH, w, bandH);
  ctx.fillStyle = "#fff";
  ctx.font = `${Math.max(12, bandH * 0.32)}px sans-serif`;
  ctx.fillText(`${copName} · Torre ${torre} · Piso ${piso} · ${fecha}`, 8, h - bandH * 0.35);
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.72), torre, piso };
}

// Foto de técnico: recorte cuadrado centrado, 500 px, JPEG
export async function fotoCuadrada(file) {
  const img = await cargarImagen(file);
  if (!img) return null;
  const lado = Math.min(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 500;
  canvas.getContext("2d").drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, 500, 500);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export const dataUrlABlob = async (dataUrl) => (await fetch(dataUrl)).blob();

// Recorta una imagen en círculo (PNG con transparencia) para la identificación en PDF
export function recorteCircular(dataUrl, lado = 400) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = lado;
      const ctx = canvas.getContext("2d");
      ctx.beginPath();
      ctx.arc(lado / 2, lado / 2, lado / 2, 0, Math.PI * 2);
      ctx.clip();
      const m = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, lado, lado);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
