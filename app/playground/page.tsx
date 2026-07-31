'use client';

function CaseCard({ client, amount, bank }: { client: string; amount: string; bank: string }) {
  return (
    <div style={{ border: '1px solid #ccc', padding: 16, marginBottom: 10, borderRadius: 8 }}>
      <p><b>Client:</b> {client}</p>
      <p><b>Loan Amount:</b> {amount}</p>
      <p><b>Bank:</b> {bank}</p>
    </div>
  );
}

export default function Playground() {
  return (
    <div style={{ padding: 40, fontFamily: 'system-ui' }}>
      <CaseCard client="Ciranjivi" amount="$500k" bank="DBS" />
      <CaseCard client="Boss" amount="$800k" bank="UOB" />
      <CaseCard client="Dex" amount="$800k" bank="UOB" />
    </div>
  );
}
