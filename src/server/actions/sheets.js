import { google } from 'googleapis';

const DRY_RUN = process.env.DRY_RUN === 'true';

function parseCredentials(raw) {
  // Try plain JSON first; fall back to base64-encoded JSON
  try {
    return JSON.parse(raw);
  } catch {
    const decoded = Buffer.from(raw, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  }
}

function buildSheets(serviceAccountJson) {
  const credentials = parseCredentials(serviceAccountJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

function toRow(post, category) {
  return [
    new Date().toISOString(),
    post.source,
    category?.name ?? 'Uncategorized',
    post.escalation_score ?? 0,
    post.escalated ? 'YES' : 'NO',
    post.title ?? '',
    post.url ?? '',
    post.author ?? '',
    post.reasoning ?? '',
  ];
}

// post: the post object
// category: the matching category object (or undefined)
// config: { sheet_id: '...', service_account_json: '...' }
export async function appendToSheet(post, category, config) {
  const sheetId = config?.sheet_id;
  if (!sheetId) throw new Error('sheet_id not set in config');

  // UI stores as service_account; older configs may use service_account_json
  const serviceAccountRaw = config?.service_account || config?.service_account_json || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountRaw?.trim()) throw new Error('service_account_json not provided');

  const row = toRow(post, category);

  if (DRY_RUN) {
    console.log(`[sheets] DRY RUN — would append row: ${JSON.stringify(row)}`);
    return;
  }

  const sheets = buildSheets(serviceAccountRaw);
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'Sheet1!A:I',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  console.log(`[sheets] appended row for post ${post.id}`);
}
