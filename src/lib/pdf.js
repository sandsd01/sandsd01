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

function generateReceiptPdf(sale, shop = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // A VAT-registered shop must issue a tax invoice rather than a plain
    // receipt, and it has to carry the legal name, tax id and branch.
    const isTaxInvoice = Boolean(shop.vatRegistered && shop.taxId);
    doc.fontSize(20).text(isTaxInvoice ? "Tax Invoice (Abbreviated)" : "Receipt", { underline: true });
    doc.moveDown(0.5);

    if (shop.legalName) doc.fontSize(12).text(shop.legalName);
    if (shop.address) doc.fontSize(10).text(shop.address);
    if (shop.taxId) doc.fontSize(10).text(`Tax ID: ${shop.taxId}`);
    if (shop.legalName || shop.address || shop.taxId) doc.moveDown(0.5);

    doc.fontSize(12).text(`Receipt no: ${sale.receiptNumber || `#${sale.id}`}`);
    const branchCode = sale.location?.taxBranchCode;
    doc.text(`Branch: ${sale.location?.name || "-"}${branchCode ? ` (${branchCode})` : ""}`);
    doc.text(`Date: ${new Date(sale.createdAt).toLocaleString()}`);
    doc.text(`Cashier: ${sale.cashier?.email || "-"}`);
    if (sale.status === "voided") {
      doc.text(`Status: VOIDED`);
    }
    doc.moveDown();

    doc.fontSize(14).text("Items");
    sale.items.forEach((item) => {
      doc
        .fontSize(11)
        .text(`${item.productName} x${item.quantity} @ ${item.unitPrice.toFixed(2)} = ${item.lineTotal.toFixed(2)}`);
      (item.modifiers || []).forEach((mod) => {
        doc.fontSize(10).text(`   + ${mod.name} (${mod.priceDelta >= 0 ? "+" : ""}${mod.priceDelta.toFixed(2)})`);
      });
    });
    doc.moveDown();

    doc.fontSize(14).text("Payment");
    if (sale.taxAmount) {
      // Show the net/VAT split both ways round: with inclusive pricing the
      // subtotal already contains the VAT, so printing them as if they summed
      // would overstate the bill.
      if (sale.taxInclusive) {
        doc.fontSize(12).text(`Net of VAT: ${(sale.subtotal - sale.taxAmount).toFixed(2)}`);
        doc.text(`VAT ${(sale.taxRate * 100).toFixed(0)}% (included): ${sale.taxAmount.toFixed(2)}`);
      } else {
        doc.fontSize(12).text(`Subtotal: ${sale.subtotal.toFixed(2)}`);
        doc.text(`VAT ${(sale.taxRate * 100).toFixed(0)}%: ${sale.taxAmount.toFixed(2)}`);
      }
    } else {
      doc.fontSize(12).text(`Subtotal: ${sale.subtotal.toFixed(2)}`);
    }
    doc.text(`Total: ${sale.total.toFixed(2)}`);
    doc.text(`Payment method: ${sale.paymentMethod}`);
    if (sale.amountTendered != null) {
      doc.text(`Amount tendered: ${sale.amountTendered.toFixed(2)}`);
    }
    if (sale.changeDue != null) {
      doc.text(`Change due: ${sale.changeDue.toFixed(2)}`);
    }
    if (sale.note) {
      doc.moveDown();
      doc.text(`Note: ${sale.note}`);
    }
    if (sale.status === "voided") {
      doc.moveDown();
      doc
        .fontSize(12)
        .text(`Voided ${sale.voidedAt ? new Date(sale.voidedAt).toLocaleString() : ""} by ${sale.voidedBy?.email || "-"}`);
    }

    doc.end();
  });
}

module.exports = { buildSummaryPdf, generateReceiptPdf };
