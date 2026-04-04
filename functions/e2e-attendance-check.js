/* eslint-disable no-console */
const admin = require("firebase-admin");
const fns = require("./index");

const db = admin.firestore();

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function teacherReq(data) {
  return {
    auth: {
      uid: "e2e-teacher-1",
      token: {
        role: "teacher",
        email: "teacher-e2e@example.com",
        phone_number: "+601122233344",
      },
    },
    data: data || {},
  };
}

function adminReq(data) {
  return {
    auth: {
      uid: "e2e-admin-1",
      token: {
        role: "admin",
        email: "admin-e2e@example.com",
        phone_number: "+601199988877",
      },
    },
    data: data || {},
  };
}

async function run() {
  const suffix = Date.now().toString(36).toUpperCase();
  const parentId = `e2e-att-parent-${suffix}`;
  const childId = `e2e-att-child-${suffix}`;
  const token = `PICKUP${suffix}`;

  await db.collection("parents").doc(parentId).set({
    parentName: "E2E Parent",
    phone: "01122233344",
    phoneTail: "1122233344",
    phoneE164: "+601122233344",
    dailyQrToken: token,
    representativeName: "E2E Guardian",
    representativeRole: "Mother",
  }, { merge: true });

  await db.collection("children").doc(childId).set({
    name: "E2E Child",
    parentName: "E2E Parent",
    parentContact: "01122233344",
    nfc_uid: "A1B2C3D4",
  }, { merge: true });

  await db.collection("parents").doc(parentId).collection("tokens").doc(token).set({
    parentId,
    childId,
    childName: "E2E Child",
    used: false,
    expiredAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + (15 * 60 * 1000))),
    representativeName: "E2E Guardian",
    representativeRole: "Mother",
  }, { merge: true });

  const checkIn = await fns.attendanceNfcCheckIn.run(teacherReq({
    childId,
    nfcUid: "A1B2C3D4",
    teacherName: "E2E Teacher",
  }));
  assertTrue(checkIn && checkIn.ok, `check-in failed: ${JSON.stringify(checkIn)}`);

  const attendanceId = `${checkIn.dateKey}_${childId}`;
  let snap = await db.collection("attendance").doc(attendanceId).get();
  assertTrue(snap.exists, "attendance document missing after check-in");
  let attendance = snap.data() || {};
  assertTrue(String(attendance.status || "") === "CHECKED_IN", "attendance status should be CHECKED_IN");
  assertTrue(Boolean(attendance.check_in_time), "legacy check_in_time missing after check-in");
  assertTrue(Boolean(attendance.checkInAt), "checkInAt missing after check-in");
  assertTrue(!attendance.check_out_time, "check_out_time should be empty after check-in");

  const duplicateCheckIn = await fns.attendanceNfcCheckIn.run(teacherReq({
    childId,
    nfcUid: "A1B2C3D4",
    teacherName: "E2E Teacher",
  }));
  assertTrue(!duplicateCheckIn.ok && duplicateCheckIn.reason === "attendance-already-open", "duplicate check-in should be rejected");

  const checkOut = await fns.attendanceCheckoutWithParentQr.run(teacherReq({
    qrToken: `QR_${token}`,
    teacherName: "E2E Teacher",
  }));
  assertTrue(checkOut && checkOut.ok, `checkout failed: ${JSON.stringify(checkOut)}`);

  snap = await db.collection("attendance").doc(attendanceId).get();
  attendance = snap.data() || {};
  assertTrue(String(attendance.status || "") === "CHECKED_OUT", "attendance status should be CHECKED_OUT");
  assertTrue(Boolean(attendance.check_out_time), "legacy check_out_time missing after checkout");
  assertTrue(Boolean(attendance.checkOutAt), "checkOutAt missing after checkout");
  assertTrue(String(attendance.checkout_method || "") === "PARENT_QR", "legacy checkout_method should be PARENT_QR");
  assertTrue(String(attendance.checkOutMethod || "") === "PARENT_QR", "checkOutMethod should be PARENT_QR");
  assertTrue(String(attendance.pickupGuardianNameSnapshot || "") === "E2E Guardian", "pickup guardian snapshot missing");

  const tokenSnap = await db.collection("parents").doc(parentId).collection("tokens").doc(token).get();
  assertTrue(tokenSnap.exists && tokenSnap.data().used === true, "pickup token should be marked used");

  const duplicateCheckOut = await fns.attendanceCheckoutWithParentQr.run(teacherReq({
    qrToken: token,
    teacherName: "E2E Teacher",
  }));
  assertTrue(!duplicateCheckOut.ok && duplicateCheckOut.reason === "pickup-token-already-used", "duplicate checkout should be rejected");

  const reopen = await fns.attendanceAdminOverride.run(adminReq({
    action: "REOPEN_RECORD",
    childId,
    attendanceDate: checkIn.dateKey,
    reason: "Correcting QR checkout",
    notes: "Reopened for admin correction",
    adminName: "E2E Admin",
  }));
  assertTrue(reopen && reopen.ok, `reopen failed: ${JSON.stringify(reopen)}`);

  snap = await db.collection("attendance").doc(attendanceId).get();
  attendance = snap.data() || {};
  assertTrue(String(attendance.status || "") === "CHECKED_IN", "attendance status should return to CHECKED_IN after reopen");
  assertTrue(!attendance.check_out_time, "check_out_time should be cleared after reopen");
  assertTrue(!attendance.checkOutAt, "checkOutAt should be cleared after reopen");

  const editedCheckInAt = new Date("2026-03-20T00:15:00.000Z");
  const editedCheckOutAt = new Date("2026-03-20T09:45:00.000Z");
  const editRecord = await fns.attendanceAdminOverride.run(adminReq({
    action: "EDIT_RECORD",
    childId,
    attendanceDate: checkIn.dateKey,
    reason: "Backfilling corrected times",
    notes: "Adjusted after guardian confirmation",
    adminName: "E2E Admin",
    checkInAt: editedCheckInAt.toISOString(),
    checkOutAt: editedCheckOutAt.toISOString(),
  }));
  assertTrue(editRecord && editRecord.ok, `edit record failed: ${JSON.stringify(editRecord)}`);

  snap = await db.collection("attendance").doc(attendanceId).get();
  attendance = snap.data() || {};
  assertTrue(String(attendance.status || "") === "CHECKED_OUT", "attendance status should be CHECKED_OUT after edit");
  assertTrue(attendance.checkInAt && attendance.checkInAt.toDate().toISOString() === editedCheckInAt.toISOString(), "edited checkInAt mismatch");
  assertTrue(attendance.checkOutAt && attendance.checkOutAt.toDate().toISOString() === editedCheckOutAt.toISOString(), "edited checkOutAt mismatch");
  assertTrue(String(attendance.manualEditReason || "") === "Backfilling corrected times", "manual edit reason missing after edit");

  const markAbsent = await fns.attendanceAdminOverride.run(adminReq({
    action: "MARK_ABSENT",
    childId,
    attendanceDate: checkIn.dateKey,
    reason: "Removing record after audit review",
    notes: "Attendance entry was invalid",
    adminName: "E2E Admin",
  }));
  assertTrue(markAbsent && markAbsent.ok, `mark absent failed: ${JSON.stringify(markAbsent)}`);

  snap = await db.collection("attendance").doc(attendanceId).get();
  attendance = snap.data() || {};
  assertTrue(String(attendance.status || "") === "NOT_CHECKED_IN", "attendance status should be NOT_CHECKED_IN after mark absent");
  assertTrue(!attendance.check_in_time, "check_in_time should be cleared after mark absent");
  assertTrue(!attendance.check_out_time, "check_out_time should be cleared after mark absent");
  assertTrue(attendance.isPresent === false, "isPresent should be false after mark absent");

  const auditSnap = await db.collection("attendanceAudit")
    .where("attendanceId", "==", attendanceId)
    .get();
  assertTrue(auditSnap.size >= 5, "attendance audit entries missing admin override history");

  const esp32ParentId = `e2e-att-parent-esp32-${suffix}`;
  const esp32ChildId = `e2e-att-child-esp32-${suffix}`;
  const esp32Token = `PICKUPESP32${suffix}`;
  const esp32NfcUid = `ESP32${suffix}`;
  const esp32ChildRef = db.collection("children").doc(esp32ChildId);
  const esp32AttendanceId = `${checkIn.dateKey}_${esp32NfcUid}`;

  await db.collection("parents").doc(esp32ParentId).set({
    parentName: "E2E ESP32 Parent",
    phone: "01122233345",
    phoneTail: "1122233345",
    phoneE164: "+601122233345",
    dailyQrToken: esp32Token,
    childId: esp32ChildId,
    childName: "E2E ESP32 Child",
    childRef: esp32ChildRef,
    representativeName: "E2E ESP32 Guardian",
    representativeRole: "Father",
  }, { merge: true });

  await db.collection("children").doc(esp32ChildId).set({
    child_id: 900001,
    name: "E2E ESP32 Child",
    parentName: "E2E ESP32 Parent",
    parentContact: "01122233345",
    nfc_uid: esp32NfcUid,
  }, { merge: true });

  await db.collection("parents").doc(esp32ParentId).collection("tokens").doc(esp32Token).set({
    parentId: esp32ParentId,
    childId: esp32ChildId,
    childName: "E2E ESP32 Child",
    childRef: esp32ChildRef,
    used: false,
    expiredAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + (15 * 60 * 1000))),
    representativeName: "E2E ESP32 Guardian",
    representativeRole: "Father",
  }, { merge: true });

  await db.collection("attendance").doc(esp32AttendanceId).set({
    attendanceId: esp32AttendanceId,
    childId: esp32NfcUid,
    childRef: esp32ChildRef,
    name: "E2E ESP32 Child",
    parentName: "E2E ESP32 Parent",
    dateKey: checkIn.dateKey,
    status: "CHECKED_IN",
    checkInAt: admin.firestore.Timestamp.fromDate(new Date()),
    check_in_time: admin.firestore.Timestamp.fromDate(new Date()),
    isPresent: true,
    is_present: true,
    checkin_method: "NFC",
  }, { merge: true });

  const esp32CheckOut = await fns.attendanceCheckoutWithParentQr.run(teacherReq({
    qrToken: `QR_${esp32Token}`,
    teacherName: "E2E Teacher",
  }));
  assertTrue(esp32CheckOut && esp32CheckOut.ok, `ESP32-style checkout failed: ${JSON.stringify(esp32CheckOut)}`);

  const esp32AttendanceSnap = await db.collection("attendance").doc(esp32AttendanceId).get();
  const esp32Attendance = esp32AttendanceSnap.data() || {};
  assertTrue(esp32AttendanceSnap.exists, "ESP32-style attendance document missing after checkout");
  assertTrue(String(esp32Attendance.status || "") === "CHECKED_OUT", "ESP32-style attendance status should be CHECKED_OUT");
  assertTrue(Boolean(esp32Attendance.check_out_time), "ESP32-style legacy check_out_time missing after checkout");
  assertTrue(Boolean(esp32Attendance.checkOutAt), "ESP32-style checkOutAt missing after checkout");
  assertTrue(String(esp32Attendance.childId || "") === esp32NfcUid, "ESP32-style checkout should preserve NFC-based childId");
  assertTrue(String(esp32Attendance.name || "") === "E2E ESP32 Child", "ESP32-style checkout should preserve child name");

  const esp32MarkAbsent = await fns.attendanceAdminOverride.run(adminReq({
    action: "MARK_ABSENT",
    childId: esp32ChildId,
    attendanceDate: checkIn.dateKey,
    reason: "Removing duplicate legacy NFC entry",
    notes: "Should patch the existing NFC-keyed doc instead of creating a second record",
    adminName: "E2E Admin",
  }));
  assertTrue(esp32MarkAbsent && esp32MarkAbsent.ok, `ESP32-style mark absent failed: ${JSON.stringify(esp32MarkAbsent)}`);

  const esp32AttendanceAfterAbsentSnap = await db.collection("attendance").doc(esp32AttendanceId).get();
  const esp32AttendanceAfterAbsent = esp32AttendanceAfterAbsentSnap.data() || {};
  assertTrue(esp32AttendanceAfterAbsentSnap.exists, "ESP32-style attendance document missing after mark absent");
  assertTrue(String(esp32AttendanceAfterAbsent.status || "") === "NOT_CHECKED_IN", "ESP32-style attendance should become NOT_CHECKED_IN after mark absent");
  assertTrue(!esp32AttendanceAfterAbsent.check_in_time, "ESP32-style legacy check_in_time should be cleared after mark absent");
  assertTrue(!esp32AttendanceAfterAbsent.checkOutAt, "ESP32-style checkOutAt should be cleared after mark absent");
  assertTrue(String(esp32AttendanceAfterAbsent.childId || "") === esp32ChildId, "ESP32-style admin override should canonicalize childId");
  assertTrue(String(esp32AttendanceAfterAbsent.attendanceId || "") === esp32AttendanceId, "ESP32-style admin override should preserve the original doc id as attendanceId");

  const duplicateCanonicalAttendanceSnap = await db.collection("attendance").doc(`${checkIn.dateKey}_${esp32ChildId}`).get();
  assertTrue(!duplicateCanonicalAttendanceSnap.exists, "Admin override should not create a duplicate canonical attendance document for ESP32-style records");

  console.log("PASS attendance E2E: NFC check-in + QR checkout + ESP32 QR checkout + admin override audit");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
