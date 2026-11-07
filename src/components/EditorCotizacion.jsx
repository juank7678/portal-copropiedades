import { useEffect, useState } from "react";
import { mensajeError, supabase } from "../lib/supabase.js";
import { cop, fechaHoraCO, numeroCot } from "../lib/util.js";
import { btnGhost, btnPrimary, disabled, errorText, input, muted, smallLabel } from "../styles.js";
import { TablaLineas } from "./PanelTecnico.jsx";

const DESCUENTOS = [0, 3, 5, 10];

const comoFilas = (lineas) => lineas.map((l, i) => ({ ...l, clave: i }));

// Revisar → editar → elegir descuento → confirmar. El servidor recalcula los totales y guarda la versión.
export default function EditorCotizacion({ cot, cliente, editable, onListo }) {
  const confirmada = Boolean(cliente.confirmada_en);
  const [editando, setEditando] = useState(false);
  const [filas, setFilas] = useState(() => comoFilas(cliente.lineas));
  const [descuento, setDescuento] = useState(cliente.descuento_pct);
  const [versiones, setVersiones] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.from("cotizacion_versiones").select("*").eq("cotizacion_id", cot.id).order("version").then(({ data, error: err }) => {
      if (err) setError(mensajeError(err));
      else setVersiones(data);
    });
  }, [cot.id, cliente.version, cliente.confirmada_en]);

  const abrir = () => {
    setFilas(comoFilas(cliente.lineas));
    setDescuento(cliente.descuento_pct);
    setError("");
    setEditando(true);
  };
  const cambiar = (clave, cambios) => setFilas((prev) => prev.map((f) => (f.clave === clave ? { ...f, ...cambios } : f)));
  const quitar = (clave) => setFilas((prev) => prev.filter((f) => f.clave !== clave));
  const agregar = () => setFilas((prev) => [...prev, { clave: Math.max(-1, ...prev.map((f) => f.clave)) + 1, concepto: "", cantidad: 1, valor_cliente: 0 }]);

  const subtotal = filas.reduce((s, f) => s + (Number(f.cantidad) || 0) * (Number(f.valor_cliente) || 0), 0);
  const valorDescuento = Math.round((subtotal * descuento) / 100);
  const validas = filas.length > 0 && subtotal > 0 && filas.every((f) => f.concepto.trim() && Number(f.cantidad) >= 1);

  const confirmar = async () => {
    if (!window.confirm(`Se confirmará la cotización N.° ${numeroCot(cot.numero)} por ${cop(subtotal - valorDescuento)}. Se generará su PDF y se enviará a la carpeta de Drive y a tu correo. ¿Continuar?`)) return;
    setGuardando(true);
    setError("");
    const { error: err } = await supabase.rpc("confirmar_cotizacion", {
      p_id: cot.id, p_descuento: descuento,
      p_lineas: filas.map((f) => ({
        concepto: f.concepto.trim(), cantidad: Number(f.cantidad), valor_cliente: Number(f.valor_cliente),
        ...(f.origen ? { origen: f.origen } : {}),
      })),
    });
    setGuardando(false);
    if (err) { setError(mensajeError(err)); return; }
    setEditando(false);
    onListo();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", margin: "0 0 6px" }}>
        <p style={{ fontSize: 12, fontWeight: 700, margin: 0 }}>Cotización cliente N.° {numeroCot(cot.numero)} · versión {cliente.version}</p>
        <span style={{ background: confirmada ? "#eaf3de" : "#faeeda", color: confirmada ? "#27500a" : "#633806", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
          {confirmada ? "Confirmada" : "Sin confirmar"}
        </span>
      </div>

      {!editando && (
        <>
          <TablaLineas lineas={cliente.lineas} campo="valor_cliente" total={cliente.total_cliente} etiquetaTotal="Total cliente"
            descuento={cliente.descuento_valor > 0 ? { pct: cliente.descuento_pct, valor: cliente.descuento_valor, subtotal: cliente.subtotal } : null} />
          {editable
            ? <button type="button" style={{ ...btnGhost, marginTop: 8, ...(confirmada ? null : { background: "#c8622f", color: "#fff" }) }} onClick={abrir}>{confirmada ? "Editar cotización" : "Revisar y confirmar"}</button>
            : <p style={{ ...muted, fontSize: 11, margin: "6px 0 0" }}>Para editarla, primero quita la aprobación.</p>}
        </>
      )}

      {editando && (
        <div style={{ background: "#fff", border: "1px solid #e2e5e1", borderRadius: 8, padding: 10, marginTop: 6 }}>
          {filas.map((f) => (
            <div key={f.clave} style={{ borderBottom: "1px solid #eee", padding: "8px 0" }}>
              <label style={{ ...smallLabel, display: "block" }}>Concepto{f.origen === "oficial" ? " (oficial)" : ""}
                <textarea style={{ ...input, padding: 6, marginTop: 2, minHeight: 44, fontFamily: "inherit" }} maxLength={1000} value={f.concepto}
                  onChange={(e) => cambiar(f.clave, { concepto: e.target.value })} />
              </label>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 6 }}>
                <label style={{ ...smallLabel, width: 70 }}>Cantidad
                  <input type="number" min={1} style={{ ...input, padding: 6, marginTop: 2 }} value={f.cantidad} onFocus={(e) => e.target.select()}
                    onChange={(e) => cambiar(f.clave, { cantidad: e.target.value === "" ? "" : Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
                </label>
                <label style={{ ...smallLabel, width: 120 }}>Valor unitario
                  <input type="number" min={0} style={{ ...input, padding: 6, marginTop: 2 }} value={f.valor_cliente} onFocus={(e) => e.target.select()}
                    onChange={(e) => cambiar(f.clave, { valor_cliente: e.target.value === "" ? "" : Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
                </label>
                <span style={{ fontSize: 13, fontWeight: 700, marginLeft: "auto", paddingBottom: 6 }}>{cop((Number(f.cantidad) || 0) * (Number(f.valor_cliente) || 0))}</span>
                <button type="button" aria-label="Quitar concepto" onClick={() => quitar(f.clave)}
                  style={{ background: "none", border: "none", color: "#b3261e", fontSize: 18, cursor: "pointer", paddingBottom: 4 }}>×</button>
              </div>
            </div>
          ))}
          <button type="button" style={{ ...btnGhost, marginTop: 8 }} onClick={agregar}>+ Agregar concepto</button>

          <p style={{ fontSize: 12, fontWeight: 700, margin: "12px 0 4px" }}>Descuento</p>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
            {DESCUENTOS.map((d) => (
              <label key={d} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input type="radio" name={`descuento-${cot.id}`} checked={descuento === d} onChange={() => setDescuento(d)} />
                {d === 0 ? "Sin descuento" : `${d} %`}
              </label>
            ))}
          </div>

          <div style={{ marginTop: 12, fontSize: 13, borderTop: "2px solid #1f2a24", paddingTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Subtotal</span><span>{cop(subtotal)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Descuento ({descuento} %)</span><span>{cop(-valorDescuento)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700, marginTop: 4 }}><span>Total final</span><span>{cop(subtotal - valorDescuento)}</span></div>
          </div>
          {!validas && <p style={{ fontSize: 12, color: "#a15b2b", margin: "8px 0 0" }}>Cada concepto necesita descripción y el total debe ser mayor a cero.</p>}
          <button type="button" style={{ ...btnPrimary, marginTop: 10, ...disabled(!validas || guardando) }} disabled={!validas || guardando} onClick={confirmar}>
            {guardando ? "Confirmando…" : "Confirmar y generar PDF"}
          </button>
          <button type="button" style={{ ...btnGhost, marginTop: 8, width: "100%" }} disabled={guardando} onClick={() => setEditando(false)}>Cancelar</button>
        </div>
      )}
      {error && <p style={errorText}>{error}</p>}

      {versiones.length > 1 && (
        <details style={{ marginTop: 8, fontSize: 12 }}>
          <summary style={{ cursor: "pointer", color: "#4a534d" }}>Historial de versiones ({versiones.length})</summary>
          {versiones.map((v) => (
            <details key={v.id} style={{ margin: "6px 0 0 8px" }}>
              <summary style={{ cursor: "pointer" }}>
                Versión {v.version}{v.version === 1 ? " (original)" : ""} · {fechaHoraCO(v.creado_en)} · {cop(v.total)}{v.descuento_pct ? ` · descuento ${v.descuento_pct} %` : ""}
              </summary>
              <TablaLineas lineas={v.lineas} campo="valor_cliente" total={v.total} etiquetaTotal="Total"
                descuento={v.descuento_valor > 0 ? { pct: v.descuento_pct, valor: v.descuento_valor, subtotal: v.subtotal } : null} />
            </details>
          ))}
        </details>
      )}
    </div>
  );
}
