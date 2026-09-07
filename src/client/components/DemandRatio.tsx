import type { SectionData } from "../../shared/contracts/catalog.js";

// Descriptive arithmetic only. Never an admission estimate or a rule check.
export function demandRatio(section: SectionData): string {
  const remaining = section.quotas.overall.remaining;
  const applicants = section.pending.all;
  if (remaining.state !== "known") return "未知";
  if (remaining.value === 0) return "无余量";
  if (applicants.state !== "known") return "未知";
  return `${(applicants.value / remaining.value).toFixed(2)} : 1`;
}

export function DemandRatio({ section }: { section: SectionData }) {
  return (
    <div className="demand-ratio">
      <div>
        <span>报录比</span>
        <strong>
          {demandRatio(section) === "未知" ? "—" : demandRatio(section)}
        </strong>
      </div>
    </div>
  );
}
