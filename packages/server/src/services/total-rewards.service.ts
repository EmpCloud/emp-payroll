import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";
import { findUsersByOrgId, getEmpCloudDB } from "../db/empcloud";

const totalRewardsPrintLabels = {
  en: {
    print: "Print / Save as PDF",
    title: "Total Rewards Statement",
    financialYear: "Financial Year",
    totalValue: "Total Rewards Value",
    compensationSummary: "Compensation Summary",
    annualCtc: "Annual CTC",
    benefitsValue: "Benefits Value",
    reimbursements: "Reimbursements",
    ytdEarnings: "YTD Earnings",
    month: "month",
    months: "months",
    grossEarnings: "Gross Earnings",
    totalDeductions: "Total Deductions",
    netPay: "Net Pay",
    taxPaid: "Tax Paid",
    salaryComponents: "Salary Components",
    component: "Component",
    monthly: "Monthly",
    annual: "Annual",
    totalCtc: "Total CTC",
    benefits: "Benefits",
    plan: "Plan",
    type: "Type",
    coverage: "Coverage",
    employerShare: "Annual Employer Share",
    noBenefits: "No benefits enrolled",
    confidential: "This is a confidential document.",
    generatedOn: "Generated on",
  },
  es: {
    print: "Imprimir / Guardar como PDF",
    title: "Extracto de recompensas totales",
    financialYear: "Ejercicio fiscal",
    totalValue: "Valor total de recompensas",
    compensationSummary: "Resumen de compensación",
    annualCtc: "CTC anual",
    benefitsValue: "Valor de los beneficios",
    reimbursements: "Reembolsos",
    ytdEarnings: "Ingresos acumulados",
    month: "mes",
    months: "meses",
    grossEarnings: "Ingresos brutos",
    totalDeductions: "Deducciones totales",
    netPay: "Pago neto",
    taxPaid: "Impuestos pagados",
    salaryComponents: "Componentes salariales",
    component: "Componente",
    monthly: "Mensual",
    annual: "Anual",
    totalCtc: "CTC total",
    benefits: "Beneficios",
    plan: "Plan",
    type: "Tipo",
    coverage: "Cobertura",
    employerShare: "Aporte anual del empleador",
    noBenefits: "Sin beneficios inscritos",
    confidential: "Este documento es confidencial.",
    generatedOn: "Generado el",
  },
  de: {
    print: "Drucken / Als PDF speichern",
    title: "Gesamtvergütungsnachweis",
    financialYear: "Geschäftsjahr",
    totalValue: "Gesamtwert der Vergütung",
    compensationSummary: "Vergütungsübersicht",
    annualCtc: "Jährliche CTC",
    benefitsValue: "Wert der Zusatzleistungen",
    reimbursements: "Erstattungen",
    ytdEarnings: "Jahresverdienst bis heute",
    month: "Monat",
    months: "Monate",
    grossEarnings: "Bruttoverdienst",
    totalDeductions: "Gesamtabzüge",
    netPay: "Nettolohn",
    taxPaid: "Gezahlte Steuer",
    salaryComponents: "Gehaltsbestandteile",
    component: "Bestandteil",
    monthly: "Monatlich",
    annual: "Jährlich",
    totalCtc: "Gesamt-CTC",
    benefits: "Zusatzleistungen",
    plan: "Plan",
    type: "Typ",
    coverage: "Deckung",
    employerShare: "Jährlicher Arbeitgeberanteil",
    noBenefits: "Keine Zusatzleistungen",
    confidential: "Dieses Dokument ist vertraulich.",
    generatedOn: "Erstellt am",
  },
  fr: {
    print: "Imprimer / Enregistrer en PDF",
    title: "Relevé de rémunération globale",
    financialYear: "Exercice fiscal",
    totalValue: "Valeur totale de la rémunération",
    compensationSummary: "Résumé de la rémunération",
    annualCtc: "CTC annuel",
    benefitsValue: "Valeur des avantages",
    reimbursements: "Remboursements",
    ytdEarnings: "Revenus cumulés",
    month: "mois",
    months: "mois",
    grossEarnings: "Revenus bruts",
    totalDeductions: "Total des retenues",
    netPay: "Salaire net",
    taxPaid: "Impôt payé",
    salaryComponents: "Composantes salariales",
    component: "Composante",
    monthly: "Mensuel",
    annual: "Annuel",
    totalCtc: "CTC total",
    benefits: "Avantages",
    plan: "Régime",
    type: "Type",
    coverage: "Couverture",
    employerShare: "Part annuelle de l’employeur",
    noBenefits: "Aucun avantage souscrit",
    confidential: "Ce document est confidentiel.",
    generatedOn: "Généré le",
  },
  pt: {
    print: "Imprimir / Salvar como PDF",
    title: "Demonstrativo de recompensas totais",
    financialYear: "Exercício fiscal",
    totalValue: "Valor total das recompensas",
    compensationSummary: "Resumo da remuneração",
    annualCtc: "CTC anual",
    benefitsValue: "Valor dos benefícios",
    reimbursements: "Reembolsos",
    ytdEarnings: "Ganhos acumulados",
    month: "mês",
    months: "meses",
    grossEarnings: "Ganhos brutos",
    totalDeductions: "Deduções totais",
    netPay: "Pagamento líquido",
    taxPaid: "Imposto pago",
    salaryComponents: "Componentes salariais",
    component: "Componente",
    monthly: "Mensal",
    annual: "Anual",
    totalCtc: "CTC total",
    benefits: "Benefícios",
    plan: "Plano",
    type: "Tipo",
    coverage: "Cobertura",
    employerShare: "Contribuição anual do empregador",
    noBenefits: "Nenhum benefício contratado",
    confidential: "Este documento é confidencial.",
    generatedOn: "Gerado em",
  },
  hi: {
    print: "प्रिंट / PDF के रूप में सहेजें",
    title: "कुल पुरस्कार विवरण",
    financialYear: "वित्त वर्ष",
    totalValue: "कुल पुरस्कार मूल्य",
    compensationSummary: "मुआवज़ा सारांश",
    annualCtc: "वार्षिक CTC",
    benefitsValue: "लाभ मूल्य",
    reimbursements: "प्रतिपूर्ति",
    ytdEarnings: "वर्ष-से-अब-तक आय",
    month: "माह",
    months: "माह",
    grossEarnings: "सकल आय",
    totalDeductions: "कुल कटौतियाँ",
    netPay: "शुद्ध वेतन",
    taxPaid: "भुगतान किया कर",
    salaryComponents: "वेतन घटक",
    component: "घटक",
    monthly: "मासिक",
    annual: "वार्षिक",
    totalCtc: "कुल CTC",
    benefits: "लाभ",
    plan: "योजना",
    type: "प्रकार",
    coverage: "कवरेज",
    employerShare: "वार्षिक नियोक्ता अंश",
    noBenefits: "कोई लाभ नामांकित नहीं",
    confidential: "यह एक गोपनीय दस्तावेज़ है।",
    generatedOn: "निर्माण तिथि",
  },
  ja: {
    print: "印刷 / PDFとして保存",
    title: "総報酬明細",
    financialYear: "会計年度",
    totalValue: "総報酬額",
    compensationSummary: "報酬概要",
    annualCtc: "年間CTC",
    benefitsValue: "福利厚生額",
    reimbursements: "経費精算",
    ytdEarnings: "年初来収入",
    month: "か月",
    months: "か月",
    grossEarnings: "総支給額",
    totalDeductions: "控除合計",
    netPay: "手取り額",
    taxPaid: "納税額",
    salaryComponents: "給与項目",
    component: "項目",
    monthly: "月額",
    annual: "年額",
    totalCtc: "CTC合計",
    benefits: "福利厚生",
    plan: "プラン",
    type: "種類",
    coverage: "対象",
    employerShare: "会社年間負担額",
    noBenefits: "加入中の福利厚生はありません",
    confidential: "この文書は機密情報です。",
    generatedOn: "作成日",
  },
  zh: {
    print: "打印 / 另存为PDF",
    title: "总薪酬报告",
    financialYear: "财年",
    totalValue: "总薪酬价值",
    compensationSummary: "薪酬摘要",
    annualCtc: "年度CTC",
    benefitsValue: "福利价值",
    reimbursements: "报销",
    ytdEarnings: "本年累计收入",
    month: "个月",
    months: "个月",
    grossEarnings: "总收入",
    totalDeductions: "扣款总额",
    netPay: "净薪资",
    taxPaid: "已缴税款",
    salaryComponents: "薪资组成",
    component: "项目",
    monthly: "月度",
    annual: "年度",
    totalCtc: "CTC合计",
    benefits: "福利",
    plan: "计划",
    type: "类型",
    coverage: "保障范围",
    employerShare: "雇主年度缴费",
    noBenefits: "尚未参加福利计划",
    confidential: "本文档为保密文件。",
    generatedOn: "生成日期",
  },
  ar: {
    print: "طباعة / حفظ بصيغة PDF",
    title: "كشف المكافآت الإجمالية",
    financialYear: "السنة المالية",
    totalValue: "قيمة المكافآت الإجمالية",
    compensationSummary: "ملخص التعويض",
    annualCtc: "التكلفة السنوية",
    benefitsValue: "قيمة المزايا",
    reimbursements: "التعويضات",
    ytdEarnings: "أرباح السنة حتى تاريخه",
    month: "شهر",
    months: "أشهر",
    grossEarnings: "إجمالي الأرباح",
    totalDeductions: "إجمالي الاستقطاعات",
    netPay: "صافي الأجر",
    taxPaid: "الضريبة المدفوعة",
    salaryComponents: "مكونات الراتب",
    component: "المكون",
    monthly: "شهري",
    annual: "سنوي",
    totalCtc: "إجمالي التكلفة",
    benefits: "المزايا",
    plan: "الخطة",
    type: "النوع",
    coverage: "التغطية",
    employerShare: "حصة صاحب العمل السنوية",
    noBenefits: "لا توجد مزايا مشتركة",
    confidential: "هذه وثيقة سرية.",
    generatedOn: "تاريخ الإنشاء",
  },
} as const;

type PrintLanguage = keyof typeof totalRewardsPrintLabels;
const printLocales: Record<PrintLanguage, string> = {
  en: "en-IN",
  es: "es-ES",
  de: "de-DE",
  fr: "fr-FR",
  pt: "pt-PT",
  hi: "hi-IN",
  ja: "ja-JP",
  zh: "zh-CN",
  ar: "ar",
};

export class TotalRewardsService {
  private db = getDB();

  /**
   * Generate a total rewards statement for an employee.
   * Aggregates salary, benefits, bonuses, deductions into one view.
   */
  async generateStatement(orgId: string, employeeId: string, financialYear?: string) {
    const numOrgId = Number(orgId);
    const numEmpId = Number(employeeId);

    // Determine financial year
    const now = new Date();
    const currentFY =
      now.getMonth() >= 3
        ? `${now.getFullYear()}-${now.getFullYear() + 1}`
        : `${now.getFullYear() - 1}-${now.getFullYear()}`;
    const fy = financialYear || currentFY;
    const [fyStart, fyEnd] = fy.split("-").map(Number);

    // Get employee info from EmpCloud
    const ecDb = getEmpCloudDB();
    const employee = await ecDb("users")
      .where({ id: numEmpId })
      .select("id", "first_name", "last_name", "email", "emp_code", "designation", "department_id")
      .first();
    if (!employee) throw new AppError(404, "NOT_FOUND", "Employee not found");

    // 1. Current salary
    const salary = await this.db.findOne<any>("employee_salaries", {
      empcloud_user_id: numEmpId,
      is_active: true,
    });

    const ctc = salary ? Number(salary.ctc) : 0;
    const grossSalary = salary ? Number(salary.gross_salary) : 0;
    const components = salary
      ? typeof salary.components === "string"
        ? JSON.parse(salary.components)
        : salary.components || []
      : [];

    // 2. YTD earnings from payslips
    const fyMonths = this.getFYMonths(fyStart);
    let ytdGrossEarnings = 0;
    let ytdNetPay = 0;
    let ytdTotalDeductions = 0;
    let ytdTax = 0;
    const monthlyPayslips: any[] = [];

    for (const { month, year } of fyMonths) {
      const payslip = await this.db.findOne<any>("payslips", {
        empcloud_user_id: numEmpId,
        month,
        year,
      });
      if (payslip) {
        ytdGrossEarnings += Number(payslip.gross_earnings);
        ytdNetPay += Number(payslip.net_pay);
        ytdTotalDeductions += Number(payslip.total_deductions);

        const deductions =
          typeof payslip.deductions === "string"
            ? JSON.parse(payslip.deductions)
            : payslip.deductions || [];
        const tds = deductions.find((d: any) => d.code === "TDS" || d.code === "INCOME_TAX");
        if (tds) ytdTax += Number(tds.amount);

        monthlyPayslips.push({
          month,
          year,
          grossEarnings: Number(payslip.gross_earnings),
          netPay: Number(payslip.net_pay),
          deductions: Number(payslip.total_deductions),
        });
      }
    }

    // 3. Benefits enrollment
    const benefitsResult = await this.db.findMany<any>("employee_benefits", {
      filters: { empcloud_user_id: numEmpId, empcloud_org_id: numOrgId },
      limit: 100,
    });
    const benefits: any[] = [];
    let totalBenefitEmployerValue = 0;
    let totalBenefitEmployeeValue = 0;

    for (const enrollment of benefitsResult.data) {
      if (enrollment.status === "cancelled") continue;
      const plan = await this.db.findById<any>("benefit_plans", enrollment.plan_id);
      const annualEmployerShare = Number(enrollment.premium_employer_share) * 12;
      const annualEmployeeShare = Number(enrollment.premium_employee_share) * 12;
      totalBenefitEmployerValue += annualEmployerShare;
      totalBenefitEmployeeValue += annualEmployeeShare;
      benefits.push({
        planName: plan?.name || "Unknown Plan",
        type: plan?.type || "other",
        coverageType: enrollment.coverage_type,
        status: enrollment.status,
        monthlyEmployerShare: Number(enrollment.premium_employer_share),
        monthlyEmployeeShare: Number(enrollment.premium_employee_share),
        annualEmployerShare,
        annualEmployeeShare,
      });
    }

    // 4. Loans
    const loansResult = await this.db.findMany<any>("loans", {
      filters: { empcloud_user_id: numEmpId },
      limit: 100,
    });
    const loans = (loansResult?.data || []).map((l: any) => ({
      type: l.type,
      principalAmount: Number(l.principal_amount),
      outstandingAmount: Number(l.outstanding_amount),
      emiAmount: Number(l.emi_amount),
      status: l.status,
    }));

    // 5. Reimbursements for the FY
    const reimbursementsResult = await this.db.findMany<any>("reimbursements", {
      filters: { empcloud_user_id: numEmpId, status: "approved" },
      limit: 500,
    });
    const totalReimbursements = (reimbursementsResult?.data || []).reduce(
      (sum: number, r: any) => sum + Number(r.amount || 0),
      0,
    );

    // Build total compensation
    const totalDirectCompensation = ctc;
    const totalBenefitsValue = totalBenefitEmployerValue;
    const totalRewards = totalDirectCompensation + totalBenefitsValue + totalReimbursements;

    return {
      employee: {
        id: employee.id,
        name: `${employee.first_name} ${employee.last_name}`,
        email: employee.email,
        empCode: employee.emp_code,
        designation: employee.designation,
      },
      financialYear: fy,
      generatedAt: new Date().toISOString(),

      compensation: {
        annualCTC: ctc,
        monthlyGross: grossSalary,
        components: components.map((c: any) => ({
          code: c.code,
          name: c.code === "BASIC" ? "Basic Salary" : c.code,
          monthlyAmount: c.monthlyAmount,
          annualAmount: c.monthlyAmount * 12,
        })),
      },

      ytdEarnings: {
        grossEarnings: ytdGrossEarnings,
        netPay: ytdNetPay,
        totalDeductions: ytdTotalDeductions,
        taxPaid: ytdTax,
        monthsProcessed: monthlyPayslips.length,
        monthly: monthlyPayslips,
      },

      benefits: {
        plans: benefits,
        totalAnnualEmployerContribution: totalBenefitEmployerValue,
        totalAnnualEmployeeContribution: totalBenefitEmployeeValue,
      },

      loans: {
        active: loans.filter((l: any) => l.status === "active"),
        totalOutstanding: loans.reduce((s: number, l: any) => s + l.outstandingAmount, 0),
      },

      reimbursements: {
        totalApproved: totalReimbursements,
      },

      totalRewards: {
        directCompensation: totalDirectCompensation,
        benefitsValue: totalBenefitsValue,
        reimbursements: totalReimbursements,
        grandTotal: totalRewards,
      },
    };
  }

  /**
   * Generate an HTML total rewards statement (for PDF rendering).
   */
  async generateStatementHTML(
    orgId: string,
    employeeId: string,
    financialYear?: string,
    language?: string,
  ): Promise<string> {
    const statement = await this.generateStatement(orgId, employeeId, financialYear);
    const requestedLanguage = (language || "en").toLowerCase().split("-")[0];
    const lang: PrintLanguage = Object.prototype.hasOwnProperty.call(
      totalRewardsPrintLabels,
      requestedLanguage,
    )
      ? (requestedLanguage as PrintLanguage)
      : "en";
    const labels = totalRewardsPrintLabels[lang];
    const locale = printLocales[lang];
    const fmt = (n: number) =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(n);

    const compRows = statement.compensation.components
      .map(
        (c: any) =>
          `<tr><td>${c.name}</td><td class="amt">${fmt(c.monthlyAmount)}</td><td class="amt">${fmt(c.annualAmount)}</td></tr>`,
      )
      .join("");

    const benefitRows =
      statement.benefits.plans
        .map(
          (b: any) =>
            `<tr><td>${b.planName}</td><td>${b.type}</td><td>${b.coverageType}</td><td class="amt">${fmt(b.annualEmployerShare)}</td></tr>`,
        )
        .join("") || `<tr><td colspan="4" class="center">${labels.noBenefits}</td></tr>`;

    return `<!DOCTYPE html>
<html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}">
<head>
<meta charset="UTF-8">
<title>${labels.title} — ${statement.employee.name}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #1a1a1a; padding: 40px; max-width: 900px; margin: 0 auto; }
  .header { border-bottom: 3px solid #4f46e5; padding-bottom: 20px; margin-bottom: 24px; display: flex; justify-content: space-between; }
  .title { font-size: 22px; font-weight: 700; color: #4f46e5; }
  .subtitle { font-size: 13px; color: #666; margin-top: 4px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .info-box { background: #f8f9fa; border-radius: 8px; padding: 16px; }
  .info-box h4 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 8px; }
  .info-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .info-row .label { color: #666; }
  .info-row .value { font-weight: 500; }
  .section { margin-bottom: 24px; }
  .section h3 { font-size: 14px; font-weight: 600; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 2px solid #e5e7eb; color: #374151; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { background: #f3f4f6; padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #666; }
  td { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; }
  td.amt, th.amt { text-align: right; font-variant-numeric: tabular-nums; }
  td.center { text-align: center; color: #999; }
  .total-row td { border-top: 2px solid #e5e7eb; font-weight: 700; background: #fafafa; }
  .grand-total { text-align: center; background: #4f46e5; color: white; border-radius: 8px; padding: 24px; margin: 24px 0; }
  .grand-total .label { font-size: 12px; opacity: 0.8; text-transform: uppercase; letter-spacing: 1px; }
  .grand-total .amount { font-size: 32px; font-weight: 700; margin-top: 4px; }
  .chart { display: flex; gap: 8px; align-items: end; height: 60px; margin: 16px 0; }
  .chart-bar { flex: 1; border-radius: 4px 4px 0 0; min-height: 4px; }
  .footer { border-top: 1px solid #e5e7eb; padding-top: 16px; font-size: 11px; color: #999; text-align: center; }
  .print-btn { display: block; margin: 0 auto 24px; padding: 10px 32px; background: #4f46e5; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
  .print-btn:hover { background: #4338ca; }
  @media print { .no-print { display: none; } body { padding: 20px; } }
</style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">${labels.print}</button>

  <div class="header">
    <div>
      <div class="title">${labels.title}</div>
      <div class="subtitle">${labels.financialYear}: ${statement.financialYear}</div>
    </div>
    <div style="text-align: right;">
      <div style="font-weight: 600;">${statement.employee.name}</div>
      <div class="subtitle">${statement.employee.designation || ""} | ${statement.employee.empCode || ""}</div>
    </div>
  </div>

  <div class="grand-total">
    <div class="label">${labels.totalValue}</div>
    <div class="amount">${fmt(statement.totalRewards.grandTotal)}</div>
  </div>

  <div class="info-grid">
    <div class="info-box">
      <h4>${labels.compensationSummary}</h4>
      <div class="info-row"><span class="label">${labels.annualCtc}</span><span class="value">${fmt(statement.totalRewards.directCompensation)}</span></div>
      <div class="info-row"><span class="label">${labels.benefitsValue}</span><span class="value">${fmt(statement.totalRewards.benefitsValue)}</span></div>
      <div class="info-row"><span class="label">${labels.reimbursements}</span><span class="value">${fmt(statement.totalRewards.reimbursements)}</span></div>
    </div>
    <div class="info-box">
      <h4>${labels.ytdEarnings} (${statement.ytdEarnings.monthsProcessed} ${statement.ytdEarnings.monthsProcessed === 1 ? labels.month : labels.months})</h4>
      <div class="info-row"><span class="label">${labels.grossEarnings}</span><span class="value">${fmt(statement.ytdEarnings.grossEarnings)}</span></div>
      <div class="info-row"><span class="label">${labels.totalDeductions}</span><span class="value">${fmt(statement.ytdEarnings.totalDeductions)}</span></div>
      <div class="info-row"><span class="label">${labels.netPay}</span><span class="value">${fmt(statement.ytdEarnings.netPay)}</span></div>
      <div class="info-row"><span class="label">${labels.taxPaid}</span><span class="value">${fmt(statement.ytdEarnings.taxPaid)}</span></div>
    </div>
  </div>

  <div class="section">
    <h3>${labels.salaryComponents}</h3>
    <table>
      <tr><th>${labels.component}</th><th class="amt">${labels.monthly}</th><th class="amt">${labels.annual}</th></tr>
      ${compRows}
      <tr class="total-row"><td>${labels.totalCtc}</td><td class="amt">${fmt(statement.compensation.monthlyGross)}</td><td class="amt">${fmt(statement.compensation.annualCTC)}</td></tr>
    </table>
  </div>

  <div class="section">
    <h3>${labels.benefits}</h3>
    <table>
      <tr><th>${labels.plan}</th><th>${labels.type}</th><th>${labels.coverage}</th><th class="amt">${labels.employerShare}</th></tr>
      ${benefitRows}
    </table>
  </div>

  <div class="footer">
    ${labels.confidential} | ${labels.generatedOn} ${new Date().toLocaleDateString(locale)}
  </div>
</body>
</html>`;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getFYMonths(fyStartYear: number): { month: number; year: number }[] {
    const months: { month: number; year: number }[] = [];
    // April to March
    for (let m = 4; m <= 12; m++) {
      months.push({ month: m, year: fyStartYear });
    }
    for (let m = 1; m <= 3; m++) {
      months.push({ month: m, year: fyStartYear + 1 });
    }
    return months;
  }
}
