var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_vite = require("vite");
var import_razorpay = __toESM(require("razorpay"), 1);
var import_crypto = __toESM(require("crypto"), 1);
var import_firebase_admin = __toESM(require("firebase-admin"), 1);
var import_firestore = require("firebase-admin/firestore");
var import_dotenv = __toESM(require("dotenv"), 1);
import_dotenv.default.config();
var adminDb = null;
try {
  if (process.env.VITE_FIREBASE_PROJECT_ID) {
    import_firebase_admin.default.initializeApp({
      projectId: process.env.VITE_FIREBASE_PROJECT_ID
    });
    adminDb = (0, import_firestore.getFirestore)();
    console.log(`[Firebase Admin] Initialized successfully for project: ${process.env.VITE_FIREBASE_PROJECT_ID}`);
  } else {
    import_firebase_admin.default.initializeApp();
    adminDb = (0, import_firestore.getFirestore)();
    console.log("[Firebase Admin] Initialized with Application Default Credentials (ADC).");
  }
} catch (error) {
  console.warn("[Firebase Admin] Failed default initialization. Running in developer sandbox mode.", error);
}
var razorpayKeyId = process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || "rzp_test_TEzRw4ezDtgArr";
var razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || "msNlffEhgl7DAqUbZI7R21dI";
var webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "voxo_webhook_secret_123";
var razorpayClient = new import_razorpay.default({
  key_id: razorpayKeyId,
  key_secret: razorpayKeySecret
});
console.log(`[Razorpay] Configured with Key ID: ${razorpayKeyId}`);
async function creditUserWallet(userId, type, amount, paymentId, orderId) {
  const transactionId = `tx_${paymentId || Date.now()}`;
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const transactionRecord = {
    id: transactionId,
    userId,
    amount,
    type: type === "coins" ? "buy" : "diamonds_purchase",
    description: `Credited ${amount} ${type} via Razorpay (Order: ${orderId})`,
    createdAt
  };
  const notificationRecord = {
    id: `notif_${Date.now()}_${Math.floor(Math.random() * 1e3)}`,
    userId,
    title: "Wallet Recharged \u{1F680}",
    message: `Your account was successfully credited with ${amount} ${type}! Payment ID: ${paymentId}`,
    isRead: false,
    createdAt
  };
  if (adminDb) {
    try {
      const userRef = adminDb.collection("users").doc(userId);
      const txRef = adminDb.collection("transactions").doc(transactionId);
      await adminDb.runTransaction(async (dbTx) => {
        const txSnap = await dbTx.get(txRef);
        if (txSnap.exists) {
          console.warn(`[Wallet Credit] Aborted. Transaction ID ${transactionId} already processed.`);
          return;
        }
        const userSnap = await dbTx.get(userRef);
        if (!userSnap.exists) {
          throw new Error(`User ${userId} does not exist in Firestore.`);
        }
        const userData = userSnap.data() || {};
        const currentBalance = userData[type] || 0;
        const newBalance = currentBalance + amount;
        dbTx.update(userRef, { [type]: newBalance });
        dbTx.set(txRef, transactionRecord);
      });
      await adminDb.collection("notifications").doc(notificationRecord.id).set(notificationRecord);
      console.log(`[Wallet Credit] Successfully credited ${amount} ${type} to user ${userId}. Tx ID: ${transactionId}`);
      return true;
    } catch (err) {
      console.error("[Wallet Credit] Error updating Firestore database:", err);
      throw err;
    }
  } else {
    console.warn(`[Wallet Credit - SIMULATION] No active Firestore. Simulated crediting of ${amount} ${type} to user ${userId}.`);
    return true;
  }
}
async function startServer() {
  const app = (0, import_express.default)();
  const PORT = 3e3;
  app.use((req, res, next) => {
    if (req.originalUrl === "/api/payment/webhook") {
      import_express.default.raw({ type: "application/json" })(req, res, next);
    } else {
      import_express.default.json()(req, res, next);
    }
  });
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });
  app.post("/api/payment/create-order", async (req, res) => {
    try {
      const { userId, type, amount, price, bundleId } = req.body;
      if (!userId || !type || !amount || !price) {
        return res.status(400).json({ error: "Missing required order parameters." });
      }
      const receiptId = `rcpt_${Date.now()}_${userId.slice(-4)}`;
      const options = {
        amount: Math.round(price * 100),
        // convert to paisas/cents
        currency: "INR",
        receipt: receiptId,
        notes: {
          userId,
          type,
          amount: amount.toString(),
          bundleId: bundleId || ""
        }
      };
      const order = await razorpayClient.orders.create(options);
      res.json({ success: true, order });
    } catch (error) {
      console.error("[Create Order API] Error creating order:", error);
      res.status(500).json({ error: error.message || "Failed to create Razorpay Order." });
    }
  });
  app.post("/api/payment/verify-signature", async (req, res) => {
    try {
      const {
        userId,
        type,
        amount,
        razorpay_payment_id,
        razorpay_order_id,
        razorpay_signature
      } = req.body;
      if (!userId || !type || !amount || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
        return res.status(400).json({ error: "Missing verification credentials." });
      }
      const body = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSignature = import_crypto.default.createHmac("sha256", razorpayKeySecret).update(body).digest("hex");
      const isSignatureValid = expectedSignature === razorpay_signature;
      if (!isSignatureValid) {
        console.error(`[Verify Signature API] Invalid signature received for payment ${razorpay_payment_id}`);
        return res.status(400).json({ error: "Invalid payment signature verification failed." });
      }
      await creditUserWallet(userId, type, parseInt(amount), razorpay_payment_id, razorpay_order_id);
      res.json({
        success: true,
        message: "Payment verified successfully, wallet updated."
      });
    } catch (error) {
      console.error("[Verify Signature API] Verification exception:", error);
      res.status(500).json({ error: error.message || "Internal verification failure." });
    }
  });
  app.post("/api/payment/webhook", async (req, res) => {
    try {
      const signature = req.headers["x-razorpay-signature"];
      if (!signature) {
        return res.status(400).json({ error: "Webhook signature header missing." });
      }
      const payloadString = Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body);
      const expectedSignature = import_crypto.default.createHmac("sha256", webhookSecret).update(payloadString).digest("hex");
      if (expectedSignature !== signature) {
        console.error("[Webhook API] Signature verification failed!");
        return res.status(400).json({ error: "Signature mismatch." });
      }
      const payload = JSON.parse(payloadString);
      const event = payload.event;
      console.log(`[Webhook API] Received event: ${event}`);
      if (event === "order.paid" || event === "payment.captured") {
        const paymentEntity = payload.payload?.payment?.entity;
        const notes = paymentEntity?.notes;
        if (notes && notes.userId && notes.type && notes.amount) {
          const userId = notes.userId;
          const type = notes.type;
          const amount = parseInt(notes.amount);
          const paymentId = paymentEntity.id;
          const orderId = paymentEntity.order_id;
          console.log(`[Webhook API] Securing credit for user ${userId}: ${amount} ${type}`);
          await creditUserWallet(userId, type, amount, paymentId, orderId);
        } else {
          console.warn("[Webhook API] Ignored payload. Missing application notes details.", notes);
        }
      }
      res.json({ status: "ok" });
    } catch (error) {
      console.error("[Webhook API] Webhook processing error:", error);
      res.status(500).json({ error: error.message });
    }
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}
startServer();
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
//# sourceMappingURL=server.cjs.map
