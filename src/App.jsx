import { useEffect, useState } from "react";
import { configurado, mensajeError, supabase } from "./lib/supabase.js";
import Login from "./components/Login.jsx";
import RegistroCliente from "./components/RegistroCliente.jsx";
import PanelTecnico from "./components/PanelTecnico.jsx";
import MisVisitas from "./components/MisVisitas.jsx";
import PanelAdmin from "./components/PanelAdmin.jsx";
import CambiarPassword from "./components/CambiarPassword.jsx";
import { card } from "./styles.js";
import { LOGO } from "./lib/logo.js";
import { MARCA } from "./lib/marca.js";

function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const f = () => setHash(window.location.hash);
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return hash;
}

function Marco({ perfil, onSalir, onPassword, tabs, tab, setTab, children }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f3", fontFamily: "'Segoe UI', system-ui, sans-serif", color: "#1f2a24" }}>
      <header style={{ background: "#1f2a24", color: "#f4f5f3", padding: "18px 20px", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <img src={LOGO} alt={MARCA.nombre} style={{ height: 28, display: "block", marginBottom: 6 }} />
          <div style={{ fontSize: 12, letterSpacing: 2, opacity: 0.7, textTransform: "uppercase" }}>{MARCA.servicio}</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Portal de copropiedades</div>
        </div>
        {perfil && (
          <div style={{ fontSize: 12, textAlign: "right" }}>
            <div style={{ opacity: 0.8 }}>{perfil.nombre} · {perfil.rol === "admin" ? "Administrador" : "Técnico"}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
              <button type="button" onClick={onPassword} style={headerBtn}>Cambiar contraseña</button>
              <button type="button" onClick={onSalir} style={headerBtn}>Salir</button>
            </div>
          </div>
        )}
      </header>

      {tabs && (
        <nav style={{ display: "flex", gap: 4, padding: "10px 16px", background: "#fff", borderBottom: "1px solid #e2e5e1", position: "sticky", top: 0, zIndex: 10 }}>
          {tabs.map(([k, label]) => (
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
      )}

      <main style={{ maxWidth: 680, margin: "0 auto", padding: 16 }}>{children}</main>
    </div>
  );
}

const headerBtn = { background: "rgba(255,255,255,0.12)", color: "#f4f5f3", border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12 };

export default function App() {
  const hash = useHash();
  const [sesion, setSesion] = useState(undefined); // undefined = cargando
  const [perfil, setPerfil] = useState(null);
  const [errorPerfil, setErrorPerfil] = useState("");
  const [tab, setTab] = useState(null);
  const [verPassword, setVerPassword] = useState(false);

  useEffect(() => {
    if (!configurado) return;
    supabase.auth.getSession().then(({ data }) => setSesion(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, s) => setSesion(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = sesion?.user?.id;
  useEffect(() => {
    if (!userId) { setPerfil(null); return; }
    let vigente = true;
    setErrorPerfil("");
    supabase.from("perfiles").select("*").eq("id", userId).maybeSingle().then(({ data, error }) => {
      if (!vigente) return;
      if (error || !data || !data.activo) {
        setErrorPerfil(error ? mensajeError(error) : "Tu cuenta no tiene acceso al portal. Comunícate con el administrador.");
        supabase.auth.signOut();
        return;
      }
      setErrorPerfil("");
      setPerfil(data);
      setTab(data.rol === "admin" ? "admin" : "visita");
    });
    return () => { vigente = false; };
  }, [userId]);

  if (!configurado) {
    return (
      <Marco>
        <div style={card}>
          <h2 style={{ marginTop: 0 }}>Falta configuración</h2>
          <p>Define <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> (ver README).</p>
        </div>
      </Marco>
    );
  }

  // Enlace público para que los clientes registren su copropiedad
  if (hash.startsWith("#/registro")) {
    return <Marco><RegistroCliente publico /></Marco>;
  }

  if (sesion === undefined || (sesion && !perfil && !errorPerfil)) {
    return <Marco><div style={card}>Cargando…</div></Marco>;
  }

  if (!sesion || !perfil) {
    return <Marco><Login errorInicial={errorPerfil} /></Marco>;
  }

  const salir = async () => { await supabase.auth.signOut(); setPerfil(null); setTab(null); };
  const tabs = perfil.rol === "admin"
    ? [["admin", "Admin"], ["cliente", "Registro cliente"]]
    : [["visita", "Nueva visita"], ["historial", "Mis visitas"]];

  return (
    <Marco perfil={perfil} onSalir={salir} onPassword={() => setVerPassword(true)} tabs={tabs} tab={tab} setTab={setTab}>
      {verPassword && <CambiarPassword onCerrar={() => setVerPassword(false)} />}
      {tab === "admin" && <PanelAdmin />}
      {tab === "cliente" && <RegistroCliente />}
      {tab === "visita" && <PanelTecnico perfil={perfil} />}
      {tab === "historial" && <MisVisitas />}
    </Marco>
  );
}
