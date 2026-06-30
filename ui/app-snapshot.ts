import type { AppOptions, BuildSnapshot, SnapshotOptions, SnapshotRef } from "./app-runtime";
import type { UiSnapshot, UiSnapshotDomain } from "./types";

import * as __cjsImport120 from "./read-model";

const { buildReadSnapshot, buildReadSnapshotDomain }: { buildReadSnapshot: (options?: SnapshotOptions) => UiSnapshot; buildReadSnapshotDomain: (domain?: UiSnapshotDomain, options?: SnapshotOptions) => Partial<UiSnapshot> | null } = __cjsImport120;
export function createSnapshotRef(options: AppOptions = {}): SnapshotRef {
  if (options.snapshot) {
    return {
      current: options.snapshot,
      refresh() {
        return options.snapshot!;
      }
    };
  }

  const hasCustomBuildSnapshot = typeof options.buildSnapshot === "function";
  const buildSnapshot: BuildSnapshot = hasCustomBuildSnapshot
    ? options.buildSnapshot!
    : () => buildReadSnapshot(options.snapshotOptions);
  const ref = {
    current: (hasCustomBuildSnapshot ? buildSnapshot() : buildReadSnapshot(options.snapshotOptions)) as UiSnapshot,
    refresh(domain?: UiSnapshotDomain) {
      if (domain === "todo" || domain === "notes" || domain === "board" || domain === "clocks") {
        const nextDomainSnapshot = hasCustomBuildSnapshot
          ? buildSnapshot(domain)
          : buildReadSnapshotDomain(domain, options.snapshotOptions);

        if (nextDomainSnapshot !== null && typeof nextDomainSnapshot === "object" && domain in nextDomainSnapshot) {
          ref.current = { ...ref.current, [domain]: nextDomainSnapshot[domain] } as UiSnapshot;
          return ref.current;
        }
      }

      ref.current = buildSnapshot() as UiSnapshot;
      return ref.current;
    }
  };

  return ref;
}

export default {
  createSnapshotRef
};
