import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
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
  const data = await res.json() as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`OAuth2 error: ${JSON.stringify(data)}`);
  return data.access_token;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Simple secret guard — caller must pass X-Deploy-Secret header
  const secret = process.env.DEPLOY_SECRET || 'elnode-deploy-2026';
  if (req.headers['x-deploy-secret'] !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!saRaw) return res.status(500).json({ error: 'FIREBASE_SERVICE_ACCOUNT not set' });

    const sa: ServiceAccount = JSON.parse(saRaw);
    const projectId = sa.project_id;

    // Read the rules file (bundled with the deployment)
    const rulesSource = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');

    const token = await getAccessToken(sa);
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    const base = `https://firebaserules.googleapis.com/v1/projects/${projectId}`;

    // 1. Create ruleset
    const rulesetRes = await fetch(`${base}/rulesets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source: { files: [{ name: 'firestore.rules', content: rulesSource }] },
      }),
    });
    const ruleset = await rulesetRes.json() as { name?: string; error?: any };
    if (!ruleset.name) throw new Error(`Ruleset creation failed: ${JSON.stringify(ruleset)}`);

    // 2. Update the cloud.firestore release
    const patchRes = await fetch(`${base}/releases/cloud.firestore`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        release: { name: `projects/${projectId}/releases/cloud.firestore`, rulesetName: ruleset.name },
      }),
    });
    const release = await patchRes.json() as { name?: string; error?: any };

    if (release.error) {
      // Create release if it doesn't exist
      const createRes = await fetch(`${base}/releases`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          release: { name: `projects/${projectId}/releases/cloud.firestore`, rulesetName: ruleset.name },
        }),
      });
      const created = await createRes.json() as { name?: string; error?: any };
      if (created.error) throw new Error(`Release failed: ${JSON.stringify(created)}`);
      return res.json({ success: true, ruleset: ruleset.name, release: created.name });
    }

    return res.json({ success: true, ruleset: ruleset.name, release: release.name });

  } catch (err: any) {
    console.error('deploy-rules error:', err);
    return res.status(500).json({ error: err.message });
  }
}
