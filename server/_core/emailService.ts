/**
 * Email Service
 * Sends the post-verification email to donors via nodemailer + SMTP.
 *
 * When SMTP is not configured (or the send fails), it gracefully falls back
 * to the Google Apps Script `send_verification_email` action so existing
 * deployments keep working until SMTP credentials are added.
 *
 * The response shape mirrors the Apps Script API so the client code
 * ({ sent, skipped?, reason?, to? }) does not need to change.
 */
import nodemailer from "nodemailer";
import { ENV } from "./env";
import type { AdminRecord } from "./adminRecord";
import * as gasApi from "./googleAppsScriptApi";
import type { ApiResponse } from "./googleAppsScriptApi";

/** Payload shape returned to the client (same as the Apps Script email action). */
export interface VerificationEmailPayload {
  sent: boolean;
  skipped?: boolean;
  reason?: string;
  to?: string;
}

/** Result of a send attempt — which channel handled it plus the client payload. */
export interface VerificationEmailOutcome {
  response: ApiResponse<VerificationEmailPayload>;
  via: "smtp" | "gas";
}

export function isSmtpConfigured(): boolean {
  return Boolean(ENV.smtpHost && ENV.smtpUser && ENV.smtpPass);
}

/** Escape a value for safe inclusion inside HTML. */
function esc(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Format a date value (ISO string or sheet date) into "12 Aug 2025". */
function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function consentLabel(
  value: boolean | string | null | undefined
): string {
  if (value === true || String(value).toUpperCase() === "YES") return "Yes";
  if (value === false || String(value).toUpperCase() === "NO") return "No";
  if (value === null || value === undefined || String(value).trim() === "") return "—";
  return String(value);
}

/**
 * Build the full HTML verification card — premium visual design with a
 * gradient header, blood-group hero card, two-column profile grid, and
 * dark footer strip.  Inline CSS for broad email-client support plus a
 * scoped `<style>` block with media queries for mobile responsiveness.
 *
 * All dynamic values pass through esc() / fmtDate() / consentLabel().
 */
export function buildVerificationEmailHtml(
  record: AdminRecord,
  siteUrl: string,
  extras?: { bloodGroup?: string; donorConsent?: string }
): string {
  const bloodGroup = (
    extras?.bloodGroup?.trim().toUpperCase() || record.group || ""
  );
  const consent = extras?.donorConsent ?? record.donorConsent;
  const verifiedAt = record.verifiedAt ?? new Date().toISOString();
  const location = [record.location, record.area].filter(Boolean).join(", ");

  /** One cell of the two-column profile grid. */
  function cell(label: string, value: unknown, hasBorder: boolean): string {
    const border = hasBorder ? "border-left:1px solid #f0e4dc;" : "";
    return `<td class="cell-pad" width="50%" valign="top" style="padding:14px 22px; ${border}vertical-align:top;">
      <div style="font-size:10.5px; font-weight:700; letter-spacing:1.4px; text-transform:uppercase; color:#b39187; margin-bottom:5px; font-family:Arial,Helvetica,sans-serif;">${esc(label)}</div>
      <div style="font-size:14.5px; font-weight:700; color:#2b211d; line-height:1.45; word-break:break-word; font-family:Arial,Helvetica,sans-serif;">${esc(value)}</div>
    </td>`;
  }

  /** One two-up row of the profile grid. */
  function gridRow(
    left: [string, unknown],
    right: [string, unknown] | null,
    bg: string,
    isLast: boolean
  ): string {
    const bottom = isLast ? "" : "border-bottom:1px solid #f0e4dc;";
    const rightCell = right
      ? cell(right[0], right[1], true)
      : `<td width="50%" valign="top" class="cell-pad" style="padding:14px 22px; border-left:1px solid #f0e4dc;">&nbsp;</td>`;
    return `<tr>
      <td style="background:${bg}; ${bottom}" width="100%">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" class="two-col" style="width:100%;">
          <tr>${cell(left[0], left[1], false)}${rightCell}</tr>
        </table>
      </td>
    </tr>`;
  }

  const rows = [
    gridRow(["HRS ID", record.id], ["Full Name", record.name], "#ffffff", false),
    gridRow(["Date of Birth", fmtDate(record.dateOfBirth)], ["Age", record.age], "#fdf8f5", false),
    gridRow(["Gender", record.gender], ["Mobile", record.mobile], "#ffffff", false),
    gridRow(["Email", record.email], ["Location", location || "—"], "#fdf8f5", false),
    gridRow(["Blood Group", bloodGroup || "—"], ["Donor Consent", consentLabel(consent)], "#ffffff", false),
    gridRow(["Availability", record.availability], ["Donations Made", record.donationCount], "#fdf8f5", false),
    gridRow(["Next Eligible", fmtDate(record.nextEligibleAt)], ["Registered On", fmtDate(record.registeredAt)], "#ffffff", true),
  ].join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Your HRS profile has been verified</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  @media only screen and (max-width:640px) {
    .w600 { width:100% !important; max-width:100% !important; }
    .pad-outer { padding:22px 12px !important; }
    .pad-card { padding:28px 22px !important; }
    .pad-hero { padding:24px 18px !important; }
    .pad-header { padding:32px 28px 28px !important; }
    .drop { width:52px !important; height:52px !important; line-height:52px !important; font-size:25px !important; }
    .brand { font-size:21px !important; }
    .blood { font-size:44px !important; }
    .cell-pad { padding:12px 16px !important; }
    .btn { padding:14px 32px !important; font-size:14px !important; }
    .two-col td { display:block !important; width:100% !important; box-sizing:border-box !important; border-left:0 !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#f4f0ec; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; font-family:Arial,Helvetica,sans-serif;">
  <!-- Preheader (hidden snippet for email client preview) -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#f4f0ec;">
    Blood group ${esc(bloodGroup || "—")} — your HRS donor profile has been officially verified.
    &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f0ec;">
    <tr>
      <td align="center" class="pad-outer" style="padding:36px 14px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="w600" style="width:600px; max-width:600px; background:#ffffff; border-radius:22px; overflow:hidden; box-shadow:0 16px 44px -18px rgba(120,36,28,.28);">

          <!-- ===== HEADER ===== -->
          <tr>
            <td class="pad-header" style="background:linear-gradient(135deg,#7f1d1d 0%,#b91c1c 50%,#dc2626 100%); padding:38px 40px 32px; text-align:center;">
              <div class="drop" style="display:inline-block; width:58px; height:58px; line-height:58px; border-radius:50%; background:rgba(255,255,255,.14); font-size:28px; text-align:center;">🩸</div>
              <div class="brand" style="font-family:'Manrope','Segoe UI',Arial,Helvetica,sans-serif; font-size:24px; font-weight:800; color:#ffffff; letter-spacing:.3px; margin-top:14px;">HRS Blood Donor Portal</div>
              <div style="font-size:11.5px; font-weight:700; letter-spacing:2.8px; text-transform:uppercase; color:rgba(255,216,216,.92); margin-top:7px; font-family:Arial,Helvetica,sans-serif;">Profile Verified</div>
            </td>
          </tr>

          <!-- ===== BODY ===== -->
          <tr>
            <td class="pad-card" style="padding:32px 40px 30px; background:#ffffff;">
              <div style="font-family:'Manrope','Segoe UI',Arial,Helvetica,sans-serif; font-size:17px; font-weight:700; color:#2b211d;">
                Dear ${esc(record.name || "Donor")},
              </div>
              <div style="font-size:14.5px; line-height:1.78; color:#6f6259; margin-top:10px; font-family:Arial,Helvetica,sans-serif;">
                Great news — your blood donor profile has been <strong style="color:#b91c1c;">verified</strong> by our team. You are now part of a life-saving community of donors, and here is everything we have on record:
              </div>

              <!-- ===== BLOOD GROUP HERO ===== -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 4px;">
                <tr>
                  <td align="center">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,#dc2626 0%,#a82121 60%,#8a1c1c 100%); border-radius:18px; box-shadow:0 10px 28px -10px rgba(185,28,28,.5);">
                      <tr>
                        <td class="pad-hero" style="padding:28px 24px; text-align:center;">
                          <div style="font-size:10.5px; font-weight:700; letter-spacing:2.6px; text-transform:uppercase; color:rgba(255,255,255,.82); font-family:Arial,Helvetica,sans-serif;">Your Blood Group</div>
                          <div class="blood" style="font-family:'Manrope','Segoe UI',Arial,sans-serif; font-size:52px; font-weight:800; color:#ffffff; line-height:1.1; margin-top:4px; letter-spacing:1px;">${esc(bloodGroup || "—")}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- ===== VERIFIED BADGE ===== -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 24px;">
                <tr>
                  <td align="center">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,#0f766e,#115e59); border-radius:999px;">
                      <tr>
                        <td style="padding:9px 24px; font-size:13px; font-weight:700; color:#ffffff; font-family:Arial,Helvetica,sans-serif; letter-spacing:.2px;">
                          ✅ Verified on ${esc(fmtDate(verifiedAt))}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- ===== PROFILE DETAILS CARD ===== -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:4px; background:#fffdfb; border:1px solid #f0e4dc; border-radius:18px; overflow:hidden;">
                <tr>
                  <td style="padding:15px 22px; background:#fdf3ef; border-bottom:1px solid #f0e4dc;">
                    <div style="font-family:'Manrope','Segoe UI',Arial,Helvetica,sans-serif; font-size:12px; font-weight:800; letter-spacing:1.8px; text-transform:uppercase; color:#b91c1c;">📋 Your Profile Details</div>
                  </td>
                </tr>
                ${rows}
              </table>

              <!-- ===== CTA BUTTON ===== -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:30px 0 4px;">
                <tr>
                  <td align="center">
                    <a href="${esc(siteUrl)}" target="_blank" class="btn" style="display:inline-block; background:linear-gradient(135deg,#b91c1c 0%,#991b1b 100%); color:#ffffff; font-family:'Manrope','Segoe UI',Arial,Helvetica,sans-serif; font-size:15px; font-weight:700; text-decoration:none; padding:15px 42px; border-radius:12px; letter-spacing:.3px; box-shadow:0 10px 24px -8px rgba(185,28,28,.5);">Visit the HRS Donor Portal →</a>
                  </td>
                </tr>
              </table>
              <div style="text-align:center; font-size:11.5px; color:#a89a92; margin-top:12px; font-family:Arial,Helvetica,sans-serif;">
                Prefer a browser? Open <a href="${esc(siteUrl)}" target="_blank" style="color:#b91c1c; text-decoration:underline;">${esc(siteUrl)}</a>
              </div>
            </td>
          </tr>

          <!-- ===== FOOTER ===== -->
          <tr>
            <td style="background:#2b211d; padding:28px 40px; text-align:center;">
              <div style="font-family:'Manrope','Segoe UI',Arial,Helvetica,sans-serif; font-size:15px; font-weight:800; color:#ffffff; letter-spacing:.3px;">HRS Blood Donor Portal</div>
              <div style="font-size:12.5px; color:#cbb9b0; line-height:1.7; margin-top:6px; font-family:Arial,Helvetica,sans-serif;">One drop at a time — together we save lives. ❤️</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0;">
                <tr>
                  <td align="center">
                    <div style="width:100%; max-width:420px; height:1px; background:rgba(255,255,255,.14); font-size:0; line-height:0;">&nbsp;</div>
                  </td>
                </tr>
              </table>
              <div style="font-size:11px; color:#9d8a81; line-height:1.7; margin-top:14px; font-family:Arial,Helvetica,sans-serif;">
                You are receiving this email because your donor profile on the<br>HRS Blood Donor Portal was verified.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Plain-text alternative for the email (good for spam score / accessibility). */
export function buildVerificationEmailText(
  record: AdminRecord,
  siteUrl: string,
  extras?: { bloodGroup?: string; donorConsent?: string }
): string {
  const bloodGroup =
    extras?.bloodGroup?.trim().toUpperCase() ||
    record.group ||
    "—";
  const consent = consentLabel(extras?.donorConsent ?? record.donorConsent);
  const location = [record.location, record.area].filter(Boolean).join(", ");
  return [
    `Dear ${record.name || "Donor"},`,
    "",
    "Great news — your blood donor profile has been verified by the HRS team. You are now part of a life-saving community of donors. Here is everything we have on record:",
    "",
    `  HRS ID:          ${record.id}`,
    `  Full Name:       ${record.name}`,
    `  Date of Birth:   ${fmtDate(record.dateOfBirth)}`,
    `  Age:             ${record.age}`,
    `  Gender:          ${record.gender}`,
    `  Mobile:          ${record.mobile}`,
    `  Email:           ${record.email}`,
    `  Location:        ${location || "—"}`,
    `  Blood Group:     ${bloodGroup}`,
    `  Donor Consent:   ${consent}`,
    `  Availability:    ${record.availability}`,
    `  Donations Made:  ${record.donationCount}`,
    `  Next Eligible:   ${fmtDate(record.nextEligibleAt)}`,
    `  Registered On:   ${fmtDate(record.registeredAt)}`,
    `  Verified On:     ${fmtDate(record.verifiedAt ?? new Date().toISOString())}`,
    "",
    `Visit the HRS Donor Portal: ${siteUrl}`,
    "",
    "One drop at a time — together we save lives. ❤️",
  ].join("\n");
}

/**
 * Send the verification email for a donor.
 *
 * 1. If SMTP is not configured yet → fall back to Apps Script (current behavior).
 * 2. Otherwise render the donor record passed by the caller (resolved from
 *    Supabase — the same record the rest of the app shows) and send via
 *    nodemailer. If the send throws, log it and fall back to Apps Script so
 *    the donor still gets notified.
 */
export async function sendVerificationEmail(
  hrsId: string,
  extras?: { bloodGroup?: string; donorConsent?: string },
  /** The donor record resolved from the database by the caller. */
  recordOverride?: AdminRecord
): Promise<VerificationEmailOutcome> {
  if (!isSmtpConfigured()) {
    const response = await gasApi.sendVerificationEmail(hrsId, extras);
    return { response, via: "gas" };
  }

  const record = recordOverride;

  if (!record) {
    console.warn(
      `[emailService] No record provided for ${hrsId} — falling back to Apps Script email.`
    );
    const response = await gasApi.sendVerificationEmail(hrsId, extras);
    return { response, via: "gas" };
  }

  const to = (record.email ?? "").trim();
  if (!to) {
    return {
      response: {
        success: true,
        data: {
          sent: false,
          skipped: true,
          reason: "No email on file",
        },
      },
      via: "smtp",
    };
  }

  const siteUrl = ENV.appUrl;
  try {
    const transporter = nodemailer.createTransport({
      host: ENV.smtpHost,
      port: ENV.smtpPort,
      secure: ENV.smtpSecure,
      auth: { user: ENV.smtpUser, pass: ENV.smtpPass },
    });
    await transporter.sendMail({
      from: ENV.smtpFrom,
      to,
      subject: "Your HRS blood donor profile has been verified ✅",
      text: buildVerificationEmailText(record, siteUrl, extras),
      html: buildVerificationEmailHtml(record, siteUrl, extras),
    });
    return {
      response: { success: true, data: { sent: true, to } },
      via: "smtp",
    };
  } catch (error) {
    console.error(
      `[emailService] SMTP send failed for ${hrsId} — falling back to Apps Script:`,
      error
    );
    const response = await gasApi.sendVerificationEmail(hrsId, extras);
    return { response, via: "gas" };
  }
}

/**
 * Render the HTML email template for the Admin Password Reset OTP.
 */
export function buildAdminOtpEmailHtml(otp: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>HRS Admin Password Reset Code</title>
</head>
<body style="margin:0; padding:24px; background-color:#f8fafc; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#1e293b;">
  <div style="max-width:520px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e2e8f0; box-shadow:0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    <div style="background:linear-gradient(135deg, #dc2626 0%, #991b1b 100%); padding:28px 24px; text-align:center;">
      <h1 style="color:#ffffff; margin:0; font-size:22px; font-weight:700; letter-spacing:-0.5px;">HRS Blood Donor Portal</h1>
      <p style="color:#fee2e2; margin:6px 0 0 0; font-size:13px; font-weight:500;">Admin Security Verification</p>
    </div>
    <div style="padding:32px 28px;">
      <h2 style="font-size:18px; font-weight:600; margin:0 0 12px 0; color:#0f172a;">Password Reset Code</h2>
      <p style="margin:0 0 20px 0; font-size:14px; line-height:1.6; color:#475569;">
        A request was submitted to update the Administrator password for the HRS Portal. Use the one-time verification code below to authorize this change for <strong>kaizxark@gmail.com</strong>:
      </p>
      <div style="background:#fef2f2; border:2px dashed #f87171; border-radius:10px; padding:18px; text-align:center; margin:24px 0;">
        <span style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:36px; font-weight:800; letter-spacing:10px; color:#b91c1c; display:inline-block; padding-left:10px;">
          ${otp}
        </span>
      </div>
      <p style="margin:0 0 8px 0; font-size:13px; color:#64748b; line-height:1.5;">
        ⏱️ This code is valid for <strong>10 minutes</strong> and can only be used once.
      </p>
      <p style="margin:0; font-size:13px; color:#64748b; line-height:1.5;">
        🔒 If you did not initiate this request, someone may be attempting unauthorized access. Please ignore this email or review your access logs immediately.
      </p>
    </div>
    <div style="background:#f8fafc; border-top:1px solid #e2e8f0; padding:16px 28px; text-align:center; font-size:12px; color:#94a3b8;">
      HRS Blood Donor Portal • Automated Security System
    </div>
  </div>
</body>
</html>`;
}

/**
 * Send an OTP code to the designated admin email (kaizxark@gmail.com).
 */
export async function sendAdminPasswordOtpEmail(toEmail: string, otp: string): Promise<boolean> {
  if (!isSmtpConfigured()) {
    console.error("[emailService] SMTP is not configured for admin OTP email.");
    return false;
  }
  try {
    const transporter = nodemailer.createTransport({
      host: ENV.smtpHost,
      port: ENV.smtpPort,
      secure: ENV.smtpSecure,
      auth: { user: ENV.smtpUser, pass: ENV.smtpPass },
    });
    await transporter.sendMail({
      from: ENV.smtpFrom,
      to: toEmail,
      subject: `HRS Admin Password Reset Code: ${otp}`,
      text: `Your HRS Admin verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you did not request this password reset, please ignore this email.`,
      html: buildAdminOtpEmailHtml(otp),
    });
    return true;
  } catch (error) {
    console.error("[emailService] Failed to send admin OTP email:", error);
    return false;
  }
}
