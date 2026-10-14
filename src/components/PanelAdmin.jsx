import { useCallback, useEffect, useState } from "react";
import { imagenComoDataUrl, llamarUsuarios, mensajeError, supabase } from "../lib/supabase.js";
import { descargarPdf } from "../lib/descargar.js";
import { cop, dataUrlABlob, fechaCO, fotoCuadrada, numeroCot, recorteCircular } from "../lib/util.js";
import {
  btnDanger, btnGhost, btnGhostLink, btnPrimary, card, disabled, errorText, fieldLabel, fila, input, muted, okText, smallLabel,
} from "../styles.js";
import { TablaLineas } from "./PanelTecnico.jsx";

const firmar = async (bucket, paths) => {
  if (!paths.length) return {};
  const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, 3600);
  return Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
};

const textoWhatsApp = (cel) => `https://wa.me/57${cel.replace(/\D/g, "").replace(/^57(?=\d{10}$)/, "")}`;

export default function PanelAdmin() {
  const [tecnicos, setTecnicos] = useState([]);
  const [fotosTec, setFotosTec] = useState({});
  const [copropiedades, setCopropiedades] = useState([]);
  const [seleccionId, setSeleccionId] = useState(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const [t, c] = await Promise.all([
      supabase.from("perfiles").select("*").eq("rol", "tecnico").order("nombre"),
      supabase.from("copropiedades").select("*").order("creado_en", { ascending: false }),
    ]);
    if (t.error || c.error) { setError(mensajeError(t.error || c.error)); return; }
    setError("");
    setTecnicos(t.data);
    setCopropiedades(c.data);
    setFotosTec(await firmar("tecnicos", t.data.filter((x) => x.foto_path).map((x) => x.foto_path)));
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const seleccion = copropiedades.find((c) => c.id === seleccionId) || null;

  return (
    <div>
      {error && <div style={card}><p style={errorText}>{error}</p></div>}
      <EnlaceRegistro />
      <DirectorioTecnicos tecnicos={tecnicos} fotosTec={fotosTec} recargar={cargar} />
      <Copropiedades copropiedades={copropiedades} tecnicos={tecnicos} recargar={cargar}
        onVer={(id) => setSeleccionId(id)} />
      {seleccion && <Historial seleccion={seleccion} tecnicos={tecnicos} onCerrar={() => setSeleccionId(null)} />}
      <Precios />
    </div>
  );
}

function EnlaceRegistro() {
  const url = `${window.location.origin}${window.location.pathname}#/registro`;
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(url); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* sin permiso de portapapeles */ }
  };
  return (
    <div style={card}>
      <h2 style={{ marginTop: 0 }}>Enlace de registro para clientes</h2>
      <p style={{ ...muted, marginTop: -6 }}>Comparte este enlace con tus clientes para que diligencien sus datos. Solo muestra el formulario de registro.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <input style={{ ...input, marginTop: 0 }} readOnly value={url} onFocus={(e) => e.target.select()} />
        <button type="button" style={btnGhost} onClick={copiar}>{copiado ? "Copiado ✓" : "Copiar"}</button>
      </div>
    </div>
  );
}

// ---------- Técnicos ----------
const TEC_VACIO = { usuario: "", password: "", nombre: "", cedula: "", celular: "", foto: null };

async function subirFotoTecnico(id, dataUrl) {
  const path = `${id}.jpg`;
  const { error } = await supabase.storage.from("tecnicos").upload(path, await dataUrlABlob(dataUrl), { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  const { error: err2 } = await supabase.from("perfiles").update({ foto_path: path }).eq("id", id);
  if (err2) throw err2;
}

function CampoFoto({ onFoto }) {
  return (
    <label style={smallLabel}>Foto
      <input type="file" accept="image/*" style={{ display: "block", marginTop: 2, fontSize: 12 }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const data = await fotoCuadrada(f);
          if (!data) alert("No se pudo leer la imagen (formato no compatible con este navegador).");
          onFoto(data);
        }} />
    </label>
  );
}

function DirectorioTecnicos({ tecnicos, fotosTec, recargar }) {
  const [nuevo, setNuevo] = useState(TEC_VACIO);
  const [formKey, setFormKey] = useState(0);
  const [msg, setMsg] = useState({ error: "", ok: "" });
  const [ocupado, setOcupado] = useState(false);
  const [edicion, setEdicion] = useState(null); // { id, modo: 'datos' | 'password', ... }

  const ejecutar = async (fn, ok) => {
    setOcupado(true);
    setMsg({ error: "", ok: "" });
    try { await fn(); setMsg({ error: "", ok }); await recargar(); return true; }
    catch (e) { setMsg({ error: mensajeError(e), ok: "" }); return false; }
    finally { setOcupado(false); }
  };

  const agregar = () => ejecutar(async () => {
    if (!nuevo.usuario.trim() || !nuevo.nombre.trim()) throw new Error("Escribe el usuario y el nombre del técnico.");
    const { id } = await llamarUsuarios("crear_tecnico", {
      usuario: nuevo.usuario.trim().toLowerCase(), password: nuevo.password,
      nombre: nuevo.nombre, cedula: nuevo.cedula, celular: nuevo.celular,
    });
    if (nuevo.foto) await subirFotoTecnico(id, nuevo.foto);
    setNuevo(TEC_VACIO);
    setFormKey((k) => k + 1);
  }, "Técnico creado. Comparte con él su usuario y contraseña.");

  const guardarDatos = () => ejecutar(async () => {
    const { id, nombre, cedula, celular, foto } = edicion;
    if (!nombre.trim()) throw new Error("El nombre no puede quedar vacío.");
    const { error } = await supabase.from("perfiles").update({ nombre: nombre.trim().toUpperCase(), cedula: cedula.trim(), celular: celular.trim() }).eq("id", id);
    if (error) throw error;
    if (foto) await subirFotoTecnico(id, foto);
    setEdicion(null);
  }, "Datos actualizados.");

  const guardarPassword = () => ejecutar(async () => {
    await llamarUsuarios("restablecer_password", { id: edicion.id, password: edicion.password });
    setEdicion(null);
  }, "Contraseña restablecida. Compártela con el técnico.");

  const cambiarEstado = (t) => ejecutar(
    () => llamarUsuarios("cambiar_estado", { id: t.id, activo: !t.activo }),
    t.activo ? `${t.nombre} quedó desactivado: ya no puede iniciar sesión.` : `${t.nombre} quedó activo.`,
  );

  const eliminar = (t) => {
    if (!window.confirm(`¿Eliminar definitivamente a ${t.nombre}? Sus visitas registradas se conservan, pero ya no podrá iniciar sesión.`)) return;
    ejecutar(() => llamarUsuarios("eliminar_tecnico", { id: t.id }), "Técnico eliminado.");
  };

  return (
    <div style={card}>
      <h2 style={{ marginTop: 0 }}>Directorio de técnicos</h2>
      <p style={{ ...muted, marginTop: -6 }}>Cada técnico inicia sesión con su propio usuario y contraseña. Regístralos con foto para poder enviar su identificación al cliente.</p>
      <div key={formKey} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, alignItems: "end", marginBottom: 10 }}>
        <label style={smallLabel}>Usuario
          <input style={{ ...input, padding: 6, marginTop: 2 }} autoCapitalize="none" value={nuevo.usuario} placeholder="ej. jperez"
            onChange={(e) => setNuevo({ ...nuevo, usuario: e.target.value.toLowerCase().replace(/\s/g, "") })} />
        </label>
        <label style={smallLabel}>Contraseña (mín. 8)
          <input style={{ ...input, padding: 6, marginTop: 2 }} type="text" autoComplete="off" value={nuevo.password}
            onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })} />
        </label>
        <label style={smallLabel}>Nombre
          <input style={{ ...input, padding: 6, marginTop: 2, textTransform: "uppercase" }} value={nuevo.nombre}
            onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value.toUpperCase() })} />
        </label>
        <label style={smallLabel}>Cédula
          <input style={{ ...input, padding: 6, marginTop: 2 }} value={nuevo.cedula} onChange={(e) => setNuevo({ ...nuevo, cedula: e.target.value })} />
        </label>
        <label style={smallLabel}>Celular
          <input style={{ ...input, padding: 6, marginTop: 2 }} type="tel" value={nuevo.celular} onChange={(e) => setNuevo({ ...nuevo, celular: e.target.value })} />
        </label>
        <CampoFoto onFoto={(foto) => setNuevo((n) => ({ ...n, foto }))} />
      </div>
      <button type="button" style={{ ...btnPrimary, ...disabled(ocupado) }} disabled={ocupado} onClick={agregar}>+ Agregar técnico</button>
      {msg.error && <p style={errorText}>{msg.error}</p>}
      {msg.ok && <p style={okText}>{msg.ok}</p>}

      {tecnicos.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {tecnicos.map((t) => (
            <div key={t.id} style={{ borderTop: "1px solid #eee", padding: "10px 0" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {fotosTec[t.foto_path]
                  ? <img src={fotosTec[t.foto_path]} alt={t.nombre} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: "50%" }} />
                  : <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#eef0ec" }} />}
                <div style={{ flex: 1, fontSize: 13 }}>
                  <b>{t.nombre}</b> {!t.activo && <span style={{ color: "#b3261e", fontSize: 11, fontWeight: 700 }}>· INACTIVO</span>}<br />
                  <span style={muted}>Usuario: {t.usuario}{t.celular ? ` · ${t.celular}` : ""}</span>
                </div>
              </div>
              <div style={{ ...fila, marginTop: 6 }}>
                <button type="button" style={btnGhost} onClick={() => setEdicion({ id: t.id, modo: "datos", nombre: t.nombre, cedula: t.cedula, celular: t.celular, foto: null })}>Editar</button>
                <button type="button" style={btnGhost} onClick={() => setEdicion({ id: t.id, modo: "password", password: "" })}>Restablecer contraseña</button>
                <button type="button" style={{ ...btnGhost, ...disabled(ocupado) }} disabled={ocupado} onClick={() => cambiarEstado(t)}>{t.activo ? "Desactivar" : "Activar"}</button>
                <button type="button" style={{ ...btnDanger, ...disabled(ocupado) }} disabled={ocupado} onClick={() => eliminar(t)}>Eliminar</button>
              </div>

              {edicion?.id === t.id && edicion.modo === "datos" && (
                <div style={{ background: "#f8f9f7", borderRadius: 8, padding: 10, marginTop: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, alignItems: "end" }}>
                    <label style={smallLabel}>Nombre
                      <input style={{ ...input, padding: 6, marginTop: 2, textTransform: "uppercase" }} value={edicion.nombre} onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value.toUpperCase() })} />
                    </label>
                    <label style={smallLabel}>Cédula
                      <input style={{ ...input, padding: 6, marginTop: 2 }} value={edicion.cedula} onChange={(e) => setEdicion({ ...edicion, cedula: e.target.value })} />
                    </label>
                    <label style={smallLabel}>Celular
                      <input style={{ ...input, padding: 6, marginTop: 2 }} value={edicion.celular} onChange={(e) => setEdicion({ ...edicion, celular: e.target.value })} />
                    </label>
                    <CampoFoto onFoto={(foto) => setEdicion((ed) => ({ ...ed, foto }))} />
                  </div>
                  <div style={{ ...fila, marginTop: 8 }}>
                    <button type="button" style={{ ...btnGhost, background: "#c8622f", color: "#fff", ...disabled(ocupado) }} disabled={ocupado} onClick={guardarDatos}>Guardar</button>
                    <button type="button" style={btnGhost} onClick={() => setEdicion(null)}>Cancelar</button>
                  </div>
                </div>
              )}

              {edicion?.id === t.id && edicion.modo === "password" && (
                <div style={{ background: "#f8f9f7", borderRadius: 8, padding: 10, marginTop: 8 }}>
                  <label style={smallLabel}>Nueva contraseña (mínimo 8 caracteres)
                    <input style={{ ...input, padding: 6, marginTop: 2 }} type="text" autoComplete="off" value={edicion.password} onChange={(e) => setEdicion({ ...edicion, password: e.target.value })} />
                  </label>
                  <div style={{ ...fila, marginTop: 8 }}>
                    <button type="button" style={{ ...btnGhost, background: "#c8622f", color: "#fff", ...disabled(ocupado) }} disabled={ocupado} onClick={guardarPassword}>Guardar contraseña</button>
                    <button type="button" style={btnGhost} onClick={() => setEdicion(null)}>Cancelar</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Copropiedades ----------
const CAMPOS_COP = [
  ["nombre", "Nombre"], ["administrador", "Administrador"], ["direccion", "Dirección"],
  ["email", "Correo"], ["cel_admin", "Celular administrador"], ["tel_porteria", "Teléfono portería"],
];

async function borrarFotos(paths) {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await supabase.storage.from("visitas").remove(paths.slice(i, i + 100));
    if (error) throw error;
  }
}

function Copropiedades({ copropiedades, tecnicos, recargar, onVer }) {
  const [edicion, setEdicion] = useState(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(null);

  const ejecutar = async (id, fn) => {
    setOcupado(id);
    setError("");
    try { await fn(); await recargar(); }
    catch (e) { setError(mensajeError(e)); }
    finally { setOcupado(null); }
  };

  const asignar = (c, tecnicoId) => ejecutar(c.id, async () => {
    const { error: err } = await supabase.from("copropiedades").update({ tecnico_id: tecnicoId || null }).eq("id", c.id);
    if (err) throw err;
  });

  const guardar = () => ejecutar(edicion.id, async () => {
    const { id, ...datos } = edicion;
    if (!datos.nombre.trim() || !datos.administrador.trim()) throw new Error("El nombre y el administrador son obligatorios.");
    const limpio = Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, k === "email" ? v.trim().toLowerCase() : ["cel_admin", "tel_porteria"].includes(k) ? v.trim() : v.trim().toUpperCase()]));
    const { error: err } = await supabase.from("copropiedades").update(limpio).eq("id", id);
    if (err) throw err;
    setEdicion(null);
  });

  const eliminar = (c) => {
    if (!window.confirm(`¿Eliminar ${c.nombre} (${c.anio}) con todas sus visitas, fotos y cotizaciones? Esta acción no se puede deshacer.`)) return;
    ejecutar(c.id, async () => {
      const { data, error: err } = await supabase.from("cotizaciones").select("fotos").eq("copropiedad_id", c.id);
      if (err) throw err;
      await borrarFotos(data.flatMap((q) => q.fotos));
      const { error: err2 } = await supabase.from("copropiedades").delete().eq("id", c.id);
      if (err2) throw err2;
    });
  };

  const descargarIdentificacion = (c, tec) => ejecutar(c.id, async () => {
    const foto = tec.foto_path ? await recorteCircular(await imagenComoDataUrl("tecnicos", tec.foto_path)) : null;
    await descargarPdf("pdfIdentificacion", tec, foto, c.nombre);
  });

  return (
    <div style={card}>
      <h2 style={{ marginTop: 0 }}>Copropiedades registradas</h2>
      {copropiedades.length === 0 && <p>Aún no hay registros. Comparte el enlace de registro o usa la pestaña "Registro cliente".</p>}
      {error && <p style={errorText}>{error}</p>}
      {copropiedades.map((c) => {
        const tec = tecnicos.find((t) => t.id === c.tecnico_id);
        return (
          <div key={c.id} style={{ borderBottom: "1px solid #eee", padding: "10px 0", opacity: ocupado === c.id ? 0.6 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <b>{c.nombre} ({c.anio})</b>
              <div style={fila}>
                <button style={btnGhost} type="button" onClick={() => onVer(c.id)}>Ver</button>
                <button style={btnGhost} type="button" onClick={() => setEdicion({ id: c.id, ...Object.fromEntries(CAMPOS_COP.map(([k]) => [k, c[k] || ""])) })}>Editar</button>
                <button style={btnDanger} type="button" onClick={() => eliminar(c)}>Eliminar</button>
              </div>
            </div>
            <label style={{ fontSize: 12, color: "#6b756f", display: "block", marginTop: 4 }}>Técnico asignado:
              <select style={{ ...input, padding: 6, marginTop: 4 }} value={c.tecnico_id || ""} disabled={ocupado === c.id}
                onChange={(e) => asignar(c, e.target.value)}>
                <option value="">— Sin asignar —</option>
                {tecnicos.filter((t) => t.activo || t.id === c.tecnico_id).map((t) => <option key={t.id} value={t.id}>{t.nombre}{t.activo ? "" : " (inactivo)"}</option>)}
              </select>
            </label>
            {tec && (
              <div style={{ ...fila, marginTop: 6 }}>
                <button type="button" style={btnGhost} onClick={() => descargarIdentificacion(c, tec)}>
                  📇 Identificación de {tec.nombre} (PDF)
                </button>
                {c.email && (
                  <a style={btnGhostLink} href={`mailto:${c.email}?subject=${encodeURIComponent(`Técnico autorizado — ${c.nombre}`)}&body=${encodeURIComponent(`Buen día ${c.administrador},\n\nLe informamos que el técnico ${tec.nombre} está autorizado para realizar la visita técnica en su copropiedad. Adjuntamos su identificación con foto para que puedan confirmar su ingreso.\n\nQuedamos atentos.`)}`}>
                    Abrir correo
                  </a>
                )}
                {c.cel_admin && (
                  <a style={btnGhostLink} target="_blank" rel="noreferrer" href={`${textoWhatsApp(c.cel_admin)}?text=${encodeURIComponent(`El técnico ${tec.nombre} está autorizado para la visita en ${c.nombre}. Le compartimos su identificación con foto (adjunta) para que confirmen su ingreso.`)}`}>
                    Abrir WhatsApp
                  </a>
                )}
              </div>
            )}

            {edicion?.id === c.id && (
              <div style={{ background: "#f8f9f7", borderRadius: 8, padding: 10, marginTop: 8 }}>
                {CAMPOS_COP.map(([k, label]) => (
                  <label key={k} style={{ ...smallLabel, display: "block", marginBottom: 6 }}>{label}
                    <input style={{ ...input, padding: 6, marginTop: 2, textTransform: k === "email" ? "none" : "uppercase" }} value={edicion[k]}
                      onChange={(e) => setEdicion({ ...edicion, [k]: e.target.value })} />
                  </label>
                ))}
                <div style={fila}>
                  <button type="button" style={{ ...btnGhost, background: "#c8622f", color: "#fff" }} onClick={guardar}>Guardar</button>
                  <button type="button" style={btnGhost} onClick={() => setEdicion(null)}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Historial de una copropiedad ----------
function Historial({ seleccion, tecnicos, onCerrar }) {
  const [historial, setHistorial] = useState(null);
  const [clientes, setClientes] = useState({});
  const [abiertoId, setAbiertoId] = useState(null);
  const [miniaturas, setMiniaturas] = useState({});
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(null);

  const cargar = useCallback(async () => {
    const { data, error: err } = await supabase.from("cotizaciones").select("*").eq("copropiedad_id", seleccion.id).order("creado_en", { ascending: false });
    if (err) { setError(mensajeError(err)); return; }
    const ids = data.map((d) => d.id);
    const cli = ids.length ? await supabase.from("cotizaciones_cliente").select("*").in("cotizacion_id", ids) : { data: [] };
    if (cli.error) { setError(mensajeError(cli.error)); return; }
    setHistorial(data);
    setClientes(Object.fromEntries(cli.data.map((x) => [x.cotizacion_id, x])));
  }, [seleccion.id]);

  useEffect(() => { setHistorial(null); setAbiertoId(null); cargar(); }, [cargar]);

  const abrir = async (h) => {
    const nuevo = abiertoId === h.id ? null : h.id;
    setAbiertoId(nuevo);
    if (nuevo) {
      const urls = await firmar("visitas", h.fotos);
      setMiniaturas((m) => ({ ...m, ...urls }));
    }
  };

  const conFotos = async (h) => Promise.all(h.fotos.map(async (p) => ({ dataUrl: await imagenComoDataUrl("visitas", p) })));

  const accion = async (id, fn) => {
    setOcupado(id);
    setError("");
    try { await fn(); } catch (e) { setError(mensajeError(e)); } finally { setOcupado(null); }
  };

  const pdfCliente = (h) => accion(h.id, async () => {
    await descargarPdf("pdfInformeCliente", h, clientes[h.id], seleccion, await conFotos(h));
  });
  const pdfTecnico = (h) => accion(h.id, async () => {
    await descargarPdf("pdfCotizacionTecnico", h, await conFotos(h));
  });
  const eliminar = (h) => {
    if (!window.confirm(`¿Eliminar la cotización N.° ${numeroCot(h.numero)} con sus fotos? Esta acción no se puede deshacer.`)) return;
    accion(h.id, async () => {
      await borrarFotos(h.fotos);
      const { error: err } = await supabase.from("cotizaciones").delete().eq("id", h.id);
      if (err) throw err;
      await cargar();
    });
  };

  const tecnicoNombre = tecnicos.find((t) => t.id === seleccion.tecnico_id)?.nombre;

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Historial — {seleccion.nombre}</h3>
        <button type="button" style={btnGhost} onClick={onCerrar}>Cerrar</button>
      </div>
      <button style={{ ...btnGhost, marginTop: 10 }} type="button" onClick={() => descargarPdf("pdfHojaVida", seleccion, tecnicoNombre)}>
        Descargar hoja de vida (PDF)
      </button>
      {error && <p style={errorText}>{error}</p>}
      {!historial ? <p>Cargando…</p> : historial.length === 0 ? <p>Sin visitas registradas.</p> : historial.map((h) => {
        const cli = clientes[h.id];
        return (
          <div key={h.id} style={{ padding: "8px 0", borderBottom: "1px dashed #eee" }}>
            <button type="button" onClick={() => abrir(h)}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, textAlign: "left", width: "100%", color: "#1f2a24" }}>
              {abiertoId === h.id ? "▾" : "▸"} N.° {numeroCot(h.numero)} · {fechaCO(h.creado_en)} · {h.tecnico_nombre} · Torre {h.torre}/Piso {h.piso} · Cliente: {cli ? cop(cli.total_cliente) : "—"} · Técnico: {cop(h.total_tecnico)}
            </button>
            {abiertoId === h.id && (
              <div style={{ marginTop: 8, background: "#f8f9f7", borderRadius: 8, padding: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 700, margin: "0 0 6px" }}>Informe de visita</p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {h.fotos.length === 0 && <span style={muted}>Sin fotos.</span>}
                  {h.fotos.map((p) => miniaturas[p]
                    ? <img key={p} src={miniaturas[p]} alt="Foto de la visita" style={{ width: 70, height: 70, objectFit: "cover", borderRadius: 6 }} />
                    : <div key={p} style={{ width: 70, height: 70, borderRadius: 6, background: "#eef0ec" }} />)}
                </div>
                {cli && (
                  <>
                    <p style={{ fontSize: 12, fontWeight: 700, margin: "0 0 6px" }}>Cotización cliente N.° {numeroCot(h.numero)}</p>
                    <TablaLineas lineas={cli.lineas} campo="valor_cliente" total={cli.total_cliente} etiquetaTotal="Total cliente" />
                  </>
                )}
                <div style={{ ...fila, marginTop: 10 }}>
                  <button type="button" style={{ ...btnGhost, background: "#c8622f", color: "#fff", ...disabled(ocupado === h.id) }} disabled={ocupado === h.id || !cli} onClick={() => pdfCliente(h)}>
                    {ocupado === h.id ? "Generando…" : "PDF cliente (informe + cotización)"}
                  </button>
                  <button type="button" style={{ ...btnGhost, ...disabled(ocupado === h.id) }} disabled={ocupado === h.id} onClick={() => pdfTecnico(h)}>PDF técnico</button>
                  {seleccion.email && cli && (
                    <a style={btnGhostLink} href={`mailto:${seleccion.email}?subject=${encodeURIComponent(`Cotización N.° ${numeroCot(h.numero)} — ${seleccion.nombre}`)}&body=${encodeURIComponent(`Buen día ${seleccion.administrador},\n\nAdjuntamos el informe de la visita técnica del ${fechaCO(h.creado_en)} y la cotización N.° ${numeroCot(h.numero)} correspondiente.\nTotal: ${cop(cli.total_cliente)}\n\nQuedamos atentos.`)}`}>
                      Abrir correo
                    </a>
                  )}
                  {seleccion.cel_admin && cli && (
                    <a style={btnGhostLink} target="_blank" rel="noreferrer" href={`${textoWhatsApp(seleccion.cel_admin)}?text=${encodeURIComponent(`Cotización N.° ${numeroCot(h.numero)} — ${seleccion.nombre}\nFecha: ${fechaCO(h.creado_en)}\nTotal cotización: ${cop(cli.total_cliente)}\n(adjuntamos informe y fotos por este medio)`)}`}>
                      Abrir WhatsApp
                    </a>
                  )}
                  <button type="button" style={btnDanger} disabled={ocupado === h.id} onClick={() => eliminar(h)}>Eliminar</button>
                </div>
                <p style={{ ...muted, fontSize: 11, marginBottom: 0 }}>Descarga el PDF y adjúntalo al correo o al chat de WhatsApp.</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Precios ----------
function Precios() {
  const [precios, setPrecios] = useState([]);
  const [original, setOriginal] = useState([]);
  const [msg, setMsg] = useState({ error: "", ok: "" });
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    supabase.from("precios").select("*").order("orden").then(({ data, error }) => {
      if (error) setMsg({ error: mensajeError(error), ok: "" });
      else { setPrecios(data); setOriginal(data); }
    });
  }, []);

  const guardar = async () => {
    setGuardando(true);
    setMsg({ error: "", ok: "" });
    try {
      const cambios = precios.filter((p) => original.find((o) => o.clave === p.clave)?.valor !== p.valor);
      for (const p of cambios) {
        const { error } = await supabase.from("precios").update({ valor: p.valor }).eq("clave", p.clave);
        if (error) throw error;
      }
      setOriginal(precios);
      setMsg({ error: "", ok: cambios.length ? "Precios guardados." : "No había cambios." });
    } catch (e) {
      setMsg({ error: mensajeError(e), ok: "" });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div style={card}>
      <h3 style={{ marginTop: 0 }}>Precios base (técnico)</h3>
      {precios.map((p) => (
        <div key={p.clave} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", gap: 8 }}>
          <span style={{ fontSize: 13 }}>{p.etiqueta}</span>
          <input type="number" min={0} style={{ ...input, width: 120, padding: 4, marginTop: 0 }} value={p.valor}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setPrecios(precios.map((x) => (x.clave === p.clave ? { ...x, valor: Math.max(0, Math.round(Number(e.target.value) || 0)) } : x)))} />
        </div>
      ))}
      <button style={{ ...btnPrimary, marginTop: 8, ...disabled(guardando) }} disabled={guardando} type="button" onClick={guardar}>Guardar precios</button>
      {msg.error && <p style={errorText}>{msg.error}</p>}
      {msg.ok && <p style={okText}>{msg.ok}</p>}
      <p style={{ fontSize: 12, color: "#6b756f" }}>El cliente paga estos valores + 45%, redondeado. Los técnicos no ven este porcentaje ni el precio del cliente: se calcula en el servidor.</p>
    </div>
  );
}
