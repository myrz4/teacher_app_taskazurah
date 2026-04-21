/* eslint-disable no-console */
const feeEngine = require("./fee-engine");

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertAmount(items, code, amountSen, message) {
  const item = (items || []).find((entry) => String(entry && entry.code ? entry.code : "") === code);
  assertTrue(Boolean(item), `${message}: missing ${code}`);
  assertTrue(Number(item.amountSen || 0) === amountSen, `${message}: expected ${amountSen} for ${code}, got ${item.amountSen}`);
}

const table = {
  version: "unit-test",
  table: {
    monthly_fulltime_3m_2y: { staff: 35000, nonstaff: 40000 },
    monthly_fulltime_2y_4y: { staff: 30000, nonstaff: 35000 },
    transit_halfday_month: { staff: 15000, nonstaff: 25000 },
    transit_2h_month: { staff: 10000, nonstaff: 18000 },
    transit_schoolholiday_month: { staff: 25000, nonstaff: 30000 },
    transit_1day: { staff: 1500, nonstaff: 2000 },
    transit_1week: { staff: 7000, nonstaff: 10000 },
    transit_1hour: { staff: 350, nonstaff: 400 },
    overtime_after_530: { staff: 500, nonstaff: 600 },
    overtime_8pm_12am: { staff: 1000, nonstaff: 1300 },
    transport_tadika_month: { staff: 15000, nonstaff: 15000 },
    registration_fulltime_oneoff: { staff: 10000, nonstaff: 10000 },
    registration_transit_oneoff: { staff: 5000, nonstaff: 5000 },
    annual_fee_yearly: { staff: 10000, nonstaff: 10000 },
    comms_book_oneoff: { staff: 1500, nonstaff: 1500 },
    insurance_oneoff_age2plus: { staff: 2000, nonstaff: 2000 },
  },
};

function runAgeBandChecks() {
  const age23 = feeEngine.determineAgeBand(23);
  const age24 = feeEngine.determineAgeBand(24);
  const age47 = feeEngine.determineAgeBand(47);
  const age48 = feeEngine.determineAgeBand(48);

  assertTrue(age23.codeSuffix === "3m_2y" && age23.ageOutOfPolicy === false, "23 months should stay in 3m_2y band");
  assertTrue(age24.codeSuffix === "2y_4y" && age24.ageOutOfPolicy === false, "24 months should move to 2y_4y band");
  assertTrue(age47.codeSuffix === "2y_4y" && age47.ageOutOfPolicy === false, "47 months should stay in 2y_4y band");
  assertTrue(age48.ageOutOfPolicy === true && age48.agePolicyReason === "age_4y_or_above", "48 months should require review");
  console.log("PASS age-band edges");
}

function runRegistrationChecks() {
  const registrationInvoice = feeEngine.calculateRegistrationInvoice({
    periodKey: "2026-03",
    periodDate: new Date(2026, 2, 1),
    payerType: "nonstaff",
    table,
    careMode: "fulltime",
    ageMonths: 12,
    baseCode: "monthly_fulltime_3m_2y",
    isRegistrationMonth: true,
    transportUsed: true,
    transitUsage: {},
    attendanceRows: [],
    absenceAdjustment: { hasAbsenceLetter: false, absenceDaysWithLetter: 0 },
  });

  assertAmount(registrationInvoice.items, "monthly_fulltime_3m_2y", 40000, "registration invoice should include full-time base");
  assertAmount(registrationInvoice.items, "registration_fulltime_oneoff", 10000, "registration invoice should add registration fee");
  assertAmount(registrationInvoice.items, "comms_book_oneoff", 1500, "registration invoice should add communication book once");
  assertAmount(registrationInvoice.items, "transport_tadika_month", 15000, "registration invoice should add transport when enabled");
  assertTrue(!registrationInvoice.items.some((item) => item.code === "insurance_oneoff_age2plus"), "registration invoice should not add insurance below age 2");
  console.log("PASS registration stacking + transport");

  const olderRegistration = feeEngine.calculateRegistrationInvoice({
    periodKey: "2026-03",
    periodDate: new Date(2026, 2, 1),
    payerType: "nonstaff",
    table,
    careMode: "fulltime",
    ageMonths: 30,
    baseCode: "monthly_fulltime_2y_4y",
    isRegistrationMonth: true,
    transportUsed: false,
    transitUsage: {},
    attendanceRows: [],
    absenceAdjustment: { hasAbsenceLetter: false, absenceDaysWithLetter: 0 },
  });
  assertAmount(olderRegistration.items, "insurance_oneoff_age2plus", 2000, "registration invoice should add insurance once at age 2+");
  console.log("PASS registration insurance threshold");
}

function runJanuaryChecks() {
  const januaryInvoice = feeEngine.calculateJanuaryInvoice({
    year: 2026,
    payerType: "nonstaff",
    table,
    careMode: "fulltime",
    ageMonths: 30,
    baseCode: "monthly_fulltime_2y_4y",
    transportUsed: false,
    transitUsage: {},
    attendanceRows: [],
    absenceAdjustment: { hasAbsenceLetter: false, absenceDaysWithLetter: 0 },
  });

  assertAmount(januaryInvoice.items, "monthly_fulltime_2y_4y", 35000, "January invoice should include monthly base");
  assertAmount(januaryInvoice.items, "annual_fee_yearly", 10000, "January invoice should include annual fee");
  assertTrue(!januaryInvoice.items.some((item) => item.code === "comms_book_oneoff"), "January invoice should not repeat communication book");
  assertTrue(!januaryInvoice.items.some((item) => item.code === "insurance_oneoff_age2plus"), "January invoice should not repeat insurance");
  console.log("PASS January rules");
}

function runAbsenceDiscountChecks() {
  const discountedInvoice = feeEngine.calculateMonthlyInvoice({
    periodKey: "2026-04",
    periodDate: new Date(2026, 3, 1),
    payerType: "nonstaff",
    table,
    careMode: "fulltime",
    ageMonths: 20,
    baseCode: "monthly_fulltime_3m_2y",
    transportUsed: false,
    transitUsage: {},
    attendanceRows: [],
    absenceAdjustment: { hasAbsenceLetter: true, absenceDaysWithLetter: 15 },
  });

  assertAmount(discountedInvoice.items, "discount_absence_14days", -4000, "absence discount should reduce 10 percent of the base");
  console.log("PASS absence discount");
}

function runOvertimeChecks() {
  const overtimeInvoice = feeEngine.calculateMonthlyInvoice({
    periodKey: "2026-04",
    periodDate: new Date(2026, 3, 1),
    payerType: "nonstaff",
    table,
    careMode: "transit_2h_month",
    ageMonths: 30,
    baseCode: "transit_2h_month",
    transportUsed: false,
    transitUsage: {},
    attendanceRows: [
      {
        checkInAt: new Date(2026, 3, 10, 17, 0, 0),
        checkOutAt: new Date(2026, 3, 10, 21, 10, 0),
      },
    ],
    absenceAdjustment: { hasAbsenceLetter: false, absenceDaysWithLetter: 0 },
  });

  assertAmount(overtimeInvoice.items, "overtime_after_530", 1800, "after-5:30 overtime should round 2.5 hours to 3 hours");
  assertAmount(overtimeInvoice.items, "overtime_8pm_12am", 2600, "8pm-12am overtime should round 70 minutes to 2 hours");

  console.log("PASS overtime windows and rounding");
}

function runCasualTransitChecks() {
  const casualCharge = feeEngine.calculateCasualTransitCharge({
    payerType: "nonstaff",
    transitType: "1 Day",
    ageMonths: 36,
    checkInAt: new Date(2026, 3, 10, 14, 0, 0),
    actualCheckOutAt: new Date(2026, 3, 10, 19, 0, 0),
    table,
  });

  assertTrue(casualCharge.transitType === "CASUAL_TRANSIT_1_DAY", "casual transit type should normalize to 1 day");
  assertTrue(casualCharge.baseAmountSen === 2000, `casual transit base should be 2000, got ${casualCharge.baseAmountSen}`);
  assertTrue(casualCharge.overtimeAmountSen === 1200, `casual transit overtime should be 1200, got ${casualCharge.overtimeAmountSen}`);
  assertTrue(casualCharge.totalAmountSen === 3200, `casual transit total should be 3200, got ${casualCharge.totalAmountSen}`);
  console.log("PASS casual transit totals");
}

function run() {
  runAgeBandChecks();
  runRegistrationChecks();
  runJanuaryChecks();
  runAbsenceDiscountChecks();
  runOvertimeChecks();
  runCasualTransitChecks();
  console.log("All fee engine checks passed.");
}

run();
