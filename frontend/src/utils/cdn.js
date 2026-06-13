const DEFAULT_IMAGE_CDN_BASE = "https://cdn.dlns-stats.co.uk/public/images";

const resolveImageBase = () => {
  const windowBase =
    typeof window !== "undefined" && typeof window.DLNS_IMAGE_CDN_BASE === "string"
      ? window.DLNS_IMAGE_CDN_BASE
      : "";
  const envBase = typeof import.meta !== "undefined" ? import.meta.env?.VITE_IMAGE_CDN_BASE : "";
  const raw = (windowBase || envBase || DEFAULT_IMAGE_CDN_BASE).trim();
  return raw.replace(/\/+$/, "");
};

export const IMAGE_CDN_BASE = resolveImageBase();

export function cdnImage(path = "") {
  const cleanPath = String(path || "").replace(/^\/+/, "");
  return cleanPath ? `${IMAGE_CDN_BASE}/${cleanPath}` : IMAGE_CDN_BASE;
}

export function staticImagePathToCdn(path) {
  if (!path) return path;
  const raw = String(path).trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const withoutPrefix = raw.replace(/^\/?static\/images\/?/i, "");
  return cdnImage(withoutPrefix);
}
