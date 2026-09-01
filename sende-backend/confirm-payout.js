const crypto = require('crypto');

const WEBHOOK_SECRET = process.env.FLW_TEST_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) {
  console.error('Set FLW_TEST_WEBHOOK_SECRET before running this script.');
  process.exit(1);
}

(async () => {
  const transactionId = '875da59e-99d9-4b5a-9b98-d78b6999091e'; // Ade Bond, £10 GBP -> NGN
  const body = { transactionId, status: 'DELIVERED', providerReference: 'mock-payout-' + transactionId };
  const raw = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
  const res = await fetch('http://localhost:3000/api/v1/webhooks/payout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-signature': signature },
    body: raw,
  });
  console.log(res.status, await res.text());
})();
