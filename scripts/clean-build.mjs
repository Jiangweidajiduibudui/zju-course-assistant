import { rmSync } from "node:fs";

// This is exclusively generated output, never user data or source.
rmSync(new URL("../.local/server-build/", import.meta.url), {
  recursive: true,
  force: true,
});
