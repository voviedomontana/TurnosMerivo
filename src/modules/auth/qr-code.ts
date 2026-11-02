// Supabase can return SVG data URLs containing raw XML and trailing newlines.
// Encode the payload so next/image's development checks and URL parsing agree.
export function mfaQrImageSource(qr: string): string {
  let svg = qr.trim();
  if (svg.startsWith("data:image/svg+xml")) {
    const separator = svg.indexOf(",");
    if (separator < 0) throw new Error("Invalid MFA QR image format");
    const header = svg.slice(0, separator);
    const payload = svg.slice(separator + 1);
    if (header.includes(";base64")) {
      return `data:image/svg+xml;base64,${payload.replace(/\s/g, "")}`;
    }
    try {
      svg = decodeURIComponent(payload);
    } catch {
      svg = payload;
    }
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
}
