import { useEffect, useState } from "react";
import { llamarUsuarios, mensajeError, supabase, usuarioAEmail } from "../lib/supabase.js";
import { btnPrimary, card, disabled, errorText, fieldLabel, input, muted } from "../styles.js";

export default function Login({ errorInicial }) {
  const [estado, setEstado] = useState(null);
  const [form, setForm] = useState({ usuario: "", password: "" });
  const [error, setError] = useState(errorInicial || "");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    // Un reintento: la primera llamada a la función puede fallar mientras arranca en frío
    llamarUsuarios("estado")
      .catch(() => new Promise((r) => setTimeout(r, 1500)).then(() => llamarUsuarios("estado")))
      .then(setEstado)
      .catch(() => setEstado({ hay_admin: true }));
  }, []);

  const entrar = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.usuario.trim() || !form.password) { setError("Escribe tu usuario y contraseña."); return; }
    setEnviando(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: usuarioAEmail(form.usuario), password: form.password });
    setEnviando(false);
    if (err) setError(mensajeError(err));
  };

  if (estado && !estado.hay_admin) return <ConfiguracionInicial onListo={() => setEstado({ hay_admin: true })} />;

  return (
    <form style={card} onSubmit={entrar}>
      <h2 style={{ marginTop: 0 }}>Iniciar sesión</h2>
      <p style={{ ...muted, marginTop: -8 }}>Acceso para el administrador y los técnicos.</p>
      <label style={fieldLabel}>Usuario
        <input style={input} autoComplete="username" autoCapitalize="none" value={form.usuario}
          onChange={(e) => setForm({ ...form, usuario: e.target.value })} />
      </label>
      <label style={fieldLabel}>Contraseña
        <input style={input} type="password" autoComplete="current-password" value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })} />
      </label>
      <button style={{ ...btnPrimary, ...disabled(enviando) }} disabled={enviando} type="submit">
        {enviando ? "Ingresando…" : "Ingresar"}
      </button>
      {error && <p style={errorText}>{error}</p>}
      <p style={{ ...muted, fontSize: 12, marginBottom: 0 }}>¿Olvidaste tu contraseña? Pídele al administrador que la restablezca.</p>
    </form>
  );
}

// Se muestra una sola vez, mientras no exista ningún administrador
function ConfiguracionInicial({ onListo }) {
  const [form, setForm] = useState({ codigo: "", nombre: "", usuario: "", password: "", confirmar: "" });
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const crear = async (e) => {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirmar) { setError("Las contraseñas no coinciden."); return; }
    setEnviando(true);
    try {
      await llamarUsuarios("crear_admin_inicial", {
        codigo: form.codigo.trim().toUpperCase(), nombre: form.nombre, usuario: form.usuario.trim().toLowerCase(), password: form.password,
      });
      const { error: err } = await supabase.auth.signInWithPassword({ email: usuarioAEmail(form.usuario), password: form.password });
      if (err) throw err;
      onListo();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form style={card} onSubmit={crear}>
      <h2 style={{ marginTop: 0 }}>Configuración inicial</h2>
      <p style={{ ...muted, marginTop: -8 }}>
        Crea la cuenta del administrador. Necesitas el código de configuración inicial (está en el archivo
        <b> CONFIGURACION-INICIAL.txt</b> que se te entregó). Este paso solo se hace una vez.
      </p>
      <label style={fieldLabel}>Código de configuración inicial
        <input style={input} autoCapitalize="none" value={form.codigo} onChange={set("codigo")} />
      </label>
      <label style={fieldLabel}>Nombre completo
        <input style={{ ...input, textTransform: "uppercase" }} value={form.nombre} onChange={set("nombre")} />
      </label>
      <label style={fieldLabel}>Usuario (para iniciar sesión)
        <input style={input} autoCapitalize="none" autoComplete="username" value={form.usuario} onChange={set("usuario")} placeholder="ej. admin" />
      </label>
      <label style={fieldLabel}>Contraseña (mínimo 8 caracteres)
        <input style={input} type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
      </label>
      <label style={fieldLabel}>Confirmar contraseña
        <input style={input} type="password" autoComplete="new-password" value={form.confirmar} onChange={set("confirmar")} />
      </label>
      <button style={{ ...btnPrimary, ...disabled(enviando) }} disabled={enviando} type="submit">
        {enviando ? "Creando…" : "Crear administrador"}
      </button>
      {error && <p style={errorText}>{error}</p>}
    </form>
  );
}
