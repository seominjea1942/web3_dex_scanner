"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

interface ContactFormModalProps {
  open: boolean;
  onClose: () => void;
}

const JOB_TITLES = [
  "Engineering / Developer",
  "Engineering Manager",
  "VP / Director of Engineering",
  "DBA / Data Engineer",
  "DevOps / SRE",
  "CTO / CIO",
  "Product Manager",
  "Other",
];

const REGIONS = [
  "United States",
  "Canada",
  "United Kingdom",
  "Germany",
  "France",
  "Japan",
  "South Korea",
  "Singapore",
  "China",
  "India",
  "Australia",
  "Brazil",
  "Other",
];

const DB_OPTIONS = [
  "Yes — MySQL",
  "Yes — PostgreSQL",
  "Yes — Oracle",
  "Yes — SQL Server",
  "Yes — Other",
  "No",
];

const initialForm = {
  firstName: "",
  lastName: "",
  email: "",
  jobTitle: "",
  phone: "",
  region: "",
  currentDb: "",
  useCase: "",
  privacyAgreed: false,
};

export function ContactFormModal({ open, onClose }: ContactFormModalProps) {
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleClose = useCallback(() => {
    onClose();
    // Reset after animation
    setTimeout(() => {
      setForm(initialForm);
      setSubmitted(false);
      setError("");
    }, 200);
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, handleClose]);

  if (!open) return null;

  const set = (field: string, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const canSubmit =
    form.firstName &&
    form.lastName &&
    form.email &&
    form.jobTitle &&
    form.phone &&
    form.region &&
    form.currentDb &&
    form.privacyAgreed;

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to send");
      }
      setSubmitted(true);
      setTimeout(handleClose, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    color: "var(--text-primary)",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 14,
    width: "100%",
    outline: "none",
    transition: "border-color 0.15s",
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    appearance: "none" as const,
    backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%23888' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 12px center",
    paddingRight: 36,
  };

  const labelStyle: React.CSSProperties = {
    color: "var(--text-secondary)",
    fontSize: 12,
    marginBottom: 4,
    display: "block",
  };

  const content = (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 100, background: "rgb(0,0,0)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="relative w-full rounded-xl border overflow-hidden animate-fade-in"
        style={{
          maxWidth: 560,
          maxHeight: "90vh",
          background: "var(--bg-card)",
          borderColor: "var(--border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <div>
            <h2
              className="font-bold"
              style={{ color: "var(--text-primary)", fontSize: 20 }}
            >
              Book a 30-Minute Meeting
            </h2>
            <p
              className="mt-1"
              style={{ color: "var(--text-secondary)", fontSize: 13 }}
            >
              We&apos;ll contact you shortly.
            </p>
          </div>
          <button
            onClick={handleClose}
            className="material-symbols-outlined shrink-0"
            style={{
              color: "var(--text-muted)",
              fontSize: 22,
              cursor: "pointer",
              background: "none",
              border: "none",
              padding: 4,
            }}
          >
            close
          </button>
        </div>

        {/* Body */}
        <div
          className="px-6 py-5 overflow-y-auto"
          style={{ maxHeight: "calc(90vh - 140px)" }}
        >
          {submitted ? (
            <div className="text-center py-12">
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 48,
                  color: "var(--accent-green)",
                  marginBottom: 12,
                  display: "block",
                }}
              >
                check_circle
              </span>
              <h3
                className="font-bold mb-2"
                style={{ color: "var(--text-primary)", fontSize: 18 }}
              >
                Thank you!
              </h3>
              <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
                We&apos;ll be in touch soon.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* First + Last Name */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label style={labelStyle}>First Name *</label>
                  <input
                    style={inputStyle}
                    placeholder="First Name"
                    value={form.firstName}
                    onChange={(e) => set("firstName", e.target.value)}
                    onFocus={(e) =>
                      (e.currentTarget.style.borderColor =
                        "var(--accent-teal)")
                    }
                    onBlur={(e) =>
                      (e.currentTarget.style.borderColor = "var(--border)")
                    }
                  />
                </div>
                <div className="flex-1">
                  <label style={labelStyle}>Last Name *</label>
                  <input
                    style={inputStyle}
                    placeholder="Last Name"
                    value={form.lastName}
                    onChange={(e) => set("lastName", e.target.value)}
                    onFocus={(e) =>
                      (e.currentTarget.style.borderColor =
                        "var(--accent-teal)")
                    }
                    onBlur={(e) =>
                      (e.currentTarget.style.borderColor = "var(--border)")
                    }
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label style={labelStyle}>Company Email *</label>
                <input
                  style={inputStyle}
                  type="email"
                  placeholder="Company Email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = "var(--accent-teal)")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = "var(--border)")
                  }
                />
              </div>

              {/* Job Title */}
              <div>
                <label style={labelStyle}>Job Title *</label>
                <select
                  style={{
                    ...selectStyle,
                    color: form.jobTitle
                      ? "var(--text-primary)"
                      : "var(--text-muted)",
                  }}
                  value={form.jobTitle}
                  onChange={(e) => set("jobTitle", e.target.value)}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = "var(--accent-teal)")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = "var(--border)")
                  }
                >
                  <option value="" disabled>
                    Job Title
                  </option>
                  {JOB_TITLES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {/* Phone */}
              <div>
                <label style={labelStyle}>Business Phone *</label>
                <input
                  style={inputStyle}
                  type="tel"
                  placeholder="Business Phone"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = "var(--accent-teal)")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = "var(--border)")
                  }
                />
              </div>

              {/* Region */}
              <div>
                <label style={labelStyle}>Country / Region *</label>
                <select
                  style={{
                    ...selectStyle,
                    color: form.region
                      ? "var(--text-primary)"
                      : "var(--text-muted)",
                  }}
                  value={form.region}
                  onChange={(e) => set("region", e.target.value)}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = "var(--accent-teal)")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = "var(--border)")
                  }
                >
                  <option value="" disabled>
                    Country / Region
                  </option>
                  {REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              {/* Current DB */}
              <div>
                <label style={labelStyle}>
                  Are you currently using a Relational Database? *
                </label>
                <select
                  style={{
                    ...selectStyle,
                    color: form.currentDb
                      ? "var(--text-primary)"
                      : "var(--text-muted)",
                  }}
                  value={form.currentDb}
                  onChange={(e) => set("currentDb", e.target.value)}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = "var(--accent-teal)")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = "var(--border)")
                  }
                >
                  <option value="" disabled>
                    Select one
                  </option>
                  {DB_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              {/* Use case */}
              <div>
                <label style={labelStyle}>
                  Tell us more about your use case
                </label>
                <textarea
                  style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
                  placeholder="Tell us more about your use case"
                  value={form.useCase}
                  onChange={(e) => set("useCase", e.target.value)}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = "var(--accent-teal)")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = "var(--border)")
                  }
                />
              </div>

              {/* Privacy */}
              <label
                className="flex items-start gap-2 cursor-pointer"
                style={{ fontSize: 13, color: "var(--text-secondary)" }}
              >
                <input
                  type="checkbox"
                  checked={form.privacyAgreed}
                  onChange={(e) => set("privacyAgreed", e.target.checked)}
                  className="mt-0.5 shrink-0"
                  style={{ accentColor: "var(--accent-teal)" }}
                />
                <span>
                  I agree to PingCAP&apos;s{" "}
                  <a
                    href="https://www.pingcap.com/privacy-policy/"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: "var(--accent-teal)",
                      textDecoration: "underline",
                    }}
                  >
                    privacy policy
                  </a>
                  . *
                </span>
              </label>

              {/* Error */}
              {error && (
                <p style={{ color: "var(--accent-red)", fontSize: 13 }}>
                  {error}
                </p>
              )}

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={!canSubmit || submitting}
                className="w-full font-medium transition-opacity duration-150"
                style={{
                  background: canSubmit
                    ? "var(--accent-teal)"
                    : "var(--border)",
                  color: canSubmit ? "#fff" : "var(--text-muted)",
                  border: "none",
                  borderRadius: 8,
                  padding: "12px 0",
                  fontSize: 15,
                  cursor: canSubmit ? "pointer" : "not-allowed",
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                {submitting ? "Sending..." : "Submit"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
