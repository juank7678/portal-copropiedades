import { useState } from "react";
import { imagenComoDataUrl, mensajeError, supabase } from "../lib/supabase.js";
import { descargarPdf } from "../lib/descargar.js";
import { ESTADOS, PISOS, dataUrlABlob, fechaCO, fechaISO, numeroCot, tagPhoto } from "../lib/util.js";
import { btnGhost, btnPrimary, disabled, errorText, input, muted, smallLabel } from "../styles.js";

export const MAX_FOTOS_ENTREGA = 4;

export function EstadoBadge({ estado }) {
  const e = ESTADOS[estado];
  return (
    <span style={{ background: e.fondo, color: e.color, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
      {e.etiqueta}
    </span>
  );
}

export const fotosDe = (paths) => Promise.all(paths.map(async (p) => ({ dataUrl: await imagenComoDataUrl("visitas", p) })));

// Las fotos de la visita son el "antes"; las de la entrega, el "después"
export async function descargarEntrega(cot, entrega, copropiedad) {
  const [antes, despues] = await Promise.all([fotosDe(cot.fotos), fotosDe(entrega.fotos)]);
  await descargarPdf("pdfInformeEntrega", cot, entrega, copropiedad, antes, despues);
}

export function RegistrarEntrega({ cot, onListo, onCancelar }) {
  const [fechaInicio, setFechaInicio] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [recibido, setRecibido] = useState("");
  const [torre, setTorre] = useState(cot.torre);
  const [piso, setPiso] = useState(cot.piso);
  const [fotos, setFotos] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const handleFotos = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    const fecha = fechaCO(new Date());
    const nuevas = (await Promise.all(files.map((f) => tagPhoto(f, { copName: cot.copropiedad_nombre, torre, piso, fecha })))).filter(Boolean);
    if (nuevas.length < files.length) alert("Algunas fotos no se pudieron leer (formato no compatible con este navegador).");
    const todas = [...fotos, ...nuevas];
    if (todas.length > MAX_FOTOS_ENTREGA) alert(`La entrega lleva máximo ${MAX_FOTOS_ENTREGA} fotos. Se conservaron las primeras ${MAX_FOTOS_ENTREGA}.`);
    setFotos(todas.slice(0, MAX_FOTOS_ENTREGA));
  };

  const guardar = async () => {
    if (guardando) return;
    setError("");
    if (fotos.length === 0) { setError("Agrega al menos una foto del trabajo terminado."); return; }
    setGuardando(true);
    try {
      const lote = crypto.randomUUID();
      const paths = [];
      for (const [i, f] of fotos.entries()) {
        const path = `${cot.copropiedad_id}/${lote}/${i + 1}.jpg`;
        const { error: err } = await supabase.storage.from("visitas").upload(path, await dataUrlABlob(f.dataUrl), { contentType: "image/jpeg" });
        if (err) throw new Error(`No se pudo subir la foto ${i + 1}: ${mensajeError(err)}`);
        paths.push(path);
      }
      const { data, error: err } = await supabase.rpc("crear_entrega", {
        p_cotizacion_id: cot.id, p_fecha_inicio: fechaInicio || null, p_observaciones: observaciones,
        p_recibido_por: recibido, p_fotos: paths,
      });
      if (err) throw err;
      onListo(data);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div style={{ background: "#f8f9f7", borderRadius: 8, padding: 12, marginTop: 8 }}>
      <p style={{ fontSize: 13, fontWeight: 700, margin: "0 0 4px" }}>Entrega de la cotización N.° {numeroCot(cot.numero)}</p>
      <p style={{ ...muted, fontSize: 12, marginTop: 0 }}>Toma fotos del trabajo terminado. Las fotos de la visita se usan como "antes" en el informe.</p>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={smallLabel}>Torre
          <select style={{ ...input, width: 64, padding: 6, marginTop: 2 }} value={torre} onChange={(e) => setTorre(Number(e.target.value))}>
            {PISOS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label style={smallLabel}>Piso
          <select style={{ ...input, width: 64, padding: 6, marginTop: 2 }} value={piso} onChange={(e) => setPiso(Number(e.target.value))}>
            {PISOS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label htmlFor={`foto-entrega-${cot.id}`} style={{ ...btnGhost, background: "#c8622f", color: "#fff", ...disabled(fotos.length >= MAX_FOTOS_ENTREGA) }}>
          📷 Tomar foto (Torre {torre}, Piso {piso})
        </label>
        <input id={`foto-entrega-${cot.id}`} type="file" accept="image/*" capture="environment" multiple onChange={handleFotos}
          disabled={fotos.length >= MAX_FOTOS_ENTREGA} style={{ display: "none" }} />
      </div>
      {fotos.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {fotos.map((f, i) => (
            <div key={i} style={{ position: "relative" }}>
              <img src={f.dataUrl} alt={`Después ${i + 1}`} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, display: "block" }} />
              <button type="button" aria-label="Quitar foto" onClick={() => setFotos((prev) => prev.filter((_, idx) => idx !== i))}
                style={{ position: "absolute", top: -4, left: -4, background: "#b3261e", color: "#fff", border: "none", borderRadius: "50%", width: 18, height: 18, fontSize: 11, lineHeight: "18px", padding: 0, cursor: "pointer" }}>×</button>
            </div>
          ))}
        </div>
      )}
      <p style={{ ...muted, fontSize: 11, margin: "4px 0 10px" }}>{fotos.length} de {MAX_FOTOS_ENTREGA} fotos</p>

      <label style={{ ...smallLabel, display: "block", marginBottom: 8 }}>Fecha de inicio de los trabajos (opcional)
        <input type="date" style={{ ...input, padding: 6, marginTop: 2, maxWidth: 180 }} value={fechaInicio}
          min={fechaISO(cot.creado_en)} max={fechaISO()} onChange={(e) => setFechaInicio(e.target.value)} />
      </label>
      <label style={{ ...smallLabel, display: "block", marginBottom: 8 }}>Observaciones y recomendaciones (opcional)
        <textarea style={{ ...input, padding: 6, marginTop: 2, minHeight: 70, fontFamily: "inherit" }} maxLength={2000} value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)} placeholder="Pruebas realizadas, recomendaciones de uso y mantenimiento…" />
      </label>
      <label style={{ ...smallLabel, display: "block", marginBottom: 10 }}>Quién recibe en la copropiedad (opcional)
        <input style={{ ...input, padding: 6, marginTop: 2, textTransform: "uppercase" }} maxLength={150} value={recibido}
          onChange={(e) => setRecibido(e.target.value.toUpperCase())} placeholder="Nombre de quien recibe" />
      </label>

      <button type="button" style={{ ...btnPrimary, ...disabled(guardando) }} disabled={guardando} onClick={guardar}>
        {guardando ? "Guardando entrega…" : "Registrar entrega"}
      </button>
      <button type="button" style={{ ...btnGhost, marginTop: 8, width: "100%" }} onClick={onCancelar}>Cancelar</button>
      {error && <p style={errorText}>{error}</p>}
    </div>
  );
}
