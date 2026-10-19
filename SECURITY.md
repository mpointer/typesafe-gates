# Security

Report a vulnerability by opening a private security advisory on this
repository (Security tab, "Report a vulnerability") or by email to
mpointer@gmail.com. Please do not open a public issue for a vulnerability.

Scope notes:

- This package sends the `state` your gate builds to TypeSafe AI's API. It
  does not redact. Keep secrets and anything you may not transmit out of the
  state function.
- `inboundScreenGate` reduces, and does not eliminate, prompt-injection risk.
  It is a probabilistic screen in front of an automatic action; keep the
  fail-closed policy and a human path for held mail.
- Usage records carry whatever you put in `meta`. Keep personal data out of
  it unless your telemetry store is meant to hold it.
