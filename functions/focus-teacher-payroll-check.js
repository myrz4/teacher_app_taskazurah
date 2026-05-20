const admin = require("firebase-admin");
require("./index");
const fns = require("./index");

const db = admin.firestore();

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function timestamp(iso) {
  return admin.firestore.Timestamp.fromDate(new Date(iso));
}

function adminReq(data) {
  return {
    auth: {
      uid: "focus-payroll-admin-1",
      token: {
        role: "admin",
        name: "Focus Payroll Admin",
        email: "focus-payroll-admin@example.com",
        phone_number: "+601188800001",
      },
    },
    data: data || {},
  };
}

function teacherReqA(data) {
  return {
    auth: {
      uid: "focus-auth-teacher-a",
      token: {
        role: "teacher",
        name: "Focus Payroll Teacher A",
        email: "focus-payroll-a@example.com",
        phone_number: "+601188800002",
      },
    },
    data: data || {},
  };
}

async function run() {
  const suffix = Date.now().toString(36).toUpperCase();
  const period = "2026-05";
  const teacherAId = `focus-payroll-teacher-a-${suffix}`;
  const teacherBId = `focus-payroll-teacher-b-${suffix}`;

  await db.collection("teachers").doc(teacherAId).set({
    name: "Focus Payroll Teacher A",
    email: "focus-payroll-a@example.com",
    phone: "01188800002",
    phoneTail: "1188800002",
    phoneE164: "+601188800002",
    salaryBaseSen: 200000,
    salaryCurrency: "MYR",
    salaryActive: true,
    status: "Active",
    joinedDate: "2026-01-01",
  }, { merge: true });

  await db.collection("teachers").doc(teacherBId).set({
    name: "Focus Payroll Teacher B",
    email: "focus-payroll-b@example.com",
    phone: "01188800003",
    phoneTail: "1188800003",
    phoneE164: "+601188800003",
    salaryBaseSen: 180000,
    salaryCurrency: "MYR",
    salaryActive: true,
    status: "Active",
    joinedDate: "2026-02-01",
  }, { merge: true });

  const weekdayDateKey = "2026-05-12";
  const weekdayDate = timestamp("2026-05-11T16:00:00.000Z");
  const saturdayDateKey = "2026-05-16";
  const saturdayDate = timestamp("2026-05-15T16:00:00.000Z");

  const weekdayChildOne = `focus-payroll-child-1-${suffix}`;
  const weekdayChildTwo = `focus-payroll-child-2-${suffix}`;
  const saturdayChild = `focus-payroll-child-3-${suffix}`;

  await db.collection("attendance").doc(`${weekdayDateKey}_${weekdayChildOne}`).set({
    childId: weekdayChildOne,
    name: "Focus Payroll Child One",
    date: weekdayDate,
    dateKey: weekdayDateKey,
    status: "CHECKED_OUT",
    checkInAt: timestamp("2026-05-12T00:30:00.000Z"),
    checkOutAt: timestamp("2026-05-12T11:10:00.000Z"),
    checkedOutByTeacherId: "focus-auth-teacher-a",
    checkedOutByTeacherName: "Focus Payroll Teacher A",
    checkedOutByTeacherEmail: "focus-payroll-a@example.com",
    pickupVerifiedByTeacherId: "focus-auth-teacher-a",
    pickupVerifiedByTeacherName: "Focus Payroll Teacher A",
    pickupVerifiedByTeacherEmail: "focus-payroll-a@example.com",
  }, { merge: true });

  await db.collection("attendance").doc(`${weekdayDateKey}_${weekdayChildTwo}`).set({
    childId: weekdayChildTwo,
    name: "Focus Payroll Child Two",
    date: weekdayDate,
    dateKey: weekdayDateKey,
    status: "CHECKED_OUT",
    checkInAt: timestamp("2026-05-12T01:00:00.000Z"),
    checkOutAt: timestamp("2026-05-12T11:40:00.000Z"),
    checkedOutByTeacherId: "focus-auth-teacher-a",
    checkedOutByTeacherName: "Focus Payroll Teacher A",
    checkedOutByTeacherEmail: "focus-payroll-a@example.com",
    pickupVerifiedByTeacherId: "focus-auth-teacher-a",
    pickupVerifiedByTeacherName: "Focus Payroll Teacher A",
    pickupVerifiedByTeacherEmail: "focus-payroll-a@example.com",
  }, { merge: true });

  await db.collection("attendance").doc(`${saturdayDateKey}_${saturdayChild}`).set({
    childId: saturdayChild,
    name: "Focus Payroll Child Saturday",
    date: saturdayDate,
    dateKey: saturdayDateKey,
    status: "CHECKED_OUT",
    checkInAt: timestamp("2026-05-16T00:40:00.000Z"),
    checkOutAt: timestamp("2026-05-16T07:05:00.000Z"),
    checkedOutByTeacherId: teacherBId,
    checkedOutByTeacherName: "Focus Payroll Teacher B",
    checkedOutByTeacherEmail: "focus-payroll-b@example.com",
  }, { merge: true });

  const dailyResult = await fns.calculateTeacherDailyOvertime.run(adminReq({ period }));
  assertTrue(dailyResult && dailyResult.ok, `Daily overtime calculation failed: ${JSON.stringify(dailyResult)}`);

  const teacherADailyId = `${weekdayDateKey}_${teacherAId}`;
  const teacherBDailyId = `${saturdayDateKey}_${teacherBId}`;
  const teacherADaily = (await db.collection("teacherOvertimeDaily").doc(teacherADailyId).get()).data() || {};
  const teacherBDaily = (await db.collection("teacherOvertimeDaily").doc(teacherBDailyId).get()).data() || {};

  assertTrue(String(teacherADaily.teacherId || "") === teacherAId, "Teacher A daily overtime should resolve to the teacher document id");
  assertTrue(Number(teacherADaily.blocks || 0) === 2, `Teacher A blocks expected 2, got ${JSON.stringify(teacherADaily)}`);
  assertTrue(Number(teacherADaily.totalSen || 0) === 1000, `Teacher A totalSen expected 1000, got ${JSON.stringify(teacherADaily)}`);
  assertTrue(Number(teacherADaily.attendanceCount || 0) === 2, "Teacher A attendance count should include both late children");

  assertTrue(String(teacherBDaily.teacherId || "") === teacherBId, "Teacher B daily overtime should use the selected teacher doc id");
  assertTrue(Number(teacherBDaily.blocks || 0) === 2, `Teacher B blocks expected 2, got ${JSON.stringify(teacherBDaily)}`);
  assertTrue(Number(teacherBDaily.totalSen || 0) === 1200, `Teacher B totalSen expected 1200, got ${JSON.stringify(teacherBDaily)}`);

  const payrollResult = await fns.generateTeacherMonthlyPayroll.run(adminReq({ period }));
  assertTrue(payrollResult && payrollResult.ok, `Monthly payroll generation failed: ${JSON.stringify(payrollResult)}`);

  const teacherAPayrollId = `${period}_${teacherAId}`;
  const teacherBPayrollId = `${period}_${teacherBId}`;
  const teacherAPayroll = (await db.collection("teacherMonthlyPayroll").doc(teacherAPayrollId).get()).data() || {};
  const teacherBPayroll = (await db.collection("teacherMonthlyPayroll").doc(teacherBPayrollId).get()).data() || {};

  assertTrue(Number(teacherAPayroll.baseSalarySen || 0) === 200000, "Teacher A base salary missing from payroll");
  assertTrue(Number(teacherAPayroll.overtimeTotalSen || 0) === 1000, "Teacher A overtime total incorrect");
  assertTrue(Number(teacherAPayroll.totalPaySen || 0) === 201000, "Teacher A total pay incorrect");

  assertTrue(Number(teacherBPayroll.baseSalarySen || 0) === 180000, "Teacher B base salary missing from payroll");
  assertTrue(Number(teacherBPayroll.overtimeTotalSen || 0) === 1200, "Teacher B overtime total incorrect");
  assertTrue(Number(teacherBPayroll.totalPaySen || 0) === 181200, "Teacher B total pay incorrect");

  const summary = await fns.getTeacherPayrollSummary.run(adminReq({ period }));
  assertTrue(summary && summary.ok, `Payroll summary failed: ${JSON.stringify(summary)}`);
  assertTrue(Number(summary.teacherCount || 0) === 2, "Payroll summary should return two teachers");
  assertTrue(Number(summary.totalOvertimeSen || 0) === 2200, "Payroll summary overtime total incorrect");

  const teacherAView = await fns.getTeacherPayrollForTeacher.run(teacherReqA({ period }));
  assertTrue(teacherAView && teacherAView.ok, `Teacher payroll view failed: ${JSON.stringify(teacherAView)}`);
  assertTrue(String((teacherAView.payroll || {}).teacherId || "") === teacherAId, "Teacher payroll view should resolve to teacher A doc id");
  assertTrue(Number((teacherAView.payroll || {}).overtimeTotalSen || 0) === 1000, "Teacher payroll view overtime total incorrect");

  const reviewed = await fns.markTeacherPayrollReviewed.run(adminReq({ payrollId: teacherAPayrollId, reviewNote: "Checked by admin" }));
  assertTrue(reviewed && reviewed.ok, `Mark reviewed failed: ${JSON.stringify(reviewed)}`);
  assertTrue(String((reviewed.payroll || {}).status || "") === "REVIEWED", "Reviewed payroll should be REVIEWED");

  const paid = await fns.markTeacherPayrollPaid.run(adminReq({ payrollId: teacherAPayrollId, paymentReference: `BANK-${suffix}`, paymentNote: "May salary paid" }));
  assertTrue(paid && paid.ok, `Mark paid failed: ${JSON.stringify(paid)}`);
  assertTrue(String((paid.payroll || {}).status || "") === "PAID", "Paid payroll should be PAID");
  assertTrue(String((paid.payroll || {}).paymentReference || "") === `BANK-${suffix}`, "Payment reference should be stored");

  console.log(JSON.stringify({
    ok: true,
    period,
    teacherADailyId,
    teacherBDailyId,
    teacherAPayrollId,
    teacherBPayrollId,
  }));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});