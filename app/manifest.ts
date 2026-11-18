import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "북맵 · 필름으로 남기는 기행",
    short_name: "북맵",
    description: "24컷 필름으로 기행을 기록하고, 함께 현상해서 보는 학교 기행 앱",
    lang: "ko",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0e0d0b",
    theme_color: "#0e0d0b",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
