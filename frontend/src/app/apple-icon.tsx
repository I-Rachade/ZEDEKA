import { ImageResponse } from "next/og";
import { appIconDataUri, BRAND } from "@/lib/appIcon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: BRAND.green }}>
        <img src={appIconDataUri()} width={126} height={126} alt="" />
      </div>
    ),
    size,
  );
}
