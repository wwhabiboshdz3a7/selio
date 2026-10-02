import type { Config } from "@netlify/functions";
import * as XLSX from "xlsx";
import { supabaseAdmin } from "./_shared/supabase";
import { requireUser } from "./_shared/auth";

function toEuros(cents: number | null | undefined): number {
  return Math.round(((cents ?? 0) / 100) * 100) / 100;
}

export default async (request: Request): Promise<Response> => {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const db = supabaseAdmin();

  const { data: sales } = await db
    .from("sales")
    .select("*")
    .eq("seller_id", auth.user.id)
    .order("sold_at", { ascending: true });

  const { data: wardrobe } = await db
    .from("wardrobe_items")
    .select("*")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: true });

  const salesRows = (sales ?? []).map((s) => {
    const margin = toEuros(s.sale_price_cents) - toEuros(s.platform_fee_cents) - toEuros(s.shipping_cost_cents) - toEuros(s.purchase_price_cents);
    return {
      Date: new Date(s.sold_at).toLocaleDateString("fr-FR"),
      Article: s.title,
      "Prix de vente (€)": toEuros(s.sale_price_cents),
      "Frais plateforme (€)": toEuros(s.platform_fee_cents),
      "Frais de port (€)": toEuros(s.shipping_cost_cents),
      "Prix d'achat (€)": toEuros(s.purchase_price_cents),
      "Marge nette (€)": Math.round(margin * 100) / 100,
      Acheteur: s.buyer_username ?? "",
    };
  });

  const wardrobeRows = (wardrobe ?? []).map((w) => ({
    Article: w.title,
    Marque: w.brand ?? "",
    Categorie: w.category ?? "",
    "Prix d'achat (€)": toEuros(w.purchase_price_cents),
    "Date d'achat": w.purchase_date ?? "",
    Statut: w.status,
  }));

  const totalVentes = salesRows.reduce((sum, r) => sum + r["Prix de vente (€)"], 0);
  const totalMarge = salesRows.reduce((sum, r) => sum + r["Marge nette (€)"], 0);
  const totalAchats = wardrobeRows.reduce((sum, r) => sum + r["Prix d'achat (€)"], 0);

  const summaryRows = [
    { Indicateur: "Nombre de ventes", Valeur: salesRows.length },
    { Indicateur: "Total des ventes (€)", Valeur: Math.round(totalVentes * 100) / 100 },
    { Indicateur: "Total des marges nettes (€)", Valeur: Math.round(totalMarge * 100) / 100 },
    { Indicateur: "Total des achats stock (€)", Valeur: Math.round(totalAchats * 100) / 100 },
    { Indicateur: "Articles en stock", Valeur: wardrobeRows.filter((r) => r["Statut" as never] === "in_stock").length },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "Resume");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(salesRows), "Ventes");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(wardrobeRows), "Dressing-Stock");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="selio-comptabilite-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
};

export const config: Config = { path: "/api/pro/sales/export" };
