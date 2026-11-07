import { useEffect, useState } from "react";
import { input } from "../styles.js";

// Campo de contraseña con ícono de ojo. Empieza oculto y vuelve a ocultarse cuando el campo queda vacío (por ejemplo, al guardar).
export default function CampoPassword({ value, onChange, autoComplete = "new-password", estilo, ...resto }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { if (!value) setVisible(false); }, [value]);
  const { marginTop = input.marginTop, ...estiloInput } = { ...input, ...estilo };

  return (
    <div style={{ position: "relative", marginTop }}>
      <input {...resto} style={{ ...estiloInput, marginTop: 0, paddingRight: 42 }} type={visible ? "text" : "password"}
        autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false}
        value={value} onChange={onChange} />
      <button type="button" aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={visible}
        title={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        onMouseDown={(e) => e.preventDefault()} onClick={() => setVisible((v) => !v)}
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 40, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", padding: 0, cursor: "pointer", color: "#6b756f" }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <line x1="4" y1="4" x2="20" y2="20" />}
        </svg>
      </button>
    </div>
  );
}
