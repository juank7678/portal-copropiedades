// Gestión de cuentas (requiere la clave de servicio, por eso vive en el servidor).
// Acciones:
//   estado                    público  -> { hay_admin }
//   crear_admin_inicial       público, solo si no existe admin y con el código de configuración inicial
//   crear_tecnico             admin
//   restablecer_password      admin
//   cambiar_estado            admin    (activar / desactivar)
//   eliminar_tecnico          admin
import { createClient } from "npm:@supabase/supabase-js@2";

const DOMINIO = "portal.invalid"; // los usuarios inician sesión con "usuario"; internamente se mapea a usuario@DOMINIO
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

class ErrorApp extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function validarUsuario(v: unknown) {
  const u = texto(v, 30).toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(u)) throw new ErrorApp(400, "El usuario debe tener entre 3 y 30 caracteres: letras, números, punto, guion o guion bajo, sin espacios.");
  return u;
}

function validarPassword(v: unknown) {
  if (typeof v !== "string" || v.length < 8 || v.length > 72) throw new ErrorApp(400, "La contraseña debe tener entre 8 y 72 caracteres.");
  return v;
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hayAdmin() {
  const { count, error } = await admin.from("perfiles").select("id", { count: "exact", head: true }).eq("rol", "admin");
  if (error) throw error;
  return (count ?? 0) > 0;
}

async function exigirAdmin(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new ErrorApp(401, "Sesión no válida. Vuelve a iniciar sesión.");
  const { data: perfil } = await admin.from("perfiles").select("rol, activo").eq("id", data.user.id).maybeSingle();
  if (!perfil || perfil.rol !== "admin" || !perfil.activo) throw new ErrorApp(403, "Solo el administrador puede hacer esto.");
  return data.user.id;
}

async function crearCuenta(rol: "admin" | "tecnico", body: Record<string, unknown>) {
  const usuario = validarUsuario(body.usuario);
  const password = validarPassword(body.password);
  const nombre = texto(body.nombre, 120).toUpperCase();
  if (!nombre) throw new ErrorApp(400, "Falta el nombre.");

  const { data: existe } = await admin.from("perfiles").select("id").eq("usuario", usuario).maybeSingle();
  if (existe) throw new ErrorApp(409, "Ya existe una cuenta con ese usuario.");

  const { data, error } = await admin.auth.admin.createUser({
    email: `${usuario}@${DOMINIO}`, password, email_confirm: true, user_metadata: { usuario, rol },
  });
  if (error || !data.user) throw new ErrorApp(400, `No se pudo crear la cuenta: ${error?.message ?? "error desconocido"}`);

  const { error: errPerfil } = await admin.from("perfiles").insert({
    id: data.user.id, rol, usuario, nombre,
    cedula: texto(body.cedula, 30), celular: texto(body.celular, 30),
  });
  if (errPerfil) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw new ErrorApp(400, `No se pudo crear el perfil: ${errPerfil.message}`);
  }
  return data.user.id;
}

async function perfilTecnico(id: unknown) {
  if (typeof id !== "string") throw new ErrorApp(400, "Falta el identificador del técnico.");
  const { data } = await admin.from("perfiles").select("id, rol").eq("id", id).maybeSingle();
  if (!data || data.rol !== "tecnico") throw new ErrorApp(404, "Técnico no encontrado.");
  return data.id as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    switch (body.accion) {
      case "estado":
        return json(200, { hay_admin: await hayAdmin() });

      case "crear_admin_inicial": {
        if (await hayAdmin()) throw new ErrorApp(409, "El administrador ya fue creado. Inicia sesión.");
        const { data: cfg } = await admin.from("ajustes_privados").select("codigo_inicial_hash").eq("id", 1).single();
        const codigo = texto(body.codigo, 100);
        if (!cfg?.codigo_inicial_hash || !codigo || (await sha256(codigo)) !== cfg.codigo_inicial_hash) {
          throw new ErrorApp(403, "El código de configuración inicial no es correcto.");
        }
        await crearCuenta("admin", body);
        await admin.from("ajustes_privados").update({ codigo_inicial_hash: null }).eq("id", 1);
        return json(200, { ok: true });
      }

      case "crear_tecnico": {
        await exigirAdmin(req);
        const id = await crearCuenta("tecnico", body);
        return json(200, { ok: true, id });
      }

      case "restablecer_password": {
        await exigirAdmin(req);
        const id = await perfilTecnico(body.id);
        const { error } = await admin.auth.admin.updateUserById(id, { password: validarPassword(body.password) });
        if (error) throw new ErrorApp(400, error.message);
        return json(200, { ok: true });
      }

      case "cambiar_estado": {
        await exigirAdmin(req);
        const id = await perfilTecnico(body.id);
        const activo = body.activo === true;
        const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: activo ? "none" : "876000h" });
        if (error) throw new ErrorApp(400, error.message);
        await admin.from("perfiles").update({ activo }).eq("id", id);
        return json(200, { ok: true });
      }

      case "eliminar_tecnico": {
        await exigirAdmin(req);
        const id = await perfilTecnico(body.id);
        await admin.storage.from("tecnicos").remove([`${id}.jpg`]);
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) throw new ErrorApp(400, error.message);
        return json(200, { ok: true });
      }

      default:
        throw new ErrorApp(400, "Acción no válida.");
    }
  } catch (e) {
    if (e instanceof ErrorApp) return json(e.status, { error: e.message });
    console.error(e);
    return json(500, { error: "Error interno del servidor." });
  }
});
