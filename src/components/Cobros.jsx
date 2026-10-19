import { useEffect, useState } from "react";
import { mensajeError, supabase } from "../lib/supabase.js";
import { descargarPdf } from "../lib/descargar.js";
import { cop, fechaCO, numeroCot, textoWhatsApp } from "../lib/util.js";
import { btnDanger, btnGhost, btnGhostLink, btnPrimary, card, disabled, errorText, fila, input, muted, okText, smallLabel } from "../styles.js";

const ESTADO_CUENTA = {
  pendiente: { etiqueta: "Pendiente", fondo: "#faeeda", color: "#633806" },
  pagada: { etiqueta: "Pagada", fondo: "#eaf3de", color: "#27500a" },
  anulada: { etiqueta: "Anulada", fondo: "#fbeae8", color: "#b3261e" },
};

// Cuentas de cobro de una copropiedad: emitir nuevas a partir de cotizaciones entregadas y gestionar las existentes
export function CuentasCobro({ seleccion, historial, entregas, clientes, cuentas, recargar }) {
  const [elegidas, setElegidas] = useState([]);
  const [concepto, setConcepto] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(null);

  const porCobrar = historial.filter((h) => entregas[h.id] && !h.cuenta_cobro_id);
  const totalElegido = elegidas.reduce((s, id) => s + (clientes[id]?.total_cliente || 0), 0);

  const accion = async (id, fn) => {
    setOcupado(id);
    setError("");
    try { await fn(); } catch (e) { setError(mensajeError(e)); } finally { setOcupado(null); }
  };

  const alternar = (id) => setElegidas((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const emitir = () => accion("nueva", async () => {
    if (elegidas.length === 0) throw new Error("Elige al menos una cotización entregada.");
    const { data, error: err } = await supabase.rpc("crear_cuenta_cobro", {
      p_copropiedad_id: seleccion.id, p_cotizaciones: elegidas, p_concepto: concepto,
    });
    if (err) throw err;
    setElegidas([]);
    setConcepto("");
    await recargar();
    await descargarPdf("pdfCuentaCobro", data);
  });

  const rpc = (id, nombre, args) => accion(id, async () => {
    const { error: err } = await supabase.rpc(nombre, args);
    if (err) throw err;
    await recargar();
  });

  const anular = (cc) => {
    if (!window.confirm(`¿Anular la cuenta de cobro N.° ${numeroCot(cc.numero)}? El número queda anulado y sus cotizaciones vuelven a quedar listas para cobrar.`)) return;
    rpc(cc.id, "anular_cuenta_cobro", { p_id: cc.id });
  };

  return (
    <div style={{ marginTop: 16, borderTop: "2px solid #1f2a24", paddingTop: 12 }}>
      <h3 style={{ margin: "0 0 8px" }}>Cuentas de cobro</h3>
      {error && <p style={errorText}>{error}</p>}

      {porCobrar.length === 0
        ? <p style={{ ...muted, fontSize: 12 }}>No hay cotizaciones entregadas pendientes de cobro.</p>
        : (
          <div style={{ background: "#f8f9f7", borderRadius: 8, padding: 10, marginBottom: 10 }}>
            <p style={{ fontSize: 12, fontWeight: 700, margin: "0 0 6px" }}>Nueva cuenta de cobro: elige las cotizaciones entregadas</p>
            {porCobrar.map((h) => (
              <label key={h.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "3px 0" }}>
                <input type="checkbox" checked={elegidas.includes(h.id)} onChange={() => alternar(h.id)} />
                N.° {numeroCot(h.numero)} · entrega N.° {numeroCot(entregas[h.id].numero)} del {fechaCO(entregas[h.id].fecha_entrega)} · {cop(clientes[h.id]?.total_cliente || 0)}
              </label>
            ))}
            <label style={{ ...smallLabel, display: "block", margin: "8px 0" }}>Concepto (opcional: si lo dejas vacío se arma con los números de cotización y entrega)
              <input style={{ ...input, padding: 6, marginTop: 2 }} maxLength={1000} value={concepto} onChange={(e) => setConcepto(e.target.value)} />
            </label>
            <button type="button" style={{ ...btnPrimary, ...disabled(ocupado === "nueva" || elegidas.length === 0) }}
              disabled={ocupado === "nueva" || elegidas.length === 0} onClick={emitir}>
              {ocupado === "nueva" ? "Emitiendo…" : `Emitir cuenta de cobro${elegidas.length ? ` por ${cop(totalElegido)}` : ""}`}
            </button>
          </div>
        )}

      {cuentas.map((cc) => {
        const e = ESTADO_CUENTA[cc.estado];
        const trabajando = ocupado === cc.id;
        return (
          <div key={cc.id} style={{ padding: "8px 0", borderBottom: "1px dashed #eee", opacity: trabajando ? 0.6 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", fontSize: 13 }}>
              <span><b>CC N.° {numeroCot(cc.numero)}</b> · {fechaCO(cc.fecha)} · vence {fechaCO(cc.vence)} · <b>{cop(cc.total)}</b></span>
              <span style={{ background: e.fondo, color: e.color, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{e.etiqueta}</span>
            </div>
            <div style={{ ...fila, marginTop: 6 }}>
              <button type="button" style={{ ...btnGhost, ...disabled(trabajando) }} disabled={trabajando}
                onClick={() => accion(cc.id, () => descargarPdf("pdfCuentaCobro", cc))}>PDF</button>
              {cc.estado === "pendiente" && (
                <button type="button" style={{ ...btnGhost, background: "#c8622f", color: "#fff", ...disabled(trabajando) }} disabled={trabajando}
                  onClick={() => rpc(cc.id, "marcar_cuenta_pagada", { p_id: cc.id, p_pagada: true })}>Marcar pagada</button>
              )}
              {cc.estado === "pagada" && (
                <button type="button" style={{ ...btnGhost, ...disabled(trabajando) }} disabled={trabajando}
                  onClick={() => rpc(cc.id, "marcar_cuenta_pagada", { p_id: cc.id, p_pagada: false })}>Volver a pendiente</button>
              )}
              {cc.estado !== "anulada" && seleccion.email && (
                <a style={btnGhostLink} href={`mailto:${seleccion.email}?subject=${encodeURIComponent(`Cuenta de cobro N.° ${numeroCot(cc.numero)} — ${seleccion.nombre}`)}&body=${encodeURIComponent(`Buen día ${seleccion.administrador},\n\nAdjuntamos la cuenta de cobro N.° ${numeroCot(cc.numero)} por ${cop(cc.total)}, con vencimiento el ${fechaCO(cc.vence)}.\n\nQuedamos atentos.`)}`}>
                  Abrir correo
                </a>
              )}
              {cc.estado !== "anulada" && seleccion.cel_admin && (
                <a style={btnGhostLink} target="_blank" rel="noreferrer" href={`${textoWhatsApp(seleccion.cel_admin)}?text=${encodeURIComponent(`Cuenta de cobro N.° ${numeroCot(cc.numero)} — ${seleccion.nombre}\nValor: ${cop(cc.total)}\nVence: ${fechaCO(cc.vence)}\n(adjuntamos el PDF por este medio)`)}`}>
                  Abrir WhatsApp
                </a>
              )}
              {cc.estado === "pendiente" && (
                <button type="button" style={{ ...btnDanger, ...disabled(trabajando) }} disabled={trabajando} onClick={() => anular(cc)}>Anular</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Datos del prestador (quien emite las cuentas de cobro) ----------
export function DatosEmisor() {
  const [emisor, setEmisor] = useState(null);
  const [garantia, setGarantia] = useState(6);
  const [msg, setMsg] = useState({ error: "", ok: "" });
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("emisor").select("*").eq("id", 1).single(),
      supabase.from("ajustes").select("garantia_meses").eq("id", 1).single(),
    ]).then(([e, a]) => {
      const err = e.error || a.error;
      if (err) { setMsg({ error: mensajeError(err), ok: "" }); return; }
      setEmisor(e.data);
      setGarantia(a.data.garantia_meses);
    });
  }, []);

  const set = (k, v) => setEmisor((prev) => ({ ...prev, [k]: v }));

  const guardar = async () => {
    setGuardando(true);
    setMsg({ error: "", ok: "" });
    try {
      const { id, ...datos } = emisor;
      const limpio = Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
      const r1 = await supabase.from("emisor").update(limpio).eq("id", id);
      if (r1.error) throw r1.error;
      const r2 = await supabase.from("ajustes").update({ garantia_meses: garantia }).eq("id", 1);
      if (r2.error) throw r2.error;
      setMsg({ error: "", ok: "Datos guardados. Se usan en las cuentas de cobro que emitas desde ahora." });
    } catch (e) {
      setMsg({ error: mensajeError(e), ok: "" });
    } finally {
      setGuardando(false);
    }
  };

  if (!emisor) return <div style={card}><h3 style={{ marginTop: 0 }}>Datos para documentos</h3>{msg.error ? <p style={errorText}>{msg.error}</p> : <p>Cargando…</p>}</div>;

  const campo = { ...input, padding: 6, marginTop: 2 };
  const texto = (k, label, caso) => (
    <label style={smallLabel}>{label}
      <input style={{ ...campo, textTransform: caso === "upper" ? "uppercase" : "none" }} maxLength={150} value={emisor[k]}
        onChange={(e) => set(k, caso === "upper" ? e.target.value.toUpperCase() : caso === "lower" ? e.target.value.toLowerCase() : e.target.value)} />
    </label>
  );
  const opciones = (k, label, valores) => (
    <label style={smallLabel}>{label}
      <select style={campo} value={emisor[k]} onChange={(e) => set(k, e.target.value)}>
        {valores.map((x) => <option key={x}>{x}</option>)}
      </select>
    </label>
  );
  return (
    <div style={card}>
      <h3 style={{ marginTop: 0 }}>Datos para documentos</h3>
      <p style={{ ...muted, marginTop: -6 }}>Quién emite las cuentas de cobro y a qué cuenta se paga. Cada cuenta de cobro guarda una copia de estos datos al emitirse.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
        {texto("nombre", "Nombre o razón social", "upper")}
        {opciones("tipo_documento", "Tipo de documento", ["C.C.", "NIT", "C.E."])}
        {texto("documento", "Número de documento")}
        {texto("celular", "Celular")}
        {texto("email", "Correo", "lower")}
        {texto("direccion", "Dirección", "upper")}
        {texto("ciudad", "Ciudad de expedición")}
        {texto("banco", "Banco")}
        {opciones("tipo_cuenta", "Tipo de cuenta", ["Ahorros", "Corriente"])}
        {texto("numero_cuenta", "Número de cuenta")}
        <label style={smallLabel}>Días para pagar
          <input type="number" min={0} max={120} style={campo} value={emisor.dias_vencimiento} onFocus={(e) => e.target.select()}
            onChange={(e) => set("dias_vencimiento", Math.min(120, Math.max(0, Math.round(Number(e.target.value) || 0))))} />
        </label>
        <label style={smallLabel}>Garantía de las entregas (meses)
          <input type="number" min={0} max={60} style={campo} value={garantia} onFocus={(e) => e.target.select()}
            onChange={(e) => setGarantia(Math.min(60, Math.max(0, Math.round(Number(e.target.value) || 0))))} />
        </label>
      </div>
      <label style={{ ...smallLabel, display: "block", marginTop: 8 }}>Declaración al pie de la cuenta de cobro
        <textarea style={{ ...campo, minHeight: 70, fontFamily: "inherit" }} maxLength={1500} value={emisor.declaracion} onChange={(e) => set("declaracion", e.target.value)} />
      </label>
      <p style={{ ...muted, fontSize: 11, marginTop: 4 }}>Si eres responsable de IVA o estás obligado a facturar, la ley te exige factura electrónica en lugar de cuenta de cobro. Confirma este texto con tu contador.</p>
      <button type="button" style={{ ...btnPrimary, marginTop: 4, ...disabled(guardando) }} disabled={guardando} onClick={guardar}>Guardar datos</button>
      {msg.error && <p style={errorText}>{msg.error}</p>}
      {msg.ok && <p style={okText}>{msg.ok}</p>}
    </div>
  );
}
