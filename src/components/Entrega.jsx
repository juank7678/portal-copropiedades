import { useEffect, useState } from "react";
import { imagenComoDataUrl, mensajeError, supabase } from "../lib/supabase.js";
import { descargarPdf } from "../lib/descargar.js";
import { borrarBorrador, guardarBorrador, leerBorrador } from "../lib/borrador.js";
import { MAX_FOTOS, MAX_FOTOS_INFORME, conReintentos, separarFotos, siguienteId, subirFotos } from "../lib/subidas.js";
import { ESTADOS, PISOS, TORRES, fechaCO, fechaISO, numeroCot, tagPhoto } from "../lib/util.js";
import { btnGhost, btnPrimary, disabled, errorText, input, muted, smallLabel } from "../styles.js";

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
  const [lote, setLote] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [progreso, setProgreso] = useState("");
  const [error, setError] = useState("");
  const [cargado, setCargado] = useState(false);
  const [recuperado, setRecuperado] = useState(false);
  const claveBorrador = `entrega:${cot.id}`;

  useEffect(() => {
    leerBorrador(claveBorrador).then((b) => {
      if (b) {
        setFechaInicio(b.fechaInicio);
        setObservaciones(b.observaciones);
        setRecibido(b.recibido);
        setTorre(b.torre);
        setPiso(b.piso);
        setFotos(b.fotos);
        setLote(b.lote);
        setRecuperado(true);
      }
      setCargado(true);
    });
  }, [claveBorrador]);

  useEffect(() => {
    if (!cargado) return undefined;
    const t = setTimeout(() => {
      if (fotos.length || observaciones || recibido) guardarBorrador(claveBorrador, { fechaInicio, observaciones, recibido, torre, piso, fotos, lote });
    }, 500);
    return () => clearTimeout(t);
  }, [cargado, claveBorrador, fechaInicio, observaciones, recibido, torre, piso, fotos, lote]);

  const handleFotos = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    const fecha = fechaCO(new Date());
    const nuevas = (await Promise.all(files.map((f) => tagPhoto(f, { copName: cot.copropiedad_nombre, torre, piso, fecha })))).filter(Boolean);
    if (nuevas.length < files.length) alert("Algunas fotos no se pudieron leer (formato no compatible con este navegador).");
    setFotos((prev) => {
      const espacio = MAX_FOTOS - prev.length;
      if (nuevas.length > espacio) alert(`Una entrega lleva máximo ${MAX_FOTOS} fotos.`);
      const base = siguienteId(prev);
      return [...prev, ...nuevas.slice(0, espacio).map((n, i) => ({ ...n, id: base + i, enInforme: false, subida: false }))];
    });
  };

  const toggleInforme = (i) => {
    if (!fotos[i].enInforme && fotos.filter((f) => f.enInforme).length >= MAX_FOTOS_INFORME) {
      alert(`El informe de entrega lleva máximo ${MAX_FOTOS_INFORME} fotos. Quita una para agregar otra.`);
      return;
    }
    setFotos((prev) => prev.map((f, idx) => (idx === i ? { ...f, enInforme: !f.enInforme } : f)));
  };

  const guardar = async () => {
    if (guardando) return;
    setError("");
    if (fotos.length === 0) { setError("Agrega al menos una foto del trabajo terminado."); return; }
    setGuardando(true);
    try {
      const loteEntrega = lote || crypto.randomUUID();
      setLote(loteEntrega);
      const ruta = (f) => `${cot.copropiedad_id}/${loteEntrega}/${f.id}.jpg`;
      await subirFotos(fotos.map((f) => ({ ...f, path: ruta(f) })),
        (id) => setFotos((prev) => prev.map((f) => (f.id === id ? { ...f, subida: true } : f))),
        (n, de) => setProgreso(`Subiendo foto ${n} de ${de}…`));
      setProgreso("Guardando entrega…");
      const { informe, resto } = separarFotos(fotos);
      const { data, error: err } = await conReintentos(() => supabase.rpc("crear_entrega", {
        p_cotizacion_id: cot.id, p_fecha_inicio: fechaInicio || null, p_observaciones: observaciones,
        p_recibido_por: recibido, p_fotos: informe.map(ruta), p_fotos_extra: resto.map(ruta),
      }));
      if (err) throw err;
      await borrarBorrador(claveBorrador);
      onListo(data);
    } catch (e) {
      setError(`${mensajeError(e)} Tus fotos y datos siguen guardados en este celular: cuando tengas señal, pulsa de nuevo el botón.`);
    } finally {
      setGuardando(false);
      setProgreso("");
    }
  };

  const cancelar = () => {
    if ((fotos.length || observaciones || recibido) && !window.confirm("Se borrarán las fotos y los datos de esta entrega sin registrar. ¿Continuar?")) return;
    borrarBorrador(claveBorrador);
    onCancelar();
  };

  return (
    <div style={{ background: "#f8f9f7", borderRadius: 8, padding: 12, marginTop: 8 }}>
      <p style={{ fontSize: 13, fontWeight: 700, margin: "0 0 4px" }}>Entrega de la cotización N.° {numeroCot(cot.numero)}</p>
      <p style={{ ...muted, fontSize: 12, marginTop: 0 }}>Toma fotos del trabajo terminado. Las fotos de la visita se usan como "antes" en el informe.</p>
      {recuperado && <p style={{ fontSize: 12, color: "#a15b2b", marginTop: 0 }}>Recuperamos esta entrega, que no alcanzó a registrarse. Revísala y pulsa Registrar entrega.</p>}

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={smallLabel}>Torre
          <select style={{ ...input, width: 64, padding: 6, marginTop: 2 }} value={torre} onChange={(e) => setTorre(Number(e.target.value))}>
            {TORRES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label style={smallLabel}>Piso
          <select style={{ ...input, width: 64, padding: 6, marginTop: 2 }} value={piso} onChange={(e) => setPiso(Number(e.target.value))}>
            {PISOS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label htmlFor={`foto-entrega-${cot.id}`} style={{ ...btnGhost, background: "#c8622f", color: "#fff", ...disabled(fotos.length >= MAX_FOTOS) }}>
          📷 Tomar foto (Torre {torre}, Piso {piso})
        </label>
        <input id={`foto-entrega-${cot.id}`} type="file" accept="image/*" capture="environment" multiple onChange={handleFotos}
          disabled={fotos.length >= MAX_FOTOS} style={{ display: "none" }} />
      </div>
      {fotos.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {fotos.map((f, i) => (
            <div key={f.id} onClick={() => toggleInforme(i)} style={{ position: "relative", cursor: "pointer" }}>
              <img src={f.dataUrl} alt={`Después ${i + 1}`} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, display: "block", border: f.enInforme ? "3px solid #c8622f" : "3px solid transparent" }} />
              {f.enInforme && (
                <span style={{ position: "absolute", top: -4, right: -4, background: "#c8622f", color: "#fff", borderRadius: "50%", width: 18, height: 18, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</span>
              )}
              <button type="button" aria-label="Quitar foto" onClick={(e) => { e.stopPropagation(); setFotos((prev) => prev.filter((_, idx) => idx !== i)); }}
                style={{ position: "absolute", top: -4, left: -4, background: "#b3261e", color: "#fff", border: "none", borderRadius: "50%", width: 18, height: 18, fontSize: 11, lineHeight: "18px", padding: 0, cursor: "pointer" }}>×</button>
            </div>
          ))}
        </div>
      )}
      <p style={{ ...muted, fontSize: 11, margin: "4px 0 10px" }}>
        {fotos.length} {fotos.length === 1 ? "foto" : "fotos"}. Toca hasta {MAX_FOTOS_INFORME} para el informe de entrega; si no eliges ninguna, se usan las primeras {MAX_FOTOS_INFORME}. Todas quedan guardadas en la carpeta de Drive.
      </p>

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
        {guardando ? (progreso || "Guardando entrega…") : "Registrar entrega"}
      </button>
      <button type="button" style={{ ...btnGhost, marginTop: 8, width: "100%" }} disabled={guardando} onClick={cancelar}>Cancelar</button>
      {error && <p style={errorText}>{error}</p>}
    </div>
  );
}
