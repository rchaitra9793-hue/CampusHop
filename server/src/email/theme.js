// The palette the app itself uses, so a notification looks like it came
// from CampusHop rather than from a mailing tool.
const COLORS = {
  paper: "#fffaf6",
  card: "#ffffff",
  ink: "#2b2622",
  muted: "#81756d",
  line: "#e6dcd4",

  coral: "#ff8fa3",
  coralDark: "#e87389",

  sage: "#8fa876",
  sageLight: "#e8efdf",

  lavenderLight: "#eeeafb",
  lavenderInk: "#5a4b8a",
};

/** Escapes anything a user typed before it goes near the HTML. */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A "bulletproof" button.
 *
 * Outlook ignores padding on an anchor, so the shape has to come from a
 * table cell. This is the shape that survives every major client.
 */
function button(href, label, { background, color = "#ffffff", border }) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
      <tr>
        <td align="center" bgcolor="${background}" style="border-radius:999px;${
          border ? `border:1px solid ${border};` : ""
        }">
          <a href="${esc(href)}"
             style="display:inline-block;padding:14px 30px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:${color};text-decoration:none;border-radius:999px;">
            ${esc(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

/** One "LABEL / value" row of the details block. */
function detailRow(label, value) {
  if (value == null || value === "") return "";

  return `
    <tr>
      <td style="padding:9px 0;border-bottom:1px solid ${COLORS.line};font-family:'Courier New',Courier,monospace;font-size:11px;letter-spacing:0.08em;color:${COLORS.muted};text-transform:uppercase;white-space:nowrap;">
        ${esc(label)}
      </td>
      <td align="right" style="padding:9px 0;border-bottom:1px solid ${COLORS.line};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:${COLORS.ink};">
        ${esc(value)}
      </td>
    </tr>`;
}

/**
 * The shell every notification is poured into: banner, card, footer.
 *
 * Tables and inline styles throughout — email clients have no reliable
 * flexbox, no grid, and Gmail strips <style> blocks, so the layout has to
 * be the kind that worked in 2005.
 */
function layout({ title, preheader, bannerColor, bannerText, body }) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${esc(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:${COLORS.paper};">

    <!-- The line shown in the inbox list, next to the subject. -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      ${esc(preheader)}
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.paper};">
      <tr>
        <td align="center" style="padding:28px 14px;">

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${COLORS.card};border:1px solid ${COLORS.line};border-radius:18px;overflow:hidden;">

            <tr>
              <td style="background:${bannerColor};padding:26px 32px;">
                <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;color:${COLORS.ink};letter-spacing:-0.02em;">
                  CampusHop
                </div>
                <div style="margin-top:5px;font-family:'Courier New',Courier,monospace;font-size:11px;letter-spacing:0.14em;color:${COLORS.ink};opacity:0.72;text-transform:uppercase;">
                  ${esc(bannerText)}
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:30px 32px 34px;">
                ${body}
              </td>
            </tr>
          </table>

          <div style="max-width:560px;margin:16px auto 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${COLORS.muted};text-align:center;">
            You're getting this because you use CampusHop with this address.
          </div>

        </td>
      </tr>
    </table>
  </body>
</html>`;
}

module.exports = { COLORS, esc, button, detailRow, layout };
