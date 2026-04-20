const DEFAULT_FEE_POLICY = Object.freeze({
  ageBands: {
    BAND_A: {
      key: "BAND_A",
      codeSuffix: "3m_2y",
      minMonths: 3,
      maxMonthsExclusive: 24,
    },
    BAND_B: {
      key: "BAND_B",
      codeSuffix: "2y_4y",
      minMonths: 24,
      maxMonthsExclusive: 48,
    },
  },
  annualFeeMonth: 1,
  absenceDiscountPercent: 10,
  absenceDiscountMinDaysWithLetter: 14,
  registration: {
    FULL_TIME: {
      codeCandidates: ["registration_fulltime_oneoff"],
      label: "Yuran Pendaftaran Sepenuh Masa",
      unit: "oneoff",
      policyKey: "registration.full_time",
    },
    MONTHLY_TRANSIT: {
      codeCandidates: ["registration_transit_oneoff"],
      label: "Yuran Pendaftaran Transit",
      unit: "oneoff",
      policyKey: "registration.monthly_transit",
    },
  },
  annualFee: {
    codeCandidates: ["annual_fee_yearly"],
    label: "Yuran Tahunan",
    unit: "year",
    policyKey: "annual_fee.active_children_january",
  },
  communicationBook: {
    codeCandidates: ["comms_book_oneoff", "comms_book_4months"],
    label: "Buku Komunikasi",
    unit: "oneoff",
    policyKey: "communication_book.registration_only",
  },
  insurance: {
    codeCandidates: ["insurance_oneoff_age2plus", "insurance_yearly_age2plus"],
    label: "Insurans",
    unit: "oneoff",
    minAgeMonths: 24,
    policyKey: "insurance.registration_age_2_plus",
  },
  transport: {
    codeCandidates: ["transport_tadika_month", "transport_month"],
    label: "Pengangkutan",
    unit: "month",
    eligibleCareModes: [
      "FULL_TIME",
      "TRANSIT_MONTHLY_HALF_DAY",
      "TRANSIT_MONTHLY_2_HOURS",
      "TRANSIT_MONTHLY_SCHOOL_HOLIDAY_FULL",
    ],
    policyKey: "transport.optional_monthly",
  },
  schoolHolidayMonthly: {
    enabled: true,
    minAgeMonths: 48,
    policyKey: "transit.school_holiday_monthly",
  },
  overtime: {
    roundingMode: "ROUND_UP_TO_NEXT_HOUR",
    policyKey: "overtime.windows",
    windows: [
      {
        code: "overtime_after_530",
        label: "Lebih Masa Selepas 5:30 PM",
        unit: "hour",
        manualKey: "after530Hours",
        startMinute: (17 * 60) + 30,
        endMinute: 20 * 60,
        managementReviewThresholdDays: 10,
      },
      {
        code: "overtime_8pm_12am",
        label: "Lebih Masa 8:00 PM - 12:00 AM",
        unit: "hour",
        manualKey: "h8to12Hours",
        startMinute: 20 * 60,
        endMinute: 24 * 60,
        managementReviewThresholdDays: 10,
      },
    ],
  },
});

const CARE_MODE_ALIASES = Object.freeze({
  FULL_TIME: "FULL_TIME",
  full_time: "FULL_TIME",
  fulltime: "FULL_TIME",
  monthly_fulltime_3m_2y: "FULL_TIME",
  monthly_fulltime_2y_4y: "FULL_TIME",
  TRANSIT_MONTHLY_HALF_DAY: "TRANSIT_MONTHLY_HALF_DAY",
  transit_monthly_half_day: "TRANSIT_MONTHLY_HALF_DAY",
  transit_halfday_month: "TRANSIT_MONTHLY_HALF_DAY",
  TRANSIT_MONTHLY_2_HOURS: "TRANSIT_MONTHLY_2_HOURS",
  transit_monthly_2_hours: "TRANSIT_MONTHLY_2_HOURS",
  transit_2h_month: "TRANSIT_MONTHLY_2_HOURS",
  TRANSIT_MONTHLY_SCHOOL_HOLIDAY_FULL: "TRANSIT_MONTHLY_SCHOOL_HOLIDAY_FULL",
  transit_monthly_school_holiday_full: "TRANSIT_MONTHLY_SCHOOL_HOLIDAY_FULL",
  transit_schoolholiday_month: "TRANSIT_MONTHLY_SCHOOL_HOLIDAY_FULL",
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
    if (value === undefined) {
      continue;
    }
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
    return "FULL_TIME";
  }
  return CARE_MODE_ALIASES[normalized] || CARE_MODE_ALIASES[normalized.toLowerCase()] || normalized;
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
  quantity,
  unit,
  unitAmountSen,
  taxable = false,
  notes = [],
  policyKey = "",
}) {
  const safeCode = String(code || "").trim();
  const safeLabel = String(label || safeCode || "Item").trim() || "Item";
  const safeUnit = String(unit || "unit").trim() || "unit";
  const safeQuantity = sanitizeQuantity(quantity);
  const safeUnitAmountSen = moneySen(unitAmountSen);
  const lineTotalSen = moneySen(safeUnitAmountSen * safeQuantity);
  const normalizedNotes = (Array.isArray(notes) ? notes : [notes])
    .map((note) => String(note || "").trim())
    .filter(Boolean);

  return {
    code: safeCode,
    label: safeLabel,
    description: safeLabel,
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

const MALAYSIA_UTC_OFFSET_MINUTES = 8 * 60;

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
  };
}

function malaysiaLocalDate(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  return new Date(Date.UTC(year, month, day, hour, minute, second, millisecond) - (MALAYSIA_UTC_OFFSET_MINUTES * 60 * 1000));
}

function malaysiaSameDayAt(date, hour, minute = 0) {
  const parts = malaysiaDateParts(date);
  return malaysiaLocalDate(parts.year, parts.month, parts.day, hour, minute, 0, 0);
}

function dedupeNotes(notes) {
  const seen = new Set();
  const out = [];
  for (const note of notes || []) {
    const value = String(note || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function determineAgeBand(ageMonths, rawPolicy = DEFAULT_FEE_POLICY) {
  const policy = resolveFeePolicy(rawPolicy);
  const parsedMonths = Number(ageMonths);
  const bandA = policy.ageBands && policy.ageBands.BAND_A ? policy.ageBands.BAND_A : DEFAULT_FEE_POLICY.ageBands.BAND_A;
  const bandB = policy.ageBands && policy.ageBands.BAND_B ? policy.ageBands.BAND_B : DEFAULT_FEE_POLICY.ageBands.BAND_B;

  if (!Number.isFinite(parsedMonths)) {
    return {
      bandKey: bandB.key,
      codeSuffix: bandB.codeSuffix,
      ageOutOfPolicy: true,
      agePolicyReason: "missing_birth_date",
      ageMonths: null,
    };
  }

  if (parsedMonths < bandA.minMonths) {
    return {
      bandKey: bandA.key,
      codeSuffix: bandA.codeSuffix,
      ageOutOfPolicy: true,
      agePolicyReason: "under_3_months",
      ageMonths: parsedMonths,
    };
  }

  if (parsedMonths < bandA.maxMonthsExclusive) {
    return {
      bandKey: bandA.key,
      codeSuffix: bandA.codeSuffix,
      ageOutOfPolicy: false,
      agePolicyReason: "in_range",
      ageMonths: parsedMonths,
    };
  }

  if (parsedMonths < bandB.maxMonthsExclusive) {
    return {
      bandKey: bandB.key,
      codeSuffix: bandB.codeSuffix,
      ageOutOfPolicy: false,
      agePolicyReason: "in_range",
      ageMonths: parsedMonths,
    };
  }

  return {
    bandKey: bandB.key,
    codeSuffix: bandB.codeSuffix,
    ageOutOfPolicy: true,
    agePolicyReason: "age_4y_or_above",
    ageMonths: parsedMonths,
  };
}

function isJanuaryInvoice({ periodKey, periodDate, policy = DEFAULT_FEE_POLICY }) {
  const resolvedPolicy = resolveFeePolicy(policy);
  const monthMatch = String(periodKey || "").match(/^\d{4}-(\d{2})$/);
  if (monthMatch) {
    return Number(monthMatch[1]) === Number(resolvedPolicy.annualFeeMonth || 1);
  }
  if (periodDate instanceof Date && !Number.isNaN(periodDate.getTime())) {
    return (periodDate.getMonth() + 1) === Number(resolvedPolicy.annualFeeMonth || 1);
  }
  return false;
}

function isRegisteredCareMode(careMode) {
  return !String(normalizeCareMode(careMode)).startsWith("CASUAL_TRANSIT_");
}

function isInsuranceApplicable({ ageMonths, careMode, isRegistrationMonth, policy = DEFAULT_FEE_POLICY }) {
  const resolvedPolicy = resolveFeePolicy(policy);
  const parsedAge = Number(ageMonths);
  return Boolean(isRegistrationMonth)
    && isRegisteredCareMode(careMode)
    && Number.isFinite(parsedAge)
    && parsedAge >= Number(resolvedPolicy.insurance && resolvedPolicy.insurance.minAgeMonths ? resolvedPolicy.insurance.minAgeMonths : 24);
}

function isTransportEligible({ careMode, policy = DEFAULT_FEE_POLICY }) {
  const resolvedPolicy = resolveFeePolicy(policy);
  const normalizedCareMode = normalizeCareMode(careMode);
  const eligibleCareModes = Array.isArray(resolvedPolicy.transport && resolvedPolicy.transport.eligibleCareModes)
    ? resolvedPolicy.transport.eligibleCareModes.map((entry) => normalizeCareMode(entry))
    : DEFAULT_FEE_POLICY.transport.eligibleCareModes;
  return eligibleCareModes.includes(normalizedCareMode);
}

function baseCodeForCareMode({ careMode, ageBand }) {
  const normalizedCareMode = normalizeCareMode(careMode);
  if (normalizedCareMode === "FULL_TIME") {
    return ageBand && ageBand.codeSuffix === "3m_2y"
      ? "monthly_fulltime_3m_2y"
      : "monthly_fulltime_2y_4y";
  }
  if (normalizedCareMode === "TRANSIT_MONTHLY_HALF_DAY") return "transit_halfday_month";
  if (normalizedCareMode === "TRANSIT_MONTHLY_2_HOURS") return "transit_2h_month";
  if (normalizedCareMode === "TRANSIT_MONTHLY_SCHOOL_HOLIDAY_FULL") return "transit_schoolholiday_month";
  if (normalizedCareMode === "CASUAL_TRANSIT_1_HOUR") return "transit_1hour";
  if (normalizedCareMode === "CASUAL_TRANSIT_1_DAY") return "transit_1day";
  if (normalizedCareMode === "CASUAL_TRANSIT_1_WEEK") return "transit_1week";
  return String(careMode || "").trim();
}

function inferRegistrationType({ baseCode, careMode }) {
  const normalizedCareMode = normalizeCareMode(careMode || baseCode);
  return normalizedCareMode === "FULL_TIME" ? "FULL_TIME" : "MONTHLY_TRANSIT";
}

function registeredBaseLabel(baseCode) {
  switch (String(baseCode || "").trim()) {
    case "monthly_fulltime_3m_2y":
    case "monthly_fulltime_2y_4y":
      return "Yuran Asas Bulanan";
    case "transit_halfday_month":
      return "Transit 1/2 Hari (Bulanan)";
    case "transit_2h_month":
      return "Transit 2 Jam (Bulanan)";
    case "transit_schoolholiday_month":
      return "Transit Penuh Cuti Sekolah (Bulanan)";
    case "transit_1day":
      return "Transit 1 Hari";
    case "transit_1week":
      return "Transit 1 Minggu";
    case "transit_1hour":
      return "Transit 1 Jam";
    default:
      return "Yuran";
  }
}

function buildBaseFeeItem({ baseCode, payerType, table, transitUsage }) {
  const price = lookupPrice({ table, codeCandidates: [baseCode], payerType });
  if (!price) return null;

  if (baseCode === "transit_1day") {
    const quantity = sanitizeQuantity(transitUsage && transitUsage.dayCount ? transitUsage.dayCount : 0);
    if (quantity <= 0) return null;
    return buildLineItem({
      code: price.code,
      label: registeredBaseLabel(baseCode),
      quantity,
      unit: "day",
      unitAmountSen: price.unitAmountSen,
      taxable: false,
      policyKey: "base.transit_1day",
    });
  }

  if (baseCode === "transit_1week") {
    const quantity = sanitizeQuantity(transitUsage && transitUsage.weekCount ? transitUsage.weekCount : 0);
    if (quantity <= 0) return null;
    return buildLineItem({
      code: price.code,
      label: registeredBaseLabel(baseCode),
      quantity,
      unit: "week",
      unitAmountSen: price.unitAmountSen,
      taxable: false,
      policyKey: "base.transit_1week",
    });
  }

  if (baseCode === "transit_1hour") {
    const quantity = sanitizeQuantity(transitUsage && transitUsage.hourCount ? transitUsage.hourCount : 0);
    if (quantity <= 0) return null;
    return buildLineItem({
      code: price.code,
      label: registeredBaseLabel(baseCode),
      quantity,
      unit: "hour",
      unitAmountSen: price.unitAmountSen,
      taxable: false,
      policyKey: "base.transit_1hour",
    });
  }

  return buildLineItem({
    code: price.code,
    label: registeredBaseLabel(baseCode),
    quantity: 1,
    unit: "month",
    unitAmountSen: price.unitAmountSen,
    taxable: false,
    policyKey: `base.${baseCode}`,
  });
}

function startOfLocalDay(date) {
  const parts = malaysiaDateParts(date);
  return malaysiaLocalDate(parts.year, parts.month, parts.day, 0, 0, 0, 0);
}

function addMinutes(date, minuteOffset) {
  return new Date(date.getTime() + (minuteOffset * 60 * 1000));
}

function dayKey(date) {
  const parts = malaysiaDateParts(date);
  return `${parts.year}-${String(parts.month + 1).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function minutesBetween(start, end) {
  const value = (end.getTime() - start.getTime()) / 60000;
  return value > 0 ? value : 0;
}

function overlapMinutes(intervalStart, intervalEnd, windowStart, windowEnd) {
  const start = intervalStart.getTime() > windowStart.getTime() ? intervalStart : windowStart;
  const end = intervalEnd.getTime() < windowEnd.getTime() ? intervalEnd : windowEnd;
  return end.getTime() > start.getTime() ? minutesBetween(start, end) : 0;
}

function windowRangeForDay(dayStart, window) {
  const startMinute = Number(window.startMinute || 0);
  const endMinute = Number(window.endMinute || 0);
  const start = addMinutes(dayStart, startMinute);
  const sameDayEnd = endMinute > startMinute ? addMinutes(dayStart, endMinute) : addMinutes(dayStart, endMinute + (24 * 60));
  return { start, end: sameDayEnd };
}

function roundHours(minutes, roundingMode) {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  const hours = minutes / 60;
  if (String(roundingMode || "").trim().toUpperCase() === "PRO_RATE_BY_MINUTE") {
    return Math.round(hours * 100) / 100;
  }
  return Math.ceil(hours);
}

function aggregateOvertimeFromIntervals({ intervals, policy = DEFAULT_FEE_POLICY }) {
  const resolvedPolicy = resolveFeePolicy(policy);
  const windows = Array.isArray(resolvedPolicy.overtime && resolvedPolicy.overtime.windows)
    ? resolvedPolicy.overtime.windows
    : [];
  const aggregates = new Map();
  for (const window of windows) {
    aggregates.set(window.code, {
      window,
      totalMinutes: 0,
      activeDayKeys: new Set(),
      dailyBreakdown: [],
    });
  }

  for (const interval of intervals || []) {
    const rawEnd = interval && interval.end instanceof Date ? interval.end : null;
    if (!rawEnd || Number.isNaN(rawEnd.getTime())) continue;
    const rawStart = interval && interval.start instanceof Date && !Number.isNaN(interval.start.getTime())
      ? interval.start
      : malaysiaSameDayAt(rawEnd, 17, 30);
    if (rawEnd.getTime() <= rawStart.getTime()) continue;

    let dayCursor = startOfLocalDay(rawStart);
    const finalDay = startOfLocalDay(rawEnd);

    while (dayCursor.getTime() <= finalDay.getTime()) {
      for (const window of windows) {
        const bucket = aggregates.get(window.code);
        if (!bucket) continue;
        const range = windowRangeForDay(dayCursor, window);
        const minutes = overlapMinutes(rawStart, rawEnd, range.start, range.end);
        if (minutes <= 0) continue;
        bucket.totalMinutes += minutes;
        bucket.activeDayKeys.add(dayKey(dayCursor));
        bucket.dailyBreakdown.push({
          dateKey: dayKey(dayCursor),
          code: window.code,
          label: String(window.label || window.code || "").trim(),
          minutes: Math.round(minutes),
        });
      }
      dayCursor = addMinutes(dayCursor, 24 * 60);
    }
  }

  const overtimeRows = [];
  for (const value of aggregates.values()) {
    overtimeRows.push({
      code: value.window.code,
      label: value.window.label,
      unit: value.window.unit || "hour",
      manualKey: value.window.manualKey,
      totalMinutes: Math.round(value.totalMinutes),
      activeDayCount: value.activeDayKeys.size,
      managementReviewThresholdDays: Number(value.window.managementReviewThresholdDays || 0),
      dailyBreakdown: value.dailyBreakdown,
    });
  }
  return overtimeRows;
}

function overtimeLineItemsFromManual({ manualOvertime, payerType, table, policy = DEFAULT_FEE_POLICY }) {
  const resolvedPolicy = resolveFeePolicy(policy);
  const windows = Array.isArray(resolvedPolicy.overtime && resolvedPolicy.overtime.windows)
    ? resolvedPolicy.overtime.windows
    : [];
  const items = [];
  const breakdown = [];
  let totalSen = 0;
  for (const window of windows) {
    const quantity = sanitizeQuantity(manualOvertime && Object.prototype.hasOwnProperty.call(manualOvertime, window.manualKey)
      ? manualOvertime[window.manualKey]
      : 0);
    if (quantity <= 0) continue;
    const price = lookupPrice({ table, codeCandidates: [window.code], payerType });
    if (!price) continue;
    const lineItem = buildLineItem({
      code: price.code,
      label: String(window.label || window.code || "Overtime").trim(),
      quantity,
      unit: window.unit || "hour",
      unitAmountSen: price.unitAmountSen,
      taxable: false,
      notes: ["Manual overtime override"],
      policyKey: `${resolvedPolicy.overtime.policyKey}.${window.code}`,
    });
    items.push(lineItem);
    totalSen += moneySen(lineItem.amountSen);
    breakdown.push({
      code: window.code,
      quantity,
      totalMinutes: Math.round(quantity * 60),
      activeDayCount: 0,
      dailyBreakdown: [],
    });
  }
  return {
    items,
    totalSen: moneySen(totalSen),
    breakdown,
    managementReviewRecommended: false,
  };
}

function calculateOvertimeCharge({ intervals, manualOvertime, payerType, table, policy = DEFAULT_FEE_POLICY }) {
  if (manualOvertime && typeof manualOvertime === "object") {
    return overtimeLineItemsFromManual({ manualOvertime, payerType, table, policy });
  }

  const resolvedPolicy = resolveFeePolicy(policy);
  const aggregated = aggregateOvertimeFromIntervals({ intervals, policy: resolvedPolicy });
  const items = [];
  let totalSen = 0;
  let managementReviewRecommended = false;
  const roundingMode = String(resolvedPolicy.overtime && resolvedPolicy.overtime.roundingMode
    ? resolvedPolicy.overtime.roundingMode
    : DEFAULT_FEE_POLICY.overtime.roundingMode).trim().toUpperCase();

  for (const bucket of aggregated) {
    if (bucket.totalMinutes <= 0) continue;
    const price = lookupPrice({ table, codeCandidates: [bucket.code], payerType });
    if (!price) continue;
    const quantity = roundHours(bucket.totalMinutes, roundingMode);
    if (quantity <= 0) continue;
    bucket.quantity = quantity;
    const lineItem = buildLineItem({
      code: price.code,
      label: String(bucket.label || bucket.code || "Overtime").trim(),
      quantity,
      unit: bucket.unit || "hour",
      unitAmountSen: price.unitAmountSen,
      taxable: false,
      notes: [`${bucket.totalMinutes} min overtime`],
      policyKey: `${resolvedPolicy.overtime.policyKey}.${bucket.code}`,
    });
    items.push(lineItem);
    totalSen += moneySen(lineItem.amountSen);
    if (bucket.managementReviewThresholdDays > 0 && bucket.activeDayCount > bucket.managementReviewThresholdDays) {
      managementReviewRecommended = true;
    }
  }

  return {
    items,
    totalSen: moneySen(totalSen),
    breakdown: aggregated,
    managementReviewRecommended,
  };
}

function generateInvoiceLineItems({
  periodKey,
  periodDate,
  payerType,
  table,
  policy,
  careMode,
  baseCode,
  ageMonths,
  isRegistrationMonth,
  transportUsed,
  transitUsage,
  attendanceRows,
  overtimeChargeOverride,
  manualOvertime,
  absenceAdjustment,
}) {
  const resolvedPolicy = resolveFeePolicy(policy);
  const normalizedPayerType = normalizePayerType(payerType);
  const ageBand = determineAgeBand(ageMonths, resolvedPolicy);
  const normalizedCareMode = normalizeCareMode(careMode || baseCode);
  const resolvedBaseCode = String(baseCode || baseCodeForCareMode({ careMode: normalizedCareMode, ageBand })).trim();
  const items = [];
  const policyNotes = [];

  const baseItem = buildBaseFeeItem({
    baseCode: resolvedBaseCode,
    payerType: normalizedPayerType,
    table,
    transitUsage,
  });
  if (baseItem) {
    items.push(baseItem);
  }

  const registrationType = inferRegistrationType({ baseCode: resolvedBaseCode, careMode: normalizedCareMode });
  const registrationConfig = resolvedPolicy.registration && resolvedPolicy.registration[registrationType]
    ? resolvedPolicy.registration[registrationType]
    : null;
  if (registrationConfig && isRegistrationMonth) {
    const registrationPrice = lookupPrice({
      table,
      codeCandidates: registrationConfig.codeCandidates,
      payerType: normalizedPayerType,
    });
    if (registrationPrice) {
      items.push(buildLineItem({
        code: registrationPrice.code,
        label: registrationConfig.label,
        quantity: 1,
        unit: registrationConfig.unit,
        unitAmountSen: registrationPrice.unitAmountSen,
        taxable: false,
        policyKey: registrationConfig.policyKey,
      }));
    }

    const bookPrice = lookupPrice({
      table,
      codeCandidates: resolvedPolicy.communicationBook && resolvedPolicy.communicationBook.codeCandidates,
      payerType: normalizedPayerType,
    });
    if (bookPrice && isRegisteredCareMode(normalizedCareMode)) {
      items.push(buildLineItem({
        code: bookPrice.code,
        label: resolvedPolicy.communicationBook.label,
        quantity: 1,
        unit: resolvedPolicy.communicationBook.unit,
        unitAmountSen: bookPrice.unitAmountSen,
        taxable: false,
        policyKey: resolvedPolicy.communicationBook.policyKey,
      }));
    }

    if (isInsuranceApplicable({
      ageMonths,
      careMode: normalizedCareMode,
      isRegistrationMonth,
      policy: resolvedPolicy,
    })) {
      const insurancePrice = lookupPrice({
        table,
        codeCandidates: resolvedPolicy.insurance && resolvedPolicy.insurance.codeCandidates,
        payerType: normalizedPayerType,
      });
      if (insurancePrice) {
        items.push(buildLineItem({
          code: insurancePrice.code,
          label: resolvedPolicy.insurance.label,
          quantity: 1,
          unit: resolvedPolicy.insurance.unit,
          unitAmountSen: insurancePrice.unitAmountSen,
          taxable: false,
          policyKey: resolvedPolicy.insurance.policyKey,
        }));
      }
    }
  }

  if (isRegisteredCareMode(normalizedCareMode) && isJanuaryInvoice({ periodKey, periodDate, policy: resolvedPolicy })) {
    const annualFeePrice = lookupPrice({
      table,
      codeCandidates: resolvedPolicy.annualFee && resolvedPolicy.annualFee.codeCandidates,
      payerType: normalizedPayerType,
    });
    if (annualFeePrice) {
      items.push(buildLineItem({
        code: annualFeePrice.code,
        label: resolvedPolicy.annualFee.label,
        quantity: 1,
        unit: resolvedPolicy.annualFee.unit,
        unitAmountSen: annualFeePrice.unitAmountSen,
        taxable: false,
        policyKey: resolvedPolicy.annualFee.policyKey,
      }));
    }
  }

  if (transportUsed && isTransportEligible({ careMode: normalizedCareMode, policy: resolvedPolicy })) {
    const transportPrice = lookupPrice({
      table,
      codeCandidates: resolvedPolicy.transport && resolvedPolicy.transport.codeCandidates,
      payerType: normalizedPayerType,
    });
    if (transportPrice) {
      items.push(buildLineItem({
        code: transportPrice.code,
        label: resolvedPolicy.transport.label,
        quantity: 1,
        unit: resolvedPolicy.transport.unit,
        unitAmountSen: transportPrice.unitAmountSen,
        taxable: false,
        policyKey: resolvedPolicy.transport.policyKey,
      }));
    }
  }

  const intervals = (attendanceRows || []).map((row) => ({
    start: asDate(row && (row.checkInAt || row.check_in_time || row.checkInTime || row.checkinTime)),
    end: asDate(row && (row.checkOutAt || row.check_out_time || row.checkOutTime || row.checkoutTime)),
  }));
  const overtime = overtimeChargeOverride && typeof overtimeChargeOverride === "object"
    ? {
      items: Array.isArray(overtimeChargeOverride.items) ? overtimeChargeOverride.items : [],
      totalSen: moneySen(overtimeChargeOverride.totalSen),
      breakdown: Array.isArray(overtimeChargeOverride.breakdown) ? overtimeChargeOverride.breakdown : [],
      managementReviewRecommended: Boolean(overtimeChargeOverride.managementReviewRecommended),
    }
    : calculateOvertimeCharge({
      intervals,
      manualOvertime,
      payerType: normalizedPayerType,
      table,
      policy: resolvedPolicy,
    });
  items.push(...overtime.items);

  const absenceDaysWithLetter = Number(absenceAdjustment && absenceAdjustment.absenceDaysWithLetter ? absenceAdjustment.absenceDaysWithLetter : 0);
  const hasAbsenceLetter = Boolean(absenceAdjustment && absenceAdjustment.hasAbsenceLetter);
  if (hasAbsenceLetter && absenceDaysWithLetter > Number(resolvedPolicy.absenceDiscountMinDaysWithLetter || 14)) {
    const discountSource = items.find((item) => item && String(item.code || "").trim() === resolvedBaseCode);
    if (discountSource && moneySen(discountSource.amountSen) > 0) {
      const discountSen = moneySen(discountSource.amountSen * (Number(resolvedPolicy.absenceDiscountPercent || 10) / 100));
      if (discountSen > 0) {
        items.push(buildLineItem({
          code: "discount_absence_14days",
          label: `Potongan ${Number(resolvedPolicy.absenceDiscountPercent || 10)}% (Tidak Hadir >14 Hari + Surat)`,
          quantity: 1,
          unit: "discount",
          unitAmountSen: -discountSen,
          taxable: false,
          policyKey: "absence.discount_with_letter",
        }));
      }
    }
  }

  if (isRegistrationMonth) {
    policyNotes.push("Yuran pendaftaran dikenakan sekali sahaja pada bulan pendaftaran.");
  }
  if (hasAbsenceLetter && absenceDaysWithLetter > Number(resolvedPolicy.absenceDiscountMinDaysWithLetter || 14)) {
    policyNotes.push("Potongan 10% telah digunakan kerana tidak hadir melebihi 14 hari dengan surat.");
  }
  if (overtime.managementReviewRecommended) {
    policyNotes.push("Rekod lebih masa melebihi ambang semakan pengurusan.");
  }
  if (ageBand.ageOutOfPolicy) {
    policyNotes.push("Umur kanak-kanak berada di luar julat polisi standard dan wajar disemak secara manual.");
  }

  const subTotalSen = items.reduce((sum, item) => sum + moneySen(item.amountSen), 0);
  return {
    items,
    subTotalSen: moneySen(subTotalSen),
    totalSen: moneySen(subTotalSen),
    baseCode: resolvedBaseCode,
    ageBand,
    overtime,
    policyNotes: dedupeNotes(policyNotes),
    managementReviewRecommended: Boolean(overtime.managementReviewRecommended || ageBand.ageOutOfPolicy),
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
  const periodDate = input && input.periodDate instanceof Date
    ? input.periodDate
    : new Date(Number(input && input.year ? input.year : new Date().getFullYear()), 0, 1);
  return generateInvoiceLineItems({
    ...input,
    periodDate,
    periodKey: input && input.periodKey ? input.periodKey : `${periodDate.getFullYear()}-01`,
  });
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
  const baseCode = baseCodeForCareMode({ careMode: normalizedCareMode, ageBand });
  const basePrice = lookupPrice({ table, codeCandidates: [baseCode], payerType: normalizedPayerType });
  const items = [];

  if (basePrice) {
    items.push(buildLineItem({
      code: basePrice.code,
      label: registeredBaseLabel(baseCode),
      quantity: 1,
      unit: normalizedCareMode === "CASUAL_TRANSIT_1_HOUR"
        ? "hour"
        : (normalizedCareMode === "CASUAL_TRANSIT_1_WEEK" ? "week" : "day"),
      unitAmountSen: basePrice.unitAmountSen,
      taxable: false,
      policyKey: `casual.${baseCode}`,
    }));
  }

  const overtime = calculateOvertimeCharge({
    intervals: [{
      start: checkInAt instanceof Date ? checkInAt : null,
      end: actualCheckOutAt instanceof Date ? actualCheckOutAt : null,
    }],
    payerType: normalizedPayerType,
    table,
    policy: resolvedPolicy,
  });
  items.push(...overtime.items);

  const baseAmountSen = items.length > 0 ? moneySen(items[0].amountSen) : 0;
  const overtimeAmountSen = overtime.items.reduce((sum, item) => sum + moneySen(item.amountSen), 0);
  const totalAmountSen = items.reduce((sum, item) => sum + moneySen(item.amountSen), 0);

  return {
    items,
    baseAmountSen: moneySen(baseAmountSen),
    overtimeAmountSen: moneySen(overtimeAmountSen),
    totalAmountSen: moneySen(totalAmountSen),
    ageBand,
    transitType: normalizedCareMode,
    staffType: normalizedPayerType === "staff" ? "STAFF" : "NON_STAFF",
    overtimeStrategySnapshot: String(resolvedPolicy.overtime && resolvedPolicy.overtime.roundingMode
      ? resolvedPolicy.overtime.roundingMode
      : DEFAULT_FEE_POLICY.overtime.roundingMode),
    overtimeBreakdown: overtime.breakdown,
    managementReviewRecommended: Boolean(overtime.managementReviewRecommended || ageBand.ageOutOfPolicy),
  };
}

module.exports = {
  DEFAULT_FEE_POLICY,
  resolveFeePolicy,
  determineAgeBand,
  isInsuranceApplicable,
  isJanuaryInvoice,
  calculateRegistrationInvoice,
  calculateMonthlyInvoice,
  calculateJanuaryInvoice,
  calculateCasualTransitCharge,
  calculateOvertimeCharge,
  generateInvoiceLineItems,
  baseCodeForCareMode,
  normalizeCareMode,
  lookupPrice,
};