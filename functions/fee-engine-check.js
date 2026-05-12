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

function myDate(year, month, day, hour = 0, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0));
}

function withLocalTime(anchorDate, hour, minute = 0) {
  const shifted = new Date(anchorDate.getTime() + (8 * 60 * 60 * 1000));
  return myDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), hour, minute);
}

function findDateByWeekday(year, month, weekday) {
  for (let day = 1; day <= 31; day += 1) {
    const candidate = myDate(year, month, day, 12, 0);
    if (candidate.getUTCMonth() !== (month - 1)) {
      break;
    }
    const schedule = feeEngine.getOperatingHoursForDate(candidate);
    if (schedule.dayOfWeek === weekday) {
      return candidate;
    }
  }
  throw new Error(`No weekday ${weekday} found for ${year}-${month}`);
}

const catalog = feeEngine.buildDefaultCatalog();

function runAgeBandChecks() {
  const newborn = feeEngine.determineAgeBand(0);
  const age23 = feeEngine.determineAgeBand(23);
  const age24 = feeEngine.determineAgeBand(24);
  const age48 = feeEngine.determineAgeBand(48);
  const age60 = feeEngine.determineAgeBand(60);

  assertTrue(newborn.codeSuffix === "BABY_TO_2" && newborn.ageOutOfPolicy === false, "newborn should stay in BABY_TO_2 band");
  assertTrue(age23.codeSuffix === "BABY_TO_2" && age23.ageOutOfPolicy === false, "23 months should stay in BABY_TO_2 band");
  assertTrue(age24.codeSuffix === "AGE_2_TO_3" && age24.ageOutOfPolicy === false, "24 months should move to AGE_2_TO_3 band");
  assertTrue(age48.codeSuffix === "AGE_4" && age48.ageOutOfPolicy === false, "48 months should move to AGE_4 band");
  assertTrue(age60.codeSuffix === "AGE_4" && age60.ageOutOfPolicy === true && age60.agePolicyReason === "age_5_or_above", "60 months should require review");
  console.log("PASS age-band edges");
}

function runRegistrationChecks() {
  const babyRegistration = feeEngine.calculateRegistrationInvoice({
    periodKey: "2026-04",
    periodDate: myDate(2026, 4, 1),
    registrationDate: myDate(2026, 4, 5),
    payerType: "nonstaff",
    table: catalog,
    careMode: "fulltime",
    ageMonths: 12,
  });

  assertAmount(babyRegistration.items, "monthly_fee", 75000, "baby registration should include monthly fee");
  assertAmount(babyRegistration.items, "registration_fee", 10000, "baby registration should include registration fee");
  assertAmount(babyRegistration.items, "insurance_takaful", 1500, "baby registration should include insurance/takaful");
  assertAmount(babyRegistration.items, "yearly_maintenance_fee", 40000, "baby registration should include yearly maintenance fee");
  assertTrue(Number(babyRegistration.totalSen) === 126500, `baby registration total should be 126500, got ${babyRegistration.totalSen}`);
  assertTrue(babyRegistration.items.every((item) => !["comms_book_oneoff", "transport_tadika_month", "twinkling_apps"].includes(item.code)), "registration should exclude old TPPM extras and Twinkling Apps");
  assertTrue(babyRegistration.yearlyFeeCoveredYear === 2026, `April registration should cover 2026, got ${babyRegistration.yearlyFeeCoveredYear}`);

  const age2To3Registration = feeEngine.calculateRegistrationInvoice({
    periodKey: "2026-04",
    periodDate: myDate(2026, 4, 1),
    registrationDate: myDate(2026, 4, 5),
    payerType: "nonstaff",
    table: catalog,
    careMode: "fulltime",
    ageMonths: 30,
  });
  assertTrue(Number(age2To3Registration.totalSen) === 121500, `age 2 to 3 registration total should be 121500, got ${age2To3Registration.totalSen}`);

  const age4Registration = feeEngine.calculateRegistrationInvoice({
    periodKey: "2026-04",
    periodDate: myDate(2026, 4, 1),
    registrationDate: myDate(2026, 4, 5),
    payerType: "nonstaff",
    table: catalog,
    careMode: "fulltime",
    ageMonths: 50,
  });
  assertTrue(Number(age4Registration.totalSen) === 116500, `age 4 registration total should be 116500, got ${age4Registration.totalSen}`);
  console.log("PASS registration totals");
}

function runStaffNeutralChecks() {
  const staffInvoice = feeEngine.calculateRegistrationInvoice({
    periodKey: "2026-04",
    periodDate: myDate(2026, 4, 1),
    registrationDate: myDate(2026, 4, 5),
    payerType: "staff",
    table: catalog,
    careMode: "fulltime",
    ageMonths: 30,
  });
  const nonStaffInvoice = feeEngine.calculateRegistrationInvoice({
    periodKey: "2026-04",
    periodDate: myDate(2026, 4, 1),
    registrationDate: myDate(2026, 4, 5),
    payerType: "nonstaff",
    table: catalog,
    careMode: "fulltime",
    ageMonths: 30,
  });
  assertTrue(staffInvoice.totalSen === nonStaffInvoice.totalSen, "registered-child billing should ignore staff/non-staff pricing");
  console.log("PASS staff-neutral registered billing");
}

function runYearlyMaintenanceChecks() {
  const january2027 = feeEngine.calculateMonthlyInvoice({
    periodKey: "2027-01",
    periodDate: myDate(2027, 1, 1),
    registrationDate: myDate(2026, 4, 5),
    yearlyFeeCoveredYear: 2026,
    payerType: "nonstaff",
    table: catalog,
    careMode: "fulltime",
    ageMonths: 15,
  });
  assertAmount(january2027.items, "yearly_maintenance_fee", 40000, "January after a normal registration should include yearly maintenance");

  const novemberRegistrationCoveredYear = feeEngine.determineYearlyFeeCoveredYear(myDate(2026, 11, 15));
  assertTrue(novemberRegistrationCoveredYear === 2027, `November registration should cover 2027, got ${novemberRegistrationCoveredYear}`);

  const januaryAfterNovember = feeEngine.calculateMonthlyInvoice({
    periodKey: "2027-01",
    periodDate: myDate(2027, 1, 1),
    registrationDate: myDate(2026, 11, 15),
    yearlyFeeCoveredYear: novemberRegistrationCoveredYear,
    payerType: "nonstaff",
    table: catalog,
    careMode: "fulltime",
    ageMonths: 14,
  });
  assertTrue(!januaryAfterNovember.items.some((item) => item.code === "yearly_maintenance_fee"), "November registration should skip the coming January yearly maintenance");

  const january2028AfterNovember = feeEngine.calculateMonthlyInvoice({
    periodKey: "2028-01",
    periodDate: myDate(2028, 1, 1),
    registrationDate: myDate(2026, 11, 15),
    yearlyFeeCoveredYear: novemberRegistrationCoveredYear,
    payerType: "nonstaff",
    table: catalog,
    careMode: "fulltime",
    ageMonths: 26,
  });
  assertAmount(january2028AfterNovember.items, "yearly_maintenance_fee", 40000, "The January after the carry-forward year should charge yearly maintenance again");
  console.log("PASS yearly maintenance carry-forward rules");
}

function runInvoiceScheduleChecks() {
  const cycle = feeEngine.determineOvertimeCycleForInvoice({
    invoiceMonth: myDate(2026, 5, 1),
    registrationDate: myDate(2026, 4, 1),
  });
  assertTrue(cycle.applies === true, "May invoice should have an overtime cycle for an April 1 registration");
  assertTrue(cycle.cycleStartDateKey === "2026-04-01", `First overtime cycle should start on registration date, got ${cycle.cycleStartDateKey}`);
  assertTrue(cycle.cycleEndDateKey === "2026-04-20", `First overtime cycle should end on 2026-04-20, got ${cycle.cycleEndDateKey}`);

  const missedCutoffCycle = feeEngine.determineOvertimeCycleForInvoice({
    invoiceMonth: myDate(2026, 5, 1),
    registrationDate: myDate(2026, 4, 22),
  });
  assertTrue(missedCutoffCycle.applies === false, "May invoice should not include overtime when registration is after the April 20 cycle end");
  console.log("PASS invoice schedule cycle edges");
}

function runOperatingHoursChecks() {
  const monday = findDateByWeekday(2026, 5, 1);
  const saturday = findDateByWeekday(2026, 5, 6);
  const sunday = findDateByWeekday(2026, 5, 0);

  const mondayCheckIn = feeEngine.canCheckIn(withLocalTime(monday, 7, 0));
  const mondayTooEarly = feeEngine.canCheckIn(withLocalTime(monday, 6, 59));
  const saturdayCheckIn = feeEngine.canCheckIn(withLocalTime(saturday, 7, 0));
  const sundayCheckIn = feeEngine.canCheckIn(withLocalTime(sunday, 10, 0));
  const lateCheckout = feeEngine.canCheckOut(withLocalTime(saturday, 16, 0));

  assertTrue(mondayCheckIn.ok === true, "Monday 7:00 AM should allow check-in");
  assertTrue(mondayTooEarly.ok === false && mondayTooEarly.reason === "outside-working-hours", "Monday before 7:00 AM should be outside working hours");
  assertTrue(saturdayCheckIn.ok === true, "Saturday 7:00 AM should allow check-in");
  assertTrue(sundayCheckIn.ok === false && sundayCheckIn.reason === "taska-closed", "Sunday check-in should be blocked");
  assertTrue(lateCheckout.ok === true, "Checkout after closing time should still be allowed");
  console.log("PASS operating hours check-in and checkout rules");
}

function runOvertimeChecks() {
  const monday = findDateByWeekday(2026, 5, 1);
  const saturday = findDateByWeekday(2026, 5, 6);

  const mondayTenPast = feeEngine.calculateOvertimeForAttendance({
    date: monday,
    checkOutAt: withLocalTime(monday, 19, 10),
  });
  assertTrue(mondayTenPast.totalSen === 500, `Monday 7:10 PM should charge RM5, got ${mondayTenPast.totalSen}`);

  const mondayEightOhFive = feeEngine.calculateOvertimeForAttendance({
    date: monday,
    checkOutAt: withLocalTime(monday, 20, 5),
  });
  assertTrue(mondayEightOhFive.totalSen === 1500, `Monday 8:05 PM should charge RM15, got ${mondayEightOhFive.totalSen}`);

  const saturdayThreePm = feeEngine.calculateOvertimeForAttendance({
    date: saturday,
    checkOutAt: withLocalTime(saturday, 15, 0),
  });
  assertTrue(saturdayThreePm.totalSen === 600, `Saturday 3:00 PM should charge RM6, got ${saturdayThreePm.totalSen}`);

  const saturdayFourTen = feeEngine.calculateOvertimeForAttendance({
    date: saturday,
    checkOutAt: withLocalTime(saturday, 16, 10),
  });
  assertTrue(saturdayFourTen.totalSen === 2400, `Saturday 4:10 PM should charge RM24, got ${saturdayFourTen.totalSen}`);

  const overtimeInvoice = feeEngine.calculateMonthlyInvoice({
    periodKey: "2026-06",
    periodDate: myDate(2026, 6, 1),
    registrationDate: myDate(2026, 4, 1),
    yearlyFeeCoveredYear: 2026,
    payerType: "nonstaff",
    table: catalog,
    careMode: "fulltime",
    ageMonths: 16,
    attendanceRows: [
      { date: monday, checkOutAt: withLocalTime(monday, 19, 10) },
      { date: saturday, checkOutAt: withLocalTime(saturday, 15, 0) },
    ],
  });
  assertAmount(overtimeInvoice.items, "overtime_charge", 1100, "Overtime should appear as a separate invoice line item");
  console.log("PASS overtime rates and separate line item");
}

function runOvertimeCycleLabelChecks() {
  const cycle = feeEngine.determineOvertimeCycleForInvoice({
    invoiceMonth: myDate(2026, 5, 1),
    registrationDate: myDate(2026, 1, 1),
    policy: catalog.policy,
  });
  assertTrue(feeEngine.malaysiaDateKey(cycle.cycleStart) === "2026-03-21", `May invoice overtime should start on 2026-03-21, got ${feeEngine.malaysiaDateKey(cycle.cycleStart)}`);
  assertTrue(feeEngine.malaysiaDateKey(cycle.cycleEnd) === "2026-04-20", `May invoice overtime should end on 2026-04-20, got ${feeEngine.malaysiaDateKey(cycle.cycleEnd)}`);

  const marchOnlyDay = myDate(2026, 3, 25);
  const marchOnlyCharge = feeEngine.calculateOvertimeForCycle({
    attendanceRows: [
      { date: marchOnlyDay, checkOutAt: withLocalTime(marchOnlyDay, 19, 10) },
    ],
    cycleStart: cycle.cycleStart,
    cycleEnd: cycle.cycleEnd,
    policy: catalog.policy,
  });
  assertTrue(marchOnlyCharge.totalSen === 500, `March-only overtime in the closed cycle should still bill RM5, got ${marchOnlyCharge.totalSen}`);

  const lineDescription = feeEngine.formatOvertimeLineDescription({
    label: "Overtime Charge",
    cycleStart: cycle.cycleStart,
    cycleEnd: cycle.cycleEnd,
    breakdown: marchOnlyCharge.breakdown,
    weekdayBlocks: marchOnlyCharge.weekdayBlocks,
    saturdayBlocks: marchOnlyCharge.saturdayBlocks,
    policy: catalog.policy,
  });
  assertTrue(lineDescription.includes("2026-03-21 to 2026-04-20"), `Overtime line should show the full 21st-to-20th range, got ${lineDescription}`);
  assertTrue(lineDescription.includes("Weekday RM5.00/30 min"), `Overtime line should show the weekday rate even for March-only overtime, got ${lineDescription}`);
  console.log("PASS overtime cycle label and rate summary");
}

function runCasualTransitChecks() {
  const monday = findDateByWeekday(2026, 5, 1);
  const casualCharge = feeEngine.calculateCasualTransitCharge({
    payerType: "nonstaff",
    transitType: "1 Day",
    ageMonths: 36,
    checkInAt: withLocalTime(monday, 14, 0),
    actualCheckOutAt: withLocalTime(monday, 19, 10),
    table: catalog,
  });

  assertTrue(casualCharge.transitType === "CASUAL_TRANSIT_1_DAY", "Casual transit type should normalize to 1 day");
  assertTrue(casualCharge.baseAmountSen === 2000, `Casual transit base should stay 2000, got ${casualCharge.baseAmountSen}`);
  assertTrue(casualCharge.overtimeAmountSen === 500, `Casual transit overtime should use new overtime rules, got ${casualCharge.overtimeAmountSen}`);
  console.log("PASS casual transit remains separate");
}

function run() {
  runAgeBandChecks();
  runRegistrationChecks();
  runStaffNeutralChecks();
  runYearlyMaintenanceChecks();
  runInvoiceScheduleChecks();
  runOperatingHoursChecks();
  runOvertimeChecks();
  runOvertimeCycleLabelChecks();
  runCasualTransitChecks();
  console.log("All fee engine checks passed.");
}

run();
