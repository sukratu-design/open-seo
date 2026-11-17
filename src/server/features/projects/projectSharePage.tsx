import { renderToStaticMarkup } from "react-dom/server";
import { GoogleDashboardCacheService } from "@/server/features/dashboard/services/GoogleDashboardCacheService";
import { ProjectShareService } from "./services/ProjectShareService";
import { ProjectShareRepository } from "./repositories/ProjectShareRepository";

const styles = `body{font:16px/1.6 system-ui,sans-serif;margin:0;background:#f5f7fa;color:#172033}main{max-width:960px;margin:auto;padding:32px 20px}section{background:white;border:1px solid #dbe1e8;border-radius:12px;padding:20px;margin:20px 0}h1,h2{line-height:1.3}h2{font-size:20px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px;border-bottom:1px solid #eee}footer,p{color:#475569}svg{max-width:100%;height:80px}`;
function response(title: string, body: React.ReactNode, status = 200) {
  return new Response(
    `<!doctype html>${renderToStaticMarkup(
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="robots" content="noindex,nofollow" />
          <title>{title}</title>
          <style>{styles}</style>
        </head>
        <body>
          <main>{body}</main>
        </body>
      </html>,
    )}`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow",
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    },
  );
}
const unavailable = <p>Not available yet</p>;
export async function projectShareResponse(token: string): Promise<Response> {
  const project = await ProjectShareService.lookup(token);
  if (!project)
    return response(
      "Link unavailable",
      <p>This link is invalid or has been revoked.</p>,
      404,
    );
  const [report, gsc, ga4] = await Promise.all([
    ProjectShareRepository.report(project.id),
    GoogleDashboardCacheService.getCachedOnly(
      "gsc",
      project.id,
      project.organizationId,
    ),
    GoogleDashboardCacheService.getCachedOnly(
      "ga4",
      project.id,
      project.organizationId,
    ),
  ]);
  const dates = [
    gsc?.fetchedAt,
    ga4?.fetchedAt,
    report.audit?.completedAt,
    report.backlinks?.capturedAt,
    ...report.ranks.map((row) => row.checkedAt),
  ].filter((value): value is string => !!value);
  return response(
    `SEO report — ${project.name}`,
    <>
      <header>
        <h1>SEO report — {project.name}</h1>
        <p>{project.domain ?? "Website not set"}</p>
      </header>
      <section>
        <h2>Search Console</h2>
        {gsc ? (
          <>
            <p>
              {gsc.value.startDate} to {gsc.value.endDate}
            </p>
            <p>
              Clicks: {gsc.value.totals.clicks ?? "—"} · Impressions:{" "}
              {gsc.value.totals.impressions ?? "—"} · CTR:{" "}
              {gsc.value.totals.ctr != null
                ? (100 * gsc.value.totals.ctr).toFixed(2) + "%"
                : "—"}{" "}
              · Average position: {gsc.value.totals.position?.toFixed(1) ?? "—"}
            </p>
            <Sparkline rows={gsc.value.trend} label="Daily search clicks" />
          </>
        ) : (
          unavailable
        )}
      </section>
      <section>
        <h2>Google Analytics</h2>
        {ga4 ? (
          <>
            <p>
              Organic search, {ga4.value.startDate} to {ga4.value.endDate}
            </p>
            <p>
              Sessions: {ga4.value.totals.sessions ?? "—"} · Active users:{" "}
              {ga4.value.totals.activeUsers ?? "—"} · Key events:{" "}
              {ga4.value.totals.keyEvents ?? "—"}
            </p>
            <Sparkline rows={ga4.value.trend} label="Daily organic sessions" />
          </>
        ) : (
          unavailable
        )}
      </section>
      <section>
        <h2>Site health</h2>
        {report.audit ? (
          <p>
            Latest completed audit: {report.audit.pages} pages crawled.
            Completed {report.audit.completedAt}.
          </p>
        ) : (
          unavailable
        )}
      </section>
      <section>
        <h2>Tracked keywords</h2>
        {report.ranks.length ? (
          <>
            <p>Positive change means a higher ranking.</p>
            <table>
              <thead>
                <tr>
                  <th>Keyword</th>
                  <th>Device</th>
                  <th>Position</th>
                  <th>Change</th>
                  <th>Checked</th>
                </tr>
              </thead>
              <tbody>
                {report.ranks.map((row, index) => (
                  <tr key={index}>
                    <td>{row.keyword}</td>
                    <td>{row.device}</td>
                    <td>{row.position ?? "Not available yet"}</td>
                    <td>{row.change ?? "—"}</td>
                    <td>{row.checkedAt ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          unavailable
        )}
      </section>
      <section>
        <h2>Backlinks</h2>
        {report.backlinks ? (
          <p>
            Backlinks: {report.backlinks.backlinks ?? "—"} · Referring domains:{" "}
            {report.backlinks.referringDomains ?? "—"}. Captured{" "}
            {report.backlinks.capturedAt}.
          </p>
        ) : (
          unavailable
        )}
      </section>
      <footer>
        Read-only report shared from OpenSEO. Data as of{" "}
        {dates.length ? [...new Set(dates)].join(", ") : "not available yet"}.
      </footer>
    </>,
  );
}

function Sparkline({
  rows,
  label,
}: {
  rows: { date: string; value: number }[];
  label: string;
}) {
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((row) => row.value));
  const points = rows
    .map(
      (row, index) =>
        `${(index * 600) / Math.max(1, rows.length - 1)},${75 - (row.value / max) * 70}`,
    )
    .join(" ");
  return (
    <svg viewBox="0 0 600 80" role="img" aria-label={label}>
      <title>{label}</title>
      <polyline points={points} fill="none" stroke="#2563eb" strokeWidth="2" />
    </svg>
  );
}
