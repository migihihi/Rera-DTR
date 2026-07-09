const XLSX = require('xlsx');
const { getStore } = require('@netlify/blobs');
const { CHECKER_SYSTEM_PROMPT } = require('./checker-prompt');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Check platform.openai.com/docs for the current flagship vision-capable
// model name before deploying — this changes over time.
const MODEL = 'gpt-5.5';

function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z]/g, '');
}

// Pull every row that belongs to this employee out of the coordinator tabs
// (Attendance Transaction / Overtime Request / Reimbursement Import - *).
// Sheet names vary per coordinator, so we match by prefix, not exact name.
function extractEmployeeRows(workbook, employeeName) {
  const targetNorm = normalizeName(employeeName);
  const result = { attendance: [], overtime: [], reimbursement: [], sheetsFound: [] };

  for (const sheetName of workbook.SheetNames) {
    let bucket = null;
    const lower = sheetName.toLowerCase();
    if (lower.startsWith('attendance transaction')) bucket = 'attendance';
    else if (lower.startsWith('overtime request') || lower.startsWith('copy of overtime request')) bucket = 'overtime';
    else if (lower.startsWith('reimbursement import')) bucket = 'reimbursement';
    else continue;

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false });
    const header = rows[0] || [];
    const empCol = header.findIndex((h) => String(h).toLowerCase() === 'employee');
    if (empCol === -1) continue;

    let matchedHere = false;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[empCol]) continue;
      if (normalizeName(row[empCol]) === targetNorm) {
        const obj = {};
        header.forEach((h, idx) => { if (h) obj[h] = row[idx]; });
        result[bucket].push(obj);
        matchedHere = true;
      }
    }
    if (matchedHere) result.sheetsFound.push(sheetName);
  }
  return result;
}

function rowsToText(label, rows) {
  if (!rows.length) return `${label}: none found.`;
  const cols = Object.keys(rows[0]);
  const lines = rows.map((r) => cols.map((c) => `${c}: ${r[c]}`).join(' | '));
  return `${label} (${rows.length} rows):\n` + lines.join('\n');
}

async function callChecker({ employeeName, cutoffPeriod, clientProject, excelRows, dtrBase64, topsheetBase64 }) {
  const excelText = [
    rowsToText('Attendance Transaction rows', excelRows.attendance),
    rowsToText('Overtime Request rows', excelRows.overtime),
    rowsToText('Reimbursement Import rows', excelRows.reimbursement),
    excelRows.sheetsFound.length
      ? `(Matched in Excel tabs: ${excelRows.sheetsFound.join(', ')})`
      : '(No rows found for this employee in any Attendance/Overtime/Reimbursement tab.)',
  ].join('\n\n');

  // OpenAI's Chat Completions API takes PDFs as a "file" content part with
  // an inline data: URL (base64), alongside "text" parts, inside a single
  // user message. The system prompt is its own message with role "system"
  // rather than a top-level field like Anthropic's API uses.
  const content = [
    {
      type: 'text',
      text: `Employee: ${employeeName}\nCutoff period: ${cutoffPeriod}\nClient/Project: ${clientProject}\n\n` +
        `Excel upload file — rows found for this employee:\n${excelText}\n\n` +
        `Attached: this employee's handwritten time card/DTR` +
        (topsheetBase64 ? ', and their topsheet.' : '. No topsheet was provided for this batch — note that in Lacking Files / Details if relevant.'),
    },
    {
      type: 'file',
      file: { filename: 'dtr.pdf', file_data: `data:application/pdf;base64,${dtrBase64}` },
    },
  ];

  if (topsheetBase64) {
    content.push({
      type: 'file',
      file: { filename: 'topsheet.pdf', file_data: `data:application/pdf;base64,${topsheetBase64}` },
    });
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: CHECKER_SYSTEM_PROMPT },
        { role: 'user', content },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '(No text returned.)';
}

exports.handler = async (event) => {
  const store = getStore('dtr-checker-jobs');
  const uploadsStore = getStore('dtr-checker-uploads');
  // This payload is now small — jobId, names, and metadata only. The actual
  // file bytes were already written to uploadsStore by upload-file.js before
  // this function was ever called, to stay under the background function's
  // 256KB request limit.
  const payload = JSON.parse(event.body);
  const { jobId, cutoffPeriod, clientProject, employees } = payload;

  await store.setJSON(jobId, {
    status: 'processing',
    total: employees.length,
    completed: 0,
    results: [],
    startedAt: new Date().toISOString(),
  });

  const uploadKeysToClean = [`${jobId}:excel`];

  try {
    const excelBase64 = await uploadsStore.get(`${jobId}:excel`);
    if (!excelBase64) throw new Error('Excel file was not found in storage — upload may have failed.');
    const excelBuffer = Buffer.from(excelBase64, 'base64');
    const workbook = XLSX.read(excelBuffer, { type: 'buffer' });
    const results = [];

    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      const dtrKey = `${jobId}:dtr:${i}`;
      const topsheetKey = `${jobId}:topsheet:${i}`;
      uploadKeysToClean.push(dtrKey);
      if (emp.hasTopsheet) uploadKeysToClean.push(topsheetKey);

      let reportText;
      let errorMsg = null;
      try {
        const dtrBase64 = await uploadsStore.get(dtrKey);
        if (!dtrBase64) throw new Error('DTR file was not found in storage — upload may have failed.');
        const topsheetBase64 = emp.hasTopsheet ? await uploadsStore.get(topsheetKey) : null;

        const excelRows = extractEmployeeRows(workbook, emp.name);
        reportText = await callChecker({
          employeeName: emp.name,
          cutoffPeriod,
          clientProject,
          excelRows,
          dtrBase64,
          topsheetBase64,
        });
      } catch (err) {
        errorMsg = err.message;
        reportText = null;
      }

      results.push({ name: emp.name, report: reportText, error: errorMsg });

      // Write progress after every employee so the frontend can show a live
      // count instead of one big spinner for the whole batch.
      await store.setJSON(jobId, {
        status: 'processing',
        total: employees.length,
        completed: results.length,
        results,
        startedAt: (await store.get(jobId, { type: 'json' }))?.startedAt || new Date().toISOString(),
      });
    }

    await store.setJSON(jobId, {
      status: 'done',
      total: employees.length,
      completed: results.length,
      results,
      finishedAt: new Date().toISOString(),
    });
  } catch (err) {
    await store.setJSON(jobId, {
      status: 'error',
      error: err.message,
    });
  } finally {
    // Clean up the uploaded files now that processing is done — payroll
    // and DTR data shouldn't sit in storage longer than it takes to run.
    await Promise.allSettled(uploadKeysToClean.map((k) => uploadsStore.delete(k)));
  }
};
