# SPH-Portal <> NilaiGuide Google Sheets Bridge

This is **separate** from the old \`server-gas/Code.gs\`. Do not paste this over the original NilaiGuide Apps Script, or it will remove its reporting logic.

## Setup (requires access to Google Apps Script)
1. Create a **new** Google Spreadsheet for operational records. Preserve the old \`Penilaian Guide Besakih — Basis Data 2026\` as read-only archive.
2. Create a standalone Google Apps Script project and paste \`Code.gs\`.
3. Under Script Properties set \`BRIDGE_KEY\` to a cryptographically random 48+ character secret, \`ACTIVE_SHEET_ID\`, \`ARCHIVE_SHEET_ID\`, \`CUTOVER_DATE\` and \`ENABLE_WRITES=false\`.
4. Run \`setupOperationalSheet()\` **once** to copy master guides and create the empty Evaluations tab. It refuses to overwrite an existing Evaluations tab. Compare the 314 guide IDs and active flags.
5. Deploy as a web app, execute as owner; share with Anyone. All operations require the credential. Store the secret only in Supabase Edge function secrets as \`VISITS_BRIDGE_KEY\` and Apps Script Properties as \`BRIDGE_KEY\`. Store the deployment URL in \`VISITS_BRIDGE_URL\`.
6. Keep \`ENABLE_WRITES=false\` until you have verified data reads, scripts/reports and token security in preview. Change to true only at cutover.
7. Maintain or install the original NilaiGuide Apps Script reporting triggers for the NEW spreadsheet, in a separate bound Apps Script project, so REVIEW manual / rewards continue working. Do not overwrite historical tab-level REVIEW.

The backend currently needs to be deployed and its configuration tested before creating public links. Legacy \`/exec\` is not a substitute: it has no bridge credential requirement.

The bridge supports \`overview\`, \`guides.list\`, \`guides.upsert\`, \`records.list\`, \`archive.list\`, \`archive.reviews\`, \`form.context\`, and \`form.submit\`.

Data in \`Evaluations\` stays append-only; duplicate evaluationId is idempotent, guideId is authoritative, and a same-guide/pos attempt within 15 minutes is rejected. Public forms must validate the opaque Supabase token and throttle BEFORE calling bridge.

**Deployment readiness:** Not yet verified. No production secrets, hosting settings, or Google spreadsheet were changed by committing this code.
