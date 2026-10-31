import { execSync } from "node:child_process";
const out = new URL("../release/", import.meta.url).pathname;
execSync(`mkdir -p ${out} && cd ${new URL("../dist/", import.meta.url).pathname} && zip -qr ${out}selio-extension.zip .`);
console.info("Archive : apps/extension/release/selio-extension.zip");
