/**
 * 🌿 Taska Zurah – Firebase Cloud Function for Chat Notifications
 *
 * ✅ Triggered when a new message is created in Firestore:
 *    Path: /chats/{chatId}/messages/{messageId}
 *
 * ✅ Detects sender (teacher / parent)
 * ✅ Finds receiver’s FCM token (stored in teachers / parents collections)
 * ✅ Sends a push notification via FCM
 */

const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const crypto = require("crypto");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

const BILLPLZ_API_KEY_SECRET = defineSecret("BILLPLZ_API_KEY");
const BILLPLZ_X_SIGNATURE_KEY_SECRET = defineSecret("BILLPLZ_X_SIGNATURE_KEY");

// 🔧 Initialize Firebase Admin SDK
admin.initializeApp();

function digitsOnly(input) {
  return String(input || "").replace(/[^0-9]/g, "");
}

// MY "tail" normalization:
// +601112345678 -> 1112345678
// 01112345678   -> 1112345678
function myTail(phoneAny) {
  let d = digitsOnly(phoneAny);
  if (!d) return "";
  if (d.startsWith("60") && d.length > 2) d = d.slice(2);
  if (d.startsWith("0") && d.length > 1) d = d.slice(1);
  return d;
}

function uniqueSortedIds(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )).sort();
}

function invoiceChildIds(invoice) {
  const ids = [];
  if (invoice && Array.isArray(invoice.childIds)) ids.push(...invoice.childIds);
  if (invoice && invoice.childId) ids.push(invoice.childId);
  return uniqueSortedIds(ids);
}

function childCoverageKey(period, childIds) {
  const normalizedPeriod = String(period || "").trim();
  const normalizedChildIds = uniqueSortedIds(childIds);
  if (!normalizedPeriod || !normalizedChildIds.length) return "";
  return `${normalizedPeriod}::${normalizedChildIds.join("|")}`;
}

function invoiceChildCoverageKey(invoice) {
  const existing = String(invoice && invoice.childCoverageKey ? invoice.childCoverageKey : "").trim();
  if (existing) return existing;
  return childCoverageKey(invoice && invoice.period, invoiceChildIds(invoice));
}

function timestampMillis(raw) {
  if (!raw) return "";
  if (typeof raw.toMillis === "function") return String(raw.toMillis());
  if (typeof raw.seconds === "number") {
    return String((raw.seconds * 1000) + Math.floor(Number(raw.nanoseconds || 0) / 1000000));
  }
  const parsed = Date.parse(String(raw));
  return Number.isNaN(parsed) ? "" : String(parsed);
}

function invoicePaymentFingerprint(invoice) {
  return JSON.stringify({
    status: String(invoice && invoice.status ? invoice.status : "").toLowerCase(),
    paidReceiptNo: String(invoice && invoice.paidReceiptNo ? invoice.paidReceiptNo : ""),
    paidPaymentId: String(invoice && invoice.paidPaymentId ? invoice.paidPaymentId : ""),
    paidMethod: String(invoice && invoice.paidMethod ? invoice.paidMethod : ""),
    paidBank: String(invoice && invoice.paidBank ? invoice.paidBank : ""),
    paidAmountSen: Number(invoice && invoice.paidAmountSen ? invoice.paidAmountSen : 0),
    paidProvider: String(invoice && invoice.paidProvider ? invoice.paidProvider : ""),
    paidAt: timestampMillis(invoice && invoice.paidAt),
    childCoverageKey: invoiceChildCoverageKey(invoice),
  });
}

function buildPaidInvoiceSyncPatch(sourceInvoice, sourcePath) {
  const patch = {
    status: "paid",
    childCoverageKey: invoiceChildCoverageKey(sourceInvoice),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    sharedPaymentSourcePath: String(sourcePath || ""),
    sharedPaymentSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const mirroredFields = [
    "paidAt",
    "paidMethod",
    "paidBank",
    "paidAmountSen",
    "paidReceiptNo",
    "paidPaymentId",
    "paidProvider",
  ];
  for (const field of mirroredFields) {
    if (sourceInvoice && Object.prototype.hasOwnProperty.call(sourceInvoice, field)) {
      patch[field] = sourceInvoice[field];
    }
  }
  return patch;
}

async function findEquivalentPaidInvoice({ period, childIds, excludePath = "" }) {
  const normalizedPeriod = String(period || "").trim();
  const coverageKey = childCoverageKey(normalizedPeriod, childIds);
  if (!normalizedPeriod || !coverageKey) return null;

  const snap = await admin.firestore().collectionGroup("invoices").where("period", "==", normalizedPeriod).get();
  for (const doc of snap.docs) {
    if (excludePath && doc.ref.path === excludePath) continue;
    const data = doc.data() || {};
    if (String(data.status || "").toLowerCase() !== "paid") continue;
    if (invoiceChildCoverageKey(data) !== coverageKey) continue;
    return { ref: doc.ref, data };
  }
  return null;
}

async function repairInvoiceFromEquivalentPaidCopy({ invoiceRef, invoiceData }) {
  const match = await findEquivalentPaidInvoice({
    period: invoiceData && invoiceData.period,
    childIds: invoiceChildIds(invoiceData),
    excludePath: invoiceRef.path,
  });
  if (!match) {
    return { repaired: false, invoiceData };
  }

  if (invoicePaymentFingerprint(invoiceData) === invoicePaymentFingerprint(match.data)) {
    return {
      repaired: false,
      invoiceData: {
        ...invoiceData,
        childCoverageKey: invoiceChildCoverageKey(match.data),
      },
    };
  }

  await invoiceRef.set(buildPaidInvoiceSyncPatch(match.data, match.ref.path), { merge: true });
  return {
    repaired: true,
    invoiceData: {
      ...invoiceData,
      ...match.data,
      status: "paid",
      childCoverageKey: invoiceChildCoverageKey(match.data),
    },
  };
}

async function syncEquivalentPaidInvoicesFromSource({ sourceRef, sourceInvoice }) {
  const normalizedPeriod = String(sourceInvoice && sourceInvoice.period ? sourceInvoice.period : "").trim();
  const coverageKey = invoiceChildCoverageKey(sourceInvoice);
  if (!normalizedPeriod || !coverageKey || String(sourceInvoice && sourceInvoice.status ? sourceInvoice.status : "").toLowerCase() !== "paid") {
    return 0;
  }

  const sourceFingerprint = invoicePaymentFingerprint(sourceInvoice);
  const snap = await admin.firestore().collectionGroup("invoices").where("period", "==", normalizedPeriod).get();
  const batch = admin.firestore().batch();
  let updates = 0;

  for (const doc of snap.docs) {
    if (doc.ref.path === sourceRef.path) continue;
    const data = doc.data() || {};
    if (invoiceChildCoverageKey(data) !== coverageKey) continue;
    if (invoicePaymentFingerprint(data) === sourceFingerprint) continue;
    batch.set(doc.ref, buildPaidInvoiceSyncPatch(sourceInvoice, sourceRef.path), { merge: true });
    updates += 1;
  }

  if (updates > 0) {
    await batch.commit();
  }
  return updates;
}

async function findTeacherByPhone(db, phoneE164) {
  const tail = myTail(phoneE164);
  const local = tail ? `0${tail}` : "";

  if (phoneE164) {
    const byE164 = await db.collection("teachers").where("phoneE164", "==", phoneE164).limit(1).get();
    if (!byE164.empty) return { found: true, tail };
  }

  if (tail) {
    const byTail = await db.collection("teachers").where("phoneTail", "==", tail).limit(1).get();
    if (!byTail.empty) return { found: true, tail };
  }

  if (local) {
    const byLocal = await db.collection("teachers").where("phone", "==", local).limit(1).get();
    if (!byLocal.empty) return { found: true, tail };
  }

  return { found: false, tail };
}

// Callable: gate OTP requests BEFORE sending SMS.
// data: { phone: string, kind: 'teacher' | 'parent' }
exports.canRequestOtp = onCall({ region: "asia-southeast1" }, async (req) => {
  const phone = (req.data && req.data.phone) ? String(req.data.phone).trim() : "";
  const kind = (req.data && req.data.kind) ? String(req.data.kind).trim().toLowerCase() : "";
  if (!phone) return { allowed: false, reason: "missing-phone" };
  if (kind !== "teacher" && kind !== "parent") return { allowed: false, reason: "invalid-kind" };

  // Optional hardening: if you enable App Check in the apps, enforce it here.
  // if (!req.app) return { allowed: false, reason: 'app-check-required' };

  const tail = myTail(phone);
  if (!tail) return { allowed: false, reason: "invalid-phone" };
  const local = `0${tail}`;

  const col = kind === "teacher" ? "teachers" : "parents";
  try {
    const db = admin.firestore();

    // Prefer the normalized field, fallback to legacy phone storage.
    let snap = await db.collection(col).where("phoneTail", "==", tail).limit(1).get();
    if (snap.empty) {
      snap = await db.collection(col).where("phone", "==", local).limit(1).get();
    }

    const allowed = !snap.empty;
    logger.info(`canRequestOtp(${kind}) tail=${tail} allowed=${allowed}`);
    return allowed
      ? { allowed: true }
      : { allowed: false, reason: "not-registered" };
  } catch (e) {
    logger.error("canRequestOtp failed", e);
    return { allowed: false, reason: "server-error" };
  }
});

// Callable: after OTP sign-in, auto-assign teacher role if registered.
// Requires: request.auth
exports.claimTeacherRole = onCall({ region: "asia-southeast1" }, async (req) => {
  if (!req.auth) return { ok: false, reason: "unauthenticated" };

  try {
    const uid = req.auth.uid;
    const db = admin.firestore();

    // Prefer phone_number from token; fallback to Auth user record.
    let phoneE164 = (req.auth.token && req.auth.token.phone_number)
      ? String(req.auth.token.phone_number)
      : "";

    if (!phoneE164) {
      const u = await admin.auth().getUser(uid);
      phoneE164 = u.phoneNumber ? String(u.phoneNumber) : "";
    }

    if (!phoneE164) return { ok: false, reason: "missing-phone" };

    const reg = await findTeacherByPhone(db, phoneE164);

    const user = await admin.auth().getUser(uid);
    const existing = user.customClaims || {};
    const role = existing.role;

    // If the user is no longer registered as a teacher, revoke the teacher claim.
    // This prevents deleted teachers from continuing to access protected resources.
    if (!reg.found) {
      if (role === "teacher") {
        const nextClaims = { ...existing };
        delete nextClaims.role;
        await admin.auth().setCustomUserClaims(uid, nextClaims);
        logger.info(`claimTeacherRole: cleared role=teacher (not registered) uid=${uid}`);
        return { ok: false, reason: "not-registered", cleared: true };
      }
      return { ok: false, reason: "not-registered" };
    }

    // Do not overwrite admin.
    if (role === "teacher" || role === "admin") {
      return { ok: true, already: true, role };
    }

    const nextClaims = { ...existing, role: "teacher" };
    await admin.auth().setCustomUserClaims(uid, nextClaims);

    logger.info(`claimTeacherRole: set role=teacher uid=${uid} tail=${reg.tail}`);
    return { ok: true, set: true };
  } catch (e) {
    logger.error("claimTeacherRole failed", e);
    return { ok: false, reason: "server-error" };
  }
});

// 🔔 Trigger when attendance changes (check-in / check-out)
exports.notifyParentOnAttendanceChange = onDocumentWritten(
  "attendance/{recordId}",
  async (event) => {
    try {
      const after = event.data?.after?.data();
      const before = event.data?.before?.data();
      if (!after) return null;
      if (JSON.stringify(after) === JSON.stringify(before)) return null;

      const childName = after.name || "Anak";
      const parentName = after.parentName || "Parent";

      // Firestore timestamp -> Date with MY timezone offset (+08:00) for display
      const checkIn = after.check_in_time
        ? new Date(after.check_in_time.seconds * 1000 + 8 * 60 * 60 * 1000)
        : null;
      const checkOut = after.check_out_time
        ? new Date(after.check_out_time.seconds * 1000 + 8 * 60 * 60 * 1000)
        : null;

      const isPresent = after.isPresent ?? false;

      let title = "Attendance Update";
      let body = "";
      if (checkIn && !checkOut) {
        title = "Anak Telah Check-In";
        body = `${childName} telah hadir ke Taska pada ${checkIn.toLocaleTimeString("ms-MY", { hour12: false })}.`;
      } else if (checkOut) {
        title = "Anak Telah Check-Out";
        body = `${childName} telah pulang pada ${checkOut.toLocaleTimeString("ms-MY", { hour12: false })}.`;
      } else if (!isPresent) {
        title = "Anak Tidak Hadir";
        body = `${childName} tidak hadir hari ini.`;
      }

      const parentQuery = await admin.firestore().collection("parents")
        .where("parentName", "==", parentName)
        .limit(1)
        .get();

      if (parentQuery.empty) {
        logger.info("No parent found for attendance push", { parentName });
        return null;
      }

      const parentDoc = parentQuery.docs[0];
      const fcmToken = parentDoc.data().fcm_token;
      if (!fcmToken) {
        logger.info("Parent has no fcm_token", { parentName, parentId: parentDoc.id });
        return null;
      }

      const message = {
        token: fcmToken,
        notification: { title, body },
        data: {
          click_action: "FLUTTER_NOTIFICATION_CLICK",
          route: "/attendance_dashboard",
          childName,
          parentName,
        },
      };

      await admin.messaging().send(message);
      logger.info("Attendance notification sent", { parentName, title });
      return null;
    } catch (error) {
      logger.error("notifyParentOnAttendanceChange failed", error);
      return null;
    }
  },
);

exports.attendanceNfcCheckIn = onCall({ region: "asia-southeast1" }, async (req) => {
  try {
    requireStaff(req);

    const childId = String(req.data && req.data.childId ? req.data.childId : "").trim();
    const nfcUid = String(req.data && req.data.nfcUid ? req.data.nfcUid : "").trim().toUpperCase();
    const actor = attendanceActor(req, req.data && (req.data.actorName || req.data.teacherName || req.data.adminName));

    if (!childId) {
      throw callableError("missing-child-id", "invalid-argument");
    }

    const db = admin.firestore();
    const childRef = db.collection("children").doc(childId);
    const childSnap = await childRef.get();
    if (!childSnap.exists) {
      throw callableError("child-not-found", "not-found");
    }

    const childData = childSnap.data() || {};
    const childName = attendanceChildName(childData) || childId;
    const parentName = attendanceParentName(childData, null);
    const dayInfo = attendanceDayInfo();
    const attendanceId = `${dayInfo.key}_${childId}`;
    const attendanceRef = db.collection("attendance").doc(attendanceId);
    const auditRef = db.collection("attendanceAudit").doc();

    await db.runTransaction(async (tx) => {
      const attendanceSnap = await tx.get(attendanceRef);
      const existing = attendanceSnap.exists ? (attendanceSnap.data() || {}) : {};
      const currentStatus = attendanceStatusValue(existing);

      if (currentStatus === "CHECKED_IN") {
        throw callableError("attendance-already-open", "already-exists");
      }
      if (currentStatus === "CHECKED_OUT") {
        throw callableError("attendance-already-closed", "already-exists");
      }

      tx.set(attendanceRef, {
        attendanceId,
        childId,
        childRef,
        name: childName,
        parentName,
        nfc_uid: nfcUid || String(existing.nfc_uid || "").trim(),
        date: admin.firestore.Timestamp.fromDate(dayInfo.startOfDayUtc),
        dateKey: dayInfo.key,
        status: "CHECKED_IN",
        checkInAt: admin.firestore.FieldValue.serverTimestamp(),
        checkInMethod: "NFC",
        checkedInBy: {
          uid: actor.uid,
          role: actor.role,
          displayName: actor.displayName,
          email: actor.email,
          phoneE164: actor.phoneE164,
        },
        checkedInByUid: actor.uid,
        checkedInByRole: actor.role,
        checkedInByName: actor.displayName,
        createdAt: attendanceSnap.exists ? (existing.createdAt || admin.firestore.FieldValue.serverTimestamp()) : admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastEditedBy: actor.uid,
        manualEditReason: existing.manualEditReason || "",
        notes: existing.notes || "",
        auditMetadata: {
          lastAction: "CHECK_IN",
          lastMethod: "NFC",
          lastActorUid: actor.uid,
          lastActorRole: actor.role,
          lastActorName: actor.displayName,
        },

        check_in_time: admin.firestore.FieldValue.serverTimestamp(),
        isPresent: true,
        is_present: true,
        checkin_method: "NFC",
        manual_in: false,
        manual_out: false,
        manualCheckout: false,
        checkout_approval: false,
        reason: String(existing.reason || "Default"),
        teacher: actor.displayName || String(existing.teacher || ""),
      }, { merge: true });

      tx.set(auditRef, attendanceAuditEntry({
        action: "CHECK_IN",
        attendanceId,
        childId,
        actor,
        method: "NFC",
        details: {
          childName,
          dateKey: dayInfo.key,
          nfcUid,
        },
      }));
    });

    return {
      ok: true,
      attendanceId,
      childId,
      childName,
      dateKey: dayInfo.key,
      status: "CHECKED_IN",
    };
  } catch (err) {
    logger.error("attendanceNfcCheckIn failed", err);
    return { ok: false, reason: callableErrorReason(err) };
  }
});

exports.attendanceCheckoutWithParentQr = onCall({ region: "asia-southeast1" }, async (req) => {
  try {
    requireStaff(req);

    const rawToken = String(req.data && (req.data.qrToken || req.data.token) ? (req.data.qrToken || req.data.token) : "").trim();
    const tokenValue = rawToken.replace(/^QR_/, "").trim();
    const expectedChildId = String(req.data && req.data.expectedChildId ? req.data.expectedChildId : "").trim();
    const actor = attendanceActor(req, req.data && (req.data.actorName || req.data.teacherName || req.data.adminName));

    if (!tokenValue) {
      throw callableError("missing-qr-token", "invalid-argument");
    }

    const db = admin.firestore();
    const parentQuery = await db.collection("parents")
      .where("dailyQrToken", "==", tokenValue)
      .limit(1)
      .get();

    if (parentQuery.empty) {
      throw callableError("pickup-token-not-found", "not-found");
    }

    const parentSnap = parentQuery.docs[0];
    const parentData = parentSnap.data() || {};
    const parentRef = parentSnap.ref;
    const tokenRef = parentRef.collection("tokens").doc(tokenValue);
    const auditRef = db.collection("attendanceAudit").doc();
    const dayInfo = attendanceDayInfo();

    const result = await db.runTransaction(async (tx) => {
      const tokenSnap = await tx.get(tokenRef);
      if (!tokenSnap.exists) {
        throw callableError("pickup-token-not-found", "not-found");
      }

      const tokenData = tokenSnap.data() || {};
      const childId = String(tokenData.childId || parentData.childId || "").trim();
      if (!childId) {
        throw callableError("pickup-token-missing-child", "failed-precondition");
      }
      if (expectedChildId && expectedChildId !== childId) {
        throw callableError("pickup-token-child-mismatch", "permission-denied");
      }

      if (tokenData.used === true) {
        throw callableError("pickup-token-already-used", "already-exists");
      }

      const expiredAt = attendanceTimestampToDate(tokenData.expiredAt);
      if (expiredAt && expiredAt.getTime() < Date.now()) {
        throw callableError("pickup-token-expired", "deadline-exceeded");
      }

      const resolvedAttendance = await attendanceResolveParentQrCheckoutTarget({
        tx,
        db,
        dayInfo,
        tokenData,
        parentData,
        fallbackChildId: childId,
      });
      if (!resolvedAttendance.attendanceSnap || !resolvedAttendance.attendanceSnap.exists) {
        throw callableError("attendance-not-found", "not-found");
      }

      const attendanceRef = resolvedAttendance.attendanceRef;
      const attendanceSnap = resolvedAttendance.attendanceSnap;
      const attendanceData = attendanceSnap.data() || {};
      const resolvedChildSnap = resolvedAttendance.childSnap;
      const resolvedChildData = resolvedChildSnap && resolvedChildSnap.exists ? (resolvedChildSnap.data() || {}) : {};
      const resolvedChildId = String(
        attendanceData.childId
          || resolvedAttendance.resolvedChildId
          || childId,
      ).trim() || childId;
      const attendanceId = attendanceRef.id;

      if (!attendanceHasCheckIn(attendanceData)) {
        throw callableError("attendance-not-checked-in", "failed-precondition");
      }
      if (attendanceHasCheckOut(attendanceData)) {
        throw callableError("attendance-already-closed", "already-exists");
      }

      const childName = String(
        tokenData.childName
          || attendanceData.name
          || attendanceData.childName
          || resolvedChildData.name
          || resolvedChildId,
      ).trim() || resolvedChildId;
      const parentName = String(parentData.parentName || attendanceData.parentName || "-").trim() || "-";
      const representativeName = String(
        tokenData.representativeName || parentData.representativeName || parentName,
      ).trim() || parentName;
      const representativeRole = String(tokenData.representativeRole || parentData.representativeRole || "").trim();
      const parentPhone = String(parentData.phoneE164 || parentData.phone || "").trim();

      const attendancePatch = {
        attendanceId,
        childId: resolvedChildId,
        name: childName,
        parentName,
        date: attendanceData.date || admin.firestore.Timestamp.fromDate(dayInfo.startOfDayUtc),
        dateKey: attendanceData.dateKey || dayInfo.key,
        status: "CHECKED_OUT",
        checkOutAt: admin.firestore.FieldValue.serverTimestamp(),
        checkOutMethod: "PARENT_QR",
        checkedOutBy: {
          uid: actor.uid,
          role: actor.role,
          displayName: actor.displayName,
          email: actor.email,
          phoneE164: actor.phoneE164,
        },
        checkedOutByUid: actor.uid,
        checkedOutByRole: actor.role,
        checkedOutByName: actor.displayName,
        pickupGuardianId: parentRef.id,
        pickupGuardianNameSnapshot: representativeName,
        pickupGuardianRoleSnapshot: representativeRole,
        pickupVerifiedByTeacherId: actor.uid,
        pickupVerifiedByTeacherName: actor.displayName,
        pickupVerificationMethod: "PARENT_QR_TOKEN",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastEditedBy: actor.uid,
        auditMetadata: {
          lastAction: "CHECK_OUT",
          lastMethod: "PARENT_QR",
          lastActorUid: actor.uid,
          lastActorRole: actor.role,
          lastActorName: actor.displayName,
        },

        check_out_time: admin.firestore.FieldValue.serverTimestamp(),
        checkout_method: "PARENT_QR",
        checkout_approval: true,
        isPresent: true,
        is_present: true,
        teacher: actor.displayName || String(attendanceData.teacher || ""),
      };
      if (resolvedAttendance.childRef) {
        attendancePatch.childRef = resolvedAttendance.childRef;
      }

      tx.set(attendanceRef, attendancePatch, { merge: true });

      tx.set(tokenRef, {
        used: true,
        usedAt: admin.firestore.FieldValue.serverTimestamp(),
        usedByUid: actor.uid,
        usedByRole: actor.role,
        usedByName: actor.displayName,
      }, { merge: true });

      tx.set(auditRef, attendanceAuditEntry({
        action: "CHECK_OUT",
        attendanceId,
        childId: resolvedChildId,
        actor,
        method: "PARENT_QR",
        details: {
          childName,
          parentId: parentRef.id,
          parentName,
          parentPhone,
          representativeName,
          representativeRole,
          tokenValue,
        },
      }));

      return {
        attendanceId,
        childId: resolvedChildId,
        childName,
        parentName,
        parentPhone,
        representativeName,
        representativeRole,
        status: "CHECKED_OUT",
        previousStatus: attendanceStatusValue(attendanceData),
        matchScore: resolvedAttendance.matchScore,
      };
    });

    logger.info("attendanceCheckoutWithParentQr success", {
      tokenValue,
      parentId: parentRef.id,
      attendanceId: result.attendanceId,
      childId: result.childId,
      previousStatus: result.previousStatus,
      matchScore: result.matchScore,
      actorUid: actor.uid,
      actorRole: actor.role,
    });

    return {
      ok: true,
      attendanceId: result.attendanceId,
      childId: result.childId,
      childName: result.childName,
      parentName: result.parentName,
      parentPhone: result.parentPhone,
      representativeName: result.representativeName,
      representativeRole: result.representativeRole,
      status: result.status,
    };
  } catch (err) {
    logger.error("attendanceCheckoutWithParentQr failed", err);
    return { ok: false, reason: callableErrorReason(err) };
  }
});

exports.attendanceParentPickupEligibility = onCall({ region: "asia-southeast1" }, async (req) => {
  try {
    requireAuth(req);

    const parentId = String(req.data && req.data.parentId ? req.data.parentId : "").trim();
    const desiredChildId = String(req.data && req.data.childId ? req.data.childId : "").trim();
    const desiredChildRef = String(req.data && req.data.childRef ? req.data.childRef : "").trim();

    if (!parentId || (!desiredChildId && !desiredChildRef)) {
      return { ok: false, reason: "missing-args", message: "Unable to verify pickup eligibility right now." };
    }

    const { parentData } = await assertParentOwnerByPhone({ parentId, authToken: req.auth.token });
    const requestedChildDocId = attendanceChildDocIdFromRef(desiredChildRef) || desiredChildId;
    const linkedChildDocIds = attendanceParentLinkedChildDocIds(parentData);

    if (requestedChildDocId && linkedChildDocIds.length && !linkedChildDocIds.includes(requestedChildDocId)) {
      throw callableError("child-not-linked", "permission-denied");
    }

    const db = admin.firestore();
    const dayInfo = attendanceDayInfo();
    const resolvedAttendance = await attendanceResolvePickupEligibilityTarget({
      db,
      dayInfo,
      desiredChildId,
      desiredChildRef,
    });

    if (!resolvedAttendance.attendanceSnap || !resolvedAttendance.attendanceSnap.exists) {
      return {
        ok: true,
        allowed: false,
        reason: "attendance-not-found",
        message: "Pickup QR will be available after your child checks in today.",
      };
    }

    const attendanceData = resolvedAttendance.attendanceSnap.data() || {};
    if (!attendanceHasCheckIn(attendanceData)) {
      return {
        ok: true,
        allowed: false,
        reason: "attendance-not-checked-in",
        message: "Pickup QR will be available after your child checks in today.",
      };
    }

    if (attendanceHasCheckOut(attendanceData)) {
      return {
        ok: true,
        allowed: false,
        reason: "attendance-already-closed",
        message: "Pickup QR is no longer available because your child has already checked out today.",
      };
    }

    return {
      ok: true,
      allowed: true,
      reason: "eligible",
      message: "",
      attendanceId: resolvedAttendance.attendanceSnap.id,
      resolvedChildId: resolvedAttendance.resolvedChildId,
      matchScore: resolvedAttendance.matchScore,
    };
  } catch (err) {
    logger.error("attendanceParentPickupEligibility failed", err);
    return {
      ok: false,
      reason: callableErrorReason(err),
      message: "Unable to verify pickup eligibility right now.",
    };
  }
});

exports.attendanceAdminOverride = onCall({ region: "asia-southeast1" }, async (req) => {
  try {
    requireAdmin(req);

    const action = String(req.data && req.data.action ? req.data.action : "").trim().toUpperCase();
    const childId = String(req.data && req.data.childId ? req.data.childId : "").trim();
    const attendanceDate = String(req.data && req.data.attendanceDate ? req.data.attendanceDate : "").trim();
    const reason = String(req.data && req.data.reason ? req.data.reason : "").trim();
    const notes = String(req.data && req.data.notes ? req.data.notes : "").trim();
    const actor = attendanceActor(req, req.data && (req.data.adminName || req.data.actorName));

    if (!childId) throw callableError("missing-child-id", "invalid-argument");
    if (!attendanceDate) throw callableError("missing-attendance-date", "invalid-argument");
    if (!reason) throw callableError("missing-reason", "invalid-argument");

    const allowedActions = new Set([
      "MANUAL_CHECK_IN",
      "MANUAL_CHECK_OUT",
      "MARK_ABSENT",
      "EDIT_RECORD",
      "REOPEN_RECORD",
    ]);
    if (!allowedActions.has(action)) {
      throw callableError("invalid-override-action", "invalid-argument");
    }

    const checkInAt = attendanceTimestampField(req.data && req.data.checkInAt, "check-in-at", action === "MANUAL_CHECK_IN");
    const checkOutAt = attendanceTimestampField(req.data && req.data.checkOutAt, "check-out-at", false);
    const dayInfo = attendanceDayInfoFromDateKey(attendanceDate);
    const attendanceId = `${dayInfo.key}_${childId}`;
    const db = admin.firestore();
    const childRef = db.collection("children").doc(childId);
    const childSnap = await childRef.get();
    if (!childSnap.exists) {
      throw callableError("child-not-found", "not-found");
    }

    const childData = childSnap.data() || {};
    const childName = attendanceChildName(childData) || childId;
    const parentName = attendanceParentName(childData, null);
    const attendanceRef = db.collection("attendance").doc(attendanceId);
    const auditRef = db.collection("attendanceAudit").doc();

    const result = await db.runTransaction(async (tx) => {
      const attendanceSnap = await tx.get(attendanceRef);
      const existing = attendanceSnap.exists ? (attendanceSnap.data() || {}) : {};
      const existingCheckIn = attendanceHasCheckIn(existing) ? (existing.checkInAt || existing.check_in_time || null) : null;
      const existingCheckOut = attendanceHasCheckOut(existing) ? (existing.checkOutAt || existing.check_out_time || null) : null;
      const hadCompletedRecord = Boolean(existingCheckOut);

      let nextCheckIn = existingCheckIn;
      let nextCheckOut = existingCheckOut;
      let nextStatus = attendanceStatusValue(existing);
      let nextCheckInMethod = existing.checkInMethod || existing.checkin_method || null;
      let nextCheckOutMethod = existing.checkOutMethod || existing.checkout_method || null;

      if (action === "MANUAL_CHECK_IN") {
        if (existingCheckIn) {
          throw callableError("attendance-already-open", "already-exists");
        }
        nextCheckIn = admin.firestore.Timestamp.fromDate(checkInAt);
        nextCheckOut = null;
        nextStatus = "CHECKED_IN";
        nextCheckInMethod = "MANUAL";
        nextCheckOutMethod = null;
      } else if (action === "MANUAL_CHECK_OUT") {
        if (!existingCheckIn) {
          throw callableError("attendance-not-checked-in", "failed-precondition");
        }
        if (existingCheckOut) {
          throw callableError("attendance-already-closed", "already-exists");
        }
        const resolvedOut = checkOutAt || new Date();
        if (existingCheckIn && resolvedOut.getTime() < existingCheckIn.toDate().getTime()) {
          throw callableError("checkout-before-checkin", "failed-precondition");
        }
        nextCheckOut = admin.firestore.Timestamp.fromDate(resolvedOut);
        nextStatus = "CHECKED_OUT";
        nextCheckOutMethod = "MANUAL";
      } else if (action === "MARK_ABSENT") {
        nextCheckIn = null;
        nextCheckOut = null;
        nextStatus = "NOT_CHECKED_IN";
        nextCheckInMethod = null;
        nextCheckOutMethod = null;
      } else if (action === "REOPEN_RECORD") {
        if (!existingCheckOut) {
          throw callableError("attendance-not-closed", "failed-precondition");
        }
        nextCheckOut = null;
        nextStatus = existingCheckIn ? "CHECKED_IN" : "NOT_CHECKED_IN";
        nextCheckOutMethod = null;
      } else if (action === "EDIT_RECORD") {
        const editedCheckIn = attendanceTimestampField(req.data && req.data.checkInAt, "check-in-at", false);
        const editedCheckOut = attendanceTimestampField(req.data && req.data.checkOutAt, "check-out-at", false);

        if (!editedCheckIn && !editedCheckOut && !notes) {
          throw callableError("missing-edit-fields", "invalid-argument");
        }
        if (editedCheckOut && !editedCheckIn) {
          throw callableError("checkout-without-checkin", "failed-precondition");
        }
        if (editedCheckIn && editedCheckOut && editedCheckOut.getTime() < editedCheckIn.getTime()) {
          throw callableError("checkout-before-checkin", "failed-precondition");
        }

        nextCheckIn = editedCheckIn ? admin.firestore.Timestamp.fromDate(editedCheckIn) : null;
        nextCheckOut = editedCheckOut ? admin.firestore.Timestamp.fromDate(editedCheckOut) : null;
        nextCheckInMethod = editedCheckIn ? "MANUAL" : null;
        nextCheckOutMethod = editedCheckOut ? "MANUAL" : null;
        nextStatus = editedCheckOut ? "CHECKED_OUT" : (editedCheckIn ? "CHECKED_IN" : "NOT_CHECKED_IN");
      }

      tx.set(attendanceRef, {
        attendanceId,
        childId,
        childRef,
        name: childName,
        parentName,
        date: existing.date || admin.firestore.Timestamp.fromDate(dayInfo.startOfDayUtc),
        dateKey: dayInfo.key,
        status: nextStatus,
        checkInAt: nextCheckIn,
        checkOutAt: nextCheckOut,
        checkInMethod: nextCheckIn ? String(nextCheckInMethod || "MANUAL") : null,
        checkOutMethod: nextCheckOut ? String(nextCheckOutMethod || "MANUAL") : null,
        checkedInBy: nextCheckIn ? {
          uid: actor.uid,
          role: actor.role,
          displayName: actor.displayName,
          email: actor.email,
          phoneE164: actor.phoneE164,
        } : null,
        checkedOutBy: nextCheckOut ? {
          uid: actor.uid,
          role: actor.role,
          displayName: actor.displayName,
          email: actor.email,
          phoneE164: actor.phoneE164,
        } : null,
        checkedInByUid: nextCheckIn ? actor.uid : null,
        checkedInByRole: nextCheckIn ? actor.role : null,
        checkedInByName: nextCheckIn ? actor.displayName : null,
        checkedOutByUid: nextCheckOut ? actor.uid : null,
        checkedOutByRole: nextCheckOut ? actor.role : null,
        checkedOutByName: nextCheckOut ? actor.displayName : null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: existing.createdAt || admin.firestore.FieldValue.serverTimestamp(),
        lastEditedBy: actor.uid,
        manualEditReason: reason,
        notes,
        auditMetadata: {
          lastAction: action,
          lastMethod: "MANUAL",
          lastActorUid: actor.uid,
          lastActorRole: actor.role,
          lastActorName: actor.displayName,
        },

        check_in_time: nextCheckIn,
        check_out_time: nextCheckOut,
        isPresent: Boolean(nextCheckIn || nextCheckOut),
        is_present: Boolean(nextCheckIn || nextCheckOut),
        checkin_method: nextCheckIn ? String(nextCheckInMethod || "MANUAL") : "NONE",
        checkout_method: nextCheckOut ? String(nextCheckOutMethod || "MANUAL") : null,
        manual_in: Boolean(nextCheckIn),
        manual_out: Boolean(nextCheckOut),
        manualCheckout: Boolean(nextCheckOut),
        checkout_approval: nextCheckOut ? true : Boolean(existing.checkout_approval || false),
        reason,
        teacher: actor.displayName || String(existing.teacher || ""),
      }, { merge: true });

      tx.set(auditRef, attendanceAuditEntry({
        action,
        attendanceId,
        childId,
        actor,
        method: "MANUAL",
        reason,
        details: {
          childName,
          attendanceDate: dayInfo.key,
          previousStatus: attendanceStatusValue(existing),
          nextStatus,
          previousCheckInAt: existingCheckIn,
          previousCheckOutAt: existingCheckOut,
          nextCheckInAt: nextCheckIn,
          nextCheckOutAt: nextCheckOut,
          notes,
        },
      }));

      return {
        attendanceId,
        status: nextStatus,
        hadCompletedRecord,
      };
    });

    const billingRefresh = await refreshUnpaidInvoiceForAttendanceChange({
      req,
      childId,
      attendanceDate: dayInfo.key,
      action,
      reason,
      notes,
      actor,
    });

    return { ok: true, ...result, billingRefresh };
  } catch (err) {
    logger.error("attendanceAdminOverride failed", err);
    return { ok: false, reason: callableErrorReason(err) };
  }
});

// 🔔 Firestore trigger — runs every time a new message is added
exports.sendChatNotification = onDocumentCreated(
  "chats/{chatId}/messages/{messageId}",
  async (event) => {
    try {
      const messageData = event.data.data();
      const chatId = event.params.chatId;

      if (!messageData) {
        logger.warn("⚠️ No message data found.");
        return null;
      }

      const senderRole = messageData.senderRole || "";
      const senderId = messageData.senderId || "";
      const senderName = messageData.senderName || messageData.sender || senderId || "Unknown";
      const text = messageData.text || "(No text message)";
      logger.info(`🆕 New message in ${chatId} from ${senderName}: ${text}`);

      // 🟢 Fetch parent chat metadata
      const chatRef = admin.firestore().collection("chats").doc(chatId);
      const chatSnap = await chatRef.get();

      if (!chatSnap.exists) {
        logger.error("❌ Chat document not found:", chatId);
        return null;
      }

      const chat = chatSnap.data();
      const parseDocIdFromRef = (ref) => {
        if (!ref || typeof ref !== "string") return "";
        const parts = ref.split("/").filter(Boolean);
        return parts.length ? parts[parts.length - 1] : "";
      };

      let teacherId = chat.teacherId || "";
      let parentId = chat.parentId || "";

      // Backward-compat: derive from stored refs if ids are missing.
      if (!teacherId) teacherId = parseDocIdFromRef(chat.teacherRef);
      if (!parentId) parentId = parseDocIdFromRef(chat.parentRef);

      // Best-effort backfill so subsequent triggers are fast/consistent.
      if (teacherId && parentId && (!chat.teacherId || !chat.parentId)) {
        chatRef.set({ teacherId, parentId }, { merge: true }).catch(() => {});
      }

      if (!teacherId || !parentId) {
        logger.warn("⚠️ Chat metadata missing teacherId/parentId (and could not derive from refs)");
        return null;
      }

      // 🧭 Determine who receives the notification
      let targetCollection = "";
      let targetId = "";

      if (senderRole === "teacher" || senderId === teacherId) {
        // Teacher sent message → notify parent
        targetCollection = "parents";
        targetId = parentId;
      } else if (senderRole === "parent" || senderId === parentId) {
        // Parent sent message → notify teacher
        targetCollection = "teachers";
        targetId = teacherId;
      } else {
        logger.warn("⚠️ Sender does not match chat participants, skipping");
        return null;
      }

      logger.info(`🎯 Receiver: ${targetCollection}/${targetId}`);

      // 🧩 Fetch receiver’s FCM token
      const receiverSnap = await admin.firestore().collection(targetCollection).doc(targetId).get();
      if (!receiverSnap.exists) {
        logger.warn(`⚠️ Receiver ${targetId} not found in ${targetCollection}`);
        return null;
      }

      const receiverData = receiverSnap.data();
      const fcmToken = receiverData.fcmToken;

      if (!fcmToken) {
        logger.warn(`⚠️ No FCM token for ${targetCollection}/${targetId}`);
        return null;
      }

      // 📤 Build notification payload
      const payload = {
        notification: {
          title: `💬 New message from ${senderName}`,
          body: text,
        },
        data: {
          click_action: "FLUTTER_NOTIFICATION_CLICK",
          chatId: chatId,
        },
        token: fcmToken,
      };

      // 🚀 Send notification via FCM
      await admin.messaging().send(payload);
      logger.info(`✅ Notification sent to ${targetId}`);

      return null;
    } catch (error) {
      logger.error("🔥 Error sending notification:", error);
      return null;
    }
  }
);

// ------------------ Billing / Payments (demo path on dummy provider now, real-ready later) ------------------

const BILLING_REQUIRED_CODES = [
  "monthly_fulltime_3m_2y",
  "monthly_fulltime_2y_4y",
  "registration_fulltime_oneoff",
  "registration_transit_oneoff",
  "overtime_after_530",
  "overtime_8pm_12am",
  "overtime_12am_7am",
  "transport_tadika_month",
  "annual_fee_yearly",
  "comms_book_4months",
  "insurance_yearly_age2plus",
];

function callableError(reason, code = "failed-precondition") {
  const err = new Error(String(reason || "unknown-error"));
  err.code = code;
  err.reason = String(reason || "unknown-error");
  return err;
}

function callableErrorReason(err) {
  if (err && err.reason) return String(err.reason);
  if (err && err.message) return String(err.message);
  return "unknown-error";
}

function billingErrorDescriptor(reason, code = "failed-precondition", context = {}) {
  const normalizedReason = String(reason || "unknown-error").trim() || "unknown-error";
  const normalizedCode = String(code || "failed-precondition").trim() || "failed-precondition";
  const health = context && typeof context.health === "object" ? context.health : null;

  if (normalizedReason === "unauthenticated" || normalizedCode === "unauthenticated" || normalizedReason === "http-401") {
    return {
      reason: normalizedReason,
      code: "unauthenticated",
      category: "auth",
      message: "Login expired. Please sign in again.",
    };
  }

  if (normalizedReason === "admin-only" || normalizedReason === "permission-denied" || normalizedReason === "http-403") {
    return {
      reason: normalizedReason,
      code: "permission-denied",
      category: "permission",
      message: "Admin access is required for this action.",
    };
  }

  if (normalizedReason === "missing-version") {
    return {
      reason: normalizedReason,
      code: "invalid-argument",
      category: "validation",
      message: "Version is required before saving the billing catalog.",
    };
  }

  if (normalizedReason === "missing-catalogId") {
    return {
      reason: normalizedReason,
      code: "invalid-argument",
      category: "validation",
      message: "Select a billing catalog before activating it.",
    };
  }

  if (normalizedReason === "catalog-not-found") {
    return {
      reason: normalizedReason,
      code: "not-found",
      category: "not-found",
      message: "The selected billing catalog no longer exists.",
    };
  }

  if (normalizedReason === "invalid-catalog") {
    const missingRequiredCodes = Array.isArray(health && health.missingRequiredCodes) ? health.missingRequiredCodes.filter(Boolean) : [];
    return {
      reason: normalizedReason,
      code: "failed-precondition",
      category: "billing-catalog",
      message: missingRequiredCodes.length
        ? `Billing catalog is incomplete. Missing required codes: ${missingRequiredCodes.join(", ")}.`
        : "Billing catalog is incomplete or invalid.",
    };
  }

  if (normalizedReason === "no-linked-children") {
    return {
      reason: normalizedReason,
      code: "failed-precondition",
      category: "billing-generation",
      message: "No linked children were found for this parent.",
    };
  }

  if (normalizedReason === "no-billable-items") {
    return {
      reason: normalizedReason,
      code: "failed-precondition",
      category: "billing-generation",
      message: "No billable items were found for the selected billing period.",
    };
  }

  if (normalizedReason === "payment-provider-disabled") {
    return {
      reason: normalizedReason,
      code: "failed-precondition",
      category: "payment-configuration",
      message: "The configured payment provider is disabled. Dummy payment mode remains active.",
    };
  }

  if (normalizedReason === "payment-provider-not-configured") {
    return {
      reason: normalizedReason,
      code: "failed-precondition",
      category: "payment-configuration",
      message: "Payment provider settings are incomplete. Dummy payment mode remains active.",
    };
  }

  if (normalizedReason === "payment-provider-not-implemented") {
    return {
      reason: normalizedReason,
      code: "unimplemented",
      category: "payment-configuration",
      message: "This payment provider path is not implemented. Dummy payment mode remains active.",
    };
  }

  if (normalizedReason === "invoice-not-found") {
    return {
      reason: normalizedReason,
      code: "not-found",
      category: "not-found",
      message: "The requested invoice could not be found.",
    };
  }

  if (normalizedCode === "internal") {
    return {
      reason: normalizedReason,
      code: normalizedCode,
      category: "internal",
      message: "Unexpected billing backend error. Check the function logs for details.",
    };
  }

  return {
    reason: normalizedReason,
    code: normalizedCode,
    category: "operation",
    message: normalizedReason,
  };
}

function billingCallableFailure(reason, options = {}) {
  const descriptor = billingErrorDescriptor(reason, options.code, options);
  const payload = {
    ok: false,
    reason: descriptor.reason,
    code: descriptor.code,
    category: descriptor.category,
    message: descriptor.message,
  };
  const extras = { ...options };
  delete extras.code;
  Object.assign(payload, extras);
  return payload;
}

function billingCallableFailureFromError(err, options = {}) {
  return billingCallableFailure(callableErrorReason(err), {
    ...options,
    code: String((err && err.code) || options.code || "internal"),
  });
}

function requireAuth(req) {
  if (!req.auth) {
    throw callableError("unauthenticated", "unauthenticated");
  }
}

function requireAdmin(req) {
  requireAuth(req);
  const role = req && req.auth && req.auth.token ? String(req.auth.token.role || "") : "";
  if (role.toLowerCase() !== "admin") {
    throw callableError("admin-only", "permission-denied");
  }
}

function requireStaff(req) {
  requireAuth(req);
  const role = req && req.auth && req.auth.token ? String(req.auth.token.role || "").toLowerCase() : "";
  if (role !== "admin" && role !== "teacher") {
    throw callableError("staff-only", "permission-denied");
  }
  return role;
}

const ATTENDANCE_TIME_ZONE = "Asia/Kuala_Lumpur";
const ATTENDANCE_UTC_OFFSET_HOURS = 8;

function attendanceActor(req, fallbackDisplayName = "") {
  const token = req && req.auth && req.auth.token ? req.auth.token : {};
  const displayName = String(
    fallbackDisplayName
      || token.name
      || token.email
      || token.phone_number
      || "",
  ).trim();

  return {
    uid: String((req && req.auth && req.auth.uid) || ""),
    role: String(token.role || "").trim().toLowerCase(),
    email: String(token.email || "").trim(),
    phoneE164: String(token.phone_number || "").trim(),
    displayName,
  };
}

function attendanceDayInfo(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ATTENDANCE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);

  const values = {};
  for (const part of parts) {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      values[part.type] = part.value;
    }
  }

  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const key = `${values.year}-${values.month}-${values.day}`;
  const startOfDayUtc = new Date(Date.UTC(year, month - 1, day, -ATTENDANCE_UTC_OFFSET_HOURS, 0, 0, 0));

  return {
    key,
    year,
    month,
    day,
    startOfDayUtc,
  };
}

function attendanceDayInfoFromDateKey(dateKey) {
  const normalized = String(dateKey || "").trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw callableError("invalid-attendance-date", "invalid-argument");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return {
    key: normalized,
    year,
    month,
    day,
    startOfDayUtc: new Date(Date.UTC(year, month - 1, day, -ATTENDANCE_UTC_OFFSET_HOURS, 0, 0, 0)),
  };
}

function attendanceTimestampField(raw, fieldName, required = false) {
  const value = String(raw || "").trim();
  if (!value) {
    if (required) {
      throw callableError(`missing-${fieldName}`, "invalid-argument");
    }
    return null;
  }

  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    throw callableError(`invalid-${fieldName}`, "invalid-argument");
  }
  return dt;
}

function attendanceHasCheckIn(data) {
  return Boolean(data && (data.checkInAt || data.check_in_time || data.checkInTime));
}

function attendanceHasCheckOut(data) {
  return Boolean(data && (data.checkOutAt || data.check_out_time || data.checkOutTime || data.checkoutTime));
}

function attendanceStatusValue(data) {
  const status = String(data && data.status ? data.status : "").trim().toUpperCase();
  if (status) return status;
  if (attendanceHasCheckOut(data)) return "CHECKED_OUT";
  if (attendanceHasCheckIn(data)) return "CHECKED_IN";
  return "NOT_CHECKED_IN";
}

function attendanceChildName(data) {
  return String((data && (data.name || data.childName)) || "").trim();
}

function attendanceParentName(childData, parentData) {
  return String(
    (childData && (childData.parentName || childData.parent_name || childData.parentContact))
      || (parentData && parentData.parentName)
      || "-",
  ).trim() || "-";
}

function attendanceChildDocIdFromRef(rawRef) {
  if (!rawRef) return "";

  let path = "";
  if (typeof rawRef === "string") {
    path = rawRef.trim();
  } else if (typeof rawRef.path === "string") {
    path = rawRef.path.trim();
  }

  if (!path) return "";

  path = path.startsWith("/") ? path.slice(1) : path;
  const documentsMarker = "/documents/";
  const documentsIndex = path.indexOf(documentsMarker);
  if (documentsIndex >= 0) {
    path = path.slice(documentsIndex + documentsMarker.length);
  }
  if (path.startsWith("documents/")) {
    path = path.slice("documents/".length);
  }

  const childMarker = "children/";
  const childIndex = path.indexOf(childMarker);
  if (childIndex < 0) return "";

  const childPath = path.slice(childIndex + childMarker.length);
  return String(childPath.split("/")[0] || "").trim();
}

function attendanceDocumentMatchesDay(data, dayInfo, docId = "") {
  const normalizedDocId = String(docId || "").trim();
  if (normalizedDocId && normalizedDocId.startsWith(`${dayInfo.key}_`)) {
    return true;
  }

  const normalizedDateKey = String(data && data.dateKey ? data.dateKey : "").trim();
  if (normalizedDateKey && normalizedDateKey === dayInfo.key) {
    return true;
  }

  const rawDate = data && data.date ? data.date : null;
  if (typeof rawDate === "string" && rawDate.trim() === dayInfo.key) {
    return true;
  }

  const attendanceDate = attendanceTimestampToDate(rawDate);
  if (!attendanceDate) {
    return false;
  }

  const startMs = dayInfo.startOfDayUtc.getTime();
  const endMs = startMs + (24 * 60 * 60 * 1000);
  const attendanceMs = attendanceDate.getTime();
  return attendanceMs >= startMs && attendanceMs < endMs;
}

async function attendanceResolveParentQrCheckoutTarget({ tx, db, dayInfo, tokenData, parentData, fallbackChildId }) {
  const candidateChildKeys = [];
  const candidateChildDocIds = [];

  const addUnique = (target, raw) => {
    const value = String(raw || "").trim();
    if (!value || target.includes(value)) return;
    target.push(value);
  };

  addUnique(candidateChildDocIds, attendanceChildDocIdFromRef(tokenData && tokenData.childRef));
  addUnique(candidateChildDocIds, attendanceChildDocIdFromRef(parentData && parentData.childRef));
  addUnique(candidateChildDocIds, fallbackChildId);
  addUnique(candidateChildDocIds, tokenData && tokenData.childId);
  addUnique(candidateChildDocIds, parentData && parentData.childId);

  addUnique(candidateChildKeys, fallbackChildId);
  addUnique(candidateChildKeys, tokenData && tokenData.childId);
  addUnique(candidateChildKeys, parentData && parentData.childId);

  let childNumericId = null;

  let childSnap = null;
  for (const childDocId of candidateChildDocIds) {
    const nextChildSnap = await tx.get(db.collection("children").doc(childDocId));
    if (nextChildSnap.exists) {
      childSnap = nextChildSnap;
      break;
    }
  }

  let childRef = null;
  if (childSnap && childSnap.exists) {
    childRef = childSnap.ref;
    const childData = childSnap.data() || {};
    childNumericId = Number.isFinite(Number(childData.child_id)) ? Number(childData.child_id) : null;
    addUnique(candidateChildKeys, childSnap.id);
    addUnique(candidateChildKeys, childData.childId);
    addUnique(candidateChildKeys, childData.nfc_uid);
    addUnique(candidateChildKeys, childData.child_id);
  } else if (candidateChildDocIds.length) {
    childRef = db.collection("children").doc(candidateChildDocIds[0]);
  }

  const scoreAttendanceCandidate = (doc, data) => {
    if (!doc || !data) return -1;

    let score = 0;
    if (attendanceDocumentMatchesDay(data, dayInfo, doc.id)) score += 10;

    const docChildId = String(data.childId || "").trim();
    const docChildDocId = attendanceChildDocIdFromRef(data.childRef);
    const docNumericChildId = Number.isFinite(Number(data.child_id)) ? Number(data.child_id) : null;

    if (docChildId && candidateChildKeys.includes(docChildId)) score += 6;
    if (docChildDocId && candidateChildDocIds.includes(docChildDocId)) score += 6;
    if (docNumericChildId !== null && childNumericId !== null && docNumericChildId === childNumericId) score += 5;
    if (attendanceHasCheckIn(data)) score += 8;
    if (!attendanceHasCheckOut(data)) score += 4;
    if (attendanceStatusValue(data) === "CHECKED_IN") score += 3;
    if (attendanceStatusValue(data) === "CHECKED_OUT") score -= 3;

    return score;
  };

  const candidateDocs = [];
  const addCandidateDoc = (doc) => {
    if (doc && doc.exists) {
      candidateDocs.push(doc);
    }
  };

  for (const childKey of candidateChildKeys) {
    const attendanceRef = db.collection("attendance").doc(`${dayInfo.key}_${childKey}`);
    const attendanceSnap = await tx.get(attendanceRef);
    addCandidateDoc(attendanceSnap);
  }

  if (childRef) {
    const attendanceQuery = db.collection("attendance")
      .where("childRef", "==", childRef)
      .limit(20);
    const attendanceQuerySnap = await tx.get(attendanceQuery);

    candidateDocs.push(...attendanceQuerySnap.docs);
  }

  const uniqueCandidateChildKeys = candidateChildKeys.slice(0, 10);
  if (uniqueCandidateChildKeys.length) {
    const attendanceByChildIdQuery = db.collection("attendance")
      .where("childId", "in", uniqueCandidateChildKeys)
      .limit(20);
    const attendanceByChildIdSnap = await tx.get(attendanceByChildIdQuery);
    candidateDocs.push(...attendanceByChildIdSnap.docs);
  }

  if (childNumericId !== null) {
    const attendanceByNumericIdQuery = db.collection("attendance")
      .where("child_id", "==", childNumericId)
      .limit(20);
    const attendanceByNumericIdSnap = await tx.get(attendanceByNumericIdQuery);
    candidateDocs.push(...attendanceByNumericIdSnap.docs);
  }

  let bestMatch = null;
  let bestScore = -1;
  let bestHasCheckIn = false;
  let bestHasCheckOut = true;
  const seenDocIds = new Set();
  for (const doc of candidateDocs) {
    if (!doc || seenDocIds.has(doc.id)) {
      continue;
    }
    seenDocIds.add(doc.id);

    const data = doc.data() || {};
    if (!attendanceDocumentMatchesDay(data, dayInfo, doc.id)) {
      continue;
    }

    const score = scoreAttendanceCandidate(doc, data);
    const hasCheckIn = attendanceHasCheckIn(data);
    const hasCheckOut = attendanceHasCheckOut(data);
    const shouldReplace = score > bestScore
      || (score === bestScore && hasCheckIn && !bestHasCheckIn)
      || (score === bestScore && hasCheckIn === bestHasCheckIn && !hasCheckOut && bestHasCheckOut);
    if (shouldReplace) {
      bestMatch = doc;
      bestScore = score;
      bestHasCheckIn = hasCheckIn;
      bestHasCheckOut = hasCheckOut;
    }
  }

  if (bestMatch) {
    const matchedData = bestMatch.data() || {};
    return {
      attendanceRef: bestMatch.ref,
      attendanceSnap: bestMatch,
      childRef,
      childSnap,
      resolvedChildId: String(matchedData.childId || candidateChildKeys[0] || fallbackChildId || "").trim(),
      matchScore: bestScore,
    };
  }

  return {
    attendanceRef: null,
    attendanceSnap: null,
    childRef,
    childSnap,
    resolvedChildId: String(candidateChildKeys[0] || fallbackChildId || "").trim(),
  };
}

function attendanceAddUnique(target, raw) {
  const value = String(raw || "").trim();
  if (!value || target.includes(value)) return;
  target.push(value);
}

function attendanceParentLinkedChildDocIds(parentData) {
  const childDocIds = [];
  const parent = parentData && typeof parentData === "object" ? parentData : {};

  const refLists = [];
  if (Array.isArray(parent.childRefs)) refLists.push(...parent.childRefs);
  if (Array.isArray(parent.childrenRefs)) refLists.push(...parent.childrenRefs);

  for (const rawRef of refLists) {
    attendanceAddUnique(childDocIds, attendanceChildDocIdFromRef(rawRef));
  }

  if (Array.isArray(parent.childIds)) {
    for (const rawChildId of parent.childIds) {
      attendanceAddUnique(childDocIds, rawChildId);
    }
  }

  attendanceAddUnique(childDocIds, attendanceChildDocIdFromRef(parent.childRef));
  attendanceAddUnique(childDocIds, parent.childId);
  return childDocIds;
}

async function attendanceResolvePickupEligibilityTarget({ db, dayInfo, desiredChildId, desiredChildRef }) {
  const candidateChildKeys = [];
  const candidateChildDocIds = [];

  attendanceAddUnique(candidateChildDocIds, attendanceChildDocIdFromRef(desiredChildRef));
  attendanceAddUnique(candidateChildDocIds, desiredChildId);
  attendanceAddUnique(candidateChildKeys, desiredChildId);

  let childNumericId = null;
  let childSnap = null;
  for (const childDocId of candidateChildDocIds) {
    const nextChildSnap = await db.collection("children").doc(childDocId).get();
    if (nextChildSnap.exists) {
      childSnap = nextChildSnap;
      break;
    }
  }

  let childRef = null;
  if (childSnap && childSnap.exists) {
    childRef = childSnap.ref;
    const childData = childSnap.data() || {};
    childNumericId = Number.isFinite(Number(childData.child_id)) ? Number(childData.child_id) : null;
    attendanceAddUnique(candidateChildKeys, childSnap.id);
    attendanceAddUnique(candidateChildKeys, childData.childId);
    attendanceAddUnique(candidateChildKeys, childData.nfc_uid);
    attendanceAddUnique(candidateChildKeys, childData.child_id);
  } else if (candidateChildDocIds.length) {
    childRef = db.collection("children").doc(candidateChildDocIds[0]);
  }

  const scoreAttendanceCandidate = (doc, data) => {
    if (!doc || !data) return -1;

    let score = 0;
    if (attendanceDocumentMatchesDay(data, dayInfo, doc.id)) score += 10;

    const docChildId = String(data.childId || "").trim();
    const docChildDocId = attendanceChildDocIdFromRef(data.childRef);
    const docNumericChildId = Number.isFinite(Number(data.child_id)) ? Number(data.child_id) : null;

    if (docChildId && candidateChildKeys.includes(docChildId)) score += 6;
    if (docChildDocId && candidateChildDocIds.includes(docChildDocId)) score += 6;
    if (docNumericChildId !== null && childNumericId !== null && docNumericChildId === childNumericId) score += 5;
    if (attendanceHasCheckIn(data)) score += 8;
    if (!attendanceHasCheckOut(data)) score += 4;
    if (attendanceStatusValue(data) === "CHECKED_IN") score += 3;
    if (attendanceStatusValue(data) === "CHECKED_OUT") score -= 3;

    return score;
  };

  const candidateDocs = [];
  const addCandidateDoc = (doc) => {
    if (doc && doc.exists) {
      candidateDocs.push(doc);
    }
  };

  for (const childKey of candidateChildKeys) {
    const attendanceRef = db.collection("attendance").doc(`${dayInfo.key}_${childKey}`);
    const attendanceSnap = await attendanceRef.get();
    addCandidateDoc(attendanceSnap);
  }

  if (childRef) {
    const attendanceQuerySnap = await db.collection("attendance")
      .where("childRef", "==", childRef)
      .limit(20)
      .get();
    candidateDocs.push(...attendanceQuerySnap.docs);
  }

  const uniqueCandidateChildKeys = candidateChildKeys.slice(0, 10);
  if (uniqueCandidateChildKeys.length) {
    const attendanceByChildIdSnap = await db.collection("attendance")
      .where("childId", "in", uniqueCandidateChildKeys)
      .limit(20)
      .get();
    candidateDocs.push(...attendanceByChildIdSnap.docs);
  }

  if (childNumericId !== null) {
    const attendanceByNumericIdSnap = await db.collection("attendance")
      .where("child_id", "==", childNumericId)
      .limit(20)
      .get();
    candidateDocs.push(...attendanceByNumericIdSnap.docs);
  }

  let bestMatch = null;
  let bestScore = -1;
  let bestHasCheckIn = false;
  let bestHasCheckOut = true;
  const seenDocIds = new Set();
  for (const doc of candidateDocs) {
    if (!doc || seenDocIds.has(doc.id)) {
      continue;
    }
    seenDocIds.add(doc.id);

    const data = doc.data() || {};
    if (!attendanceDocumentMatchesDay(data, dayInfo, doc.id)) {
      continue;
    }

    const score = scoreAttendanceCandidate(doc, data);
    const hasCheckIn = attendanceHasCheckIn(data);
    const hasCheckOut = attendanceHasCheckOut(data);
    const shouldReplace = score > bestScore
      || (score === bestScore && hasCheckIn && !bestHasCheckIn)
      || (score === bestScore && hasCheckIn === bestHasCheckIn && !hasCheckOut && bestHasCheckOut);
    if (shouldReplace) {
      bestMatch = doc;
      bestScore = score;
      bestHasCheckIn = hasCheckIn;
      bestHasCheckOut = hasCheckOut;
    }
  }

  if (bestMatch) {
    const matchedData = bestMatch.data() || {};
    return {
      attendanceSnap: bestMatch,
      childRef,
      childSnap,
      resolvedChildId: String(matchedData.childId || candidateChildKeys[0] || desiredChildId || "").trim(),
      matchScore: bestScore,
    };
  }

  return {
    attendanceSnap: null,
    childRef,
    childSnap,
    resolvedChildId: String(candidateChildKeys[0] || desiredChildId || "").trim(),
  };
}

function attendanceAuditEntry({ action, attendanceId, childId, actor, method, reason, details }) {
  return {
    action: String(action || "unknown"),
    attendanceId: String(attendanceId || ""),
    childId: String(childId || ""),
    actorUid: String(actor && actor.uid ? actor.uid : ""),
    actorRole: String(actor && actor.role ? actor.role : ""),
    actorEmail: String(actor && actor.email ? actor.email : ""),
    actorPhoneE164: String(actor && actor.phoneE164 ? actor.phoneE164 : ""),
    actorName: String(actor && actor.displayName ? actor.displayName : ""),
    method: String(method || ""),
    reason: String(reason || ""),
    details: details && typeof details === "object" ? details : {},
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

function casualTransitVisitActor(req, fallbackDisplayName = "") {
  return attendanceActor(req, fallbackDisplayName);
}

function casualTransitVisitStatus(data) {
  const status = String(data && data.status ? data.status : "").trim().toUpperCase();
  return status || "OPEN";
}

function casualTransitMoneySen(raw, fieldName, { required = false, min = 0 } = {}) {
  const value = raw === undefined || raw === null ? "" : String(raw).trim();
  if (!value) {
    if (required) {
      throw callableError(`missing-${fieldName}`, "invalid-argument");
    }
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw callableError(`invalid-${fieldName}`, "invalid-argument");
  }

  const rounded = Math.round(parsed);
  if (rounded < min) {
    throw callableError(`invalid-${fieldName}`, "invalid-argument");
  }
  return rounded;
}

function casualTransitPhone(raw) {
  return String(raw || "").replace(/[^0-9+]/g, "").trim();
}

function casualTransitReceiptNo(visitRef) {
  return `CT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${visitRef.id.slice(0, 6).toUpperCase()}`;
}

function casualTransitAuditEntry({ action, visitId, actor, reason, details }) {
  return {
    action: String(action || "unknown"),
    visitId: String(visitId || ""),
    actorUid: String(actor && actor.uid ? actor.uid : ""),
    actorRole: String(actor && actor.role ? actor.role : ""),
    actorEmail: String(actor && actor.email ? actor.email : ""),
    actorPhoneE164: String(actor && actor.phoneE164 ? actor.phoneE164 : ""),
    actorName: String(actor && actor.displayName ? actor.displayName : ""),
    reason: String(reason || ""),
    details: details && typeof details === "object" ? details : {},
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

exports.casualTransitCreateVisit = onCall({ region: "asia-southeast1" }, async (req) => {
  try {
    requireAdmin(req);

    const childName = String(req.data && req.data.childName ? req.data.childName : "").trim();
    const guardianName = String(req.data && req.data.guardianName ? req.data.guardianName : "").trim();
    const guardianPhone = casualTransitPhone(req.data && req.data.guardianPhone);
    const guardianRelationship = String(req.data && req.data.guardianRelationship ? req.data.guardianRelationship : "").trim();
    const notes = String(req.data && req.data.notes ? req.data.notes : "").trim();
    const actor = casualTransitVisitActor(req, req.data && (req.data.adminName || req.data.actorName));

    if (!childName) throw callableError("missing-child-name", "invalid-argument");
    if (!guardianName) throw callableError("missing-guardian-name", "invalid-argument");
    if (!guardianPhone) throw callableError("missing-guardian-phone", "invalid-argument");

    const db = admin.firestore();
    const visitRef = db.collection("casualTransitVisits").doc();
    const auditRef = db.collection("casualTransitAudit").doc();
    const dayInfo = attendanceDayInfo();

    await db.runTransaction(async (tx) => {
      tx.set(visitRef, {
        visitId: visitRef.id,
        childName,
        guardianName,
        guardianPhone,
        guardianRelationship,
        notes,
        visitDateKey: dayInfo.key,
        visitDate: admin.firestore.Timestamp.fromDate(dayInfo.startOfDayUtc),
        status: "OPEN",
        paymentStatus: "PENDING",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        checkInAt: admin.firestore.FieldValue.serverTimestamp(),
        checkInMethod: "ADMIN_MANUAL",
        createdByUid: actor.uid,
        createdByRole: actor.role,
        createdByName: actor.displayName,
        createdByEmail: actor.email,
      }, { merge: true });

      tx.set(auditRef, casualTransitAuditEntry({
        action: "CREATE_VISIT",
        visitId: visitRef.id,
        actor,
        details: {
          childName,
          guardianName,
          guardianPhone,
          guardianRelationship,
          visitDateKey: dayInfo.key,
          notes,
        },
      }));
    });

    return {
      ok: true,
      visitId: visitRef.id,
      status: "OPEN",
      paymentStatus: "PENDING",
      visitDateKey: dayInfo.key,
      childName,
      guardianName,
    };
  } catch (err) {
    logger.error("casualTransitCreateVisit failed", err);
    return { ok: false, reason: callableErrorReason(err) };
  }
});

exports.casualTransitCheckoutVisit = onCall({ region: "asia-southeast1" }, async (req) => {
  try {
    requireAdmin(req);

    const visitId = String(req.data && req.data.visitId ? req.data.visitId : "").trim();
    const amountSen = casualTransitMoneySen(req.data && req.data.amountSen, "amount-sen", { required: true, min: 0 });
    const paymentMethodRaw = String(req.data && req.data.paymentMethod ? req.data.paymentMethod : "Cash").trim();
    const paymentMethod = paymentMethodRaw || "Cash";
    const notes = String(req.data && req.data.notes ? req.data.notes : "").trim();
    const actor = casualTransitVisitActor(req, req.data && (req.data.adminName || req.data.actorName));

    if (!visitId) throw callableError("missing-visit-id", "invalid-argument");

    const db = admin.firestore();
    const visitRef = db.collection("casualTransitVisits").doc(visitId);
    const auditRef = db.collection("casualTransitAudit").doc();

    const result = await db.runTransaction(async (tx) => {
      const visitSnap = await tx.get(visitRef);
      if (!visitSnap.exists) {
        throw callableError("visit-not-found", "not-found");
      }

      const visit = visitSnap.data() || {};
      if (casualTransitVisitStatus(visit) !== "OPEN") {
        throw callableError("visit-already-closed", "already-exists");
      }

      const receiptNo = String(visit.receiptNo || casualTransitReceiptNo(visitRef));
      tx.set(visitRef, {
        status: "CLOSED",
        paymentStatus: "PAID",
        paymentMethod,
        amountSen,
        receiptNo,
        notes,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        checkOutAt: admin.firestore.FieldValue.serverTimestamp(),
        checkedOutByUid: actor.uid,
        checkedOutByRole: actor.role,
        checkedOutByName: actor.displayName,
        checkedOutByEmail: actor.email,
      }, { merge: true });

      tx.set(auditRef, casualTransitAuditEntry({
        action: "CHECKOUT_VISIT",
        visitId,
        actor,
        details: {
          childName: String(visit.childName || ""),
          guardianName: String(visit.guardianName || ""),
          amountSen,
          paymentMethod,
          receiptNo,
          notes,
        },
      }));

      return {
        visitId,
        status: "CLOSED",
        paymentStatus: "PAID",
        amountSen,
        paymentMethod,
        receiptNo,
        childName: String(visit.childName || ""),
        guardianName: String(visit.guardianName || ""),
      };
    });

    return { ok: true, ...result };
  } catch (err) {
    logger.error("casualTransitCheckoutVisit failed", err);
    return { ok: false, reason: callableErrorReason(err) };
  }
});

exports.casualTransitAdminOverride = onCall({ region: "asia-southeast1" }, async (req) => {
  try {
    requireAdmin(req);

    const action = String(req.data && req.data.action ? req.data.action : "").trim().toUpperCase();
    const visitId = String(req.data && req.data.visitId ? req.data.visitId : "").trim();
    const reason = String(req.data && req.data.reason ? req.data.reason : "").trim();
    const notes = String(req.data && req.data.notes ? req.data.notes : "").trim();
    const actor = casualTransitVisitActor(req, req.data && (req.data.adminName || req.data.actorName));

    if (!visitId) throw callableError("missing-visit-id", "invalid-argument");
    if (!reason) throw callableError("missing-reason", "invalid-argument");

    const allowedActions = new Set(["EDIT_VISIT", "REOPEN_VISIT", "CANCEL_VISIT"]);
    if (!allowedActions.has(action)) {
      throw callableError("invalid-override-action", "invalid-argument");
    }

    const editedCheckInAt = attendanceTimestampField(req.data && req.data.checkInAt, "check-in-at", false);
    const editedCheckOutAt = attendanceTimestampField(req.data && req.data.checkOutAt, "check-out-at", false);
    const editedAmountSen = casualTransitMoneySen(req.data && req.data.amountSen, "amount-sen", { required: false, min: 0 });
    const editedPaymentMethod = String(req.data && req.data.paymentMethod ? req.data.paymentMethod : "").trim();
    const editedChildName = String(req.data && req.data.childName ? req.data.childName : "").trim();
    const editedGuardianName = String(req.data && req.data.guardianName ? req.data.guardianName : "").trim();
    const editedGuardianPhone = casualTransitPhone(req.data && req.data.guardianPhone);
    const editedGuardianRelationship = String(req.data && req.data.guardianRelationship ? req.data.guardianRelationship : "").trim();

    const db = admin.firestore();
    const visitRef = db.collection("casualTransitVisits").doc(visitId);
    const auditRef = db.collection("casualTransitAudit").doc();

    const result = await db.runTransaction(async (tx) => {
      const visitSnap = await tx.get(visitRef);
      if (!visitSnap.exists) {
        throw callableError("visit-not-found", "not-found");
      }

      const existing = visitSnap.data() || {};
      const existingStatus = casualTransitVisitStatus(existing);
      let nextStatus = existingStatus;
      let nextPaymentStatus = String(existing.paymentStatus || "").trim().toUpperCase() || "PENDING";
      let nextCheckOutAt = existing.checkOutAt || null;
      let nextAmountSen = existing.amountSen == null ? null : Number(existing.amountSen);
      let nextPaymentMethod = String(existing.paymentMethod || "").trim();
      let nextReceiptNo = String(existing.receiptNo || "").trim();
      let nextCanceledAt = existing.canceledAt || null;

      const patch = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastEditedByUid: actor.uid,
        lastEditedByRole: actor.role,
        lastEditedByName: actor.displayName,
        lastOverrideReason: reason,
        notes,
      };

      if (action === "EDIT_VISIT") {
        if (
          !editedChildName &&
          !editedGuardianName &&
          !editedGuardianPhone &&
          !editedGuardianRelationship &&
          !editedCheckInAt &&
          !editedCheckOutAt &&
          editedAmountSen === null &&
          !editedPaymentMethod &&
          !notes
        ) {
          throw callableError("missing-edit-fields", "invalid-argument");
        }

        const resolvedCheckIn = editedCheckInAt || attendanceTimestampToDate(existing.checkInAt) || null;
        const resolvedCheckOut = editedCheckOutAt || attendanceTimestampToDate(existing.checkOutAt) || null;
        if (resolvedCheckOut && !resolvedCheckIn) {
          throw callableError("checkout-without-checkin", "failed-precondition");
        }
        if (resolvedCheckIn && resolvedCheckOut && resolvedCheckOut.getTime() < resolvedCheckIn.getTime()) {
          throw callableError("checkout-before-checkin", "failed-precondition");
        }

        if (editedChildName) patch.childName = editedChildName;
        if (editedGuardianName) patch.guardianName = editedGuardianName;
        if (editedGuardianPhone) patch.guardianPhone = editedGuardianPhone;
        if (editedGuardianRelationship) patch.guardianRelationship = editedGuardianRelationship;
        if (editedCheckInAt) patch.checkInAt = admin.firestore.Timestamp.fromDate(editedCheckInAt);
        if (editedCheckOutAt) patch.checkOutAt = admin.firestore.Timestamp.fromDate(editedCheckOutAt);
        if (editedAmountSen !== null) patch.amountSen = editedAmountSen;
        if (editedPaymentMethod) patch.paymentMethod = editedPaymentMethod;

        nextCheckOutAt = patch.checkOutAt || existing.checkOutAt || null;
        nextAmountSen = Object.prototype.hasOwnProperty.call(patch, "amountSen") ? editedAmountSen : nextAmountSen;
        nextPaymentMethod = Object.prototype.hasOwnProperty.call(patch, "paymentMethod") ? editedPaymentMethod : nextPaymentMethod;

        if (existingStatus !== "CANCELED") {
          nextStatus = nextCheckOutAt ? "CLOSED" : "OPEN";
          nextPaymentStatus = nextCheckOutAt ? (nextAmountSen !== null && nextAmountSen > 0 ? "PAID" : nextPaymentStatus) : "PENDING";
          if (!nextCheckOutAt) {
            nextReceiptNo = "";
            patch.receiptNo = admin.firestore.FieldValue.delete();
          }
        }
      } else if (action === "REOPEN_VISIT") {
        if (existingStatus !== "CLOSED") {
          throw callableError("visit-not-closed", "failed-precondition");
        }
        nextStatus = "OPEN";
        nextPaymentStatus = "PENDING";
        nextCheckOutAt = null;
        nextAmountSen = null;
        nextPaymentMethod = "";
        nextReceiptNo = "";
        patch.checkOutAt = admin.firestore.FieldValue.delete();
        patch.amountSen = admin.firestore.FieldValue.delete();
        patch.paymentMethod = admin.firestore.FieldValue.delete();
        patch.receiptNo = admin.firestore.FieldValue.delete();
      } else if (action === "CANCEL_VISIT") {
        if (existingStatus === "CANCELED") {
          throw callableError("visit-already-canceled", "already-exists");
        }
        nextStatus = "CANCELED";
        nextPaymentStatus = "VOID";
        nextCanceledAt = admin.firestore.FieldValue.serverTimestamp();
        patch.canceledAt = nextCanceledAt;
        patch.canceledByUid = actor.uid;
        patch.canceledByRole = actor.role;
        patch.canceledByName = actor.displayName;
        patch.cancellationReason = reason;
      }

      patch.status = nextStatus;
      patch.paymentStatus = nextPaymentStatus;
      tx.set(visitRef, patch, { merge: true });

      tx.set(auditRef, casualTransitAuditEntry({
        action,
        visitId,
        actor,
        reason,
        details: {
          previousStatus: existingStatus,
          nextStatus,
          previousPaymentStatus: String(existing.paymentStatus || "").trim().toUpperCase() || "PENDING",
          nextPaymentStatus,
          previousCheckInAt: existing.checkInAt || null,
          previousCheckOutAt: existing.checkOutAt || null,
          nextCheckInAt: patch.checkInAt || existing.checkInAt || null,
          nextCheckOutAt,
          previousAmountSen: existing.amountSen == null ? null : Number(existing.amountSen),
          nextAmountSen,
          previousPaymentMethod: String(existing.paymentMethod || ""),
          nextPaymentMethod,
          previousReceiptNo: String(existing.receiptNo || ""),
          nextReceiptNo,
          previousCanceledAt: existing.canceledAt || null,
          nextCanceledAt,
          childName: String(patch.childName || existing.childName || ""),
          guardianName: String(patch.guardianName || existing.guardianName || ""),
          guardianPhone: String(patch.guardianPhone || existing.guardianPhone || ""),
          guardianRelationship: String(patch.guardianRelationship || existing.guardianRelationship || ""),
          notes,
        },
      }));

      return {
        visitId,
        status: nextStatus,
        paymentStatus: nextPaymentStatus,
      };
    });

    return { ok: true, ...result };
  } catch (err) {
    logger.error("casualTransitAdminOverride failed", err);
    return { ok: false, reason: callableErrorReason(err) };
  }
});

function billingAuditActor(req) {
  const token = req && req.auth && req.auth.token ? req.auth.token : {};
  return {
    uid: String((req && req.auth && req.auth.uid) || ""),
    role: String(token.role || ""),
    email: String(token.email || ""),
    phoneE164: String(token.phone_number || ""),
  };
}

async function recordBillingAudit({ action, catalogId, version, req, details }) {
  const actor = billingAuditActor(req);
  await admin.firestore().collection("billingAudit").add({
    action: String(action || "unknown"),
    catalogId: String(catalogId || ""),
    version: String(version || ""),
    actorUid: actor.uid,
    actorRole: actor.role,
    actorEmail: actor.email,
    actorPhoneE164: actor.phoneE164,
    details: details && typeof details === "object" ? details : {},
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

function normalizePayerType(raw) {
  const v = String(raw || "").trim().toLowerCase();
  return v === "staff" ? "staff" : "nonstaff";
}

function moneySen(amountSen) {
  const n = Number(amountSen || 0);
  return Math.max(0, Math.round(n));
}

function monthKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function parseIsoDateOnly(s) {
  const v = String(s || "").trim();
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function ageInMonths(at, birthDate) {
  const a = new Date(at.getFullYear(), at.getMonth(), 1);
  const b = new Date(birthDate.getFullYear(), birthDate.getMonth(), 1);
  return (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth());
}

function resolveAgeProfile(months) {
  if (!Number.isFinite(Number(months))) {
    return {
      ageBand: "2y_4y",
      ageOutOfPolicy: true,
      agePolicyReason: "missing_birth_date",
    };
  }

  const ageMonths = Number(months);
  if (ageMonths < 3) {
    return {
      ageBand: "3m_2y",
      ageOutOfPolicy: true,
      agePolicyReason: "under_3_months",
    };
  }
  if (ageMonths < 24) {
    return {
      ageBand: "3m_2y",
      ageOutOfPolicy: false,
      agePolicyReason: "in_range",
    };
  }
  if (ageMonths < 60) {
    return {
      ageBand: "2y_4y",
      ageOutOfPolicy: false,
      agePolicyReason: "in_range",
    };
  }
  return {
    ageBand: "2y_4y",
    ageOutOfPolicy: true,
    agePolicyReason: "age_4y_or_above",
  };
}

function registrationChargeRequired(child, periodKey) {
  if (!child) return false;

  const appliedPeriod = String(child.registrationFeeAppliedPeriod || "").trim();
  if (appliedPeriod) return false;

  const registrationDate = child.registeredAt && typeof child.registeredAt.toDate === "function"
    ? child.registeredAt.toDate()
    : (child.registeredAt ? new Date(child.registeredAt) : null);
  if (!registrationDate || Number.isNaN(registrationDate.getTime())) {
    return false;
  }

  const registrationPeriod = monthKey(registrationDate);
  return !periodKey || registrationPeriod <= periodKey;
}

function resolveBillingAgePolicy({ months, baseCode }) {
  const defaultProfile = resolveAgeProfile(months);
  const normalizedBaseCode = String(baseCode || "").trim().toLowerCase();

  if (!normalizedBaseCode.startsWith("transit_")) {
    return defaultProfile;
  }

  if (normalizedBaseCode === "transit_schoolholiday_month") {
    if (!Number.isFinite(Number(months))) {
      return {
        ageBand: defaultProfile.ageBand,
        ageOutOfPolicy: true,
        agePolicyReason: "school_holiday_requires_known_age",
      };
    }
    if (Number(months) < 48) {
      return {
        ageBand: defaultProfile.ageBand,
        ageOutOfPolicy: true,
        agePolicyReason: "school_holiday_requires_age_4_plus",
      };
    }
  }

  return {
    ageBand: defaultProfile.ageBand,
    ageOutOfPolicy: false,
    agePolicyReason: "transit_all_ages_allowed",
  };
}

async function assertParentOwnerByPhone({ parentId, authToken }) {
  const phone = authToken && authToken.phone_number ? String(authToken.phone_number) : "";
  if (!phone) {
    throw callableError("missing-phone", "failed-precondition");
  }

  const snap = await admin.firestore().collection("parents").doc(parentId).get();
  if (!snap.exists) {
    throw callableError("parent-not-found", "not-found");
  }

  const p = snap.data() || {};
  const phoneE164 = String(p.phoneE164 || "").trim();
  const phoneTail = String(p.phoneTail || "").trim();
  const phoneLocal = String(p.phone || "").trim();

  const tail = myTail(phone);
  const ok = (phoneE164 && phoneE164 === phone)
    || (phoneTail && tail && phone.endsWith(phoneTail))
    || (phoneLocal && tail && myTail(phoneLocal) === tail);

  if (!ok) {
    throw callableError("forbidden", "permission-denied");
  }

  return { parentSnap: snap, parentData: p, phoneE164: phone, tail };
}

function feeTableFromPdf() {
  return {
    version: "pdf-2026-03-18",
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
    comms_book_4months: { staff: 1500, nonstaff: 1500 },
    insurance_yearly_age2plus: { staff: 2000, nonstaff: 2000 },
  };
}

let catalogCache = {
  ts: 0,
  catalog: null,
};

// Test hook for emulator E2E: forces next catalog load to re-read Firestore.
exports.__resetBillingCatalogCacheForTests = () => {
  catalogCache = { ts: 0, catalog: null };
};

function sanitizeTransitCode(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return "";
  return /^transit_[a-z0-9_]+$/.test(v) ? v : "";
}

function normalizeCatalogDoc(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const tableRaw = (src.table && typeof src.table === "object")
    ? src.table
    : Object.fromEntries(
      Object.entries(src).filter(([k, v]) => {
        if (["version", "active", "updatedAt", "updatedBy"].includes(k)) return false;
        return v && typeof v === "object" && Object.prototype.hasOwnProperty.call(v, "staff")
          && Object.prototype.hasOwnProperty.call(v, "nonstaff");
      }),
    );
  const table = {};

  for (const [code, val] of Object.entries(tableRaw)) {
    if (!val || typeof val !== "object") continue;
    const staff = moneySen(val.staff);
    const nonstaff = moneySen(val.nonstaff);
    table[code] = { staff, nonstaff };
  }

  return {
    version: String(src.version || "pdf-2026-03-18"),
    table,
    active: Boolean(src.active),
    defaultTransitMonthlyCode: sanitizeTransitCode(src.defaultTransitMonthlyCode),
  };
}

async function loadActiveFeeCatalog() {
  const now = Date.now();
  if (catalogCache.catalog && (now - catalogCache.ts) < 60_000) {
    return catalogCache.catalog;
  }

  const fallback = normalizeCatalogDoc(feeTableFromPdf());
  const db = admin.firestore();

  try {
    const pointer = await db.collection("billingConfig").doc("current").get();
    if (pointer.exists) {
      const d = pointer.data() || {};
      const activeId = String(d.activeCatalogId || "").trim();
      const configuredTransitCode = sanitizeTransitCode(d.defaultTransitMonthlyCode);
      if (activeId) {
        const cat = await db.collection("billingCatalog").doc(activeId).get();
        if (cat.exists) {
          const normalized = normalizeCatalogDoc(cat.data() || {});
          if (Object.keys(normalized.table).length > 0) {
            normalized.defaultTransitMonthlyCode = configuredTransitCode || normalized.defaultTransitMonthlyCode || "";
            catalogCache = { ts: now, catalog: normalized };
            return normalized;
          }
        }
      }
    }

    const activeSnap = await db.collection("billingCatalog").where("active", "==", true).limit(1).get();
    if (!activeSnap.empty) {
      const normalized = normalizeCatalogDoc(activeSnap.docs[0].data() || {});
      if (Object.keys(normalized.table).length > 0) {
        normalized.defaultTransitMonthlyCode = normalized.defaultTransitMonthlyCode || "";
        catalogCache = { ts: now, catalog: normalized };
        return normalized;
      }
    }
  } catch (err) {
    logger.error("billing-catalog-load-failed", err);
  }

  catalogCache = { ts: now, catalog: fallback };
  return fallback;
}

function priceFor({ table, code, payerType }) {
  const row = (table && table.table ? table.table[code] : table[code]);
  if (!row) return null;
  const k = payerType === "staff" ? "staff" : "nonstaff";
  return moneySen(row[k]);
}

exports.billingGetFeeCatalog = onCall({ region: "asia-southeast1" }, async (req) => {
  requireAuth(req);
  const table = await loadActiveFeeCatalog();
  return {
    ok: true,
    version: table.version,
    currency: "MYR",
    table: table.table,
    policy: {
      defaultTransitMonthlyCode: table.defaultTransitMonthlyCode || "transit_2h_month",
      dueDayOptions: [5, 7],
      absenceDiscountPercent: 10,
      absenceDiscountMinDaysWithLetter: 14,
      annualFeeMonth: 1,
      commsBookMonths: [1, 5, 9],
      insuranceMinAgeMonths: 24,
      notes: [
        "Yuran pendaftaran dikira sebagai yuran bulan pendaftaran.",
        "Yuran bulan berikutnya perlu dibayar sebelum 5hb atau 7hb.",
        "Potongan 10% jika tidak hadir >14 hari dengan surat.",
      ],
    },
  };
});

function billingCatalogHealthSnapshot(table) {
  const rows = table && table.table ? table.table : (table || {});
  const configuredDefaultTransitCode = sanitizeTransitCode(table && table.defaultTransitMonthlyCode);
  const resolvedDefaultTransitCode = pickDefaultTransitCode({ table, configuredCode: configuredDefaultTransitCode });
  const missingRequiredCodes = BILLING_REQUIRED_CODES.filter((code) => !rows[code]);
  const transitMonthlyCodes = Object.keys(rows)
    .filter((code) => String(code).startsWith("transit_") && String(code).endsWith("_month"))
    .sort();
  const defaultTransitConfiguredValid = Boolean(configuredDefaultTransitCode && rows[configuredDefaultTransitCode]);
  const defaultTransitResolvedValid = Boolean(resolvedDefaultTransitCode && rows[resolvedDefaultTransitCode]);
  const isValid = missingRequiredCodes.length === 0
    && transitMonthlyCodes.length > 0
    && defaultTransitResolvedValid;

  return {
    version: String((table && table.version) || ""),
    rowCount: Object.keys(rows).length,
    requiredCodeCount: BILLING_REQUIRED_CODES.length,
    missingRequiredCodes,
    configuredDefaultTransitCode: configuredDefaultTransitCode || "",
    resolvedDefaultTransitCode: resolvedDefaultTransitCode || "",
    defaultTransitConfiguredValid,
    defaultTransitResolvedValid,
    transitMonthlyCodes,
    isValid,
  };
}

exports.billingGetHealth = onCall({ region: "asia-southeast1" }, async (req) => {
  try {
    requireAuth(req);
    const table = await loadActiveFeeCatalog();
    const gatewayConfig = await loadPaymentGatewayConfig();
    return {
      ok: true,
      health: {
        ...billingCatalogHealthSnapshot(table),
        paymentGateway: paymentGatewaySummary(gatewayConfig),
      },
    };
  } catch (err) {
    logger.error("billing-get-health-failed", err);
    return billingCallableFailureFromError(err);
  }
});

exports.billingAdminListCatalogs = onCall({ region: "asia-southeast1" }, async (req) => {
  try {
    requireAdmin(req);
    const snap = await admin.firestore().collection("billingCatalog").get();
    const catalogs = snap.docs.map((doc) => {
      const normalized = normalizeCatalogDoc(doc.data() || {});
      return {
        id: doc.id,
        version: normalized.version,
        active: normalized.active,
        defaultTransitMonthlyCode: normalized.defaultTransitMonthlyCode || "",
        table: normalized.table,
      };
    }).sort((a, b) => {
      if (a.active && !b.active) return -1;
      if (!a.active && b.active) return 1;
      return String(a.version || "").localeCompare(String(b.version || ""));
    });

    return { ok: true, catalogs };
  } catch (err) {
    logger.error("billing-admin-list-catalogs-failed", err);
    return billingCallableFailureFromError(err);
  }
});

exports.billingAdminSaveCatalog = onCall({ region: "asia-southeast1" }, async (req) => {
  try {
    requireAdmin(req);
    const data = req.data && typeof req.data === "object" ? req.data : {};
    const version = String(data.version || "").trim();
    if (!version) return billingCallableFailure("missing-version");

    const normalized = normalizeCatalogDoc({
      version,
      table: data.table,
      defaultTransitMonthlyCode: data.defaultTransitMonthlyCode,
      active: false,
    });
    const health = billingCatalogHealthSnapshot(normalized);
    if (!health.isValid) {
      return billingCallableFailure("invalid-catalog", { health });
    }

    const payload = {
      version,
      active: false,
      table: normalized.table,
      defaultTransitMonthlyCode: health.resolvedDefaultTransitCode || "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: String(req.auth.uid || ""),
    };
    const ref = await admin.firestore().collection("billingCatalog").add(payload);
    await recordBillingAudit({
      action: "catalog_saved",
      catalogId: ref.id,
      version,
      req,
      details: {
        defaultTransitMonthlyCode: health.resolvedDefaultTransitCode || "",
        rowCount: health.rowCount,
        missingRequiredCodes: health.missingRequiredCodes || [],
      },
    });
    catalogCache = { ts: 0, catalog: null };
    return { ok: true, catalogId: ref.id, health };
  } catch (err) {
    logger.error("billing-admin-save-catalog-failed", err);
    return billingCallableFailureFromError(err);
  }
});

exports.billingAdminActivateCatalog = onCall({ region: "asia-southeast1" }, async (req) => {
  try {
    requireAdmin(req);
    const data = req.data && typeof req.data === "object" ? req.data : {};
    const catalogId = String(data.catalogId || "").trim();
    if (!catalogId) return billingCallableFailure("missing-catalogId");

    const catRef = admin.firestore().collection("billingCatalog").doc(catalogId);
    const catSnap = await catRef.get();
    if (!catSnap.exists) return billingCallableFailure("catalog-not-found");

    const current = normalizeCatalogDoc(catSnap.data() || {});
    const requestedDefaultTransitCode = sanitizeTransitCode(data.defaultTransitMonthlyCode);
    current.defaultTransitMonthlyCode = requestedDefaultTransitCode || current.defaultTransitMonthlyCode || "";
    const health = billingCatalogHealthSnapshot(current);
    if (!health.isValid) {
      return billingCallableFailure("invalid-catalog", { health });
    }

    const snap = await admin.firestore().collection("billingCatalog").get();
    const batch = admin.firestore().batch();
    snap.docs.forEach((doc) => {
      batch.set(doc.ref, {
        active: doc.id === catalogId,
        ...(doc.id === catalogId ? { defaultTransitMonthlyCode: health.resolvedDefaultTransitCode || "" } : {}),
      }, { merge: true });
    });
    batch.set(admin.firestore().collection("billingConfig").doc("current"), {
      activeCatalogId: catalogId,
      defaultTransitMonthlyCode: health.resolvedDefaultTransitCode || "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: String(req.auth.uid || ""),
    }, { merge: true });
    await batch.commit();

    await recordBillingAudit({
      action: "catalog_activated",
      catalogId,
      version: current.version || "",
      req,
      details: {
        defaultTransitMonthlyCode: health.resolvedDefaultTransitCode || "",
        rowCount: health.rowCount,
        missingRequiredCodes: health.missingRequiredCodes || [],
      },
    });

    catalogCache = { ts: 0, catalog: null };
    return { ok: true, catalogId, health };
  } catch (err) {
    logger.error("billing-admin-activate-catalog-failed", err);
    return billingCallableFailureFromError(err);
  }
});

exports.billingAdminListAudit = onCall({ region: "asia-southeast1" }, async (req) => {
  try {
    requireAdmin(req);
    const data = req.data && typeof req.data === "object" ? req.data : {};
    const requestedLimit = Number(data.limit || 25);
    const limit = Math.max(1, Math.min(50, Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 25));

    const snap = await admin.firestore().collection("billingAudit")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    const entries = snap.docs.map((doc) => {
      const raw = doc.data() || {};
      const createdAt = raw.createdAt && typeof raw.createdAt.toDate === "function"
        ? raw.createdAt.toDate().toISOString()
        : "";
      return {
        id: doc.id,
        action: String(raw.action || ""),
        catalogId: String(raw.catalogId || ""),
        version: String(raw.version || ""),
        actorUid: String(raw.actorUid || ""),
        actorRole: String(raw.actorRole || ""),
        actorEmail: String(raw.actorEmail || ""),
        actorPhoneE164: String(raw.actorPhoneE164 || ""),
        createdAt,
        details: raw.details && typeof raw.details === "object" ? raw.details : {},
      };
    });

    return { ok: true, entries };
  } catch (err) {
    logger.error("billing-admin-list-audit-failed", err);
    return billingCallableFailureFromError(err);
  }
});

exports.salaryGetTeacherConfigForCurrentUser = onCall({ region: "asia-southeast1" }, async (req) => {
  requireAuth(req);

  const phone = (req.auth.token && req.auth.token.phone_number)
    ? String(req.auth.token.phone_number).trim()
    : "";
  if (!phone) return { ok: false, reason: "missing-phone" };

  const tail = myTail(phone);
  const local = tail ? `0${tail}` : "";
  const db = admin.firestore();

  let snap = await db.collection("teachers").where("phoneE164", "==", phone).limit(1).get();
  if (snap.empty && tail) snap = await db.collection("teachers").where("phoneTail", "==", tail).limit(1).get();
  if (snap.empty && local) snap = await db.collection("teachers").where("phone", "==", local).limit(1).get();
  if (snap.empty) return { ok: false, reason: "teacher-not-found" };

  const d = snap.docs[0];
  const t = d.data() || {};
  return {
    ok: true,
    teacherId: d.id,
    salary: {
      currency: String(t.salaryCurrency || "MYR"),
      active: Boolean(t.salaryActive),
      baseSen: moneySen(t.salaryBaseSen),
      overtimeAfter530Sen: moneySen(t.salaryOvertimeAfter530Sen),
      overtime8to12Sen: moneySen(t.salaryOvertime8to12Sen),
      overtime12to7Sen: moneySen(t.salaryOvertime12to7Sen),
    },
  };
});

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function monthNumberFromPeriod(period) {
  const m = String(period || "").match(/^\d{4}-(\d{2})$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function isSamePeriod(tsOrDate, period) {
  if (!tsOrDate || !period) return false;
  const d = tsOrDate.toDate ? tsOrDate.toDate() : new Date(tsOrDate);
  if (Number.isNaN(d.getTime())) return false;
  return monthKey(d) === period;
}

function childAbsenceAdjustmentForPeriod(child, period, reqData) {
  const req = reqData && typeof reqData === "object" ? reqData : {};
  const periodKey = String(period || "").trim();

  const directHasLetter = Boolean(req.hasAbsenceLetter);
  const directAbsenceDays = Number(req.absenceDaysWithLetter || 0);
  if (directHasLetter || directAbsenceDays > 0) {
    return {
      hasAbsenceLetter: directHasLetter,
      absenceDaysWithLetter: Number.isFinite(directAbsenceDays) ? Math.max(0, Math.round(directAbsenceDays)) : 0,
      source: "request",
    };
  }

  const byChild = req.absenceAdjustmentsByChild && typeof req.absenceAdjustmentsByChild === "object"
    ? req.absenceAdjustmentsByChild
    : null;
  const childId = child && child.id ? String(child.id).trim() : "";
  if (byChild && childId && byChild[childId] && typeof byChild[childId] === "object") {
    const childReq = byChild[childId];
    const childHasLetter = Boolean(childReq.hasAbsenceLetter);
    const childAbsenceDays = Number(childReq.absenceDaysWithLetter || 0);
    return {
      hasAbsenceLetter: childHasLetter,
      absenceDaysWithLetter: Number.isFinite(childAbsenceDays) ? Math.max(0, Math.round(childAbsenceDays)) : 0,
      source: "request-child",
    };
  }

  const childData = child && typeof child === "object" ? child : {};
  const childPeriod = String(childData.absenceLetterPeriod || "").trim();
  const childHasLetter = Boolean(childData.absenceLetterApproved);
  const childAbsenceDays = Number(childData.absenceLetterDays || 0);
  if (childHasLetter && childPeriod && childPeriod === periodKey) {
    return {
      hasAbsenceLetter: true,
      absenceDaysWithLetter: Number.isFinite(childAbsenceDays) ? Math.max(0, Math.round(childAbsenceDays)) : 0,
      source: "child-profile",
    };
  }

  return {
    hasAbsenceLetter: false,
    absenceDaysWithLetter: 0,
    source: "none",
  };
}

function linkedChildIdsFromParent(parentData, fallbackChildId) {
  const ids = [];

  const addId = (raw) => {
    const v = String(raw || "").trim();
    if (!v || ids.includes(v)) return;
    ids.push(v);
  };

  const childIds = parentData && Array.isArray(parentData.childIds) ? parentData.childIds : [];
  for (const raw of childIds) addId(raw);

  const childRefs = parentData && Array.isArray(parentData.childRefs) ? parentData.childRefs : [];
  for (const raw of childRefs) {
    const ref = String(raw || "").trim();
    if (!ref) continue;
    const parts = ref.split("/");
    addId(parts[parts.length - 1]);
  }

  addId(parentData && parentData.childId);
  addId(fallbackChildId);
  return ids;
}

function effectivePayerTypeFromParent(parentData) {
  return normalizePayerType(
    parentData && (parentData.payerType || parentData.payer_category || parentData.isStaff)
      ? "staff"
      : "nonstaff",
  );
}

async function buildFamilyInvoiceFromPdfPolicy({ parentId, parentData, period, reqData, fallbackChildId }) {
  const childIds = linkedChildIdsFromParent(parentData, fallbackChildId);
  if (!childIds.length) {
    return { ok: false, reason: "no-linked-children", childIds: [] };
  }

  const payerType = effectivePayerTypeFromParent(parentData || {});
  const invoiceItems = [];
  const childSummaries = [];
  const appliedRegistrationChildIds = [];
  const appliedUniformChildIds = [];
  const managementReviewChildIds = [];
  const childNames = [];
  let totalSen = 0;
  let subTotalSen = 0;
  let dueDate = null;
  let dueDay = null;
  let pricingVersion = "";

  for (const childId of childIds) {
    const calc = await buildInvoiceItemsFromPdfPolicy({
      parentId,
      childId,
      period,
      reqData,
      payerType,
    });

    if (!calc || !Array.isArray(calc.items) || !calc.items.length) {
      continue;
    }

    const childLabel = String(calc.childName || childId).trim() || childId;
    if (!childNames.includes(childLabel)) {
      childNames.push(childLabel);
    }

    const isMultiChild = childIds.length > 1;
    for (const item of calc.items) {
      invoiceItems.push({
        ...item,
        childId,
        childName: childLabel,
        description: isMultiChild ? `${childLabel} - ${String(item.description || item.code || "Item")}` : item.description,
      });
    }

    totalSen += moneySen(calc.totalSen);
    subTotalSen += moneySen(calc.subTotalSen);
    pricingVersion = pricingVersion || String(calc.table && calc.table.version ? calc.table.version : "");
    if (!dueDate || (calc.dueDate && calc.dueDate.getTime() < dueDate.getTime())) {
      dueDate = calc.dueDate;
      dueDay = calc.dueDay;
    }

    childSummaries.push({
      childId,
      childName: childLabel,
      totalSen: moneySen(calc.totalSen),
      subTotalSen: moneySen(calc.subTotalSen),
      dueDay: Number(calc.dueDay || 7),
      billingMeta: calc.meta || {},
      itemCount: calc.items.length,
    });

    if (calc.meta && calc.meta.registrationMonth) {
      appliedRegistrationChildIds.push(childId);
    }
    if (calc.meta && calc.meta.uniformCharged) {
      appliedUniformChildIds.push(childId);
    }
    if (calc.meta && calc.meta.managementReviewRecommended) {
      managementReviewChildIds.push(childId);
    }
  }

  if (!invoiceItems.length) {
    return {
      ok: false,
      reason: "no-billable-items",
      childIds,
      childNames,
    };
  }

  const policyNotes = dedupePolicyNotes([
    `Bayaran bulan berikutnya hendaklah dijelaskan sebelum ${dueDay === 5 ? 5 : 7}hb.`,
    "Yuran bulanan dibayar penuh jika tidak hadir tanpa notis bertulis.",
    "Resit bayaran dikeluarkan selepas pembayaran diterima.",
    ...childSummaries.flatMap((summary) => {
      const notes = Array.isArray(summary.billingMeta && summary.billingMeta.policyNotes)
        ? summary.billingMeta.policyNotes
        : [];
      if (childIds.length <= 1) return notes;
      return notes.map((note) => `${summary.childName}: ${note}`);
    }),
  ]);

  return {
    ok: true,
    parentId,
    period,
    payerType,
    childIds,
    childNames,
    childNameSummary: childNames.join(", "),
    childSummaries,
    items: invoiceItems,
    subTotalSen: moneySen(subTotalSen),
    totalSen: moneySen(totalSen),
    dueDate,
    dueDay: dueDay === 5 ? 5 : 7,
    pricingVersion,
    registrationFeeChildIds: appliedRegistrationChildIds,
    uniformFeeChildIds: appliedUniformChildIds,
    billingMeta: {
      invoiceScope: "family",
      childCount: childSummaries.length,
      children: childSummaries,
      policyNotes,
      managementReviewRecommended: managementReviewChildIds.length > 0,
      managementReviewChildIds,
    },
  };
}

async function createParentInvoiceForPeriod({ req, parentId, parentData, period, reqData, createdByKind, fallbackChildId }) {
  const invoiceCol = admin.firestore().collection("parents").doc(parentId).collection("invoices");
  const existing = await invoiceCol.where("period", "==", period).limit(1).get();
  if (!existing.empty) {
    const doc = existing.docs[0];
    const existingData = doc.data() || {};
    if (String(existingData.status || "").toLowerCase() !== "paid") {
      await repairInvoiceFromEquivalentPaidCopy({ invoiceRef: doc.ref, invoiceData: existingData });
    }
    return { ok: true, already: true, invoiceId: doc.id, reason: "already-exists" };
  }

  const calc = await buildFamilyInvoiceFromPdfPolicy({
    parentId,
    parentData,
    period,
    reqData,
    fallbackChildId,
  });
  if (!calc.ok) {
    return calc;
  }

  const equivalentPaid = await findEquivalentPaidInvoice({
    period,
    childIds: calc.childIds,
  });

  const ref = invoiceCol.doc();
  const invoiceData = {
    period,
    currency: "MYR",
    status: equivalentPaid ? "paid" : "unpaid",
    payerType: calc.payerType,
    childId: calc.childIds.length === 1 ? calc.childIds[0] : null,
    childName: calc.childNameSummary || null,
    childIds: calc.childIds,
    childCoverageKey: childCoverageKey(period, calc.childIds),
    childNames: calc.childNames,
    items: calc.items,
    subTotalSen: calc.subTotalSen,
    totalSen: calc.totalSen,
    pricingVersion: calc.pricingVersion,
    dueDate: calc.dueDate,
    billingMeta: calc.billingMeta,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: { uid: req.auth.uid, kind: createdByKind || "billing" },
  };
  if (equivalentPaid) {
    Object.assign(invoiceData, buildPaidInvoiceSyncPatch(equivalentPaid.data, equivalentPaid.ref.path));
  }

  await ref.set(invoiceData, { merge: false });

  if (calc.registrationFeeChildIds && calc.registrationFeeChildIds.length) {
    await Promise.all(calc.registrationFeeChildIds.map(async (childId) => {
      try {
        await admin.firestore().collection("children").doc(childId).set({
          registrationFeeAppliedPeriod: period,
        }, { merge: true });
      } catch (e) {
        logger.error("registration-period-mark-failed", { childId, period, error: String(e && e.message ? e.message : e) });
      }
    }));
  }

  if (calc.uniformFeeChildIds && calc.uniformFeeChildIds.length) {
    await Promise.all(calc.uniformFeeChildIds.map(async (childId) => {
      try {
        await admin.firestore().collection("children").doc(childId).set({
          uniformFeeAppliedPeriod: period,
        }, { merge: true });
      } catch (e) {
        logger.error("uniform-period-mark-failed", { childId, period, error: String(e && e.message ? e.message : e) });
      }
    }));
  }

  return {
    ok: true,
    invoiceId: ref.id,
    childIds: calc.childIds,
    childNames: calc.childNames,
    totalSen: calc.totalSen,
  };
}

async function findInvoiceForChildPeriod({ childId, period }) {
  const normalizedChildId = String(childId || "").trim();
  const normalizedPeriod = String(period || "").trim();
  if (!normalizedChildId || !normalizedPeriod) return null;

  const snap = await admin.firestore().collectionGroup("invoices")
    .where("period", "==", normalizedPeriod)
    .get();

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (!invoiceChildIds(data).includes(normalizedChildId)) continue;
    const parentRef = doc.ref.parent && doc.ref.parent.parent ? doc.ref.parent.parent : null;
    const parentId = parentRef ? String(parentRef.id || "").trim() : "";
    if (!parentId) continue;
    return {
      invoiceRef: doc.ref,
      invoiceId: doc.id,
      invoiceData: data,
      parentId,
    };
  }

  return null;
}

function replacePolicyNoteByPrefix(notes, prefix, nextNote) {
  const normalizedPrefix = String(prefix || "").trim();
  const filtered = [];
  for (const note of notes || []) {
    const text = String(note || "").trim();
    if (!text) continue;
    if (normalizedPrefix && text.startsWith(normalizedPrefix)) continue;
    filtered.push(text);
  }
  if (nextNote) {
    filtered.push(String(nextNote).trim());
  }
  return dedupePolicyNotes(filtered);
}

function attendanceAdjustmentReviewReason(deltaSen) {
  const abs = Math.abs(moneySen(deltaSen));
  const amountText = `RM ${(abs / 100).toFixed(2)}`;
  if (deltaSen > 0) {
    return `Attendance changed after payment. A debit adjustment of ${amountText} is pending manual review.`;
  }
  if (deltaSen < 0) {
    return `Attendance changed after payment. A credit adjustment of ${amountText} is pending manual review.`;
  }
  return "Attendance changed after payment, but the latest recalculation no longer requires a financial adjustment.";
}

async function recordPaidInvoiceAdjustmentForAttendanceChange({ linkedInvoice, parentData, childId, period, attendanceDate, action, reason, notes, actor }) {
  const calc = await buildFamilyInvoiceFromPdfPolicy({
    parentId: linkedInvoice.parentId,
    parentData,
    period,
    reqData: {},
    fallbackChildId: childId,
  });

  if (!calc.ok && calc.reason !== "no-billable-items") {
    return {
      ok: false,
      reason: `invoice-adjustment-${String(calc.reason || "failed")}`,
      period,
      parentId: linkedInvoice.parentId,
      invoiceId: linkedInvoice.invoiceId,
    };
  }

  const recalculatedTotalSen = calc.ok ? moneySen(calc.totalSen) : 0;
  const previousTotalSen = moneySen(linkedInvoice.invoiceData && linkedInvoice.invoiceData.totalSen);
  const deltaSen = recalculatedTotalSen - previousTotalSen;
  const existingBillingMeta = linkedInvoice.invoiceData && linkedInvoice.invoiceData.billingMeta && typeof linkedInvoice.invoiceData.billingMeta === "object"
    ? linkedInvoice.invoiceData.billingMeta
    : {};
  const notePrefix = "Attendance correction after payment:";
  const reviewReason = attendanceAdjustmentReviewReason(deltaSen);
  const nextPolicyNotes = replacePolicyNoteByPrefix(
    Array.isArray(existingBillingMeta.policyNotes) ? existingBillingMeta.policyNotes : [],
    notePrefix,
    deltaSen === 0 ? `${notePrefix} no financial adjustment remains after the latest recalculation.` : `${notePrefix} ${reviewReason}`,
  );

  const adjustmentsSnap = await linkedInvoice.invoiceRef.collection("adjustments").get();
  let adjustmentRef = null;
  for (const doc of adjustmentsSnap.docs) {
    const data = doc.data() || {};
    if (String(data.source || "") !== "attendanceAdminOverride") continue;
    if (String(data.childId || "") !== String(childId || "")) continue;
    if (String(data.attendanceDate || "") !== String(attendanceDate || "")) continue;
    if (String(data.status || "pending") !== "pending") continue;
    adjustmentRef = doc.ref;
    break;
  }
  if (!adjustmentRef) {
    adjustmentRef = linkedInvoice.invoiceRef.collection("adjustments").doc();
  }

  if (deltaSen === 0) {
    await linkedInvoice.invoiceRef.set({
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      billingMeta: {
        ...existingBillingMeta,
        policyNotes: nextPolicyNotes,
        managementReviewRecommended: Boolean(existingBillingMeta.managementReviewRecommended),
        reviewReason: String(existingBillingMeta.reviewReason || ""),
        attendanceAdjustment: {
          required: false,
          status: "not-needed",
          deltaSen: 0,
          amountSen: 0,
          direction: "none",
          childId: String(childId || ""),
          attendanceDate: String(attendanceDate || ""),
          source: "attendanceAdminOverride",
          action: String(action || "").trim().toUpperCase(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
    }, { merge: true });

    return {
      ok: true,
      period,
      parentId: linkedInvoice.parentId,
      invoiceId: linkedInvoice.invoiceId,
      paidInvoice: true,
      adjustmentRecorded: false,
      adjustmentRequired: false,
      previousTotalSen,
      recalculatedTotalSen,
      deltaSen: 0,
    };
  }

  await adjustmentRef.set({
    source: "attendanceAdminOverride",
    status: "pending",
    type: deltaSen > 0 ? "debit" : "credit",
    deltaSen,
    amountSen: Math.abs(deltaSen),
    previousTotalSen,
    recalculatedTotalSen,
    period,
    parentId: linkedInvoice.parentId,
    invoiceId: linkedInvoice.invoiceId,
    childId: String(childId || ""),
    attendanceDate: String(attendanceDate || ""),
    action: String(action || "").trim().toUpperCase(),
    reason: String(reason || "").trim(),
    notes: String(notes || "").trim(),
    actorUid: String(actor && actor.uid ? actor.uid : ""),
    actorRole: String(actor && actor.role ? actor.role : ""),
    actorName: String(actor && actor.displayName ? actor.displayName : ""),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await linkedInvoice.invoiceRef.set({
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    billingMeta: {
      ...existingBillingMeta,
      policyNotes: nextPolicyNotes,
      managementReviewRecommended: true,
      reviewReason,
      attendanceAdjustment: {
        required: true,
        status: "pending",
        adjustmentId: adjustmentRef.id,
        deltaSen,
        amountSen: Math.abs(deltaSen),
        direction: deltaSen > 0 ? "debit" : "credit",
        childId: String(childId || ""),
        attendanceDate: String(attendanceDate || ""),
        source: "attendanceAdminOverride",
        action: String(action || "").trim().toUpperCase(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    },
  }, { merge: true });

  return {
    ok: true,
    period,
    parentId: linkedInvoice.parentId,
    invoiceId: linkedInvoice.invoiceId,
    paidInvoice: true,
    adjustmentRecorded: true,
    adjustmentRequired: true,
    adjustmentId: adjustmentRef.id,
    previousTotalSen,
    recalculatedTotalSen,
    deltaSen,
    direction: deltaSen > 0 ? "debit" : "credit",
  };
}

async function refreshUnpaidInvoiceForAttendanceChange({ req, childId, attendanceDate, action, reason, notes, actor }) {
  const normalizedDate = String(attendanceDate || "").trim();
  const match = normalizedDate.match(/^(\d{4}-\d{2})-\d{2}$/);
  if (!match) {
    return { ok: false, reason: "invalid-attendance-period" };
  }

  const period = match[1];
  const linkedInvoice = await findInvoiceForChildPeriod({ childId, period });
  if (!linkedInvoice) {
    return { ok: false, reason: "invoice-not-found-for-period", period };
  }

  const status = String(linkedInvoice.invoiceData && linkedInvoice.invoiceData.status ? linkedInvoice.invoiceData.status : "unpaid").toLowerCase();
  if (status === "paid") {
    const parentSnap = await admin.firestore().collection("parents").doc(linkedInvoice.parentId).get();
    if (!parentSnap.exists) {
      return {
        ok: false,
        reason: "parent-not-found-for-invoice",
        period,
        parentId: linkedInvoice.parentId,
        invoiceId: linkedInvoice.invoiceId,
      };
    }

    return recordPaidInvoiceAdjustmentForAttendanceChange({
      linkedInvoice,
      parentData: parentSnap.data() || {},
      childId,
      period,
      attendanceDate: normalizedDate,
      action,
      reason,
      notes,
      actor,
    });
  }

  const parentSnap = await admin.firestore().collection("parents").doc(linkedInvoice.parentId).get();
  if (!parentSnap.exists) {
    return {
      ok: false,
      reason: "parent-not-found-for-invoice",
      period,
      parentId: linkedInvoice.parentId,
      invoiceId: linkedInvoice.invoiceId,
    };
  }

  const parentData = parentSnap.data() || {};
  const calc = await buildFamilyInvoiceFromPdfPolicy({
    parentId: linkedInvoice.parentId,
    parentData,
    period,
    reqData: {},
    fallbackChildId: childId,
  });

  const refreshMetaBase = {
    source: "attendanceAdminOverride",
    action: String(action || "").trim().toUpperCase(),
    attendanceDate: normalizedDate,
    childId: String(childId || "").trim(),
    actorUid: String(actor && actor.uid ? actor.uid : ""),
    actorRole: String(actor && actor.role ? actor.role : ""),
    actorName: String(actor && actor.displayName ? actor.displayName : ""),
    reason: String(reason || "").trim(),
    notes: String(notes || "").trim(),
    previousTotalSen: moneySen(linkedInvoice.invoiceData && linkedInvoice.invoiceData.totalSen),
    refreshedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (!calc.ok) {
    if (calc.reason !== "no-billable-items") {
      return {
        ok: false,
        reason: `invoice-refresh-${String(calc.reason || "failed")}`,
        period,
        parentId: linkedInvoice.parentId,
        invoiceId: linkedInvoice.invoiceId,
      };
    }

    await linkedInvoice.invoiceRef.set({
      childId: null,
      childName: null,
      childIds: [],
      childCoverageKey: childCoverageKey(period, []),
      childNames: [],
      items: [],
      subTotalSen: 0,
      totalSen: 0,
      pricingVersion: String(linkedInvoice.invoiceData && linkedInvoice.invoiceData.pricingVersion ? linkedInvoice.invoiceData.pricingVersion : ""),
      dueDate: linkedInvoice.invoiceData && linkedInvoice.invoiceData.dueDate ? linkedInvoice.invoiceData.dueDate : null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      billingMeta: {
        ...(linkedInvoice.invoiceData && linkedInvoice.invoiceData.billingMeta && typeof linkedInvoice.invoiceData.billingMeta === "object"
          ? linkedInvoice.invoiceData.billingMeta
          : {}),
        childCount: 0,
        children: [],
        policyNotes: dedupePolicyNotes([
          "Tiada caj aktif selepas pembetulan kehadiran. Sila semak sebelum menuntut bayaran.",
        ]),
        managementReviewRecommended: false,
        managementReviewChildIds: [],
        attendanceRefresh: {
          ...refreshMetaBase,
          noBillableItems: true,
          totalSen: 0,
        },
      },
    }, { merge: true });

    return {
      ok: true,
      refreshed: true,
      noBillableItems: true,
      period,
      parentId: linkedInvoice.parentId,
      invoiceId: linkedInvoice.invoiceId,
      previousTotalSen: refreshMetaBase.previousTotalSen,
      totalSen: 0,
    };
  }

  await linkedInvoice.invoiceRef.set({
    payerType: calc.payerType,
    childId: calc.childIds.length === 1 ? calc.childIds[0] : null,
    childName: calc.childNameSummary || null,
    childIds: calc.childIds,
    childCoverageKey: childCoverageKey(period, calc.childIds),
    childNames: calc.childNames,
    items: calc.items,
    subTotalSen: calc.subTotalSen,
    totalSen: calc.totalSen,
    pricingVersion: calc.pricingVersion,
    dueDate: calc.dueDate,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    billingMeta: {
      ...(calc.billingMeta || {}),
      attendanceRefresh: {
        ...refreshMetaBase,
        noBillableItems: false,
        totalSen: moneySen(calc.totalSen),
      },
    },
  }, { merge: true });

  return {
    ok: true,
    refreshed: true,
    noBillableItems: false,
    period,
    parentId: linkedInvoice.parentId,
    invoiceId: linkedInvoice.invoiceId,
    previousTotalSen: refreshMetaBase.previousTotalSen,
    totalSen: moneySen(calc.totalSen),
  };
}

function pickDefaultTransitCode({ table, configuredCode }) {
  const rows = table && table.table ? table.table : (table || {});
  if (configuredCode && rows[configuredCode]) return configuredCode;
  if (rows.transit_2h_month) return "transit_2h_month";
  if (rows.transit_halfday_month) return "transit_halfday_month";
  if (rows.transit_schoolholiday_month) return "transit_schoolholiday_month";

  for (const code of Object.keys(rows)) {
    if (String(code).startsWith("transit_") && String(code).endsWith("_month")) {
      return code;
    }
  }
  for (const code of Object.keys(rows)) {
    if (String(code).startsWith("transit_")) return code;
  }
  return "";
}

async function loadPaymentGatewayConfig() {
  const fallback = {
    provider: "dummy",
    mode: "dummy",
    enabled: true,
    isSandbox: true,
    allowRealProvider: false,
    collectionId: "",
    checkoutBaseUrl: "",
    callbackUrl: "",
    returnUrl: "",
    cancelUrl: "",
    metadata: {},
  };

  try {
    const snap = await admin.firestore().collection("billingConfig").doc("paymentGateway").get();
    if (!snap.exists) return fallback;
    const raw = snap.data() || {};
    const provider = String(raw.provider || raw.activeProvider || fallback.provider).trim().toLowerCase() || fallback.provider;
    const mode = String(raw.mode || (provider === "dummy" ? "dummy" : "redirect")).trim().toLowerCase() || fallback.mode;
    const allowRealProvider = raw.allowRealProvider === true;
    const effectiveProvider = provider === "dummy" || allowRealProvider ? provider : fallback.provider;
    const effectiveMode = effectiveProvider === "dummy" ? "dummy" : mode;
    return {
      provider: effectiveProvider,
      mode: effectiveMode,
      enabled: raw.enabled !== false,
      isSandbox: raw.isSandbox !== false,
      allowRealProvider,
      collectionId: effectiveProvider === "dummy" ? "" : String(raw.collectionId || raw.billplzCollectionId || "").trim(),
      checkoutBaseUrl: effectiveProvider === "dummy" ? "" : String(raw.checkoutBaseUrl || "").trim(),
      callbackUrl: effectiveProvider === "dummy" ? "" : String(raw.callbackUrl || "").trim(),
      returnUrl: effectiveProvider === "dummy" ? "" : String(raw.returnUrl || "").trim(),
      cancelUrl: effectiveProvider === "dummy" ? "" : String(raw.cancelUrl || "").trim(),
      metadata: raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {},
    };
  } catch (err) {
    logger.error("payment-gateway-config-load-failed", err);
    return fallback;
  }
}

function paymentGatewaySummary(config) {
  const src = config && typeof config === "object" ? config : {};
  return {
    provider: String(src.provider || "dummy"),
    mode: String(src.mode || "dummy"),
    enabled: src.enabled !== false,
    isSandbox: src.isSandbox !== false,
    allowRealProvider: src.allowRealProvider === true,
  };
}

function firebaseProjectId() {
  if (process.env.GCLOUD_PROJECT) return String(process.env.GCLOUD_PROJECT).trim();
  if (process.env.PROJECT_ID) return String(process.env.PROJECT_ID).trim();
  try {
    const raw = process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : null;
    if (raw && raw.projectId) return String(raw.projectId).trim();
  } catch (err) {
    logger.error("firebase-project-id-parse-failed", err);
  }
  return "";
}

function defaultBillingHttpFunctionUrl(functionName) {
  const projectId = firebaseProjectId();
  if (!projectId) return "";

  const region = "asia-southeast1";
  if (String(process.env.FUNCTIONS_EMULATOR || "").toLowerCase() === "true") {
    const emulatorHost = String(process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001").trim();
    if (emulatorHost) {
      return `http://${emulatorHost}/${projectId}/${region}/${functionName}`;
    }
  }

  return `https://${region}-${projectId}.cloudfunctions.net/${functionName}`;
}

function flattenBillplzSignatureEntries(value, prefix = "") {
  if (value == null) {
    return [{ key: prefix, value: "" }];
  }

  if (Array.isArray(value)) {
    const out = [];
    for (const entry of value) {
      out.push(...flattenBillplzSignatureEntries(entry, prefix));
    }
    return out;
  }

  if (typeof value === "object") {
    const out = [];
    for (const [childKey, childValue] of Object.entries(value)) {
      out.push(...flattenBillplzSignatureEntries(childValue, `${prefix}${childKey}`));
    }
    return out;
  }

  return [{ key: prefix, value: String(value) }];
}

function computeBillplzXSignature(payload, xSignatureKey) {
  const secret = String(xSignatureKey || "").trim();
  if (!secret) return "";

  const entries = [];
  for (const [key, value] of Object.entries(payload || {})) {
    if (String(key).toLowerCase() === "x_signature") continue;
    entries.push(...flattenBillplzSignatureEntries(value, key));
  }

  const source = entries
    .map((entry) => `${entry.key}${entry.value}`)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "accent", caseFirst: "lower" }))
    .join("|");

  return crypto.createHmac("sha256", secret).update(source).digest("hex");
}

function billplzCallbackBool(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function coerceRequestPayloadMap(rawValue) {
  if (!rawValue) return {};
  if (Buffer.isBuffer(rawValue)) {
    return Object.fromEntries(new URLSearchParams(rawValue.toString("utf8")).entries());
  }
  if (typeof rawValue === "string") {
    return Object.fromEntries(new URLSearchParams(rawValue).entries());
  }
  if (typeof rawValue === "object") {
    return rawValue;
  }
  return {};
}

function normalizeBillplzCallbackPayload(input) {
  const raw = coerceRequestPayloadMap(input);
  return {
    id: String(raw.id || "").trim(),
    collection_id: String(raw.collection_id || "").trim(),
    paid: billplzCallbackBool(raw.paid),
    state: String(raw.state || "").trim(),
    amount: String(raw.amount || "").trim(),
    paid_amount: String(raw.paid_amount || "").trim(),
    due_at: String(raw.due_at || "").trim(),
    email: String(raw.email || "").trim(),
    mobile: String(raw.mobile || "").trim(),
    name: String(raw.name || "").trim(),
    url: String(raw.url || "").trim(),
    paid_at: String(raw.paid_at || "").trim(),
    transaction_id: String(raw.transaction_id || "").trim(),
    transaction_status: String(raw.transaction_status || "").trim(),
    x_signature: String(raw.x_signature || "").trim(),
  };
}

async function findBillplzSessionByBillId(billId) {
  const normalizedBillId = String(billId || "").trim();
  if (!normalizedBillId) return null;

  const db = admin.firestore();
  const providerSessionSnap = await db.collectionGroup("sessions")
    .where("providerSessionId", "==", normalizedBillId)
    .limit(1)
    .get();
  if (!providerSessionSnap.empty) return providerSessionSnap.docs[0].ref;

  const providerReferenceSnap = await db.collectionGroup("sessions")
    .where("providerReference", "==", normalizedBillId)
    .limit(1)
    .get();
  if (!providerReferenceSnap.empty) return providerReferenceSnap.docs[0].ref;

  return null;
}

function billplzCompletedAtTimestamp(value) {
  const raw = String(value || "").trim();
  if (!raw) return admin.firestore.FieldValue.serverTimestamp();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return admin.firestore.FieldValue.serverTimestamp();
  return admin.firestore.Timestamp.fromDate(parsed);
}

async function billingBillplzCallbackImpl(input) {
  const method = String((input && input.method) || "POST").trim().toUpperCase();
  if (method !== "POST") {
    return { status: 405, body: { ok: false, reason: "method-not-allowed" } };
  }

  const payload = normalizeBillplzCallbackPayload(input && input.body);
  if (!payload.id) {
    return { status: 400, body: { ok: false, reason: "missing-billplz-id" } };
  }

  const xSignatureKey = paymentGatewaySecret("BILLPLZ_X_SIGNATURE_KEY");
  if (!xSignatureKey) {
    logger.error("billplz-callback-missing-x-signature-key", { billId: payload.id });
    return { status: 503, body: { ok: false, reason: "payment-provider-not-configured" } };
  }

  const expectedSignature = computeBillplzXSignature(payload, xSignatureKey);
  const providedSignature = String(payload.x_signature || "").trim().toLowerCase();
  if (!providedSignature || !expectedSignature || providedSignature !== expectedSignature) {
    logger.error("billplz-callback-invalid-signature", {
      billId: payload.id,
      transactionId: payload.transaction_id,
    });
    return { status: 400, body: { ok: false, reason: "invalid-signature" } };
  }

  const sessionRef = await findBillplzSessionByBillId(payload.id);
  if (!sessionRef) {
    logger.error("billplz-callback-session-not-found", {
      billId: payload.id,
      transactionId: payload.transaction_id,
    });
    return { status: 404, body: { ok: false, reason: "session-not-found" } };
  }

  const invoiceRef = sessionRef.parent.parent;
  const providerPayload = {
    billId: payload.id,
    paid: payload.paid,
    state: payload.state,
    paidAt: payload.paid_at,
    transactionId: payload.transaction_id,
    transactionStatus: payload.transaction_status,
    collectionId: payload.collection_id,
    amount: payload.amount,
    paidAmount: payload.paid_amount,
    payerEmail: payload.email,
    payerMobile: payload.mobile,
    payerName: payload.name,
    url: payload.url,
    source: "billplz-callback",
  };

  if (!payload.paid || String(payload.state || "").toLowerCase() !== "paid") {
    await sessionRef.set({
      status: "pending",
      lastCallbackAt: admin.firestore.FieldValue.serverTimestamp(),
      providerPayload,
    }, { merge: true });
    return {
      status: 200,
      body: {
        ok: true,
        status: "pending",
        provider: "billplz",
        sessionId: sessionRef.id,
      },
    };
  }

  const finalized = await finalizeSuccessfulProviderPayment({
    req: null,
    actorUid: "system:billplz-callback",
    invoiceRef,
    sessionRef,
    provider: "billplz",
    method: "BILLPLZ",
    bank: null,
    externalPaymentId: payload.transaction_id || payload.id,
    externalReceiptNo: payload.id,
    providerPayload,
    completedAt: billplzCompletedAtTimestamp(payload.paid_at),
  });

  await sessionRef.set({
    lastCallbackAt: admin.firestore.FieldValue.serverTimestamp(),
    providerPayload,
  }, { merge: true });

  return {
    status: 200,
    body: {
      ...finalized,
      ok: Boolean(finalized && finalized.ok),
      status: "succeeded",
      provider: "billplz",
      sessionId: sessionRef.id,
    },
  };
}

function paymentGatewaySecret(name) {
  const normalized = String(name || "").trim().toUpperCase();
  const envValue = String(process.env[name] || process.env[normalized] || "").trim();
  if (envValue) return envValue;
  if (String(process.env.FUNCTIONS_EMULATOR || "").toLowerCase() === "true") return "";

  if (normalized === "BILLPLZ_API_KEY") {
    const secretValue = BILLPLZ_API_KEY_SECRET.value();
    if (secretValue) return String(secretValue).trim();
  }
  if (normalized === "BILLPLZ_X_SIGNATURE_KEY") {
    const secretValue = BILLPLZ_X_SIGNATURE_KEY_SECRET.value();
    if (secretValue) return String(secretValue).trim();
  }
  return "";
}

function resolvePaymentGatewayBaseUrl(config) {
  if (config && config.checkoutBaseUrl) return String(config.checkoutBaseUrl).replace(/\/+$/, "");
  if (config && config.provider === "billplz") {
    return config.isSandbox !== false ? "https://www.billplz-sandbox.com" : "https://www.billplz.com";
  }
  return "";
}

function normalizePhoneE164(phoneAny) {
  const digits = digitsOnly(phoneAny);
  if (!digits) return "";
  if (digits.startsWith("60")) return `+${digits}`;
  if (digits.startsWith("0")) return `+60${digits.slice(1)}`;
  return digits.startsWith("1") ? `+60${digits}` : `+${digits}`;
}

function basicAuthHeader(secret) {
  return `Basic ${Buffer.from(`${secret}:`).toString("base64")}`;
}

async function paymentProviderRequest({ method, url, secret, formData }) {
  const body = new URLSearchParams(formData || {}).toString();
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: basicAuthHeader(secret),
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(body ? { body } : {}),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (err) {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    text,
    json,
  };
}

function buildReceiptNo(payRef) {
  return `RCPT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${payRef.id.slice(0, 6).toUpperCase()}`;
}

const DUMMY_PAYMENT_WINDOW_MINUTES = 15;
const DUMMY_PROCESSING_DELAY_MS = 1500;
const DUMMY_FPX_BANKS = [
  "Maybank2u",
  "CIMB Clicks",
  "Bank Islam",
  "RHB Now",
  "Public Bank",
  "Hong Leong Bank",
];

function dummyProviderReference(sessionRef) {
  return `dummy-${sessionRef.id}`;
}

function dummySessionExpiryTimestamp() {
  return admin.firestore.Timestamp.fromMillis(Date.now() + (DUMMY_PAYMENT_WINDOW_MINUTES * 60 * 1000));
}

function dummySessionExpired(sess) {
  if (!sess || !sess.expiresAt || typeof sess.expiresAt.toMillis !== "function") return false;
  return sess.expiresAt.toMillis() <= Date.now();
}

function dummySessionReadyToSettle(sess) {
  const startedAt = sess && sess.processingStartedAt && typeof sess.processingStartedAt.toMillis === "function"
    ? sess.processingStartedAt.toMillis()
    : 0;
  if (!startedAt) return false;
  return startedAt + DUMMY_PROCESSING_DELAY_MS <= Date.now();
}

async function createDummyCheckoutSessionAdapter({ req, invoiceRef, inv, gatewayConfig }) {
  const totalSen = moneySen(inv.totalSen);
  const sessionRef = invoiceRef.collection("sessions").doc();
  const providerReference = dummyProviderReference(sessionRef);
  await sessionRef.set({
    provider: gatewayConfig.provider,
    mode: gatewayConfig.mode,
    status: "pending",
    currency: String(inv.currency || "MYR"),
    amountSen: totalSen,
    checkoutUrl: null,
    providerSessionId: sessionRef.id,
    providerReference,
    expiresAt: dummySessionExpiryTimestamp(),
    gatewaySummary: paymentGatewaySummary(gatewayConfig),
    providerPayload: {
      flow: "simulated-fpx",
      sessionState: "pending",
      providerReference,
      supportedBanks: DUMMY_FPX_BANKS,
      processingDelayMs: DUMMY_PROCESSING_DELAY_MS,
      paymentWindowMinutes: DUMMY_PAYMENT_WINDOW_MINUTES,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdByUid: req.auth.uid,
  });

  return {
    ok: true,
    sessionId: sessionRef.id,
    amountSen: totalSen,
    currency: String(inv.currency || "MYR"),
    provider: gatewayConfig.provider,
    mode: gatewayConfig.mode,
    checkoutUrl: null,
    status: "pending",
    paymentWindowMinutes: DUMMY_PAYMENT_WINDOW_MINUTES,
  };
}

async function createBillplzCheckoutSessionAdapter({ req, parentId, invoiceId, invoiceRef, inv, gatewayConfig }) {
  if (!gatewayConfig.enabled) {
    return { ok: false, reason: "payment-provider-disabled", provider: gatewayConfig.provider, mode: gatewayConfig.mode };
  }

  const apiKey = paymentGatewaySecret("BILLPLZ_API_KEY");
  const collectionId = String(gatewayConfig.collectionId || "").trim();
  const baseUrl = resolvePaymentGatewayBaseUrl(gatewayConfig);
  const callbackUrl = String(gatewayConfig.callbackUrl || defaultBillingHttpFunctionUrl("billingBillplzCallback")).trim();
  if (!apiKey || !collectionId || !baseUrl) {
    return {
      ok: false,
      reason: "payment-provider-not-configured",
      provider: gatewayConfig.provider,
      mode: gatewayConfig.mode,
    };
  }

  const parentSnap = await admin.firestore().collection("parents").doc(parentId).get();
  const parent = parentSnap.exists ? (parentSnap.data() || {}) : {};
  const payerName = String(parent.parentName || inv.parentName || "Taska Zurah Parent").trim() || "Taska Zurah Parent";
  const payerEmail = String(parent.email || (req.auth && req.auth.token && req.auth.token.email) || "").trim();
  const payerMobile = normalizePhoneE164(parent.phoneE164 || parent.phone || (req.auth && req.auth.token && req.auth.token.phone_number) || "");
  const amountSen = moneySen(inv.totalSen);
  const description = `Invoice ${invoiceId}${inv.period ? ` (${inv.period})` : ""}`;

  const createBill = await paymentProviderRequest({
    method: "POST",
    url: `${baseUrl}/api/v3/bills`,
    secret: apiKey,
    formData: {
      collection_id: collectionId,
      email: payerEmail,
      mobile: payerMobile,
      name: payerName,
      amount: String(amountSen),
      description,
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      ...(gatewayConfig.returnUrl ? { redirect_url: gatewayConfig.returnUrl } : {}),
      reference_1_label: "invoiceId",
      reference_1: invoiceId,
      reference_2_label: "parentId",
      reference_2: parentId,
    },
  });

  if (!createBill.ok || !createBill.json || !createBill.json.id || !createBill.json.url) {
    logger.error("billplz-create-bill-failed", {
      status: createBill.status,
      body: createBill.text,
    });
    return {
      ok: false,
      reason: "payment-provider-create-failed",
      provider: gatewayConfig.provider,
      mode: gatewayConfig.mode,
    };
  }

  const sessionRef = invoiceRef.collection("sessions").doc();
  await sessionRef.set({
    provider: gatewayConfig.provider,
    mode: gatewayConfig.mode,
    status: "pending",
    currency: String(inv.currency || "MYR"),
    amountSen,
    checkoutUrl: String(createBill.json.url || ""),
    providerSessionId: String(createBill.json.id || ""),
    providerReference: String(createBill.json.id || ""),
    gatewaySummary: paymentGatewaySummary(gatewayConfig),
    providerPayload: {
      billId: String(createBill.json.id || ""),
      url: String(createBill.json.url || ""),
      state: String(createBill.json.state || ""),
      paid: Boolean(createBill.json.paid),
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdByUid: req.auth.uid,
  });

  return {
    ok: true,
    sessionId: sessionRef.id,
    amountSen,
    currency: String(inv.currency || "MYR"),
    provider: gatewayConfig.provider,
    mode: gatewayConfig.mode,
    checkoutUrl: String(createBill.json.url || ""),
  };
}

async function createRedirectCheckoutSessionSkeleton({ gatewayConfig }) {
  return {
    ok: false,
    reason: "payment-provider-not-implemented",
    provider: gatewayConfig.provider,
    mode: gatewayConfig.mode,
  };
}

async function finalizeSuccessfulProviderPayment({ req, invoiceRef, sessionRef, provider, method, bank, externalPaymentId, externalReceiptNo, providerPayload, completedAt }) {
  const paymentsCol = invoiceRef.parent.parent.collection("payments");
  const actorUid = (req && req.auth && req.auth.uid) ? req.auth.uid : "system";

  return admin.firestore().runTransaction(async (tx) => {
    const [invSnap, sessSnap] = await Promise.all([tx.get(invoiceRef), tx.get(sessionRef)]);
    if (!invSnap.exists) return { ok: false, reason: "invoice-not-found" };
    if (!sessSnap.exists) return { ok: false, reason: "session-not-found" };

    const inv = invSnap.data() || {};
    const sess = sessSnap.data() || {};
    if (String(sess.status || "").toLowerCase() === "succeeded" || String(inv.status || "").toLowerCase() === "paid") {
      return {
        ok: true,
        already: true,
        provider,
        mode: String(sess.mode || "redirect"),
        paymentId: String(inv.paidPaymentId || sess.paymentId || ""),
        receiptNo: String(inv.paidReceiptNo || sess.providerReceiptNo || externalReceiptNo || ""),
      };
    }

    const totalSen = moneySen(inv.totalSen);
    const payRef = paymentsCol.doc();
    const receiptNo = String(externalReceiptNo || buildReceiptNo(payRef));

    tx.set(payRef, {
      provider,
      status: "succeeded",
      invoiceId: invoiceRef.id,
      currency: String(inv.currency || "MYR"),
      amountSen: totalSen,
      method,
      bank: bank || null,
      receiptNo,
      externalPaymentId: externalPaymentId || null,
      gatewaySummary: paymentGatewaySummary(sess.gatewaySummary || { provider, mode: sess.mode || "redirect" }),
      providerPayload: providerPayload || {},
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdByUid: actorUid,
    });

    tx.update(invoiceRef, {
      status: "paid",
      paidAt: completedAt || admin.firestore.FieldValue.serverTimestamp(),
      paidMethod: method,
      paidBank: bank || null,
      paidAmountSen: totalSen,
      paidReceiptNo: receiptNo,
      paidPaymentId: payRef.id,
      paidProvider: provider,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.update(sessionRef, {
      status: "succeeded",
      completedAt: completedAt || admin.firestore.FieldValue.serverTimestamp(),
      method,
      bank: bank || null,
      paymentId: payRef.id,
      providerReceiptNo: receiptNo,
      externalPaymentId: externalPaymentId || null,
      providerPayload: providerPayload || {},
    });

    return {
      ok: true,
      paymentId: payRef.id,
      receiptNo,
      provider,
      mode: String(sess.mode || "redirect"),
    };
  });
}

async function completeDummyCheckoutSessionAdapter({ req, invoiceRef, sessionRef, method, bank }) {
  return admin.firestore().runTransaction(async (tx) => {
    const [invSnap, sessSnap] = await Promise.all([tx.get(invoiceRef), tx.get(sessionRef)]);
    if (!invSnap.exists) return { ok: false, reason: "invoice-not-found" };
    if (!sessSnap.exists) return { ok: false, reason: "session-not-found" };

    const inv = invSnap.data() || {};
    const sess = sessSnap.data() || {};
    const provider = String(sess.provider || "dummy");

    if (String(inv.status || "").toLowerCase() === "paid") {
      return {
        ok: true,
        already: true,
        status: "succeeded",
        paid: true,
        paymentId: String(inv.paidPaymentId || ""),
        receiptNo: String(inv.paidReceiptNo || ""),
        provider,
        mode: String(sess.mode || "dummy"),
      };
    }

    const sessionStatus = String(sess.status || "pending").toLowerCase();
    if (sessionStatus === "succeeded") {
      return {
        ok: true,
        already: true,
        status: "succeeded",
        paid: true,
        paymentId: String(sess.paymentId || inv.paidPaymentId || ""),
        receiptNo: String(sess.providerReceiptNo || inv.paidReceiptNo || ""),
        provider,
        mode: String(sess.mode || "dummy"),
      };
    }

    if (dummySessionExpired(sess)) {
      tx.update(sessionRef, {
        status: "expired",
        expiredAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        providerPayload: {
          ...(sess.providerPayload && typeof sess.providerPayload === "object" ? sess.providerPayload : {}),
          sessionState: "expired",
          expiredBy: "complete",
        },
      });
      return {
        ok: false,
        reason: "session-expired",
        status: "expired",
        paid: false,
        provider,
        mode: String(sess.mode || "dummy"),
      };
    }

    if (sessionStatus === "processing") {
      return {
        ok: true,
        status: "processing",
        paid: false,
        provider,
        mode: String(sess.mode || "dummy"),
        pollAfterMs: DUMMY_PROCESSING_DELAY_MS,
      };
    }

    if (sessionStatus !== "pending") {
      return { ok: false, reason: "session-not-pending", status: sessionStatus, provider, mode: String(sess.mode || "dummy") };
    }

    const externalPaymentId = `dummy-pay-${sessionRef.id}`;
    tx.update(sessionRef, {
      status: "processing",
      processingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
      method,
      bank: bank || null,
      externalPaymentId,
      providerPayload: {
        ...(sess.providerPayload && typeof sess.providerPayload === "object" ? sess.providerPayload : {}),
        sessionState: "processing",
        paymentMethod: method,
        bank: bank || null,
        externalPaymentId,
        authorizedByUid: req.auth.uid,
      },
    });

    return {
      ok: true,
      status: "processing",
      paid: false,
      provider,
      mode: String(sess.mode || "dummy"),
      pollAfterMs: DUMMY_PROCESSING_DELAY_MS,
    };
  });
}

async function completeRedirectCheckoutSessionSkeleton({ sessionRef }) {
  const sessSnap = await sessionRef.get();
  if (!sessSnap.exists) return { ok: false, reason: "session-not-found" };
  const sess = sessSnap.data() || {};
  return {
    ok: false,
    reason: "payment-provider-not-implemented",
    provider: String(sess.provider || "unknown"),
    mode: String(sess.mode || "redirect"),
  };
}

async function syncBillplzCheckoutSessionAdapter({ req, invoiceRef, sessionRef }) {
  const sessSnap = await sessionRef.get();
  if (!sessSnap.exists) return { ok: false, reason: "session-not-found" };
  const sess = sessSnap.data() || {};
  const billId = String(sess.providerSessionId || sess.providerReference || "").trim();
  if (!billId) return { ok: false, reason: "payment-session-missing-provider-id" };

  const apiKey = paymentGatewaySecret("BILLPLZ_API_KEY");
  const gatewaySummary = sess.gatewaySummary && typeof sess.gatewaySummary === "object" ? sess.gatewaySummary : { provider: "billplz", mode: "redirect" };
  const baseUrl = resolvePaymentGatewayBaseUrl({ provider: "billplz", isSandbox: gatewaySummary.isSandbox !== false, checkoutBaseUrl: "" });
  if (!apiKey || !baseUrl) {
    return { ok: false, reason: "payment-provider-not-configured", provider: "billplz", mode: String(sess.mode || "redirect") };
  }

  const bill = await paymentProviderRequest({
    method: "GET",
    url: `${baseUrl}/api/v3/bills/${billId}`,
    secret: apiKey,
  });

  if (!bill.ok || !bill.json) {
    logger.error("billplz-fetch-bill-failed", {
      status: bill.status,
      body: bill.text,
      billId,
    });
    return { ok: false, reason: "payment-provider-sync-failed", provider: "billplz", mode: String(sess.mode || "redirect") };
  }

  const paid = Boolean(bill.json.paid);
  const payload = {
    billId: String(bill.json.id || billId),
    paid,
    state: String(bill.json.state || ""),
    paidAt: String(bill.json.paid_at || ""),
    transactionId: String(bill.json.transaction_id || ""),
  };

  if (!paid) {
    await sessionRef.set({
      providerPayload: payload,
      lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return {
      ok: true,
      status: "pending",
      paid: false,
      provider: "billplz",
      mode: String(sess.mode || "redirect"),
    };
  }

  const paidAt = bill.json.paid_at ? admin.firestore.Timestamp.fromDate(new Date(bill.json.paid_at)) : admin.firestore.FieldValue.serverTimestamp();
  const finalized = await finalizeSuccessfulProviderPayment({
    req,
    invoiceRef,
    sessionRef,
    provider: "billplz",
    method: "BILLPLZ",
    bank: null,
    externalPaymentId: String(bill.json.transaction_id || bill.json.id || billId),
    externalReceiptNo: String(bill.json.id || billId),
    providerPayload: payload,
    completedAt: paidAt,
  });

  return {
    ...finalized,
    status: "succeeded",
    paid: true,
  };
}

async function syncDummyCheckoutSessionAdapter({ req, invoiceRef, sessionRef }) {
  const [invSnap, sessSnap] = await Promise.all([invoiceRef.get(), sessionRef.get()]);
  if (!invSnap.exists) return { ok: false, reason: "invoice-not-found" };
  if (!sessSnap.exists) return { ok: false, reason: "session-not-found" };
  const inv = invSnap.data() || {};
  const sess = sessSnap.data() || {};
  const provider = String(sess.provider || "dummy");
  const mode = String(sess.mode || "dummy");
  const status = String(sess.status || "pending").toLowerCase();

  if (String(inv.status || "").toLowerCase() === "paid" || status === "succeeded") {
    return {
      ok: true,
      status: "succeeded",
      paid: true,
      provider,
      mode,
      paymentId: String(inv.paidPaymentId || sess.paymentId || ""),
      receiptNo: String(inv.paidReceiptNo || sess.providerReceiptNo || ""),
    };
  }

  if (dummySessionExpired(sess)) {
    await sessionRef.set({
      status: "expired",
      expiredAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
      providerPayload: {
        ...(sess.providerPayload && typeof sess.providerPayload === "object" ? sess.providerPayload : {}),
        sessionState: "expired",
        expiredBy: "sync",
      },
    }, { merge: true });
    return {
      ok: true,
      status: "expired",
      paid: false,
      provider,
      mode,
    };
  }

  if (status === "processing" && dummySessionReadyToSettle(sess)) {
    const providerPayload = {
      ...(sess.providerPayload && typeof sess.providerPayload === "object" ? sess.providerPayload : {}),
      sessionState: "succeeded",
      settledAt: new Date().toISOString(),
    };
    const finalized = await finalizeSuccessfulProviderPayment({
      req,
      invoiceRef,
      sessionRef,
      provider,
      method: String(sess.method || "FPX"),
      bank: sess.bank || null,
      externalPaymentId: String(sess.externalPaymentId || sess.providerReference || sessionRef.id),
      externalReceiptNo: String(sess.providerReference || sessionRef.id),
      providerPayload,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await sessionRef.set({
      lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
      providerPayload,
    }, { merge: true });
    return {
      ...finalized,
      status: "succeeded",
      paid: true,
      provider,
      mode,
    };
  }

  return {
    ok: true,
    status,
    paid: false,
    provider,
    mode,
  };
}

const paymentAdapters = {
  dummy: {
    createSession: createDummyCheckoutSessionAdapter,
    completeSession: completeDummyCheckoutSessionAdapter,
    syncSession: syncDummyCheckoutSessionAdapter,
  },
  billplz: {
    createSession: createBillplzCheckoutSessionAdapter,
    completeSession: completeRedirectCheckoutSessionSkeleton,
    syncSession: syncBillplzCheckoutSessionAdapter,
  },
};

function paymentAdapterFor(config) {
  const provider = String(config && config.provider ? config.provider : "dummy").toLowerCase();
  return paymentAdapters[provider] || paymentAdapters.dummy;
}

function assertInvoiceCatalogReady({ table, defaultTransitCode }) {
  const rows = table && table.table ? table.table : (table || {});
  const missing = BILLING_REQUIRED_CODES.filter((code) => !rows[code]);
  const hasTransitMonthly = Object.keys(rows).some((code) => code.startsWith("transit_") && code.endsWith("_month"));

  if (!hasTransitMonthly) {
    missing.push("transit_*_month");
  }

  if (!defaultTransitCode || !rows[defaultTransitCode]) {
    missing.push(`defaultTransitMonthlyCode:${defaultTransitCode || "<empty>"}`);
  }

  if (missing.length > 0) {
    throw callableError(`billing-catalog-missing-required-codes:${missing.join(",")}`, "failed-precondition");
  }
}

function careTypeToCode({ careType, feePlan, ageBand, defaultTransitCode }) {
  const v = String(careType || "").trim().toLowerCase();
  const fp = String(feePlan || "").trim().toLowerCase();
  if (v === "fulltime") {
    return ageBand === "3m_2y" ? "monthly_fulltime_3m_2y" : "monthly_fulltime_2y_4y";
  }
  if (v === "transit") return defaultTransitCode || "transit_2h_month";
  if (v === "transit_halfday_month") return "transit_halfday_month";
  if (v === "transit_2h_month") return "transit_2h_month";
  if (v === "transit_schoolholiday_month") return "transit_schoolholiday_month";
  if (v === "transit_1day") return "transit_1day";
  if (v === "transit_1week") return "transit_1week";
  if (v === "transit_1hour") return "transit_1hour";
  if (fp === "transit") return defaultTransitCode || "transit_2h_month";
  if (fp === "monthly") return ageBand === "3m_2y" ? "monthly_fulltime_3m_2y" : "monthly_fulltime_2y_4y";
  return ageBand === "3m_2y" ? "monthly_fulltime_3m_2y" : "monthly_fulltime_2y_4y";
}

function numericHoursOrNull(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function billingHintsForChild(child, reqData) {
  const req = reqData && typeof reqData === "object" ? reqData : {};
  const childId = child && child.id ? String(child.id).trim() : "";
  const byChild = req.billingHintsByChild && typeof req.billingHintsByChild === "object"
    ? req.billingHintsByChild
    : null;

  if (byChild && childId && byChild[childId] && typeof byChild[childId] === "object") {
    return byChild[childId];
  }
  return req;
}

function attendanceTimestampToDate(raw) {
  if (!raw) return null;
  const dt = raw.toDate ? raw.toDate() : new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function attendanceDateKey(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function attendanceIsoWeekKey(dt) {
  const utc = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function transitUsageFromAttendanceRows(rows) {
  const dayKeys = new Set();
  const weekKeys = new Set();
  const hoursByDay = new Map();
  let totalHours = 0;

  for (const r of rows || []) {
    const inRaw = r.check_in_time || r.checkInTime || r.checkinTime || null;
    const outRaw = r.check_out_time || r.checkOutTime || r.checkoutTime || null;
    const checkIn = attendanceTimestampToDate(inRaw);
    const checkOut = attendanceTimestampToDate(outRaw);
    const anchor = checkIn || checkOut;

    if (anchor) {
      dayKeys.add(attendanceDateKey(anchor));
      weekKeys.add(attendanceIsoWeekKey(anchor));
    }

    if (checkIn && checkOut) {
      const rawHours = (checkOut.getTime() - checkIn.getTime()) / (60 * 60 * 1000);
      if (Number.isFinite(rawHours) && rawHours > 0) {
        totalHours += rawHours;
        const dayKey = attendanceDateKey(anchor || checkIn);
        hoursByDay.set(dayKey, Number(hoursByDay.get(dayKey) || 0) + rawHours);
      }
    }
  }

  const distinctAttendanceDays = dayKeys.size;
  const averageDailyHours = distinctAttendanceDays > 0 ? totalHours / distinctAttendanceDays : 0;
  let maxDailyHours = 0;
  for (const value of hoursByDay.values()) {
    if (Number.isFinite(value) && value > maxDailyHours) {
      maxDailyHours = value;
    }
  }

  return {
    dayCount: dayKeys.size,
    weekCount: weekKeys.size,
    hourCount: Math.max(0, Math.ceil(totalHours)),
    totalHours,
    averageDailyHours,
    maxDailyHours,
  };
}

function resolveTransitDurationCode({ child, reqData, transitUsage, defaultTransitCode }) {
  const hints = billingHintsForChild(child, reqData);
  const explicitDurationHours = numericHoursOrNull(
    hints.careDurationHours
    || hints.transitDurationHours
    || (child && (child.careDurationHours || child.transitDurationHours || child.dailyCareHours))
  );
  const attendanceDurationHours = numericHoursOrNull(transitUsage && transitUsage.averageDailyHours);
  const resolvedDurationHours = explicitDurationHours != null ? explicitDurationHours : attendanceDurationHours;

  if (resolvedDurationHours != null) {
    return resolvedDurationHours <= 2.25 ? "transit_2h_month" : "transit_halfday_month";
  }

  return defaultTransitCode || "transit_2h_month";
}

function resolveTransitMonthlyCode({ child, reqData, transitUsage, defaultTransitCode, months }) {
  const hints = billingHintsForChild(child, reqData);
  const requestedSchoolHoliday = Boolean(
    hints.schoolHolidayTransit
    || hints.isSchoolHolidayTransit
    || (child && (child.schoolHolidayTransit || child.isSchoolHolidayTransit || child.transitSchoolHoliday))
  );
  if (requestedSchoolHoliday && Number.isFinite(Number(months)) && Number(months) >= 48) {
    return "transit_schoolholiday_month";
  }

  return resolveTransitDurationCode({ child, reqData, transitUsage, defaultTransitCode });
}

function resolveBillingBaseCode({ child, feePlan, careType, ageBand, defaultTransitCode, transitUsage, reqData, months }) {
  const normalizedCareType = String(careType || "").trim().toLowerCase();
  const normalizedFeePlan = String(feePlan || "").trim().toLowerCase();

  if ([
    "transit_halfday_month",
    "transit_2h_month",
    "transit_1day",
    "transit_1week",
    "transit_1hour",
  ].includes(normalizedCareType)) {
    return normalizedCareType;
  }

  if ("transit_schoolholiday_month" === normalizedCareType) {
    return Number.isFinite(Number(months)) && Number(months) >= 48
      ? normalizedCareType
      : resolveTransitDurationCode({ child, reqData, transitUsage, defaultTransitCode });
  }

  if (normalizedCareType === "fulltime" || normalizedFeePlan === "monthly") {
    return ageBand === "3m_2y" ? "monthly_fulltime_3m_2y" : "monthly_fulltime_2y_4y";
  }

  if (normalizedCareType === "transit"
      || normalizedFeePlan === "transit") {
    return resolveTransitMonthlyCode({ child, reqData, transitUsage, defaultTransitCode, months });
  }

  return careTypeToCode({ careType: normalizedCareType, feePlan: normalizedFeePlan, ageBand, defaultTransitCode });
}

function buildBaseFeeItem({ baseCode, unitPriceSen, transitUsage }) {
  if (unitPriceSen == null) return null;

  if (baseCode === "transit_1day") {
    const qty = Number(transitUsage && transitUsage.dayCount ? transitUsage.dayCount : 0);
    if (qty <= 0) return null;
    return {
      code: baseCode,
      description: "Transit 1 Hari",
      qty,
      unit: "day",
      unitPriceSen,
      amountSen: unitPriceSen * qty,
    };
  }

  if (baseCode === "transit_1week") {
    const qty = Number(transitUsage && transitUsage.weekCount ? transitUsage.weekCount : 0);
    if (qty <= 0) return null;
    return {
      code: baseCode,
      description: "Transit 1 Minggu",
      qty,
      unit: "week",
      unitPriceSen,
      amountSen: unitPriceSen * qty,
    };
  }

  if (baseCode === "transit_1hour") {
    const qty = Number(transitUsage && transitUsage.hourCount ? transitUsage.hourCount : 0);
    if (qty <= 0) return null;
    return {
      code: baseCode,
      description: "Transit 1 Jam",
      qty,
      unit: "hour",
      unitPriceSen,
      amountSen: unitPriceSen * qty,
    };
  }

  return {
    code: baseCode,
    description: baseCode.startsWith("transit_") ? "Yuran Transit" : "Yuran Asas Bulanan",
    qty: 1,
    unit: "month",
    unitPriceSen,
    amountSen: unitPriceSen,
  };
}

function uniformItemForPeriod({ child, months, periodKey, isRegistrationMonth }) {
  if (!child) return null;

  const uniformFeeSen = moneySen(child.uniformFeeSen);
  if (uniformFeeSen <= 0) return null;

  if (months == null || months < 36 || months >= 60) return null;

  const configuredPeriod = String(child.uniformChargePeriod || "").trim();
  const appliedPeriod = String(child.uniformFeeAppliedPeriod || "").trim();
  const shouldCharge = configuredPeriod ? configuredPeriod === periodKey : isRegistrationMonth;
  if (!shouldCharge || appliedPeriod === periodKey) return null;

  return {
    code: "uniform_current_price",
    description: String(child.uniformFeeDescription || "").trim() || "Uniform Taska (3 & 4 tahun)",
    qty: 1,
    unit: "oneoff",
    unitPriceSen: uniformFeeSen,
    amountSen: uniformFeeSen,
  };
}

function dedupePolicyNotes(notes) {
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

function overtimeBucketsFromAttendanceRows(rows) {
  let hAfter530 = 0;
  let h8to12 = 0;
  let h12to7 = 0;
  const lateNightDays = new Set();
  const overnightDays = new Set();

  for (const r of rows || []) {
    const outRaw = r.check_out_time || r.checkOutTime || r.checkoutTime || null;
    if (!outRaw) continue;
    const out = outRaw.toDate ? outRaw.toDate() : new Date(outRaw);
    if (Number.isNaN(out.getTime())) continue;

    const hh = out.getHours() + (out.getMinutes() / 60);
    if (hh > 17.5 && hh <= 20) {
      hAfter530 += (hh - 17.5);
    } else if (hh > 20 && hh < 24) {
      hAfter530 += 2.5;
      h8to12 += (hh - 20);
      lateNightDays.add(attendanceDateKey(out));
    } else if (hh >= 0 && hh < 7) {
      h12to7 += hh;
      overnightDays.add(attendanceDateKey(out));
    }
  }

  return {
    after530Hours: Math.max(0, Math.ceil(hAfter530)),
    h8to12Hours: Math.max(0, Math.ceil(h8to12)),
    h12to7Hours: Math.max(0, Math.ceil(h12to7)),
    lateNightOccurrences: lateNightDays.size,
    overnightOccurrences: overnightDays.size,
    managementReviewRecommended: lateNightDays.size > 10 || overnightDays.size > 10,
  };
}

async function buildInvoiceItemsFromPdfPolicy({ parentId, childId, period, reqData, payerType }) {
  const table = await loadActiveFeeCatalog();
  const now = new Date();
  const periodDate = new Date(now.getFullYear(), now.getMonth(), 1);
  if (period) {
    const m = String(period).match(/^(\d{4})-(\d{2})$/);
    if (m) periodDate.setFullYear(Number(m[1]), Number(m[2]) - 1, 1);
  }

  let child = null;
  if (childId) {
    const childSnap = await admin.firestore().collection("children").doc(childId).get();
    if (childSnap.exists) child = childSnap.data() || {};
  }

  const childName = child ? String(child.name || child.childName || "").trim() : "";
  const dob = child ? parseIsoDateOnly(child.birthDate) : null;
  const months = dob ? ageInMonths(periodDate, dob) : null;
  const defaultAgeProfile = resolveAgeProfile(months);
  const ageBand = defaultAgeProfile.ageBand;
  // Authoritative payer type is derived from child.staffChild (admin-selected simple toggle).
  // Legacy fallback keeps older data working if the flag is missing.
  const effectivePayerType = (child && typeof child.staffChild === "boolean")
    ? (child.staffChild ? "staff" : "nonstaff")
    : payerType;

  const feePlan = child ? String(child.feePlan || "").trim().toLowerCase() : "";
  const careType = child ? String(child.careType || "fulltime") : "fulltime";
  const defaultTransitCode = pickDefaultTransitCode({
    table,
    configuredCode: sanitizeTransitCode(table.defaultTransitMonthlyCode),
  });
  assertInvoiceCatalogReady({ table, defaultTransitCode });
  let attendanceRows = [];
  try {
    if (childId) {
      const s = startOfMonth(periodDate);
      const e = endOfMonth(periodDate);
      const att = await admin.firestore().collection("attendance")
        .where("childId", "==", childId)
        .where("date", ">=", s)
        .where("date", "<=", e)
        .get();
      attendanceRows = att.docs.map((d) => d.data() || {});
    }
  } catch (err) {
    logger.error("attendance-fetch-failed", err);
  }

  const transitUsage = transitUsageFromAttendanceRows(attendanceRows);
  const baseCode = resolveBillingBaseCode({
    child: child ? { ...child, id: childId } : null,
    feePlan,
    careType,
    ageBand,
    defaultTransitCode,
    transitUsage,
    reqData,
    months,
  });
  const ageProfile = resolveBillingAgePolicy({ months, baseCode });
  const items = [];
  const periodKey = period || monthKey(now);

  const registrationType = baseCode.startsWith("monthly_") ? "fulltime" : "transit";
  const regCode = registrationType === "transit"
    ? "registration_transit_oneoff"
    : "registration_fulltime_oneoff";
  const isRegistrationMonth = registrationChargeRequired(child, periodKey);

  if (isRegistrationMonth) {
    const regSen = priceFor({ table, code: regCode, payerType: effectivePayerType });
    if (regSen != null) {
      items.push({
        code: regCode,
        description: registrationType === "transit"
          ? "Yuran Pendaftaran Transit (Kiraan bulan pendaftaran)"
          : "Yuran Pendaftaran Sepenuh Masa (Kiraan bulan pendaftaran)",
        qty: 1,
        unit: "oneoff",
        unitPriceSen: regSen,
        amountSen: regSen,
      });
    }
  } else {
    const baseSen = priceFor({ table, code: baseCode, payerType: effectivePayerType });
    const baseItem = buildBaseFeeItem({ baseCode, unitPriceSen: baseSen, transitUsage });
    if (baseItem) {
      items.push(baseItem);
    }
  }

  const periodMonth = monthNumberFromPeriod(periodKey);

  if (periodMonth === 1) {
    const annualSen = priceFor({ table, code: "annual_fee_yearly", payerType: effectivePayerType });
    if (annualSen != null) {
      items.push({
        code: "annual_fee_yearly",
        description: "Yuran Tahunan",
        qty: 1,
        unit: "year",
        unitPriceSen: annualSen,
        amountSen: annualSen,
      });
    }
  }

  if (periodMonth === 1 || periodMonth === 5 || periodMonth === 9) {
    const bookSen = priceFor({ table, code: "comms_book_4months", payerType: effectivePayerType });
    if (bookSen != null) {
      items.push({
        code: "comms_book_4months",
        description: "Buku Komunikasi (4 bulan)",
        qty: 1,
        unit: "4months",
        unitPriceSen: bookSen,
        amountSen: bookSen,
      });
    }
  }

  if (periodMonth === 1 && months != null && months >= 24) {
    const insSen = priceFor({ table, code: "insurance_yearly_age2plus", payerType: effectivePayerType });
    if (insSen != null) {
      items.push({
        code: "insurance_yearly_age2plus",
        description: "Insurans Tahunan (Umur 2 tahun ke atas)",
        qty: 1,
        unit: "year",
        unitPriceSen: insSen,
        amountSen: insSen,
      });
    }
  }

  if (child && child.transportFromTadika === true) {
    const tSen = priceFor({ table, code: "transport_tadika_month", payerType: effectivePayerType });
    if (tSen != null) {
      items.push({
        code: "transport_tadika_month",
        description: "Pengangkutan Dari Tadika",
        qty: 1,
        unit: "month",
        unitPriceSen: tSen,
        amountSen: tSen,
      });
    }
  }

  const uniformItem = uniformItemForPeriod({ child, months, periodKey, isRegistrationMonth });
  if (uniformItem) {
    items.push(uniformItem);
  }

  let overtime = {
    after530Hours: 0,
    h8to12Hours: 0,
    h12to7Hours: 0,
  };

  overtime = overtimeBucketsFromAttendanceRows(attendanceRows);

  const mOver = (reqData && reqData.manualOvertime) ? reqData.manualOvertime : null;
  if (mOver && typeof mOver === "object") {
    overtime = {
      after530Hours: Number.isFinite(Number(mOver.after530Hours)) ? Math.max(0, Math.round(Number(mOver.after530Hours))) : overtime.after530Hours,
      h8to12Hours: Number.isFinite(Number(mOver.h8to12Hours)) ? Math.max(0, Math.round(Number(mOver.h8to12Hours))) : overtime.h8to12Hours,
      h12to7Hours: Number.isFinite(Number(mOver.h12to7Hours)) ? Math.max(0, Math.round(Number(mOver.h12to7Hours))) : overtime.h12to7Hours,
    };
  }

  const otMap = [
    { code: "overtime_after_530", label: "Lebih Masa Selepas 5:30 PM", qty: overtime.after530Hours },
    { code: "overtime_8pm_12am", label: "Lebih Masa 8:00 PM - 12:00 AM", qty: overtime.h8to12Hours },
    { code: "overtime_12am_7am", label: "Lebih Masa 12:00 AM - 7:00 AM", qty: overtime.h12to7Hours },
  ];
  for (const row of otMap) {
    if (!row.qty || row.qty <= 0) continue;
    const unitPriceSen = priceFor({ table, code: row.code, payerType: effectivePayerType });
    if (unitPriceSen == null) continue;
    items.push({
      code: row.code,
      description: row.label,
      qty: row.qty,
      unit: "hour",
      unitPriceSen,
      amountSen: unitPriceSen * row.qty,
    });
  }

  const absenceAdjustment = childAbsenceAdjustmentForPeriod(child ? { ...child, id: childId } : null, periodKey, reqData);
  const absDays = Number(absenceAdjustment.absenceDaysWithLetter || 0);
  const hasLetter = Boolean(absenceAdjustment.hasAbsenceLetter);
  if (hasLetter && Number.isFinite(absDays) && absDays > 14) {
    const baseItem = items.find((i) => i && i.code && (i.code.startsWith("monthly_") || i.code.startsWith("transit_")));
    if (baseItem && Number(baseItem.amountSen) > 0) {
      const discountSen = Math.round(Number(baseItem.amountSen) * 0.10);
      if (discountSen > 0) {
        items.push({
          code: "discount_absence_14days",
          description: "Potongan 10% (Tidak Hadir >14 Hari + Surat)",
          qty: 1,
          unit: "discount",
          unitPriceSen: -discountSen,
          amountSen: -discountSen,
        });
      }
    }
  }

  const subTotalSen = items.reduce((a, b) => a + moneySen(b.amountSen), 0);
  const totalSen = moneySen(subTotalSen);
  const dueDayRaw = child && Number.isFinite(Number(child.billingDueDay)) ? Number(child.billingDueDay) : 7;
  const dueDay = dueDayRaw === 5 ? 5 : 7;
  const dueDate = new Date(periodDate.getFullYear(), periodDate.getMonth(), dueDay, 23, 59, 59);
  const policyNotes = dedupePolicyNotes([
    isRegistrationMonth
      ? "Bayaran pendaftaran dan bayaran ketika mendaftar tidak akan dikembalikan."
      : null,
    uniformItem
      ? "Uniform dikenakan sebagai caj semasa untuk kanak-kanak 3 dan 4 tahun."
      : null,
    hasLetter && Number.isFinite(absDays) && absDays > 14
      ? "Potongan 10% telah digunakan kerana tidak hadir melebihi 14 hari dengan surat."
      : null,
    overtime.managementReviewRecommended
      ? "Lebih masa selepas 8:00 malam atau selepas 12:00 malam melebihi 10 hari dan wajar disemak atas budi bicara pengurusan."
      : null,
  ]);

  if (ageProfile.agePolicyReason === "school_holiday_requires_age_4_plus") {
    policyNotes.unshift("Transit penuh cuti sekolah hanya dibenarkan untuk umur 4 tahun ke atas.");
  } else if (ageProfile.agePolicyReason === "school_holiday_requires_known_age") {
    policyNotes.unshift("Tarikh lahir diperlukan untuk menggunakan transit penuh cuti sekolah.");
  } else if (ageProfile.ageOutOfPolicy) {
    policyNotes.unshift("Umur kanak-kanak berada di luar julat yuran PDF (3 bulan hingga bawah 4 tahun). Invois ini menggunakan kadar terdekat dan perlu disemak secara manual.");
  }

  return {
    child,
    childName,
    table,
    payerType: effectivePayerType,
    items,
    subTotalSen,
    totalSen,
    dueDate,
    dueDay,
    meta: {
      careType,
      ageBand,
      months,
      registrationMonth: isRegistrationMonth,
      transitUsage,
      uniformCharged: Boolean(uniformItem),
      policyNotes,
      managementReviewRecommended: Boolean(overtime.managementReviewRecommended || ageProfile.ageOutOfPolicy),
      overtime,
      absenceAdjustment,
      resolvedBaseCode: baseCode,
      ageOutOfPolicy: Boolean(ageProfile.ageOutOfPolicy),
      agePolicyReason: ageProfile.agePolicyReason,
      resolvedAgeBand: ageBand,
    },
  };
}

exports.billingCreateDemoInvoiceForCurrentMonth = onCall({ region: "asia-southeast1" }, async (req) => {
  requireAuth(req);
  const parentId = (req.data && req.data.parentId) ? String(req.data.parentId).trim() : "";
  const childId = (req.data && req.data.childId) ? String(req.data.childId).trim() : "";
  if (!parentId) return { ok: false, reason: "missing-parentId" };

  const { parentData } = await assertParentOwnerByPhone({ parentId, authToken: req.auth.token });
  const period = monthKey(new Date());
  return createParentInvoiceForPeriod({
    req,
    parentId,
    parentData,
    period,
    reqData: req.data || {},
    createdByKind: "parent-demo",
    fallbackChildId: childId,
  });
});

exports.billingAdminGenerateInvoicesForPeriod = onCall({ region: "asia-southeast1" }, async (req) => {
  try {
    requireAdmin(req);

    const requestedPeriod = (req.data && req.data.period) ? String(req.data.period).trim() : monthKey(new Date());
    const period = /^\d{4}-\d{2}$/.test(requestedPeriod) ? requestedPeriod : monthKey(new Date());
    const parentIds = Array.isArray(req.data && req.data.parentIds)
      ? req.data.parentIds.map((v) => String(v || "").trim()).filter(Boolean)
      : [];

    const requestedParents = parentIds.length
      ? await Promise.all(parentIds.map(async (parentId) => {
        const snap = await admin.firestore().collection("parents").doc(parentId).get();
        return snap.exists ? snap : null;
      }))
      : (await admin.firestore().collection("parents").get()).docs;

    const summary = {
      ok: true,
      period,
      createdCount: 0,
      existingCount: 0,
      skippedNoChildrenCount: 0,
      skippedNoItemsCount: 0,
      errorCount: 0,
      results: [],
    };

    for (const snap of requestedParents) {
      if (!snap || !snap.exists) {
        continue;
      }

      const parentId = snap.id;
      const parentData = snap.data() || {};

      try {
        const created = await createParentInvoiceForPeriod({
          req,
          parentId,
          parentData,
          period,
          reqData: req.data || {},
          createdByKind: "admin-batch",
        });

        if (created.already) {
          summary.existingCount += 1;
        } else if (created.ok) {
          summary.createdCount += 1;
        } else if (created.reason === "no-linked-children") {
          summary.skippedNoChildrenCount += 1;
        } else if (created.reason === "no-billable-items") {
          summary.skippedNoItemsCount += 1;
        } else {
          summary.errorCount += 1;
        }

        summary.results.push({
          parentId,
          parentName: String(parentData.parentName || parentData.name || ""),
          ...created,
        });
      } catch (err) {
        summary.errorCount += 1;
        summary.results.push({
          parentId,
          parentName: String(parentData.parentName || parentData.name || ""),
          ...billingCallableFailureFromError(err),
        });
        logger.error("billing-admin-generate-invoice-failed", { parentId, period, error: String(err && err.message ? err.message : err) });
      }
    }

    return summary;
  } catch (err) {
    logger.error("billing-admin-generate-invoices-for-period-failed", err);
    return billingCallableFailureFromError(err);
  }
});

async function billingCreateCheckoutSessionImpl(req) {
  requireAuth(req);
  const parentId = (req.data && req.data.parentId) ? String(req.data.parentId).trim() : "";
  const invoiceId = (req.data && req.data.invoiceId) ? String(req.data.invoiceId).trim() : "";
  if (!parentId || !invoiceId) return { ok: false, reason: "missing-args" };

  await assertParentOwnerByPhone({ parentId, authToken: req.auth.token });

  const invoiceRef = admin.firestore().collection("parents").doc(parentId).collection("invoices").doc(invoiceId);
  const invoiceSnap = await invoiceRef.get();
  if (!invoiceSnap.exists) return { ok: false, reason: "invoice-not-found" };

  let inv = invoiceSnap.data() || {};
  if (String(inv.status || "").toLowerCase() !== "paid") {
    const repaired = await repairInvoiceFromEquivalentPaidCopy({ invoiceRef, invoiceData: inv });
    inv = repaired.invoiceData || inv;
  }
  const status = String(inv.status || "").toLowerCase();
  if (status === "paid") return { ok: false, reason: "already-paid" };

  const gatewayConfig = await loadPaymentGatewayConfig();
  const adapter = paymentAdapterFor(gatewayConfig);
  return adapter.createSession({ req, parentId, invoiceId, invoiceRef, inv, gatewayConfig });
}

async function billingCompleteCheckoutSessionImpl(req) {
  requireAuth(req);
  const parentId = (req.data && req.data.parentId) ? String(req.data.parentId).trim() : "";
  const invoiceId = (req.data && req.data.invoiceId) ? String(req.data.invoiceId).trim() : "";
  const sessionId = (req.data && req.data.sessionId) ? String(req.data.sessionId).trim() : "";
  const method = (req.data && req.data.method) ? String(req.data.method).trim() : "FPX";
  const bank = (req.data && req.data.bank) ? String(req.data.bank).trim() : "";
  if (!parentId || !invoiceId || !sessionId) return { ok: false, reason: "missing-args" };

  await assertParentOwnerByPhone({ parentId, authToken: req.auth.token });

  const invoiceRef = admin.firestore().collection("parents").doc(parentId).collection("invoices").doc(invoiceId);
  const sessionRef = invoiceRef.collection("sessions").doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) return { ok: false, reason: "session-not-found" };
  const session = sessionSnap.data() || {};
  const adapter = paymentAdapterFor(session.gatewaySummary || { provider: session.provider || "dummy" });
  return adapter.completeSession({ req, parentId, invoiceId, sessionId, invoiceRef, sessionRef, method, bank });
}

async function billingSyncCheckoutSessionImpl(req) {
  requireAuth(req);
  const parentId = (req.data && req.data.parentId) ? String(req.data.parentId).trim() : "";
  const invoiceId = (req.data && req.data.invoiceId) ? String(req.data.invoiceId).trim() : "";
  const sessionId = (req.data && req.data.sessionId) ? String(req.data.sessionId).trim() : "";
  if (!parentId || !invoiceId || !sessionId) return { ok: false, reason: "missing-args" };

  await assertParentOwnerByPhone({ parentId, authToken: req.auth.token });

  const invoiceRef = admin.firestore().collection("parents").doc(parentId).collection("invoices").doc(invoiceId);
  const sessionRef = invoiceRef.collection("sessions").doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) return { ok: false, reason: "session-not-found" };
  const session = sessionSnap.data() || {};
  const adapter = paymentAdapterFor(session.gatewaySummary || { provider: session.provider || "dummy" });
  if (typeof adapter.syncSession !== "function") {
    return { ok: false, reason: "payment-provider-sync-not-supported" };
  }
  return adapter.syncSession({ req, parentId, invoiceId, sessionId, invoiceRef, sessionRef });
}

exports.billingCreateCheckoutSession = onCall({
  region: "asia-southeast1",
  secrets: [BILLPLZ_API_KEY_SECRET],
}, async (req) => {
  return billingCreateCheckoutSessionImpl(req);
});

exports.billingCreateDummyCheckoutSession = onCall({ region: "asia-southeast1" }, async (req) => {
  return billingCreateCheckoutSessionImpl(req);
});

exports.billingCreateDemoCheckoutSession = exports.billingCreateDummyCheckoutSession;

exports.billingRepairInvoiceStatus = onCall({ region: "asia-southeast1" }, async (req) => {
  requireAuth(req);
  const parentId = (req.data && req.data.parentId) ? String(req.data.parentId).trim() : "";
  const invoiceId = (req.data && req.data.invoiceId) ? String(req.data.invoiceId).trim() : "";
  if (!parentId || !invoiceId) return { ok: false, reason: "missing-args" };

  await assertParentOwnerByPhone({ parentId, authToken: req.auth.token });

  const invoiceRef = admin.firestore().collection("parents").doc(parentId).collection("invoices").doc(invoiceId);
  const invoiceSnap = await invoiceRef.get();
  if (!invoiceSnap.exists) return { ok: false, reason: "invoice-not-found" };

  let inv = invoiceSnap.data() || {};
  const repaired = await repairInvoiceFromEquivalentPaidCopy({ invoiceRef, invoiceData: inv });
  inv = repaired.invoiceData || inv;
  const status = String(inv.status || "unpaid").toLowerCase();

  return {
    ok: true,
    repaired: repaired.repaired === true,
    status,
    paid: status === "paid",
    childCoverageKey: invoiceChildCoverageKey(inv),
  };
});

exports.billingCompleteCheckoutSession = onCall({ region: "asia-southeast1" }, async (req) => {
  return billingCompleteCheckoutSessionImpl(req);
});

exports.billingSyncCheckoutSession = onCall({
  region: "asia-southeast1",
  secrets: [BILLPLZ_API_KEY_SECRET],
}, async (req) => {
  return billingSyncCheckoutSessionImpl(req);
});

exports.billingBillplzCallback = onRequest({
  region: "asia-southeast1",
  secrets: [BILLPLZ_X_SIGNATURE_KEY_SECRET],
}, async (req, res) => {
  const result = await billingBillplzCallbackImpl({
    method: req.method,
    body: req.body || req.rawBody || "",
  });
  res.status(Number(result.status || 200)).json(result.body || { ok: false });
});

exports.__billingBillplzCallbackForTests = billingBillplzCallbackImpl;

exports.billingCompleteDummyCheckoutSession = onCall({ region: "asia-southeast1" }, async (req) => {
  return billingCompleteCheckoutSessionImpl(req);
});

exports.billingCompleteDemoCheckoutSession = exports.billingCompleteDummyCheckoutSession;

exports.syncSharedChildInvoicePayments = onDocumentWritten(
  "parents/{parentId}/invoices/{invoiceId}",
  async (event) => {
    const after = event.data && event.data.after ? event.data.after.data() : null;
    const before = event.data && event.data.before ? event.data.before.data() : null;
    if (!after) return null;

    const afterStatus = String(after.status || "").toLowerCase();
    const beforeStatus = String(before && before.status ? before.status : "").toLowerCase();
    const paymentChanged = afterStatus === "paid" && (
      beforeStatus !== "paid" ||
      String(before && before.paidReceiptNo ? before.paidReceiptNo : "") !== String(after.paidReceiptNo || "") ||
      String(before && before.paidPaymentId ? before.paidPaymentId : "") !== String(after.paidPaymentId || "") ||
      String(before && before.paidProvider ? before.paidProvider : "") !== String(after.paidProvider || "")
    );
    if (!paymentChanged) return null;

    await syncEquivalentPaidInvoicesFromSource({
      sourceRef: event.data.after.ref,
      sourceInvoice: after,
    });
    return null;
  },
);
