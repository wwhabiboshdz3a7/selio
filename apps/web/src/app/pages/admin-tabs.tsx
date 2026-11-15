/**
 * Ancien bandeau d'onglets de l'administration. La navigation de Selio Admin vit désormais dans sa propre
 * barre latérale (pages/admin/AdminLayout.tsx, sections selon le rôle d'opérateur) : ce composant ne rend plus
 * rien et reste exporté le temps que les pages qui l'importent encore le retirent.
 * @deprecated Retirer `<AdminTabs />` des pages : la barre latérale de Selio Admin le remplace.
 */
export function AdminTabs() {
  return null;
}
