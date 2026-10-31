/**
 * Masque une adresse pour les journaux : `ibrahim@exemple.fr` → `i***@exemple.fr`.
 * Le domaine reste lisible (diagnostic de remise), la partie locale non.
 */
export function maskEmail(address: string): string {
  const at = address.indexOf("@");
  if (at <= 0 || at === address.length - 1) return "***";
  return `${address[0]}***@${address.slice(at + 1)}`;
}
