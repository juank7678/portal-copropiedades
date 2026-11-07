// Subida de fotos pensada para mala señal: una a la vez, con límite de tiempo y reintentos.
// Cada foto tiene una ruta fija, así que un reintento no la duplica.
import { supabase } from "./supabase.js";
import { dataUrlABlob } from "./util.js";

export const MAX_FOTOS = 30;
export const MAX_FOTOS_INFORME = 4;

const LIMITE_MS = 90000;
const ESPERAS_MS = [2000, 5000];
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const conLimite = (promesa) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("Failed to fetch")), LIMITE_MS);
  promesa.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

// Repite la llamada ante fallas de conexión. Los errores de validación del servidor se devuelven de una vez.
export async function conReintentos(fn) {
  const esRed = (m) => /Failed to fetch|NetworkError|Load failed|timeout/i.test(m || "");
  for (let i = 0; ; i++) {
    try {
      const r = await conLimite(fn());
      if (!r?.error || !esRed(r.error.message) || i >= ESPERAS_MS.length) return r;
    } catch (e) {
      if (!esRed(e.message) || i >= ESPERAS_MS.length) throw e;
    }
    await dormir(ESPERAS_MS[i]);
  }
}

async function subirUna(path, dataUrl) {
  const blob = await dataUrlABlob(dataUrl);
  const r = await conReintentos(() => supabase.storage.from("visitas").upload(path, blob, { contentType: "image/jpeg" }));
  // "Ya existe" significa que un intento anterior sí llegó aunque se haya perdido la respuesta
  if (r.error && String(r.error.statusCode) !== "409" && !/already exists|duplicate/i.test(r.error.message)) throw r.error;
}

// lista: [{ id, path, dataUrl, subida }]. Se detiene en la primera foto que no se pueda subir; las anteriores quedan marcadas.
export async function subirFotos(lista, onSubida, onProgreso) {
  for (const [i, f] of lista.entries()) {
    onProgreso?.(i + 1, lista.length);
    if (f.subida) continue;
    await subirUna(f.path, f.dataUrl);
    onSubida?.(f.id);
  }
}

// Las elegidas van al informe; si no eligió ninguna, las primeras 4. Las demás solo van a la carpeta de Drive.
export function separarFotos(fotos) {
  const elegidas = fotos.some((f) => f.enInforme) ? fotos.filter((f) => f.enInforme).slice(0, MAX_FOTOS_INFORME) : fotos.slice(0, MAX_FOTOS_INFORME);
  const ids = new Set(elegidas.map((f) => f.id));
  return { informe: elegidas, resto: fotos.filter((f) => !ids.has(f.id)) };
}

export const siguienteId = (fotos) => fotos.reduce((m, f) => Math.max(m, f.id), 0) + 1;
