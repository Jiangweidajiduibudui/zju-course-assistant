import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { initialPlans, originalSnapshot } from "../fixtures/ui/catalog.js";
import { Store } from "../src/server/storage/store.js";

process.umask(0o077);
process.env.ZJU_DATA_DIR ??= join(
  homedir(),
  ".local",
  "share",
  "zju-course-assistant",
  "demo",
);
const store = new Store(
  join(resolve(process.env.ZJU_DATA_DIR), "workspace.sqlite3"),
);
try {
  if (store.snapshots().length === 0)
    store.transaction(() => {
      store.insertSnapshot(originalSnapshot);
      for (const plan of initialPlans) store.insertPlan(plan);
    });
} finally {
  store.close();
}
console.log("Synthetic demo workspace");
await import("./start-server.js");
