import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Email service not configured" },
      { status: 500 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    firstName,
    lastName,
    email,
    jobTitle,
    phone,
    region,
    currentDb,
    useCase,
  } = body as Record<string, string>;

  if (!firstName || !lastName || !email || !jobTitle || !phone || !region || !currentDb) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  const resend = new Resend(apiKey);

  try {
    await resend.emails.send({
      from: "Chainscope <onboarding@resend.dev>",
      to: "minjea.seo@pingcap.com",
      subject: `Chainscope Contact: ${firstName} ${lastName} (${email})`,
      text: [
        `Name: ${firstName} ${lastName}`,
        `Email: ${email}`,
        `Job Title: ${jobTitle}`,
        `Phone: ${phone}`,
        `Region: ${region}`,
        `Current DB: ${currentDb}`,
        `Use Case: ${useCase || "(not provided)"}`,
        "",
        `Submitted from Chainscope demo at ${new Date().toISOString()}`,
      ].join("\n"),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[contact] Resend error:", err);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 }
    );
  }
}
