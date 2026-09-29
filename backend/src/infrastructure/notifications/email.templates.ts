export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function emailCard(options: {
	heading: string;
	introHtml: string;
	button?: { label: string; url: string };
	bodyHtml?: string;
	footerHtml?: string;
	wide?: boolean;
}): string {
	const maxWidth = options.wide ? "650px" : "520px";
	return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:${maxWidth};margin:0 auto;padding:24px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;">
    <h2 style="margin:0 0 8px;font-size:18px;color:#0f172a;">${options.heading}</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#475569;">${options.introHtml}</p>
    ${options.button ? `<a href="${options.button.url}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:700;">${options.button.label}</a>` : ""}
    ${options.bodyHtml ?? ""}
    <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;">${options.footerHtml ?? "— Attendance Monitor"}</p>
  </div>`;
}

export function detailRows(rows: Array<[string, string]>): string {
	return `<table style="width:100%;border-collapse:collapse;margin-top:4px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;font-size:13px;">${rows.map(([label, value]) => `<tr><td style="padding:8px 12px;color:#64748b;width:40%;">${label}</td><td style="padding:8px 12px;color:#0f172a;font-weight:600;">${value}</td></tr>`).join("")}</table>`;
}
