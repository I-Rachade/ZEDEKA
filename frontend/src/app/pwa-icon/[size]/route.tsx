import { ImageResponse } from "next/og";
import { appIconDataUri, BRAND } from "@/lib/appIcon";

// Icône de l'application installée : le logo Zedeka (Z et traits de vitesse) sur fond vert, dans la zone sûre des icônes adaptatives.

const SIZES = [192, 512];

export function generateStaticParams() {
  return SIZES.map((size) => ({ size: String(size) }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size: raw } = await params;
  const size = SIZES.includes(Number(raw)) ? Number(raw) : 192;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: BRAND.green }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- rendu par ImageResponse */}
        <img src={appIconDataUri()} width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} alt="" />
      </div>
    ),
    { width: size, height: size },
  );
}
