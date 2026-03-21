import { generateKeyPairSync } from 'crypto';
import dns from 'dns/promises';

/**
 * Generates an RSA 2048-bit key pair for DKIM signing.
 * Returns the PEM-encoded private key (for signing) and the
 * stripped base64 public key (for the DNS TXT record).
 */
export function generateDkimKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // DNS TXT value requires the raw base64 without PEM headers/newlines
  const publicKeyForDns = publicKey
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\n/g, '');

  return { privateKey, publicKey, publicKeyForDns };
}

/**
 * Returns the three DNS TXT records the school must add to their domain.
 */
export function getDnsRecords({
  sendingDomain,
  dkimSelector,
  dkimPublicKey,
  dmarcPolicy = 'none',
  dmarcReportingEmail = '',
}) {
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  // Convert smtp.example.com → example.com for the SPF include value
  const spfInclude = smtpHost.replace(/^smtp\./, '');

  return {
    spf: {
      type: 'TXT',
      host: sendingDomain,
      value: `v=spf1 include:${spfInclude} ~all`,
      description: 'Authorises your SMTP server to send on behalf of this domain',
    },
    dkim: {
      type: 'TXT',
      host: `${dkimSelector}._domainkey.${sendingDomain}`,
      value: `v=DKIM1; k=rsa; p=${dkimPublicKey}`,
      description: 'Allows receivers to verify the cryptographic signature on outgoing emails',
    },
    dmarc: {
      type: 'TXT',
      host: `_dmarc.${sendingDomain}`,
      value: `v=DMARC1; p=${dmarcPolicy}${dmarcReportingEmail ? `; rua=mailto:${dmarcReportingEmail}` : ''}`,
      description: 'Specifies how receivers handle emails that fail SPF/DKIM checks',
    },
  };
}

/**
 * Looks up DNS TXT records to check whether SPF, DKIM, and DMARC are
 * properly configured for the given sending domain.
 */
export async function verifyDomainDns({ sendingDomain, dkimSelector, dkimPublicKey }) {
  const results = { spf: false, dkim: false, dmarc: false, errors: {} };

  // SPF — look for a v=spf1 TXT record on the domain itself
  try {
    const records = await dns.resolveTxt(sendingDomain);
    results.spf = records.some((r) => r.join('').startsWith('v=spf1'));
  } catch (e) {
    results.errors.spf = e.message;
  }

  // DKIM — look for v=DKIM1 on <selector>._domainkey.<domain>
  try {
    const dkimDomain = `${dkimSelector}._domainkey.${sendingDomain}`;
    const records = await dns.resolveTxt(dkimDomain);
    const flat = records.map((r) => r.join(''));
    const hasKey = flat.some((r) => r.includes('v=DKIM1'));
    // Also verify the public key fragment matches what we generated
    const keyFragment = dkimPublicKey ? dkimPublicKey.substring(0, 30) : null;
    results.dkim = hasKey && (keyFragment ? flat.some((r) => r.includes(keyFragment)) : true);
  } catch (e) {
    results.errors.dkim = e.message;
  }

  // DMARC — look for v=DMARC1 on _dmarc.<domain>
  try {
    const dmarcDomain = `_dmarc.${sendingDomain}`;
    const records = await dns.resolveTxt(dmarcDomain);
    results.dmarc = records.some((r) => r.join('').startsWith('v=DMARC1'));
  } catch (e) {
    results.errors.dmarc = e.message;
  }

  const verifiedCount = [results.spf, results.dkim, results.dmarc].filter(Boolean).length;
  results.verificationStatus =
    verifiedCount === 3 ? 'verified' : verifiedCount > 0 ? 'partial' : 'unverified';

  return results;
}
