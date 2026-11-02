import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { BrandLogo } from "@/components/brand-logo";
import { PublicManage } from "@/components/public-booking/manage";
import { isBusinessSlug } from "@/modules/businesses/schemas";
export const metadata: Metadata = {
  title: "Gestionar mi turno | Merivo",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function ManagePage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  if (!isBusinessSlug(slug) || !z.uuid().safeParse(id).success) notFound();
  return (
    <div className="product-shell">
      <header className="product-header">
        <BrandLogo href={`/b/${slug}`} />
      </header>
      <main className="product-main">
        <PublicManage key={`${slug}:${id}`} slug={slug} id={id} />
      </main>
    </div>
  );
}
