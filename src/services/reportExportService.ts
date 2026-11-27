import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import ExcelJS from 'exceljs';
import { COMPANY_LOGO_PATH } from '../components/BrandMark';
import {
  Classroom,
  Grade,
  PickupRequest,
  ReportSummary,
  Section,
  SectionReportRow,
} from '../types/nidaa';
import {
  calculateWaitMinutes,
  formatDateRiyadh,
  formatTimeRiyadh,
  formatWaitDurationArabic,
  getStatusLabel,
  getTodayRiyadhInputDate,
} from '../utils/formatters';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveExcelWorkbook(wb: ExcelJS.Workbook, filename: string) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, filename);
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0E4D3A' },
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  row.height = 24;
}

// ============================================================================
// 1. قالب استيراد الطالبات + قراءة ملف Excel
// ============================================================================
export async function downloadStudentImportTemplate(
  sections: Section[],
  grades: Grade[],
  classrooms: Classroom[]
) {
  const sampleSection = sections[0]?.name ?? 'الابتدائي';
  const sampleGrade =
    grades.find((g) => g.sectionId === sections[0]?.id)?.name ??
    'الأول الابتدائي';
  const sampleClass =
    classrooms.find((c) => c.sectionId === sections[0]?.id)?.name ?? 'أ';

  const wb = new ExcelJS.Workbook();

  const wsTemplate = wb.addWorksheet('بيانات الطالبات', {
    views: [{ rightToLeft: true }],
  });
  wsTemplate.columns = [
    { header: 'الاسم الكامل', key: 'fullName', width: 30 },
    { header: 'القسم', key: 'sectionName', width: 22 },
    { header: 'الصف', key: 'gradeName', width: 22 },
    { header: 'الفصل', key: 'classroomName', width: 18 },
    { header: 'الرقم السري (اختياري)', key: 'pin', width: 22 },
  ];
  styleHeaderRow(wsTemplate.getRow(1));
  wsTemplate.addRow({
    fullName: 'مثال: سارة محمد العتيبي',
    sectionName: sampleSection,
    gradeName: sampleGrade,
    classroomName: sampleClass,
    pin: '',
  });

  const wsGuide = wb.addWorksheet('الأقسام والفصول المعتمدة', {
    views: [{ rightToLeft: true }],
  });
  wsGuide.columns = [
    { header: 'القسم المعتمد', key: 'sectionName', width: 24 },
    { header: 'الصف المعتمد', key: 'gradeName', width: 24 },
    { header: 'الفصل المعتمد', key: 'classroomName', width: 22 },
  ];
  styleHeaderRow(wsGuide.getRow(1));

  if (classrooms.length > 0) {
    classrooms.forEach((cls) => {
      const sec = sections.find((s) => s.id === cls.sectionId);
      const gr = grades.find((g) => g.id === cls.gradeId);
      wsGuide.addRow({
        sectionName: sec?.name ?? '',
        gradeName: gr?.name ?? '',
        classroomName: cls.name,
      });
    });
  } else {
    sections.forEach((s) => {
      wsGuide.addRow({
        sectionName: s.name,
        gradeName: '',
        classroomName: '',
      });
    });
  }

  await saveExcelWorkbook(wb, 'قالب_استيراد_الطالبات_منصة_نداء.xlsx');
}

export async function parseStudentsExcel(file: File): Promise<
  {
    fullName: string;
    sectionName: string;
    gradeName: string;
    classroomName: string;
    pin?: string;
  }[]
> {
  const buffer = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];

  const extractCellText = (val: ExcelJS.CellValue): string => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      return String(val).trim();
    }
    if (val instanceof Date) {
      return val.toISOString();
    }
    if (typeof val === 'object') {
      if ('richText' in val && Array.isArray(val.richText)) {
        return val.richText.map((part) => part.text ?? '').join('').trim();
      }
      if ('result' in val && val.result !== undefined) {
        return extractCellText(val.result as ExcelJS.CellValue);
      }
      if ('text' in val && typeof val.text === 'string') {
        return val.text.trim();
      }
    }
    return '';
  };

  const headerMap: Record<number, string> = {};
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell, colNumber) => {
    headerMap[colNumber] = extractCellText(cell.value);
  });

  const parsed: {
    fullName: string;
    sectionName: string;
    gradeName: string;
    classroomName: string;
    pin?: string;
  }[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, string> = {};
    row.eachCell((cell, colNumber) => {
      const key = headerMap[colNumber];
      if (key) {
        record[key] = extractCellText(cell.value);
      }
    });

    const fullName =
      record['الاسم الكامل'] ||
      record['اسم الطالبة'] ||
      record['fullName'] ||
      '';
    if (!fullName || fullName.startsWith('مثال:')) return;

    parsed.push({
      fullName,
      sectionName: record['القسم'] || record['sectionName'] || '',
      gradeName: record['الصف'] || record['gradeName'] || '',
      classroomName: record['الفصل'] || record['classroomName'] || '',
      pin:
        record['الرقم السري (اختياري)'] ||
        record['الرقم السري'] ||
        record['pin'] ||
        '',
    });
  });

  return parsed;
}

export async function exportGeneratedPinsToExcel(
  rows: {
    fullName: string;
    sectionName: string;
    gradeName: string;
    classroomName: string;
    issuedPin: string;
  }[]
) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('الأرقام السرية الصادرة', {
    views: [{ rightToLeft: true }],
  });
  ws.columns = [
    { header: 'م', key: 'index', width: 8 },
    { header: 'اسم الطالبة', key: 'fullName', width: 28 },
    { header: 'القسم', key: 'sectionName', width: 20 },
    { header: 'الصف', key: 'gradeName', width: 20 },
    { header: 'الفصل', key: 'classroomName', width: 16 },
    { header: 'الرقم السري الصادر', key: 'issuedPin', width: 18 },
  ];
  styleHeaderRow(ws.getRow(1));

  rows.forEach((r, i) => {
    ws.addRow({
      index: i + 1,
      fullName: r.fullName,
      sectionName: r.sectionName,
      gradeName: r.gradeName,
      classroomName: r.classroomName,
      issuedPin: r.issuedPin,
    });
  });

  await saveExcelWorkbook(
    wb,
    `الأرقام_السرية_الطالبات_${getTodayRiyadhInputDate()}.xlsx`
  );
}

// ============================================================================
// 2. تصدير تقارير النداءات Excel (.xlsx) و Word (.docx) بالهوية الرسمية
// ============================================================================
export async function exportCallsToExcel(
  calls: PickupRequest[],
  sectionStats: SectionReportRow[],
  summary: ReportSummary,
  rangeLabel: string
) {
  const wb = new ExcelJS.Workbook();

  // Sheet 1: Summary
  const wsSummary = wb.addWorksheet('ملخص التقرير', {
    views: [{ rightToLeft: true }],
  });
  wsSummary.columns = [
    { header: 'المؤشر', key: 'label', width: 30 },
    { header: 'القيمة', key: 'value', width: 42 },
  ];
  styleHeaderRow(wsSummary.getRow(1));
  [
    { label: 'الجهة', value: 'شركة تربية الأجيال الأهلية — منصة نداء' },
    { label: 'الفترة', value: rangeLabel },
    { label: 'إجمالي النداءات', value: summary.totalCalls },
    { label: 'الطلبات الجديدة', value: summary.newCalls },
    { label: 'قيد الانتظار', value: summary.waitingCalls },
    { label: 'الطالبات المنصرفات', value: summary.exitedCalls },
    { label: 'الطلبات الملغاة', value: summary.cancelledCalls },
    { label: 'متوسط مدة الانتظار (دقيقة)', value: summary.avgWaitMinutes },
    { label: 'إعداد', value: 'مهندسة النظم : موضي البديني' },
  ].forEach((r) => wsSummary.addRow(r));

  // Sheet 2: Section Stats
  const wsStats = wb.addWorksheet('إحصائيات الأقسام', {
    views: [{ rightToLeft: true }],
  });
  wsStats.columns = [
    { header: 'القسم', key: 'sectionName', width: 24 },
    { header: 'إجمالي النداءات', key: 'total', width: 18 },
    { header: 'طلب جديد', key: 'newCount', width: 14 },
    { header: 'تم النداء', key: 'calledCount', width: 14 },
    { header: 'تم الخروج', key: 'exitedCount', width: 14 },
    { header: 'ملغي', key: 'cancelledCount', width: 14 },
  ];
  styleHeaderRow(wsStats.getRow(1));
  sectionStats.forEach((row) => wsStats.addRow(row));

  // Sheet 3: Detailed Calls
  const wsCalls = wb.addWorksheet('سجل النداءات', {
    views: [{ rightToLeft: true }],
  });
  wsCalls.columns = [
    { header: 'م', key: 'index', width: 6 },
    { header: 'اسم الطالبة', key: 'studentName', width: 26 },
    { header: 'القسم', key: 'sectionName', width: 18 },
    { header: 'الصف', key: 'gradeName', width: 18 },
    { header: 'الفصل', key: 'classroomName', width: 16 },
    { header: 'وقت الوصول', key: 'requestedAt', width: 14 },
    { header: 'وقت النداء', key: 'calledAt', width: 14 },
    { header: 'وقت الخروج', key: 'exitedAt', width: 14 },
    { header: 'مدة الانتظار', key: 'wait', width: 18 },
    { header: 'الحالة', key: 'status', width: 14 },
    { header: 'المسؤولة', key: 'handledBy', width: 20 },
  ];
  styleHeaderRow(wsCalls.getRow(1));

  calls.forEach((call, idx) => {
    const waitMins = calculateWaitMinutes(
      call.requestedAt,
      call.exitedAt ?? call.calledAt ?? call.cancelledAt
    );
    wsCalls.addRow({
      index: idx + 1,
      studentName: call.studentName,
      sectionName: call.sectionName,
      gradeName: call.gradeName,
      classroomName: call.classroomName,
      requestedAt: formatTimeRiyadh(call.requestedAt),
      calledAt: formatTimeRiyadh(call.calledAt),
      exitedAt: formatTimeRiyadh(call.exitedAt),
      wait: formatWaitDurationArabic(waitMins),
      status: getStatusLabel(call.status),
      handledBy: call.handledByName ?? '—',
    });
  });

  await saveExcelWorkbook(
    wb,
    `تقرير_منصة_نداء_${getTodayRiyadhInputDate()}.xlsx`
  );
}

function makeRtlCell(text: string, isHeader = false): TableCell {
  return new TableCell({
    shading: isHeader
      ? { type: ShadingType.SOLID, color: '0E4D3A', fill: '0E4D3A' }
      : undefined,
    margins: {
      top: 90,
      bottom: 90,
      left: 110,
      right: 110,
    },
    children: [
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text,
            bold: isHeader,
            color: isHeader ? 'FFFFFF' : '11181C',
            size: isHeader ? 20 : 18,
            font: 'Arial',
            rightToLeft: true,
          }),
        ],
      }),
    ],
  });
}

async function fetchLogoBytes(): Promise<Uint8Array | null> {
  try {
    const res = await fetch(COMPANY_LOGO_PATH);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) return null;
    const buf = await res.arrayBuffer();
    return buf.byteLength > 0 ? new Uint8Array(buf) : null;
  } catch {
    return null;
  }
}

export async function exportCallsToWord(
  calls: PickupRequest[],
  sectionStats: SectionReportRow[],
  summary: ReportSummary,
  rangeLabel: string
) {
  const logoBytes = await fetchLogoBytes();

  const summaryTableRows = [
    new TableRow({
      tableHeader: true,
      children: [
        makeRtlCell('إجمالي النداءات', true),
        makeRtlCell('الطلبات الجديدة', true),
        makeRtlCell('قيد الانتظار', true),
        makeRtlCell('المنصرفات', true),
        makeRtlCell('الملغاة', true),
        makeRtlCell('متوسط الانتظار', true),
      ],
    }),
    new TableRow({
      children: [
        makeRtlCell(String(summary.totalCalls)),
        makeRtlCell(String(summary.newCalls)),
        makeRtlCell(String(summary.waitingCalls)),
        makeRtlCell(String(summary.exitedCalls)),
        makeRtlCell(String(summary.cancelledCalls)),
        makeRtlCell(`${summary.avgWaitMinutes} دقيقة`),
      ],
    }),
  ];

  const deptHeaderTitles = [
    'القسم',
    'الإجمالي',
    'طلب جديد',
    'تم النداء',
    'تم الخروج',
    'ملغي',
  ];

  const deptTableRows = [
    new TableRow({
      tableHeader: true,
      children: deptHeaderTitles.map((title) => makeRtlCell(title, true)),
    }),
    ...sectionStats.map(
      (row) =>
        new TableRow({
          children: [
            makeRtlCell(row.sectionName),
            makeRtlCell(String(row.total)),
            makeRtlCell(String(row.newCount)),
            makeRtlCell(String(row.calledCount)),
            makeRtlCell(String(row.exitedCount)),
            makeRtlCell(String(row.cancelledCount)),
          ],
        })
    ),
  ];

  const callHeaderTitles = [
    'م',
    'اسم الطالبة',
    'القسم',
    'الصف والفصل',
    'وقت الوصول',
    'وقت الخروج',
    'مدة الانتظار',
    'الحالة',
  ];

  const callTableRows = [
    new TableRow({
      tableHeader: true,
      children: callHeaderTitles.map((title) => makeRtlCell(title, true)),
    }),
    ...calls.map((call, index) => {
      const waitMins = calculateWaitMinutes(
        call.requestedAt,
        call.exitedAt ?? call.calledAt ?? call.cancelledAt
      );
      return new TableRow({
        children: [
          makeRtlCell(String(index + 1)),
          makeRtlCell(call.studentName),
          makeRtlCell(call.sectionName),
          makeRtlCell(`${call.gradeName} - ${call.classroomName}`),
          makeRtlCell(formatTimeRiyadh(call.requestedAt)),
          makeRtlCell(formatTimeRiyadh(call.exitedAt)),
          makeRtlCell(formatWaitDurationArabic(waitMins)),
          makeRtlCell(getStatusLabel(call.status)),
        ],
      });
    }),
  ];

  const tableBorders = {
    top: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' },
    left: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' },
    right: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
    insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
  };

  const docChildren: (Paragraph | Table)[] = [];

  if (logoBytes) {
    docChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 140 },
        children: [
          new ImageRun({
            data: logoBytes,
            type: 'jpg',
            transformation: {
              width: 110,
              height: 82,
            },
          }),
        ],
      })
    );
  }

  docChildren.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: 'شركة تربية الأجيال الأهلية',
          bold: true,
          size: 30,
          color: '0E4D3A',
          font: 'Arial',
          rightToLeft: true,
        }),
      ],
    }),
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: 'تقرير متابعة النداءات والإحصائيات — منصة نداء',
          bold: true,
          size: 24,
          color: '11181C',
          font: 'Arial',
          rightToLeft: true,
        }),
      ],
    }),
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { after: 280 },
      children: [
        new TextRun({
          text: `الفترة: ${rangeLabel}  |  تاريخ الإصدار: ${formatDateRiyadh()} (توقيت الرياض)`,
          size: 18,
          color: '525D63',
          font: 'Arial',
          rightToLeft: true,
        }),
      ],
    }),
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.RIGHT,
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: 'أولاً: الملخص التنفيذي للنداءات',
          bold: true,
          size: 22,
          color: '0E4D3A',
          font: 'Arial',
          rightToLeft: true,
        }),
      ],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      visuallyRightToLeft: true,
      borders: tableBorders,
      rows: summaryTableRows,
    }),
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.RIGHT,
      spacing: { before: 280, after: 120 },
      children: [
        new TextRun({
          text: 'ثانياً: إحصائيات كل قسم',
          bold: true,
          size: 22,
          color: '0E4D3A',
          font: 'Arial',
          rightToLeft: true,
        }),
      ],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      visuallyRightToLeft: true,
      borders: tableBorders,
      rows: deptTableRows,
    }),
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.RIGHT,
      spacing: { before: 280, after: 120 },
      children: [
        new TextRun({
          text: 'ثالثاً: السجل التفصيلي للنداءات',
          bold: true,
          size: 22,
          color: '0E4D3A',
          font: 'Arial',
          rightToLeft: true,
        }),
      ],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      visuallyRightToLeft: true,
      borders: tableBorders,
      rows: callTableRows,
    }),
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { before: 380, after: 60 },
      children: [
        new TextRun({
          text: 'مهندسة النظم : موضي البديني',
          size: 20,
          color: '525D63',
          font: 'Arial',
          rightToLeft: true,
        }),
      ],
    }),
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'شركة تربية الأجيال الأهلية',
          bold: true,
          size: 20,
          color: '0E4D3A',
          font: 'Arial',
          rightToLeft: true,
        }),
      ],
    })
  );

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: docChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `تقرير_منصة_نداء_${getTodayRiyadhInputDate()}.docx`);
}
