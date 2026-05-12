/* eslint-disable no-console */
const admin = require("firebase-admin");
const fns = require("./index");

const db = admin.firestore();

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function monthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function timestampFromDate(date) {
  return admin.firestore.Timestamp.fromDate(date);
}

function reqForParent({ uid, phone, data }) {
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

function reqForAdmin({ uid, data }) {
  return {
    auth: {
      uid,
      token: {
        role: "admin",
        email: "admin-e2e@taskazurah.test",
      },
    },
    data: data || {},
  };
}

async function createParent({ parentId, phoneE164, childIds = [], childNames = [] }) {
  const tail = phoneE164.replace(/^\+60/, "").replace(/^0/, "");
  const local = `0${tail}`;
  await db.collection("parents").doc(parentId).set({
    parentName: `E2E ${parentId}`,
    phone: local,
    phoneTail: tail,
    phoneE164,
    payerType: "nonstaff",
    childIds,
    childNames,
  }, { merge: true });
}

async function createChild({ childId, name, birthDate, registeredAt, registrationFeeAppliedPeriod = "", staffChild = false }) {
  await db.collection("children").doc(childId).set({
    name,
    birthDate,
    registeredAt,
    registrationFeeAppliedPeriod,
    staffChild: Boolean(staffChild),
    careType: "fulltime",
    feePlan: "monthly",
    registrationType: "fulltime",
    billingDueDay: 7,
    transportFromTadika: false,
  }, { merge: true });
}

async function updateParent(parentId, patch) {
  await db.collection("parents").doc(parentId).set(patch, { merge: true });
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
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

async function seedAttendanceRows(childId, rows, options = {}) {
  const baseDate = options.baseDate ? new Date(options.baseDate) : new Date();
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();

  await Promise.all((rows || []).map((row, index) => {
    const day = Number(row.day || 1);
    const dateOnly = new Date(year, month, day, 0, 0, 0);
    const payload = {
      childId,
      date: timestampFromDate(dateOnly),
    };

    if (Number.isFinite(Number(row.checkInHour))) {
      payload.checkInAt = timestampFromDate(new Date(year, month, day, Number(row.checkInHour), Number(row.checkInMinute || 0), 0));
      payload.check_in_time = payload.checkInAt;
    }
    if (Number.isFinite(Number(row.checkOutHour))) {
      payload.checkOutAt = timestampFromDate(new Date(year, month, day, Number(row.checkOutHour), Number(row.checkOutMinute || 0), 0));
      payload.check_out_time = payload.checkOutAt;
      payload.status = "CHECKED_OUT";
      payload.isPresent = true;
      payload.is_present = true;
    }

    return db.collection("attendance").doc(`taska-zurah-${childId}-${day}-${index}`).set(payload, { merge: true });
  }));
}

function hasCode(items, code) {
  return (items || []).some((item) => String(item && item.code ? item.code : "") === code);
}

function hasOvertimeCode(items) {
  return (items || []).some((item) => String(item && item.code ? item.code : "").startsWith("overtime_"));
}

async function run() {
  const uid = "e2e-parent-taska-zurah";
  const phone = "+601112223334";
  const currentPeriod = monthKey(new Date());

  // Case 1: registration month invoice uses Taska Zurah registration items and syncs child metadata.
  const parentRegistration = "e2e-taska-zurah-parent-reg";
  const childRegistration = "e2e-taska-zurah-child-reg";
  await createParent({ parentId: parentRegistration, phoneE164: phone });
  await clearInvoicesByPeriod(parentRegistration, currentPeriod);
  await createChild({
    childId: childRegistration,
    name: "E2E Taska Zurah Registration Child",
    birthDate: "2025-02-10",
    registeredAt: timestampFromDate(new Date()),
  });

  const registrationRes = await fns.billingCreateDemoInvoiceForCurrentMonth.run(reqForParent({
    uid,
    phone,
    data: { parentId: parentRegistration, childId: childRegistration },
  }));
  assertTrue(registrationRes && registrationRes.ok, "Case1: registration invoice creation failed");

  const registrationInvoice = await fetchInvoiceByPeriod({ parentId: parentRegistration, period: currentPeriod });
  assertTrue(registrationInvoice, "Case1: registration invoice missing");
  const registrationItems = Array.isArray(registrationInvoice.data.items) ? registrationInvoice.data.items : [];
  assertTrue(hasCode(registrationItems, "registration_fee"), "Case1: registration fee item missing");
  assertTrue(hasCode(registrationItems, "insurance_takaful"), "Case1: insurance/takaful item missing");
  assertTrue(hasCode(registrationItems, "yearly_maintenance_fee"), "Case1: yearly maintenance item missing");
  assertTrue(hasCode(registrationItems, "monthly_fee"), "Case1: monthly fee item missing");
  assertTrue(Number(registrationInvoice.data.totalSen || 0) === 126500, "Case1: expected RM1265.00 registration total for baby-to-2 band");
  const registrationDueDate = registrationInvoice.data.dueDate && registrationInvoice.data.dueDate.toDate ? registrationInvoice.data.dueDate.toDate() : null;
  assertTrue(registrationDueDate && registrationDueDate.getDate() === 7, "Case1: due day should be fixed at 7");

  const syncedChild = await db.collection("children").doc(childRegistration).get();
  const syncedChildData = syncedChild.data() || {};
  assertTrue(String(syncedChildData.activeBillingModel || "") === "TASKA_ZURAH_AGE_BASED", "Case1: child activeBillingModel not synced");
  assertTrue(String(syncedChildData.feePolicyVersion || "") === "TASKA_ZURAH_2026", "Case1: child feePolicyVersion not synced");
  assertTrue(String(syncedChildData.ageBand || "") === "BABY_TO_2", "Case1: child ageBand not synced");
  assertTrue(Number(syncedChildData.monthlyFeeSen || 0) === 75000, "Case1: child monthlyFeeSen not synced");
  assertTrue(Number(syncedChildData.invoiceDueDay || 0) === 7, "Case1: child invoiceDueDay not synced");
  console.log("PASS Case1 registration invoice matches Taska Zurah policy and syncs child billing fields");

  // Case 2: family invoice aggregates child summaries and syncs per-child monthly metadata.
  const parentFamily = "e2e-taska-zurah-parent-family";
  const childFamilyA = "e2e-taska-zurah-child-family-a";
  const childFamilyB = "e2e-taska-zurah-child-family-b";
  const registeredEarlier = new Date();
  registeredEarlier.setMonth(registeredEarlier.getMonth() - 2);
  await createParent({
    parentId: parentFamily,
    phoneE164: phone,
    childIds: [childFamilyA, childFamilyB],
    childNames: ["E2E Family A", "E2E Family B"],
  });
  await clearInvoicesByPeriod(parentFamily, currentPeriod);
  await createChild({
    childId: childFamilyA,
    name: "E2E Family A",
    birthDate: "2025-01-10",
    registeredAt: timestampFromDate(registeredEarlier),
    registrationFeeAppliedPeriod: monthKey(registeredEarlier),
  });
  await createChild({
    childId: childFamilyB,
    name: "E2E Family B",
    birthDate: "2023-06-10",
    registeredAt: timestampFromDate(registeredEarlier),
    registrationFeeAppliedPeriod: monthKey(registeredEarlier),
  });
  await updateParent(parentFamily, {
    childIds: [childFamilyA, childFamilyB],
    childNames: ["E2E Family A", "E2E Family B"],
  });

  const familyRes = await fns.billingCreateDemoInvoiceForCurrentMonth.run(reqForParent({
    uid,
    phone,
    data: { parentId: parentFamily },
  }));
  assertTrue(familyRes && familyRes.ok, "Case2: family invoice creation failed");

  const familyInvoice = await fetchInvoiceByPeriod({ parentId: parentFamily, period: currentPeriod });
  assertTrue(familyInvoice, "Case2: family invoice missing");
  assertTrue(Array.isArray(familyInvoice.data.childIds) && familyInvoice.data.childIds.length === 2, "Case2: family childIds missing");
  assertTrue(familyInvoice.data.billingMeta && familyInvoice.data.billingMeta.invoiceScope === "family", "Case2: family invoice scope missing");
  assertTrue(Array.isArray(familyInvoice.data.billingMeta.children) && familyInvoice.data.billingMeta.children.length === 2, "Case2: family child billing summaries missing");
  const familyItems = Array.isArray(familyInvoice.data.items) ? familyInvoice.data.items : [];
  assertTrue(familyItems.some((item) => String(item.description || "").includes("E2E Family A")), "Case2: first child label missing");
  assertTrue(familyItems.some((item) => String(item.description || "").includes("E2E Family B")), "Case2: second child label missing");
  const familyDueDate = familyInvoice.data.dueDate && familyInvoice.data.dueDate.toDate ? familyInvoice.data.dueDate.toDate() : null;
  assertTrue(familyDueDate && familyDueDate.getDate() === 7, "Case2: family invoice due day should stay fixed at 7");

  const childFamilyASnap = await db.collection("children").doc(childFamilyA).get();
  const childFamilyBSnap = await db.collection("children").doc(childFamilyB).get();
  assertTrue(Number((childFamilyASnap.data() || {}).monthlyFeeSen || 0) === 75000, "Case2: first child monthly fee sync mismatch");
  assertTrue(Number((childFamilyBSnap.data() || {}).monthlyFeeSen || 0) === 70000, "Case2: second child monthly fee sync mismatch");
  console.log("PASS Case2 family invoice keeps Taska Zurah child summaries and syncs per-child fees");

  // Case 3: overtime is billed as a separate line item from the closed 21-to-20 cycle.
  const parentOvertime = "e2e-taska-zurah-parent-overtime";
  const childOvertime = "e2e-taska-zurah-child-overtime";
  const previousPeriodDate = new Date();
  previousPeriodDate.setMonth(previousPeriodDate.getMonth() - 1, 1);
  const previousPeriod = monthKey(previousPeriodDate);
  const registeredBeforeCycle = new Date(previousPeriodDate.getFullYear(), previousPeriodDate.getMonth() - 2, 1, 9, 0, 0);
  await createParent({ parentId: parentOvertime, phoneE164: phone });
  await clearInvoicesByPeriod(parentOvertime, currentPeriod);
  await createChild({
    childId: childOvertime,
    name: "E2E Overtime Child",
    birthDate: "2023-01-15",
    registeredAt: timestampFromDate(registeredBeforeCycle),
    registrationFeeAppliedPeriod: monthKey(registeredBeforeCycle),
  });
  await seedAttendanceRows(childOvertime, [
    { day: 10, checkInHour: 8, checkOutHour: 21 },
    { day: 11, checkInHour: 8, checkOutHour: 20 },
  ], { baseDate: previousPeriodDate });

  const overtimeRes = await fns.billingCreateDemoInvoiceForCurrentMonth.run(reqForParent({
    uid,
    phone,
    data: { parentId: parentOvertime, childId: childOvertime },
  }));
  assertTrue(overtimeRes && overtimeRes.ok, "Case3: overtime invoice creation failed");

  const overtimeInvoice = await fetchInvoiceByPeriod({ parentId: parentOvertime, period: currentPeriod });
  assertTrue(overtimeInvoice, "Case3: overtime invoice missing");
  const overtimeItems = Array.isArray(overtimeInvoice.data.items) ? overtimeInvoice.data.items : [];
  assertTrue(hasCode(overtimeItems, "monthly_fee"), "Case3: monthly fee missing from overtime invoice");
  assertTrue(hasOvertimeCode(overtimeItems), "Case3: overtime line item missing");
  const overtimeChildren = Array.isArray(overtimeInvoice.data.billingMeta && overtimeInvoice.data.billingMeta.children)
    ? overtimeInvoice.data.billingMeta.children
    : [];
  const overtimeMeta = overtimeChildren[0] && overtimeChildren[0].billingMeta ? overtimeChildren[0].billingMeta.overtime : null;
  assertTrue(overtimeMeta && Number(overtimeMeta.totalSen || 0) > 0, "Case3: overtime metadata total missing");
  assertTrue(String(overtimeMeta.sourcePeriod || "") === previousPeriod, "Case3: overtime sourcePeriod should use the prior closed cycle month");
  console.log("PASS Case3 overtime is billed separately from the closed 21-to-20 cycle");

  // Case 4: billing catalog and health endpoints reflect the Taska Zurah policy surface.
  const catalog = await fns.billingGetFeeCatalog.run(reqForParent({ uid, phone, data: {} }));
  assertTrue(catalog && catalog.ok, "Case4: billingGetFeeCatalog failed");
  assertTrue(Array.isArray(catalog.policy && catalog.policy.dueDayOptions), "Case4: dueDayOptions missing");
  assertTrue(catalog.policy.dueDayOptions.length === 1 && catalog.policy.dueDayOptions[0] === 7, "Case4: dueDayOptions should only contain 7");
  assertTrue(String(catalog.policy && catalog.policy.activeBillingModel || "") === "TASKA_ZURAH_AGE_BASED", "Case4: activeBillingModel missing");
  assertTrue(Array.isArray(catalog.policy && catalog.policy.notes) && catalog.policy.notes.some((note) => String(note).includes("Taska Zurah age-based")), "Case4: Taska Zurah policy note missing");

  const health = await fns.billingGetHealth.run(reqForParent({ uid, phone, data: {} }));
  assertTrue(health && health.ok, "Case4: billingGetHealth failed");
  assertTrue(health.health && health.health.isValid === true, "Case4: expected valid billing catalog health");
  assertTrue(Array.isArray(health.health.missingRequiredCodes) && health.health.missingRequiredCodes.length === 0, "Case4: missingRequiredCodes should be empty");
  console.log("PASS Case4 catalog endpoints expose the Taska Zurah billing policy");

  // Case 5: admin backfill patches legacy child billing metadata and skips migrated child documents.
  const legacyChild = "e2e-taska-zurah-child-legacy-backfill";
  const migratedChild = "e2e-taska-zurah-child-legacy-migrated";
  const legacyRegisteredAt = new Date();
  legacyRegisteredAt.setMonth(legacyRegisteredAt.getMonth() - 3, 12);
  await createChild({
    childId: legacyChild,
    name: "E2E Legacy Child",
    birthDate: "2022-09-10",
    registeredAt: timestampFromDate(legacyRegisteredAt),
    registrationFeeAppliedPeriod: monthKey(legacyRegisteredAt),
  });
  await createChild({
    childId: migratedChild,
    name: "E2E Migrated Child",
    birthDate: "2021-01-10",
    registeredAt: timestampFromDate(legacyRegisteredAt),
    registrationFeeAppliedPeriod: monthKey(legacyRegisteredAt),
  });
  await db.collection("children").doc(migratedChild).set({ migratedToChildId: legacyChild }, { merge: true });

  const backfill = await fns.billingAdminBackfillChildMetadata.run(reqForAdmin({
    uid: "e2e-admin-taska-zurah",
    data: {
      childIds: [legacyChild, migratedChild],
      period: currentPeriod,
    },
  }));
  assertTrue(backfill && backfill.ok, "Case5: child billing metadata backfill failed");
  assertTrue(Number(backfill.scannedCount || 0) === 2, "Case5: expected two scanned child documents");
  assertTrue(Number(backfill.patchedCount || 0) === 1, "Case5: expected exactly one child metadata patch");
  assertTrue(Number(backfill.skippedMigratedCount || 0) === 1, "Case5: migrated child should be skipped");
  assertTrue(Number(backfill.failedCount || 0) === 0, "Case5: backfill should not fail for targeted children");

  const legacyChildSnap = await db.collection("children").doc(legacyChild).get();
  const legacyChildData = legacyChildSnap.data() || {};
  assertTrue(String(legacyChildData.activeBillingModel || "") === "TASKA_ZURAH_AGE_BASED", "Case5: activeBillingModel not backfilled");
  assertTrue(String(legacyChildData.feePolicyVersion || "") === "TASKA_ZURAH_2026", "Case5: feePolicyVersion not backfilled");
  assertTrue(String(legacyChildData.ageBand || "") === "AGE_2_TO_3", "Case5: ageBand not backfilled");
  assertTrue(Number(legacyChildData.monthlyFeeSen || 0) === 70000, "Case5: monthlyFeeSen not backfilled");
  assertTrue(Number(legacyChildData.invoiceDueDay || 0) === 7, "Case5: invoiceDueDay not backfilled");
  assertTrue(Number(legacyChildData.billingDueDay || 0) === 7, "Case5: billingDueDay should be normalized to 7");
  assertTrue(String(legacyChildData.careType || "") === "fulltime", "Case5: careType should be normalized to fulltime");
  assertTrue(String(legacyChildData.feePlan || "") === "monthly", "Case5: feePlan should be normalized to monthly");
  assertTrue(Boolean(legacyChildData.transportFromTadika) === false, "Case5: transportFromTadika should stay false");

  const migratedChildSnap = await db.collection("children").doc(migratedChild).get();
  const migratedChildData = migratedChildSnap.data() || {};
  assertTrue(String(migratedChildData.activeBillingModel || "") === "", "Case5: migrated child should not be backfilled");

  const billingAuditSnap = await db.collection("billingAudit").get();
  assertTrue(
    billingAuditSnap.docs.some((doc) => String((doc.data() || {}).action || "") === "child_billing_metadata_backfilled"),
    "Case5: billing audit entry missing for child metadata backfill"
  );
  console.log("PASS Case5 admin backfill patches legacy child metadata and skips migrated child documents");

  // Case 6: admin backfill paging returns a resume cursor and completes on the next batch.
  const pagedChildA = "zz-e2e-taska-zurah-child-page-a";
  const pagedChildB = "zz-e2e-taska-zurah-child-page-b";
  const pagedChildC = "zz-e2e-taska-zurah-child-page-c";
  const pagedRegisteredAt = new Date();
  pagedRegisteredAt.setMonth(pagedRegisteredAt.getMonth() - 4, 10);
  await createChild({
    childId: pagedChildA,
    name: "E2E Paged Child A",
    birthDate: "2022-01-10",
    registeredAt: timestampFromDate(pagedRegisteredAt),
    registrationFeeAppliedPeriod: monthKey(pagedRegisteredAt),
  });
  await createChild({
    childId: pagedChildB,
    name: "E2E Paged Child B",
    birthDate: "2023-01-10",
    registeredAt: timestampFromDate(pagedRegisteredAt),
    registrationFeeAppliedPeriod: monthKey(pagedRegisteredAt),
  });
  await createChild({
    childId: pagedChildC,
    name: "E2E Paged Child C",
    birthDate: "2024-01-10",
    registeredAt: timestampFromDate(pagedRegisteredAt),
    registrationFeeAppliedPeriod: monthKey(pagedRegisteredAt),
  });

  const firstPage = await fns.billingAdminBackfillChildMetadata.run(reqForAdmin({
    uid: "e2e-admin-taska-zurah",
    data: {
      period: currentPeriod,
      limit: 2,
      startAfterId: "zz-e2e-taska-zurah-child-page-",
    },
  }));
  assertTrue(firstPage && firstPage.ok, "Case6: first paged child metadata backfill failed");
  assertTrue(Number(firstPage.scannedCount || 0) === 2, "Case6: first page should scan two children");
  assertTrue(Number(firstPage.patchedCount || 0) === 2, "Case6: first page should patch two children");
  assertTrue(Boolean(firstPage.hasMore) === true, "Case6: first page should report more children remaining");
  assertTrue(String(firstPage.nextStartAfterId || "") === pagedChildB, "Case6: first page cursor should advance to the second child");

  const secondPage = await fns.billingAdminBackfillChildMetadata.run(reqForAdmin({
    uid: "e2e-admin-taska-zurah",
    data: {
      period: currentPeriod,
      limit: 2,
      startAfterId: String(firstPage.nextStartAfterId || ""),
    },
  }));
  assertTrue(secondPage && secondPage.ok, "Case6: second paged child metadata backfill failed");
  assertTrue(Number(secondPage.scannedCount || 0) === 1, "Case6: second page should scan the remaining child");
  assertTrue(Number(secondPage.patchedCount || 0) === 1, "Case6: second page should patch the remaining child");
  assertTrue(Boolean(secondPage.hasMore) === false, "Case6: second page should finish the paged scan");
  assertTrue(String(secondPage.nextStartAfterId || "") === "", "Case6: second page should not return a follow-up cursor");
  console.log("PASS Case6 admin backfill paging returns a resume cursor and completes on the next batch");

  console.log("\nTaska Zurah billing integration checks passed.");
}

run().catch((err) => {
  console.error("Taska Zurah billing integration check failed:", err && err.message ? err.message : err);
  process.exit(1);
});