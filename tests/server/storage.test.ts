import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { Store } from "../../src/server/storage/store.js";

it("backs up existing databases before migration and preserves prior data", () => {
  const directory = mkdtempSync(join(tmpdir(), "zju-migration-"));
  const file = join(directory, "workspace.sqlite3");
  try {
    const old = new Database(file);
    old.exec(
      "CREATE TABLE retained(note TEXT); INSERT INTO retained VALUES('preserve');",
    );
    old.close();
    const store = new Store(file);
    expect(store.db.pragma("user_version", { simple: true })).toBe(1);
    expect(store.db.prepare("SELECT note FROM retained").get()).toEqual({
      note: "preserve",
    });
    store.close();
    const backupName = readdirSync(directory).find((name) =>
      name.endsWith(".bak"),
    );
    if (!backupName) throw new Error("Migration backup missing");
    const backup = new Database(join(directory, backupName), {
      readonly: true,
    });
    expect(backup.pragma("user_version", { simple: true })).toBe(0);
    expect(backup.prepare("SELECT note FROM retained").get()).toEqual({
      note: "preserve",
    });
    backup.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it("rejects a newer schema without migrating or clearing its contents", () => {
  const directory = mkdtempSync(join(tmpdir(), "zju-future-schema-"));
  const file = join(directory, "workspace.sqlite3");
  try {
    const old = new Database(file);
    old.exec(
      "CREATE TABLE retained(note TEXT); INSERT INTO retained VALUES('future'); PRAGMA user_version=99;",
    );
    old.close();
    expect(() => new Store(file)).toThrow(/newer/);
    const unchanged = new Database(file, { readonly: true });
    expect(unchanged.pragma("user_version", { simple: true })).toBe(99);
    expect(unchanged.prepare("SELECT note FROM retained").get()).toEqual({
      note: "future",
    });
    unchanged.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
