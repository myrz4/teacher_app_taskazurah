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

The current parent billing rollout is dummy-only.

The active checkout path is the internal dummy simulator:
- create session
- simulate bank selection, login, and TAC
- poll sync until settlement

Real payment providers are not active unless the Firestore gateway config explicitly opts in with `allowRealProvider=true`.

Relevant backend entry points:
- `billingCreateCheckoutSession`
- `billingSyncCheckoutSession`
- `billingBillplzCallback`

Current recommended config from the repo root:

```powershell
npm run use:demo-payments
```

Equivalent explicit command:

```powershell
npm run set:billing-gateway -- --provider dummy --mode dummy --enable
```

Backward-compatible alias:

```powershell
npm run use:dummy-payments
```

End-to-end billing smoke check from the repo root:

```powershell
npm run smoke:demo-billing
```

Backward-compatible alias:

```powershell
npm run smoke:dummy-billing
```

Manual QA checklist for the current billing, family invoice, JavaFX admin, and dummy payment flows:

- `../doc/billing-manual-qa-checklist.md`

Verify the live payment gateway document from the repo root:

```powershell
npm run verify:billing-rollout
```

The live verification should report:
- `configuredProvider: dummy`
- `effectiveProvider: dummy`
- `effectiveMode: dummy`
- `allowRealProvider: false`

### Optional Future Real-Provider Setup

Real-provider configuration remains in the backend for future rollout work, but it is intentionally not the default path.

If you explicitly decide to test a real provider later, the configuration is split across:
- Firebase Functions secrets for `BILLPLZ_API_KEY` and `BILLPLZ_X_SIGNATURE_KEY`
- Firestore document `billingConfig/paymentGateway` for provider mode, collection ID, callback URL, return URL, and `allowRealProvider`

Example opt-in command from the repo root:

```powershell
npm run set:billing-gateway -- --provider billplz --mode redirect --collectionId YOUR_COLLECTION_ID --returnUrl https://your-app.example/return --clear-callback-url --allow-real-provider
```

Before deploying functions for a real-provider test, set the Billplz secrets from `teacher_app_taskazurah/functions`:

```powershell
firebase functions:secrets:set BILLPLZ_API_KEY
firebase functions:secrets:set BILLPLZ_X_SIGNATURE_KEY
npm run deploy
```

Convenience commands:

```powershell
npm run deploy:billing-functions
```

Backward-compatible alias:

```powershell
npm run billplz:deploy
```

Or from the repo root:

```powershell
npm run deploy:billing-functions
```

If `billingConfig/paymentGateway.callbackUrl` is empty during a future Billplz rollout, the backend automatically uses the deployed `billingBillplzCallback` HTTP function URL as Billplz `callback_url`.
