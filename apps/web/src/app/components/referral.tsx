import { Field, Input } from "@selio/ui";

/**
 * Champ « Code de parrainage » du formulaire d'inscription (facultatif, jamais bloquant), utilisé par
 * marketing/pages/Register.tsx (vitrine) : valeur initiale `referralCodeFromSearch(location.search)`, puis
 * `referralCode: referralCodeForSignup(valeur)` dans l'appel à `client.register` (lib/referral.ts) ; la
 * réponse du serveur (`referral.message`) s'affiche à l'arrivée sur la page Démarrage.
 */
export function ReferralCodeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Code de parrainage" hint="Facultatif. Un code inconnu est simplement ignoré : il n'empêche pas l'inscription.">
      {(p) => (
        <Input
          id={p.id}
          aria-describedby={p.describedBy}
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          placeholder="ex. AB3K7Q"
          className="num tracking-[0.15em]"
          name="referralCode"
        />
      )}
    </Field>
  );
}
