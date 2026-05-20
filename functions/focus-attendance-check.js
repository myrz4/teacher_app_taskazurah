const admin = require("firebase-admin");
require("./index");
const fns = require("./index");

const db = admin.firestore();

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function teacherReq(data) {
  return {
    auth: {
      uid: "focus-teacher-1",
      token: {
        role: "teacher",
        name: "Focus Teacher",
        email: "focus-teacher@example.com",
        phone_number: "+601155500001",
      },
    },
    data: data || {},
  };
}

function adminReq(data) {
  return {
    auth: {
      uid: "focus-admin-1",
      token: {
        role: "admin",
        name: "Focus Admin",
        email: "focus-admin@example.com",
        phone_number: "+601155500002",
      },
    },
    data: data || {},
  };
}

async function run() {
  const suffix = Date.now().toString(36).toUpperCase();
  const now = new Date();
  const dateKey = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
  const [year, month, day] = dateKey.split("-").map((value) => Number(value));
  const startOfDay = admin.firestore.Timestamp.fromDate(new Date(Date.UTC(year, month - 1, day, -8, 0, 0, 0)));
  const checkInAt = admin.firestore.Timestamp.fromDate(new Date(now.getTime() - (2 * 60 * 60 * 1000)));
  const manualCheckOutIso = now.toISOString();

  const qrParentId = `focus-parent-${suffix}`;
  const qrChildId = `focus-child-${suffix}`;
  const qrToken = `FOCUSQR${suffix}`;
  const qrAttendanceId = `${dateKey}_${qrChildId}`;

  await db.collection("parents").doc(qrParentId).set({
    parentName: "Focus Parent",
    phone: "01155500003",
    phoneTail: "1155500003",
    phoneE164: "+601155500003",
    dailyQrToken: qrToken,
    representativeName: "Focus Guardian",
    representativeRole: "Mother",
  }, { merge: true });
  await db.collection("parents").doc(qrParentId).collection("tokens").doc(qrToken).set({
    parentId: qrParentId,
    childId: qrChildId,
    childName: "Focus Child",
    used: false,
    expiredAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + (15 * 60 * 1000))),
    representativeName: "Focus Guardian",
    representativeRole: "Mother",
  }, { merge: true });
  await db.collection("children").doc(qrChildId).set({
    name: "Focus Child",
    parentName: "Focus Parent",
    parentContact: "01155500003",
    nfc_uid: `FOCUSNFC${suffix}`,
  }, { merge: true });
  await db.collection("attendance").doc(qrAttendanceId).set({
    attendanceId: qrAttendanceId,
    childId: qrChildId,
    name: "Focus Child",
    parentName: "Focus Parent",
    date: startOfDay,
    dateKey,
    status: "CHECKED_IN",
    checkInAt,
    check_in_time: checkInAt,
    isPresent: true,
    is_present: true,
    checkin_method: "NFC",
  }, { merge: true });

  const qrResult = await fns.attendanceCheckoutWithParentQr.run(teacherReq({ qrToken: `QR_${qrToken}` }));
  assertTrue(qrResult && qrResult.ok, `QR checkout failed: ${JSON.stringify(qrResult)}`);

  const qrAttendance = (await db.collection("attendance").doc(qrAttendanceId).get()).data() || {};
  assertTrue(String(qrAttendance.checkedOutByTeacherId || "") === "focus-teacher-1", "QR checkout teacher id missing");
  assertTrue(String(qrAttendance.checkedOutByTeacherName || "") === "Focus Teacher", "QR checkout teacher name missing");
  assertTrue(String(qrAttendance.checkedOutByTeacherEmail || "") === "focus-teacher@example.com", "QR checkout teacher email missing");

  const manualTeacherId = `focus-manual-teacher-${suffix}`;
  const manualChildId = `focus-manual-child-${suffix}`;
  const manualAttendanceId = `${dateKey}_${manualChildId}`;
  await db.collection("teachers").doc(manualTeacherId).set({
    name: "Manual Teacher",
    email: "manual-teacher@example.com",
    phone: "01155500004",
    phoneTail: "1155500004",
    phoneE164: "+601155500004",
    salaryBaseSen: 200000,
    salaryCurrency: "MYR",
    salaryActive: true,
  }, { merge: true });
  await db.collection("children").doc(manualChildId).set({
    name: "Manual Child",
    parentName: "Focus Parent",
    parentContact: "01155500003",
    nfc_uid: `MANUALNFC${suffix}`,
  }, { merge: true });
  await db.collection("attendance").doc(manualAttendanceId).set({
    attendanceId: manualAttendanceId,
    childId: manualChildId,
    name: "Manual Child",
    parentName: "Focus Parent",
    date: startOfDay,
    dateKey,
    status: "CHECKED_IN",
    checkInAt,
    check_in_time: checkInAt,
    isPresent: true,
    is_present: true,
    checkin_method: "MANUAL",
  }, { merge: true });

  const missingTeacher = await fns.attendanceAdminOverride.run(adminReq({
    action: "MANUAL_CHECK_OUT",
    childId: manualChildId,
    attendanceDate: dateKey,
    checkOutAt: manualCheckOutIso,
    reason: "Focus manual checkout",
    adminName: "Focus Admin",
  }));
  assertTrue(!missingTeacher.ok && missingTeacher.reason === "missing-checkout-teacher", `Expected missing-checkout-teacher, got ${JSON.stringify(missingTeacher)}`);

  const manualResult = await fns.attendanceAdminOverride.run(adminReq({
    action: "MANUAL_CHECK_OUT",
    childId: manualChildId,
    attendanceDate: dateKey,
    checkOutAt: manualCheckOutIso,
    checkedOutByTeacherId: manualTeacherId,
    reason: "Focus manual checkout",
    notes: "Manual checkout validation",
    adminName: "Focus Admin",
  }));
  assertTrue(manualResult && manualResult.ok, `Manual checkout failed: ${JSON.stringify(manualResult)}`);

  const manualAttendance = (await db.collection("attendance").doc(manualAttendanceId).get()).data() || {};
  assertTrue(String(manualAttendance.checkedOutByTeacherId || "") === manualTeacherId, "Manual checkout teacher id missing");
  assertTrue(String(manualAttendance.checkedOutByTeacherName || "") === "Manual Teacher", "Manual checkout teacher name missing");
  assertTrue(String(manualAttendance.checkedOutByTeacherEmail || "") === "manual-teacher@example.com", "Manual checkout teacher email missing");
  assertTrue(String(manualAttendance.checkedOutByUid || "") === "focus-admin-1", "Manual checkout actor should remain admin");

  console.log(JSON.stringify({ ok: true, qrAttendanceId, manualAttendanceId }));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
