/**
 * Copy the shared form model to the phone app (it can't import web code).
 * The drift test in src/shared/forms/__tests__ fails until this is run.
 */
import { copyFileSync } from "node:fs";
import { join } from "node:path";

const src = join(import.meta.dir, "../src/shared/forms/form-model.ts");
const dst = join(import.meta.dir, "../../mobile/lib/forms/form-model.ts");
copyFileSync(src, dst);
console.log(`synced ${dst}`);
