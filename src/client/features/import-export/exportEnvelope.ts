import {
  type ExportEnvelope,
  exportEnvelopeSchema,
  type Session,
} from "../../../shared/contracts/index.js";

interface BuildExportEnvelopeOptions {
  exportedAt?: Date | string;
}

function normalizeExportedAt(exportedAt: Date | string | undefined): string {
  if (exportedAt instanceof Date) {
    return exportedAt.toISOString();
  }
  return exportedAt ?? new Date().toISOString();
}

export function buildExportEnvelope(
  session: Session,
  options: BuildExportEnvelopeOptions = {},
): ExportEnvelope {
  return exportEnvelopeSchema.parse({
    schemaVersion: "export.v1",
    exportedAt: normalizeExportedAt(options.exportedAt),
    session,
  });
}

export function formatExportEnvelopePreview(envelope: ExportEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}
