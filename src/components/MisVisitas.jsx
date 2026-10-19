import { useCallback, useEffect, useState } from "react";
import { mensajeError, supabase } from "../lib/supabase.js";
import { descargarPdf } from "../lib/descargar.js";
import { cop, estadoCotizacion, fechaCO, numeroCot } from "../lib/util.js";
import { btnGhost, card, disabled, errorText, fila, muted } from "../styles.js";
import { EstadoBadge, RegistrarEntrega, descargarEntrega, fotosDe } from "./Entrega.jsx";

export default function MisVisitas() {
  const [visitas, setVisitas] = useState(null);
  const [entregas, setEntregas] = useState({});
  const [copropiedades, setCopropiedades] = useState({});
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(null);
  const [entregandoId, setEntregandoId] = useState(null);

  const cargar = useCallback(async () => {
    const [v, e, c] = await Promise.all([
      supabase.from("cotizaciones").select("*").order("creado_en", { ascending: false }).limit(200),
      supabase.from("entregas").select("*"),
      supabase.from("copropiedades").select("id, nombre, administrador, direccion"),
    ]);
    const err = v.error || e.error || c.error;
    if (err) { setError(mensajeError(err)); return; }
    setVisitas(v.data);
    setEntregas(Object.fromEntries(e.data.map((x) => [x.cotizacion_id, x])));
    setCopropiedades(Object.fromEntries(c.data.map((x) => [x.id, x])));
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const accion = async (id, fn) => {
    setOcupado(id);
    setError("");
    try { await fn(); } catch (err) { setError(mensajeError(err)); } finally { setOcupado(null); }
  };

  const descargarCotizacion = (cot) => accion(cot.id, async () => {
    await descargarPdf("pdfCotizacionTecnico", cot, await fotosDe(cot.fotos));
  });

  if (error && !visitas) return <div style={card}><p style={errorText}>{error}</p></div>;
  if (!visitas) return <div style={card}>Cargando…</div>;

  return (
    <div style={card}>
      <h2 style={{ marginTop: 0 }}>Mis visitas</h2>
      {visitas.length === 0 && <p style={muted}>Todavía no has registrado visitas.</p>}
      {visitas.map((v) => {
        const entrega = entregas[v.id];
        // El técnico no ve si la cuenta de cobro está pagada: para él, cobrada o pagada sigue siendo "entregada"
        const estado = estadoCotizacion({ ...v, cuenta_cobro_id: null }, entrega);
        const generando = ocupado === v.id;
        return (
          <div key={v.id} style={{ padding: "10px 0", borderBottom: "1px solid #eee" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div style={{ fontSize: 13 }}>
                <b>N.° {numeroCot(v.numero)}</b> · {fechaCO(v.creado_en)}<br />
                {v.copropiedad_nombre} · Torre {v.torre}/Piso {v.piso}<br />
                <span style={{ fontWeight: 700 }}>{cop(v.total_tecnico)}</span>
              </div>
              <EstadoBadge estado={estado} />
            </div>
            <div style={{ ...fila, marginTop: 6 }}>
              <button type="button" style={{ ...btnGhost, ...disabled(generando) }} disabled={generando} onClick={() => descargarCotizacion(v)}>
                {generando ? "Generando…" : "Cotización (PDF)"}
              </button>
              {entrega && (
                <button type="button" style={{ ...btnGhost, ...disabled(generando) }} disabled={generando}
                  onClick={() => accion(v.id, () => descargarEntrega(v, entrega, copropiedades[v.copropiedad_id]))}>
                  Informe de entrega N.° {numeroCot(entrega.numero)} (PDF)
                </button>
              )}
              {estado === "aprobada" && entregandoId !== v.id && (
                <button type="button" style={{ ...btnGhost, background: "#c8622f", color: "#fff" }} onClick={() => setEntregandoId(v.id)}>
                  Registrar entrega
                </button>
              )}
            </div>
            {estado === "cotizada" && <p style={{ ...muted, fontSize: 12, margin: "6px 0 0" }}>Cuando el administrador apruebe la cotización podrás registrar la entrega.</p>}
            {entregandoId === v.id && (
              <RegistrarEntrega cot={v} onCancelar={() => setEntregandoId(null)}
                onListo={(ent) => { setEntregas((prev) => ({ ...prev, [v.id]: ent })); setEntregandoId(null); }} />
            )}
          </div>
        );
      })}
      {error && <p style={errorText}>{error}</p>}
    </div>
  );
}
