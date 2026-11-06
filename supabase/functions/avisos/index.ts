// Procesa la bandeja de salida `avisos`: arma los PDF y los envía al script de Google del cliente,
// que los guarda en su Drive y le manda el correo. Solo la llama la base de datos (cabecera x-avisos-secreto).
//   { id }                                    procesa un aviso
//   { accion: "subir_firma", base64 }         guarda firma.png en el bucket privado `marca`
import { createClient } from "npm:@supabase/supabase-js@2";
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding@1/base64";
import { cartaCotizacion, cartaEntrega, cartaHojaVida, cartaVisita, dinero, fechaCO, fechaISO, numero } from "./documentos.js";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const PORTAL = "https://juank7678.github.io/portal-copropiedades/";

class Descartar extends Error {}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function bytesDe(bucket: string, ruta: string) {
  const { data, error } = await sb.storage.from(bucket).download(ruta);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

// La cabecera y el fondo son públicos (van en todas las cartas) y se publican con el sitio; la firma es privada
async function delSitio(ruta: string) {
  const res = await fetch(`${PORTAL}membrete/${ruta}`);
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}

async function cargarMarca() {
  const [cabecera, fondo, firma] = await Promise.all([delSitio("cabecera.jpg"), delSitio("fondo.jpg"), bytesDe("marca", "firma.png")]);
  if (!cabecera || !fondo || !firma) throw new Error("Faltan los archivos del membrete o la firma.");
  return { cabecera, fondo, firma };
}

const fotosDe = (rutas: string[]) => Promise.all((rutas || []).map((r) => bytesDe("visitas", r)));

function cuerpo(titulo: string, filas: [string, unknown][], nota = "") {
  const tabla = filas.filter(([, v]) => v !== "" && v != null).map(([k, v]) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#6b756f;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0;white-space:pre-line">${esc(v)}</td></tr>`).join("");
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2a24;max-width:600px">
<h2 style="font-size:18px;margin:0 0 12px">${esc(titulo)}</h2>
<table style="border-collapse:collapse;font-size:14px">${tabla}</table>
${nota ? `<p style="margin:14px 0 0">${esc(nota)}</p>` : ""}
<p style="margin:18px 0 0"><a href="{{CARPETA}}" style="background:#c8622f;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold">Abrir carpeta en Drive</a>
&nbsp; <a href="${PORTAL}" style="color:#c8622f">Abrir el portal</a></p>
<p style="margin:18px 0 0;font-size:12px;color:#6b756f">Aviso automático del portal Cprado2001.</p></div>`;
}

const carpetaCop = (c: { nombre: string; anio: number }) => `${c.nombre} (${c.anio})`;
const pdf = (d: { nombre: string; bytes: Uint8Array }) => ({ nombre: d.nombre, mime: "application/pdf", bytes: d.bytes, adjuntar: true });
const jpgs = (lista: (Uint8Array | null)[], prefijo: string) =>
  lista.flatMap((bytes, i) => (bytes ? [{ nombre: `${prefijo} ${i + 1}.jpg`, mime: "image/jpeg", bytes, adjuntar: false }] : []));

// deno-lint-ignore no-explicit-any
async function construir(aviso: any) {
  const marca = await cargarMarca();

  if (aviso.tipo === "prueba") {
    const cop = { nombre: "COPROPIEDAD DE PRUEBA P.H.", administrador: "ADMINISTRADOR DE PRUEBA", anio: new Date().getFullYear() };
    const cot = {
      numero: 0, creado_en: new Date().toISOString(), torre: 1, piso: 90, tecnico_nombre: "TÉCNICO DE PRUEBA",
      diagnostico: "Este es un documento de prueba: no corresponde a ninguna visita real. Si lo puede leer, el portal ya está conectado con su correo y con su carpeta de Drive.",
      recomendacion: "borrar la carpeta \"Pruebas\" cuando quiera.", lineas: [{ concepto: "Trabajo de ejemplo", cantidad: 1 }],
    };
    return {
      asunto: "Prueba de conexión del portal Cprado2001",
      html: cuerpo("La conexión funciona", [["Correo", "Este mensaje llegó desde el portal."], ["Carpeta", "Los archivos quedan en Drive, en Portal Cprado2001."]],
        "El PDF adjunto es un ejemplo del informe con su membrete."),
      carpeta: ["Pruebas"],
      archivos: [pdf(cartaVisita(cot, cop, [], marca))],
    };
  }

  if (aviso.tipo === "registro") {
    const { data: cop } = await sb.from("copropiedades").select("*").eq("id", aviso.ref_id).maybeSingle();
    if (!cop) throw new Descartar("El registro ya no existe.");
    const { data: tec } = cop.tecnico_id ? await sb.from("perfiles").select("nombre").eq("id", cop.tecnico_id).maybeSingle() : { data: null };
    return {
      asunto: `Nuevo registro: ${cop.nombre}`,
      html: cuerpo("Se registró una copropiedad", [
        ["Copropiedad", `${cop.nombre} (${cop.anio})`], ["NIT", cop.nit], ["Dirección", cop.direccion], ["Administrador", cop.administrador],
        ["Correo", cop.email], ["Celular", cop.cel_admin], ["Portería", cop.tel_porteria],
      ], "Falta asignarle un técnico en la pestaña Admin del portal."),
      carpeta: [carpetaCop(cop)],
      archivos: [pdf(cartaHojaVida(cop, tec?.nombre, marca))],
    };
  }

  if (aviso.tipo === "visita") {
    const { data: cot } = await sb.from("cotizaciones").select("*").eq("id", aviso.ref_id).maybeSingle();
    if (!cot) throw new Descartar("La visita ya no existe.");
    const [{ data: cop }, { data: cliente }] = await Promise.all([
      sb.from("copropiedades").select("*").eq("id", cot.copropiedad_id).single(),
      sb.from("cotizaciones_cliente").select("*").eq("cotizacion_id", cot.id).single(),
    ]);
    const fotos = await fotosDe(cot.fotos);
    return {
      asunto: `Visita N.° ${numero(cot.numero)} - ${cot.copropiedad_nombre}`,
      // Sin el valor del técnico: este correo se puede reenviar al cliente tal cual
      html: cuerpo(`Visita N.° ${numero(cot.numero)} registrada`, [
        ["Copropiedad", cot.copropiedad_nombre], ["Técnico", cot.tecnico_nombre], ["Fecha", fechaCO(cot.creado_en)],
        ["Ubicación", `Torre ${cot.torre}, piso ${cot.piso}`], ["Diagnóstico", cot.diagnostico], ["Recomendación", cot.recomendacion],
        ["Total cotización", dinero(cliente.total_cliente)], ["Administrador", cop.administrador], ["Correo del cliente", cop.email],
      ], "Adjuntos: informe de visita y cotización. Revísalos y apruébala en el portal."),
      carpeta: [carpetaCop(cop), `Visita ${numero(cot.numero)} - ${fechaISO(cot.creado_en)}`],
      archivos: [pdf(cartaVisita(cot, cop, fotos, marca)), pdf(cartaCotizacion(cot, cliente, cop, marca)), ...jpgs(fotos, "Foto")],
    };
  }

  if (aviso.tipo === "entrega") {
    const { data: ent } = await sb.from("entregas").select("*").eq("id", aviso.ref_id).maybeSingle();
    if (!ent) throw new Descartar("La entrega ya no existe.");
    const [{ data: cot }, { data: cop }] = await Promise.all([
      sb.from("cotizaciones").select("*").eq("id", ent.cotizacion_id).single(),
      sb.from("copropiedades").select("*").eq("id", ent.copropiedad_id).single(),
    ]);
    const [antes, despues] = await Promise.all([fotosDe(cot.fotos), fotosDe(ent.fotos)]);
    return {
      asunto: `Entrega N.° ${numero(ent.numero)} - ${cot.copropiedad_nombre}`,
      html: cuerpo(`Entrega N.° ${numero(ent.numero)} registrada`, [
        ["Copropiedad", cot.copropiedad_nombre], ["Técnico", ent.tecnico_nombre], ["Fecha de entrega", fechaCO(ent.fecha_entrega)],
        ["Cotización", `N.° ${numero(cot.numero)}`], ["Observaciones", ent.observaciones], ["Recibido por", ent.recibido_por],
      ], "Adjunto: informe de entrega. Ya se puede emitir la cuenta de cobro en el portal."),
      carpeta: [carpetaCop(cop), `Entrega ${numero(ent.numero)} - ${fechaISO(ent.fecha_entrega)}`],
      archivos: [pdf(cartaEntrega(cot, ent, cop, antes, despues, marca)), ...jpgs(despues, "Despues")],
    };
  }
  throw new Descartar("Tipo de aviso desconocido.");
}

// deno-lint-ignore no-explicit-any
async function enviar(aviso: any, cfg: any) {
  const m = await construir(aviso);
  const res = await fetch(cfg.avisos_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: cfg.avisos_token, id: aviso.id, para: cfg.avisos_correo, con_correo: aviso.con_correo,
      asunto: m.asunto, html: m.html, carpeta: m.carpeta,
      archivos: m.archivos.map((a) => ({ nombre: a.nombre, mime: a.mime, adjuntar: a.adjuntar, base64: encodeBase64(a.bytes) })),
    }),
  });
  const texto = await res.text();
  // deno-lint-ignore no-explicit-any
  let r: any;
  try { r = JSON.parse(texto); } catch {
    throw new Error(`Google no respondió como se esperaba (HTTP ${res.status}). Revisa que la implementación tenga acceso "Cualquier persona".`);
  }
  if (!r.ok) throw new Error(r.error || "El script de Google devolvió un error.");
  return r as { carpeta_url?: string; raiz_url?: string };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });
  const { data: cfg, error: errCfg } = await sb.from("ajustes_privados")
    .select("avisos_url, avisos_token, avisos_correo, avisos_secreto").eq("id", 1).single();
  if (errCfg || !cfg) return json(500, { error: "Sin configuración" });
  if (req.headers.get("x-avisos-secreto") !== cfg.avisos_secreto) return json(401, { error: "No autorizado" });

  const body = await req.json().catch(() => ({})) as Record<string, string>;

  if (body.accion === "subir_firma") {
    const { error } = await sb.storage.from("marca").upload("firma.png", decodeBase64(body.base64), { contentType: "image/png", upsert: true });
    return error ? json(500, { error: error.message }) : json(200, { ok: true });
  }

  // Toma el aviso solo si nadie más lo está procesando
  const { data: aviso } = await sb.from("avisos").select("*").eq("id", body.id).maybeSingle();
  if (!aviso) return json(404, { error: "Aviso no encontrado" });
  const { data: tomado } = await sb.from("avisos")
    .update({ estado: "enviando", intentos: aviso.intentos + 1, actualizado_en: new Date().toISOString() })
    .eq("id", aviso.id).in("estado", ["pendiente", "error"]).select("id");
  if (!tomado?.length) return json(200, { ok: true, omitido: true });

  try {
    if (!cfg.avisos_url) throw new Error("Falta conectar la cuenta de Google.");
    const r = await enviar(aviso, cfg);
    const ahora = new Date().toISOString();
    await sb.from("avisos").update({ estado: "enviado", error: "", carpeta_url: r.carpeta_url || "", enviado_en: ahora, actualizado_en: ahora }).eq("id", aviso.id);
    if (r.raiz_url) await sb.from("ajustes_privados").update({ avisos_carpeta_url: r.raiz_url }).eq("id", 1);
    return json(200, { ok: true });
  } catch (e) {
    const descartar = e instanceof Descartar;
    const mensaje = e instanceof Error ? e.message : String(e);
    console.error(aviso.id, mensaje);
    await sb.from("avisos").update({ estado: descartar ? "descartado" : "error", error: mensaje.slice(0, 500), actualizado_en: new Date().toISOString() }).eq("id", aviso.id);
    return json(200, { ok: false, error: mensaje });
  }
});
