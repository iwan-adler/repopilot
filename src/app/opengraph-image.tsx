import { ImageResponse } from "next/og";
import { OG_SIZE, SiteOgCard } from "@/lib/og/og-card";

export const alt = "RepoPilot — understand your repository's health in minutes";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(<SiteOgCard />, size);
}
