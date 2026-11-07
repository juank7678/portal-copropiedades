import { useEffect, useState } from "react";
import { mensajeError, supabase } from "../lib/supabase.js";
import { descargarPdf } from "../lib/descargar.js";
import { PISOS, TORRES, agruparPorTorre, agruparRociadores, cop, fechaCO, numeroCot, tagPhoto } from "../lib/util.js";
import { borrarBorrador, guardarBorrador, leerBorrador } from "../lib/borrador.js";
import { MAX_FOTOS, MAX_FOTOS_INFORME, conReintentos, separarFotos, siguienteId, subirFotos } from "../lib/subidas.js";
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

const ACTIVIDADES_VACIAS = [{ concepto: "", valor: "" }, { concepto: "", valor: "" }, { concepto: "", valor: "" }];
const EJEMPLOS_ACTIVIDAD = ["Ej.: Romper muro", "Ej.: Registro 70 x 50", "Actividad adicional"];

const cantidadRociadores = (v) => (v.entradas || []).reduce((n, e) => n + (e.cuartoBasuras ? 1 : 0) + (e.ultimoPiso ? 1 : 0), 0);

export default function PanelTecnico({ perfil }) {
  const [copropiedades, setCopropiedades] = useState([]);
  const [precios, setPrecios] = useState([]);
  const [valorRomper, setValorRomper] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState("");

  const [copId, setCopId] = useState("");
  const [torre, setTorre] = useState(1);
  const [piso, setPiso] = useState(PISOS[0]);
  const [fotos, setFotos] = useState([]);
  const [items, setItems] = useState({});
  const [danoSevero, setDanoSevero] = useState("");
  const [diagnostico, setDiagnostico] = useState("");
  const [recomendacion, setRecomendacion] = useState("");
  const [requiereOficial, setRequiereOficial] = useState(null);
  const [actividades, setActividades] = useState(ACTIVIDADES_VACIAS);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState("");
  const [generado, setGenerado] = useState(null);
  const [lote, setLote] = useState(null);
  const [progreso, setProgreso] = useState("");
  const [recuperado, setRecuperado] = useState(false);
  const claveBorrador = `visita:${perfil.id}`;

  useEffect(() => {
    (async () => {
      const [c, p, a, b] = await Promise.all([
        supabase.from("copropiedades").select("id, nombre, anio, administrador, direccion, tel_porteria").order("nombre"),
        supabase.from("precios").select("*").order("orden"),
        supabase.from("ajustes").select("valor_romper").eq("id", 1).single(),
        leerBorrador(claveBorrador),
      ]);
      const err = c.error || p.error || a.error;
      if (err) setErrorCarga(mensajeError(err));
      else {
        setCopropiedades(c.data);
        setPrecios(p.data);
        setValorRomper(a.data.valor_romper);
        if (b && c.data.some((x) => x.id === b.copId)) {
          setCopId(b.copId);
          setTorre(b.torre);
          setPiso(b.piso);
          setFotos(b.fotos);
          setItems({ ...crearItemsIniciales(p.data), ...b.items });
          setDanoSevero(b.danoSevero);
          setDiagnostico(b.diagnostico);
          setRecomendacion(b.recomendacion);
          setRequiereOficial(b.requiereOficial ?? null);
          setActividades(b.actividades || ACTIVIDADES_VACIAS);
          setLote(b.lote);
          setRecuperado(b.fotos.length > 0 || Boolean(b.diagnostico));
        } else {
          setItems(crearItemsIniciales(p.data));
        }
      }
      setCargando(false);
    })();
  }, [claveBorrador]);

  // Guarda el borrador en el celular mientras se llena la visita
  useEffect(() => {
    if (cargando || generado || !copId) return undefined;
    const t = setTimeout(() => {
      guardarBorrador(claveBorrador, { copId, torre, piso, fotos, items, danoSevero, diagnostico, recomendacion, requiereOficial, actividades, lote });
    }, 500);
    return () => clearTimeout(t);
  }, [cargando, generado, claveBorrador, copId, torre, piso, fotos, items, danoSevero, diagnostico, recomendacion, requiereOficial, actividades, lote]);

  const cop_ = copropiedades.find((c) => c.id === copId);
  const def = Object.fromEntries(precios.map((p) => [p.clave, p]));

  const elegirCop = (id) => {
    if (id === copId) return;
    if (fotos.length && !window.confirm("Cambiar de copropiedad borra las fotos tomadas en esta visita. ¿Continuar?")) return;
    setCopId(id);
    setFotos([]);
    setItems(crearItemsIniciales(precios));
    setDanoSevero("");
    setDiagnostico("");
    setRecomendacion("");
    setRequiereOficial(null);
    setActividades(ACTIVIDADES_VACIAS);
    setLote(null);
    setRecuperado(false);
  };

  const descartarBorrador = () => {
    if (!window.confirm("Se borrarán las fotos y los datos de esta visita sin registrar. ¿Continuar?")) return;
    borrarBorrador(claveBorrador);
    setCopId("");
    setFotos([]);
    setItems(crearItemsIniciales(precios));
    setDanoSevero("");
    setDiagnostico("");
    setRecomendacion("");
    setRequiereOficial(null);
    setActividades(ACTIVIDADES_VACIAS);
    setLote(null);
    setRecuperado(false);
    setErrorGuardar("");
  };

  const handleFotos = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    const fecha = fechaCO(new Date());
    const nuevas = await Promise.all(files.map((f) => tagPhoto(f, { copName: cop_?.nombre || "cop", torre, piso, fecha })));
    const validas = nuevas.filter(Boolean);
    if (validas.length < nuevas.length) alert("Algunas fotos no se pudieron leer (formato no compatible con este navegador).");
    setFotos((prev) => {
      const espacio = MAX_FOTOS - prev.length;
      if (validas.length > espacio) alert(`Una visita lleva máximo ${MAX_FOTOS} fotos.`);
      const base = siguienteId(prev);
      return [...prev, ...validas.slice(0, espacio).map((n, i) => ({ ...n, id: base + i, enInforme: false, subida: false }))];
    });
  };

  const toggleInforme = (i) => {
    const seleccionadas = fotos.filter((f) => f.enInforme).length;
    if (!fotos[i].enInforme && seleccionadas >= MAX_FOTOS_INFORME) {
      alert(`El informe de visita lleva máximo ${MAX_FOTOS_INFORME} fotos. Quita una para agregar otra.`);
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

  // Actividades del oficial: una fila cuenta si tiene descripción o valor, y debe tener ambos
  const filasOficial = actividades.filter((a) => a.concepto.trim() || Number(a.valor) > 0);
  const oficialCompleto = requiereOficial === false
    || (requiereOficial === true && filasOficial.length > 0 && filasOficial.every((a) => a.concepto.trim() && Number(a.valor) > 0));
  const totalOficial = requiereOficial ? filasOficial.reduce((s, a) => s + (Number(a.valor) || 0), 0) : 0;
  const setActividad = (i, cambios) => setActividades((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...cambios } : a)));
  const hayRotura = Object.values(items).some((v) => v?.activo && (v.romper || (v.pisos || []).some((p) => p.romper)));

  const construirLineas = () => {
    const lineas = precios.filter((d) => items[d.clave]?.activo).flatMap((d) => {
      const v = items[d.clave];
      if (d.tipo === "rociador") {
        const cantidad = cantidadRociadores(v);
        if (cantidad === 0) return [];
        return [{ concepto: `${d.etiqueta} — ${agruparRociadores(v.entradas)}`, cantidad, valor_tecnico: v.valor, clave: d.clave }];
      }
      if (d.tipo === "piso") {
        const pisos = v.pisos || [];
        if (pisos.length === 0) return [];
        const linea = { concepto: `${d.etiqueta} — ${agruparPorTorre(pisos)}`, cantidad: pisos.length, valor_tecnico: v.valor, clave: d.clave };
        const conRotura = pisos.filter((p) => p.romper);
        const extra = conRotura.length > 0
          ? [{ concepto: `Rotura — ${d.etiqueta} (${agruparPorTorre(conRotura)})`, cantidad: conRotura.length, valor_tecnico: valorRomper, clave: "rotura" }]
          : [];
        return [linea, ...extra];
      }
      const linea = { concepto: d.etiqueta, cantidad: Number(v.cantidad) || 1, valor_tecnico: v.valor, clave: d.clave };
      const extra = d.permite_romper && v.romper ? [{ concepto: `Rotura — ${d.etiqueta}`, cantidad: 1, valor_tecnico: valorRomper, clave: "rotura" }] : [];
      return [linea, ...extra];
    });
    if (Number(danoSevero) > 0) lineas.push({ concepto: "Daños severos (valorado en sitio)", cantidad: 1, valor_tecnico: Math.round(Number(danoSevero)) });
    return lineas;
  };

  const generar = async () => {
    if (!cop_ || guardando) return;
    if (requiereOficial && hayRotura && filasOficial.some((a) => /romp|rotura|demol|muro/i.test(a.concepto))
      && !window.confirm("Marcaste \"¿Se debe romper?\" en la cotización y el oficial también tiene una actividad de rotura. Revisa que no se cobre dos veces.\n\n¿Continuar de todos modos?")) return;
    setErrorGuardar("");
    setGuardando(true);
    try {
      const loteVisita = lote || crypto.randomUUID();
      setLote(loteVisita);
      const ruta = (f) => `${cop_.id}/${loteVisita}/${f.id}.jpg`;
      await subirFotos(fotos.map((f) => ({ ...f, path: ruta(f) })),
        (id) => setFotos((prev) => prev.map((f) => (f.id === id ? { ...f, subida: true } : f))),
        (n, de) => setProgreso(`Subiendo foto ${n} de ${de}…`));
      setProgreso("Guardando visita…");
      const { informe, resto } = separarFotos(fotos);
      const { data, error } = await conReintentos(() => supabase.rpc("crear_cotizacion", {
        p_copropiedad_id: cop_.id, p_torre: torre, p_piso: piso, p_lineas: construirLineas(), p_fotos: informe.map(ruta),
        p_diagnostico: diagnostico, p_recomendacion: recomendacion, p_fotos_extra: resto.map(ruta), p_lote: loteVisita,
        p_requiere_oficial: requiereOficial,
        p_actividades: requiereOficial ? filasOficial.map((a) => ({ concepto: a.concepto.trim(), valor: Math.round(Number(a.valor)) })) : [],
      }));
      if (error) throw error;
      setGenerado({ cot: data, fotos: informe });
      borrarBorrador(claveBorrador);
    } catch (err) {
      const m = mensajeError(err);
      setErrorGuardar(`${m} Tus fotos y datos siguen guardados en este celular: cuando tengas señal, pulsa de nuevo el botón.`);
    } finally {
      setGuardando(false);
      setProgreso("");
    }
  };

  const listo = total + totalOficial > 0 && !guardando && Boolean(diagnostico.trim()) && fotos.length > 0 && oficialCompleto;

  if (cargando) return <div style={card}>Cargando…</div>;
  if (errorCarga) return <div style={card}><p style={errorText}>{errorCarga}</p></div>;

  if (generado) return (
    <DocumentosGenerados registro={generado.cot} fotos={generado.fotos} onNuevo={() => {
      setGenerado(null);
      setFotos([]);
      setItems(crearItemsIniciales(precios));
      setDanoSevero("");
      setDiagnostico("");
      setRecomendacion("");
      setRequiereOficial(null);
      setActividades(ACTIVIDADES_VACIAS);
      setCopId("");
      setTorre(1);
      setPiso(PISOS[0]);
      setLote(null);
      setRecuperado(false);
    }} />
  );

  return (
    <div>
      {recuperado && (
        <div style={{ ...card, border: "2px solid #c8622f" }}>
          <p style={{ margin: "0 0 8px", fontSize: 14 }}>Recuperamos una visita que no alcanzó a registrarse. Revísala y pulsa <b>Generar informe y cotizaciones</b> al final.</p>
          <button type="button" style={btnGhost} onClick={descartarBorrador}>Descartar esta visita</button>
        </div>
      )}
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
                  {TORRES.map((n) => <option key={n} value={n}>{n}</option>)}
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
                <p style={{ fontSize: 12, color: "#6b756f", marginTop: 0, marginBottom: 6 }}>Toca hasta {MAX_FOTOS_INFORME} para incluirlas en el informe de visita. Si no eliges ninguna, se usan las primeras {MAX_FOTOS_INFORME}. Todas quedan guardadas en la carpeta de Drive.</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {fotos.map((f, i) => (
                    <div key={f.id} onClick={() => toggleInforme(i)} style={{ position: "relative", cursor: "pointer" }}>
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
            <h3 style={{ marginTop: 0 }}>Diagnóstico</h3>
            <p style={{ ...muted, marginTop: -6 }}>Este texto va en el informe que recibe el cliente. Escríbelo como se lo explicarías al administrador.</p>
            <label style={fieldLabel}>Qué encontraste en la visita
              <textarea style={{ ...input, minHeight: 90, fontFamily: "inherit" }} maxLength={2000} value={diagnostico}
                onChange={(e) => setDiagnostico(e.target.value)}
                placeholder="Ej.: La tapa del shut está en mal estado y los ejes están muy oxidados; al cerrar queda muy dura y no ajusta bien, lo que produce malos olores." />
            </label>
            <label style={fieldLabel}>Qué recomiendas (opcional)
              <textarea style={{ ...input, minHeight: 50, fontFamily: "inherit" }} maxLength={1000} value={recomendacion}
                onChange={(e) => setRecomendacion(e.target.value)} placeholder="Ej.: el cambio de la tapa y no la reparación." />
            </label>
          </div>

          <div style={card}>
            <h3 style={{ marginTop: 0 }}>¿Requiere oficial?</h3>
            <div style={{ display: "flex", gap: 16, fontSize: 14, marginBottom: requiereOficial ? 10 : 0 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="radio" name="requiere-oficial" checked={requiereOficial === true} onChange={() => setRequiereOficial(true)} /> Sí
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="radio" name="requiere-oficial" checked={requiereOficial === false} onChange={() => setRequiereOficial(false)} /> No
              </label>
            </div>
            {requiereOficial && (
              <>
                <p style={{ ...muted, marginTop: 0 }}>Registra hasta 3 actividades con su valor. Se suman a la cotización del cliente y no a tu pago.</p>
                {actividades.map((a, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-end" }}>
                    <label style={{ ...smallLabelOficial, flex: 1 }}>Actividad {i + 1}
                      <input style={{ ...input, padding: 6, marginTop: 2 }} maxLength={200} value={a.concepto} placeholder={EJEMPLOS_ACTIVIDAD[i]}
                        onChange={(e) => setActividad(i, { concepto: e.target.value })} />
                    </label>
                    <label style={{ ...smallLabelOficial, width: 120 }}>Valor
                      <input type="number" min={0} style={{ ...input, padding: 6, marginTop: 2 }} value={a.valor} placeholder="$ 0"
                        onFocus={(e) => e.target.select()} onChange={(e) => setActividad(i, { valor: e.target.value === "" ? "" : String(Math.max(0, Math.round(Number(e.target.value) || 0))) })} />
                    </label>
                  </div>
                ))}
                <div style={{ fontSize: 13, fontWeight: 700 }}>Total del oficial: {cop(totalOficial)}</div>
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
                          <SelectTorrePiso etiqueta="Torre" opciones={TORRES} valor={en.torre} onChange={(n) => actualizarRociador(k, idx, "torre", n)} />
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
                          <SelectTorrePiso etiqueta="Torre" opciones={TORRES} valor={p.torre} onChange={(n) => actualizarPiso(k, idx, "torre", n)} />
                          <SelectTorrePiso etiqueta="Piso" opciones={PISOS} valor={p.piso} onChange={(n) => actualizarPiso(k, idx, "piso", n)} />
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
            {requiereOficial === null && <p style={{ fontSize: 13, color: "#a15b2b", margin: "0 0 8px" }}>Responde arriba si la visita requiere oficial.</p>}
            {requiereOficial === true && !oficialCompleto && <p style={{ fontSize: 13, color: "#a15b2b", margin: "0 0 8px" }}>Completa la descripción y el valor de cada actividad del oficial.</p>}
            {total + totalOficial > 0 && !diagnostico.trim() && <p style={{ fontSize: 13, color: "#a15b2b", margin: "0 0 8px" }}>Escribe el diagnóstico (arriba) para poder generar el informe.</p>}
            {total + totalOficial > 0 && fotos.length === 0 && <p style={{ fontSize: 13, color: "#a15b2b", margin: "0 0 8px" }}>Toma al menos una foto (arriba) para poder generar el informe.</p>}
            <button style={{ ...btnPrimary, ...disabled(!listo) }} type="button" onClick={generar} disabled={!listo}>
              {guardando ? (progreso || "Guardando visita…") : "Generar informe y cotizaciones"}
            </button>
            {errorGuardar && <p style={errorText}>{errorGuardar}</p>}
          </div>
        </>
      )}
    </div>
  );
}

const smallLabelOficial = { fontSize: 11, color: "#6b756f", display: "block" };
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

function SelectTorrePiso({ etiqueta, opciones, valor, onChange }) {
  return (
    <label style={{ fontSize: 11, color: "#6b756f" }}>{etiqueta}
      <select style={{ ...input, width: 64, padding: 6, marginTop: 2 }} value={valor} onChange={(e) => onChange(Number(e.target.value))}>
        {opciones.map((n) => <option key={n} value={n}>{n}</option>)}
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

      {registro.requiere_oficial && (
        <>
          <h3>Actividades del oficial</h3>
          <TablaLineas lineas={registro.lineas_oficial.map((l) => ({ ...l, cantidad: 1 }))} campo="valor" total={registro.total_oficial} etiquetaTotal="Total del oficial" />
        </>
      )}

      <button style={{ ...btnPrimary, marginTop: 12 }} type="button" onClick={descargar}>Descargar mi cotización (PDF)</button>
      <button style={{ ...btnGhost, marginTop: 8, width: "100%" }} type="button" onClick={onNuevo}>Registrar otra visita</button>
    </div>
  );
}

export function TablaLineas({ lineas, campo, total, etiquetaTotal, descuento = null }) {
  return (
    <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
      <tbody>
        {lineas.map((l, i) => (
          <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
            <td style={{ whiteSpace: "pre-line", padding: "4px 0" }}>{l.concepto} — {l.cantidad} x {cop(l[campo])}</td>
            <td style={{ textAlign: "right", whiteSpace: "nowrap", paddingLeft: 8 }}>{cop(l[campo] * l.cantidad)}</td>
          </tr>
        ))}
        {descuento && (
          <>
            <tr>
              <td style={{ paddingTop: 6 }}>Subtotal</td>
              <td style={{ textAlign: "right", paddingTop: 6 }}>{cop(descuento.subtotal)}</td>
            </tr>
            <tr>
              <td>Descuento ({descuento.pct} %)</td>
              <td style={{ textAlign: "right" }}>{cop(-descuento.valor)}</td>
            </tr>
          </>
        )}
        <tr style={{ fontWeight: 700, borderTop: "1px solid #ccc" }}>
          <td style={{ paddingTop: 6 }}>{etiquetaTotal}</td>
          <td style={{ textAlign: "right", paddingTop: 6 }}>{cop(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}
