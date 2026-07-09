import demoCatalogJson from "../../../../docs/fixtures/demo-catalog.synthetic.json";
import { type Catalog, catalogSchema } from "../../../shared/contracts/index.js";

const demoCatalog = catalogSchema.parse(demoCatalogJson);

export function getSyntheticDemoCatalog(): Catalog {
  return demoCatalog;
}
