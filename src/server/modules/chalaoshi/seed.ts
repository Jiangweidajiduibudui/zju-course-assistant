import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type ChalaoshiSeed, chalaoshiSeedSchema } from "../../../shared/contracts/chalaoshi.js";

/**
 * 合成 seed cache 降级（组员 B；D41）。
 *
 * 抓取失败、网络受限或缓存为空时，Demo 降级到仓库内合成 seed；
 * 返回数据的 cacheState 一律为 "seed"，UI 必须显式标记"演示数据"。
 * 铁律：seed 文件必须 synthetic:true；真实评论永不入库（Task 3 门禁）。
 */
const SEED_URL = new URL("../../../../docs/fixtures/demo-chalaoshi.synthetic.json", import.meta.url);

let cached: ChalaoshiSeed | null = null;

export async function loadSeed(): Promise<ChalaoshiSeed> {
  if (cached) return cached;
  const text = await readFile(fileURLToPath(SEED_URL), "utf8");
  cached = chalaoshiSeedSchema.parse(JSON.parse(text));
  return cached;
}
