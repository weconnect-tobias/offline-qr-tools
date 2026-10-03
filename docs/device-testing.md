# Device test checklist

The automated tests decode every code with jsQR. Phones use other decoders (iOS camera / Vision,
Android camera / ML Kit / Google Lens), so check real devices before every release.

**Devices:** at least one iPhone (current iOS, built-in Camera app) and one Android phone
(built-in camera or Google Lens). Note the model and OS version in the results table.

**How:** show the code on a monitor at about 100 % zoom (≈ 5 cm wide), then print where noted.
Scan from 20–40 cm. A pass means the phone offers the right action **and** the content is
exactly right (check names, å/ä/ö, amounts).

Use test data only — a guest network or a test SSID, your own Swish number with a small amount.

## 1. Content types

| # | Type | What to enter | Expected on the phone | iPhone | Android |
|---|------|---------------|-----------------------|:------:|:-------:|
| 1 | Wi-Fi WPA | SSID `Test-Åkerö`, password with `;` and `:` | "Join network", connects | | |
| 2 | Wi-Fi WPA | Generated password (button "Create a strong password") | Connects after setting the same password on the router | | |
| 3 | Wi-Fi hidden | Hidden network ticked | Connects to the hidden network | | |
| 4 | Wi-Fi open | No password | Joins without asking | | |
| 5 | Web address | `example.com/menu?table=4` | Opens https://example.com/menu?table=4 | | |
| 6 | Text | Two lines with å/ä/ö | Shows both lines correctly | | |
| 7 | E-mail | Recipient, subject, message | Mail app with all three filled in | | |
| 8 | Phone | `+46 70 123 45 67` | Offers to call the number | | |
| 9 | SMS | Number and message | Messages app with number and text | | |
| 10 | Contact | Name with å/ä/ö, phone, e-mail, address | "Add contact" with every field right | | |
| 11 | Location | `58.9395`, `11.1712` | Opens Maps at Strömstad | | |
| 12 | Calendar event | Timed event 14:00–16:00 with place | "Add to calendar", 14:00 local time | | |
| 13 | Calendar event | All day, two days | All-day event over two days | | |
| 14 | Swish | Number + amount + message, both locked | Swish opens, nothing can be changed | | |
| 15 | Swish | Number only, message locked | Amount open, message empty and locked | | |
| 16 | Swish | Amount open, message open | Both can be changed | | |

## 2. Styles

Use the Wi-Fi code from row 1. Each style should scan as quickly as the plain square code.

| # | Style | iPhone | Android |
|---|-------|:------:|:-------:|
| 17 | Hearts + pointed corners | | |
| 18 | Vertical lines + leaf corners | | |
| 19 | Dots + circle corners + radial gradient | | |
| 20 | Custom gradient 135° with a light second colour (contrast warning shown) | | |
| 21 | Logo 30 %, "empty area" behind it | | |
| 22 | Narrow margin (2 modules) on a busy background | | |
| 23 | Error correction "Low" without logo | | |
| 24 | Swish look "Colour gradient" with the Swish symbol | | |
| 25 | Transparent PNG placed on a coloured background in a document | | |
| 26 | Dark mode in Windows: preview and export still white | | |

## 3. Printouts

Print on a normal office printer, A4, 100 % scale (no "fit to page").

| # | Layout | Check | iPhone | Android |
|---|--------|-------|:------:|:-------:|
| 27 | Sign (A4) | Scans from 1 m; the password is NOT printed anywhere | | |
| 28 | Table tent | Folds correctly; both sides scan | | |
| 29 | Card sheet | Every card scans; crop marks line up | | |
| 30 | PDF export 40 mm wide | Scans; the print check shows no warning | | |

## Results

| Date | Device | OS | Tester | Failed rows / notes |
|------|--------|----|--------|---------------------|
| | | | | |

Report a failing row as a GitHub issue with the device, OS version, the row number and (for
non-Wi-Fi codes) the exported PNG.
