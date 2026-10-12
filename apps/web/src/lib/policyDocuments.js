const download = (filename, content) => {
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const documentPage = (title, details) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Arial,sans-serif;color:#1f2937;margin:48px;max-width:720px}h1{color:#c92525}dl{display:grid;grid-template-columns:180px 1fr;gap:12px;border-top:1px solid #ddd;padding-top:20px}dt{font-weight:700;color:#6b7280}dd{margin:0;font-weight:600}</style>
</head><body><h1>${title}</h1><dl>${details.map(([label, value]) => `<dt>${label}</dt><dd>${value || '—'}</dd>`).join('')}</dl></body></html>`;

export const downloadPolicyCertificate = (policy) => {
  download(
    `${policy.policyNumber || 'policy'}-certificate.html`,
    documentPage('InsurShield Policy Certificate', [
      ['Policy number', policy.policyNumber],
      ['Insurer', policy.insurer],
      ['Policyholder', policy.customerName],
      ['Vehicle', policy.vehicle],
      ['Vehicle plate', policy.vehicleDetails?.plateNumber],
      ['Valid from', policy.policyDates?.formattedStart],
      ['Valid until', policy.policyDates?.formattedEnd],
      ['Total paid', `ZMW ${(policy.premium || 0).toLocaleString('en-ZM', { minimumFractionDigits: 2 })}`],
    ]),
  );
};

export const downloadRtsaDisc = (policy) => {
  download(
    `${policy.policyNumber || 'policy'}-rtsa-disc.html`,
    documentPage('RTSA Road Tax Disc', [
      ['Policy number', policy.policyNumber],
      ['Vehicle plate', policy.vehicleDetails?.plateNumber],
      ['Vehicle', policy.vehicle],
      ['RTSA anniversary', policy.policyDates?.formattedStart],
      ['Status', 'Active'],
    ]),
  );
};
