const crypto = require('crypto');

(async () => {
  const transactionId = '875da59e-99d9-4b5a-9b98-d78b6999091e'; // Ade Bond, £10 GBP -> NGN
  const body = { transactionId, status: 'DELIVERED', providerReference: 'mock-payout-' + transactionId };
  const raw = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', 'FLWSECK_TEST-0c495e3868f94b02c2f695ce400d6ed3-X').update(raw).digest('hex');
  const res = await fetch('http://localhost:3000/api/v1/webhooks/payout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-signature': signature },
    body: raw,
  });
  console.log(res.status, await res.text());
})();