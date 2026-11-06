import { useCallback, useEffect, useState } from "react";
import { mensajeError, supabase } from "../lib/supabase.js";
import { fechaHoraCO } from "../lib/util.js";
import { btnGhost, btnGhostLink, btnPrimary, card, disabled, errorText, fieldLabel, fila, input, muted, okText } from "../styles.js";
import { MARCA } from "../lib/marca.js";
import codigoScript from "../../nube/Codigo.gs?raw";

const ESTADO = {
  pendiente: { texto: "En cola", fondo: "#eef0ec", color: "#4a534d" },
  enviando: { texto: "Enviando", fondo: "#e6f1fb", color: "#0c447c" },
  enviado: { texto: "Enviado", fondo: "#eaf3de", color: "#27500a" },
  error: { texto: "Con error", fondo: "#fbeae8", color: "#b3261e" },
  descartado: { texto: "Descartado", fondo: "#eef0ec", color: "#6b756f" },
};

// Conexión con la cuenta de Google del administrador: correo automático y carpeta en Drive
export default function Nube() {
  const [conexion, setConexion] = useState(null);
  const [avisos, setAvisos] = useState([]);
  const [form, setForm] = useState({ url: "", token: "", correo: "" });
  const [editando, setEditando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState({ ok: "", error: "" });
  const [copiado, setCopiado] = useState(false);

  const cargar = useCallback(async () => {
    const [c, a] = await Promise.all([
      supabase.rpc("avisos_conexion"),
      supabase.from("avisos").select("*").order("creado_en", { ascending: false }).limit(15),
    ]);
    if (c.error || a.error) { setMsg({ ok: "", error: mensajeError(c.error || a.error) }); return; }
    setConexion(c.data);
    setAvisos(a.data);
    setForm((f) => ({ ...f, url: f.url || c.data.url, correo: f.correo || c.data.correo }));
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // Mientras haya envíos en curso, la lista se actualiza sola
  const enCurso = avisos.some((a) => a.estado === "pendiente" || a.estado === "enviando");
  useEffect(() => {
    if (!enCurso || !conexion?.conectado) return undefined;
    const t = setInterval(cargar, 10000);
    return () => clearInterval(t);
  }, [enCurso, conexion, cargar]);

  const ejecutar = async (accion, ok) => {
    setOcupado(true);
    setMsg({ ok: "", error: "" });
    try {
      const r = await accion();
      setMsg({ ok: typeof ok === "function" ? ok(r) : ok, error: "" });
      await cargar();
    } catch (e) {
      setMsg({ ok: "", error: mensajeError(e) });
    } finally {
      setOcupado(false);
    }
  };

  const rpc = async (nombre, args) => {
    const { data, error } = await supabase.rpc(nombre, args);
    if (error) throw error;
    return data;
  };

  const guardar = () => ejecutar(async () => {
    await rpc("guardar_conexion_avisos", { p_url: form.url, p_token: form.token, p_correo: form.correo });
    setForm((f) => ({ ...f, token: "" }));
    setEditando(false);
  }, "Conexión guardada. Ahora envía una prueba.");

  const copiarCodigo = async () => {
    try { await navigator.clipboard.writeText(codigoScript); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { /* sin permiso de portapapeles */ }
  };

  if (!conexion) return <div style={card}><h2 style={{ marginTop: 0 }}>Correo y carpeta en la nube</h2>{msg.error ? <p style={errorText}>{msg.error}</p> : <p style={muted}>Cargando…</p>}</div>;

  const mostrarFormulario = !conexion.conectado || editando;

  return (
    <div style={card}>
      <h2 style={{ marginTop: 0 }}>Correo y carpeta en la nube</h2>
      <p style={{ ...muted, marginTop: -6 }}>
        Cada registro, visita y entrega llega por correo con sus PDF, y los informes y las fotos quedan en Google Drive, en la carpeta <b>Portal Cprado2001</b>, organizados por copropiedad.
      </p>

      {conexion.conectado && (
        <div style={{ background: "#eaf3de", borderRadius: 8, padding: "10px 12px", margin: "10px 0", fontSize: 13 }}>
          <b>Conectado.</b> Los avisos llegan a <b>{conexion.correo}</b>.
        </div>
      )}

      {!conexion.conectado && (
        <>
          <div style={{ background: "#faeeda", borderRadius: 8, padding: "10px 12px", margin: "10px 0", fontSize: 13, color: "#633806" }}>
            <b>Falta conectar la cuenta de Google.</b> Se hace una sola vez. Lo que se registre mientras tanto queda en cola y se envía al conectar.
          </div>
          <ol style={{ fontSize: 13, paddingLeft: 20, lineHeight: 1.55, margin: "10px 0" }}>
            <li>En el computador, entra a <a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">script.google.com</a> con la cuenta de Google que recibirá los avisos (la de {MARCA.correo.replace(/\+[^@]*/, "")}). Se abre un proyecto nuevo.</li>
            <li>Borra lo que aparece en el editor, pega el código y guarda (ícono de disquete). <button type="button" style={{ ...btnGhost, padding: "3px 10px", fontSize: 12 }} onClick={copiarCodigo}>{copiado ? "Código copiado ✓" : "Copiar el código"}</button></li>
            <li>Arriba, elige la función <b>configurar</b> y pulsa <b>Ejecutar</b>. Google pide permisos: <b>Revisar permisos</b>, elige la cuenta y, en el aviso de "app no verificada" (es normal, el script es tuyo), <b>Configuración avanzada</b> → <b>Ir a…</b> → <b>Permitir</b>. Abajo, en el registro, aparece la <b>CLAVE</b>: cópiala.</li>
            <li>Pulsa <b>Implementar</b> → <b>Nueva implementación</b> → engranaje → <b>Aplicación web</b>. En "Ejecutar como" deja <b>Yo</b>; en "Quién tiene acceso" elige <b>Cualquier persona</b>. Pulsa <b>Implementar</b> y copia la <b>URL</b>, que termina en <code>/exec</code>.</li>
            <li>Pega la URL y la clave aquí abajo, guarda y envía una prueba.</li>
          </ol>
        </>
      )}

      {mostrarFormulario && (
        <>
          <label style={fieldLabel}>URL de la aplicación web
            <input style={input} value={form.url} placeholder="https://script.google.com/macros/s/…/exec" onChange={(e) => setForm({ ...form, url: e.target.value })} />
          </label>
          <label style={fieldLabel}>Clave {conexion.conectado && <span style={{ fontWeight: 400 }}>(déjala en blanco para conservar la actual)</span>}
            <input style={input} type="password" autoComplete="off" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
          </label>
          <label style={fieldLabel}>Correo que recibe los avisos
            <input style={input} type="email" value={form.correo} onChange={(e) => setForm({ ...form, correo: e.target.value })} />
          </label>
          <button type="button" style={{ ...btnPrimary, ...disabled(ocupado) }} disabled={ocupado} onClick={guardar}>Guardar conexión</button>
        </>
      )}

      {conexion.conectado && (
        <div style={{ ...fila, marginTop: 10 }}>
          <button type="button" style={{ ...btnGhost, ...disabled(ocupado) }} disabled={ocupado} onClick={() => ejecutar(() => rpc("enviar_prueba_aviso"), "Prueba enviada. Revisa el correo en un momento.")}>Enviar prueba</button>
          {conexion.carpeta_url && <a style={btnGhostLink} href={conexion.carpeta_url} target="_blank" rel="noreferrer">Abrir carpeta en Drive</a>}
          <button type="button" style={{ ...btnGhost, ...disabled(ocupado) }} disabled={ocupado}
            title="Copia a Drive, sin enviar correos, lo que se registró antes de conectar"
            onClick={() => ejecutar(() => rpc("copiar_historico_a_nube"), (n) => (n ? `Se copiarán ${n} elementos a la carpeta en los próximos minutos, sin enviar correos.` : "Ya estaba todo en la carpeta."))}>
            Copiar lo ya registrado
          </button>
          <button type="button" style={btnGhost} onClick={() => setEditando(!editando)}>{editando ? "Cerrar" : "Cambiar conexión"}</button>
        </div>
      )}

      {msg.error && <p style={errorText}>{msg.error}</p>}
      {msg.ok && <p style={okText}>{msg.ok}</p>}

      {avisos.length > 0 && (
        <>
          <h3 style={{ margin: "16px 0 6px", fontSize: 14 }}>Últimos avisos</h3>
          {avisos.map((a) => {
            const e = ESTADO[a.estado];
            return (
              <div key={a.id} style={{ padding: "7px 0", borderTop: "1px solid #eee", fontSize: 13 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ flex: 1, minWidth: 180 }}>{a.titulo}<span style={{ color: "#6b756f" }}> · {fechaHoraCO(a.creado_en)}{a.con_correo ? "" : " · solo carpeta"}</span></span>
                  <span style={{ background: e.fondo, color: e.color, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{e.texto}</span>
                  {a.carpeta_url && <a href={a.carpeta_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Carpeta</a>}
                  {a.estado === "error" && (
                    <button type="button" style={{ ...btnGhost, padding: "3px 10px", fontSize: 12, ...disabled(ocupado) }} disabled={ocupado}
                      onClick={() => ejecutar(() => rpc("reintentar_aviso", { p_id: a.id }), "Reintento en curso.")}>Reintentar</button>
                  )}
                </div>
                {a.error && a.estado !== "enviado" && <div style={{ color: "#b3261e", fontSize: 12, marginTop: 2 }}>{a.error}</div>}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
