/**
 * Trigger the browser print dialog. The application already has @media print
 * rules in src/styles.css that hide the app chrome and expand the main area.
 *
 * Optional title sets document.title temporarily so the PDF / print job has a
 * meaningful name when the user selects "Save as PDF".
 */
export function printReport(title?: string) {
  const previousTitle = document.title;
  if (title) document.title = title;
  // Defer so any layout updates settle first
  setTimeout(() => {
    window.print();
    if (title) {
      // Restore after the print dialog closes (best-effort)
      setTimeout(() => {
        document.title = previousTitle;
      }, 500);
    }
  }, 50);
}
