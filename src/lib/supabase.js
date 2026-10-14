import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const configurado = Boolean(url && key);
export const supabase = configurado ? createClient(url, key) : null;

// Los usuarios inician sesión con un nombre de usuario; internamente Supabase Auth usa un correo.
const DOMINIO = "portal.invalid";
export const usuarioAEmail = (u) => {
  const v = u.trim().toLowerCase();
  return v.includes("@") ? v : `${v}@${DOMINIO}`;
};

// Llama a la función de servidor "usuarios" y devuelve el mensaje de error legible si falla
export async function llamarUsuarios(accion, datos = {}) {
  const { data, error } = await supabase.functions.invoke("usuarios", { body: { accion, ...datos } });
  if (error) {
    let mensaje = "No se pudo completar la operación.";
    try { mensaje = (await error.context.json()).error || mensaje; } catch { /* respuesta sin JSON */ }
    throw new Error(mensaje);
  }
  return data;
}

// Mensajes de error de Postgres/Supabase en español
export function mensajeError(error) {
  if (!error) return "";
  const m = error.message || String(error);
  if (/Invalid login credentials/i.test(m)) return "Usuario o contraseña incorrectos.";
  if (/banned/i.test(m)) return "Esta cuenta está desactivada. Comunícate con el administrador.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.";
  if (/JWT|session/i.test(m) && /expired|invalid|missing/i.test(m)) return "Tu sesión expiró. Vuelve a iniciar sesión.";
  return m;
}

// Descarga una imagen privada del almacenamiento como data URL (para PDFs)
export async function imagenComoDataUrl(bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw error;
  return blobADataUrl(data);
}

export const blobADataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(blob);
});
