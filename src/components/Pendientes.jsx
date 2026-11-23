import { useEffect, useState } from "react";
import { mensajeError, supabase } from "../lib/supabase.js";
import { cop, fechaCO, numeroCot } from "../lib/util.js";
import { btnGhost, card, errorText, muted } from "../styles.js";

// Cotizaciones que esperan al administrador: sin confirmar o sin el oficial que requieren
export default function Pendientes({ revision, hayOficiales, onRevisar }) {
  const [filas, setFilas] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let vigente = true;
    (async () => {
      const { data: cots, error: e1 } = await supabase.from("cotizaciones")
        .select("id, numero, copropiedad_id, copropiedad_nombre, creado_en, requiere_oficial, oficial_id").is("aprobada_en", null).order("numero");
      if (e1) { if (vigente) setError(mensajeError(e1)); return; }
      const ids = cots.map((q) => q.id);
      const { data: clis, error: e2 } = ids.length
        ? await supabase.from("cotizaciones_cliente").select("cotizacion_id, total_cliente, confirmada_en").in("cotizacion_id", ids)
        : { data: [] };
      if (!vigente) return;
      if (e2) { setError(mensajeError(e2)); return; }
      const cliDe = Object.fromEntries(clis.map((c) => [c.cotizacion_id, c]));
      setError("");
      setFilas(cots.map((q) => ({ ...q, total: cliDe[q.id]?.total_cliente || 0, sinConfirmar: cliDe[q.id] && !cliDe[q.id].confirmada_en, sinOficial: q.requiere_oficial === true && !q.oficial_id }))
        .filter((q) => q.sinConfirmar || q.sinOficial));
    })();
    return () => { vigente = false; };
  }, [revision]);

  if (error) return <div style={card}><p style={errorText}>{error}</p></div>;
  if (!filas.length) return null;

  return (
    <div style={{ ...card, border: "2px solid #c8622f" }}>
      <h2 style={{ marginTop: 0 }}>Pendientes por revisar ({filas.length})</h2>
      <p style={{ ...muted, marginTop: -6 }}>La cotización del cliente llega a Drive y a tu correo cuando la confirmas.</p>
      {filas.some((q) => q.sinOficial) && !hayOficiales && (
        <p style={{ fontSize: 13, color: "#a15b2b", margin: "0 0 8px" }}>Aún no has creado oficiales. Agrégalos abajo, en Directorio de oficiales.</p>
      )}
      {filas.map((q) => (
        <div key={q.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", padding: "8px 0", borderTop: "1px solid #eee" }}>
          <div style={{ fontSize: 13 }}>
            <b>N.° {numeroCot(q.numero)}</b> · {q.copropiedad_nombre}<br />
            <span style={muted}>{fechaCO(q.creado_en)} · {cop(q.total)}</span><br />
            <span style={{ fontSize: 12, color: "#a15b2b" }}>{[q.sinConfirmar && "Falta confirmar", q.sinOficial && "Falta asignar oficial"].filter(Boolean).join(" · ")}</span>
          </div>
          <button type="button" style={btnGhost} onClick={() => onRevisar(q.copropiedad_id, q.id)}>Revisar</button>
        </div>
      ))}
    </div>
  );
}
