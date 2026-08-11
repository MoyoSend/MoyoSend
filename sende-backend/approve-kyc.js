const crypto = require('crypto');

(async () => {
  const vendorReference = 'mock-ref-0011bdf3-8079-4b16-a15b-f11768bec710';
  const body = { vendorReference, decision: 'APPROVED', riskFlags: [] };
  const raw = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', 'replace_me').update(raw).digest('hex');
  const res = await fetch('http://localhost:3000/api/v1/webhooks/kyc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-signature': signature },
    body: raw,
  });
  console.log(res.status, await res.text());
})();