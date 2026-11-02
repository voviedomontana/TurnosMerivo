import { afterEach, describe, expect, it, vi } from "vitest";
import { getImageProps } from "next/image";
import { mfaQrImageSource } from "@/modules/auth/qr-code";

const svg =
  '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#000" width="100%"/></svg>\n';
afterEach(() => vi.unstubAllEnvs());
describe("MFA QR rendering", () => {
  it("reproduces Next development rejection of the raw Supabase URL", () => {
    vi.stubEnv("NODE_ENV", "development");
    // Synthetic fixture only: never include a real MFA setup secret in failures.
    expect(() =>
      getImageProps({
        src: `data:image/svg+xml;utf-8,${svg}`,
        width: 224,
        height: 224,
        alt: "Test",
        unoptimized: true,
      }),
    ).toThrow(/control character/);
  });
  it.each([
    svg,
    `data:image/svg+xml;utf-8,${svg}`,
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  ])(
    "renders encoded XML without exposing whitespace or fragment delimiters",
    (input) => {
      vi.stubEnv("NODE_ENV", "development");
      const source = mfaQrImageSource(input);
      expect(source).not.toMatch(/[\s<>#]/);
      expect(decodeURIComponent(source.slice(source.indexOf(",") + 1))).toBe(
        svg.trim(),
      );
      expect(() =>
        getImageProps({
          src: source,
          width: 224,
          height: 224,
          alt: "Test",
          unoptimized: true,
        }),
      ).not.toThrow();
    },
  );
  it("preserves base64 SVG payloads", () => {
    expect(mfaQrImageSource("data:image/svg+xml;base64,PHN2Zy8+\n")).toBe(
      "data:image/svg+xml;base64,PHN2Zy8+",
    );
  });
});
