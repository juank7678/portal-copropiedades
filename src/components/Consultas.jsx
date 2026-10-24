import { useCallback, useEffect, useMemo, useState } from "react";
import { mensajeError, supabase } from "../lib/supabase.js";
import { descargarPdf } from "../lib/descargar.js";
import { ESTADOS, cop, estadoCotizacion, fechaCO, fechaISO, numeroCot, textoWhatsApp } from "../lib/util.js";
import { btnGhost, btnGhostLink, card, disabled, errorText, fila, input, muted, smallLabel } from "../styles.js";
import { EstadoBadge } from "./Entrega.jsx";

// La API entrega máximo 1000 filas por consulta: se piden por bloques hasta traerlas todas
async function todo(armar) {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await armar().range(desde, desde + 999);
    if (error) throw error;
    filas.push(...data);
    if (data.length < 1000) return filas;
  }
}

const VISTAS = [["cotizaciones", "Cotizaciones"], ["copropiedades", "Copropiedades"], ["tecnicos", "Técnicos"], ["cobros", "Cuentas de cobro"]];
const FILTRO_VACIO = { texto: "", desde: "", hasta: "", tecnico: "", estado: "" };
const MAX_FILAS = 300;

const normal = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const coincide = (texto, ...campos) => !texto || campos.some((c) => normal(c).includes(normal(texto)));
const enRango = (fecha, { desde, hasta }) => (!desde || fecha >= desde) && (!hasta || fecha <= hasta);
const suma = (filas, campo) => filas.reduce((s, f) => s + (f[campo] || 0), 0);

// Consultas del administrador: todo lo guardado en el portal, con filtros, totales y reporte en PDF
export default function Consultas({ onAbrirCarpeta }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [vista, setVista] = useState("cotizaciones");
  const [filtro, setFiltro] = useState(FILTRO_VACIO);
  const [generando, setGenerando] = useState(false);

  const cargar = useCallback(async () => {
    setError("");
    try {
      const [cops, cots, clientes, entregas, cuentas, tecnicos] = await Promise.all([
        todo(() => supabase.from("copropiedades").select("*").order("nombre")),
        todo(() => supabase.from("cotizaciones")
          .select("id, numero, copropiedad_id, copropiedad_nombre, tecnico_id, tecnico_nombre, torre, piso, total_tecnico, creado_en, aprobada_en, cuenta_cobro_id")
          .order("numero", { ascending: false })),
        todo(() => supabase.from("cotizaciones_cliente").select("cotizacion_id, total_cliente").order("cotizacion_id")),
        todo(() => supabase.from("entregas").select("id, numero, cotizacion_id, fecha_entrega").order("numero")),
        todo(() => supabase.from("cuentas_cobro").select("id, numero, copropiedad_id, fecha, vence, total, estado, pagada_en").order("numero", { ascending: false })),
        todo(() => supabase.from("perfiles").select("id, nombre, activo").eq("rol", "tecnico").order("nombre")),
      ]);
      const totalCliente = Object.fromEntries(clientes.map((c) => [c.cotizacion_id, c.total_cliente]));
      const entregaDe = Object.fromEntries(entregas.map((e) => [e.cotizacion_id, e]));
      const cuentaDe = Object.fromEntries(cuentas.map((c) => [c.id, c]));
      const copDe = Object.fromEntries(cops.map((c) => [c.id, c]));
      const hoy = fechaISO();
      setDatos({
        cops, tecnicos,
        cots: cots.map((q) => ({
          ...q,
          fecha: fechaISO(q.creado_en),
          total_cliente: totalCliente[q.id] || 0,
          estado: estadoCotizacion(q, entregaDe[q.id], cuentaDe[q.cuenta_cobro_id]),
          cop: copDe[q.copropiedad_id],
        })),
        cuentas: cuentas.map((c) => ({ ...c, vencida: c.estado === "pendiente" && c.vence < hoy, cop: copDe[c.copropiedad_id] })),
      });
    } catch (e) {
      setError(mensajeError(e));
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const set = (k) => (e) => setFiltro({ ...filtro, [k]: e.target.value });
  const hayFiltro = Object.values(filtro).some(Boolean);

  // Cotizaciones que cumplen todos los filtros (base de los totales y de casi todas las vistas)
  const cots = useMemo(() => (datos?.cots || []).filter((q) =>
    enRango(q.fecha, filtro)
    && (!filtro.tecnico || q.tecnico_id === filtro.tecnico)
    && (!filtro.estado || q.estado === filtro.estado)
    && coincide(filtro.texto, numeroCot(q.numero), q.copropiedad_nombre, q.tecnico_nombre, q.cop?.administrador, q.cop?.nit)), [datos, filtro]);

  // Con filtro de técnico, una cuenta cuenta si incluye alguna visita de ese técnico
  const cuentas = useMemo(() => {
    const delTecnico = new Set((datos?.cots || []).filter((q) => q.tecnico_id === filtro.tecnico).map((q) => q.cuenta_cobro_id));
    return (datos?.cuentas || []).filter((c) =>
      enRango(c.fecha, filtro)
      && (!filtro.tecnico || delTecnico.has(c.id))
      && coincide(filtro.texto, numeroCot(c.numero), c.cop?.nombre, c.cop?.administrador, c.cop?.nit));
  }, [datos, filtro]);

  const cops = useMemo(() => (datos?.cops || []).filter((c) =>
    (!filtro.tecnico || c.tecnico_id === filtro.tecnico)
    && coincide(filtro.texto, c.nombre, c.administrador, c.nit, c.cel_admin, c.email, c.direccion)), [datos, filtro]);

  const tecnicos = useMemo(() => (datos?.tecnicos || []).filter((t) =>
    (!filtro.tecnico || t.id === filtro.tecnico) && coincide(filtro.texto, t.nombre)), [datos, filtro]);

  const pendientes = cuentas.filter((c) => c.estado === "pendiente");
  const resumen = [
    ["Visitas", String(cots.length)],
    ["Cotizado al cliente", cop(suma(cots, "total_cliente"))],
    ["A pagar a técnicos", cop(suma(cots, "total_tecnico"))],
    ["Diferencia (margen)", cop(suma(cots, "total_cliente") - suma(cots, "total_tecnico"))],
    ["Por cobrar", cop(suma(pendientes, "total"))],
    ["Vencido", cop(suma(pendientes.filter((c) => c.vencida), "total"))],
  ];

  const descripcionFiltro = () => {
    const partes = [];
    if (filtro.desde || filtro.hasta) partes.push(`${filtro.desde ? `Desde ${fechaCO(filtro.desde)}` : ""} ${filtro.hasta ? `hasta ${fechaCO(filtro.hasta)}` : ""}`.trim());
    if (filtro.tecnico) partes.push(`Técnico: ${datos.tecnicos.find((t) => t.id === filtro.tecnico)?.nombre}`);
    if (filtro.estado) partes.push(`Estado: ${ESTADOS[filtro.estado].etiqueta}`);
    if (filtro.texto) partes.push(`Búsqueda: "${filtro.texto}"`);
    return partes.join(" · ") || "Todos los registros";
  };

  const reporte = async () => {
    setGenerando(true);
    try {
      await descargarPdf("pdfReporte", { ...TABLAS[vista]({ cots, cops, cuentas, tecnicos, todas: datos.cots }), subtitulo: descripcionFiltro(), resumen });
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setGenerando(false);
    }
  };

  if (!datos) return <div style={card}>{error ? <p style={errorText}>{error}</p> : "Cargando consultas…"}</div>;

  return (
    <div>
      <div style={card}>
        <h2 style={{ marginTop: 0 }}>Consultas</h2>
        <p style={{ ...muted, marginTop: -6 }}>Busca y filtra todo lo registrado en el portal. Los totales se calculan con los filtros elegidos.</p>
        <input style={{ ...input, marginTop: 0, marginBottom: 8 }} placeholder="Buscar copropiedad, NIT, técnico o N.°"
          value={filtro.texto} onChange={set("texto")} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
          <label style={smallLabel}>Desde
            <input type="date" style={{ ...input, padding: 6, marginTop: 2 }} value={filtro.desde} onChange={set("desde")} />
          </label>
          <label style={smallLabel}>Hasta
            <input type="date" style={{ ...input, padding: 6, marginTop: 2 }} value={filtro.hasta} onChange={set("hasta")} />
          </label>
          <label style={smallLabel}>Técnico
            <select style={{ ...input, padding: 6, marginTop: 2 }} value={filtro.tecnico} onChange={set("tecnico")}>
              <option value="">Todos</option>
              {datos.tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nombre}{t.activo ? "" : " (inactivo)"}</option>)}
            </select>
          </label>
          <label style={smallLabel}>Estado de la cotización
            <select style={{ ...input, padding: 6, marginTop: 2 }} value={filtro.estado} onChange={set("estado")}>
              <option value="">Todos</option>
              {Object.entries(ESTADOS).map(([k, e]) => <option key={k} value={k}>{e.etiqueta}</option>)}
            </select>
          </label>
        </div>
        <div style={{ ...fila, marginTop: 10 }}>
          {hayFiltro && <button type="button" style={btnGhost} onClick={() => setFiltro(FILTRO_VACIO)}>Quitar filtros</button>}
          <button type="button" style={btnGhost} onClick={cargar}>Actualizar</button>
        </div>
        {error && <p style={errorText}>{error}</p>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginBottom: 14 }}>
        {resumen.map(([etiqueta, valor]) => (
          <div key={etiqueta} style={{ ...card, marginBottom: 0, padding: 12 }}>
            <div style={{ ...smallLabel, textTransform: "uppercase", letterSpacing: 0.4 }}>{etiqueta}</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{valor}</div>
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
          {VISTAS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setVista(k)}
              style={{ ...btnGhost, flex: "1 1 auto", background: vista === k ? "#1f2a24" : "#eef0ec", color: vista === k ? "#fff" : "#1f2a24" }}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" style={{ ...btnGhost, background: "#c8622f", color: "#fff", marginBottom: 10, ...disabled(generando) }} disabled={generando} onClick={reporte}>
          {generando ? "Generando…" : "Descargar esta consulta (PDF)"}
        </button>

        {vista === "cotizaciones" && <ListaCotizaciones cots={cots} onAbrirCarpeta={onAbrirCarpeta} />}
        {vista === "copropiedades" && <ListaCopropiedades cops={cops} todas={datos.cots} cuentas={datos.cuentas} tecnicos={datos.tecnicos} onAbrirCarpeta={onAbrirCarpeta} />}
        {vista === "tecnicos" && <ListaTecnicos tecnicos={tecnicos} cots={cots} cops={datos.cops} />}
        {vista === "cobros" && <ListaCuentas cuentas={cuentas} onAbrirCarpeta={onAbrirCarpeta} />}
      </div>
    </div>
  );
}

// ---------- Vistas ----------
const filaLista = { borderTop: "1px solid #eee", padding: "9px 0", fontSize: 13 };
const linkBtn = { background: "none", border: "none", padding: 0, color: "#c8622f", fontWeight: 600, cursor: "pointer", fontSize: 12 };

function Recorte({ total }) {
  if (total <= MAX_FILAS) return null;
  return <p style={{ ...muted, fontSize: 12 }}>Se muestran los primeros {MAX_FILAS} de {total}. Usa los filtros para acotar (el PDF incluye todos).</p>;
}

function Vacio() {
  return <p style={muted}>No hay resultados con estos filtros.</p>;
}

function ListaCotizaciones({ cots, onAbrirCarpeta }) {
  if (!cots.length) return <Vacio />;
  return (
    <div>
      {cots.slice(0, MAX_FILAS).map((q) => (
        <div key={q.id} style={filaLista}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <span><b>N.° {numeroCot(q.numero)}</b> · {fechaCO(q.creado_en)} · {q.copropiedad_nombre}</span>
            <EstadoBadge estado={q.estado} />
          </div>
          <div style={{ ...muted, fontSize: 12, marginTop: 2 }}>
            {q.tecnico_nombre} · Torre {q.torre}/Piso {q.piso} · Cliente: <b style={{ color: "#1f2a24" }}>{cop(q.total_cliente)}</b> · Técnico: {cop(q.total_tecnico)}
          </div>
          <button type="button" style={linkBtn} onClick={() => onAbrirCarpeta(q.copropiedad_id)}>Abrir carpeta →</button>
        </div>
      ))}
      <Recorte total={cots.length} />
    </div>
  );
}

function ListaCopropiedades({ cops, todas, cuentas, tecnicos, onAbrirCarpeta }) {
  if (!cops.length) return <Vacio />;
  return (
    <div>
      {cops.slice(0, MAX_FILAS).map((c) => {
        const visitas = todas.filter((q) => q.copropiedad_id === c.id);
        const pendiente = suma(cuentas.filter((x) => x.copropiedad_id === c.id && x.estado === "pendiente"), "total");
        const tec = tecnicos.find((t) => t.id === c.tecnico_id);
        return (
          <div key={c.id} style={filaLista}>
            <b>{c.nombre} ({c.anio})</b>{c.nit && <span style={muted}> · NIT {c.nit}</span>}
            <div style={{ ...muted, fontSize: 12, marginTop: 2, lineHeight: 1.6 }}>
              Administrador: {c.administrador || "—"}<br />
              {c.direccion && <>{c.direccion}<br /></>}
              Técnico: {tec?.nombre || "sin asignar"} · Visitas: {visitas.length}
              {visitas[0] && ` · Última: ${fechaCO(visitas[0].creado_en)}`}
              {pendiente > 0 && <> · <b style={{ color: "#633806" }}>Por cobrar: {cop(pendiente)}</b></>}
            </div>
            <div style={{ ...fila, marginTop: 6 }}>
              <button type="button" style={btnGhost} onClick={() => onAbrirCarpeta(c.id)}>Abrir carpeta</button>
              {c.cel_admin && <a style={btnGhostLink} href={`tel:${c.cel_admin}`}>Llamar {c.cel_admin}</a>}
              {c.cel_admin && <a style={btnGhostLink} target="_blank" rel="noreferrer" href={textoWhatsApp(c.cel_admin)}>WhatsApp</a>}
              {c.email && <a style={btnGhostLink} href={`mailto:${c.email}`}>{c.email}</a>}
              {c.tel_porteria && <a style={btnGhostLink} href={`tel:${c.tel_porteria}`}>Portería {c.tel_porteria}</a>}
            </div>
          </div>
        );
      })}
      <Recorte total={cops.length} />
    </div>
  );
}

const resumenTecnico = (t, cots, cops) => {
  const suyas = cots.filter((q) => q.tecnico_id === t.id);
  return {
    visitas: suyas.length,
    entregadas: suyas.filter((q) => ["entregada", "cobrada", "pagada"].includes(q.estado)).length,
    asignadas: cops.filter((c) => c.tecnico_id === t.id).length,
    total: suma(suyas, "total_tecnico"),
  };
};

function ListaTecnicos({ tecnicos, cots, cops }) {
  if (!tecnicos.length) return <Vacio />;
  return (
    <div>
      <p style={{ ...muted, fontSize: 12, marginTop: 0 }}>Totales de las visitas que cumplen los filtros (por ejemplo, elige un rango de fechas para ver lo que se le debe a cada técnico en ese período).</p>
      {tecnicos.map((t) => {
        const r = resumenTecnico(t, cots, cops);
        return (
          <div key={t.id} style={filaLista}>
            <b>{t.nombre}</b>{!t.activo && <span style={{ color: "#b3261e", fontSize: 11, fontWeight: 700 }}> · INACTIVO</span>}
            <div style={{ ...muted, fontSize: 12, marginTop: 2 }}>
              Visitas: {r.visitas} · Entregadas: {r.entregadas} · Copropiedades asignadas: {r.asignadas} · Total servicios: <b style={{ color: "#1f2a24" }}>{cop(r.total)}</b>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const ESTADO_CUENTA = { pendiente: "Pendiente", pagada: "Pagada", anulada: "Anulada" };
const estadoCuenta = (c) => (c.vencida ? "Vencida" : ESTADO_CUENTA[c.estado]);

function ListaCuentas({ cuentas, onAbrirCarpeta }) {
  if (!cuentas.length) return <Vacio />;
  return (
    <div>
      {cuentas.slice(0, MAX_FILAS).map((c) => (
        <div key={c.id} style={filaLista}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span><b>N.° {numeroCot(c.numero)}</b> · {c.cop?.nombre || "—"}</span>
            <b style={{ color: c.vencida ? "#b3261e" : c.estado === "pagada" ? "#27500a" : c.estado === "anulada" ? "#6b756f" : "#633806", fontSize: 12 }}>{estadoCuenta(c)}</b>
          </div>
          <div style={{ ...muted, fontSize: 12, marginTop: 2 }}>
            Emitida {fechaCO(c.fecha)} · Vence {fechaCO(c.vence)}{c.pagada_en ? ` · Pagada ${fechaCO(c.pagada_en)}` : ""} · <b style={{ color: "#1f2a24" }}>{cop(c.total)}</b>
          </div>
          <button type="button" style={linkBtn} onClick={() => onAbrirCarpeta(c.copropiedad_id)}>Abrir carpeta →</button>
        </div>
      ))}
      <Recorte total={cuentas.length} />
    </div>
  );
}

// ---------- Tablas para el PDF (una por vista) ----------
const TABLAS = {
  cotizaciones: ({ cots }) => ({
    titulo: "Consulta de cotizaciones",
    columnas: ["N.°", "Fecha", "Copropiedad", "Técnico", "Estado", "Cliente", "Pago técnico"],
    alinear: { 5: "right", 6: "right" },
    filas: cots.map((q) => [numeroCot(q.numero), fechaCO(q.creado_en), q.copropiedad_nombre, q.tecnico_nombre, ESTADOS[q.estado].etiqueta, cop(q.total_cliente), cop(q.total_tecnico)]),
    totales: ["", "", "", "", "Total", cop(suma(cots, "total_cliente")), cop(suma(cots, "total_tecnico"))],
  }),
  copropiedades: ({ cops, todas, cuentas }) => ({
    titulo: "Directorio de copropiedades",
    columnas: ["Copropiedad", "NIT", "Administrador", "Celular", "Correo", "Visitas", "Por cobrar"],
    alinear: { 5: "center", 6: "right" },
    filas: cops.map((c) => [
      `${c.nombre} (${c.anio})`, c.nit, c.administrador, c.cel_admin, c.email,
      String(todas.filter((q) => q.copropiedad_id === c.id).length),
      cop(suma(cuentas.filter((x) => x.copropiedad_id === c.id && x.estado === "pendiente"), "total")),
    ]),
  }),
  tecnicos: ({ tecnicos, cots, cops }) => {
    const filas = tecnicos.map((t) => ({ t, r: resumenTecnico(t, cots, cops) }));
    return {
      titulo: "Resumen por técnico",
      columnas: ["Técnico", "Visitas", "Entregadas", "Copropiedades asignadas", "Total servicios"],
      alinear: { 1: "center", 2: "center", 3: "center", 4: "right" },
      filas: filas.map(({ t, r }) => [`${t.nombre}${t.activo ? "" : " (inactivo)"}`, String(r.visitas), String(r.entregadas), String(r.asignadas), cop(r.total)]),
      totales: ["Total", "", "", "", cop(filas.reduce((s, x) => s + x.r.total, 0))],
    };
  },
  cobros: ({ cuentas }) => ({
    titulo: "Cuentas de cobro",
    columnas: ["N.°", "Copropiedad", "Emitida", "Vence", "Estado", "Valor"],
    alinear: { 5: "right" },
    filas: cuentas.map((c) => [numeroCot(c.numero), c.cop?.nombre || "", fechaCO(c.fecha), fechaCO(c.vence), estadoCuenta(c), cop(c.total)]),
    totales: ["", "", "", "", "Pendiente", cop(suma(cuentas.filter((c) => c.estado === "pendiente"), "total"))],
  }),
};
