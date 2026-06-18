# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitLab issues.**

Instead, please report them via email to:

📧 **security@guidekungz.com** (replace with your actual security contact)

You should receive a response within 48 hours. If for some reason you do not, please follow up via email to ensure we received your original message.

### What to include

Please include the following information in your report:

- **Type of vulnerability** (e.g., XSS, prototype pollution, denial of service)
- **Affected versions** of `@GKz/image-compression`
- **Affected files** (if known)
- **Steps to reproduce** — minimal code snippet
- **Impact** — what can an attacker do?
- **Suggested fix** (if any)

### What to expect

After you submit a report:

1. **Acknowledgment** — within 48 hours
2. **Initial assessment** — within 5 business days
3. **Fix timeline** — depends on severity:
   - Critical: 1-3 days
   - High: 1-2 weeks
   - Medium: 2-4 weeks
   - Low: next release
4. **Credit** — if desired, you'll be credited in the fix release notes

## Security Best Practices for Consumers

When using `@GKz/image-compression` in your project:

- **Always validate user-uploaded files** before processing (e.g., check MIME type, magic bytes)
- **Set size limits** on uploads to prevent OOM (e.g., reject files > 50 MB)
- **Use CSP headers** to restrict Worker source origins
- **Sandbox image processing** — don't process untrusted files in privileged contexts
- **Keep the library updated** — subscribe to releases for security patches

## Known Security Considerations

This library:

- ✅ **Runs entirely in the browser** — no data is sent to remote servers (unless you implement server-fallback)
- ✅ **No eval or dynamic code execution** — all code is statically compiled
- ✅ **No network requests** — all assets are bundled
- ⚠️ **Uses Web Workers** — subject to browser CSP policies
- ⚠️ **Optional `heic2any` dependency** — verify integrity if installing manually
- ⚠️ **Reads EXIF data** — EXIF may contain user location; consider stripping it after processing

## Acknowledgments

We thank the following people for responsibly disclosing security issues:

*(List will be updated as issues are reported and fixed.)*
