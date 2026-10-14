import { useState } from "react";
import { mensajeError, supabase } from "../lib/supabase.js";
import { btnGhost, btnPrimary, card, disabled, errorText, fieldLabel, input, okText } from "../styles.js";

export default function CambiarPassword({ onCerrar }) {
  const [form, setForm] = useState({ password: "", confirmar: "" });
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const guardar = async (e) => {
    e.preventDefault();
    setError("");
    if (form.password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres."); return; }
    if (form.password !== form.confirmar) { setError("Las contraseñas no coinciden."); return; }
    setEnviando(true);
    const { error: err } = await supabase.auth.updateUser({ password: form.password });
    setEnviando(false);
    if (err) setError(/different from the old/i.test(err.message) ? "La nueva contraseña debe ser distinta a la actual." : mensajeError(err));
    else { setOk(true); setForm({ password: "", confirmar: "" }); }
  };

  return (
    <form style={{ ...card, border: "2px solid #c8622f" }} onSubmit={guardar}>
      <h3 style={{ marginTop: 0 }}>Cambiar mi contraseña</h3>
      <label style={fieldLabel}>Nueva contraseña (mínimo 8 caracteres)
        <input style={input} type="password" autoComplete="new-password" value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })} />
      </label>
      <label style={fieldLabel}>Confirmar contraseña
        <input style={input} type="password" autoComplete="new-password" value={form.confirmar}
          onChange={(e) => setForm({ ...form, confirmar: e.target.value })} />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={{ ...btnPrimary, ...disabled(enviando) }} disabled={enviando} type="submit">Guardar</button>
        <button style={btnGhost} type="button" onClick={onCerrar}>Cerrar</button>
      </div>
      {error && <p style={errorText}>{error}</p>}
      {ok && <p style={okText}>Contraseña actualizada.</p>}
    </form>
  );
}
