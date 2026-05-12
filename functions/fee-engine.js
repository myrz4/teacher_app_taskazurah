const DEFAULT_FEE_POLICY = Object.freeze({
  policyVersion: "TASKA_ZURAH_2026",
  activeBillingModel: "TASKA_ZURAH_AGE_BASED",
  currency: "MYR",
  supportedAgeMinMonths: 0,
  supportedAgeMaxMonthsExclusive: 60,
  ageBands: {
    BABY_TO_2: {
      key: "BABY_TO_2",
      codeSuffix: "BABY_TO_2",
      label: "Baby to below 2 years",
      minMonths: 0,
      maxMonthsExclusive: 24,
      monthlyFeeCode: "monthly_fee_baby_to_2",
      monthlyFeeSen: 75000,
    },
    AGE_2_TO_3: {
      key: "AGE_2_TO_3",
      codeSuffix: "AGE_2_TO_3",
      label: "2 years to below 4 years",
      minMonths: 24,
      maxMonthsExclusive: 48,
      monthlyFeeCode: "monthly_fee_age_2_to_3",
      monthlyFeeSen: 70000,
    },
    AGE_4: {
      key: "AGE_4",
      codeSuffix: "AGE_4",
      label: "4 years to below 5 years",
      minMonths: 48,
      maxMonthsExclusive: 60,
      monthlyFeeCode: "monthly_fee_age_4",
      monthlyFeeSen: 65000,
    },
  },
  registration: {
    code: "registration_fee",
    label: "Registration Fee",
    unit: "oneoff",
    amountSen: 10000,
    policyKey: "taska_zurah.registration_fee",
  },
  insurance: {
    code: "insurance_takaful",
    label: "Insurance / Takaful",
    unit: "oneoff",
    amountSen: 1500,
    policyKey: "taska_zurah.insurance_takaful",
  },
  yearlyMaintenance: {
    code: "yearly_maintenance_fee",
    label: "Yearly Maintenance Fee",
    unit: "year",
    amountSen: 40000,
    januaryChargeMonth: 1,
    carryForwardRegistrationMonths: [11, 12],
    policyKey: "taska_zurah.yearly_maintenance_fee",
  },
  invoiceSchedule: {
    generationDay: 21,
    dueDay: 7,
  },
  overtimeCycle: {
    startDay: 21,
    endDay: 20,
    policyKey: "taska_zurah.overtime_cycle",
  },
  operatingHours: {
    weekday: {
      dayKeys: [1, 2, 3, 4, 5],
      label: "Weekday",
      openingMinute: 7 * 60,
      closingMinute: 19 * 60,
      overtimeHalfHourRateCode: "overtime_weekday_half_hour",
      overtimeHalfHourRateSen: 500,
    },
    saturday: {
      dayKeys: [6],
      label: "Saturday",
      openingMinute: 7 * 60,
      closingMinute: (14 * 60) + 30,
      overtimeHalfHourRateCode: "overtime_saturday_half_hour",
      overtimeHalfHourRateSen: 600,
    },
    sunday: {
      dayKeys: [0],
      label: "Sunday",
      closed: true,
    },
  },
  casualTransit: {
    policyKey: "casual_transit.separate",
    table: {
      transit_1hour: { staff: 350, nonstaff: 400 },
      transit_1day: { staff: 1500, nonstaff: 2000 },
      transit_1week: { staff: 7000, nonstaff: 10000 },
    },
  },
});

const CARE_MODE_ALIASES = Object.freeze({
  REGISTERED_CHILD: "REGISTERED_CHILD",
  FULL_TIME: "REGISTERED_CHILD",
  full_time: "REGISTERED_CHILD",
  fulltime: "REGISTERED_CHILD",
  monthly: "REGISTERED_CHILD",
  monthly_fulltime: "REGISTERED_CHILD",
  monthly_fulltime_3m_2y: "REGISTERED_CHILD",
  monthly_fulltime_2y_4y: "REGISTERED_CHILD",
  transit: "REGISTERED_CHILD",
  transit_monthly_half_day: "REGISTERED_CHILD",
  transit_halfday_month: "REGISTERED_CHILD",
  transit_monthly_2_hours: "REGISTERED_CHILD",
  transit_2h_month: "REGISTERED_CHILD",
  transit_monthly_school_holiday_full: "REGISTERED_CHILD",
  transit_schoolholiday_month: "REGISTERED_CHILD",
  CASUAL_TRANSIT_1_HOUR: "CASUAL_TRANSIT_1_HOUR",
  casual_transit_1_hour: "CASUAL_TRANSIT_1_HOUR",
  transit_1hour: "CASUAL_TRANSIT_1_HOUR",
  "1 hour": "CASUAL_TRANSIT_1_HOUR",
  CASUAL_TRANSIT_1_DAY: "CASUAL_TRANSIT_1_DAY",
  casual_transit_1_day: "CASUAL_TRANSIT_1_DAY",
  transit_1day: "CASUAL_TRANSIT_1_DAY",
  "1 day": "CASUAL_TRANSIT_1_DAY",
  CASUAL_TRANSIT_1_WEEK: "CASUAL_TRANSIT_1_WEEK",
  casual_transit_1_week: "CASUAL_TRANSIT_1_WEEK",
  transit_1week: "CASUAL_TRANSIT_1_WEEK",
  "1 week": "CASUAL_TRANSIT_1_WEEK",
});

const MALAYSIA_UTC_OFFSET_MINUTES = 8 * 60;

function deepClone(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => deepClone(entry));
  }
  if (value && typeof value === "object") {
    const next = {};
    for (const [key, entry] of Object.entries(value)) {
      next[key] = deepClone(entry);
    }
    return next;
  }
  return value;
}

function deepMerge(base, override) {
  if (Array.isArray(base)) {
    return Array.isArray(override) ? override.map((entry) => deepClone(entry)) : base.map((entry) => deepClone(entry));
  }
  if (!base || typeof base !== "object") {
    return override === undefined ? base : override;
  }

  const next = deepClone(base);
  if (!override || typeof override !== "object") {
    return next;
  }

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      next[key] = value.map((entry) => deepClone(entry));
      continue;
    }
    if (value && typeof value === "object" && next[key] && typeof next[key] === "object" && !Array.isArray(next[key])) {
      next[key] = deepMerge(next[key], value);
      continue;
    }
    next[key] = value;
  }
  return next;
}

function resolveFeePolicy(rawPolicy = {}) {
  return deepMerge(DEFAULT_FEE_POLICY, rawPolicy);
}

function moneySen(raw) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed);
}

function sanitizeQuantity(rawQuantity) {
  const parsed = Number(rawQuantity);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  const rounded = Math.round(parsed * 100) / 100;
  return rounded > 0 ? rounded : 0;
}

function buildLineItem({
  code,
  label,
  description,
  quantity,
  unit,
  unitAmountSen,
  taxable = false,
  notes = [],
  policyKey = "",
}) {
  const safeCode = String(code || "").trim();
  const safeLabel = String(label || description || safeCode || "Item").trim() || "Item";
  const safeDescription = String(description || safeLabel).trim() || safeLabel;
  const safeUnit = String(unit || "unit").trim() || "unit";
  const safeQuantity = sanitizeQuantity(quantity);
  const safeUnitAmountSen = moneySen(unitAmountSen);
  const lineTotalSen = moneySen(safeQuantity * safeUnitAmountSen);
  const normalizedNotes = (Array.isArray(notes) ? notes : [notes])
    .map((note) => String(note || "").trim())
    .filter(Boolean);

  return {
    code: safeCode,
    label: safeLabel,
    description: safeDescription,
    quantity: safeQuantity,
    qty: safeQuantity,
    unit: safeUnit,
    unitAmountSen: safeUnitAmountSen,
    unitPriceSen: safeUnitAmountSen,
    lineTotalSen,
    amountSen: lineTotalSen,
    taxable: taxable === true,
    notes: normalizedNotes,
    policyKey: String(policyKey || "").trim(),
  };
}

function asDate(raw) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw;
  }
  if (raw && typeof raw.toDate === "function") {
    const converted = raw.toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
  }
  if (raw === undefined || raw === null || raw === "") {
    return null;
  }
  const converted = new Date(raw);
  return Number.isNaN(converted.getTime()) ? null : converted;
}

function normalizePayerType(raw) {
  return String(raw || "").trim().toLowerCase() === "staff" ? "staff" : "nonstaff";
}

function normalizeCareMode(raw) {
  const normalized = String(raw || "").trim();
  if (!normalized) {
    return "REGISTERED_CHILD";
  }
  return CARE_MODE_ALIASES[normalized] || CARE_MODE_ALIASES[normalized.toLowerCase()] || "REGISTERED_CHILD";
}

function rowMap(table) {
  return table && table.table ? table.table : (table || {});
}

function normalizeCodeCandidates(codeCandidates) {
  if (Array.isArray(codeCandidates)) {
    return codeCandidates.map((code) => String(code || "").trim()).filter(Boolean);
  }
  const single = String(codeCandidates || "").trim();
  return single ? [single] : [];
}

function lookupPrice({ table, codeCandidates, payerType }) {
  const rows = rowMap(table);
  const bucket = normalizePayerType(payerType);
  for (const code of normalizeCodeCandidates(codeCandidates)) {
    const row = rows[code];
    if (!row || typeof row !== "object") continue;
    if (!Object.prototype.hasOwnProperty.call(row, bucket)) continue;
    return {
      code,
      unitAmountSen: moneySen(row[bucket]),
    };
  }
  return null;
}

function malaysiaShift(date) {
  return new Date(date.getTime() + (MALAYSIA_UTC_OFFSET_MINUTES * 60 * 1000));
}

function malaysiaDateParts(date) {
  const shifted = malaysiaShift(date);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dayOfWeek: shifted.getUTCDay(),
  };
}

function malaysiaLocalDate(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  return new Date(Date.UTC(year, month, day, hour, minute, second, millisecond) - (MALAYSIA_UTC_OFFSET_MINUTES * 60 * 1000));
}

function malaysiaSameDayAt(date, hour, minute = 0) {
  const parts = malaysiaDateParts(date);
  return malaysiaLocalDate(parts.year, parts.month, parts.day, hour, minute, 0, 0);
}

function malaysiaDateKey(date) {
  const parts = malaysiaDateParts(date);
  return `${parts.year}-${String(parts.month + 1).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function startOfMalaysiaDay(date) {
  const parts = malaysiaDateParts(date);
  return malaysiaLocalDate(parts.year, parts.month, parts.day, 0, 0, 0, 0);
}

function periodDateFromKey(periodKey) {
  const match = String(periodKey || "").trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  return malaysiaLocalDate(Number(match[1]), Number(match[2]) - 1, 1, 0, 0, 0, 0);
}

function shiftPeriodKey(periodKey, monthOffset) {
  const base = periodDateFromKey(periodKey);
  if (!base) return "";
  const parts = malaysiaDateParts(base);
  const shifted = malaysiaLocalDate(parts.year, parts.month + Number(monthOffset || 0), 1, 0, 0, 0, 0);
  const shiftedParts = malaysiaDateParts(shifted);
  return `${shiftedParts.year}-${String(shiftedParts.month + 1).padStart(2, "0")}`;
}

function resolveDateInput(value, fallback = null) {
  const direct = asDate(value);
  return direct || fallback;
}

function dedupeNotes(notes) {
  const seen = new Set();
  const out = [];
  for (const note of notes || []) {
    const text = String(note || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function monthlyFeeCodeForAgeBand(ageBand) {
  return ageBand && ageBand.monthlyFeeCode ? String(ageBand.monthlyFeeCode) : "monthly_fee_age_4";
}

function determineAgeBand(ageMonths, rawPolicy = DEFAULT_FEE_POLICY) {
  const policy = resolveFeePolicy(rawPolicy);
  const parsedMonths = Number(ageMonths);
  const bands = Object.values(policy.ageBands || DEFAULT_FEE_POLICY.ageBands)
    .sort((left, right) => Number(left.minMonths || 0) - Number(right.minMonths || 0));
  const firstBand = bands[0] || DEFAULT_FEE_POLICY.ageBands.BABY_TO_2;
  const lastBand = bands[bands.length - 1] || DEFAULT_FEE_POLICY.ageBands.AGE_4;

  if (!Number.isFinite(parsedMonths)) {
    return {
      bandKey: lastBand.key,
      codeSuffix: lastBand.codeSuffix,
      label: lastBand.label,
      monthlyFeeCode: lastBand.monthlyFeeCode,
      monthlyFeeSen: moneySen(lastBand.monthlyFeeSen),
      ageMonths: null,
      ageOutOfPolicy: true,
      agePolicyReason: "missing_birth_date",
    };
  }

  for (const band of bands) {
    const minMonths = Number(band.minMonths || 0);
    const maxMonthsExclusive = Number(band.maxMonthsExclusive || policy.supportedAgeMaxMonthsExclusive || 60);
    if (parsedMonths >= minMonths && parsedMonths < maxMonthsExclusive) {
      return {
        bandKey: band.key,
        codeSuffix: band.codeSuffix,
        label: band.label,
        monthlyFeeCode: band.monthlyFeeCode,
        monthlyFeeSen: moneySen(band.monthlyFeeSen),
        ageMonths: parsedMonths,
        ageOutOfPolicy: false,
        agePolicyReason: "in_range",
      };
    }
  }

  if (parsedMonths < Number(firstBand.minMonths || 0)) {
    return {
      bandKey: firstBand.key,
      codeSuffix: firstBand.codeSuffix,
      label: firstBand.label,
      monthlyFeeCode: firstBand.monthlyFeeCode,
      monthlyFeeSen: moneySen(firstBand.monthlyFeeSen),
      ageMonths: parsedMonths,
      ageOutOfPolicy: true,
      agePolicyReason: "age_below_supported_range",
    };
  }

  return {
    bandKey: lastBand.key,
    codeSuffix: lastBand.codeSuffix,
    label: lastBand.label,
    monthlyFeeCode: lastBand.monthlyFeeCode,
    monthlyFeeSen: moneySen(lastBand.monthlyFeeSen),
    ageMonths: parsedMonths,
    ageOutOfPolicy: true,
    agePolicyReason: "age_5_or_above",
  };
}

function isJanuaryInvoice({ periodKey, periodDate, policy = DEFAULT_FEE_POLICY }) {
  const resolvedPolicy = resolveFeePolicy(policy);
  const januaryMonth = Number(resolvedPolicy.yearlyMaintenance && resolvedPolicy.yearlyMaintenance.januaryChargeMonth
    ? resolvedPolicy.yearlyMaintenance.januaryChargeMonth
    : 1);
  const byKey = String(periodKey || "").match(/^\d{4}-(\d{2})$/);
  if (byKey) {
    return Number(byKey[1]) === januaryMonth;
  }
  const dt = asDate(periodDate);
  if (!dt) return false;
  return (malaysiaDateParts(dt).month + 1) === januaryMonth;
}

function determineYearlyFeeCoveredYear(registrationDate, policy = DEFAULT_FEE_POLICY) {
  const resolvedPolicy = resolveFeePolicy(policy);
  const dt = asDate(registrationDate);
  if (!dt) return null;
  const parts = malaysiaDateParts(dt);
  const month = parts.month + 1;
  const carryForwardMonths = Array.isArray(resolvedPolicy.yearlyMaintenance && resolvedPolicy.yearlyMaintenance.carryForwardRegistrationMonths)
    ? resolvedPolicy.yearlyMaintenance.carryForwardRegistrationMonths.map((value) => Number(value))
    : [11, 12];
  return carryForwardMonths.includes(month) ? parts.year + 1 : parts.year;
}

function shouldChargeYearlyMaintenance({ invoiceMonth, registrationDate, yearlyFeeCoveredYear, policy = DEFAULT_FEE_POLICY }) {
  const resolvedPolicy = resolveFeePolicy(policy);
  const invoiceDate = resolveDateInput(invoiceMonth);
  if (!invoiceDate) return false;
  if (!isJanuaryInvoice({ periodDate: invoiceDate, policy: resolvedPolicy })) {
    return false;
  }

  const invoiceYear = malaysiaDateParts(invoiceDate).year;
  const coveredYear = Number.isFinite(Number(yearlyFeeCoveredYear))
    ? Number(yearlyFeeCoveredYear)
    : determineYearlyFeeCoveredYear(registrationDate, resolvedPolicy);
  if (!Number.isFinite(coveredYear)) {
    return true;
  }
  return invoiceYear > coveredYear;
}

function configuredAmount({ table, payerType, code, fallbackSen }) {
  const lookedUp = lookupPrice({ table, codeCandidates: [code], payerType });
  return {
    code: String(code || "").trim(),
    unitAmountSen: lookedUp ? moneySen(lookedUp.unitAmountSen) : moneySen(fallbackSen),
    sourceCode: lookedUp ? lookedUp.code : String(code || "").trim(),
  };
}

function calculateMonthlyFee({ ageMonths, payerType, table, policy = DEFAULT_FEE_POLICY }) {
  const resolvedPolicy = resolveFeePolicy(policy);
  const ageBand = determineAgeBand(ageMonths, resolvedPolicy);
  const amount = configuredAmount({
    table,
    payerType,
    code: monthlyFeeCodeForAgeBand(ageBand),
    fallbackSen: ageBand.monthlyFeeSen,
  });

  return {
    ageBand,
    monthlyFeeCode: monthlyFeeCodeForAgeBand(ageBand),
    monthlyFeeSen: moneySen(amount.unitAmountSen),
  };
}

function registeredMonthlyFeeItem({ ageBand, monthlyFeeSen, policy = DEFAULT_FEE_POLICY }) {
  const resolvedPolicy = resolveFeePolicy(policy);
  return buildLineItem({
    code: "monthly_fee",
    label: "Monthly Fee",
    description: `Monthly Fee (${String(ageBand && ageBand.label ? ageBand.label : "Registered Child").trim()})`,
    quantity: 1,
    unit: "month",
    unitAmountSen: monthlyFeeSen,
    taxable: false,
    policyKey: `${resolvedPolicy.activeBillingModel}.monthly_fee.${String(ageBand && ageBand.codeSuffix ? ageBand.codeSuffix : "UNKNOWN")}`,
  });
}

function isInsuranceApplicable({ isRegistrationMonth }) {
  return Boolean(isRegistrationMonth);
}

function getOperatingHoursForDate(date, policy = DEFAULT_FEE_POLICY) {
  const resolvedPolicy = resolveFeePolicy(policy);
  const dt = asDate(date);
  if (!dt) {
    return {
      dayType: "UNKNOWN",
      dayOfWeek: null,
      isWorkingDay: false,
      openingMinute: null,
      closingMinute: null,
      overtimeHalfHourRateSen: 0,
      overtimeHalfHourRateCode: "",
      label: "Unknown",
      closedMessage: "Taska is closed today",
    };
  }

  const parts = malaysiaDateParts(dt);
  const dayOfWeek = parts.dayOfWeek;
  const { weekday, saturday, sunday } = resolvedPolicy.operatingHours || DEFAULT_FEE_POLICY.operatingHours;

  if (Array.isArray(weekday.dayKeys) && weekday.dayKeys.includes(dayOfWeek)) {
    return {
      dayType: "WEEKDAY",
      dayOfWeek,
      isWorkingDay: true,
      openingMinute: Number(weekday.openingMinute),
      closingMinute: Number(weekday.closingMinute),
      overtimeHalfHourRateSen: moneySen(weekday.overtimeHalfHourRateSen),
      overtimeHalfHourRateCode: String(weekday.overtimeHalfHourRateCode || ""),
      label: String(weekday.label || "Weekday"),
      closedMessage: "",
    };
  }

  if (Array.isArray(saturday.dayKeys) && saturday.dayKeys.includes(dayOfWeek)) {
    return {
      dayType: "SATURDAY",
      dayOfWeek,
      isWorkingDay: true,
      openingMinute: Number(saturday.openingMinute),
      closingMinute: Number(saturday.closingMinute),
      overtimeHalfHourRateSen: moneySen(saturday.overtimeHalfHourRateSen),
      overtimeHalfHourRateCode: String(saturday.overtimeHalfHourRateCode || ""),
      label: String(saturday.label || "Saturday"),
      closedMessage: "",
    };
  }

  return {
    dayType: "SUNDAY",
    dayOfWeek,
    isWorkingDay: false,
    openingMinute: null,
    closingMinute: null,
    overtimeHalfHourRateSen: 0,
    overtimeHalfHourRateCode: "",
    label: String(sunday && sunday.label ? sunday.label : "Sunday"),
    closedMessage: "Taska is closed today",
  };
}

function minutesSinceMidnightMalaysia(date) {
  const parts = malaysiaDateParts(date);
  return (parts.hour * 60) + parts.minute;
}

function isWorkingDay(date, policy = DEFAULT_FEE_POLICY) {
  return getOperatingHoursForDate(date, policy).isWorkingDay;
}

function isWithinCheckInWindow(dateTime, policy = DEFAULT_FEE_POLICY) {
  const dt = asDate(dateTime);
  if (!dt) return false;
  const schedule = getOperatingHoursForDate(dt, policy);
  if (!schedule.isWorkingDay) return false;
  const minuteOfDay = minutesSinceMidnightMalaysia(dt);
  return minuteOfDay >= schedule.openingMinute && minuteOfDay <= schedule.closingMinute;
}

function canCheckIn(dateTime, policy = DEFAULT_FEE_POLICY) {
  const dt = asDate(dateTime);
  if (!dt) {
    return { ok: false, reason: "invalid-date", message: "Invalid attendance time" };
  }
  const schedule = getOperatingHoursForDate(dt, policy);
  if (!schedule.isWorkingDay) {
    return { ok: false, reason: "taska-closed", message: "Taska is closed today" };
  }
  if (!isWithinCheckInWindow(dt, policy)) {
    return { ok: false, reason: "outside-working-hours", message: "Outside working hours" };
  }
  return { ok: true, reason: "", message: "" };
}

function canCheckOut(dateTime) {
  const dt = asDate(dateTime);
  if (!dt) {
    return { ok: false, reason: "invalid-date", message: "Invalid attendance time" };
  }
  return { ok: true, reason: "", message: "" };
}

function determineOvertimeCycleForInvoice({ invoiceMonth, registrationDate, policy = DEFAULT_FEE_POLICY }) {
  const resolvedPolicy = resolveFeePolicy(policy);
  const invoiceDate = resolveDateInput(invoiceMonth);
  if (!invoiceDate) {
    return {
      applies: false,
      cycleStart: null,
      cycleEnd: null,
      cycleStartDateKey: "",
      cycleEndDateKey: "",
    };
  }

  const invoiceParts = malaysiaDateParts(invoiceDate);
  const cycleEnd = malaysiaLocalDate(
    invoiceParts.year,
    invoiceParts.month - 1,
    Number(resolvedPolicy.overtimeCycle.endDay || 20),
    23,
    59,
    59,
    999,
  );
  const normalCycleStart = malaysiaLocalDate(
    invoiceParts.year,
    invoiceParts.month - 2,
    Number(resolvedPolicy.overtimeCycle.startDay || 21),
    0,
    0,
    0,
    0,
  );

  const registrationDt = asDate(registrationDate);
  if (!registrationDt) {
    return {
      applies: true,
      cycleStart: normalCycleStart,
      cycleEnd,
      cycleStartDateKey: malaysiaDateKey(normalCycleStart),
      cycleEndDateKey: malaysiaDateKey(cycleEnd),
      partialRegistrationMonth: false,
    };
  }

  if (registrationDt.getTime() > cycleEnd.getTime()) {
    return {
      applies: false,
      cycleStart: null,
      cycleEnd,
      cycleStartDateKey: "",
      cycleEndDateKey: malaysiaDateKey(cycleEnd),
      partialRegistrationMonth: false,
    };
  }

  const cycleStart = registrationDt.getTime() > normalCycleStart.getTime()
    ? startOfMalaysiaDay(registrationDt)
    : normalCycleStart;

  return {
    applies: true,
    cycleStart,
    cycleEnd,
    cycleStartDateKey: malaysiaDateKey(cycleStart),
    cycleEndDateKey: malaysiaDateKey(cycleEnd),
    partialRegistrationMonth: cycleStart.getTime() !== normalCycleStart.getTime(),
  };
}

function attendanceAnchorDate(attendanceRecord) {
  return asDate(attendanceRecord && (
    attendanceRecord.date
    || attendanceRecord.checkInAt
    || attendanceRecord.check_in_time
    || attendanceRecord.checkInTime
    || attendanceRecord.checkinTime
    || attendanceRecord.checkOutAt
    || attendanceRecord.check_out_time
    || attendanceRecord.checkOutTime
    || attendanceRecord.checkoutTime
  ));
}

function calculateOvertimeForAttendance(attendanceRecord, policy = DEFAULT_FEE_POLICY) {
  const resolvedPolicy = resolveFeePolicy(policy);
  const checkOutAt = asDate(attendanceRecord && (
    attendanceRecord.checkOutAt
    || attendanceRecord.check_out_time
    || attendanceRecord.checkOutTime
    || attendanceRecord.checkoutTime
  ));
  const anchor = attendanceAnchorDate(attendanceRecord) || checkOutAt;

  if (!checkOutAt || !anchor) {
    return {
      applies: false,
      blocks: 0,
      minutes: 0,
      totalSen: 0,
      rateSen: 0,
      dayType: "UNKNOWN",
      dateKey: "",
    };
  }

  const schedule = getOperatingHoursForDate(anchor, resolvedPolicy);
  if (!schedule.isWorkingDay || !Number.isFinite(schedule.closingMinute)) {
    return {
      applies: false,
      blocks: 0,
      minutes: 0,
      totalSen: 0,
      rateSen: 0,
      dayType: schedule.dayType,
      dateKey: malaysiaDateKey(anchor),
      reason: schedule.isWorkingDay ? "missing-closing-time" : "taska-closed",
    };
  }

  const closingHour = Math.floor(schedule.closingMinute / 60);
  const closingMinute = schedule.closingMinute % 60;
  const closingDate = malaysiaSameDayAt(anchor, closingHour, closingMinute);
  const overtimeMinutes = Math.max(0, Math.ceil((checkOutAt.getTime() - closingDate.getTime()) / 60000));
  const blocks = overtimeMinutes <= 0 ? 0 : Math.ceil(overtimeMinutes / 30);
  const totalSen = moneySen(blocks * moneySen(schedule.overtimeHalfHourRateSen));

  return {
    applies: blocks > 0,
    blocks,
    minutes: blocks > 0 ? blocks * 30 : 0,
    rawMinutes: overtimeMinutes,
    totalSen,
    rateSen: moneySen(schedule.overtimeHalfHourRateSen),
    dayType: schedule.dayType,
    dateKey: malaysiaDateKey(anchor),
    closingMinute: schedule.closingMinute,
    closingTimeLabel: `${String(closingHour).padStart(2, "0")}:${String(closingMinute).padStart(2, "0")}`,
    overtimeHalfHourRateCode: schedule.overtimeHalfHourRateCode,
  };
}

function manualOvertimeCharge(manualOvertime, policy = DEFAULT_FEE_POLICY) {
  const resolvedPolicy = resolveFeePolicy(policy);
  if (!manualOvertime || typeof manualOvertime !== "object") {
    return null;
  }

  if (Number.isFinite(Number(manualOvertime.totalSen))) {
    const totalSen = moneySen(manualOvertime.totalSen);
    return {
      items: totalSen > 0
        ? [buildLineItem({
          code: "overtime_charge",
          label: "Overtime Charge",
          description: "Overtime Charge",
          quantity: 1,
          unit: "invoice",
          unitAmountSen: totalSen,
          taxable: false,
          notes: ["Manual overtime override"],
          policyKey: `${resolvedPolicy.activeBillingModel}.overtime_charge.manual`,
        })]
        : [],
      totalSen,
      breakdown: [],
      weekdayBlocks: 0,
      saturdayBlocks: 0,
      managementReviewRecommended: false,
    };
  }

  const weekdayBlocks = Math.max(
    0,
    Number(manualOvertime.weekdayHalfHourBlocks || 0)
      || Math.ceil(Number(manualOvertime.weekdayHours || 0) * 2)
      || Math.ceil((Number(manualOvertime.after530Hours || 0) + Number(manualOvertime.h8to12Hours || 0) + Number(manualOvertime.h12to7Hours || 0)) * 2),
  );
  const saturdayBlocks = Math.max(
    0,
    Number(manualOvertime.saturdayHalfHourBlocks || 0)
      || Math.ceil(Number(manualOvertime.saturdayHours || 0) * 2),
  );
  const weekdayRate = moneySen(resolvedPolicy.operatingHours.weekday.overtimeHalfHourRateSen);
  const saturdayRate = moneySen(resolvedPolicy.operatingHours.saturday.overtimeHalfHourRateSen);
  const totalSen = moneySen((weekdayBlocks * weekdayRate) + (saturdayBlocks * saturdayRate));

  return {
    items: totalSen > 0
      ? [buildLineItem({
        code: "overtime_charge",
        label: "Overtime Charge",
        description: "Overtime Charge",
        quantity: 1,
        unit: "invoice",
        unitAmountSen: totalSen,
        taxable: false,
        notes: dedupeNotes([
          weekdayBlocks > 0 ? `Weekday overtime: ${weekdayBlocks} x 30 min` : "",
          saturdayBlocks > 0 ? `Saturday overtime: ${saturdayBlocks} x 30 min` : "",
          "Manual overtime override",
        ]),
        policyKey: `${resolvedPolicy.activeBillingModel}.overtime_charge.manual`,
      })]
      : [],
    totalSen,
    breakdown: [],
    weekdayBlocks,
    saturdayBlocks,
    managementReviewRecommended: false,
  };
}

function calculateOvertimeCharge({ intervals, attendanceRows, manualOvertime, policy = DEFAULT_FEE_POLICY }) {
  const resolvedPolicy = resolveFeePolicy(policy);
  const manual = manualOvertimeCharge(manualOvertime, resolvedPolicy);
  if (manual) {
    return manual;
  }

  const rows = Array.isArray(attendanceRows) && attendanceRows.length > 0
    ? attendanceRows
    : (Array.isArray(intervals) ? intervals.map((entry) => ({
      checkInAt: entry && entry.start ? entry.start : null,
      checkOutAt: entry && entry.end ? entry.end : null,
      date: entry && (entry.start || entry.end) ? (entry.start || entry.end) : null,
    })) : []);

  const breakdown = [];
  let weekdayBlocks = 0;
  let saturdayBlocks = 0;
  let totalSen = 0;

  for (const row of rows) {
    const charge = calculateOvertimeForAttendance(row, resolvedPolicy);
    if (!charge.applies) continue;
    breakdown.push(charge);
    totalSen += moneySen(charge.totalSen);
    if (charge.dayType === "SATURDAY") {
      saturdayBlocks += Number(charge.blocks || 0);
    } else {
      weekdayBlocks += Number(charge.blocks || 0);
    }
  }

  const items = totalSen > 0
    ? [buildLineItem({
      code: "overtime_charge",
      label: "Overtime Charge",
      description: "Overtime Charge",
      quantity: 1,
      unit: "invoice",
      unitAmountSen: totalSen,
      taxable: false,
      notes: dedupeNotes([
        weekdayBlocks > 0 ? `Weekday overtime: ${weekdayBlocks} x 30 min` : "",
        saturdayBlocks > 0 ? `Saturday overtime: ${saturdayBlocks} x 30 min` : "",
      ]),
      policyKey: `${resolvedPolicy.activeBillingModel}.overtime_charge`,
    })]
    : [];

  return {
    items,
    totalSen: moneySen(totalSen),
    breakdown,
    weekdayBlocks,
    saturdayBlocks,
    managementReviewRecommended: false,
  };
}

function calculateOvertimeForCycle({ attendanceRows, cycleStart, cycleEnd, policy = DEFAULT_FEE_POLICY }) {
  const start = asDate(cycleStart);
  const end = asDate(cycleEnd);
  const filteredRows = (attendanceRows || []).filter((row) => {
    const anchor = attendanceAnchorDate(row);
    if (!anchor || !start || !end) return false;
    return anchor.getTime() >= start.getTime() && anchor.getTime() <= end.getTime();
  });
  return calculateOvertimeCharge({ attendanceRows: filteredRows, policy });
}

function generateInvoiceLineItems({
  periodKey,
  periodDate,
  payerType,
  table,
  policy,
  careMode,
  ageMonths,
  isRegistrationMonth,
  registrationDate,
  yearlyFeeCoveredYear,
  overtimeChargeOverride,
  attendanceRows,
  manualOvertime,
}) {
  const resolvedPolicy = resolveFeePolicy(policy);
  const normalizedCareMode = normalizeCareMode(careMode);
  const items = [];
  const policyNotes = [];
  const effectivePeriodDate = resolveDateInput(periodDate, periodDateFromKey(periodKey));
  const effectiveRegistrationDate = resolveDateInput(registrationDate, effectivePeriodDate);

  if (normalizedCareMode.startsWith("CASUAL_TRANSIT_")) {
    return {
      items: [],
      subTotalSen: 0,
      totalSen: 0,
      ageBand: determineAgeBand(ageMonths, resolvedPolicy),
      overtime: { items: [], totalSen: 0, breakdown: [], weekdayBlocks: 0, saturdayBlocks: 0, managementReviewRecommended: false },
      policyNotes: ["Casual transit is billed separately from registered-child monthly billing."],
      managementReviewRecommended: false,
      yearlyFeeCoveredYear: Number.isFinite(Number(yearlyFeeCoveredYear)) ? Number(yearlyFeeCoveredYear) : null,
      feePolicyVersion: resolvedPolicy.policyVersion,
      activeBillingModel: resolvedPolicy.activeBillingModel,
    };
  }

  const monthlyFee = calculateMonthlyFee({ ageMonths, payerType, table, policy: resolvedPolicy });
  items.push(registeredMonthlyFeeItem({
    ageBand: monthlyFee.ageBand,
    monthlyFeeSen: monthlyFee.monthlyFeeSen,
    policy: resolvedPolicy,
  }));

  if (monthlyFee.ageBand.ageOutOfPolicy) {
    policyNotes.push("Child age is outside the supported Taska Zurah range. Review before finalizing billing.");
  }

  let resolvedCoveredYear = Number.isFinite(Number(yearlyFeeCoveredYear))
    ? Number(yearlyFeeCoveredYear)
    : determineYearlyFeeCoveredYear(effectiveRegistrationDate, resolvedPolicy);

  if (isRegistrationMonth) {
    const registrationAmount = configuredAmount({
      table,
      payerType,
      code: resolvedPolicy.registration.code,
      fallbackSen: resolvedPolicy.registration.amountSen,
    });
    items.push(buildLineItem({
      code: resolvedPolicy.registration.code,
      label: resolvedPolicy.registration.label,
      description: resolvedPolicy.registration.label,
      quantity: 1,
      unit: resolvedPolicy.registration.unit,
      unitAmountSen: registrationAmount.unitAmountSen,
      taxable: false,
      policyKey: resolvedPolicy.registration.policyKey,
    }));

    if (isInsuranceApplicable({ isRegistrationMonth: true })) {
      const insuranceAmount = configuredAmount({
        table,
        payerType,
        code: resolvedPolicy.insurance.code,
        fallbackSen: resolvedPolicy.insurance.amountSen,
      });
      items.push(buildLineItem({
        code: resolvedPolicy.insurance.code,
        label: resolvedPolicy.insurance.label,
        description: resolvedPolicy.insurance.label,
        quantity: 1,
        unit: resolvedPolicy.insurance.unit,
        unitAmountSen: insuranceAmount.unitAmountSen,
        taxable: false,
        policyKey: resolvedPolicy.insurance.policyKey,
      }));
    }

    const yearlyAmount = configuredAmount({
      table,
      payerType,
      code: resolvedPolicy.yearlyMaintenance.code,
      fallbackSen: resolvedPolicy.yearlyMaintenance.amountSen,
    });
    items.push(buildLineItem({
      code: resolvedPolicy.yearlyMaintenance.code,
      label: resolvedPolicy.yearlyMaintenance.label,
      description: resolvedPolicy.yearlyMaintenance.label,
      quantity: 1,
      unit: resolvedPolicy.yearlyMaintenance.unit,
      unitAmountSen: yearlyAmount.unitAmountSen,
      taxable: false,
      policyKey: resolvedPolicy.yearlyMaintenance.policyKey,
    }));

    resolvedCoveredYear = determineYearlyFeeCoveredYear(effectiveRegistrationDate, resolvedPolicy);
    if (Number.isFinite(Number(resolvedCoveredYear))) {
      policyNotes.push(`Yearly maintenance covers ${resolvedCoveredYear}.`);
    }
  } else if (shouldChargeYearlyMaintenance({
    invoiceMonth: effectivePeriodDate,
    registrationDate: effectiveRegistrationDate,
    yearlyFeeCoveredYear: resolvedCoveredYear,
    policy: resolvedPolicy,
  })) {
    const yearlyAmount = configuredAmount({
      table,
      payerType,
      code: resolvedPolicy.yearlyMaintenance.code,
      fallbackSen: resolvedPolicy.yearlyMaintenance.amountSen,
    });
    items.push(buildLineItem({
      code: resolvedPolicy.yearlyMaintenance.code,
      label: resolvedPolicy.yearlyMaintenance.label,
      description: resolvedPolicy.yearlyMaintenance.label,
      quantity: 1,
      unit: resolvedPolicy.yearlyMaintenance.unit,
      unitAmountSen: yearlyAmount.unitAmountSen,
      taxable: false,
      policyKey: resolvedPolicy.yearlyMaintenance.policyKey,
    }));
    if (effectivePeriodDate) {
      resolvedCoveredYear = malaysiaDateParts(effectivePeriodDate).year;
    }
  }

  const overtime = overtimeChargeOverride && typeof overtimeChargeOverride === "object"
    ? {
      items: Array.isArray(overtimeChargeOverride.items) ? overtimeChargeOverride.items : [],
      totalSen: moneySen(overtimeChargeOverride.totalSen),
      breakdown: Array.isArray(overtimeChargeOverride.breakdown) ? overtimeChargeOverride.breakdown : [],
      weekdayBlocks: Number(overtimeChargeOverride.weekdayBlocks || 0),
      saturdayBlocks: Number(overtimeChargeOverride.saturdayBlocks || 0),
      managementReviewRecommended: Boolean(overtimeChargeOverride.managementReviewRecommended),
    }
    : calculateOvertimeCharge({
      attendanceRows,
      manualOvertime,
      policy: resolvedPolicy,
    });
  items.push(...overtime.items);

  const totalSen = items.reduce((sum, item) => sum + moneySen(item.amountSen), 0);
  return {
    items,
    subTotalSen: moneySen(totalSen),
    totalSen: moneySen(totalSen),
    ageBand: monthlyFee.ageBand,
    overtime,
    policyNotes: dedupeNotes(policyNotes),
    managementReviewRecommended: Boolean(monthlyFee.ageBand.ageOutOfPolicy || overtime.managementReviewRecommended),
    yearlyFeeCoveredYear: Number.isFinite(Number(resolvedCoveredYear)) ? Number(resolvedCoveredYear) : null,
    feePolicyVersion: resolvedPolicy.policyVersion,
    activeBillingModel: resolvedPolicy.activeBillingModel,
  };
}

function calculateRegistrationInvoice(input) {
  return generateInvoiceLineItems({
    ...input,
    isRegistrationMonth: true,
  });
}

function calculateMonthlyInvoice(input) {
  return generateInvoiceLineItems({
    ...input,
    isRegistrationMonth: false,
  });
}

function calculateJanuaryInvoice(input) {
  const periodDate = resolveDateInput(input && input.periodDate, input && input.year
    ? malaysiaLocalDate(Number(input.year), 0, 1, 0, 0, 0, 0)
    : null);
  return generateInvoiceLineItems({
    ...input,
    periodDate,
    periodKey: input && input.periodKey ? input.periodKey : (periodDate ? `${malaysiaDateParts(periodDate).year}-01` : ""),
    isRegistrationMonth: false,
  });
}

function baseCodeForCareMode({ careMode }) {
  const normalized = normalizeCareMode(careMode);
  if (normalized === "CASUAL_TRANSIT_1_HOUR") return "transit_1hour";
  if (normalized === "CASUAL_TRANSIT_1_DAY") return "transit_1day";
  if (normalized === "CASUAL_TRANSIT_1_WEEK") return "transit_1week";
  return "monthly_fee";
}

function casualTransitBaseAmount({ payerType, transitType, table, policy = DEFAULT_FEE_POLICY }) {
  const resolvedPolicy = resolveFeePolicy(policy);
  const normalizedCareMode = normalizeCareMode(transitType);
  const baseCode = baseCodeForCareMode({ careMode: normalizedCareMode });
  const defaultRow = resolvedPolicy.casualTransit && resolvedPolicy.casualTransit.table
    ? resolvedPolicy.casualTransit.table[baseCode]
    : null;
  const amount = lookupPrice({ table, codeCandidates: [baseCode], payerType })
    || (defaultRow ? { code: baseCode, unitAmountSen: moneySen(defaultRow[normalizePayerType(payerType)]) } : null);
  if (!amount) {
    return { baseCode, unitAmountSen: 0 };
  }
  return { baseCode, unitAmountSen: moneySen(amount.unitAmountSen) };
}

function calculateCasualTransitCharge({
  payerType,
  transitType,
  ageMonths,
  checkInAt,
  actualCheckOutAt,
  table,
  policy,
}) {
  const resolvedPolicy = resolveFeePolicy(policy);
  const normalizedPayerType = normalizePayerType(payerType);
  const normalizedCareMode = normalizeCareMode(transitType);
  const ageBand = determineAgeBand(ageMonths, resolvedPolicy);
  const baseAmount = casualTransitBaseAmount({
    payerType: normalizedPayerType,
    transitType: normalizedCareMode,
    table,
    policy: resolvedPolicy,
  });

  const unit = normalizedCareMode === "CASUAL_TRANSIT_1_HOUR"
    ? "hour"
    : (normalizedCareMode === "CASUAL_TRANSIT_1_WEEK" ? "week" : "day");

  const items = baseAmount.unitAmountSen > 0
    ? [buildLineItem({
      code: baseAmount.baseCode,
      label: normalizedCareMode === "CASUAL_TRANSIT_1_HOUR"
        ? "Casual Transit 1 Hour"
        : (normalizedCareMode === "CASUAL_TRANSIT_1_WEEK" ? "Casual Transit 1 Week" : "Casual Transit 1 Day"),
      description: normalizedCareMode === "CASUAL_TRANSIT_1_HOUR"
        ? "Casual Transit 1 Hour"
        : (normalizedCareMode === "CASUAL_TRANSIT_1_WEEK" ? "Casual Transit 1 Week" : "Casual Transit 1 Day"),
      quantity: 1,
      unit,
      unitAmountSen: baseAmount.unitAmountSen,
      taxable: false,
      policyKey: `${resolvedPolicy.casualTransit.policyKey}.${baseAmount.baseCode}`,
    })]
    : [];

  const overtime = calculateOvertimeCharge({
    attendanceRows: [{
      checkInAt,
      checkOutAt: actualCheckOutAt,
      date: checkInAt || actualCheckOutAt,
    }],
    policy: resolvedPolicy,
  });
  items.push(...overtime.items);

  const totalAmountSen = items.reduce((sum, item) => sum + moneySen(item.amountSen), 0);
  const overtimeAmountSen = overtime.items.reduce((sum, item) => sum + moneySen(item.amountSen), 0);

  return {
    items,
    baseAmountSen: baseAmount.unitAmountSen,
    overtimeAmountSen: moneySen(overtimeAmountSen),
    totalAmountSen: moneySen(totalAmountSen),
    ageBand,
    transitType: normalizedCareMode,
    staffType: normalizedPayerType === "staff" ? "STAFF" : "NON_STAFF",
    overtimeStrategySnapshot: "TASKA_ZURAH_HALF_HOUR_BLOCKS",
    overtimeBreakdown: overtime.breakdown,
    managementReviewRecommended: Boolean(ageBand.ageOutOfPolicy),
  };
}

function buildDefaultCatalog(policy = DEFAULT_FEE_POLICY) {
  const resolvedPolicy = resolveFeePolicy(policy);
  const table = {};

  for (const band of Object.values(resolvedPolicy.ageBands || {})) {
    table[String(band.monthlyFeeCode)] = {
      staff: moneySen(band.monthlyFeeSen),
      nonstaff: moneySen(band.monthlyFeeSen),
    };
  }

  table[resolvedPolicy.registration.code] = {
    staff: moneySen(resolvedPolicy.registration.amountSen),
    nonstaff: moneySen(resolvedPolicy.registration.amountSen),
  };
  table[resolvedPolicy.insurance.code] = {
    staff: moneySen(resolvedPolicy.insurance.amountSen),
    nonstaff: moneySen(resolvedPolicy.insurance.amountSen),
  };
  table[resolvedPolicy.yearlyMaintenance.code] = {
    staff: moneySen(resolvedPolicy.yearlyMaintenance.amountSen),
    nonstaff: moneySen(resolvedPolicy.yearlyMaintenance.amountSen),
  };
  table[resolvedPolicy.operatingHours.weekday.overtimeHalfHourRateCode] = {
    staff: moneySen(resolvedPolicy.operatingHours.weekday.overtimeHalfHourRateSen),
    nonstaff: moneySen(resolvedPolicy.operatingHours.weekday.overtimeHalfHourRateSen),
  };
  table[resolvedPolicy.operatingHours.saturday.overtimeHalfHourRateCode] = {
    staff: moneySen(resolvedPolicy.operatingHours.saturday.overtimeHalfHourRateSen),
    nonstaff: moneySen(resolvedPolicy.operatingHours.saturday.overtimeHalfHourRateSen),
  };

  for (const [code, row] of Object.entries(resolvedPolicy.casualTransit && resolvedPolicy.casualTransit.table ? resolvedPolicy.casualTransit.table : {})) {
    table[code] = {
      staff: moneySen(row.staff),
      nonstaff: moneySen(row.nonstaff),
    };
  }

  return {
    version: String(resolvedPolicy.policyVersion || "TASKA_ZURAH_2026").toLowerCase(),
    table,
    policy: resolvedPolicy,
  };
}

module.exports = {
  DEFAULT_FEE_POLICY,
  resolveFeePolicy,
  determineAgeBand,
  determineYearlyFeeCoveredYear,
  shouldChargeYearlyMaintenance,
  calculateMonthlyFee,
  isInsuranceApplicable,
  isJanuaryInvoice,
  getOperatingHoursForDate,
  isWorkingDay,
  isWithinCheckInWindow,
  canCheckIn,
  canCheckOut,
  determineOvertimeCycleForInvoice,
  calculateOvertimeForAttendance,
  calculateOvertimeForCycle,
  calculateRegistrationInvoice,
  calculateMonthlyInvoice,
  calculateJanuaryInvoice,
  calculateCasualTransitCharge,
  calculateOvertimeCharge,
  generateInvoiceLineItems,
  baseCodeForCareMode,
  normalizeCareMode,
  lookupPrice,
  buildDefaultCatalog,
  malaysiaDateKey,
  malaysiaLocalDate,
  malaysiaSameDayAt,
  shiftPeriodKey,
};
