import { useEffect, useState } from "react";
import { mensajeError, supabase } from "../lib/supabase.js";
import { fechaHoraCO, numeroCot } from "../lib/util.js";
import { btnGhost, btnPrimary, disabled, errorText, input, smallLabel } from "../styles.js";

// Diagnóstico del informe de visita: el administrador lo corrige y se genera una nueva versión del informe
export default function EditorDiagnostico({ cot, editable, onListo }) {
  const [editando, setEditando] = useState(false);
  const [diagnostico, setDiagnostico] = useState("");
  const [recomendacion, setRecomendacion] = useState("");
  const [versiones, setVersiones] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.from("informe_versiones").select("*").eq("cotizacion_id", cot.id).order("version").then(({ data, error: err }) => {
      if (err) setError(mensajeError(err));
      else setVersiones(data);
    });
  }, [cot.id, cot.diagnostico, cot.recomendacion]);

  const abrir = () => {
    setDiagnostico(cot.diagnostico);
    setRecomendacion(cot.recomendacion);
    setError("");
    setEditando(true);
  };

  const cambio = diagnostico.trim() !== cot.diagnostico || recomendacion.trim() !== cot.recomendacion;
  const listo = Boolean(diagnostico.trim()) && cambio && !guardando;

  const guardar = async () => {
    if (!window.confirm(`Se generará una nueva versión del informe de visita N.° ${numeroCot(cot.numero)} y se enviará a la carpeta de Drive y a tu correo. ¿Continuar?`)) return;
    setGuardando(true);
    setError("");
    const { error: err } = await supabase.rpc("editar_diagnostico", { p_id: cot.id, p_diagnostico: diagnostico, p_recomendacion: recomendacion });
    setGuardando(false);
    if (err) { setError(mensajeError(err)); return; }
    setEditando(false);
    onListo();
  };

  return (
    <div style={{ marginBottom: 10 }}>
      {!editando && (
        <>
          {cot.diagnostico && <p style={{ fontSize: 13, margin: "0 0 6px", whiteSpace: "pre-line" }}><b>Diagnóstico:</b> {cot.diagnostico}</p>}
          {cot.recomendacion && <p style={{ fontSize: 13, margin: "0 0 8px", whiteSpace: "pre-line" }}><b>Recomendación:</b> {cot.recomendacion}</p>}
          {editable && <button type="button" style={btnGhost} onClick={abrir}>{cot.diagnostico ? "Corregir diagnóstico" : "Escribir diagnóstico"}</button>}
        </>
      )}
      {editando && (
        <div style={{ background: "#fff", border: "1px solid #e2e5e1", borderRadius: 8, padding: 10 }}>
          <label style={{ ...smallLabel, display: "block" }}>Diagnóstico
            <textarea style={{ ...input, padding: 6, marginTop: 2, minHeight: 80, fontFamily: "inherit" }} maxLength={2000} value={diagnostico} onChange={(e) => setDiagnostico(e.target.value)} />
          </label>
          <label style={{ ...smallLabel, display: "block", marginTop: 8 }}>Recomendación (opcional). En el informe va después de "Recomendamos:"
            <textarea style={{ ...input, padding: 6, marginTop: 2, minHeight: 50, fontFamily: "inherit" }} maxLength={1000} value={recomendacion} onChange={(e) => setRecomendacion(e.target.value)} />
          </label>
          <button type="button" style={{ ...btnPrimary, marginTop: 10, ...disabled(!listo) }} disabled={!listo} onClick={guardar}>
            {guardando ? "Guardando…" : "Guardar y generar informe"}
          </button>
          <button type="button" style={{ ...btnGhost, marginTop: 8, width: "100%" }} disabled={guardando} onClick={() => setEditando(false)}>Cancelar</button>
        </div>
      )}
      {error && <p style={errorText}>{error}</p>}
      {versiones.length > 1 && (
        <details style={{ marginTop: 8, fontSize: 12 }}>
          <summary style={{ cursor: "pointer", color: "#4a534d" }}>Versiones del informe ({versiones.length})</summary>
          {versiones.map((v) => (
            <p key={v.id} style={{ margin: "6px 0 0 8px", whiteSpace: "pre-line" }}>
              <b>Versión {v.version}{v.version === 1 ? " (original)" : ""} · {fechaHoraCO(v.creado_en)}</b><br />
              {v.diagnostico || "(sin diagnóstico)"}{v.recomendacion ? `\nRecomendación: ${v.recomendacion}` : ""}
            </p>
          ))}
        </details>
      )}
    </div>
  );
}
