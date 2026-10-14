import { useEffect, useState } from "react";
import { mensajeError, supabase } from "../lib/supabase.js";
import { descargarPdf } from "../lib/descargar.js";
import { PISOS, agruparPorTorre, agruparRociadores, cop, dataUrlABlob, fechaCO, numeroCot, tagPhoto } from "../lib/util.js";
import { btnGhost, btnPrimary, card, disabled, errorText, fieldLabel, input, muted } from "../styles.js";

function crearItemsIniciales(precios) {
  return Object.fromEntries(precios.map((p) =>
    p.tipo === "rociador"
      ? [p.clave, { activo: false, valor: p.valor, entradas: [] }]
      : p.tipo === "piso"
      ? [p.clave, { activo: false, valor: p.valor, pisos: [] }]
      : [p.clave, { activo: false, cantidad: 1, valor: p.valor, romper: false }]
  ));
}

const cantidadRociadores = (v) => (v.entradas || []).reduce((n, e) => n + (e.cuartoBasuras ? 1 : 0) + (e.ultimoPiso ? 1 : 0), 0);

export default function PanelTecnico({ perfil }) {
  const [copropiedades, setCopropiedades] = useState([]);
  const [precios, setPrecios] = useState([]);
  const [valorRomper, setValorRomper] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState("");

  const [copId, setCopId] = useState("");
  const [torre, setTorre] = useState(1);
  const [piso, setPiso] = useState(1);
  const [fotos, setFotos] = useState([]);
  const [items, setItems] = useState({});
  const [danoSevero, setDanoSevero] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState("");
  const [generado, setGenerado] = useState(null);

  useEffect(() => {
    (async () => {
      const [c, p, a] = await Promise.all([
        supabase.from("copropiedades").select("id, nombre, anio, administrador, direccion, tel_porteria").order("nombre"),
        supabase.from("precios").select("*").order("orden"),
        supabase.from("ajustes").select("valor_romper").eq("id", 1).single(),
      ]);
      const err = c.error || p.error || a.error;
      if (err) setErrorCarga(mensajeError(err));
      else {
        setCopropiedades(c.data);
        setPrecios(p.data);
        setValorRomper(a.data.valor_romper);
        setItems(crearItemsIniciales(p.data));
      }
      setCargando(false);
    })();
  }, []);

  const cop_ = copropiedades.find((c) => c.id === copId);
  const def = Object.fromEntries(precios.map((p) => [p.clave, p]));

  const elegirCop = (id) => {
    if (id === copId) return;
    if (fotos.length && !window.confirm("Cambiar de copropiedad borra las fotos tomadas en esta visita. ¿Continuar?")) return;
    setCopId(id);
    setFotos([]);
    setItems(crearItemsIniciales(precios));
    setDanoSevero("");
  };

  const handleFotos = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    const fecha = fechaCO(new Date());
    const nuevas = await Promise.all(files.map((f) => tagPhoto(f, { copName: cop_?.nombre || "cop", torre, piso, fecha })));
    const validas = nuevas.filter(Boolean);
    if (validas.length < nuevas.length) alert("Algunas fotos no se pudieron leer (formato no compatible con este navegador).");
    setFotos((prev) => [...prev, ...validas.map((n) => ({ ...n, enInforme: false }))]);
  };

  const toggleInforme = (i) => {
    const seleccionadas = fotos.filter((f) => f.enInforme).length;
    if (!fotos[i].enInforme && seleccionadas >= 4) {
      alert("El informe de visita lleva máximo 4 fotos. Quita una para agregar otra.");
      return;
    }
    setFotos((prev) => prev.map((f, idx) => (idx === i ? { ...f, enInforme: !f.enInforme } : f)));
  };
  const quitarFoto = (i) => setFotos((prev) => prev.filter((_, idx) => idx !== i));

  const setItem = (k, cambios) => setItems((prev) => ({ ...prev, [k]: { ...prev[k], ...cambios } }));

  const agregarPiso = (key) => setItems((prev) => ({
    ...prev, [key]: { ...prev[key], pisos: [...(prev[key].pisos || []), { torre, piso, romper: false }] },
  }));
  const quitarPiso = (key, idx) => setItems((prev) => ({
    ...prev, [key]: { ...prev[key], pisos: prev[key].pisos.filter((_, i) => i !== idx) },
  }));
  const actualizarPiso = (key, idx, campo, valor) => setItems((prev) => ({
    ...prev, [key]: { ...prev[key], pisos: prev[key].pisos.map((p, i) => (i === idx ? { ...p, [campo]: valor } : p)) },
  }));

  const agregarRociador = (key) => setItems((prev) => ({
    ...prev, [key]: { ...prev[key], entradas: [...(prev[key].entradas || []), { torre, cuartoBasuras: false, ultimoPiso: false }] },
  }));
  const quitarRociador = (key, idx) => setItems((prev) => ({
    ...prev, [key]: { ...prev[key], entradas: prev[key].entradas.filter((_, i) => i !== idx) },
  }));
  const actualizarRociador = (key, idx, campo, valor) => setItems((prev) => ({
    ...prev, [key]: { ...prev[key], entradas: prev[key].entradas.map((e, i) => (i === idx ? { ...e, [campo]: valor } : e)) },
  }));

  const subtotal = (k, v) => {
    const d = def[k];
    if (!v?.activo || !d) return 0;
    if (d.tipo === "rociador") return v.valor * cantidadRociadores(v);
    if (d.tipo === "piso") {
      const pisos = v.pisos || [];
      return v.valor * pisos.length + pisos.filter((p) => p.romper).length * valorRomper;
    }
    return v.valor * (Number(v.cantidad) || 0) + (d.permite_romper && v.romper ? valorRomper : 0);
  };

  const total = Object.entries(items).reduce((s, [k, v]) => s + subtotal(k, v), 0) + (Number(danoSevero) || 0);

  const construirLineas = () => {
    const lineas = precios.filter((d) => items[d.clave]?.activo).flatMap((d) => {
      const v = items[d.clave];
      if (d.tipo === "rociador") {
        const cantidad = cantidadRociadores(v);
        if (cantidad === 0) return [];
        return [{ concepto: `${d.etiqueta} — ${agruparRociadores(v.entradas)}`, cantidad, valor_tecnico: v.valor }];
      }
      if (d.tipo === "piso") {
        const pisos = v.pisos || [];
        if (pisos.length === 0) return [];
        const linea = { concepto: `${d.etiqueta} — ${agruparPorTorre(pisos)}`, cantidad: pisos.length, valor_tecnico: v.valor };
        const conRotura = pisos.filter((p) => p.romper);
        const extra = conRotura.length > 0
          ? [{ concepto: `Rotura — ${d.etiqueta} (${agruparPorTorre(conRotura)})`, cantidad: conRotura.length, valor_tecnico: valorRomper }]
          : [];
        return [linea, ...extra];
      }
      const linea = { concepto: d.etiqueta, cantidad: Number(v.cantidad) || 1, valor_tecnico: v.valor };
      const extra = d.permite_romper && v.romper ? [{ concepto: `Rotura — ${d.etiqueta}`, cantidad: 1, valor_tecnico: valorRomper }] : [];
      return [linea, ...extra];
    });
    if (Number(danoSevero) > 0) lineas.push({ concepto: "Daños severos (valorado en sitio)", cantidad: 1, valor_tecnico: Math.round(Number(danoSevero)) });
    return lineas;
  };

  const generar = async () => {
    if (!cop_ || guardando) return;
    setErrorGuardar("");
    setGuardando(true);
    try {
      const fotosInforme = fotos.some((f) => f.enInforme) ? fotos.filter((f) => f.enInforme).slice(0, 4) : fotos.slice(0, 4);
      const lote = crypto.randomUUID();
      const paths = [];
      for (const [i, f] of fotosInforme.entries()) {
        const path = `${cop_.id}/${lote}/${i + 1}.jpg`;
        const { error } = await supabase.storage.from("visitas").upload(path, await dataUrlABlob(f.dataUrl), { contentType: "image/jpeg" });
        if (error) throw new Error(`No se pudo subir la foto ${i + 1}: ${mensajeError(error)}`);
        paths.push(path);
      }
      const { data, error } = await supabase.rpc("crear_cotizacion", {
        p_copropiedad_id: cop_.id, p_torre: torre, p_piso: piso, p_lineas: construirLineas(), p_fotos: paths,
      });
      if (error) throw error;
      setGenerado({ cot: data, fotos: fotosInforme });
    } catch (err) {
      setErrorGuardar(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  };

  if (cargando) return <div style={card}>Cargando…</div>;
  if (errorCarga) return <div style={card}><p style={errorText}>{errorCarga}</p></div>;

  if (generado) return (
    <DocumentosGenerados registro={generado.cot} fotos={generado.fotos} onNuevo={() => {
      setGenerado(null);
      setFotos([]);
      setItems(crearItemsIniciales(precios));
      setDanoSevero("");
      setCopId("");
      setTorre(1);
      setPiso(1);
    }} />
  );

  return (
    <div>
      <div style={card}>
        <h2 style={{ marginTop: 0 }}>Panel técnico</h2>
        <p style={{ ...muted, marginTop: -8 }}>Hola, <b>{perfil.nombre}</b>. Estas son las copropiedades que tienes asignadas.</p>
        {copropiedades.length === 0 && <p style={{ fontSize: 13, color: "#a15b2b" }}>Aún no tienes copropiedades asignadas. Pide al administrador que te asigne una.</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
          {copropiedades.map((c) => (
            <button key={c.id} type="button" onClick={() => elegirCop(c.id)}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 12px", borderRadius: 8, border: copId === c.id ? "2px solid #c8622f" : "1px solid #d7dbd5",
                background: "#fff", color: "#1f2a24", cursor: "pointer", fontWeight: 600, fontSize: 14, textAlign: "left",
              }}>
              <span>{c.nombre} ({c.anio})</span>
              <span style={{ fontSize: 12, fontWeight: 400 }}>Autorizada ✓</span>
            </button>
          ))}
        </div>
      </div>

      {cop_ && (
        <>
          <div style={card}>
            <h3 style={{ marginTop: 0 }}>Información de la copropiedad</h3>
            <p><b>Administrador:</b> {cop_.administrador}</p>
            <p><b>Dirección:</b> {cop_.direccion || "—"}</p>
            {cop_.tel_porteria && <p><b>Portería:</b> <a href={`tel:${cop_.tel_porteria}`}>{cop_.tel_porteria}</a></p>}
          </div>

          <div style={card}>
            <h3 style={{ marginTop: 0 }}>Ubicación</h3>
            <p style={{ ...muted, marginTop: -6 }}>Solo para ubicar dónde se toman las fotos. Los pisos a cotizar se agregan en cada ítem de la cotización.</p>
            <div style={{ display: "flex", gap: 10 }}>
              <label style={{ ...fieldLabel, flex: 1 }}>Torre
                <select style={input} value={torre} onChange={(e) => setTorre(Number(e.target.value))}>
                  {PISOS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label style={{ ...fieldLabel, flex: 1 }}>Piso
                <select style={input} value={piso} onChange={(e) => setPiso(Number(e.target.value))}>
                  {PISOS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div style={card}>
            <h3 style={{ marginTop: 0 }}>Tomar fotos — Torre {torre}, Piso {piso}</h3>
            <p style={{ ...muted, marginTop: -6 }}>Cada foto queda marcada automáticamente con la torre, el piso y la fecha.</p>
            <label htmlFor="foto-input" style={{ ...btnPrimary, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", boxSizing: "border-box" }}>
              📷 Tomar foto (Torre {torre}, Piso {piso})
            </label>
            <input id="foto-input" type="file" accept="image/*" capture="environment" multiple onChange={handleFotos} style={{ display: "none" }} />
            {fotos.length > 0 && (
              <>
                <p style={{ fontSize: 13, fontWeight: 600, marginTop: 12, marginBottom: 2 }}>Fotos tomadas en esta visita ({fotos.length})</p>
                <p style={{ fontSize: 12, color: "#6b756f", marginTop: 0, marginBottom: 6 }}>Toca hasta 4 para incluirlas en el informe de visita. Si no eliges ninguna, se usan las primeras 4.</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {fotos.map((f, i) => (
                    <div key={i} onClick={() => toggleInforme(i)} style={{ position: "relative", cursor: "pointer" }}>
                      <img src={f.dataUrl} alt={`Foto ${i + 1}`} style={{
                        width: 72, height: 72, objectFit: "cover", borderRadius: 6, display: "block",
                        border: f.enInforme ? "3px solid #c8622f" : "3px solid transparent",
                      }} />
                      <span style={{ position: "absolute", bottom: 3, left: 3, right: 3, fontSize: 9, color: "#fff", background: "rgba(0,0,0,0.55)", borderRadius: 3, textAlign: "center" }}>T{f.torre}/P{f.piso}</span>
                      {f.enInforme && (
                        <span style={{ position: "absolute", top: -4, right: -4, background: "#c8622f", color: "#fff", borderRadius: "50%", width: 18, height: 18, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</span>
                      )}
                      <button type="button" aria-label="Quitar foto" onClick={(e) => { e.stopPropagation(); quitarFoto(i); }}
                        style={{ position: "absolute", top: -4, left: -4, background: "#b3261e", color: "#fff", border: "none", borderRadius: "50%", width: 18, height: 18, fontSize: 11, lineHeight: "18px", padding: 0, cursor: "pointer" }}>×</button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div style={card}>
            <h3 style={{ marginTop: 0 }}>Cotización</h3>
            <p style={{ ...muted, marginTop: -6 }}>Marca cada trabajo realizado y coloca cuántas unidades (pisos, tapas, reductores, etc.) reparaste.</p>
            {precios.map((d) => {
              const k = d.clave, v = items[k];
              return (
                <div key={k} style={{ padding: "10px 0", borderBottom: "1px solid #eee" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600 }}>
                    <input type="checkbox" checked={v?.activo || false} onChange={(e) => setItem(k, { activo: e.target.checked })} />
                    {d.etiqueta}
                  </label>

                  {v?.activo && d.tipo === "rociador" && (
                    <div style={{ marginTop: 8, paddingLeft: 24 }}>
                      <ValorUnitario etiqueta="Valor unitario por rociador" valor={v.valor} onChange={(n) => setItem(k, { valor: n })} />
                      {(v.entradas || []).map((en, idx) => (
                        <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, background: "#f8f9f7", padding: 8, borderRadius: 8, flexWrap: "wrap" }}>
                          <SelectTorrePiso etiqueta="Torre" valor={en.torre} onChange={(n) => actualizarRociador(k, idx, "torre", n)} />
                          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, marginTop: 12 }}>
                            <input type="checkbox" checked={en.cuartoBasuras} onChange={(e) => actualizarRociador(k, idx, "cuartoBasuras", e.target.checked)} />
                            Cuarto de basuras
                          </label>
                          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, marginTop: 12 }}>
                            <input type="checkbox" checked={en.ultimoPiso} onChange={(e) => actualizarRociador(k, idx, "ultimoPiso", e.target.checked)} />
                            Último piso
                          </label>
                          <button type="button" onClick={() => quitarRociador(k, idx)} style={quitarBtn}>×</button>
                        </div>
                      ))}
                      <button type="button" onClick={() => agregarRociador(k)} style={{ ...btnGhost, marginTop: 2 }}>+ Agregar torre</button>
                      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 8 }}>Subtotal: {cop(subtotal(k, v))}</div>
                    </div>
                  )}

                  {v?.activo && d.tipo === "piso" && (
                    <div style={{ marginTop: 8, paddingLeft: 24 }}>
                      <ValorUnitario etiqueta="Valor unitario por piso" valor={v.valor} onChange={(n) => setItem(k, { valor: n })} />
                      {(v.pisos || []).map((p, idx) => (
                        <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, background: "#f8f9f7", padding: 8, borderRadius: 8 }}>
                          <SelectTorrePiso etiqueta="Torre" valor={p.torre} onChange={(n) => actualizarPiso(k, idx, "torre", n)} />
                          <SelectTorrePiso etiqueta="Piso" valor={p.piso} onChange={(n) => actualizarPiso(k, idx, "piso", n)} />
                          {d.permite_romper && (
                            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#a15b2b", flex: 1, marginTop: 12 }}>
                              <input type="checkbox" checked={p.romper} onChange={(e) => actualizarPiso(k, idx, "romper", e.target.checked)} />
                              ¿Se debe romper?
                            </label>
                          )}
                          <button type="button" onClick={() => quitarPiso(k, idx)} style={quitarBtn}>×</button>
                        </div>
                      ))}
                      <button type="button" onClick={() => agregarPiso(k)} style={{ ...btnGhost, marginTop: 2 }}>+ Agregar piso</button>
                      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 8 }}>Subtotal: {cop(subtotal(k, v))}</div>
                    </div>
                  )}

                  {v?.activo && d.tipo === "cantidad" && (
                    <>
                      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 8, paddingLeft: 24, flexWrap: "wrap" }}>
                        <label style={{ fontSize: 11, color: "#6b756f" }}>Cantidad
                          <input type="number" min={1} value={v.cantidad} style={{ ...input, width: 70, padding: 6, marginTop: 2 }}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => setItem(k, { cantidad: e.target.value === "" ? "" : Math.max(1, Math.floor(Number(e.target.value))) })}
                            onBlur={(e) => { if (!e.target.value) setItem(k, { cantidad: 1 }); }} />
                        </label>
                        <ValorUnitario etiqueta="Valor unitario" valor={v.valor} onChange={(n) => setItem(k, { valor: n })} sinMargen />
                        <div style={{ fontSize: 13, fontWeight: 700, marginLeft: "auto" }}>{cop(subtotal(k, v))}</div>
                      </div>
                      {d.permite_romper && (
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 6, paddingLeft: 24, color: "#a15b2b" }}>
                          <input type="checkbox" checked={v.romper || false} onChange={(e) => setItem(k, { romper: e.target.checked })} />
                          ¿Se debe romper?
                        </label>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            <label style={{ ...fieldLabel, marginTop: 10 }}>Daños severos — valor a definir en sitio (opcional)
              <input type="number" min={0} style={input} value={danoSevero} onFocus={(e) => e.target.select()}
                onChange={(e) => setDanoSevero(e.target.value === "" ? "" : String(Math.max(0, Number(e.target.value))))} placeholder="$ 0" />
            </label>
            <div style={{ marginTop: 10, fontSize: 16, borderTop: "2px solid #1f2a24", paddingTop: 10, marginBottom: 10 }}>
              Total a pagar por este servicio: <b>{cop(total)}</b>
            </div>
            <button style={{ ...btnPrimary, ...disabled(total === 0 || guardando) }} type="button" onClick={generar} disabled={total === 0 || guardando}>
              {guardando ? "Guardando visita…" : "Generar informe y cotizaciones"}
            </button>
            {errorGuardar && <p style={errorText}>{errorGuardar}</p>}
          </div>
        </>
      )}
    </div>
  );
}

const quitarBtn = { background: "none", border: "none", color: "#b3261e", fontSize: 18, cursor: "pointer", marginTop: 10, marginLeft: "auto" };

function ValorUnitario({ etiqueta, valor, onChange, sinMargen }) {
  return (
    <label style={{ fontSize: 11, color: "#6b756f", display: "block", marginBottom: sinMargen ? 0 : 8 }}>{etiqueta}
      <input type="number" min={0} value={valor} style={{ ...input, width: 120, padding: 6, marginTop: 2 }}
        onFocus={(e) => e.target.select()}
        onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
    </label>
  );
}

function SelectTorrePiso({ etiqueta, valor, onChange }) {
  return (
    <label style={{ fontSize: 11, color: "#6b756f" }}>{etiqueta}
      <select style={{ ...input, width: 64, padding: 6, marginTop: 2 }} value={valor} onChange={(e) => onChange(Number(e.target.value))}>
        {PISOS.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  );
}

function DocumentosGenerados({ registro, fotos, onNuevo }) {
  const descargar = () => descargarPdf("pdfCotizacionTecnico", registro, fotos);
  return (
    <div style={card}>
      <h2 style={{ marginTop: 0 }}>Visita registrada — Cotización N.° {numeroCot(registro.numero)}</h2>
      <p>Copropiedad: <b>{registro.copropiedad_nombre}</b> · Torre {registro.torre}, Piso {registro.piso} · {fechaCO(registro.creado_en)}</p>
      <p style={muted}>El informe y la cotización para el cliente quedaron guardados en la carpeta de la copropiedad. El administrador se encarga de enviarlos.</p>

      <h3>Informe de visita ({fotos.length} fotos)</h3>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {fotos.map((f, i) => <img key={i} src={f.dataUrl} alt={`Foto ${i + 1}`} style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 6 }} />)}
      </div>

      <h3>Tu cotización (pago del servicio)</h3>
      <TablaLineas lineas={registro.lineas} campo="valor_tecnico" total={registro.total_tecnico} etiquetaTotal="Total a pagar" />

      <button style={{ ...btnPrimary, marginTop: 12 }} type="button" onClick={descargar}>Descargar mi cotización (PDF)</button>
      <button style={{ ...btnGhost, marginTop: 8, width: "100%" }} type="button" onClick={onNuevo}>Registrar otra visita</button>
    </div>
  );
}

export function TablaLineas({ lineas, campo, total, etiquetaTotal }) {
  return (
    <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
      <tbody>
        {lineas.map((l, i) => (
          <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
            <td style={{ whiteSpace: "pre-line", padding: "4px 0" }}>{l.concepto} — {l.cantidad} x {cop(l[campo])}</td>
            <td style={{ textAlign: "right", whiteSpace: "nowrap", paddingLeft: 8 }}>{cop(l[campo] * l.cantidad)}</td>
          </tr>
        ))}
        <tr style={{ fontWeight: 700, borderTop: "1px solid #ccc" }}>
          <td style={{ paddingTop: 6 }}>{etiquetaTotal}</td>
          <td style={{ textAlign: "right", paddingTop: 6 }}>{cop(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}
