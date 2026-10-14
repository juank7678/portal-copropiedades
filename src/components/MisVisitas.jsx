import { useEffect, useState } from "react";
import { imagenComoDataUrl, mensajeError, supabase } from "../lib/supabase.js";
import { descargarPdf } from "../lib/descargar.js";
import { cop, fechaCO, numeroCot } from "../lib/util.js";
import { btnGhost, card, disabled, errorText, muted } from "../styles.js";

export default function MisVisitas() {
  const [visitas, setVisitas] = useState(null);
  const [error, setError] = useState("");
  const [descargando, setDescargando] = useState(null);

  useEffect(() => {
    supabase.from("cotizaciones").select("*").order("creado_en", { ascending: false }).limit(200)
      .then(({ data, error: err }) => (err ? setError(mensajeError(err)) : setVisitas(data)));
  }, []);

  const descargar = async (cot) => {
    setDescargando(cot.id);
    setError("");
    try {
      const fotos = await Promise.all(cot.fotos.map(async (p) => ({ dataUrl: await imagenComoDataUrl("visitas", p) })));
      await descargarPdf("pdfCotizacionTecnico", cot, fotos);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setDescargando(null);
    }
  };

  if (error && !visitas) return <div style={card}><p style={errorText}>{error}</p></div>;
  if (!visitas) return <div style={card}>Cargando…</div>;

  return (
    <div style={card}>
      <h2 style={{ marginTop: 0 }}>Mis visitas</h2>
      {visitas.length === 0 && <p style={muted}>Todavía no has registrado visitas.</p>}
      {visitas.map((v) => (
        <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "10px 0", borderBottom: "1px solid #eee", flexWrap: "wrap" }}>
          <div style={{ fontSize: 13 }}>
            <b>N.° {numeroCot(v.numero)}</b> · {fechaCO(v.creado_en)}<br />
            {v.copropiedad_nombre} · Torre {v.torre}/Piso {v.piso}<br />
            <span style={{ fontWeight: 700 }}>{cop(v.total_tecnico)}</span>
          </div>
          <button type="button" style={{ ...btnGhost, ...disabled(descargando === v.id) }} disabled={descargando === v.id} onClick={() => descargar(v)}>
            {descargando === v.id ? "Generando…" : "Descargar PDF"}
          </button>
        </div>
      ))}
      {error && <p style={errorText}>{error}</p>}
    </div>
  );
}
