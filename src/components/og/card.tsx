/** 1200×630 share card body, rendered by `next/og` (inline styles only). */
export function OgCard({ eyebrow, title, footer }: { eyebrow: string; title: string; footer: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: "#0c0c0c",
        color: "#f2f1ec",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, fontWeight: 600 }}>
        <div style={{ width: 22, height: 22, borderRadius: 11, background: "#fdda24" }} />
        Proofwork
        <div style={{ marginLeft: "auto", fontSize: 22, color: "#fdda24", border: "2px solid #fdda2455", borderRadius: 999, padding: "6px 18px" }}>
          TESTNET
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ fontSize: 26, letterSpacing: 4, color: "#8a8a86", textTransform: "uppercase" }}>{eyebrow}</div>
        <div style={{ fontSize: title.length > 60 ? 60 : 76, fontWeight: 700, lineHeight: 1.02, letterSpacing: -2 }}>{title}</div>
      </div>
      <div style={{ fontSize: 30, color: "#c9c7be" }}>{footer}</div>
    </div>
  );
}
