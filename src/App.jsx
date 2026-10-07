import { useState } from "react";

// ---------- Utilidades ----------
const slug = (s) =>
  s.toString().toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const cop = (n) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

const roundNice = (n) => Math.round(n / 5000) * 5000;

const PRECIOS_DEFAULT = {
  tramo3040: { label: "Tramo cuarto de basuras (Ø 30-40 cm)", valor: 500000 },
  tramo5060: { label: "Tramo cuarto de basuras (Ø 50-60 cm)", valor: 600000 },
  fibraPiso: { label: "Reparación por piso de fibra", valor: 50000 },
  reparTapas: { label: "Reparación de tapas", valor: 50000 },
  reductores: { label: "Reparación de reductores de velocidad", valor: 130000 },
  instalTapas: { label: "Instalación de tapas shut en acero inoxidable", valor: 50000 },
  rociadores: { label: "Instalación de rociadores contra incendios", valor: 450000 },
};

const FACTOR_CLIENTE = 1.45;
const ROMPER_KEYS = ["tramo3040", "tramo5060"];
const ROMPER_VALOR = 300000;
const PISO_ITEM_KEYS = ["fibraPiso", "reparTapas", "reductores", "instalTapas"];
const ROCIADOR_KEY = "rociadores";

// Agrupa una lista de {torre, piso} en texto tipo "Torre 1: Pisos 1, 5, 6 · Torre 2: Pisos 2, 3"
function agruparPorTorre(pisos) {
  const porTorre = {};
  pisos.forEach((p) => { (porTorre[p.torre] = porTorre[p.torre] || []).push(p.piso); });
  return Object.keys(porTorre).map(Number).sort((a, b) => a - b)
    .map((t) => `Torre ${t}: Pisos ${porTorre[t].slice().sort((a, b) => a - b).join(", ")}`)
    .join("\n");
}

// Agrupa entradas de rociadores {torre, cuartoBasuras, ultimoPiso} por torre
function agruparRociadores(entradas) {
  const porTorre = {};
  entradas.forEach((e) => { (porTorre[e.torre] = porTorre[e.torre] || []).push(e); });
  return Object.keys(porTorre).map(Number).sort((a, b) => a - b)
    .map((t) => {
      const ubicaciones = [];
      if (porTorre[t].some((e) => e.cuartoBasuras)) ubicaciones.push("Cuarto de basuras");
      if (porTorre[t].some((e) => e.ultimoPiso)) ubicaciones.push("Último piso");
      return `Torre ${t}: ${ubicaciones.join(", ")}`;
    })
    .join("\n");
}

// Comprime y marca una foto con torre/piso/fecha
function tagPhoto(file, { copName, torre, piso, fecha }) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.onload = () => {
        const maxW = 900;
        const scale = Math.min(1, maxW / img.width);
        const w = img.width * scale, h = img.height * scale;
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const bandH = Math.max(36, h * 0.08);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(0, h - bandH, w, bandH);
        ctx.fillStyle = "#fff";
        ctx.font = `${Math.max(12, bandH * 0.32)}px sans-serif`;
        ctx.fillText(`${copName} · Torre ${torre} · Piso ${piso} · ${fecha}`, 8, h - bandH * 0.35);
        resolve({
          dataUrl: canvas.toDataURL("image/jpeg", 0.65),
          nombre: `${slug(copName)}_torre${torre}_piso${piso}_${Date.now()}.jpg`,
          torre, piso,
        });
      };
      // Formato no soportado por el navegador (p. ej. HEIC): se descarta en vez de bloquear la carga
      img.onerror = () => resolve(null);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

// Genera una tarjeta de identificación (imagen) con foto y datos del técnico para enviar al cliente
function generarTarjetaTecnico(tec, copNombre) {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = 600; canvas.height = 340;
    const ctx = canvas.getContext("2d");
    const dibujarTexto = () => {
      ctx.fillStyle = "#c8622f";
      ctx.font = "bold 14px sans-serif";
      ctx.fillText("TÉCNICO AUTORIZADO PARA ESTA VISITA", 24, 32);
      ctx.fillStyle = "#f4f5f3";
      ctx.font = "13px sans-serif";
      ctx.fillText(copNombre, 24, 54);
      ctx.font = "bold 22px sans-serif";
      ctx.fillText(tec.nombre, 190, 130);
      ctx.font = "15px sans-serif";
      ctx.fillText(`Cédula: ${tec.cedula || "—"}`, 190, 165);
      ctx.fillText(`Celular: ${tec.celular || "—"}`, 190, 190);
      resolve(canvas.toDataURL("image/png"));
    };
    ctx.fillStyle = "#1f2a24";
    ctx.fillRect(0, 0, 600, 340);
    if (tec.foto) {
      const img = new Image();
      img.onload = () => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(105, 190, 70, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, 35, 120, 140, 140);
        ctx.restore();
        dibujarTexto();
      };
      img.onerror = dibujarTexto;
      img.src = tec.foto;
    } else {
      dibujarTexto();
    }
  });
}

// xlsx se carga solo al descargar, para no inflar la carga inicial de la app
async function hojaVidaWorkbook(cop_) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const rows = [
    ["Hoja de vida — Copropiedad"],
    [],
    ["Nombre copropiedad", cop_.nombre],
    ["Año", cop_.anio],
    ["Administrador", cop_.administrador],
    ["Dirección física", cop_.direccion],
    ["Correo electrónico", cop_.email],
    ["Celular administrador", cop_.celAdmin],
    ["Teléfono portería", cop_.telPorteria],
    ["Técnico asignado", cop_.tecnicoAsignado || "(sin asignar)"],
    ["Fecha de registro", cop_.fechaRegistro],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 22 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws, "Hoja de vida");
  XLSX.writeFile(wb, `${slug(cop_.nombre)}-${cop_.anio}.xlsx`);
}

// ---------- App ----------
export default function App() {
  const [tab, setTab] = useState("cliente");
  const [copropiedades, setCopropiedades] = useState([]);
  const [precios, setPrecios] = useState(PRECIOS_DEFAULT);
  const [cotizaciones, setCotizaciones] = useState([]);
  const [proximoNumero, setProximoNumero] = useState(1);
  const [tecnicos, setTecnicos] = useState([]);

  const addCotizacion = (registro) => {
    const conNumero = { ...registro, numero: String(proximoNumero).padStart(3, "0") };
    setCotizaciones((prev) => [...prev, conNumero]);
    setProximoNumero((n) => (n >= 999 ? 1 : n + 1));
    return conNumero;
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f3", fontFamily: "'Segoe UI', system-ui, sans-serif", color: "#1f2a24" }}>
      <header style={{ background: "#1f2a24", color: "#f4f5f3", padding: "18px 20px" }}>
        <div style={{ fontSize: 12, letterSpacing: 2, opacity: 0.7, textTransform: "uppercase" }}>Servicio técnico · Shuts de basura</div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Portal de copropiedades</div>
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>Modo prueba: los datos se guardan solo mientras esta pestaña esté abierta</div>
      </header>

      <nav style={{ display: "flex", gap: 4, padding: "10px 16px", background: "#fff", borderBottom: "1px solid #e2e5e1", position: "sticky", top: 0, zIndex: 10 }}>
        {[
          ["cliente", "Registro cliente"],
          ["tecnico", "Técnico"],
          ["admin", "Admin"],
        ].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{
              flex: 1, padding: "10px 8px", borderRadius: 8, border: "none", cursor: "pointer",
              fontWeight: 600, fontSize: 14,
              background: tab === k ? "#c8622f" : "transparent",
              color: tab === k ? "#fff" : "#4a534d",
            }}>
            {label}
          </button>
        ))}
      </nav>

      <main style={{ maxWidth: 640, margin: "0 auto", padding: 16 }}>
        {tab === "cliente" ? (
          <RegistroCliente copropiedades={copropiedades} setCopropiedades={setCopropiedades} />
        ) : tab === "tecnico" ? (
          <PanelTecnico copropiedades={copropiedades} precios={precios} addCotizacion={addCotizacion} />
        ) : (
          <PanelAdmin
            copropiedades={copropiedades} setCopropiedades={setCopropiedades}
            precios={precios} setPrecios={setPrecios}
            cotizaciones={cotizaciones}
            tecnicos={tecnicos} setTecnicos={setTecnicos}
          />
        )}
      </main>
    </div>
  );
}

// ---------- Tab: Registro cliente ----------
function RegistroCliente({ copropiedades, setCopropiedades }) {
  const [form, setForm] = useState({
    nombre: "", administrador: "", direccion: "", email: "", celAdmin: "", telPorteria: "",
  });
  const [done, setDone] = useState(null);
  const [error, setError] = useState("");

  const submit = () => {
    setError("");
    if (!form.nombre.trim() || !form.administrador.trim()) {
      setError("Falta el nombre de la copropiedad o del administrador.");
      return;
    }
    const anio = new Date().getFullYear();
    const id = `${slug(form.nombre)}-${anio}`;
    const nuevo = {
      id, anio, ...form,
      tecnicoAsignado: "",
      fechaRegistro: new Date().toLocaleDateString("es-CO"),
    };
    setCopropiedades((prev) => {
      const existe = prev.some((c) => c.id === id);
      return existe ? prev.map((c) => (c.id === id ? { ...c, ...nuevo } : c)) : [...prev, nuevo];
    });
    setDone(nuevo);
  };

  if (done) {
    return (
      <div style={card}>
        <h2 style={{ marginTop: 0 }}>Carpeta creada</h2>
        <p>Se creó la carpeta <b>{done.nombre} — {done.anio}</b> con la hoja de vida de la copropiedad.</p>
        <button style={btnPrimary} onClick={() => hojaVidaWorkbook(done)}>Descargar hoja de vida (Excel)</button>
        <button style={{ ...btnGhost, marginTop: 8 }} onClick={() => { setDone(null); setForm({ nombre: "", administrador: "", direccion: "", email: "", celAdmin: "", telPorteria: "" }); }}>
          Registrar otra copropiedad
        </button>
      </div>
    );
  }

  return (
    <div style={card}>
      <h2 style={{ marginTop: 0 }}>Registro de copropiedad</h2>
      <p style={{ color: "#6b756f", fontSize: 14, marginTop: -8 }}>Comparte esta URL con tus clientes para que diligencien sus datos.</p>
      {[
        ["nombre", "Nombre de la copropiedad"],
        ["administrador", "Nombre del administrador"],
        ["direccion", "Dirección física de la copropiedad"],
        ["email", "Correo electrónico"],
        ["celAdmin", "Número de celular del administrador"],
        ["telPorteria", "Número telefónico de la portería"],
      ].map(([key, label]) => (
        <label key={key} style={fieldLabel}>
          {label}
          <input style={{ ...input, textTransform: "uppercase" }} type="text" value={form[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value.toUpperCase() })} />
        </label>
      ))}
      <button style={btnPrimary} type="button" onClick={submit}>Guardar y crear carpeta</button>
      {error && <p style={{ color: "#b3261e", fontSize: 13, marginTop: 8 }}>{error}</p>}
    </div>
  );
}

function crearItemsIniciales(precios) {
  return Object.fromEntries(Object.keys(precios).map((k) =>
    k === ROCIADOR_KEY
      ? [k, { activo: false, valor: precios[k].valor, entradas: [] }]
      : PISO_ITEM_KEYS.includes(k)
      ? [k, { activo: false, valor: precios[k].valor, pisos: [] }]
      : [k, { activo: false, cantidad: 1, valor: precios[k].valor, romper: false }]
  ));
}

// ---------- Tab: Técnico ----------
function PanelTecnico({ copropiedades, precios, addCotizacion }) {
  const [tecnico, setTecnico] = useState("");
  const [copId, setCopId] = useState("");
  const [torre, setTorre] = useState(1);
  const [piso, setPiso] = useState(1);
  const [fotos, setFotos] = useState([]);
  const [items, setItems] = useState(() => crearItemsIniciales(precios));
  const [danoSevero, setDanoSevero] = useState("");
  const [generado, setGenerado] = useState(null);

  const cop_ = copropiedades.find((c) => c.id === copId);
  const estaAutorizado = (c) =>
    tecnico.trim() && c.tecnicoAsignado && c.tecnicoAsignado.trim().toLowerCase() === tecnico.trim().toLowerCase();

  const handleFotos = async (e) => {
    const files = Array.from(e.target.files || []);
    const fecha = new Date().toLocaleDateString("es-CO");
    e.target.value = "";
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

  const agregarPiso = (key) => {
    setItems((prev) => ({
      ...prev,
      [key]: { ...prev[key], pisos: [...(prev[key].pisos || []), { torre, piso, romper: false }] },
    }));
  };
  const quitarPiso = (key, idx) => {
    setItems((prev) => ({
      ...prev,
      [key]: { ...prev[key], pisos: prev[key].pisos.filter((_, i) => i !== idx) },
    }));
  };
  const actualizarPiso = (key, idx, campo, valor) => {
    setItems((prev) => ({
      ...prev,
      [key]: { ...prev[key], pisos: prev[key].pisos.map((p, i) => (i === idx ? { ...p, [campo]: valor } : p)) },
    }));
  };

  const agregarRociador = () => {
    setItems((prev) => ({
      ...prev,
      [ROCIADOR_KEY]: { ...prev[ROCIADOR_KEY], entradas: [...(prev[ROCIADOR_KEY].entradas || []), { torre, cuartoBasuras: false, ultimoPiso: false }] },
    }));
  };
  const quitarRociador = (idx) => {
    setItems((prev) => ({
      ...prev,
      [ROCIADOR_KEY]: { ...prev[ROCIADOR_KEY], entradas: prev[ROCIADOR_KEY].entradas.filter((_, i) => i !== idx) },
    }));
  };
  const actualizarRociador = (idx, campo, valor) => {
    setItems((prev) => ({
      ...prev,
      [ROCIADOR_KEY]: { ...prev[ROCIADOR_KEY], entradas: prev[ROCIADOR_KEY].entradas.map((e, i) => (i === idx ? { ...e, [campo]: valor } : e)) },
    }));
  };

  const subtotalTecnico = (k, v) => {
    if (!v.activo) return 0;
    if (k === ROCIADOR_KEY) {
      const cantidad = (v.entradas || []).reduce((n, e) => n + (e.cuartoBasuras ? 1 : 0) + (e.ultimoPiso ? 1 : 0), 0);
      return v.valor * cantidad;
    }
    if (PISO_ITEM_KEYS.includes(k)) {
      const pisos = v.pisos || [];
      return v.valor * pisos.length + pisos.filter((p) => p.romper).length * ROMPER_VALOR;
    }
    return v.valor * (Number(v.cantidad) || 0) + (ROMPER_KEYS.includes(k) && v.romper ? ROMPER_VALOR : 0);
  };
  const subtotalCliente = (k, v) => {
    if (!v.activo) return 0;
    if (k === ROCIADOR_KEY) {
      const cantidad = (v.entradas || []).reduce((n, e) => n + (e.cuartoBasuras ? 1 : 0) + (e.ultimoPiso ? 1 : 0), 0);
      return roundNice(v.valor * FACTOR_CLIENTE) * cantidad;
    }
    if (PISO_ITEM_KEYS.includes(k)) {
      const pisos = v.pisos || [];
      return roundNice(v.valor * FACTOR_CLIENTE) * pisos.length + pisos.filter((p) => p.romper).length * roundNice(ROMPER_VALOR * FACTOR_CLIENTE);
    }
    return roundNice(v.valor * FACTOR_CLIENTE) * (Number(v.cantidad) || 0) + (ROMPER_KEYS.includes(k) && v.romper ? roundNice(ROMPER_VALOR * FACTOR_CLIENTE) : 0);
  };

  const totalTecnico = Object.entries(items).reduce((s, [k, v]) => s + subtotalTecnico(k, v), 0) + (Number(danoSevero) || 0);
  const totalCliente = Object.entries(items).reduce((s, [k, v]) => s + subtotalCliente(k, v), 0) + roundNice((Number(danoSevero) || 0) * FACTOR_CLIENTE);

  const generar = () => {
    if (!cop_) return;
    const fecha = new Date().toLocaleDateString("es-CO");
    const lineas = Object.entries(items).filter(([, v]) => v.activo).flatMap(([k, v]) => {
      if (k === ROCIADOR_KEY) {
        const entradas = v.entradas || [];
        const cantidad = entradas.reduce((n, e) => n + (e.cuartoBasuras ? 1 : 0) + (e.ultimoPiso ? 1 : 0), 0);
        if (cantidad === 0) return [];
        return [{ concepto: `${precios[k].label} — ${agruparRociadores(entradas)}`, cantidad, valorTecnico: v.valor, valorCliente: roundNice(v.valor * FACTOR_CLIENTE) }];
      }
      if (PISO_ITEM_KEYS.includes(k)) {
        const pisos = v.pisos || [];
        if (pisos.length === 0) return [];
        const detalle = agruparPorTorre(pisos);
        const linea = { concepto: `${precios[k].label} — ${detalle}`, cantidad: pisos.length, valorTecnico: v.valor, valorCliente: roundNice(v.valor * FACTOR_CLIENTE) };
        const conRotura = pisos.filter((p) => p.romper);
        const extra = conRotura.length > 0
          ? [{ concepto: `Rotura — ${precios[k].label} (${agruparPorTorre(conRotura)})`, cantidad: conRotura.length, valorTecnico: ROMPER_VALOR, valorCliente: roundNice(ROMPER_VALOR * FACTOR_CLIENTE) }]
          : [];
        return [linea, ...extra];
      }
      const linea = { concepto: precios[k].label, cantidad: Number(v.cantidad) || 1, valorTecnico: v.valor, valorCliente: roundNice(v.valor * FACTOR_CLIENTE) };
      const extra = ROMPER_KEYS.includes(k) && v.romper
        ? [{ concepto: `Rotura — ${precios[k].label}`, cantidad: 1, valorTecnico: ROMPER_VALOR, valorCliente: roundNice(ROMPER_VALOR * FACTOR_CLIENTE) }]
        : [];
      return [linea, ...extra];
    });
    if (Number(danoSevero) > 0) {
      lineas.push({ concepto: "Daños severos (valorado en sitio)", cantidad: 1, valorTecnico: Number(danoSevero), valorCliente: roundNice(Number(danoSevero) * FACTOR_CLIENTE) });
    }
    const fotosInforme = fotos.some((f) => f.enInforme) ? fotos.filter((f) => f.enInforme).slice(0, 4) : fotos.slice(0, 4);
    const registro = {
      id: `${copId}-${Date.now()}`, copId, copNombre: cop_.nombre, tecnico, fecha, torre, piso,
      lineas, totalTecnico, totalCliente, fotos: fotosInforme,
    };
    setGenerado(addCotizacion(registro));
  };

  if (generado) return (
    <DocumentosGenerados registro={generado} onNuevo={() => {
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
        <label style={fieldLabel}>Nombre del técnico
          <input style={{ ...input, textTransform: "uppercase" }} value={tecnico} onChange={(e) => setTecnico(e.target.value.toUpperCase())} placeholder="Tu nombre" />
        </label>
        <div style={fieldLabel}>Copropiedades
          {copropiedades.length === 0 && <p style={{ fontSize: 13, color: "#a15b2b", fontWeight: 400 }}>No hay copropiedades registradas todavía. Ve a "Registro cliente" y crea una.</p>}
          {!tecnico.trim() && copropiedades.length > 0 && <p style={{ fontSize: 13, color: "#a15b2b", fontWeight: 400 }}>Escribe tu nombre para ver cuáles puedes abrir.</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            {copropiedades.map((c) => {
              const ok = estaAutorizado(c);
              return (
                <button key={c.id} type="button"
                  onClick={() => ok ? setCopId(c.id) : alert("No tienes autorización para abrir esta copropiedad. Pide al administrador que te la asigne.")}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 12px", borderRadius: 8, border: copId === c.id ? "2px solid #c8622f" : "1px solid #d7dbd5",
                    background: ok ? "#fff" : "#f4f5f3", color: ok ? "#1f2a24" : "#9aa39c",
                    cursor: ok ? "pointer" : "not-allowed", fontWeight: 600, fontSize: 14, textAlign: "left",
                  }}>
                  <span>{c.nombre} ({c.anio})</span>
                  <span style={{ fontSize: 12, fontWeight: 400 }}>{ok ? "Autorizada ✓" : "🔒 Sin autorización"}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {cop_ && (
        <>
          <div style={card}>
            <h3 style={{ marginTop: 0 }}>Información de la copropiedad</h3>
            <p><b>Administrador:</b> {cop_.administrador}</p>
            <p><b>Dirección:</b> {cop_.direccion}</p>
          </div>

          <div style={card}>
            <h3 style={{ marginTop: 0 }}>Ubicación</h3>
            <p style={{ fontSize: 13, color: "#6b756f", marginTop: -6 }}>Solo para ubicar dónde se toman las fotos. Los pisos a cotizar se agregan en cada ítem de la cotización.</p>
            <div style={{ display: "flex", gap: 10 }}>
              <label style={{ ...fieldLabel, flex: 1 }}>Torre
                <select style={input} value={torre} onChange={(e) => setTorre(Number(e.target.value))}>
                  {Array.from({ length: 50 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label style={{ ...fieldLabel, flex: 1 }}>Piso
                <select style={input} value={piso} onChange={(e) => setPiso(Number(e.target.value))}>
                  {Array.from({ length: 50 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div style={card}>
            <h3 style={{ marginTop: 0 }}>Tomar fotos — Torre {torre}, Piso {piso}</h3>
            <p style={{ fontSize: 13, color: "#6b756f", marginTop: -6 }}>Cada foto queda marcada automáticamente con la torre, el piso y la fecha.</p>
            <label htmlFor="foto-input" style={{ ...btnPrimary, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, textDecoration: "none", cursor: "pointer" }}>
              📷 Tomar foto (Torre {torre}, Piso {piso})
            </label>
            <input id="foto-input" type="file" accept="image/*" capture="environment" multiple onChange={handleFotos} style={{ display: "none" }} />
            {fotos.length > 0 && (
              <>
                <p style={{ fontSize: 13, fontWeight: 600, marginTop: 12, marginBottom: 2 }}>Fotos tomadas en esta visita ({fotos.length})</p>
                <p style={{ fontSize: 12, color: "#6b756f", marginTop: 0, marginBottom: 6 }}>Toca hasta 4 para incluirlas en el informe de visita.</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {fotos.map((f, i) => (
                    <div key={i} onClick={() => toggleInforme(i)} style={{ position: "relative", cursor: "pointer" }}>
                      <img src={f.dataUrl} alt={f.nombre} style={{
                        width: 72, height: 72, objectFit: "cover", borderRadius: 6,
                        border: f.enInforme ? "3px solid #c8622f" : "3px solid transparent",
                      }} />
                      <span style={{ position: "absolute", bottom: 2, left: 2, right: 2, fontSize: 9, color: "#fff", background: "rgba(0,0,0,0.55)", borderRadius: 3, textAlign: "center" }}>T{f.torre}/P{f.piso}</span>
                      {f.enInforme && (
                        <span style={{ position: "absolute", top: -4, right: -4, background: "#c8622f", color: "#fff", borderRadius: "50%", width: 18, height: 18, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div style={card}>
            <h3 style={{ marginTop: 0 }}>Cotización</h3>
            <p style={{ fontSize: 13, color: "#6b756f", marginTop: -6 }}>Marca cada trabajo realizado y coloca cuántas unidades (pisos, tapas, reductores, etc.) reparaste.</p>
            {Object.entries(precios).map(([k, def]) => (
              <div key={k} style={{ padding: "10px 0", borderBottom: "1px solid #eee" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600 }}>
                  <input type="checkbox" checked={items[k]?.activo || false}
                    onChange={(e) => setItems({ ...items, [k]: { ...items[k], activo: e.target.checked } })} />
                  {def.label}
                </label>
                {items[k]?.activo && k === ROCIADOR_KEY && (
                  <div style={{ marginTop: 8, paddingLeft: 24 }}>
                    <label style={{ fontSize: 11, color: "#6b756f", display: "block", marginBottom: 8 }}>Valor unitario por rociador
                      <input type="number" value={items[k]?.valor ?? def.valor} style={{ ...input, width: 110, padding: 6, marginTop: 2 }}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setItems({ ...items, [k]: { ...items[k], valor: Number(e.target.value) } })} />
                    </label>
                    {(items[k].entradas || []).map((en, idx) => (
                      <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, background: "#f8f9f7", padding: 8, borderRadius: 8, flexWrap: "wrap" }}>
                        <label style={{ fontSize: 11, color: "#6b756f" }}>Torre
                          <select style={{ ...input, width: 64, padding: 6, marginTop: 2 }} value={en.torre}
                            onChange={(e) => actualizarRociador(idx, "torre", Number(e.target.value))}>
                            {Array.from({ length: 50 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, marginTop: 12 }}>
                          <input type="checkbox" checked={en.cuartoBasuras} onChange={(e) => actualizarRociador(idx, "cuartoBasuras", e.target.checked)} />
                          Cuarto de basuras
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, marginTop: 12 }}>
                          <input type="checkbox" checked={en.ultimoPiso} onChange={(e) => actualizarRociador(idx, "ultimoPiso", e.target.checked)} />
                          Último piso
                        </label>
                        <button type="button" onClick={() => quitarRociador(idx)} style={{ background: "none", border: "none", color: "#b3261e", fontSize: 18, cursor: "pointer", marginTop: 10, marginLeft: "auto" }}>×</button>
                      </div>
                    ))}
                    <button type="button" onClick={agregarRociador} style={{ ...btnGhost, marginTop: 2 }}>+ Agregar torre</button>
                    <div style={{ fontSize: 13, fontWeight: 700, marginTop: 8 }}>
                      Subtotal: {cop(subtotalTecnico(ROCIADOR_KEY, items[ROCIADOR_KEY]))}
                    </div>
                  </div>
                )}
                {items[k]?.activo && PISO_ITEM_KEYS.includes(k) && (
                  <div style={{ marginTop: 8, paddingLeft: 24 }}>
                    <label style={{ fontSize: 11, color: "#6b756f", display: "block", marginBottom: 8 }}>Valor unitario por piso
                      <input type="number" value={items[k]?.valor ?? def.valor} style={{ ...input, width: 110, padding: 6, marginTop: 2 }}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setItems({ ...items, [k]: { ...items[k], valor: Number(e.target.value) } })} />
                    </label>
                    {(items[k].pisos || []).map((p, idx) => (
                      <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, background: "#f8f9f7", padding: 8, borderRadius: 8 }}>
                        <label style={{ fontSize: 11, color: "#6b756f" }}>Torre
                          <select style={{ ...input, width: 64, padding: 6, marginTop: 2 }} value={p.torre}
                            onChange={(e) => actualizarPiso(k, idx, "torre", Number(e.target.value))}>
                            {Array.from({ length: 50 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </label>
                        <label style={{ fontSize: 11, color: "#6b756f" }}>Piso
                          <select style={{ ...input, width: 64, padding: 6, marginTop: 2 }} value={p.piso}
                            onChange={(e) => actualizarPiso(k, idx, "piso", Number(e.target.value))}>
                            {Array.from({ length: 50 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#a15b2b", flex: 1, marginTop: 12 }}>
                          <input type="checkbox" checked={p.romper} onChange={(e) => actualizarPiso(k, idx, "romper", e.target.checked)} />
                          ¿Se debe romper?
                        </label>
                        <button type="button" onClick={() => quitarPiso(k, idx)} style={{ background: "none", border: "none", color: "#b3261e", fontSize: 18, cursor: "pointer", marginTop: 10 }}>×</button>
                      </div>
                    ))}
                    <button type="button" onClick={() => agregarPiso(k)} style={{ ...btnGhost, marginTop: 2 }}>+ Agregar piso</button>
                    <div style={{ fontSize: 13, fontWeight: 700, marginTop: 8 }}>
                      Subtotal: {cop(subtotalTecnico(k, items[k]))}
                    </div>
                  </div>
                )}
                {items[k]?.activo && !PISO_ITEM_KEYS.includes(k) && k !== ROCIADOR_KEY && (
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 8, paddingLeft: 24 }}>
                    <label style={{ fontSize: 11, color: "#6b756f" }}>Cantidad
                      <input type="number" min={1} value={items[k]?.cantidad || 1} style={{ ...input, width: 60, padding: 6, marginTop: 2 }}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setItems({ ...items, [k]: { ...items[k], cantidad: e.target.value === "" ? "" : Math.max(1, Number(e.target.value)) } })}
                        onBlur={(e) => { if (!e.target.value) setItems({ ...items, [k]: { ...items[k], cantidad: 1 } }); }} />
                    </label>
                    <label style={{ fontSize: 11, color: "#6b756f" }}>Valor unitario
                      <input type="number" value={items[k]?.valor ?? def.valor} style={{ ...input, width: 110, padding: 6, marginTop: 2 }}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setItems({ ...items, [k]: { ...items[k], valor: Number(e.target.value) } })} />
                    </label>
                    <div style={{ fontSize: 13, fontWeight: 700, marginLeft: "auto" }}>
                      {cop((items[k]?.valor ?? def.valor) * (Number(items[k]?.cantidad) || 1) + (ROMPER_KEYS.includes(k) && items[k]?.romper ? ROMPER_VALOR : 0))}
                    </div>
                  </div>
                )}
                {items[k]?.activo && ROMPER_KEYS.includes(k) && (
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 6, paddingLeft: 24, color: "#a15b2b" }}>
                    <input type="checkbox" checked={items[k]?.romper || false}
                      onChange={(e) => setItems({ ...items, [k]: { ...items[k], romper: e.target.checked } })} />
                    ¿Se debe romper?
                  </label>
                )}
              </div>
            ))}
            <label style={fieldLabel}>Daños severos — valor a definir en sitio (opcional)
              <input type="number" style={input} value={danoSevero} onFocus={(e) => e.target.select()} onChange={(e) => setDanoSevero(e.target.value)} placeholder="$ 0" />
            </label>
            <div style={{ marginTop: 10, fontSize: 16, borderTop: "2px solid #1f2a24", paddingTop: 10 }}>
              Total a pagar por este servicio: <b>{cop(totalTecnico)}</b>
            </div>
            <button style={{ ...btnPrimary, ...(totalTecnico === 0 && { opacity: 0.5, cursor: "not-allowed" }) }} type="button" onClick={generar} disabled={totalTecnico === 0}>Generar informe y cotizaciones</button>
          </div>
        </>
      )}
    </div>
  );
}

function DocumentosGenerados({ registro, onNuevo }) {
  return (
    <div style={card}>
      <h2 style={{ marginTop: 0 }}>Visita registrada — Cotización N.° {registro.numero}</h2>
      <p>Copropiedad: <b>{registro.copNombre}</b> · Torre {registro.torre}, Piso {registro.piso} · {registro.fecha}</p>
      <p style={{ fontSize: 13, color: "#6b756f" }}>El informe y la cotización para el cliente quedaron guardados en la carpeta de la copropiedad. El administrador se encarga de enviarlos.</p>

      <h3>Informe de visita ({registro.fotos.length} fotos)</h3>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {registro.fotos.map((f, i) => <img key={i} src={f.dataUrl} style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 6 }} />)}
      </div>

      <h3>Tu cotización (pago del servicio)</h3>
      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
        <tbody>
          {registro.lineas.map((l, i) => (
            <tr key={i}><td style={{ whiteSpace: "pre-line" }}>{l.concepto} — {l.cantidad} x {cop(l.valorTecnico)}</td><td style={{ textAlign: "right" }}>{cop(l.valorTecnico * l.cantidad)}</td></tr>
          ))}
          <tr style={{ fontWeight: 700, borderTop: "1px solid #ccc" }}><td>Total a pagar</td><td style={{ textAlign: "right" }}>{cop(registro.totalTecnico)}</td></tr>
        </tbody>
      </table>

      <button style={{ ...btnPrimary, marginTop: 10 }} type="button" onClick={onNuevo}>Registrar otra visita</button>
    </div>
  );
}

// ---------- Tab: Admin ----------
function PanelAdmin({ copropiedades, setCopropiedades, precios, setPrecios, cotizaciones, tecnicos, setTecnicos }) {
  const [seleccion, setSeleccion] = useState(null);
  const [abiertoId, setAbiertoId] = useState(null);
  const [p, setP] = useState(precios);
  const [nuevoTec, setNuevoTec] = useState({ nombre: "", celular: "", cedula: "", foto: null });

  const historial = seleccion ? cotizaciones.filter((h) => h.copId === seleccion.id) : [];
  const abierto = abiertoId ? cotizaciones.find((h) => h.id === abiertoId) : null;

  const asignarTecnico = (id, nombre) => {
    setCopropiedades((prev) => prev.map((c) => (c.id === id ? { ...c, tecnicoAsignado: nombre } : c)));
    setSeleccion((prev) => (prev && prev.id === id ? { ...prev, tecnicoAsignado: nombre } : prev));
  };

  const cargarFotoTec = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setNuevoTec((prev) => ({ ...prev, foto: ev.target.result }));
    reader.readAsDataURL(file);
  };

  const agregarTecnico = () => {
    if (!nuevoTec.nombre.trim()) return;
    if (tecnicos.some((t) => t.nombre === nuevoTec.nombre.trim())) {
      alert("Ya existe un técnico con ese nombre exacto en el directorio. Usa un nombre distinto (ej. agrega el apellido) para poder diferenciarlos.");
      return;
    }
    setTecnicos((prev) => [...prev, { ...nuevoTec, nombre: nuevoTec.nombre.trim() }]);
    setNuevoTec({ nombre: "", celular: "", cedula: "", foto: null });
  };

  const quitarTecnico = (nombre) => {
    setTecnicos((prev) => prev.filter((t) => t.nombre !== nombre));
  };

  const enviarIdentificacion = async (c) => {
    const tec = tecnicos.find((t) => t.nombre === c.tecnicoAsignado);
    if (!tec) {
      alert("Primero agrega a este técnico en el directorio (con su foto) y vuelve a asignarlo.");
      return;
    }
    const dataUrl = await generarTarjetaTecnico(tec, c.nombre);
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `identificacion_${slug(tec.nombre)}.png`;
    a.click();
  };

  return (
    <div>
      <div style={card}>
        <h2 style={{ marginTop: 0 }}>Directorio de técnicos</h2>
        <p style={{ fontSize: 13, color: "#6b756f", marginTop: -6 }}>Regístralos aquí con foto para poder enviar su identificación al cliente cuando los asignes.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
          <label style={{ fontSize: 11, color: "#6b756f" }}>Nombre
            <input style={{ ...input, width: 140, padding: 6, marginTop: 2, textTransform: "uppercase" }} value={nuevoTec.nombre}
              onChange={(e) => setNuevoTec({ ...nuevoTec, nombre: e.target.value.toUpperCase() })} />
          </label>
          <label style={{ fontSize: 11, color: "#6b756f" }}>Cédula
            <input style={{ ...input, width: 110, padding: 6, marginTop: 2 }} value={nuevoTec.cedula}
              onChange={(e) => setNuevoTec({ ...nuevoTec, cedula: e.target.value })} />
          </label>
          <label style={{ fontSize: 11, color: "#6b756f" }}>Celular
            <input style={{ ...input, width: 110, padding: 6, marginTop: 2 }} value={nuevoTec.celular}
              onChange={(e) => setNuevoTec({ ...nuevoTec, celular: e.target.value })} />
          </label>
          <label style={{ fontSize: 11, color: "#6b756f" }}>Foto
            <input type="file" accept="image/*" onChange={cargarFotoTec} style={{ display: "block", marginTop: 2 }} />
          </label>
          <button type="button" style={btnGhost} onClick={agregarTecnico}>+ Agregar técnico</button>
        </div>
        {tecnicos.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {tecnicos.map((t, i) => (
              <div key={i} style={{ textAlign: "center", fontSize: 11, position: "relative" }}>
                <button type="button" onClick={() => quitarTecnico(t.nombre)}
                  style={{ position: "absolute", top: -6, right: -2, background: "#b3261e", color: "#fff", border: "none", borderRadius: "50%", width: 16, height: 16, fontSize: 10, lineHeight: "16px", cursor: "pointer", padding: 0 }}>×</button>
                {t.foto ? <img src={t.foto} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: "50%" }} /> : <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#eef0ec" }} />}
                <div>{t.nombre}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={card}>
        <h2 style={{ marginTop: 0 }}>Copropiedades registradas</h2>
        {copropiedades.length === 0 && <p>Aún no hay registros. Ve a la pestaña "Registro cliente" y crea uno de prueba.</p>}
        {copropiedades.map((c) => (
          <div key={c.id} style={{ borderBottom: "1px solid #eee", padding: "8px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <b>{c.nombre} ({c.anio})</b>
              <button style={btnGhost} type="button" onClick={() => { setSeleccion(c); setAbiertoId(null); }}>Ver</button>
            </div>
            <label style={{ fontSize: 12, color: "#6b756f", display: "block", marginTop: 4 }}>Técnico asignado:
              <select style={{ ...input, padding: 6, marginTop: 4 }} value={c.tecnicoAsignado || ""}
                onChange={(e) => asignarTecnico(c.id, e.target.value)}>
                <option value="">— Sin asignar —</option>
                {tecnicos.map((t, i) => <option key={i} value={t.nombre}>{t.nombre}</option>)}
              </select>
            </label>
            {c.tecnicoAsignado && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                <button type="button" style={btnGhost} onClick={() => enviarIdentificacion(c)}>
                  📇 Descargar identificación de {c.tecnicoAsignado}
                </button>
                {c.email && (
                  <a style={btnGhostLink} href={`mailto:${c.email}?subject=${encodeURIComponent(`Técnico autorizado — ${c.nombre}`)}&body=${encodeURIComponent(`Buen día ${c.administrador},\n\nLe informamos que el técnico ${c.tecnicoAsignado} está autorizado para realizar la visita técnica en su copropiedad. Adjuntamos su identificación con foto para que puedan confirmar su ingreso.\n\nQuedamos atentos.`)}`}>
                    Abrir correo
                  </a>
                )}
                {c.celAdmin && (
                  <a style={btnGhostLink} target="_blank" rel="noreferrer" href={`https://wa.me/57${c.celAdmin.replace(/\D/g, "")}?text=${encodeURIComponent(`El técnico ${c.tecnicoAsignado} está autorizado para la visita en ${c.nombre}. Le compartimos su identificación con foto (adjunta) para que confirmen su ingreso.`)}`}>
                    Abrir WhatsApp
                  </a>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {seleccion && (
        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Historial — {seleccion.nombre}</h3>
          <button style={btnGhost} type="button" onClick={() => hojaVidaWorkbook(seleccion)}>Descargar hoja de vida</button>
          {historial.length === 0 ? <p>Sin visitas registradas.</p> : historial.map((h) => (
            <div key={h.id} style={{ padding: "8px 0", borderBottom: "1px dashed #eee" }}>
              <button type="button" onClick={() => setAbiertoId(abiertoId === h.id ? null : h.id)}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, textAlign: "left", width: "100%" }}>
                N.° {h.numero} · {h.fecha} · {h.tecnico} · Torre {h.torre}/Piso {h.piso} · Cliente: {cop(h.totalCliente)} · Técnico: {cop(h.totalTecnico)}
              </button>
              {abierto?.id === h.id && (
                <div style={{ marginTop: 8, background: "#f8f9f7", borderRadius: 8, padding: 10 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, margin: "0 0 6px" }}>Informe de visita</p>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {abierto.fotos.map((f, i) => <img key={i} src={f.dataUrl} style={{ width: 70, height: 70, objectFit: "cover", borderRadius: 6 }} />)}
                  </div>
                  <p style={{ fontSize: 12, fontWeight: 700, margin: "0 0 6px" }}>Cotización cliente N.° {abierto.numero}</p>
                  <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                    <tbody>
                      {abierto.lineas.map((l, i) => (
                        <tr key={i}><td style={{ whiteSpace: "pre-line" }}>{l.concepto} — {l.cantidad} x {cop(l.valorCliente)}</td><td style={{ textAlign: "right" }}>{cop(l.valorCliente * l.cantidad)}</td></tr>
                      ))}
                      <tr style={{ fontWeight: 700, borderTop: "1px solid #ccc" }}><td>Total cliente</td><td style={{ textAlign: "right" }}>{cop(abierto.totalCliente)}</td></tr>
                    </tbody>
                  </table>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    {seleccion.email && (
                      <a style={btnGhostLink} href={`mailto:${seleccion.email}?subject=${encodeURIComponent(`Cotización N.° ${abierto.numero} — ${seleccion.nombre}`)}&body=${encodeURIComponent(`Buen día ${seleccion.administrador},\n\nAdjuntamos el informe de la visita técnica del ${abierto.fecha} y la cotización N.° ${abierto.numero} correspondiente.\nTotal: ${cop(abierto.totalCliente)}\n\nQuedamos atentos.`)}`}>
                        Abrir correo
                      </a>
                    )}
                    {seleccion.celAdmin && (
                      <a style={btnGhostLink} target="_blank" rel="noreferrer" href={`https://wa.me/57${seleccion.celAdmin.replace(/\D/g, "")}?text=${encodeURIComponent(`Cotización N.° ${abierto.numero} — ${seleccion.nombre}\nFecha: ${abierto.fecha}\nTotal cotización: ${cop(abierto.totalCliente)}\n(adjuntamos informe y fotos por este medio)`)}`}>
                        Abrir WhatsApp
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Precios base (técnico)</h3>
        {Object.entries(p).map(([k, def]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
            <span style={{ fontSize: 13 }}>{def.label}</span>
            <input type="number" style={{ ...input, width: 110, padding: 4 }} value={def.valor}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setP({ ...p, [k]: { ...def, valor: Number(e.target.value) } })} />
          </div>
        ))}
        <button style={btnPrimary} type="button" onClick={() => setPrecios(p)}>Guardar precios</button>
        <p style={{ fontSize: 12, color: "#6b756f" }}>El cliente paga estos valores + 45%, redondeado. Los técnicos no ven este porcentaje ni el precio del cliente.</p>
      </div>
    </div>
  );
}

// ---------- Estilos ----------
const card = { background: "#fff", borderRadius: 12, padding: 18, marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" };
const fieldLabel = { display: "block", fontSize: 13, fontWeight: 600, color: "#4a534d", marginBottom: 10 };
const input = { display: "block", width: "100%", marginTop: 4, padding: "9px 10px", borderRadius: 8, border: "1px solid #d7dbd5", fontSize: 14, boxSizing: "border-box" };
const btnPrimary = { background: "#c8622f", color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontWeight: 700, cursor: "pointer", fontSize: 14, width: "100%" };
const btnGhost = { background: "#eef0ec", color: "#1f2a24", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 600, cursor: "pointer", fontSize: 13 };
const btnGhostLink = { ...btnGhost, textDecoration: "none", display: "inline-block" };