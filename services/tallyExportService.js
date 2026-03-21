import FeePayment from '../models/FeePayment.js';
import TallyConfig from '../models/TallyConfig.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TallyExportService');

// Tally date format: YYYYMMDD
function toTallyDate(dateStr) {
  return dateStr.replace(/-/g, '');
}

// Escape XML special characters
function xmlEscape(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Get the Tally debit ledger name based on payment mode and config.
 */
function getPaymentModeLedger(paymentMode, config) {
  switch ((paymentMode || '').toLowerCase()) {
    case 'cash':
      return config.defaultCashLedger || 'Cash';
    case 'cheque':
      return config.defaultChequeLedger || 'Cheque Clearing';
    case 'online':
    case 'upi':
    case 'card':
      return config.defaultOnlineLedger || 'Online Payment Gateway';
    default:
      return config.defaultBankLedger || 'Bank';
  }
}

/**
 * Resolve the Tally income ledger for a given fee head name using the config mapping.
 * Falls back to the fee head name itself if no mapping found.
 */
function resolveFeeHeadLedger(feeHeadName, ledgerMappings) {
  const mapping = (ledgerMappings || []).find(
    (m) => m.feeHeadName.toLowerCase() === (feeHeadName || '').toLowerCase()
  );
  return mapping ? mapping.tallyLedger : feeHeadName || 'School Fees';
}

/**
 * Build XML for a single payment's ledger entries.
 * In Tally Receipt vouchers:
 *   - Debit side (cash/bank): ISDEEMEDPOSITIVE=Yes, AMOUNT=-totalAmount
 *   - Credit side (income): ISDEEMEDPOSITIVE=No, AMOUNT=feeHeadAmount
 */
function buildLedgerEntriesXml(payment, config) {
  const debitLedger = getPaymentModeLedger(payment.paymentMode, config);
  const totalAmount = payment.amount;
  let entriesXml = '';

  // Debit entry — cash/bank account
  entriesXml += `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${xmlEscape(debitLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>${-totalAmount}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`;

  // Credit entries — split across fee heads
  if (payment.feeHeads && payment.feeHeads.length > 0) {
    for (const fh of payment.feeHeads) {
      const incomeLedger = resolveFeeHeadLedger(fh.name, config.ledgerMappings);
      entriesXml += `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${xmlEscape(incomeLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${fh.amount}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`;
    }
  } else {
    // No fee head breakdown — use a single income entry
    const incomeLedger = config.ledgerMappings?.[0]?.tallyLedger || 'School Fees';
    entriesXml += `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${xmlEscape(incomeLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${totalAmount}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`;
  }

  // Late fee entry (if any)
  if (payment.lateFee && payment.lateFee > 0) {
    entriesXml += `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Late Fee Income</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${payment.lateFee}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`;
  }

  return entriesXml;
}

/**
 * Build a Tally voucher XML block for a single FeePayment.
 */
function buildVoucherXml(payment, studentName, config) {
  const tallyDate = toTallyDate(payment.paymentDate);
  const narration = `Fee Payment - ${xmlEscape(studentName)} | Receipt: ${xmlEscape(payment.receiptNumber)}`;
  const ledgerEntries = buildLedgerEntriesXml(payment, config);

  return `
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER REMOTEID="${xmlEscape(payment._id.toString())}" VCHTYPE="Receipt" ACTION="Create">
            <DATE>${tallyDate}</DATE>
            <NARRATION>${narration}</NARRATION>
            <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
            <VOUCHERNUMBER>${xmlEscape(payment.receiptNumber)}</VOUCHERNUMBER>
            <PARTYLEDGERNAME>${xmlEscape(getPaymentModeLedger(payment.paymentMode, config))}</PARTYLEDGERNAME>${ledgerEntries}
          </VOUCHER>
        </TALLYMESSAGE>`;
}

/**
 * Generate a complete Tally-compatible XML import envelope for a list of fee payments.
 */
function generateTallyXml(payments, config, companyName) {
  const company = companyName || config.companyName || 'School';
  let vouchersXml = '';

  for (const payment of payments) {
    const studentName = payment.studentId?.name || payment.studentId?.toString() || 'Student';
    vouchersXml += buildVoucherXml(payment, studentName, config);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${xmlEscape(company)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>${vouchersXml}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

/**
 * Build a chart-of-accounts XML for Tally (ledger masters).
 * Creates income ledger masters for each mapped fee head.
 */
function generateChartOfAccountsXml(config, companyName) {
  const company = companyName || config.companyName || 'School';
  let mastersXml = '';

  const ledgers = new Set();

  // Payment mode ledgers
  ledgers.add({ name: config.defaultCashLedger || 'Cash', group: 'Cash-in-Hand' });
  ledgers.add({ name: config.defaultBankLedger || 'Bank', group: 'Bank Accounts' });
  ledgers.add({
    name: config.defaultOnlineLedger || 'Online Payment Gateway',
    group: 'Bank Accounts',
  });
  ledgers.add({ name: config.defaultChequeLedger || 'Cheque Clearing', group: 'Bank Accounts' });
  ledgers.add({ name: 'Late Fee Income', group: 'Income' });

  // Income ledgers from mappings
  for (const mapping of config.ledgerMappings || []) {
    ledgers.add({ name: mapping.tallyLedger, group: mapping.tallyGroup || 'Income' });
  }

  for (const ledger of ledgers) {
    mastersXml += `
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <LEDGER NAME="${xmlEscape(ledger.name)}" ACTION="Create">
            <NAME>${xmlEscape(ledger.name)}</NAME>
            <PARENT>${xmlEscape(ledger.group)}</PARENT>
          </LEDGER>
        </TALLYMESSAGE>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${xmlEscape(company)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>${mastersXml}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

/**
 * Fetch payments and generate export data (XML or JSON summary).
 */
export async function generateExport({ schoolId, dateFrom, dateTo, academicYear, format = 'xml' }) {
  const config = (await TallyConfig.findOne({ schoolId })) || { ledgerMappings: [] };

  const query = {
    schoolId,
    paymentDate: { $gte: dateFrom, $lte: dateTo },
    status: 'completed',
  };
  if (academicYear) query.academicYear = academicYear;

  const payments = await FeePayment.find(query).populate('studentId', 'name admissionId').lean();

  if (format === 'json') {
    return {
      format: 'json',
      recordCount: payments.length,
      dateFrom,
      dateTo,
      payments: payments.map((p) => ({
        receiptNumber: p.receiptNumber,
        paymentDate: p.paymentDate,
        amount: p.amount,
        paymentMode: p.paymentMode,
        studentName: p.studentId?.name || '',
        feeHeads: p.feeHeads || [],
        lateFee: p.lateFee || 0,
        discount: p.discount || 0,
        transactionId: p.transactionId || '',
      })),
    };
  }

  const xml = generateTallyXml(payments, config, config.companyName);
  return { format: 'xml', recordCount: payments.length, xml, dateFrom, dateTo };
}

/**
 * Generate chart of accounts XML for the school's Tally config.
 */
export async function generateChartOfAccounts(schoolId) {
  const config = (await TallyConfig.findOne({ schoolId })) || { ledgerMappings: [] };
  const xml = generateChartOfAccountsXml(config, config.companyName);
  return { xml };
}

/**
 * Process auto-export for all schools with auto-export enabled.
 * Called by the Agenda scheduled job.
 */
export async function processAutoExports() {
  const configs = await TallyConfig.find({ 'autoExport.enabled': true }).lean();
  let processed = 0;
  let failed = 0;

  for (const config of configs) {
    try {
      const today = new Date();
      const schedule = config.autoExport?.schedule || 'daily';

      let dateFrom;
      const dateTo = today.toISOString().split('T')[0];

      if (schedule === 'daily') {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        dateFrom = yesterday.toISOString().split('T')[0];
      } else if (schedule === 'weekly') {
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        dateFrom = weekAgo.toISOString().split('T')[0];
      } else {
        // monthly
        const monthAgo = new Date(today);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        dateFrom = monthAgo.toISOString().split('T')[0];
      }

      const result = await generateExport({
        schoolId: config.schoolId,
        dateFrom,
        dateTo,
        format: 'xml',
      });

      await TallyConfig.updateOne(
        { _id: config._id },
        {
          $set: {
            'autoExport.lastExportAt': new Date(),
            'autoExport.lastExportStatus': 'success',
          },
          $push: {
            syncHistory: {
              $each: [
                {
                  exportedAt: new Date(),
                  dateFrom,
                  dateTo,
                  recordCount: result.recordCount,
                  status: 'success',
                  triggeredBy: 'scheduled',
                  errorMessage: null,
                },
              ],
              $slice: -50,
            },
          },
        }
      );

      processed++;
      logger.info(
        { schoolId: config.schoolId, recordCount: result.recordCount },
        'Tally auto-export completed'
      );
    } catch (err) {
      failed++;
      logger.error({ schoolId: config.schoolId, err: err.message }, 'Tally auto-export failed');

      await TallyConfig.updateOne(
        { _id: config._id },
        {
          $set: {
            'autoExport.lastExportAt': new Date(),
            'autoExport.lastExportStatus': 'failed',
          },
          $push: {
            syncHistory: {
              $each: [
                {
                  exportedAt: new Date(),
                  dateFrom: '',
                  dateTo: '',
                  recordCount: 0,
                  status: 'failed',
                  triggeredBy: 'scheduled',
                  errorMessage: err.message,
                },
              ],
              $slice: -50,
            },
          },
        }
      );
    }
  }

  return { processed, failed };
}
