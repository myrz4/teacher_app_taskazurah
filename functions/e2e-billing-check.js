/* eslint-disable no-console */
const admin = require("firebase-admin");
const crypto = require("crypto");
const fns = require("./index");

const db = admin.firestore();

function assertTrue(cond, message) {
  if (!cond) throw new Error(message);
}

function monthKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function nowTs() {
  return admin.firestore.Timestamp.fromDate(new Date());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withMockDate(fixedDate, fn) {
  const RealDate = Date;
  const fixed = new RealDate(fixedDate);

  function MockDate(...args) {
    if (new.target) {
      if (!args.length) return new RealDate(fixed);
      return new RealDate(...args);
    }
    if (!args.length) return new RealDate(fixed).toString();
    return RealDate(...args);
  }

  MockDate.UTC = RealDate.UTC;
  MockDate.parse = RealDate.parse;
  MockDate.now = () => new RealDate(fixed).getTime();
  MockDate.prototype = RealDate.prototype;

  global.Date = MockDate;
  try {
    return await fn();
  } finally {
    global.Date = RealDate;
  }
}

function mkReq({ uid, phone, data }) {
  return {
    auth: {
      uid,
      token: {
        phone_number: phone,
      },
    },
    data: data || {},
  };
}

function mkAdminReq({ uid, phone, data }) {
  return {
    auth: {
      uid,
      token: {
        role: "admin",
        phone_number: phone,
        email: "admin-e2e@example.com",
      },
    },
    data: data || {},
  };
}

async function createParent({ parentId, phoneE164 }) {
  const tail = phoneE164.replace(/^\+60/, "").replace(/^0/, "");
  const local = `0${tail}`;
  await db.collection("parents").doc(parentId).set({
    parentName: `E2E ${parentId}`,
    phone: local,
    phoneTail: tail,
    phoneE164,
    payerType: "nonstaff",
  }, { merge: true });
}

async function updateParent(parentId, patch) {
  await db.collection("parents").doc(parentId).set(patch, { merge: true });
}

async function createChild({ childId, name, careType, feePlan, registrationType, staffChild, billingDueDay, birthDate, registeredAt, transportFromTadika, registrationFeeAppliedPeriod }) {
  await db.collection("children").doc(childId).set({
    name,
    careType,
    feePlan: feePlan || (String(careType || "").startsWith("transit") ? "transit" : "monthly"),
    registrationType,
    staffChild: Boolean(staffChild),
    billingDueDay,
    birthDate,
    registeredAt,
    transportFromTadika: Boolean(transportFromTadika),
    registrationFeeAppliedPeriod: registrationFeeAppliedPeriod || "",
  }, { merge: true });
}

async function fetchInvoiceByPeriod({ parentId, period }) {
  const snap = await db.collection("parents").doc(parentId).collection("invoices")
    .where("period", "==", period)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, data: snap.docs[0].data() || {} };
}

async function clearInvoicesByPeriod(parentId, period) {
  const snap = await db.collection("parents").doc(parentId).collection("invoices")
    .where("period", "==", period)
    .get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  if (!snap.empty) await batch.commit();
}

async function clearPayments(parentId) {
  const snap = await db.collection("parents").doc(parentId).collection("payments").get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  if (!snap.empty) await batch.commit();
}

async function listPayments(parentId) {
  const snap = await db.collection("parents").doc(parentId).collection("payments").get();
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

async function listInvoiceAdjustments(parentId, invoiceId) {
  const snap = await db.collection("parents").doc(parentId).collection("invoices").doc(invoiceId)
    .collection("adjustments")
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

function billplzXSignatureForTest(payload, secret) {
  const flattened = [];
  for (const [key, value] of Object.entries(payload || {})) {
    if (String(key).toLowerCase() === "x_signature") continue;
    flattened.push(`${key}${value == null ? "" : String(value)}`);
  }
  const source = flattened.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "accent", caseFirst: "lower" })).join("|");
  return crypto.createHmac("sha256", secret).update(source).digest("hex");
}

function billingSessionLookupDocId(kind, value) {
  return `${String(kind || "").trim()}:${crypto.createHash("sha1").update(String(value || "").trim()).digest("hex")}`;
}

async function seedAttendanceOvertime(childId) {
  const base = new Date();
  const y = base.getFullYear();
  const m = base.getMonth();

  const d1 = new Date(y, m, 10, 0, 0, 0);
  const out1 = new Date(y, m, 10, 19, 0, 0);
  const d2 = new Date(y, m, 11, 0, 0, 0);
  const out2 = new Date(y, m, 11, 21, 0, 0);

  await db.collection("attendance").doc(`e2e-${childId}-1`).set({
    childId,
    date: admin.firestore.Timestamp.fromDate(d1),
    check_out_time: admin.firestore.Timestamp.fromDate(out1),
  }, { merge: true });

  await db.collection("attendance").doc(`e2e-${childId}-2`).set({
    childId,
    date: admin.firestore.Timestamp.fromDate(d2),
    check_out_time: admin.firestore.Timestamp.fromDate(out2),
  }, { merge: true });
}

async function seedAttendanceRows(childId, rows) {
  const base = new Date();
  const y = base.getFullYear();
  const m = base.getMonth();

  const writes = (rows || []).map((row, index) => {
    const day = Number(row.day || 1);
    const dateOnly = new Date(y, m, day, 0, 0, 0);
    const payload = {
      childId,
      date: admin.firestore.Timestamp.fromDate(dateOnly),
    };

    if (Number.isFinite(Number(row.checkInHour))) {
      payload.check_in_time = admin.firestore.Timestamp.fromDate(new Date(
        y,
        m,
        day,
        Number(row.checkInHour),
        Number(row.checkInMinute || 0),
        0,
      ));
    }

    if (Number.isFinite(Number(row.checkOutHour))) {
      payload.check_out_time = admin.firestore.Timestamp.fromDate(new Date(
        y,
        m,
        day,
        Number(row.checkOutHour),
        Number(row.checkOutMinute || 0),
        0,
      ));
    }

    return db.collection("attendance").doc(`e2e-${childId}-${day}-${index}`).set(payload, { merge: true });
  });

  await Promise.all(writes);
}

async function seedCanonicalAttendanceRecord(childId, row) {
  const base = new Date();
  const y = base.getFullYear();
  const m = base.getMonth();
  const day = Number(row.day || 1);
  const dateKey = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const attendanceId = `${dateKey}_${childId}`;
  const dateOnly = new Date(y, m, day, 0, 0, 0);
  const checkIn = new Date(y, m, day, Number(row.checkInHour), Number(row.checkInMinute || 0), 0);
  const checkOut = new Date(y, m, day, Number(row.checkOutHour), Number(row.checkOutMinute || 0), 0);

  await db.collection("attendance").doc(attendanceId).set({
    attendanceId,
    childId,
    date: admin.firestore.Timestamp.fromDate(dateOnly),
    dateKey,
    status: "CHECKED_OUT",
    checkInAt: admin.firestore.Timestamp.fromDate(checkIn),
    checkOutAt: admin.firestore.Timestamp.fromDate(checkOut),
    check_in_time: admin.firestore.Timestamp.fromDate(checkIn),
    check_out_time: admin.firestore.Timestamp.fromDate(checkOut),
    isPresent: true,
    is_present: true,
  }, { merge: true });

  return { attendanceId, dateKey };
}

async function run() {
  const phone = "+601112223334";
  const uid = "e2e-parent-1";
  const currentPeriod = monthKey(new Date());

  // Case 1: Registration month should add registration fee on top of the monthly base and use due day 5
  const parent1 = "e2e-parent-reg";
  const child1 = "e2e-child-reg";
  await createParent({ parentId: parent1, phoneE164: phone });
  await clearInvoicesByPeriod(parent1, currentPeriod);
  await createChild({
    childId: child1,
    name: "E2E Child Reg",
    careType: "fulltime",
    registrationType: "fulltime",
    staffChild: false,
    billingDueDay: 5,
    birthDate: "2025-02-10",
    registeredAt: nowTs(),
    transportFromTadika: false,
  });

  const regRes = await fns.billingCreateDemoInvoiceForCurrentMonth.run(mkReq({ uid, phone, data: { parentId: parent1, childId: child1 } }));
  assertTrue(regRes && regRes.ok, "Case1: billingCreateDemoInvoiceForCurrentMonth failed");

  const inv1 = await fetchInvoiceByPeriod({ parentId: parent1, period: currentPeriod });
  assertTrue(inv1, "Case1: invoice missing");
  const items1 = Array.isArray(inv1.data.items) ? inv1.data.items : [];
  const hasReg = items1.some((i) => i.code === "registration_fulltime_oneoff");
  const hasMonthlyBase = items1.some((i) => String(i.code || "").startsWith("monthly_"));
  assertTrue(hasReg, "Case1: registration fee item missing");
  assertTrue(hasMonthlyBase, "Case1: monthly base should still be present in registration month");
  const notes1 = Array.isArray(inv1.data.billingMeta && inv1.data.billingMeta.policyNotes)
    ? inv1.data.billingMeta.policyNotes
    : [];
  assertTrue(notes1.some((note) => String(note).includes('tidak akan dikembalikan')), "Case1: registration policy note missing");
  const due1 = inv1.data.dueDate && inv1.data.dueDate.toDate ? inv1.data.dueDate.toDate() : null;
  assertTrue(due1 && due1.getDate() === 5, "Case1: due day expected 5");
  console.log("PASS Case1 registration-month + due day 5");

  // Case 2: Transit + overtime + absence discount with due day 7
  const parent2 = "e2e-parent-transit";
  const child2 = "e2e-child-transit";
  await createParent({ parentId: parent2, phoneE164: phone });
  await clearInvoicesByPeriod(parent2, currentPeriod);

  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  await createChild({
    childId: child2,
    name: "E2E Child Transit",
    careType: "transit_2h_month",
    registrationType: "transit",
    staffChild: false,
    billingDueDay: 7,
    birthDate: "2023-01-15",
    registeredAt: admin.firestore.Timestamp.fromDate(lastMonth),
    transportFromTadika: true,
    registrationFeeAppliedPeriod: monthKey(lastMonth),
  });
  await seedAttendanceOvertime(child2);

  const trRes = await fns.billingCreateDemoInvoiceForCurrentMonth.run(mkReq({
    uid,
    phone,
    data: {
      parentId: parent2,
      childId: child2,
      hasAbsenceLetter: true,
      absenceDaysWithLetter: 15,
      manualOvertime: { after530Hours: 2, h8to12Hours: 1, h12to7Hours: 0 },
    },
  }));
  assertTrue(trRes && trRes.ok, "Case2: billingCreateDemoInvoiceForCurrentMonth failed");

  const inv2 = await fetchInvoiceByPeriod({ parentId: parent2, period: currentPeriod });
  assertTrue(inv2, "Case2: invoice missing");
  const items2 = Array.isArray(inv2.data.items) ? inv2.data.items : [];
  assertTrue(items2.some((i) => i.code === "transit_2h_month"), "Case2: transit base item missing");
  assertTrue(items2.some((i) => i.code === "overtime_after_530"), "Case2: overtime_after_530 item missing");
  assertTrue(items2.some((i) => i.code === "overtime_8pm_12am"), "Case2: overtime_8pm_12am item missing");
  assertTrue(items2.some((i) => i.code === "transport_tadika_month"), "Case2: transport item missing");
  assertTrue(items2.some((i) => i.code === "discount_absence_14days"), "Case2: absence discount item missing");
  const due2 = inv2.data.dueDate && inv2.data.dueDate.toDate ? inv2.data.dueDate.toDate() : null;
  assertTrue(due2 && due2.getDate() === 7, "Case2: due day expected 7");
  console.log("PASS Case2 transit + overtime + discount + due day 7");

  // Case 2aa: Attendance override should refresh an unpaid invoice for the affected month
  const parentRefresh = "e2e-parent-att-refresh";
  const childRefresh = "e2e-child-att-refresh";
  await createParent({ parentId: parentRefresh, phoneE164: phone });
  await updateParent(parentRefresh, {
    childIds: [childRefresh],
    childNames: ["E2E Child Attendance Refresh"],
  });
  await clearInvoicesByPeriod(parentRefresh, currentPeriod);

  await createChild({
    childId: childRefresh,
    name: "E2E Child Attendance Refresh",
    careType: "transit_2h_month",
    registrationType: "transit",
    staffChild: false,
    billingDueDay: 7,
    birthDate: "2023-04-18",
    registeredAt: admin.firestore.Timestamp.fromDate(lastMonth),
    transportFromTadika: false,
    registrationFeeAppliedPeriod: monthKey(lastMonth),
  });

  const seededAttendance = await seedCanonicalAttendanceRecord(childRefresh, {
    day: 15,
    checkInHour: 8,
    checkOutHour: 21,
  });

  const refreshCreateRes = await fns.billingCreateDemoInvoiceForCurrentMonth.run(mkReq({
    uid,
    phone,
    data: { parentId: parentRefresh, childId: childRefresh },
  }));
  assertTrue(refreshCreateRes && refreshCreateRes.ok, "Case2aa: invoice creation failed");

  const beforeRefresh = await fetchInvoiceByPeriod({ parentId: parentRefresh, period: currentPeriod });
  assertTrue(beforeRefresh, "Case2aa: invoice missing before refresh");
  const beforeRefreshItems = Array.isArray(beforeRefresh.data.items) ? beforeRefresh.data.items : [];
  assertTrue(beforeRefreshItems.some((item) => item.code === "overtime_after_530"), "Case2aa: expected overtime_after_530 before refresh");
  assertTrue(beforeRefreshItems.some((item) => item.code === "overtime_8pm_12am"), "Case2aa: expected overtime_8pm_12am before refresh");
  const beforeRefreshTotal = Number(beforeRefresh.data.totalSen || 0);

  const editedCheckIn = new Date(new Date().getFullYear(), new Date().getMonth(), 15, 8, 0, 0);
  const editedCheckOut = new Date(new Date().getFullYear(), new Date().getMonth(), 15, 17, 0, 0);
  const refreshOverrideRes = await fns.attendanceAdminOverride.run(mkAdminReq({
    uid: "e2e-admin-refresh",
    phone,
    data: {
      action: "EDIT_RECORD",
      childId: childRefresh,
      attendanceDate: seededAttendance.dateKey,
      reason: "Shortened recorded pickup time",
      notes: "Billing should remove overtime",
      adminName: "E2E Admin",
      checkInAt: editedCheckIn.toISOString(),
      checkOutAt: editedCheckOut.toISOString(),
    },
  }));
  assertTrue(refreshOverrideRes && refreshOverrideRes.ok, `Case2aa: attendance override failed: ${JSON.stringify(refreshOverrideRes)}`);
  assertTrue(refreshOverrideRes.billingRefresh && refreshOverrideRes.billingRefresh.ok, `Case2aa: billing refresh failed: ${JSON.stringify(refreshOverrideRes.billingRefresh)}`);

  const afterRefresh = await fetchInvoiceByPeriod({ parentId: parentRefresh, period: currentPeriod });
  assertTrue(afterRefresh, "Case2aa: invoice missing after refresh");
  const afterRefreshItems = Array.isArray(afterRefresh.data.items) ? afterRefresh.data.items : [];
  assertTrue(!afterRefreshItems.some((item) => item.code === "overtime_after_530"), "Case2aa: overtime_after_530 should be removed after refresh");
  assertTrue(!afterRefreshItems.some((item) => item.code === "overtime_8pm_12am"), "Case2aa: overtime_8pm_12am should be removed after refresh");
  const afterRefreshTotal = Number(afterRefresh.data.totalSen || 0);
  assertTrue(afterRefreshTotal < beforeRefreshTotal, "Case2aa: refreshed invoice total should decrease");
  const attendanceRefreshMeta = afterRefresh.data.billingMeta && afterRefresh.data.billingMeta.attendanceRefresh
    ? afterRefresh.data.billingMeta.attendanceRefresh
    : null;
  assertTrue(attendanceRefreshMeta && attendanceRefreshMeta.action === "EDIT_RECORD", "Case2aa: attendance refresh metadata missing");
  console.log("PASS Case2aa unpaid invoice refresh after attendance override");

  // Case 2ab: Paid invoice should keep totals intact and record a pending attendance adjustment
  const parentPaidAdjust = "e2e-parent-paid-adjust";
  const childPaidAdjust = "e2e-child-paid-adjust";
  await createParent({ parentId: parentPaidAdjust, phoneE164: phone });
  await updateParent(parentPaidAdjust, {
    childIds: [childPaidAdjust],
    childNames: ["E2E Child Paid Adjust"],
  });
  await clearInvoicesByPeriod(parentPaidAdjust, currentPeriod);

  await createChild({
    childId: childPaidAdjust,
    name: "E2E Child Paid Adjust",
    careType: "transit_2h_month",
    registrationType: "transit",
    staffChild: false,
    billingDueDay: 7,
    birthDate: "2023-05-11",
    registeredAt: admin.firestore.Timestamp.fromDate(lastMonth),
    transportFromTadika: false,
    registrationFeeAppliedPeriod: monthKey(lastMonth),
  });

  const paidAttendance = await seedCanonicalAttendanceRecord(childPaidAdjust, {
    day: 16,
    checkInHour: 8,
    checkOutHour: 21,
  });

  const paidAdjustCreate = await fns.billingCreateDemoInvoiceForCurrentMonth.run(mkReq({
    uid,
    phone,
    data: { parentId: parentPaidAdjust, childId: childPaidAdjust },
  }));
  assertTrue(paidAdjustCreate && paidAdjustCreate.ok, "Case2ab: paid-adjust invoice creation failed");

  const beforePaidAdjust = await fetchInvoiceByPeriod({ parentId: parentPaidAdjust, period: currentPeriod });
  assertTrue(beforePaidAdjust, "Case2ab: invoice missing before paid adjustment");
  const paidAdjustTotalBefore = Number(beforePaidAdjust.data.totalSen || 0);
  await db.collection("parents").doc(parentPaidAdjust).collection("invoices").doc(beforePaidAdjust.id).set({
    status: "paid",
    paidAt: nowTs(),
    paidMethod: "Cash",
    paidBank: "",
    paidAmountSen: paidAdjustTotalBefore,
    paidReceiptNo: "E2E-PAID-ADJUST",
    paidProvider: "cash",
  }, { merge: true });

  const paidAdjustOverride = await fns.attendanceAdminOverride.run(mkAdminReq({
    uid: "e2e-admin-paid-adjust",
    phone,
    data: {
      action: "EDIT_RECORD",
      childId: childPaidAdjust,
      attendanceDate: paidAttendance.dateKey,
      reason: "Pickup time corrected after payment",
      notes: "Should create a pending credit adjustment",
      adminName: "E2E Admin",
      checkInAt: new Date(new Date().getFullYear(), new Date().getMonth(), 16, 8, 0, 0).toISOString(),
      checkOutAt: new Date(new Date().getFullYear(), new Date().getMonth(), 16, 17, 0, 0).toISOString(),
    },
  }));
  assertTrue(paidAdjustOverride && paidAdjustOverride.ok, `Case2ab: attendance override failed: ${JSON.stringify(paidAdjustOverride)}`);
  assertTrue(paidAdjustOverride.billingRefresh && paidAdjustOverride.billingRefresh.ok, `Case2ab: paid invoice adjustment recording failed: ${JSON.stringify(paidAdjustOverride.billingRefresh)}`);
  assertTrue(paidAdjustOverride.billingRefresh.paidInvoice === true, "Case2ab: expected paid invoice adjustment path");
  assertTrue(paidAdjustOverride.billingRefresh.adjustmentRequired === true, "Case2ab: expected adjustment to be required");

  const afterPaidAdjust = await fetchInvoiceByPeriod({ parentId: parentPaidAdjust, period: currentPeriod });
  assertTrue(afterPaidAdjust, "Case2ab: invoice missing after paid adjustment");
  assertTrue(String(afterPaidAdjust.data.status || "") === "paid", "Case2ab: invoice status should remain paid");
  assertTrue(Number(afterPaidAdjust.data.totalSen || 0) === paidAdjustTotalBefore, "Case2ab: paid invoice total should not be rewritten");
  const paidAdjustMeta = afterPaidAdjust.data.billingMeta && afterPaidAdjust.data.billingMeta.attendanceAdjustment
    ? afterPaidAdjust.data.billingMeta.attendanceAdjustment
    : null;
  assertTrue(paidAdjustMeta && paidAdjustMeta.required === true, "Case2ab: attendanceAdjustment metadata missing");
  assertTrue(String(paidAdjustMeta.direction || "") === "credit", "Case2ab: expected a credit adjustment direction");
  assertTrue(Boolean(afterPaidAdjust.data.billingMeta && afterPaidAdjust.data.billingMeta.managementReviewRecommended), "Case2ab: paid adjustment should surface as management review");
  assertTrue(String(afterPaidAdjust.data.billingMeta && afterPaidAdjust.data.billingMeta.reviewReason || "").includes("Attendance changed after payment"), "Case2ab: custom review reason missing");

  const paidAdjustments = await listInvoiceAdjustments(parentPaidAdjust, afterPaidAdjust.id);
  assertTrue(paidAdjustments.length === 1, "Case2ab: expected one pending attendance adjustment record");
  assertTrue(String(paidAdjustments[0].data.status || "") === "pending", "Case2ab: adjustment should stay pending");
  assertTrue(String(paidAdjustments[0].data.type || "") === "credit", "Case2ab: adjustment type should be credit");
  assertTrue(Number(paidAdjustments[0].data.deltaSen || 0) < 0, "Case2ab: adjustment delta should be negative for a credit");
  console.log("PASS Case2ab paid invoice records pending attendance adjustment");

  // Case 2a: Attendance-based transit variants without uniform billing
  const parentUsage = "e2e-parent-usage";
  const childDay = "e2e-child-day";
  const childWeek = "e2e-child-week";
  const childHour = "e2e-child-hour";
  const childReview = "e2e-child-review";
  const childTransitAuto2h = "e2e-child-transit-auto-2h";
  const childTransitAutoHalfday = "e2e-child-transit-auto-halfday";
  await createParent({ parentId: parentUsage, phoneE164: phone });
  await clearInvoicesByPeriod(parentUsage, currentPeriod);

  const registeredBefore = new Date();
  registeredBefore.setMonth(registeredBefore.getMonth() - 3);
  await createChild({
    childId: childDay,
    name: "E2E Child Day Transit",
    careType: "transit_1day",
    registrationType: "transit",
    staffChild: false,
    billingDueDay: 7,
    birthDate: "2023-06-10",
    registeredAt: admin.firestore.Timestamp.fromDate(registeredBefore),
    transportFromTadika: false,
    registrationFeeAppliedPeriod: monthKey(registeredBefore),
  });
  await createChild({
    childId: childWeek,
    name: "E2E Child Week Transit",
    careType: "transit_1week",
    registrationType: "transit",
    staffChild: false,
    billingDueDay: 7,
    birthDate: "2022-11-05",
    registeredAt: admin.firestore.Timestamp.fromDate(registeredBefore),
    transportFromTadika: false,
    registrationFeeAppliedPeriod: monthKey(registeredBefore),
  });
  await createChild({
    childId: childHour,
    name: "E2E Child Hour Transit",
    careType: "transit_1hour",
    registrationType: "transit",
    staffChild: true,
    billingDueDay: 7,
    birthDate: "2023-02-01",
    registeredAt: admin.firestore.Timestamp.fromDate(registeredBefore),
    transportFromTadika: false,
    registrationFeeAppliedPeriod: monthKey(registeredBefore),
  });
  await createChild({
    childId: childReview,
    name: "E2E Child Review",
    careType: "transit_2h_month",
    registrationType: "transit",
    staffChild: false,
    billingDueDay: 7,
    birthDate: "2023-03-12",
    registeredAt: admin.firestore.Timestamp.fromDate(registeredBefore),
    transportFromTadika: false,
    registrationFeeAppliedPeriod: monthKey(registeredBefore),
  });
  await createChild({
    childId: childTransitAuto2h,
    name: "E2E Child Transit Auto 2H",
    careType: "transit",
    registrationType: "transit",
    staffChild: false,
    billingDueDay: 7,
    birthDate: "2023-08-10",
    registeredAt: admin.firestore.Timestamp.fromDate(registeredBefore),
    transportFromTadika: false,
    registrationFeeAppliedPeriod: monthKey(registeredBefore),
  });
  await createChild({
    childId: childTransitAutoHalfday,
    name: "E2E Child Transit Auto Halfday",
    careType: "transit",
    registrationType: "transit",
    staffChild: false,
    billingDueDay: 7,
    birthDate: "2023-09-10",
    registeredAt: admin.firestore.Timestamp.fromDate(registeredBefore),
    transportFromTadika: false,
    registrationFeeAppliedPeriod: monthKey(registeredBefore),
  });
  await updateParent(parentUsage, {
    childIds: [childDay, childWeek, childHour, childReview, childTransitAuto2h, childTransitAutoHalfday],
    childNames: [
      "E2E Child Day Transit",
      "E2E Child Week Transit",
      "E2E Child Hour Transit",
      "E2E Child Review",
      "E2E Child Transit Auto 2H",
      "E2E Child Transit Auto Halfday",
    ],
  });

  await seedAttendanceRows(childDay, [
    { day: 3, checkInHour: 8, checkOutHour: 12 },
    { day: 4, checkInHour: 8, checkOutHour: 12 },
    { day: 12, checkInHour: 8, checkOutHour: 12 },
  ]);
  await seedAttendanceRows(childWeek, [
    { day: 5, checkInHour: 8, checkOutHour: 12 },
    { day: 13, checkInHour: 8, checkOutHour: 12 },
  ]);
  await seedAttendanceRows(childHour, [
    { day: 6, checkInHour: 8, checkInMinute: 0, checkOutHour: 9, checkOutMinute: 30 },
    { day: 7, checkInHour: 8, checkInMinute: 0, checkOutHour: 10, checkOutMinute: 0 },
    { day: 8, checkInHour: 8, checkInMinute: 0, checkOutHour: 9, checkOutMinute: 45 },
  ]);
  await seedAttendanceRows(childReview, Array.from({ length: 11 }, (_, index) => ({
    day: index + 14,
    checkInHour: 8,
    checkOutHour: 20,
    checkOutMinute: 30,
  })));
  await seedAttendanceRows(childTransitAuto2h, [
    { day: 18, checkInHour: 8, checkOutHour: 10 },
    { day: 19, checkInHour: 8, checkOutHour: 10 },
    { day: 20, checkInHour: 8, checkOutHour: 10 },
  ]);
  await seedAttendanceRows(childTransitAutoHalfday, [
    { day: 21, checkInHour: 8, checkOutHour: 12 },
    { day: 22, checkInHour: 8, checkOutHour: 12 },
    { day: 23, checkInHour: 8, checkOutHour: 12 },
  ]);

  const usageRes = await fns.billingCreateDemoInvoiceForCurrentMonth.run(mkReq({
    uid,
    phone,
    data: { parentId: parentUsage },
  }));
  assertTrue(usageRes && usageRes.ok, "Case2a: usage-based invoice creation failed");

  const usageInvoice = await fetchInvoiceByPeriod({ parentId: parentUsage, period: currentPeriod });
  assertTrue(usageInvoice, "Case2a: usage-based invoice missing");
  const usageItems = Array.isArray(usageInvoice.data.items) ? usageInvoice.data.items : [];
  const dayItem = usageItems.find((item) => item.childId === childDay && item.code === "transit_1day");
  const weekItem = usageItems.find((item) => item.childId === childWeek && item.code === "transit_1week");
  const hourItem = usageItems.find((item) => item.childId === childHour && item.code === "transit_1hour");
  const auto2hItem = usageItems.find((item) => item.childId === childTransitAuto2h && item.code === "transit_2h_month");
  const autoHalfdayItem = usageItems.find((item) => item.childId === childTransitAutoHalfday && item.code === "transit_halfday_month");
  assertTrue(dayItem && dayItem.qty === 3, "Case2a: transit_1day should bill three attendance days");
  assertTrue(weekItem && weekItem.qty === 2, "Case2a: transit_1week should bill two distinct attendance weeks");
  assertTrue(hourItem && hourItem.qty === 6, "Case2a: transit_1hour should bill rounded attended hours");
  assertTrue(!usageItems.some((item) => item.code === "uniform_current_price"), "Case2a: uniform should never be billed");
  assertTrue(auto2hItem && auto2hItem.qty === 1, "Case2a: generic transit child with 2-hour attendance should use transit_2h_month");
  assertTrue(autoHalfdayItem && autoHalfdayItem.qty === 1, "Case2a: generic transit child with longer attendance should use transit_halfday_month");
  assertTrue(usageInvoice.data.billingMeta && usageInvoice.data.billingMeta.managementReviewRecommended === true,
    "Case2a: management review flag should be raised for repeated late-night overtime");
  const usagePolicyNotes = Array.isArray(usageInvoice.data.billingMeta && usageInvoice.data.billingMeta.policyNotes)
    ? usageInvoice.data.billingMeta.policyNotes
    : [];
  assertTrue(usagePolicyNotes.some((note) => String(note).includes('semakan pengurusan')),
    "Case2a: management review policy note missing");
  console.log("PASS Case2a attendance-based transit pricing");

  // Case 2b: Family invoice should aggregate linked children into one parent-period invoice
  const parentFamily = "e2e-parent-family";
  const childFamily1 = "e2e-child-family-1";
  const childFamily2 = "e2e-child-family-2";
  await createParent({ parentId: parentFamily, phoneE164: phone });
  await clearInvoicesByPeriod(parentFamily, currentPeriod);

  const registeredEarlier = new Date();
  registeredEarlier.setMonth(registeredEarlier.getMonth() - 2);
  await createChild({
    childId: childFamily1,
    name: "E2E Family Child One",
    careType: "fulltime",
    registrationType: "fulltime",
    staffChild: false,
    billingDueDay: 7,
    birthDate: "2023-04-12",
    registeredAt: admin.firestore.Timestamp.fromDate(registeredEarlier),
    transportFromTadika: false,
    registrationFeeAppliedPeriod: monthKey(registeredEarlier),
  });
  await createChild({
    childId: childFamily2,
    name: "E2E Family Child Two",
    careType: "transit_2h_month",
    registrationType: "transit",
    staffChild: false,
    billingDueDay: 5,
    birthDate: "2022-07-01",
    registeredAt: admin.firestore.Timestamp.fromDate(registeredEarlier),
    transportFromTadika: true,
    registrationFeeAppliedPeriod: monthKey(registeredEarlier),
  });
  await updateParent(parentFamily, {
    childIds: [childFamily1, childFamily2],
    childNames: ["E2E Family Child One", "E2E Family Child Two"],
  });

  const familyRes = await fns.billingCreateDemoInvoiceForCurrentMonth.run(mkReq({
    uid,
    phone,
    data: { parentId: parentFamily },
  }));
  assertTrue(familyRes && familyRes.ok, "Case2b: family invoice creation failed");

  const familyInvoice = await fetchInvoiceByPeriod({ parentId: parentFamily, period: currentPeriod });
  assertTrue(familyInvoice, "Case2b: family invoice missing");
  assertTrue(Array.isArray(familyInvoice.data.childIds), "Case2b: childIds should be stored on family invoice");
  assertTrue(familyInvoice.data.childIds.length === 2, "Case2b: expected two linked childIds on family invoice");
  assertTrue(Array.isArray(familyInvoice.data.childNames), "Case2b: childNames should be stored on family invoice");
  assertTrue(familyInvoice.data.childNames.length === 2, "Case2b: expected two linked childNames on family invoice");
  assertTrue(String(familyInvoice.data.childName || "").includes("E2E Family Child One"), "Case2b: family child summary missing first child");
  assertTrue(String(familyInvoice.data.childName || "").includes("E2E Family Child Two"), "Case2b: family child summary missing second child");
  assertTrue(familyInvoice.data.billingMeta && familyInvoice.data.billingMeta.invoiceScope === "family", "Case2b: billingMeta.invoiceScope should be family");
  assertTrue(Array.isArray(familyInvoice.data.billingMeta && familyInvoice.data.billingMeta.children), "Case2b: billingMeta.children should be recorded");

  const familyItems = Array.isArray(familyInvoice.data.items) ? familyInvoice.data.items : [];
  assertTrue(familyItems.some((i) => i.childId === childFamily1), "Case2b: first child items missing from family invoice");
  assertTrue(familyItems.some((i) => i.childId === childFamily2), "Case2b: second child items missing from family invoice");
  assertTrue(familyItems.some((i) => String(i.description || "").includes("E2E Family Child One")), "Case2b: first child label missing from item descriptions");
  assertTrue(familyItems.some((i) => String(i.description || "").includes("E2E Family Child Two")), "Case2b: second child label missing from item descriptions");

  const dueFamily = familyInvoice.data.dueDate && familyInvoice.data.dueDate.toDate ? familyInvoice.data.dueDate.toDate() : null;
  assertTrue(dueFamily && dueFamily.getDate() === 5, "Case2b: family invoice should use earliest child due day");
  console.log("PASS Case2b family invoice aggregates linked children into one parent-period invoice");

  // Case 2c: Admin batch generation should create missing family invoices and skip existing ones
  const nextMonthDate = new Date();
  nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
  const nextPeriod = monthKey(nextMonthDate);
  await clearInvoicesByPeriod(parentFamily, nextPeriod);

  const batchRes1 = await fns.billingAdminGenerateInvoicesForPeriod.run(mkAdminReq({
    uid: "e2e-admin-batch",
    phone,
    data: {
      period: nextPeriod,
      parentIds: [parentFamily],
    },
  }));
  assertTrue(batchRes1 && batchRes1.ok, "Case2c: admin batch invoice generation failed");
  assertTrue(batchRes1.createdCount === 1, "Case2c: expected one created family invoice");
  assertTrue(batchRes1.existingCount === 0, "Case2c: no existing invoices should be counted on first batch run");

  const nextFamilyInvoice = await fetchInvoiceByPeriod({ parentId: parentFamily, period: nextPeriod });
  assertTrue(nextFamilyInvoice, "Case2c: admin batch should create invoice for requested period");
  assertTrue(nextFamilyInvoice.data.billingMeta && nextFamilyInvoice.data.billingMeta.invoiceScope === "family", "Case2c: admin batch should keep family invoice scope");

  const batchRes2 = await fns.billingAdminGenerateInvoicesForPeriod.run(mkAdminReq({
    uid: "e2e-admin-batch",
    phone,
    data: {
      period: nextPeriod,
      parentIds: [parentFamily],
    },
  }));
  assertTrue(batchRes2 && batchRes2.ok, "Case2c: repeated admin batch invoice generation failed");
  assertTrue(batchRes2.createdCount === 0, "Case2c: repeated admin batch should not create duplicate invoices");
  assertTrue(batchRes2.existingCount === 1, "Case2c: repeated admin batch should count the existing invoice");
  console.log("PASS Case2c admin batch generation creates missing family invoices and skips duplicates");

  // Case 2d: Out-of-policy ages should use nearest band and force manual review
  const parentAgeReview = "e2e-parent-age-review";
  const childAgeReview = "e2e-child-age-review";
  await createParent({ parentId: parentAgeReview, phoneE164: phone });
  await clearInvoicesByPeriod(parentAgeReview, currentPeriod);

  const registeredLongAgo = new Date();
  registeredLongAgo.setMonth(registeredLongAgo.getMonth() - 2);
  const underThreeMonths = new Date();
  underThreeMonths.setMonth(underThreeMonths.getMonth() - 2);
  const underThreeMonthsBirthDate = `${underThreeMonths.getFullYear()}-${String(underThreeMonths.getMonth() + 1).padStart(2, "0")}-${String(underThreeMonths.getDate()).padStart(2, "0")}`;

  await createChild({
    childId: childAgeReview,
    name: "E2E Child Age Review",
    careType: "fulltime",
    registrationType: "fulltime",
    staffChild: false,
    billingDueDay: 7,
    birthDate: underThreeMonthsBirthDate,
    registeredAt: admin.firestore.Timestamp.fromDate(registeredLongAgo),
    transportFromTadika: false,
    registrationFeeAppliedPeriod: monthKey(registeredLongAgo),
  });

  const ageReviewRes = await fns.billingCreateDemoInvoiceForCurrentMonth.run(mkReq({
    uid,
    phone,
    data: { parentId: parentAgeReview, childId: childAgeReview },
  }));
  assertTrue(ageReviewRes && ageReviewRes.ok, "Case2d: out-of-policy age invoice creation failed");

  const ageReviewInvoice = await fetchInvoiceByPeriod({ parentId: parentAgeReview, period: currentPeriod });
  assertTrue(ageReviewInvoice, "Case2d: out-of-policy age invoice missing");
  const ageReviewItems = Array.isArray(ageReviewInvoice.data.items) ? ageReviewInvoice.data.items : [];
  assertTrue(ageReviewItems.some((item) => item.code === "monthly_fulltime_3m_2y"), "Case2d: nearest in-range monthly band should be used for under-3-month child");
  assertTrue(Boolean(ageReviewInvoice.data.billingMeta && ageReviewInvoice.data.billingMeta.managementReviewRecommended), "Case2d: out-of-policy age should require management review");
  const ageReviewChildren = Array.isArray(ageReviewInvoice.data.billingMeta && ageReviewInvoice.data.billingMeta.children)
    ? ageReviewInvoice.data.billingMeta.children
    : [];
  assertTrue(Boolean(ageReviewChildren[0] && ageReviewChildren[0].billingMeta && ageReviewChildren[0].billingMeta.ageOutOfPolicy), "Case2d: child billing meta should flag out-of-policy age");
  const ageReviewNotes = Array.isArray(ageReviewInvoice.data.billingMeta && ageReviewInvoice.data.billingMeta.policyNotes)
    ? ageReviewInvoice.data.billingMeta.policyNotes
    : [];
  assertTrue(ageReviewNotes.some((note) => String(note).includes("luar julat yuran PDF")), "Case2d: out-of-policy age note missing");
  console.log("PASS Case2d out-of-policy ages are flagged for manual review");

  // Case 3: Fee catalog callable policy guardrails
  const cat = await fns.billingGetFeeCatalog.run(mkReq({ uid, phone, data: {} }));
  assertTrue(cat && cat.ok, "Case3: billingGetFeeCatalog failed");
  assertTrue(Array.isArray(cat.policy && cat.policy.dueDayOptions), "Case3: dueDayOptions missing");
  assertTrue(cat.policy.dueDayOptions.includes(5) && cat.policy.dueDayOptions.includes(7), "Case3: dueDayOptions should include 5 and 7");
  console.log("PASS Case3 fee catalog policy includes due day 5/7");

  // Case 3b: Billing health callable should report valid active catalog
  const health = await fns.billingGetHealth.run(mkReq({ uid, phone, data: {} }));
  assertTrue(health && health.ok, "Case3b: billingGetHealth failed");
  assertTrue(health.health && health.health.isValid === true, "Case3b: expected valid billing health state");
  assertTrue(Array.isArray(health.health.missingRequiredCodes), "Case3b: missingRequiredCodes should be array");
  assertTrue(health.health.missingRequiredCodes.length === 0, "Case3b: active catalog should not miss required codes");
  assertTrue(Boolean(health.health.resolvedDefaultTransitCode), "Case3b: resolvedDefaultTransitCode missing");
  console.log("PASS Case3b billing health callable reports valid catalog");

  // Case 3c: Billing admin audit log should record save + activate actions
  const auditVersion = "e2e-audit-" + Date.now();
  const auditSave = await fns.billingAdminSaveCatalog.run(mkAdminReq({
    uid: "e2e-admin-1",
    phone,
    data: {
      version: auditVersion,
      table: feeTableFromAuditSeed(),
      defaultTransitMonthlyCode: "transit_2h_month",
    },
  }));
  assertTrue(auditSave && auditSave.ok, "Case3c: billingAdminSaveCatalog failed");
  assertTrue(Boolean(auditSave.catalogId), "Case3c: saved catalogId missing");

  const auditActivate = await fns.billingAdminActivateCatalog.run(mkAdminReq({
    uid: "e2e-admin-1",
    phone,
    data: {
      catalogId: auditSave.catalogId,
      defaultTransitMonthlyCode: "transit_2h_month",
    },
  }));
  assertTrue(auditActivate && auditActivate.ok, "Case3c: billingAdminActivateCatalog failed");

  const auditList = await fns.billingAdminListAudit.run(mkAdminReq({
    uid: "e2e-admin-1",
    phone,
    data: { limit: 10 },
  }));
  assertTrue(auditList && auditList.ok, "Case3c: billingAdminListAudit failed");
  const auditEntries = Array.isArray(auditList.entries) ? auditList.entries : [];
  assertTrue(auditEntries.some((entry) => entry.action === "catalog_saved" && entry.catalogId === auditSave.catalogId),
    "Case3c: missing catalog_saved audit entry");
  assertTrue(auditEntries.some((entry) => entry.action === "catalog_activated" && entry.catalogId === auditSave.catalogId),
    "Case3c: missing catalog_activated audit entry");
  console.log("PASS Case3c billing admin audit log records save + activate actions");

  // Case 3d: Generic checkout adapter callables preserve the current demo flow on the dummy provider
  await clearPayments(parent2);
  await clearInvoicesByPeriod(parent2, currentPeriod);
  const checkoutInvoice = await fns.billingCreateDemoInvoiceForCurrentMonth.run(mkReq({
    uid,
    phone,
    data: { parentId: parent2, childId: child2 },
  }));
  assertTrue(checkoutInvoice && checkoutInvoice.ok, "Case3d: invoice creation failed");
  const checkoutSession = await fns.billingCreateCheckoutSession.run(mkReq({
    uid,
    phone,
    data: { parentId: parent2, invoiceId: checkoutInvoice.invoiceId },
  }));
  assertTrue(checkoutSession && checkoutSession.ok, "Case3d: billingCreateCheckoutSession failed");
  assertTrue(checkoutSession.provider === "dummy", "Case3d: expected internal dummy provider by default");
  assertTrue(checkoutSession.mode === "dummy", "Case3d: expected internal dummy mode by default");
  assertTrue(checkoutSession.status === "pending", "Case3d: dummy checkout should start pending");
  assertTrue(Boolean(checkoutSession.sessionId), "Case3d: sessionId missing");

  const checkoutSessionRef = db.collection("parents").doc(parent2).collection("invoices")
    .doc(checkoutInvoice.invoiceId).collection("sessions").doc(checkoutSession.sessionId);
  const checkoutSessionSnap = await checkoutSessionRef.get();
  const checkoutSessionData = checkoutSessionSnap.data() || {};
  assertTrue(Boolean(checkoutSessionData.providerReference), "Case3d: providerReference missing on dummy session");
  assertTrue(Boolean(checkoutSessionData.expiresAt), "Case3d: expiresAt missing on dummy session");
  assertTrue(String(checkoutSessionData.status || "") === "pending", "Case3d: session doc should begin pending");

  const checkoutComplete = await fns.billingCompleteCheckoutSession.run(mkReq({
    uid,
    phone,
    data: {
      parentId: parent2,
      invoiceId: checkoutInvoice.invoiceId,
      sessionId: checkoutSession.sessionId,
      method: "FPX",
      bank: "Maybank2u",
    },
  }));
  assertTrue(checkoutComplete && checkoutComplete.ok, "Case3d: billingCompleteCheckoutSession failed");
  assertTrue(checkoutComplete.provider === "dummy", "Case3d: complete should report the internal dummy provider");
  assertTrue(String(checkoutComplete.status || "") === "processing", "Case3d: complete should move session into processing");
  assertTrue(checkoutComplete.paid === false, "Case3d: processing session should not be paid yet");

  const processingSnap = await checkoutSessionRef.get();
  const processingData = processingSnap.data() || {};
  assertTrue(String(processingData.status || "") === "processing", "Case3d: session doc should be processing after complete");
  assertTrue(String(processingData.bank || "") === "Maybank2u", "Case3d: bank should be captured on the session");

  await sleep(1700);
  const checkoutSync = await fns.billingSyncCheckoutSession.run(mkReq({
    uid,
    phone,
    data: {
      parentId: parent2,
      invoiceId: checkoutInvoice.invoiceId,
      sessionId: checkoutSession.sessionId,
    },
  }));
  assertTrue(checkoutSync && checkoutSync.ok, "Case3d: billingSyncCheckoutSession failed");
  assertTrue(String(checkoutSync.status || "") === "succeeded", "Case3d: sync should settle the dummy payment");
  assertTrue(checkoutSync.paid === true, "Case3d: sync should report the invoice as paid");
  assertTrue(Boolean(checkoutSync.paymentId), "Case3d: paymentId missing after sync");
  console.log("PASS Case3d generic checkout adapter preserves demo flow on the dummy provider");

  // Case 3da: Paying one shared-child invoice should sync the equivalent sibling invoice
  const sharedParentA = "e2e-parent-shared-a";
  const sharedParentB = "e2e-parent-shared-b";
  const sharedChild = "e2e-child-shared";
  await createParent({ parentId: sharedParentA, phoneE164: phone });
  await createParent({ parentId: sharedParentB, phoneE164: phone });
  await updateParent(sharedParentA, { childIds: [sharedChild], childNames: ["E2E Shared Child"] });
  await updateParent(sharedParentB, { childIds: [sharedChild], childNames: ["E2E Shared Child"] });
  await clearPayments(sharedParentA);
  await clearPayments(sharedParentB);
  await clearInvoicesByPeriod(sharedParentA, currentPeriod);
  await clearInvoicesByPeriod(sharedParentB, currentPeriod);
  await createChild({
    childId: sharedChild,
    name: "E2E Shared Child",
    careType: "fulltime",
    registrationType: "fulltime",
    staffChild: false,
    billingDueDay: 7,
    birthDate: "2024-01-15",
    registeredAt: admin.firestore.Timestamp.fromDate(lastMonth),
    transportFromTadika: false,
    registrationFeeAppliedPeriod: monthKey(lastMonth),
  });

  const sharedInvoiceA = await fns.billingCreateDemoInvoiceForCurrentMonth.run(mkReq({
    uid,
    phone,
    data: { parentId: sharedParentA, childId: sharedChild },
  }));
  const sharedInvoiceB = await fns.billingCreateDemoInvoiceForCurrentMonth.run(mkReq({
    uid,
    phone,
    data: { parentId: sharedParentB, childId: sharedChild },
  }));
  assertTrue(sharedInvoiceA && sharedInvoiceA.ok, "Case3da: shared invoice A creation failed");
  assertTrue(sharedInvoiceB && sharedInvoiceB.ok, "Case3da: shared invoice B creation failed");

  const sharedSession = await fns.billingCreateCheckoutSession.run(mkReq({
    uid,
    phone,
    data: { parentId: sharedParentA, invoiceId: sharedInvoiceA.invoiceId },
  }));
  assertTrue(sharedSession && sharedSession.ok, "Case3da: shared checkout session creation failed");

  const sharedComplete = await fns.billingCompleteCheckoutSession.run(mkReq({
    uid,
    phone,
    data: {
      parentId: sharedParentA,
      invoiceId: sharedInvoiceA.invoiceId,
      sessionId: sharedSession.sessionId,
      method: "FPX",
      bank: "CIMB Clicks",
    },
  }));
  assertTrue(sharedComplete && sharedComplete.ok, "Case3da: shared checkout completion failed");
  assertTrue(String(sharedComplete.status || "") === "processing", "Case3da: shared checkout should enter processing first");

  await sleep(1700);
  const sharedSync = await fns.billingSyncCheckoutSession.run(mkReq({
    uid,
    phone,
    data: {
      parentId: sharedParentA,
      invoiceId: sharedInvoiceA.invoiceId,
      sessionId: sharedSession.sessionId,
    },
  }));
  assertTrue(sharedSync && sharedSync.ok, "Case3da: shared checkout sync failed");
  assertTrue(sharedSync.paid === true, "Case3da: shared checkout sync should settle the source invoice");

  const sharedInvoiceDocA = await fetchInvoiceByPeriod({ parentId: sharedParentA, period: currentPeriod });
  const sharedInvoiceDocB = await fetchInvoiceByPeriod({ parentId: sharedParentB, period: currentPeriod });
  assertTrue(sharedInvoiceDocA, "Case3da: shared invoice A missing after payment");
  assertTrue(sharedInvoiceDocB, "Case3da: shared invoice B missing after payment");
  assertTrue(String(sharedInvoiceDocA.data.status || "") === "paid", "Case3da: source invoice should be paid");
  assertTrue(String(sharedInvoiceDocB.data.status || "") === "paid", "Case3da: sibling invoice should be synced to paid");
  assertTrue(String(sharedInvoiceDocB.data.sharedPaymentSourcePath || "") === `parents/${sharedParentA}/invoices/${sharedInvoiceA.invoiceId}`,
    "Case3da: sibling invoice should record the shared payment source path");
  assertTrue(String(sharedInvoiceDocB.data.paidReceiptNo || "") === String(sharedInvoiceDocA.data.paidReceiptNo || ""),
    "Case3da: sibling invoice should mirror the paid receipt number");
  console.log("PASS Case3da shared-child invoice payment sync stays aligned");

  // Case 3e: Real-provider config stays locked to dummy unless explicitly allowed
  await db.collection("billingConfig").doc("paymentGateway").set({
    provider: "billplz",
    mode: "redirect",
    enabled: true,
    collectionId: "test-collection",
    isSandbox: true,
    returnUrl: "https://example.test/return",
  }, { merge: false });

  await clearPayments(parent2);
  await clearInvoicesByPeriod(parent2, currentPeriod);
  const billplzInvoice = await fns.billingCreateDemoInvoiceForCurrentMonth.run(mkReq({
    uid,
    phone,
    data: { parentId: parent2, childId: child2 },
  }));
  assertTrue(billplzInvoice && billplzInvoice.ok, "Case3e: invoice creation failed");

  const billplzCreate = await fns.billingCreateCheckoutSession.run(mkReq({
    uid,
    phone,
    data: { parentId: parent2, invoiceId: billplzInvoice.invoiceId },
  }));
  assertTrue(billplzCreate && billplzCreate.ok, "Case3e: checkout creation should stay available under dummy lock");
  assertTrue(String(billplzCreate.provider || "") === "dummy", "Case3e: provider should be forced back to dummy");
  assertTrue(String(billplzCreate.mode || "") === "dummy", "Case3e: mode should be forced back to dummy");
  await db.collection("billingConfig").doc("paymentGateway").delete();
  console.log("PASS Case3e real-provider config is locked back to dummy without opt-in");

  // Case 3f: Billplz callback finalizes exactly once and is idempotent
  await clearPayments(parent2);
  await clearInvoicesByPeriod(parent2, currentPeriod);
  const callbackInvoice = await fns.billingCreateDemoInvoiceForCurrentMonth.run(mkReq({
    uid,
    phone,
    data: { parentId: parent2, childId: child2 },
  }));
  assertTrue(callbackInvoice && callbackInvoice.ok, "Case3f: invoice creation failed");

  const callbackInvoiceRef = db.collection("parents").doc(parent2).collection("invoices").doc(callbackInvoice.invoiceId);
  const callbackSessionRef = callbackInvoiceRef.collection("sessions").doc("e2e-billplz-session");
  await callbackSessionRef.set({
    provider: "billplz",
    mode: "redirect",
    status: "pending",
    currency: "MYR",
    amountSen: 18000,
    checkoutUrl: "https://www.billplz-sandbox.com/bills/e2e-bill-123",
    providerSessionId: "e2e-bill-123",
    providerReference: "e2e-bill-123",
    gatewaySummary: {
      provider: "billplz",
      mode: "redirect",
      enabled: true,
      isSandbox: true,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdByUid: uid,
  }, { merge: false });
  await db.collection("billingSessionLookup").doc(billingSessionLookupDocId("providerSessionId", "e2e-bill-123")).set({
    kind: "providerSessionId",
    value: "e2e-bill-123",
    sessionPath: callbackSessionRef.path,
    invoicePath: callbackInvoiceRef.path,
    provider: "billplz",
    status: "pending",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  await db.collection("billingSessionLookup").doc(billingSessionLookupDocId("providerReference", "e2e-bill-123")).set({
    kind: "providerReference",
    value: "e2e-bill-123",
    sessionPath: callbackSessionRef.path,
    invoicePath: callbackInvoiceRef.path,
    provider: "billplz",
    status: "pending",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  const priorSignatureKey = process.env.BILLPLZ_X_SIGNATURE_KEY;
  process.env.BILLPLZ_X_SIGNATURE_KEY = "e2e-billplz-signature-key";
  const callbackPayload = {
    id: "e2e-bill-123",
    collection_id: "sandbox-collection",
    paid: "true",
    state: "paid",
    amount: "18000",
    paid_amount: "18000",
    due_at: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-28`,
    email: "e2e-parent@example.com",
    mobile: phone,
    name: "E2E Parent",
    url: "https://www.billplz-sandbox.com/bills/e2e-bill-123",
    paid_at: "2026-01-15 10:10:10 +0800",
    transaction_id: "TXN-E2E-001",
    transaction_status: "completed",
  };
  callbackPayload.x_signature = billplzXSignatureForTest(callbackPayload, process.env.BILLPLZ_X_SIGNATURE_KEY);

  try {
    const callbackResult1 = await fns.__billingBillplzCallbackForTests({ method: "POST", body: callbackPayload });
    assertTrue(callbackResult1 && callbackResult1.status === 200, "Case3f: first callback should return 200");
    assertTrue(callbackResult1.body && callbackResult1.body.ok, "Case3f: first callback should succeed");

    const callbackResult2 = await fns.__billingBillplzCallbackForTests({ method: "POST", body: callbackPayload });
    assertTrue(callbackResult2 && callbackResult2.status === 200, "Case3f: duplicate callback should return 200");
    assertTrue(callbackResult2.body && callbackResult2.body.ok, "Case3f: duplicate callback should stay ok");
    assertTrue(callbackResult2.body && callbackResult2.body.already === true, "Case3f: duplicate callback should be idempotent");
  } finally {
    if (typeof priorSignatureKey === "undefined") {
      delete process.env.BILLPLZ_X_SIGNATURE_KEY;
    } else {
      process.env.BILLPLZ_X_SIGNATURE_KEY = priorSignatureKey;
    }
  }

  const callbackInvoiceSnap = await callbackInvoiceRef.get();
  const callbackInvoiceData = callbackInvoiceSnap.data() || {};
  assertTrue(String(callbackInvoiceData.status || "") === "paid", "Case3f: invoice should be paid after callback");
  assertTrue(String(callbackInvoiceData.paidProvider || "") === "billplz", "Case3f: invoice should record billplz provider");

  const callbackPayments = await listPayments(parent2);
  assertTrue(callbackPayments.length === 1, "Case3f: duplicate callback should not create duplicate payments");
  assertTrue(String(callbackPayments[0].data.externalPaymentId || "") === "TXN-E2E-001", "Case3f: payment should record external transaction id");
  console.log("PASS Case3f billplz callback finalizes once and stays idempotent");

  // Case 4: Salary config callable
  await db.collection("teachers").doc("e2e-teacher-1").set({
    phoneE164: phone,
    salaryCurrency: "MYR",
    salaryActive: true,
    salaryBaseSen: 180000,
    salaryOvertimeAfter530Sen: 500,
    salaryOvertime8to12Sen: 1000,
    salaryOvertime12to7Sen: 700,
  }, { merge: true });

  const sal = await fns.salaryGetTeacherConfigForCurrentUser.run(mkReq({ uid: "e2e-teacher-auth", phone, data: {} }));
  assertTrue(sal && sal.ok, "Case4: salaryGetTeacherConfigForCurrentUser failed");
  assertTrue(sal.salary && sal.salary.baseSen === 180000, "Case4: salary base mismatch");
  console.log("PASS Case4 salary config callable");

  // Case 5: January-only policy item should add annual fee but not repeat registration-only charges
  const janDate = new Date(2026, 0, 15, 10, 0, 0);
  const janPeriod = monthKey(janDate);
  const parent3 = "e2e-parent-jan";
  const child3 = "e2e-child-jan";
  await createParent({ parentId: parent3, phoneE164: phone });
  await clearInvoicesByPeriod(parent3, janPeriod);
  await createChild({
    childId: child3,
    name: "E2E Child Jan",
    careType: "fulltime",
    registrationType: "fulltime",
    staffChild: false,
    billingDueDay: 7,
    birthDate: "2022-01-01",
    registeredAt: admin.firestore.Timestamp.fromDate(new Date(2025, 11, 20, 10, 0, 0)),
    transportFromTadika: false,
    registrationFeeAppliedPeriod: "2025-12",
  });

  await withMockDate(janDate, async () => {
    const janRes = await fns.billingCreateDemoInvoiceForCurrentMonth.run(mkReq({
      uid,
      phone,
      data: {
        parentId: parent3,
        childId: child3,
      },
    }));
    assertTrue(janRes && janRes.ok, "Case5: January invoice creation failed");
  });

  const inv3 = await fetchInvoiceByPeriod({ parentId: parent3, period: janPeriod });
  assertTrue(inv3, "Case5: January invoice missing");
  const items3 = Array.isArray(inv3.data.items) ? inv3.data.items : [];
  assertTrue(items3.some((i) => i.code === "annual_fee_yearly"), "Case5: annual fee missing in January");
  assertTrue(!items3.some((i) => i.code === "comms_book_oneoff" || i.code === "comms_book_4months"), "Case5: communication book should not repeat in January");
  assertTrue(!items3.some((i) => i.code === "insurance_oneoff_age2plus" || i.code === "insurance_yearly_age2plus"), "Case5: insurance should not repeat in January");
  assertTrue(items3.some((i) => String(i.code || "").startsWith("monthly_fulltime_")), "Case5: monthly base missing in January");
  const due3 = inv3.data.dueDate && inv3.data.dueDate.toDate ? inv3.data.dueDate.toDate() : null;
  assertTrue(due3 && due3.getDate() === 7, "Case5: January due day expected 7");
  console.log("PASS Case5 January annual-fee-only policy");

  // Case 6: Broken active catalog should fail fast with failed-precondition
  const brokenCatalogId = "e2e-broken-catalog";
  const prevPointerSnap = await db.collection("billingConfig").doc("current").get();
  const prevPointer = prevPointerSnap.exists ? (prevPointerSnap.data() || {}) : null;

  await db.collection("billingCatalog").doc(brokenCatalogId).set({
    active: true,
    version: "e2e-broken",
    defaultTransitMonthlyCode: "transit_2h_month",
    table: {
      monthly_fulltime_3m_2y: { staff: 35000, nonstaff: 40000 },
    },
  }, { merge: false });

  await db.collection("billingConfig").doc("current").set({
    activeCatalogId: brokenCatalogId,
    defaultTransitMonthlyCode: "transit_2h_month",
  }, { merge: true });
  if (typeof fns.__resetBillingCatalogCacheForTests === "function") {
    fns.__resetBillingCatalogCacheForTests();
  }

  await clearInvoicesByPeriod(parent2, currentPeriod);
  let sawFailedPrecondition = false;
  try {
    await fns.billingCreateDemoInvoiceForCurrentMonth.run(mkReq({
      uid,
      phone,
      data: {
        parentId: parent2,
        childId: child2,
      },
    }));
  } catch (err) {
    sawFailedPrecondition = String((err && err.code) || "").toLowerCase().includes("failed-precondition")
      || String((err && err.message) || "").toLowerCase().includes("billing-catalog-missing-required-codes");
  }

  if (prevPointer) {
    await db.collection("billingConfig").doc("current").set(prevPointer, { merge: false });
  } else {
    await db.collection("billingConfig").doc("current").delete();
  }
  if (typeof fns.__resetBillingCatalogCacheForTests === "function") {
    fns.__resetBillingCatalogCacheForTests();
  }
  await db.collection("billingCatalog").doc(brokenCatalogId).delete();

  assertTrue(sawFailedPrecondition, "Case6: expected failed-precondition for broken active catalog");
  console.log("PASS Case6 broken catalog fails fast");

  console.log("\nAll E2E checks passed.");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("E2E billing check failed:", err && err.message ? err.message : err);
    process.exit(1);
  });

function feeTableFromAuditSeed() {
  return {
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
    overtime_12am_7am: { staff: 700, nonstaff: 1000 },
    transport_tadika_month: { staff: 15000, nonstaff: 15000 },
    registration_fulltime_oneoff: { staff: 10000, nonstaff: 10000 },
    registration_transit_oneoff: { staff: 5000, nonstaff: 5000 },
    annual_fee_yearly: { staff: 10000, nonstaff: 10000 },
    comms_book_oneoff: { staff: 1500, nonstaff: 1500 },
    comms_book_4months: { staff: 1500, nonstaff: 1500 },
    insurance_oneoff_age2plus: { staff: 2000, nonstaff: 2000 },
    insurance_yearly_age2plus: { staff: 2000, nonstaff: 2000 },
  };
}
