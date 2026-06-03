import { useState, useEffect } from 'react';
import { useData } from '../../contexts/DataContext';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { Exam, ExamResult, Student, Subject } from '../../types';
import { Download, FileText } from 'lucide-react';
import { createPdf, addFooter, drawInfoBox, TABLE_STYLES } from '../../lib/pdfTemplate';
import { savePdf } from '../../lib/download';
import { Spinner } from '../../components/ui';

interface ResultViewProps {
  student: Student;
}

export default function ResultView({ student }: ResultViewProps) {
  const { classesMap } = useData();
  const [results, setResults] = useState<ExamResult[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);

  useEffect(() => {
    if (student) {
      fetchData();
    }
  }, [student]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const examSnapshot = await getDocs(collection(db, 'exams'));
      const examList = examSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Exam));
      setExams(examList);

      const subjectSnapshot = await getDocs(collection(db, 'subjects'));
      setSubjects(subjectSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Subject)));

      const q = query(collection(db, 'examResults'), where('studentId', '==', student.id));
      const resultSnapshot = await getDocs(q);
      const all = resultSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExamResult));
      setResults(all.filter(r => r.published === true));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'exams/subjects/examResults');
    } finally {
      setLoading(false);
    }
  };

  const generatePDF = async (result: ExamResult, exam: Exam) => {
    const { doc, contentY, pageWidth } = await createPdf(
      'Academic Progress Report',
      `${exam.name} · ${exam.term}`,
    );

    let y = contentY + 4;

    y = drawInfoBox(
      doc,
      [
        { label: 'Student', value: student.name },
        { label: 'Admission No', value: student.admissionNumber || '-' },
        { label: 'Class', value: `${classesMap[student.classId] || student.classId} – ${student.section}` },
        { label: 'Date', value: new Date().toLocaleDateString('en-IN') },
      ],
      y,
      pageWidth,
      2,
    );

    y += 6;

    const tableData = result.subjectResults.map((res: any) => {
      const subject = subjects.find((s) => s.id === res.subjectId);
      const isAbsent = res.status === 'absent';
      const isExempt = res.status === 'exempt';
      const pct = res.maxMarks > 0 && !isAbsent && !isExempt
        ? ((res.marksObtained / res.maxMarks) * 100).toFixed(1) : '-';
      const status = isAbsent ? 'Absent' : isExempt ? 'Exempt' : (res.marksObtained >= (res.maxMarks * 0.4) ? 'Pass' : 'Fail');
      return [
        subject?.name || 'Unknown',
        res.maxMarks,
        isAbsent || isExempt ? '-' : res.marksObtained,
        pct === '-' ? '-' : `${pct}%`,
        res.grade,
        status,
      ];
    });

    (doc as any).autoTable({
      startY: y,
      head: [['Subject', 'Max Marks', 'Obtained', '%', 'Grade', 'Status']],
      body: tableData,
      ...TABLE_STYLES,
      columnStyles: {
        5: {
          fontStyle: 'bold',
          cellCallback: (cell: any, data: any) => {
            cell.styles.textColor = data.row.raw[5] === 'Pass' ? [5, 150, 105] : [220, 38, 38];
          },
        },
      },
      margin: { left: 12, right: 12 },
    });

    const finalY: number = (doc as any).lastAutoTable.finalY + 8;

    doc.setFillColor(209, 250, 229);
    doc.roundedRect(12, finalY, pageWidth - 24, 22, 2, 2, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(5, 150, 105);
    doc.text(`Overall Grade: ${result.overallGrade}`, 20, finalY + 8);
    doc.text(`Percentage: ${result.percentage.toFixed(2)}%`, 20, finalY + 16);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `Total: ${result.totalMarks} / ${result.subjectResults.reduce((s: number, r: any) => s + r.maxMarks, 0)}`,
      pageWidth - 20, finalY + 8, { align: 'right' }
    );
    doc.text(
      result.percentage >= 40 ? 'RESULT: PASS' : 'RESULT: FAIL',
      pageWidth - 20, finalY + 16, { align: 'right' }
    );

    addFooter(doc);
    await savePdf(doc, `${student.name}_${exam.name}_Report.pdf`);
  };

  if (loading) return <Spinner />;

  const visibleResults = selectedExamId
    ? results.filter(r => r.examId === selectedExamId)
    : results;

  return (
    <div className="stack pad">
      <div className="topbar">
        <div>
          <div className="eyebrow">{student.name}</div>
          <h1>Grades</h1>
        </div>
      </div>

      {results.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <FileText style={{ width: 40, height: 40, margin: '0 auto 0.75rem', opacity: 0.25 }} />
          <div style={{ fontWeight: 600, color: 'var(--ink)' }}>No Results Published</div>
          <div className="muted" style={{ fontSize: '0.82rem', marginTop: '0.25rem' }}>
            Examination results for the current term haven't been published yet.
          </div>
        </div>
      ) : (
        <>
          <div className="hscroll" style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className={`chip${selectedExamId === null ? ' solid' : ''}`}
              onClick={() => setSelectedExamId(null)}
            >
              All
            </button>
            {results.map(r => {
              const exam = exams.find(e => e.id === r.examId);
              if (!exam) return null;
              return (
                <button
                  key={r.id}
                  className={`chip${selectedExamId === r.examId ? ' solid' : ''}`}
                  onClick={() => setSelectedExamId(r.examId)}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {exam.name}
                </button>
              );
            })}
          </div>

          <div className="stack">
            {visibleResults.map((result) => {
              const exam = exams.find(e => e.id === result.examId);
              if (!exam) return null;
              const totalMax = result.subjectResults.reduce((s: number, r: any) => s + r.maxMarks, 0);

              return (
                <div key={result.id} className="card stack">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
                    <div>
                      <div className="eyebrow">{exam.term}</div>
                      <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--ink)' }}>{exam.name}</div>
                    </div>
                    <button className="btn ghost" onClick={() => generatePDF(result, exam)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}>
                      <Download style={{ width: 14, height: 14 }} /> Download PDF
                    </button>
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--line)' }}>
                          <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--ink)', opacity: 0.5, fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Subject</th>
                          <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem', color: 'var(--ink)', opacity: 0.5, fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Marks</th>
                          <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem', color: 'var(--ink)', opacity: 0.5, fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Grade</th>
                          <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem', color: 'var(--ink)', opacity: 0.5, fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.subjectResults.map((res: any) => {
                          const subject = subjects.find(s => s.id === res.subjectId);
                          const isAbsent = res.status === 'absent';
                          const isExempt = res.status === 'exempt';
                          const pct = res.maxMarks > 0 && !isAbsent && !isExempt
                            ? ((res.marksObtained / res.maxMarks) * 100).toFixed(1)
                            : '–';
                          return (
                            <tr key={res.subjectId} style={{ borderBottom: '1px solid var(--line)' }}>
                              <td style={{ padding: '0.45rem 0.5rem', fontWeight: 500 }}>{subject?.name || res.subjectId}</td>
                              <td style={{ textAlign: 'center', padding: '0.45rem 0.5rem' }} className="t-num">
                                {isAbsent ? <span className="muted">Absent</span> : isExempt ? <span className="muted">Exempt</span> : `${res.marksObtained} / ${res.maxMarks}`}
                              </td>
                              <td style={{ textAlign: 'center', padding: '0.45rem 0.5rem', fontWeight: 700 }}>{res.grade}</td>
                              <td style={{ textAlign: 'center', padding: '0.45rem 0.5rem' }} className="t-num">{pct !== '–' ? `${pct}%` : '–'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.625rem 0.5rem', borderTop: '2px solid var(--line)', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                      <div>
                        <div className="eyebrow" style={{ fontSize: '0.62rem' }}>Total</div>
                        <div className="t-num" style={{ fontWeight: 700, fontSize: '1.05rem' }}>{result.totalMarks} <span className="muted" style={{ fontWeight: 400, fontSize: '0.75rem' }}>/ {totalMax}</span></div>
                      </div>
                      <div>
                        <div className="eyebrow" style={{ fontSize: '0.62rem' }}>Overall Grade</div>
                        <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--accent)' }}>{result.overallGrade}</div>
                      </div>
                      <div>
                        <div className="eyebrow" style={{ fontSize: '0.62rem' }}>Percentage</div>
                        <div className="t-num" style={{ fontWeight: 700, fontSize: '1.05rem' }}>{result.percentage.toFixed(1)}%</div>
                      </div>
                    </div>
                    <span style={{
                      padding: '0.2rem 0.75rem', borderRadius: 99, fontSize: '0.78rem', fontWeight: 700,
                      background: result.percentage >= 40 ? 'color-mix(in srgb, var(--leaf) 15%, transparent)' : 'color-mix(in srgb, var(--coral) 15%, transparent)',
                      color: result.percentage >= 40 ? 'var(--leaf)' : 'var(--coral)',
                    }}>
                      {result.percentage >= 40 ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
