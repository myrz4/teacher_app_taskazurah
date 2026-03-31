# teacher_app_taskazurah

A new Flutter project.

## Getting Started

This project is a starting point for a Flutter application.

A few resources to get you started if this is your first Flutter project:

- [Lab: Write your first Flutter app](https://docs.flutter.dev/get-started/codelab)
- [Cookbook: Useful Flutter samples](https://docs.flutter.dev/cookbook)

For help getting started with Flutter development, view the
[online documentation](https://docs.flutter.dev/), which offers tutorials,
samples, guidance on mobile development, and a full API reference.

## Billing Notes

The parent billing flow supports redirect checkout providers, including Billplz.

Relevant backend entry points:
- `billingCreateCheckoutSession`
- `billingSyncCheckoutSession`
- `billingBillplzCallback`

Billplz configuration is split across:
- Firebase Functions secrets for `BILLPLZ_API_KEY` and `BILLPLZ_X_SIGNATURE_KEY`
- Firestore document `billingConfig/paymentGateway` for provider mode, collection ID, callback URL, and return URL

You can write the Firestore payment gateway document from the repo root:

```powershell
npm run set:billing-gateway -- --collectionId YOUR_COLLECTION_ID --returnUrl https://your-app.example/return --clear-callback-url
```

If you want to defer real payment and stay on the demo checkout flow:

```powershell
npm run set:billing-gateway -- --provider dummy --mode dummy --enable
```

Shortcut from the repo root:

```powershell
npm run use:demo-payments
```

Backward-compatible alias:

```powershell
npm run use:dummy-payments
```

End-to-end demo billing smoke check from the repo root:

```powershell
npm run smoke:demo-billing
```

Backward-compatible alias:

```powershell
npm run smoke:dummy-billing
```

Manual QA checklist for the current billing, family invoice, JavaFX admin, and dummy payment flows:

- `../doc/billing-manual-qa-checklist.md`

Before deploying functions, set the two Billplz secrets from `teacher_app_taskazurah/functions`:

```powershell
firebase functions:secrets:set BILLPLZ_API_KEY
firebase functions:secrets:set BILLPLZ_X_SIGNATURE_KEY
npm run deploy
```

Convenience commands:

```powershell
npm run billplz:deploy
```

Or from the repo root:

```powershell
npm run deploy:billing-functions
```

After deploy, verify the live payment gateway document from the repo root:

```powershell
npm run verify:billing-rollout
```

If `billingConfig/paymentGateway.callbackUrl` is empty, the backend automatically uses the deployed `billingBillplzCallback` HTTP function URL as Billplz `callback_url`.
