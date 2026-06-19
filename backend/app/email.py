"""Email sending via Resend API.

Why Resend?
- Free tier: 100 emails/day, no domain required to send to your own email.
- Single httpx call — no new dependency (we already have httpx).
- Simple JSON API.

If RESEND_API_KEY is not set, the approval link is logged to the console instead
so local dev still works without any email setup.
"""
from __future__ import annotations

import logging

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

_RESEND_URL = "https://api.resend.com/emails"


async def send_approval_request_email(
    *,
    new_user_email: str,
    approve_url: str,
) -> None:
    s = get_settings()

    if not s.resend_api_key:
        # Dev fallback — print link so you can approve without email
        logger.info(
            "APPROVAL LINK (no RESEND_API_KEY set — click this to approve):\n  %s",
            approve_url,
        )
        return

    html = f"""
    <div style="font-family:monospace;max-width:520px;margin:0 auto;padding:32px;background:#0d0d0d;color:#e5e7eb;border-radius:12px;">
      <div style="font-size:22px;font-weight:700;margin-bottom:4px;color:#22C55E;">RAG<span style="color:#fff">.</span>chat</div>
      <div style="font-size:12px;color:#6b7280;margin-bottom:28px;">Admin Notification</div>

      <p style="font-size:15px;margin-bottom:8px;">New access request:</p>
      <div style="background:#1a1a1a;border:1px solid #262626;border-radius:8px;padding:14px 18px;margin-bottom:28px;font-size:14px;color:#a3e635;">
        {new_user_email}
      </div>

      <a href="{approve_url}"
         style="display:inline-block;background:linear-gradient(135deg,#22C55E,#4ADE80);color:#000;font-weight:700;font-size:14px;
                padding:12px 32px;border-radius:10px;text-decoration:none;letter-spacing:-0.2px;">
        ✓ Approve Access
      </a>

      <p style="margin-top:28px;font-size:11px;color:#4b5563;">
        This link expires in 48 hours. If you did not expect this request, ignore this email.
      </p>
    </div>
    """

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(
                _RESEND_URL,
                headers={"Authorization": f"Bearer {s.resend_api_key}", "Content-Type": "application/json"},
                json={
                    "from": "RAG.chat <onboarding@resend.dev>",
                    "to": [s.admin_email],
                    "subject": f"[RAG.chat] New access request: {new_user_email}",
                    "html": html,
                },
            )
            if res.status_code not in (200, 201):
                logger.warning("Resend email failed %d: %s", res.status_code, res.text)
            else:
                logger.info("Approval email sent to %s", s.admin_email)
    except Exception as exc:
        logger.warning("Failed to send approval email: %s", exc)
