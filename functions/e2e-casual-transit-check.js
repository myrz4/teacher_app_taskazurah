/* eslint-disable no-console */
const admin = require("firebase-admin");
const fns = require("./index");

const db = admin.firestore();

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function adminReq(data) {
  return {
    auth: {
      uid: "e2e-admin-casual-1",
      token: {
        role: "admin",
        email: "admin-casual-e2e@example.com",
        phone_number: "+601144455566",
      },
    },
    data: data || {},
  };
}

async function run() {
  const create = await fns.casualTransitCreateVisit.run(adminReq({
    childName: "Walk In Child",
    guardianName: "Walk In Guardian",
    guardianPhone: "01144455566",
    guardianRelationship: "Aunt",
    notes: "E2E casual transit visit",
    adminName: "E2E Admin",
  }));

  assertTrue(create && create.ok, `create visit failed: ${JSON.stringify(create)}`);
  assertTrue(Boolean(create.visitId), "visitId should be returned");

  let visitSnap = await db.collection("casualTransitVisits").doc(create.visitId).get();
  assertTrue(visitSnap.exists, "casual transit visit document missing");
  let visit = visitSnap.data() || {};
  assertTrue(String(visit.status || "") === "OPEN", "visit should start OPEN");
  assertTrue(String(visit.paymentStatus || "") === "PENDING", "payment status should start PENDING");
  assertTrue(Boolean(visit.checkInAt), "checkInAt should be set");

  const checkout = await fns.casualTransitCheckoutVisit.run(adminReq({
    visitId: create.visitId,
    amountSen: 2500,
    paymentMethod: "Cash",
    notes: "Paid on pickup",
    adminName: "E2E Admin",
  }));

  assertTrue(checkout && checkout.ok, `checkout visit failed: ${JSON.stringify(checkout)}`);
  assertTrue(String(checkout.receiptNo || "").startsWith("CT-"), "receipt should be generated");

  visitSnap = await db.collection("casualTransitVisits").doc(create.visitId).get();
  visit = visitSnap.data() || {};
  assertTrue(String(visit.status || "") === "CLOSED", "visit should be CLOSED after checkout");
  assertTrue(String(visit.paymentStatus || "") === "PAID", "payment status should be PAID after checkout");
  assertTrue(Number(visit.amountSen || 0) === 2500, "amountSen should be recorded");
  assertTrue(String(visit.receiptNo || "").startsWith("CT-"), "visit receipt should be stored");
  assertTrue(Boolean(visit.checkOutAt), "checkOutAt should be set");

  const secondCheckout = await fns.casualTransitCheckoutVisit.run(adminReq({
    visitId: create.visitId,
    amountSen: 2500,
    paymentMethod: "Cash",
    adminName: "E2E Admin",
  }));
  assertTrue(!secondCheckout.ok && secondCheckout.reason === "visit-already-closed", "duplicate checkout should be rejected");

  const reopen = await fns.casualTransitAdminOverride.run(adminReq({
    action: "REOPEN_VISIT",
    visitId: create.visitId,
    reason: "Correcting pickup entry",
    notes: "Need to update amount",
    adminName: "E2E Admin",
  }));
  assertTrue(reopen && reopen.ok, `reopen visit failed: ${JSON.stringify(reopen)}`);

  visitSnap = await db.collection("casualTransitVisits").doc(create.visitId).get();
  visit = visitSnap.data() || {};
  assertTrue(String(visit.status || "") === "OPEN", "visit should be OPEN after reopen");
  assertTrue(String(visit.paymentStatus || "") === "PENDING", "payment status should be PENDING after reopen");
  assertTrue(!visit.checkOutAt, "checkOutAt should be cleared after reopen");
  assertTrue(!visit.receiptNo, "receipt should be cleared after reopen");

  const editedCheckIn = new Date("2026-04-01T00:30:00.000Z");
  const edit = await fns.casualTransitAdminOverride.run(adminReq({
    action: "EDIT_VISIT",
    visitId: create.visitId,
    childName: "Walk In Child Updated",
    guardianName: "Walk In Guardian Updated",
    guardianPhone: "01144455577",
    guardianRelationship: "Uncle",
    checkInAt: editedCheckIn.toISOString(),
    reason: "Fixing visitor details",
    notes: "Updated guardian contact",
    adminName: "E2E Admin",
  }));
  assertTrue(edit && edit.ok, `edit visit failed: ${JSON.stringify(edit)}`);

  visitSnap = await db.collection("casualTransitVisits").doc(create.visitId).get();
  visit = visitSnap.data() || {};
  assertTrue(String(visit.childName || "") === "Walk In Child Updated", "child name should update after edit");
  assertTrue(String(visit.guardianName || "") === "Walk In Guardian Updated", "guardian name should update after edit");
  assertTrue(String(visit.guardianPhone || "") === "01144455577", "guardian phone should update after edit");

  const cancel = await fns.casualTransitAdminOverride.run(adminReq({
    action: "CANCEL_VISIT",
    visitId: create.visitId,
    reason: "Visit entered in error",
    notes: "Canceled during QA",
    adminName: "E2E Admin",
  }));
  assertTrue(cancel && cancel.ok, `cancel visit failed: ${JSON.stringify(cancel)}`);

  visitSnap = await db.collection("casualTransitVisits").doc(create.visitId).get();
  visit = visitSnap.data() || {};
  assertTrue(String(visit.status || "") === "CANCELED", "visit should be CANCELED after cancel");
  assertTrue(String(visit.paymentStatus || "") === "VOID", "payment status should be VOID after cancel");
  assertTrue(String(visit.cancellationReason || "") === "Visit entered in error", "cancellation reason should be stored");

  const auditSnap = await db.collection("casualTransitAudit").where("visitId", "==", create.visitId).get();
  assertTrue(auditSnap.size >= 5, "casual transit audit trail should include override history");

  console.log("PASS casual transit E2E: create visit + paid checkout + admin overrides + audit");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});