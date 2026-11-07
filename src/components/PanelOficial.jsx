import { useEffect, useState } from "react";
import { imagenComoDataUrl, mensajeError, supabase } from "../lib/supabase.js";
import { descargarPdf } from "../lib/descargar.js";
import { fechaCO, numeroCot, recorteCircular } from "../lib/util.js";
import { btnPrimary, card, disabled, errorText, muted } from "../styles.js";

// El oficial ve sus trabajos y su carnet. La función del servidor no devuelve ningún valor.
export default function PanelOficial({ perfil }) {
  const [trabajos, setTrabajos] = useState(null);
  const [error, setError] = useState("");
  const [generando, setGenerando] = useState(false);

  useEffect(() => {
    supabase.rpc("mis_trabajos_oficial").then(({ data, error: err }) => {
      if (err) setError(mensajeError(err));
      else setTrabajos(data);
    });
  }, []);

  const descargarCarnet = async () => {
    setGenerando(true);
    setError("");
    try {
      const foto = perfil.foto_path ? await recorteCircular(await imagenComoDataUrl("tecnicos", perfil.foto_path)) : null;
      await descargarPdf("pdfIdentificacion", perfil, foto, "", "OFICIAL AUTORIZADO");
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setGenerando(false);
    }
  };

  return (
    <>
      <div style={card}>
        <h2 style={{ marginTop: 0 }}>Mi carnet</h2>
        <p style={{ ...muted, marginTop: -6 }}>Descárgalo para imprimirlo o mostrarlo al ingresar a una copropiedad.</p>
        <button type="button" style={{ ...btnPrimary, ...disabled(generando) }} disabled={generando} onClick={descargarCarnet}>
          {generando ? "Generando…" : "📇 Descargar mi carnet (PDF)"}
        </button>
        {error && <p style={errorText}>{error}</p>}
      </div>

      <div style={card}>
        <h2 style={{ marginTop: 0 }}>Mis trabajos</h2>
        {!trabajos && !error && <p>Cargando…</p>}
        {trabajos?.length === 0 && <p style={muted}>Todavía no tienes trabajos asignados.</p>}
        {trabajos?.map((t) => (
          <div key={t.id} style={{ padding: "10px 0", borderBottom: "1px solid #eee", fontSize: 13 }}>
            <b>{t.copropiedad}</b> · N.° {numeroCot(t.numero)} · {fechaCO(t.creado_en)}<br />
            <span style={muted}>{t.entregada_en ? `Entregado el ${fechaCO(t.entregada_en)}` : t.aprobada_en ? "Aprobado" : "Pendiente de aprobación"}</span>
            <p style={{ margin: "6px 0" }}>
              {t.direccion || "Sin dirección"} · Torre {t.torre}, piso {t.piso}<br />
              Administrador: {t.administrador} · Técnico: {t.tecnico}
              {t.tel_porteria && <><br />Portería: <a href={`tel:${t.tel_porteria}`}>{t.tel_porteria}</a></>}
            </p>
            <b>Actividades:</b>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {t.actividades.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
