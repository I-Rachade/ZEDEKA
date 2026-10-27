import { ImageResponse } from "next/og";

// Icône de l'application installée : le « Z » de Zedeka sur fond vert, dans la zone sûre des icônes adaptatives.

const SIZES = [192, 512];

export function generateStaticParams() {
  return SIZES.map((size) => ({ size: String(size) }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size: raw } = await params;
  const size = SIZES.includes(Number(raw)) ? Number(raw) : 192;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#059669" }}>
        <span style={{ color: "white", fontSize: size * 0.5, fontWeight: 800, fontFamily: "sans-serif", lineHeight: 1 }}>Z</span>
      </div>
    ),
    { width: size, height: size },
  );
}
