const PDFDocument = require("pdfkit");

function buildSummaryPdf(summary) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text("Inventory Summary Report", { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(`Generated: ${new Date().toLocaleString()}`);
    doc.moveDown();

    doc.fontSize(14).text("Overview");
    doc.fontSize(12).text(`Total products: ${summary.totalProducts}`);
    doc.text(`Total units in stock: ${summary.totalQuantity}`);
    doc.text(`Total inventory value: ${summary.totalValue.toFixed(2)}`);
    doc.text(`Low on stock: ${summary.lowStockCount}`);
    doc.moveDown();

    doc.fontSize(14).text("Low stock products");
    if (summary.lowStockProducts.length === 0) {
      doc.fontSize(12).text("Nothing is low on stock right now.");
    } else {
      summary.lowStockProducts.forEach((p) => {
        doc.fontSize(11).text(`${p.sku} - ${p.name}: ${p.quantity} (reorder at ${p.reorderLevel})`);
      });
    }
    doc.moveDown();

    doc.fontSize(14).text("Recent movements");
    if (summary.recentMovements.length === 0) {
      doc.fontSize(12).text("No stock movements recorded yet.");
    } else {
      summary.recentMovements.forEach((m) => {
        doc
          .fontSize(11)
          .text(
            `${new Date(m.createdAt).toLocaleString()} - ${m.product.name} (${m.product.sku}): ${m.type} ${m.quantity} by ${m.createdByEmail}`
          );
      });
    }

    doc.end();
  });
}

module.exports = { buildSummaryPdf };
