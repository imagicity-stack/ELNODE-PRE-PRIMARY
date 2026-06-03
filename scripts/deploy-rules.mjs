#!/usr/bin/env node
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rulesPath = join(__dirname, '..', 'firestore.rules');

function b64url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(sa) {
  const iat = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat, exp: iat + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const sig = b64url(signer.sign(sa.private_key));
  const jwt = `${unsigned}.${sig}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`OAuth2 error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function deployRules() {
  const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!saRaw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var not set');

  const sa = JSON.parse(saRaw);
  const projectId = sa.project_id;
  console.log(`Project: ${projectId}`);

  const rulesSource = readFileSync(rulesPath, 'utf8');
  console.log(`Rules file: ${rulesPath} (${rulesSource.length} chars)`);

  console.log('Getting access token...');
  const token = await getAccessToken(sa);

  const authHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const base = `https://firebaserules.googleapis.com/v1/projects/${projectId}`;

  // Step 1: Create a new ruleset
  console.log('Creating ruleset...');
  const rulesetRes = await fetch(`${base}/rulesets`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      source: {
        files: [{
          name: 'firestore.rules',
          content: rulesSource,
          fingerprint: Buffer.from(rulesSource).toString('base64').slice(0, 20),
        }],
      },
    }),
  });
  const rulesetData = await rulesetRes.json();
  if (!rulesetData.name) {
    throw new Error(`Ruleset creation failed: ${JSON.stringify(rulesetData)}`);
  }
  console.log(`Ruleset created: ${rulesetData.name}`);

  // Step 2: Update the cloud.firestore release to point to the new ruleset
  console.log('Updating release...');
  const releaseName = `projects/${projectId}/releases/cloud.firestore`;
  const releaseRes = await fetch(`${base}/releases/cloud.firestore`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({
      release: {
        name: releaseName,
        rulesetName: rulesetData.name,
      },
    }),
  });
  const releaseData = await releaseRes.json();

  if (releaseData.error) {
    // Release might not exist yet — try PUT/create
    console.log('Release not found, creating it...');
    const createRes = await fetch(`${base}/releases`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        release: {
          name: releaseName,
          rulesetName: rulesetData.name,
        },
      }),
    });
    const createData = await createRes.json();
    if (createData.error) throw new Error(`Release creation failed: ${JSON.stringify(createData)}`);
    console.log(`Release created: ${createData.name}`);
  } else {
    console.log(`Release updated: ${releaseData.name}`);
  }

  console.log('\n✅ Firestore rules deployed successfully!');
}

deployRules().catch(err => {
  console.error('❌ Deploy failed:', err.message);
  process.exit(1);
});
