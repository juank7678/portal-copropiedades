export const card = { background: "#fff", borderRadius: 12, padding: 18, marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" };
export const fieldLabel = { display: "block", fontSize: 13, fontWeight: 600, color: "#4a534d", marginBottom: 10 };
export const smallLabel = { fontSize: 11, color: "#6b756f" };
export const input = { display: "block", width: "100%", marginTop: 4, padding: "9px 10px", borderRadius: 8, border: "1px solid #d7dbd5", fontSize: 14, boxSizing: "border-box", background: "#fff", color: "#1f2a24" };
export const btnPrimary = { background: "#c8622f", color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontWeight: 700, cursor: "pointer", fontSize: 14, width: "100%" };
export const btnGhost = { background: "#eef0ec", color: "#1f2a24", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 600, cursor: "pointer", fontSize: 13 };
export const btnGhostLink = { ...btnGhost, textDecoration: "none", display: "inline-block" };
export const btnDanger = { ...btnGhost, background: "#fbeae8", color: "#b3261e" };
export const muted = { fontSize: 13, color: "#6b756f" };
export const errorText = { color: "#b3261e", fontSize: 13, marginTop: 8 };
export const okText = { color: "#2e7d32", fontSize: 13, marginTop: 8 };
export const fila = { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" };

export const disabled = (cond) => (cond ? { opacity: 0.55, cursor: "not-allowed" } : null);
