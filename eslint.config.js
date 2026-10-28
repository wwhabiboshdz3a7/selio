import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/dev-dist/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/*.gen.ts",
      "apps/web/public/**",
      ".claude/**",
      "livraison/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.es2022 },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      "no-irregular-whitespace": ["error", { skipStrings: true, skipRegExps: true, skipTemplates: true, skipComments: true }],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}", "apps/extension/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Un effet ne doit renvoyer qu'une fonction de nettoyage (ou rien) : React appelle la valeur
      // renvoyée au démontage. Un corps expression (`useEffect(() => window.scrollTo(…))`) renvoie
      // la valeur de l'appel — une promesse dans les navigateurs récents → « S is not a function ».
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name=/^use(Layout|Insertion)?Effect$/] > ArrowFunctionExpression:first-child[body.type!='BlockStatement'][body.type!='ArrowFunctionExpression'][body.type!='FunctionExpression']",
          message: "Effet : utilisez un corps en bloc `() => { … }` ; seule une fonction de nettoyage peut être renvoyée.",
        },
        {
          selector: "CallExpression[callee.property.name=/^use(Layout|Insertion)?Effect$/] > ArrowFunctionExpression:first-child[body.type!='BlockStatement'][body.type!='ArrowFunctionExpression'][body.type!='FunctionExpression']",
          message: "Effet : utilisez un corps en bloc `() => { … }` ; seule une fonction de nettoyage peut être renvoyée.",
        },
      ],
    },
  },
  {
    files: ["apps/extension/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.webextensions } },
  },
  {
    files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "**/e2e/**", "**/scripts/**"],
    rules: { "no-console": "off" },
  },
);
