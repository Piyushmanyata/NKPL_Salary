import {
  calculateEmployeeAttendanceStats,
  findUniqueMatch,
  namesMatch,
  normalizeKey,
  resolveDay,
} from "./attendance";
import type {
  AttendanceEmployee,
  AttendanceMetaV1,
  EmployeeInput,
} from "./types";

export type ConflictKind =
  | "sheet-present-no-punch"
  | "sheet-present-short-stay"
  | "punched-sheet-absent"
  | "double-no-corroboration"
  | "missing-biometric"
  | "unmapped-biometric";

export type Conflict = {
  kind: ConflictKind;
  employeeId: string;
  name: string;
  day?: number;
  sheet?: string;
  punches?: string[];
};

function dayIndex(dateString: string): number {
  const parts = dateString.split(/[\/\.-]/);
  return Number(parts[parts.length - 1]) || 0;
}

/**
 * Join manual + biometric onto the roster hub (SPEC §5).
 * Biometric joins only via meta.map[deviceId]; manual via findUniqueMatch.
 */
export function reconcile(args: {
  manual: AttendanceEmployee[] | null;
  biometric: AttendanceEmployee[] | null;
  roster: EmployeeInput[];
  meta: AttendanceMetaV1;
  monthLabel: string;
}): { employees: AttendanceEmployee[]; conflicts: Conflict[] } {
  const excluded = new Set((args.meta.excluded || []).map((k) => normalizeKey(k)));
  const conflicts: Conflict[] = [];

  const manualAll = (args.manual || []).filter(
    (e) => !excluded.has(normalizeKey(e.name))
  );
  const bioAll = (args.biometric || []).filter(
    (e) => !excluded.has(normalizeKey(e.name))
  );

  // Map biometric device id → biometric employee (after exclusion)
  const bioByDevice = new Map<string, AttendanceEmployee>();
  for (const b of bioAll) {
    const deviceId = b.biometricId || b.id;
    bioByDevice.set(deviceId, b);
  }

  // Reverse: roster id → biometric emp via meta.map
  const bioByRosterId = new Map<string, AttendanceEmployee>();
  const mappedDeviceIds = new Set<string>();
  for (const [deviceId, rosterId] of Object.entries(args.meta.map || {})) {
    const bio = bioByDevice.get(deviceId);
    if (bio) {
      bioByRosterId.set(rosterId, bio);
      mappedDeviceIds.add(deviceId);
    }
  }

  // unmapped-biometric: device rows not in meta.map
  for (const b of bioAll) {
    const deviceId = b.biometricId || b.id;
    if (!mappedDeviceIds.has(deviceId) && !(args.meta.map || {})[deviceId]) {
      conflicts.push({
        kind: "unmapped-biometric",
        employeeId: deviceId,
        name: b.name,
      });
    }
  }

  const hasManual = manualAll.length > 0;
  const hasBio = bioAll.length > 0;
  const employees: AttendanceEmployee[] = [];
  const seenRosterIds = new Set<string>();

  // Prefer iterating manual (presence authority); fall back to bio-only (R4)
  const sourceList = hasManual ? manualAll : bioAll;

  for (const src of sourceList) {
    // Prefer exact roster id / exact key, then unique fuzzy (A12).
    const byId = args.roster.find((r) => r.id === src.id);
    const byKey = args.roster.find(
      (r) => normalizeKey(r.name) === normalizeKey(src.name)
    );
    const rosterMatch = byId ?? byKey ?? findUniqueMatch(args.roster, src.name);
    const rosterId = rosterMatch?.id ?? src.id;
    const rosterName = rosterMatch?.name ?? src.name;
    seenRosterIds.add(rosterId);

    // Find biometric pair: by meta.map only (SPEC §5.1)
    let bio: AttendanceEmployee | undefined = bioByRosterId.get(rosterId);
    // Also try direct device id if src is already biometric-only
    if (!bio && !hasManual) {
      bio = src;
    }

    if (hasManual && hasBio && !bio) {
      conflicts.push({
        kind: "missing-biometric",
        employeeId: rosterId,
        name: rosterName,
      });
    }

    const D = Math.max(
      src.daysDetail.length,
      bio?.daysDetail.length ?? 0
    );

    const daysDetail: AttendanceEmployee["daysDetail"] = [];
    for (let i = 0; i < D; i++) {
      const manDay = src.daysDetail[i];
      const bioDay = bio?.daysDetail[i];
      const punches = bioDay?.punchTimes ?? (hasManual ? [] : manDay?.punchTimes ?? []);
      const sheetMark =
        src.sheetMarks?.[i] ??
        (manDay?.isDoubleShift ? "2" : manDay?.isPresent ? "1" : hasManual ? "0" : "-");

      const decisions = manDay?.decisions ?? "";
      const { present, doubleShift } = resolveDay({
        sheetMark: hasManual ? sheetMark : "-",
        punches,
        decisions,
        hasManualSheet: hasManual,
      });

      const duration = bioDay?.duration ?? manDay?.duration ?? 0;
      const isShortStay = bioDay?.isShortStay ?? (punches.length > 0 && duration < 5);
      const ambiguousSpan = bioDay?.ambiguousSpan;

      daysDetail.push({
        dateString:
          manDay?.dateString ||
          bioDay?.dateString ||
          `day-${i + 1}`,
        dayOfWeek: manDay?.dayOfWeek ?? bioDay?.dayOfWeek ?? 0,
        isPresent: present,
        duration,
        punchTimes: punches,
        isShortStay,
        ambiguousSpan,
        isDoubleShift: doubleShift,
        shift: bioDay?.shift ?? manDay?.shift,
        manualOverride: manDay?.manualOverride,
        leaveType: manDay?.leaveType,
        decisions: manDay?.decisions,
      });

      // Day-level conflicts only when both sources present for this person
      if (hasManual && bio) {
        const dayNum = dayIndex(daysDetail[i].dateString) || i + 1;
        if (present && punches.length === 0) {
          conflicts.push({
            kind: "sheet-present-no-punch",
            employeeId: rosterId,
            name: rosterName,
            day: dayNum,
            sheet: sheetMark,
            punches,
          });
        } else if (present && isShortStay) {
          conflicts.push({
            kind: "sheet-present-short-stay",
            employeeId: rosterId,
            name: rosterName,
            day: dayNum,
            sheet: sheetMark,
            punches,
          });
        } else if (!present && punches.length > 0) {
          conflicts.push({
            kind: "punched-sheet-absent",
            employeeId: rosterId,
            name: rosterName,
            day: dayNum,
            sheet: sheetMark,
            punches,
          });
        }
        if (doubleShift) {
          const span = duration;
          if (punches.length === 0 || span < 16) {
            conflicts.push({
              kind: "double-no-corroboration",
              employeeId: rosterId,
              name: rosterName,
              day: dayNum,
              sheet: sheetMark,
              punches,
            });
          }
        }
      }
    }

    const isSecurity =
      rosterMatch?.isSecurity === true || src.isSecurity || bio?.isSecurity || false;
    const stats = calculateEmployeeAttendanceStats(daysDetail, isSecurity);

    employees.push({
      id: rosterId,
      name: rosterName,
      department: src.department || bio?.department || "",
      isSecurity,
      biometricId: bio?.biometricId || bio?.id,
      sheetMarks: src.sheetMarks,
      daysDetail,
      ...stats,
    });
  }

  // Biometric-only people already handled when !hasManual.
  // When hasManual, unmapped bios are conflict-only (not employees unless mapped).

  // Roster people with manual missing but... skip — we only surface attendance sources.

  return { employees, conflicts };
}

/**
 * Suggest roster mapping for unmapped biometric rows using namesMatch (suggestions only).
 */
export function suggestMapping(
  biometric: AttendanceEmployee[],
  roster: EmployeeInput[],
  meta: AttendanceMetaV1
): Array<{
  biometricId: string;
  biometricName: string;
  suggestedRosterId: string | null;
}> {
  const mapped = new Set(Object.keys(meta.map || {}));
  return biometric
    .filter((b) => {
      const id = b.biometricId || b.id;
      return !mapped.has(id);
    })
    .map((b) => {
      const id = b.biometricId || b.id;
      const unique = findUniqueMatch(roster, b.name);
      // If not unique, still suggest best single namesMatch if exactly one
      let suggested: string | null = unique?.id ?? null;
      if (!suggested) {
        const hits = roster.filter((r) => namesMatch(r.name, b.name));
        if (hits.length === 1) suggested = hits[0].id;
      }
      return {
        biometricId: id,
        biometricName: b.name,
        suggestedRosterId: suggested,
      };
    });
}

/** Build a meta.map from unique name matches (test / first-time bootstrap only). */
export function bootstrapMapFromNames(
  biometric: AttendanceEmployee[],
  roster: EmployeeInput[]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const b of biometric) {
    const deviceId = b.biometricId || b.id;
    const match = findUniqueMatch(roster, b.name);
    if (match) map[deviceId] = match.id;
  }
  return map;
}
