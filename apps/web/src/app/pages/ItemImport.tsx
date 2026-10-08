import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { FileUp } from "lucide-react";
import { previewInventoryImport, toCsv, EXPORT_HEADERS, type ImportPreview } from "@selio/domain";
import { Alert, Button, Card, PageHeader, Table, TableWrap, Td, Th, Tr, formatNumber } from "@selio/ui";
import { useClient } from "../../lib/data/provider";
import { downloadFile } from "../../lib/download";
import { useAppMutation } from "../components/hooks";

const TEMPLATE = toCsv([EXPORT_HEADERS, ["Veste en jean Levi's", "", "Levi's", "M", "men", "very_good", "in_stock", "12,50", "2,00", "35,00", "28,00", "vintage|lot possible", "2026-09-15", "Veste portée deux fois"]]);

export default function ItemImport() {
  const client = useClient();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const importMut = useAppMutation(() => client.importItems(preview!.rows.filter((r) => r.item).map((r) => r.item!)), { invalidate: ["items", "overview"], success: (r) => `${r.created} article(s) importé(s)`, onSuccess: () => navigate("/app/items") });

  const onFile = async (file: File | null) => {
    setParseError(null);
    setPreview(null);
    if (!file) return;
    if (file.size > 5_000_000) { setParseError("Fichier trop volumineux (5 Mo max)."); return; }
    setFileName(file.name);
    try {
      const text = await file.text();
      setPreview(previewInventoryImport(text));
    } catch {
      setParseError("Impossible de lire ce fichier.");
    }
  };

  return (
    <>
      <PageHeader title="Importer des articles" eyebrow={<Link to="/app/items" className="hover:text-text">Articles et stock</Link>} description="Fichier CSV (séparateur ; ou ,), en-têtes en français ou en anglais. Chaque ligne est vérifiée avant l'import : rien n'est enregistré tant que vous ne confirmez pas." actions={<Button variant="secondary" onClick={() => downloadFile("selio-modele-import.csv", TEMPLATE)}>Télécharger le modèle</Button>} />
      <Card>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong px-4 py-10 text-center text-sm text-text-muted hover:bg-surface-muted">
          <FileUp className="size-6" aria-hidden />
          <span className="font-medium text-text">{fileName ?? "Choisir un fichier CSV"}</span>
          <span>Colonnes reconnues : Titre, SKU, Marque, Taille, Catégorie, État, Statut, Prix d'achat, Frais, Prix affiché, Prix plancher, Tags, Date d'achat, Description.</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
        </label>
        {parseError ? <Alert tone="danger" className="mt-4">{parseError}</Alert> : null}
      </Card>
      {preview ? (
        <div className="mt-6 flex flex-col gap-4">
          <Alert tone={preview.errorCount > 0 ? "warning" : "success"} title={`${formatNumber(preview.validCount)} ligne(s) valide(s), ${formatNumber(preview.errorCount)} en erreur`}>
            {preview.errorCount > 0 ? "Les lignes en erreur seront ignorées. Corrigez le fichier pour les inclure." : "Toutes les lignes peuvent être importées."}
          </Alert>
          <TableWrap>
            <Table dense>
              <thead><tr><Th>Ligne</Th><Th>Titre</Th><Th>Marque</Th><Th numeric>Achat</Th><Th numeric>Affiché</Th><Th>Statut</Th><Th>Problèmes</Th></tr></thead>
              <tbody>
                {preview.rows.slice(0, 200).map((r) => (
                  <Tr key={r.line} className={r.errors.length ? "bg-surface-muted" : undefined}>
                    <Td className="num">{r.line}</Td>
                    <Td>{r.item?.title ?? <span className="text-text-muted">—</span>}</Td>
                    <Td>{r.item?.brand ?? ""}</Td>
                    <Td numeric>{r.item ? ((r.item.purchasePriceCents ?? 0) / 100).toFixed(2).replace(".", ",") : ""}</Td>
                    <Td numeric>{r.item?.listedPriceCents != null ? (r.item.listedPriceCents / 100).toFixed(2).replace(".", ",") : ""}</Td>
                    <Td>{r.item?.status ?? ""}</Td>
                    <Td>
                      {r.errors.map((e, i) => <span key={i} className="block text-xs text-danger">{e}</span>)}
                      {r.warnings.map((w, i) => <span key={i} className="block text-xs text-warning">{w}</span>)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          {preview.rows.length > 200 ? <p className="text-xs text-text-muted">Aperçu limité aux 200 premières lignes ; toutes les lignes valides seront importées.</p> : null}
          <div className="flex justify-end gap-2">
            <Link to="/app/items"><Button variant="ghost">Annuler</Button></Link>
            <Button onClick={() => importMut.mutate()} loading={importMut.isPending} disabled={preview.validCount === 0}>Importer {formatNumber(preview.validCount)} article(s)</Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
